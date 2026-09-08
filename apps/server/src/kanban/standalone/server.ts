// Отдельный процесс канбана (`VC_KANBAN_MODE=remote` у ядра). Тот же `createKanbanModule`, что и внутри
// ядра, на той же базе (только Postgres — файл SQLite из двух процессов не открыть), но состояние ядра
// — по HTTP (`HttpKanbanCore`), авторизация — пересылкой в ядро (`registerForwardedAuth`), а кадры
// ранов, события доски и уведомлений уходят ядру, у которого живут сокеты пользователей. Снаружи сюда
// ходит только прокси ядра (`kanbanBridge/proxy.ts`) и исполнитель LLM за `/mcp/kanban`, `/mcp/ci-commands`.
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { RpcError, createRpcDispatcher, type RpcRequest } from '@voicechat/shared'
import { MAKE_MCP_PATH } from '@voicechat/make'
import type { ServerConfig } from '../../config.js'
import { VoiceChatDb } from '../../db/database.js'
import type { LlmClient } from '../../claude/types.js'
import { RemoteLlmClient } from '../../llm/remoteClient.js'
import { createMailer, type Mailer } from '../../users/mailer.js'
import { createBrowserRunnerClient, type BrowserRunnerClient } from '../../browser/runnerClient.js'
import { createKbUsageTracker } from '../../kb/usage.js'
import { KB_MCP_PATH } from '../../kb/kbMcp.js'
import { buildPublicMcpUrl } from '../../mcp/publicBase.js'
import { REMOTE_BASH_MCP_PATH } from '../../mcp/remoteBashMcp.js'
import { PREVIEW_MCP_PATH } from '../../mcp/previewMcp.js'
import { CI_COMMANDS_MCP_PATH } from '../../ci/ciCommandsMcp.js'
import { createAutomatedQaScenarioRunner } from '../../ci/automatedQaScenario.js'
import type { CommandExecutor } from '../../ci/types.js'
import { createRemoteMake } from '../../makeBridge/remote.js'
import type { KanbanCore } from '../core.js'
import { createKanbanModule, type KanbanModule } from '../module.js'
import {
  INTERNAL_KANBAN_EVENTS_PATH, KANBAN_HEALTH_PATH, KANBAN_INTERNAL_MACHINES_PATH, KANBAN_INTERNAL_SERVICE_PATH, KANBAN_SERVICE_RPC_METHODS,
  type KanbanEvent, type KanbanEventsRequest, type MachinesSnapshotRequest
} from '../internal.js'
import { registerForwardedAuth } from '../../internal/forwardedAuth.js'
import { HttpKanbanCore } from './httpCore.js'

export interface BuildKanbanServerOptions {
  /** Тот же `loadConfig(env)`, что у ядра: адреса раннеров, SMTP, база, секреты — из одного набора env. */
  config: ServerConfig
  /** Адрес ядра внутри сети (`VC_CORE_URL`). */
  coreUrl: string
  /** Общая база; по умолчанию — `VC_DB_URL`. В тестах — тот же экземпляр, что у ядра. */
  db?: VoiceChatDb
  /** Порт к ядру; по умолчанию HTTP. */
  core?: KanbanCore
  claude?: LlmClient
  codex?: LlmClient
  mailer?: Mailer
  browserRunner?: BrowserRunnerClient
  ciExecutor?: CommandExecutor
  fetchImpl?: typeof fetch
  logger?: boolean
  version?: string | null
}

export interface KanbanServer {
  app: FastifyInstance
  db: VoiceChatDb
  kanban: KanbanModule
  core: KanbanCore
}

export async function buildKanbanServer(opts: BuildKanbanServerOptions): Promise<KanbanServer> {
  const { config, coreUrl } = opts
  if (!config.internalToken) throw new Error('Канбан отдельным процессом требует VC_INTERNAL_TOKEN (тот же, что у ядра)')
  if (!config.mcpSecret) throw new Error('Канбан отдельным процессом требует VC_MCP_SECRET (тот же, что у ядра)')
  if (!opts.db && !config.dbUrl) throw new Error('Канбан отдельным процессом требует общую базу VC_DB_URL (Postgres)')
  const token = config.internalToken
  const mcpSecret = config.mcpSecret
  const fetchImpl = opts.fetchImpl ?? fetch
  const app = Fastify({ logger: opts.logger ?? false })
  const warn = (extra: Record<string, unknown>, message: string): void => { app.log.warn(extra, message) }

  const ownDb = !opts.db
  const db = opts.db ?? new VoiceChatDb(join(config.dataDir, 'voicechat.db'), { postgres: { url: config.dbUrl! } })
  await db.ready
  if (ownDb) app.addHook('onClose', async () => { await db.close() })

  const core = opts.core ?? new HttpKanbanCore({ coreUrl, token, fetchImpl, onError: (error, what) => warn({ err: error, what }, '[kanban] фоновый вызов ядра не удался') })
  const httpCore = core instanceof HttpKanbanCore ? core : null
  // Зеркало машин заполняем до сборки кластера: реконсиляция ранов при старте смотрит на онлайн машин.
  if (httpCore) { try { await httpCore.start() } catch (error) { warn({ err: error }, '[kanban] ядро недоступно при старте: машины считаются offline до первого снимка') } }

  registerForwardedAuth(app, { name: 'kanban', coreUrl, token, fetchImpl })

  const runner = (kind: 'claude' | 'codex', baseUrl: string): LlmClient => new RemoteLlmClient({
    kind, baseUrl,
    ...(config.llmRunnerToken ? { token: config.llmRunnerToken } : {}),
    ...(config.llmRunnerConnectTimeoutMs ? { connectTimeoutMs: config.llmRunnerConnectTimeoutMs } : {})
  })
  const llm = (kind: 'claude' | 'codex', given: LlmClient | undefined, url: string | undefined): LlmClient => {
    if (given) return given
    if (!url) throw new Error(`Канбан отдельным процессом требует адрес исполнителя ${kind}: VC_LLM_RUNNER_${kind.toUpperCase()}_URL или VC_LLM_RUNNER_URL`)
    return runner(kind, url)
  }
  const claude = llm('claude', opts.claude, config.llmRunnerClaudeUrl)
  const codex = llm('codex', opts.codex, config.llmRunnerCodexUrl)
  const mailer = opts.mailer ?? createMailer({ smtpUrl: config.smtpUrl, mailFrom: config.mailFrom }, (m, extra) => warn(extra ?? {}, m))
  const browserRunner = opts.browserRunner ?? (config.browserRunnerUrl && config.browserRunnerToken
    ? createBrowserRunnerClient({ baseUrl: config.browserRunnerUrl, token: config.browserRunnerToken })
    : undefined)
  const kbUsage = createKbUsageTracker({ db })
  // Make: отдельный процесс (`VC_MAKE_URL`) или встроен в ядро — тогда его `MakeService` ядро отдаёт по тому же RPC.
  const makeBase = (config.makeUrl ?? coreUrl).replace(/\/+$/, '')
  const makeMcpBaseUrl = config.makeUrl
    ? `${(config.makeMcpPublicBase ?? config.makeUrl).replace(/\/+$/, '')}${MAKE_MCP_PATH}?k=${mcpSecret}`
    : buildPublicMcpUrl(config, MAKE_MCP_PATH, mcpSecret)
  const make = createRemoteMake({ makeUrl: makeBase, token, mcpSecret, mcpBaseUrl: makeMcpBaseUrl, fetchImpl })
  // MCP: инструменты машин, KB и превью слушает ядро (`VC_MCP_PUBLIC_BASE` — его публичная база, как у
  // ядра); MCP канбана и CI-команд — этот процесс, исполнителю нужен его адрес.
  if (!config.mcpPublicBase) warn({}, '[kanban] VC_MCP_PUBLIC_BASE не задан: адреса MCP ядра для исполнителя будут указывать на этот процесс')
  const ownMcpBase = (config.kanbanMcpPublicBase ?? `http://127.0.0.1:${config.port}`).replace(/\/+$/, '')
  const automatedQaScreenshotDir = join(config.dataDir, 'qa-screenshots')
  const automatedQaScenarioRunner = browserRunner
    ? createAutomatedQaScenarioRunner({ browser: browserRunner, screenshotDir: automatedQaScreenshotDir, screenshotUrl: (runId) => `/api/qa/runs/${runId}/screenshot` })
    : undefined

  const kanban = await createKanbanModule({
    app, db, config, core, claude, codex, kbUsage, make: { service: make.service }, browserRunner, mailer, mcpSecret,
    ...(opts.ciExecutor ? { ciExecutor: opts.ciExecutor } : {}),
    automatedQaScenarioRunner, automatedQaScreenshotDir,
    remoteBashMcpBaseUrl: buildPublicMcpUrl(config, REMOTE_BASH_MCP_PATH, mcpSecret),
    kbMcpBaseUrl: buildPublicMcpUrl(config, KB_MCP_PATH, mcpSecret),
    previewMcpBaseUrl: buildPublicMcpUrl(config, PREVIEW_MCP_PATH, mcpSecret),
    ciCommandsMcpBaseUrl: `${ownMcpBase}${CI_COMMANDS_MCP_PATH}?k=${mcpSecret}`,
    ciKbUpdate: undefined
  })

  // События — ядру пачками: за один шаг рана приходит несколько кадров, и слать каждый отдельным
  // запросом значит удвоить трафик ради того, что клиент и так получает подряд.
  let pending: KanbanEvent[] = []
  let flushTimer: NodeJS.Timeout | null = null
  const flush = async (): Promise<void> => {
    flushTimer = null
    const events = pending
    pending = []
    if (!events.length) return
    try {
      const res = await fetchImpl(`${coreUrl.replace(/\/+$/, '')}${INTERNAL_KANBAN_EVENTS_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ events } satisfies KanbanEventsRequest),
        signal: AbortSignal.timeout(10_000)
      })
      if (!res.ok) warn({ status: res.status }, '[kanban] ядро не приняло события')
    } catch (error) { warn({ err: error }, '[kanban] события не доставлены ядру') }
  }
  const emit = (event: KanbanEvent): void => {
    pending.push(event)
    if (!flushTimer) flushTimer = setTimeout(() => { void flush() }, 20)
  }
  kanban.service.runs.subscribe((message, userId) => emit({ kind: 'frame', message, userId }))
  kanban.service.board.subscribe((projectId) => emit({ kind: 'board', projectId }))
  kanban.service.board.subscribePreparationRuns((update) => emit({ kind: 'preparationRun', update }))
  kanban.service.board.subscribeTaskRepositories(async (update) => emit({ kind: 'taskRepositories', update }))
  kanban.service.board.subscribeQaStages(async (update) => emit({ kind: 'qaStage', update }))
  kanban.service.board.subscribeImprovements((projectId) => emit({ kind: 'improvements', projectId }))
  kanban.service.notifications.subscribe(async (event) => emit({ kind: 'notification', event }))
  app.addHook('onClose', async () => { if (flushTimer) clearTimeout(flushTimer); await flush() })

  // Внутреннее API для ядра. Не под `/api/` — пересылка авторизации сюда не действует.
  const serviceRpc = createRpcDispatcher({
    snapshot: async (userId: string, runId: string) => (await kanban.service.runs.snapshot(userId, runId)) ?? null,
    boardChanged: (projectId: string) => { kanban.service.board.changed(projectId) },
    authorizeTunnel: (id: string) => httpCore ? httpCore.tunnels.authorize(id) : Promise.resolve(false),
    tunnelClosed: (id: string) => httpCore ? httpCore.tunnels.closed(id) : Promise.resolve(),
    previews: () => kanban.service.previews.list()
  }, KANBAN_SERVICE_RPC_METHODS)
  app.register(async (scope) => {
    scope.addHook('onRequest', async (req, reply) => {
      if (req.headers.authorization !== `Bearer ${token}`) { await reply.code(401).send({ error: 'unauthorized' }); return reply }
    })
    scope.post<{ Body: RpcRequest }>(KANBAN_INTERNAL_SERVICE_PATH, async (req, reply) => {
      try { return { result: await serviceRpc(req.body ?? { method: '', args: [] }) } } catch (error) {
        return reply.code(error instanceof RpcError ? error.status : 500).send({ error: error instanceof Error ? error.message : String(error) })
      }
    })
    scope.post<{ Body: MachinesSnapshotRequest }>(KANBAN_INTERNAL_MACHINES_PATH, async (req, reply) => {
      if (!httpCore) return reply.code(409).send({ error: 'зеркало машин есть только у HTTP-порта к ядру' })
      httpCore.mirror.apply(Array.isArray(req.body?.machines) ? req.body.machines : [])
      return { ok: true, machines: httpCore.mirror.size() }
    })
  })
  app.get(KANBAN_HEALTH_PATH, async () => ({ ok: true, service: 'kanban', version: opts.version ?? null, engine: db.engine, machines: httpCore?.mirror.size() ?? null }))

  return { app, db, kanban, core }
}
