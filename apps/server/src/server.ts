// Сборка Fastify-приложения (HTTP + WebSocket). Экспортируется отдельно от запуска,
// чтобы тестировать через fastify.inject / ws-клиент.

import { mkdirSync, existsSync, statSync, readdirSync, rmSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { join, extname } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import { ciToolOutputLimits, REST, clampModel, firstAllowedProvider, isModelAllowedForUser, isProviderAllowed, canConfirmDevelopmentReadiness, developmentReadinessGateResults, preparationExportFilename, redactPreparationText, DEFAULT_CODEX_MODEL, imageBlock, parseImages, type ImageRetouchRequest, type ImageRetouchResult, type ArtifactPublishRequest, type ArtifactPublishResult, type MessageAttachment, type DevelopmentReadiness, type AcceptanceCriterionSnapshot, type HealthResponse, type LlmProvider, type SttStatus, type WhisperModel } from '@voicechat/shared'
import type { ServerConfig } from './config.js'
import { attachWs, type WsHandlers } from './ws.js'
import { VoiceChatDb } from './db/database.js'
import { registerRest } from './routes/rest.js'
import { clearPreviewCookies, registerPreviewProxy } from './routes/previewProxy.js'
import { registerAgentRoutes } from './routes/agents.js'
import { StorageMigrationManager } from './storageMigration/manager.js'
import { registerStorageMigrationRoutes } from './storageMigration/routes.js'
import { registerAdminRoutes } from './routes/admin.js'
import { registerProjectRoutes } from './routes/projects.js'
import { registerQaRoutes } from './routes/qa.js'
import { registerCiRoutes } from './routes/ci.js'
import { registerFeaturePreviewRoutes } from './routes/featurePreview.js'
import { registerReleaseRoutes } from './routes/releases.js'
import { ReleaseManager, releaseKnowledgeBaseCommand } from './releases/releaseManager.js'
import { ManagedEnvironmentResolver } from './releases/managedEnvironmentResolver.js'
import { FeaturePreviewManager } from './preview/manager.js'
import { createCiRunManager } from './ci/runManager.js'
import { AgentCommandExecutor } from './ci/executor.js'
import { createComponentQaRunner } from './ci/componentQa.js'
import { createIntegrationTestRunner } from './ci/integrationTests.js'
import { MergeRunManager } from './merge/runManager.js'
import { createCiModelHooks } from './ci/modelHooks.js'
import { registerCiCommandsMcp, CI_COMMANDS_MCP_PATH } from './ci/ciCommandsMcp.js'
import type { CommandExecutor, CiKbUpdateHook } from './ci/types.js'
import { BoardHub, NotificationHub } from './projects/boardHub.js'
import { registerAuth, resolveActiveUser, resolveUser, uid } from './users/auth.js'
import { createMailer, type Mailer } from './users/mailer.js'

/** Токен сессии из заголовка Cookie при WS-upgrade (auth-roadmap п.5). */
function cookieToken(header: string | undefined): string | undefined {
  if (!header) return undefined
  for (const item of header.split(';')) { const [k, ...rest] = item.trim().split('='); if (k === 'vc_session') return rest.join('=') }
  return undefined
}
import { loadOrCreateSecret } from './users/accounts.js'
import type { SessionUser } from '@voicechat/shared'
import { AgentRegistry } from './agents/registry.js'
import { attachAgentWs } from './agents/wsAgent.js'
import { registerRemoteBashMcp, RemoteFileBroker, REMOTE_BASH_MCP_PATH } from './mcp/remoteBashMcp.js'
import { registerConsoleMcp, CONSOLE_MCP_PATH } from './mcp/consoleMcp.js'
import { registerMakeMcp, MAKE_MCP_PATH } from './mcp/makeMcp.js'
import { registerMakeRoutes } from './routes/make.js'
import { MakeLibrary } from './make/library.js'
import { MakeWorkspaces } from './make/workspace.js'
import { MakeHub } from './make/hub.js'
import { buildPublicMcpUrl } from './mcp/publicBase.js'
import { createSession } from './session.js'
import { createTurnManager } from './turns.js'
import { RemoteLlmClient } from './llm/remoteClient.js'
import { RunnerFsClient } from './llm/runnerFsClient.js'
import { PromptSuggester } from './prompt/suggester.js'
// Локальные spawn-реализации CLI живут в отдельном воркспейсе исполнителя
// (apps/llm-runner), а buildServer здесь выбирает между ними и HTTP-клиентом
// RemoteLlmClient по конфигу окружения.
import { ClaudeCli, CodexCli, ensureCliProfile, getLoginStatus as getRunnerLoginStatus } from '@voicechat/llm-runner/cli'
import type { LlmClient } from './claude/types.js'
import type { SttEngine } from './stt/types.js'
import type { SttClient } from './stt/client.js'
import { RemoteSttClient } from './stt/remoteClient.js'
import { ModelDownloadManager } from './stt/downloadManager.js'
import { StubDiarizationEngine } from './diarization/stubDiarization.js'
import { UploadStore, machineManagedFilePath, machineUploadDir, machineUploadPath, resolveManagedChatStorage } from './uploads.js'
import type { UploadInfo } from '@voicechat/shared'
import { RemoteTtsClient } from './tts/client/remoteTtsClient.js'
import type { TtsClient } from './tts/client/types.js'
import type { TtsVoiceCatalog } from '@voicechat/shared'
import { registerAnthropicGateway } from './anthropic/gateway.js'
import { detectResources } from './system/resources.js'
import { computeCapabilities } from './system/capabilities.js'
import type { SystemCapabilities } from '@voicechat/shared'
import { FileKnowledgeBaseService } from './kb/service.js'
import { registerKbRoutes, registerKbResearchRoutes } from './kb/routes.js'
import { ScopedKnowledgeBase } from './kb/scoped.js'
import { kbViewOf } from './kb/access.js'
import { KbResearchManager } from './kb/research.js'
import type { KnowledgeBaseService } from './kb/types.js'
import { LlmKbReranker } from './kb/reranker.js'
import { createKbUsageTracker, type KbUsageTracker } from './kb/usage.js'
import { registerKbMcp, kbToolBroker, KB_MCP_PATH } from './kb/kbMcp.js'
import { registerPreviewMcp, previewToolBroker, PreviewActionRelay, PREVIEW_MCP_PATH } from './mcp/previewMcp.js'
import { registerBrowserRoutes } from './routes/browser.js'
import { createBrowserRunnerClient, type BrowserRunnerClient } from './browser/runnerClient.js'
import { readUserFile } from './serverFiles.js'
import { UnixDeployClient, type DeployTrigger } from './routes/admin.js'
import { AuthStatusState } from './auth/statusState.js'
import { processImageRetouch, saveRetouchedImage, type RetouchGenerator } from './imageRetouch.js'
import { llmRetouchGenerator } from './llm/imageRetouchGenerator.js'
import { GeneratedCleanupService, withGeneratedFileLease, type GeneratedCleanupCounters } from './generatedCleanup.js'

const VERSION = process.env.VC_RELEASE_VERSION?.trim() || null
const RELEASED_AT = process.env.VC_RELEASED_AT?.trim() || new Date().toISOString()
const RELEASE_COMMIT = process.env.VC_RELEASE_COMMIT?.trim() || null
const RELEASE_TASK = process.env.VC_RELEASE_TASK?.trim() || null

export interface BuildOptions {
  config: ServerConfig
  /** Готовый экземпляр БД (для тестов, напр. :memory:). Иначе создаётся из config. */
  db?: VoiceChatDb
  /** Read-only база знаний (для тестов — мок). */
  kbService?: KnowledgeBaseService
  /** Телеметрия обращений к БЗ (для тестов — мок/выключено). */
  kbUsage?: KbUsageTracker
  /**
   * LLM-клиент (для тестов — мок). По умолчанию RemoteLlmClient, если задан адрес
   * исполнителя (config.llmRunnerClaudeUrl), иначе локальный ClaudeCli.
   */
  claude?: LlmClient
  /** Codex-клиент (для тестов — мок). По умолчанию — как claude, но kind='codex'. */
  codex?: LlmClient
  /** Legacy fake engine нужен только существующим unit-тестам сессии. */
  sttEngine?: SttEngine
  /** STT transport; production всегда использует RemoteSttClient. */
  sttClient?: SttClient
  /** TTS-клиент (для тестов — FakeTtsClient). По умолчанию HTTP к TTS Runner. */
  ttsClient?: TtsClient
  /** Переопределение обработчиков WS (для тестов). Иначе — реальная сессия. */
  createWsHandlers?: () => WsHandlers
  /** Секрет подписи токенов сессии (для тестов). Иначе — из dataDir/эфемерный. */
  sessionSecret?: string
  /** Мейлер регистрации (для тестов — фейк). Иначе SMTP из config или консольный. */
  mailer?: Mailer
  /** Реестр машин (для маршрутных тестов с фейковыми fs-ответами). */
  agentRegistry?: AgentRegistry
  /** Исполнитель CI-команд (в тестах — мок). По умолчанию поверх AgentRegistry. */
  ciExecutor?: CommandExecutor
  /** Хук шага «Актуализировать базу знаний» (в тестах — мок). По умолчанию — из createCiModelHooks. */
  ciKbUpdate?: CiKbUpdateHook
  /** Запуск host-side деплоя (в тестах — мок). */
  deployTrigger?: DeployTrigger
  /** Relay действий веб-превью (в тестах — свой, чтобы дёргать request напрямую). */
  previewRelay?: PreviewActionRelay
  /** Единое auth-состояние (инъекция для WS/HTTP тестов). */
  authStatus?: AuthStatusState
  /** Генератор crop для локальной ретуши; тесты инъектируют детерминированный ответ. */
  imageRetouchGenerator?: RetouchGenerator
  /** Sink структурированного итога TTL-очистки. */
  generatedCleanupLog?: (result: GeneratedCleanupCounters) => void
  /** Клиент browser-runner (Playwright Reader). По умолчанию — HTTP, если задан config.browserRunnerUrl. */
  browserRunner?: BrowserRunnerClient
}

export interface BuiltServer {
  app: FastifyInstance
  db: VoiceChatDb
}

export function parseQaPreparationResponse(text: string): AcceptanceCriterionSnapshot[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const start = text.indexOf('['), end = text.lastIndexOf(']')
  const raw = (fenced ?? (start >= 0 && end > start ? text.slice(start, end + 1) : text)).trim()
  let value: unknown
  try { value = JSON.parse(raw) }
  catch (cause) { throw new Error(`Невалидный JSON: ${cause instanceof Error ? cause.message : String(cause)}`) }
  if (!Array.isArray(value) || value.length === 0) throw new Error('Модель не вернула ни одного сценария')
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Сценарий ${index + 1}: ожидается объект`)
    const row = item as Record<string, unknown>
    for (const field of ['title','description','preconditions','steps','testData','expectedResult'] as const) {
      if (typeof row[field] !== 'string') throw new Error(`Сценарий ${index + 1}: поле ${field} должно быть строкой`)
    }
    const strings = row as Record<'title'|'description'|'preconditions'|'steps'|'testData'|'expectedResult', string> & Record<string, unknown>
    if (!strings.title.trim() || !strings.steps.trim() || !strings.expectedResult.trim()) throw new Error(`Сценарий ${index + 1}: title, steps и expectedResult не могут быть пустыми`)
    if (typeof row.required !== 'boolean') throw new Error(`Сценарий ${index + 1}: поле required должно быть boolean`)
    if (row.testType !== 'manual' && row.testType !== 'mixed' && row.testType !== 'not_testable_in_app') throw new Error(`Сценарий ${index + 1}: недопустимый testType`)
    return { title: strings.title.trim(), description: strings.description.trim(), preconditions: strings.preconditions.trim(), steps: strings.steps.trim(), testData: strings.testData.trim(), expectedResult: strings.expectedResult.trim(), required: row.required, testType: row.testType }
  })
}

/**
 * Этап workflow, под которым живут настройки LLM «Подготовки к разработке».
 * Отдельного вида расхода у неё нет, а по смыслу это планирование задачи, поэтому
 * движок и модель она наследует из настроек стадии `planning`.
 */

/** Модель Claude по умолчанию для подготовки — прежняя константа этапа. */
const TASK_PREPARATION_CLAUDE_MODEL = 'sonnet'

/**
 * Модель CLI подготовки: явный выбор любого уровня наследования, иначе дефолт
 * движка. `default` в настройках Claude означает «модель не выбрана», поэтому он
 * ведёт на sonnet — как было до того, как подготовка научилась читать настройки.
 */
export function taskPreparationModel(provider: LlmProvider, model: string): string {
  const explicit = model.trim()
  if (provider === 'codex') return explicit || DEFAULT_CODEX_MODEL
  return explicit && explicit !== 'default' ? explicit : TASK_PREPARATION_CLAUDE_MODEL
}

/** Похоже ли падение CLI на отсутствующую или протухшую авторизацию профиля. */
const CLI_AUTH_FAILURE = /authenticat|oauth|unauthor|not logged in|login|credential|api key|401|403/i

/**
 * Ошибка подготовки с указанием движка и владельца CLI-профиля. CLI запускается
 * в профиле нажавшего кнопку, поэтому «OAuth session expired» у пользователя,
 * который логинился только в другой движок, — это состояние его профиля, а не
 * поломка подготовки; из сырой строки CLI это не видно.
 */
export function taskPreparationFailure(provider: LlmProvider, userId: string, message: string): string {
  const label = provider === 'codex' ? 'Codex' : 'Claude'
  const head = `Подготовка через ${label} CLI (профиль пользователя «${userId}»)`
  return CLI_AUTH_FAILURE.test(message)
    ? `${head}: CLI не авторизован — войдите в ${label} под этим профилем. Ответ CLI: ${message}`
    : `${head} завершилась ошибкой: ${message}`
}

export async function buildServer(opts: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  // Толерантный JSON-парсер: пустое тело (напр. DELETE с Content-Type) → undefined,
  // а не 400. Делает REST устойчивым к любым клиентам.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      if (!body || (typeof body === 'string' && body.trim() === '')) {
        done(null, undefined)
        return
      }
      try {
        done(null, JSON.parse(body as string))
      } catch (err) {
        done(err as Error, undefined)
      }
    }
  )
  // fs.read передаёт до 32 MiB как base64 в одном сообщении (~42.7 MiB + JSON).
  // Явный предел делает допустимый размер независимым от дефолта библиотеки ws.
  await app.register(fastifyWebsocket, { options: { maxPayload: 48 * 1024 * 1024 } })

  const db =
    opts.db ??
    (() => {
      mkdirSync(opts.config.dataDir, { recursive: true })
      return new VoiceChatDb(join(opts.config.dataDir, 'voicechat.db'))
    })()

  // Аутентификация приложения (многопользовательский режим web): секрет подписи
  // токенов из dataDir (переживает рестарт); в тестах (opts.db) — эфемерный, без диска.
  const sessionSecret =
    opts.sessionSecret ??
    (opts.db ? randomBytes(32).toString('hex') : loadOrCreateSecret(opts.config.dataDir))
  db.ensureAdmin(opts.config.adminPassword) // сид админа (пароль из VC_ADMIN_PASSWORD)
  registerAuth(app, db, sessionSecret, { mailer: opts.mailer ?? createMailer({ smtpUrl: opts.config.smtpUrl, mailFrom: opts.config.mailFrom }, (m, extra) => app.log.warn(extra ?? {}, m)), publicUrl: opts.config.publicUrl })

  app.get(REST.health, async (): Promise<HealthResponse> => ({
    ok: true,
    version: VERSION,
    releasedAt: RELEASED_AT,
    commit: RELEASE_COMMIT,
    task: RELEASE_TASK
  }))

  const runnerFs =
    opts.config.llmRunnerClaudeUrl || opts.config.llmRunnerCodexUrl
      ? new RunnerFsClient({
          claudeBaseUrl: opts.config.llmRunnerClaudeUrl,
          codexBaseUrl: opts.config.llmRunnerCodexUrl,
          ...(opts.config.llmRunnerToken ? { token: opts.config.llmRunnerToken } : {})
        })
      : null

  const authStatus = opts.authStatus ?? new AuthStatusState(async (userId) => {
    if (runnerFs) return runnerFs.authStatus(userId)
    return getRunnerLoginStatus({ home: ensureCliProfile(opts.config.dataDir, userId).home })
  })
  // Реестр создаётся до REST: task-chat context обязан показывать ту же effective
  // online-машину, которую затем использует фактический ход.
  const agentRegistry = opts.agentRegistry ?? new AgentRegistry()
  await registerRest(app, db, opts.config.dataDir, {
    runnerFs: runnerFs ?? undefined,
    authStatus,
    isAgentOnline: (agentId) => agentRegistry.isOnline(agentId)
  })
  registerPreviewProxy(app, {
    machines: {
      bridge: agentRegistry,
      canUse: (userId, agentId) => db.canUseAgentForPreview(userId, agentId)
    }
  })

  const profileHome = (userId: string): string =>
    ensureCliProfile(opts.config.dataDir, userId).home
  // Движок либо запускается рядом (spawn CLI), либо живёт в контейнере-исполнителе
  // и вызывается по HTTP. Выбор — по наличию адреса в env; реестра исполнителей
  // пока нет (docs/plans/llm-runners.md, срез 2).
  const runner = (kind: 'claude' | 'codex', baseUrl: string): LlmClient =>
    new RemoteLlmClient({
      kind,
      baseUrl,
      ...(opts.config.llmRunnerToken ? { token: opts.config.llmRunnerToken } : {}),
      ...(opts.config.llmRunnerConnectTimeoutMs
        ? { connectTimeoutMs: opts.config.llmRunnerConnectTimeoutMs }
        : {})
    })
  const claude =
    opts.claude ??
    (opts.config.llmRunnerClaudeUrl
      ? runner('claude', opts.config.llmRunnerClaudeUrl)
      : new ClaudeCli({ profileHome }))
  const codex =
    opts.codex ??
    (opts.config.llmRunnerCodexUrl
      ? runner('codex', opts.config.llmRunnerCodexUrl)
      : new CodexCli({ profileHome }))
  const reranker = opts.config.kbRerankProvider === 'disabled'
    ? undefined
    : new LlmKbReranker(opts.config.kbRerankProvider === 'claude' ? claude : codex)
  // Файловые темы docs/kb — раздел «Использование» (общий для всех); поверх них
  // ScopedKnowledgeBase добавляет статьи из БД (персональные и проектные) и
  // решает, что кому видно.
  const fileKb = opts.kbService ?? new FileKnowledgeBaseService(opts.config.kbRoot, reranker)
  const kb = new ScopedKnowledgeBase(fileKb, db, reranker)
  // Телеметрия обращений к БЗ: одна на процесс (как реестр ходов) — её события
  // рассылаются всем соединениям пользователя, а строки живут в БД.
  const kbUsage = opts.kbUsage ?? createKbUsageTracker({ db })
  registerKbRoutes(app, kb, { db, toolEnabled: opts.config.kbToolEnabled })

  // Помощник формулировки — одноразовый вызов выбранного пользователем CLI.
  // Историю разговора не трогает, shell выключен.
  app.post<{ Body: { prompt?: string; modifiers?: import('@voicechat/shared').ModifierPrompt[] } }>(REST.promptSuggest, async (req, reply) => {
    const prompt = (req.body?.prompt ?? '').trim()
    if (!prompt) return { variants: [] as Array<{ id: string; text: string }> }
    const settings = db.getSettings(uid(req))
    const access = db.getUserLlmAccess(uid(req))
    const provider = isProviderAllowed(access, settings.aiAssistProvider)
      ? settings.aiAssistProvider
      : firstAllowedProvider(access)
    if (!provider) return reply.code(403).send({ error: 'Нет доступных моделей' }) as never
    const requestedModel = settings.aiAssistModel || (provider === 'claude' ? 'haiku' : '')
    const model = clampModel(access, provider, requestedModel)
    if (!model) return reply.code(403).send({ error: 'Нет доступных моделей' }) as never
    const client = provider === 'codex' ? codex : claude
    const modifiers = (req.body?.modifiers ?? []).filter((item) => item.enabled && item.text.trim())
    try {
      const texts = await new PromptSuggester(client, model).suggest(prompt, modifiers, uid(req))
      return { variants: texts.map((text, index) => ({ id: `${Date.now()}-${index}`, text })) }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось получить подсказки'
      return reply.code(502).send({ error: message }) as never
    }
  })

  // Входящий Anthropic Messages API для подключения внешнего Claude Code CLI.
  // Авторизация клиента намеренно отсутствует: маршрут предназначен для закрытой сети.
  registerAnthropicGateway(app, {
    backend: opts.config.claudeGatewayBackend,
    codex,
    upstreamUrl: opts.config.claudeGatewayUpstreamUrl,
    upstreamApiKey: opts.config.claudeGatewayUpstreamKey,
    authMode: opts.config.claudeGatewayAuthMode,
    modelMap: opts.config.claudeGatewayModelMap
  })

  // Машины-агенты: реестр онлайн-подключений + REST + MCP-мост для проброса Bash.
  await registerAgentRoutes(app, db, agentRegistry, {
    agentApp: opts.config.agentAppPath,
    desktopApp: opts.config.desktopAppPath
  })
  const storageMigrations = new StorageMigrationManager(join(opts.config.dataDir, 'storage-migrations.json'), {
    list: (machineId, path) => agentRegistry.fsList(machineId, path),
    read: (machineId, path) => agentRegistry.fsRead(machineId, path),
    write: (machineId, path, dataBase64) => agentRegistry.fsWrite(machineId, path, dataBase64),
    mkdir: (machineId, path) => agentRegistry.fsMkdir(machineId, path),
    rename: (machineId, from, to) => agentRegistry.fsRename(machineId, from, to),
    deleteFile: (machineId, path) => agentRegistry.fsDeleteFileSafe(machineId, path)
  })
  registerStorageMigrationRoutes(app, db, agentRegistry, storageMigrations)
  const mcpSecret = randomBytes(16).toString('hex')
  const remoteFileBroker = new RemoteFileBroker()
  const deployTrigger = opts.deployTrigger ?? (opts.config.deployApiSocket
    ? new UnixDeployClient(opts.config.deployApiSocket)
    : undefined)
  // Лимиты ответов инструментов моста — из настроек CI, на каждый вызов: они
  // режут размер контекста хода, а его цена = контекст × число запросов.
  registerRemoteBashMcp(
    app,
    agentRegistry,
    mcpSecret,
    () => ciToolOutputLimits(db.getCiSettings()),
    // Машины проекта для адресации операций (query `project` дописывает
    // отправитель хода — turns.ts у чата, modelHooks.ts у CI-рана).
    (projectId) => db.listProjectMachines(projectId),
    (token) => remoteFileBroker.get(token)
  )
  registerCiCommandsMcp(app, mcpSecret)
  // Консоль с ассистентом (mcp__console__*): ход адресуется query `conv`, а
  // инструменты пишут/читают ту же живую PTY-сессию, что видит пользователь.
  registerConsoleMcp(app, agentRegistry, mcpSecret)
  // Make (mcp__make__*): файлы проекта разговора в <dataDir>/make/<conv>; изменения
  // уходят владельцу кадром make.changed через MakeHub.
  const makeWorkspaces = new MakeWorkspaces(opts.config.dataDir)
  const makeHub = new MakeHub()
  // Квота на пользователя (roadmap-2 п.15): все проекты Make владельца разговора.
  makeWorkspaces.setProjectsOfOwner((id) => {
    const owner = db.conversationOwner(id)
    return owner ? db.listConversations(owner, { includeCompleted: true }).filter((c) => c.assistantKind === 'make').map((c) => c.id) : null
  })
  registerMakeMcp(app, { workspaces: makeWorkspaces, hub: makeHub, ownerOf: (id) => db.conversationOwner(id) }, mcpSecret)
  registerMakeRoutes(app, { db, workspaces: makeWorkspaces, hub: makeHub, library: new MakeLibrary(opts.config.dataDir) })
  // Инструменты БЗ для модели (mcp__kb__*): тот же секрет процесса, ход
  // адресуется токеном ?turn= (его выдаёт и снимает TurnManager).
  registerKbMcp(app, {
    kb,
    secret: mcpSecret,
    usage: kbUsage,
    db,
    viewOf: (entry) => ({ ...kbViewOf(db, entry.userId), ...(entry.projectId ? { projectId: entry.projectId } : {}) }),
    agents: {
      isOnline: (agentId) => agentRegistry.isOnline(agentId),
      versionOf: (agentId) => agentRegistry.versionOf(agentId),
      platformOf: (agentId) => agentRegistry.platformOf(agentId)
    },
    deployTrigger
  })
  // Действия веб-превью (mcp__browser__*): relay «сервер → клиенты пользователя»,
  // сессии WS подписываются на подключении, ход адресуется токеном ?turn=.
  const previewRelay = opts.previewRelay ?? new PreviewActionRelay()
  // FeaturePreviewManager создаётся ниже по файлу — previewMcp получает его лениво.
  const featurePreviewsRef: { current: FeaturePreviewManager | null } = { current: null }
  registerPreviewMcp(app, {
    secret: mcpSecret,
    relay: previewRelay,
    context: {
      // Машина алиаса machine.internal: execTarget разговора (agentId) с гейтом доступа.
      machineOf: ({ userId, conversationId }) => {
        const conversation = db.getConversation(userId, conversationId)
        const target = conversation?.execTarget
        if (!target || target === 'none' || target === 'server') return null
        return db.canUseAgentForPreview(userId, target) || db.canUseAgent(userId, target, conversation?.projectId ?? null) ? target : null
      },
      testUsersOf: ({ userId, conversationId }) => {
        const projectId = db.getConversation(userId, conversationId)?.projectId
        if (!projectId) return []
        return db.getProject(userId, projectId)?.testUsers ?? []
      },
      environmentsOf: ({ userId, conversationId }) => {
        const projectId = db.getConversation(userId, conversationId)?.projectId
        if (!projectId || !db.getProject(userId, projectId)) return []
        const toMachineUrl = (agentId: string, raw: string | null): string | null => {
          if (!raw) return null
          try {
            const url = new URL(raw)
            url.hostname = agentId + '.machine.internal'
            return url.toString()
          } catch { return null }
        }
        return (featurePreviewsRef.current?.list() ?? [])
          .filter((env) => env.projectId === projectId)
          .map((env) => ({
            taskId: env.taskId,
            branch: env.branch,
            state: env.state,
            healthy: env.healthStatus === 'healthy',
            appUrl: toMachineUrl(env.agentId, env.appUrl),
            storybookUrl: toMachineUrl(env.agentId, env.storybookUrl)
          }))
      },
      clearCookies: ({ userId }, host) => clearPreviewCookies(userId, host)
    }
  })
  // Playwright Reader: REST-оркестрация изолированного Chromium в browser-runner.
  // Клиент создаётся, только если задан адрес раннера; иначе роуты отвечают 501.
  const browserRunner = opts.browserRunner ?? (opts.config.browserRunnerUrl && opts.config.browserRunnerToken
    ? createBrowserRunnerClient({ baseUrl: opts.config.browserRunnerUrl, token: opts.config.browserRunnerToken })
    : undefined)
  registerBrowserRoutes(app, { db, ...(browserRunner ? { runner: browserRunner } : {}) })
  const remoteBashMcpBaseUrl = buildPublicMcpUrl(opts.config, REMOTE_BASH_MCP_PATH, mcpSecret)
  const kbMcpBaseUrl = buildPublicMcpUrl(opts.config, KB_MCP_PATH, mcpSecret)
  const ciCommandsMcpBaseUrl = buildPublicMcpUrl(opts.config, CI_COMMANDS_MCP_PATH, mcpSecret)
  const previewMcpBaseUrl = buildPublicMcpUrl(opts.config, PREVIEW_MCP_PATH, mcpSecret)
  const consoleMcpBaseUrl = buildPublicMcpUrl(opts.config, CONSOLE_MCP_PATH, mcpSecret)
  const makeMcpBaseUrl = buildPublicMcpUrl(opts.config, MAKE_MCP_PATH, mcpSecret)

  // «Исследовать проект»: модель на машине проекта сверяет статьи раздела
  // «Разработка проекта» с кодом. Живёт рядом с MCP-мостом — ей нужен тот же
  // remote-bash, что и ходам модели.
  registerKbResearchRoutes(
    app,
    db,
    new KbResearchManager({
      db,
      claude,
      codex,
      mcpBaseUrl: remoteBashMcpBaseUrl,
      agentNameOf: (agentId) => agentRegistry.nameOf(agentId)
    })
  )

  // Админ-страница пользователей (роуты под guard requireAdmin).
  registerAdminRoutes(app, db, agentRegistry, deployTrigger, () => makeWorkspaces.adminStats((id) => db.conversationOwner(id)), Boolean(opts.mailer?.configured ?? opts.config.smtpUrl))

  // Проекты + канбан-доска (членство в проекте) + живой board.changed по WS.
  const boardHub = new BoardHub()
  const preparationRunUpdated = (userId: string, projectId: string, taskId: string, runId: string, boardChanged = true): void => {
    preparationDeltaThrottle.delete(runId) // переход рана — сбрасываем окно троттла дельт, чтобы событие ушло сразу
    boardHub.emitPreparationRun({ userId, projectId, taskId, runId })
    if (boardChanged) boardHub.emit(projectId)
  }
  // Дельты стрим-лога сыплются часто; WS-уведомление о ране коалесим до ~1/с на ран
  // (сам лог пишется в БД на каждый чанк, клиент догрузит текущее состояние рана).
  const preparationDeltaThrottle = new Map<string, number>()
  const PREPARATION_DELTA_WINDOW_MS = 1000
  const preparationRunDelta = (userId: string, projectId: string, taskId: string, runId: string): void => {
    const now = Date.now()
    const last = preparationDeltaThrottle.get(runId) ?? 0
    if (now - last < PREPARATION_DELTA_WINDOW_MS) return
    preparationDeltaThrottle.set(runId, now)
    boardHub.emitPreparationRun({ userId, projectId, taskId, runId }) // дельты карточку не меняют — board не трогаем
  }
  const notificationHub = new NotificationHub()
  // Модель Whisper — общий машинный ресурс (файлы моделей одни на сервер), поэтому
  // её выбор берём у канонического пользователя (admin), а не per-user.
  const machineWhisperModel = (): WhisperModel => db.getSettings('admin').whisperModel

  const sttClient = opts.sttClient ?? (opts.config.sttRunnerUrl && opts.config.sttRunnerToken
    ? new RemoteSttClient({ baseUrl: opts.config.sttRunnerUrl, token: opts.config.sttRunnerToken, connectTimeoutMs: opts.config.sttRunnerConnectTimeoutMs })
    : undefined)
  let sttRunnerHealthy = Boolean(opts.sttEngine)
  let runnerModels: import('@voicechat/shared').WhisperModelInfo[] = []
  const refreshSttHealth = async () => {
    if (!sttClient) { sttRunnerHealthy = Boolean(opts.sttEngine); return }
    try {
      const health = await sttClient.health()
      sttRunnerHealthy = health.ok && health.whisper.available
      runnerModels = health.models
    } catch { sttRunnerHealthy = false; runnerModels = [] }
  }
  await refreshSttHealth()
  const sttHealthTimer = setInterval(() => void refreshSttHealth(), 10_000)
  app.addHook('onClose', async () => clearInterval(sttHealthTimer))

  app.get(REST.sttStatus, async (): Promise<SttStatus> => {
    await refreshSttHealth()
    const model = machineWhisperModel()
    return { present: sttRunnerHealthy && runnerModels.some((item) => item.model === model && item.present), model }
  })

  const resources = detectResources()
  const capabilities = (): SystemCapabilities => {
    const value = computeCapabilities(resources, machineWhisperModel(), undefined, { stt: opts.config.minMemSttBytes, tts: opts.config.minMemTtsBytes })
    if (!sttRunnerHealthy) value.stt = { available: false, reason: 'Сервис распознавания речи недоступен' }
    else if (sttClient && !runnerModels.some((item) => item.model === machineWhisperModel() && item.present)) value.stt = { available: false, reason: 'Модель распознавания речи не установлена' }
    if (!opts.ttsClient && (!opts.config.ttsRunnerUrl || !opts.config.ttsRunnerToken)) {
      value.tts = { available: false, reason: 'Нет доступного сервиса озвучки: TTS Runner не настроен' }
    }
    return value
  }
  app.get(REST.systemCapabilities, async (): Promise<SystemCapabilities> => { await refreshSttHealth(); return capabilities() })

  app.get(REST.sttModels, async () => sttClient ? sttClient.models() : import('@voicechat/shared').then(({ WHISPER_MODELS }) => WHISPER_MODELS.map((model) => ({ model, present: false, sizeBytes: 0 }))))
  app.delete<{ Params: { model: WhisperModel } }>('/api/stt/models/:model', async (req) => {
    if (!sttClient) return { ok: true }
    await sttClient.deleteModel(req.params.model)
    await refreshSttHealth()
    return { ok: true }
  })
  const sttEngine = opts.sttEngine
  const modelDownload = sttClient ? new ModelDownloadManager((onProgress) => sttClient.downloadModel(machineWhisperModel(), onProgress)) : undefined
  const ttsClient = opts.ttsClient ?? new RemoteTtsClient({ baseUrl: opts.config.ttsRunnerUrl ?? 'http://127.0.0.1:8791', token: opts.config.ttsRunnerToken ?? '' })
  const diarization = new StubDiarizationEngine()

  // Вложения разговора с выбранной машиной постоянно хранятся на ней. Сервер
  // только принимает байты запроса и пересылает агенту; без машины сохраняется
  // совместимый локальный режим.
  const uploads = new UploadStore(join(opts.config.dataDir, 'uploads'))
  const managedChatStorage = (userId: string, conversationId: string) => resolveManagedChatStorage(userId, conversationId, {
    getBinding: (uid, id) => db.getChatStorageBinding(uid, id),
    listStorages: (uid, machineId) => db.listMachineStorages(uid, machineId),
    ownsMachine: (uid, machineId) => db.listAgents(uid).some((agent) => agent.id === machineId),
    isOnline: (machineId) => agentRegistry.isOnline(machineId),
    verifyRoot: async (machineId, rootPath) => {
      const separator = rootPath.includes('\\') && !rootPath.includes('/') ? '\\' : '/'
      const marker = await agentRegistry.fsRead(machineId, `${rootPath.replace(/[/\\]$/, '')}${separator}.voicechat${separator}storage.json`)
      const parsed = JSON.parse(Buffer.from(marker.dataBase64 ?? '', 'base64').toString('utf8')) as { id?: string }
      const binding = db.getChatStorageBinding(userId, conversationId)
      if (!binding || parsed.id !== binding.storageId) throw new Error('Marker привязанного хранилища отсутствует или конфликтует')
    }
  })
  const generatedCleanup = new GeneratedCleanupService({
    targets: () => db.listGeneratedCleanupTargets(),
    ttlDays: (userId) => db.getSettings(userId).generatedFilesTtlDays,
    messages: (userId, conversationId) => db.listMessages(userId, conversationId),
    resolve: managedChatStorage,
    list: (machineId, path) => agentRegistry.fsList(machineId, path),
    deleteFile: (machineId, path) => agentRegistry.fsDeleteFileSafe(machineId, path),
    defer: (target, error, nextAttemptAt) => db.deferGeneratedCleanup(target.userId, target.conversationId, error, nextAttemptAt),
    complete: (target) => db.completeGeneratedCleanup(target.conversationId),
    log: opts.generatedCleanupLog ?? ((result) => app.log.info({ event: 'generated_cleanup', ...result }))
  })
  // Тестовые buildServer используют фейковые реестры и запускают сервис явно.
  // Production-процесс делает первый проход после старта и затем каждые шесть часов.
  if (!process.env.VITEST) {
    // Фоновая очистка Make (roadmap-2 п.16): снимки и PNG стори старше 30 дней, раз в 6 часов и при старте.
    const makeSweep = async (): Promise<void> => {
      try { const r = await makeWorkspaces.sweep(); if (r.snapshots || r.shots) app.log.info({ event: 'make_sweep', ...r }) } catch (error) { app.log.warn({ event: 'make_sweep_failed', error: String(error) }) }
    }
    const makeSweepTimer = setInterval(() => { void makeSweep() }, 6 * 60 * 60 * 1000)
    makeSweepTimer.unref()
    app.addHook('onClose', async () => clearInterval(makeSweepTimer))
    queueMicrotask(() => { void makeSweep() })
    // Учётки и сессии (auth-roadmap п.18): раз в сутки чистим истёкшие сессии/инвайты и отключаем неактивных (VC_INACTIVE_DAYS, 0 — выкл).
    const inactiveDays = Number(process.env.VC_INACTIVE_DAYS ?? 180)
    const accountsSweep = (): void => {
      try {
        const sessions = db.pruneSessions(), invites = db.pruneInvites()
        const blocked = inactiveDays > 0 ? db.blockInactiveUsers(inactiveDays) : []
        for (const name of blocked) db.logSecurityEvent({ user: name, type: 'inactive_blocked', details: `нет входов ${inactiveDays} дн.` })
        if (sessions || invites || blocked.length) app.log.info({ event: 'accounts_sweep', sessions, invites, blocked }, 'accounts sweep')
      } catch (error) { app.log.warn({ error }, 'accounts sweep failed') }
    }
    accountsSweep()
    const accountsTimer = setInterval(accountsSweep, 24 * 60 * 60 * 1000)
    accountsTimer.unref()
    app.addHook('onClose', async () => clearInterval(accountsTimer))
    const cleanupTimer = setInterval(() => { void generatedCleanup.run() }, 6 * 60 * 60 * 1000)
    cleanupTimer.unref()
    app.addHook('onClose', async () => clearInterval(cleanupTimer))
    queueMicrotask(() => { void generatedCleanup.run() })
  }

  app.post<{ Body: { name?: string; dataBase64?: string; agentId?: string; conversationId?: string; mimeType?: string } }>(
    REST.uploads,
    { bodyLimit: 64 * 1024 * 1024 }, // до 64 МБ на вложение (base64 раздувает ~на треть)
    async (req, reply): Promise<UploadInfo> => {
      const { name, dataBase64, agentId: requestedAgentId, conversationId, mimeType } = req.body ?? {}
      const userId = uid(req)
      if (conversationId && !db.getConversation(userId, conversationId)) return reply.code(404).send({ error: 'conversation not found' }) as never
      const resolvedMachine = !requestedAgentId && conversationId
        ? db.resolveConversationMachine(userId, conversationId, { isOnline: (id) => agentRegistry.isOnline(id) })
        : null
      const agentId = requestedAgentId ?? (resolvedMachine?.source === 'disabled' ? undefined : resolvedMachine?.agentId ?? undefined)
      if (!dataBase64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64) || dataBase64.length % 4 !== 0) return reply.code(400).send({ error: 'invalid data' }) as never
      const bytes = Buffer.from(dataBase64, 'base64')
      if (bytes.byteLength > 32 * 1024 * 1024) return reply.code(413).send({ error: 'too large' }) as never
      const uploadName = name ?? 'file'
      const safeMime = typeof mimeType === 'string' && /^[a-z]+\/[a-z0-9.+-]+$/i.test(mimeType) ? mimeType : 'application/octet-stream'
      let managed: Awaited<ReturnType<typeof managedChatStorage>> = null
      if (conversationId) {
        try {
          managed = await managedChatStorage(userId, conversationId)
        } catch (error) {
          return reply.code(503).send({ error: error instanceof Error ? error.message : String(error) }) as never
        }
      }
      if (managed && requestedAgentId && requestedAgentId !== managed.binding.machineId) {
        return reply.code(409).send({ error: 'Разговор привязан к другой машине хранения' }) as never
      }
      const writeAgentId = managed?.binding.machineId ?? agentId
      if (writeAgentId) {
        if (!db.listAgents(userId).some((agent) => agent.id === writeAgentId)) {
          return reply.code(404).send({ error: 'machine not found' }) as never
        }
        try {
          const root = managed ? managed.storage.rootPath : (await agentRegistry.fsList(writeAgentId, '')).root
          const directory = managed?.attachments ?? machineUploadDir(root)
          const target = managed
            ? machineManagedFilePath(directory, randomBytes(16).toString('hex'), uploadName)
            : machineUploadPath(root, randomBytes(16).toString('hex'), uploadName)
          await agentRegistry.fsMkdir(writeAgentId, directory)
          await agentRegistry.fsWrite(writeAgentId, target, dataBase64)
          const rec = uploads.saveRemote(uploadName, target, writeAgentId, bytes.byteLength, safeMime)
          return { id: rec.id, name: rec.name, path: rec.path, mimeType: rec.mimeType, size: rec.size, agentId: rec.agentId }
        } catch (err) {
          return reply.code(503).send({ error: err instanceof Error ? err.message : String(err) }) as never
        }
      }
      const rec = uploads.save(uploadName, bytes, safeMime)
      return { id: rec.id, name: rec.name, path: rec.path, mimeType: rec.mimeType, size: rec.size }
    }
  )

  app.post<{ Body: ImageRetouchRequest }>(
    REST.imageRetouch,
    { bodyLimit: 2 * 1024 * 1024 },
    async (req, reply): Promise<ImageRetouchResult> => {
      const userId = uid(req)
      const body = req.body
      if (!body || !db.getConversation(userId, body.conversationId)) return reply.code(404).send({ error: 'Разговор не найден' }) as never
      if (!body.prompt?.trim() || body.prompt.length > 4000) return reply.code(400).send({ error: 'Введите описание ретуши длиной до 4000 символов' }) as never
      const historyFiles = db.listMessages(userId, body.conversationId).flatMap((message) => message.attachments ?? [])
      const allowed = (file: MessageAttachment): boolean => {
        if (historyFiles.some((known) => known.path === file.path && known.agentId === file.agentId)) return true
        const upload = file.uploadId ? uploads.get(file.uploadId) : undefined
        return Boolean(upload && upload.path === file.path && upload.agentId === file.agentId)
      }
      if (!allowed(body.source) || (body.references ?? []).some((file) => !allowed(file))) return reply.code(403).send({ error: 'Изображение не принадлежит этому разговору' }) as never

      const readAttachment = async (file: MessageAttachment): Promise<Buffer> => {
        if (file.agentId) {
          if (!db.listAgents(userId).some((agent) => agent.id === file.agentId)) throw new Error('Машина-источник недоступна')
          const result = await agentRegistry.fsRead(file.agentId, file.path)
          if (!result.dataBase64) throw new Error(`Файл ${file.name} не найден на машине-источнике`)
          return Buffer.from(result.dataBase64, 'base64')
        }
        if (runnerFs) {
          const result = await runnerFs.readFile(userId, file.path)
          if (result?.dataBase64) return Buffer.from(result.dataBase64, 'base64')
        }
        const settings = db.getSettings(userId)
        const local = readUserFile(file.path, [profileHome(userId), join(opts.config.dataDir, 'uploads'), ...(settings.workdir ? [settings.workdir] : [])])
        if (!local.ok) throw new Error(`Файл ${file.name} не найден на сервере`)
        return Buffer.from(local.file.dataBase64, 'base64')
      }

      try {
        const managed = await managedChatStorage(userId, body.conversationId)
        const executeRetouch = async (): Promise<ImageRetouchResult> => {
        const original = await readAttachment(body.source)
        const references = await Promise.all((body.references ?? []).map(readAttachment))
        const generator = opts.imageRetouchGenerator ?? llmRetouchGenerator({
          client: codex,
          userId,
          model: db.getSettings(userId).codexModel,
          readGenerated: async (path) => {
            if (runnerFs) return runnerFs.readFile(userId, path)
            const local = readUserFile(path, [profileHome(userId)])
            return local.ok ? local.file : null
          }
        })
        const processed = await processImageRetouch({ original, selection: body.selection, prompt: body.prompt, references, generate: generator })
        const name = `retouch-${randomBytes(12).toString('hex')}.png`
        const outputAgentId = managed?.binding.machineId ?? body.source.agentId
        const path = await saveRetouchedImage({
          image: processed.image,
          name,
          localRoot: profileHome(userId),
          ...(managed ? { targetDir: managed.generated } : {}),
          ...(outputAgentId ? {
            agentId: outputAgentId,
            remote: {
              root: async () => (await agentRegistry.fsList(outputAgentId, '')).root,
              mkdir: (dir) => agentRegistry.fsMkdir(outputAgentId, dir),
              write: (target, data) => agentRegistry.fsWrite(outputAgentId, target, data)
            }
          } : {})
        })
        const image: MessageAttachment = {
          path,
          name,
          mimeType: 'image/png',
          size: processed.image.byteLength,
          ...(outputAgentId ? { agentId: outputAgentId } : {}),
          retouch: { source: body.source, selection: body.selection, prompt: body.prompt.trim(), ...(body.references?.length ? { references: body.references } : {}) }
        }
        const text = imageBlock({ path, ...(image.agentId ? { agentId: image.agentId } : {}), caption: `Локальная ретушь: ${body.prompt.trim()}` })
        const now = new Date()
        const message = db.addMessage(userId, body.conversationId, 'ai', text, now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), 'codex', undefined, image.agentId ?? null, [image])
        return { message, image }
        }
        return managed
          ? await withGeneratedFileLease(managed.binding.machineId, body.source.path, executeRetouch)
          : await executeRetouch()
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        return reply.code(422).send({ error: message }) as never
      }
    }
  )

  app.post<{ Body: ArtifactPublishRequest }>(
    REST.artifactPublish,
    async (req, reply): Promise<ArtifactPublishResult> => {
      const userId = uid(req)
      const body = req.body
      if (!body || !db.getConversation(userId, body.conversationId)) return reply.code(404).send({ error: 'Разговор не найден' }) as never
      try {
        const managed = await managedChatStorage(userId, body.conversationId)
        if (!managed) return reply.code(409).send({ error: 'Публикация доступна только для разговора с MachineStorage' }) as never
        if (body.source.agentId !== managed.binding.machineId) return reply.code(403).send({ error: 'Файл относится к другой машине' }) as never
        const separator = managed.generated.includes('\\') && !managed.generated.includes('/') ? '\\' : '/'
        const sourceParent = body.source.path.slice(0, Math.max(body.source.path.lastIndexOf('/'), body.source.path.lastIndexOf('\\')))
        if (sourceParent !== managed.generated) return reply.code(403).send({ error: 'Публиковать можно только непосредственный файл из .generated этого разговора' }) as never
        const known = db.listMessages(userId, body.conversationId).some((message) =>
          (message.attachments ?? []).some((file) => file.path === body.source.path && file.agentId === body.source.agentId)
          || parseImages(message.text).images.some((image) => image.path === body.source.path && image.agentId === body.source.agentId)
        )
        if (!known) return reply.code(403).send({ error: 'Файл не принадлежит этому разговору' }) as never
        return await withGeneratedFileLease(managed.binding.machineId, body.source.path, async () => {
        const source = await agentRegistry.fsRead(managed.binding.machineId, body.source.path)
        if (!source.dataBase64) throw new Error('Временный файл не найден')
        await agentRegistry.fsMkdir(managed.binding.machineId, managed.artifacts)
        const rawName = (body.name || body.source.name || 'artifact').split(/[/\\]/).at(-1) || 'artifact'
        const safeName = rawName.replace(/[^\p{L}\p{N}._ -]+/gu, '_').replace(/^\.+/, '') || `artifact${extname(body.source.name)}`
        const listing = await agentRegistry.fsList(managed.binding.machineId, managed.artifacts)
        const occupied = new Set((listing.entries ?? []).map((entry) => entry.name))
        let finalName = safeName
        if (!body.overwrite && occupied.has(finalName)) {
          const dot = finalName.lastIndexOf('.')
          const stem = dot > 0 ? finalName.slice(0, dot) : finalName
          const extension = dot > 0 ? finalName.slice(dot) : ''
          let suffix = 2
          while (occupied.has(`${stem}-${suffix}${extension}`)) suffix++
          finalName = `${stem}-${suffix}${extension}`
        }
        const target = `${managed.artifacts}${separator}${finalName}`
        await agentRegistry.fsWrite(managed.binding.machineId, target, source.dataBase64)
        const artifact: MessageAttachment = {
          path: target,
          name: finalName,
          mimeType: body.source.mimeType,
          size: body.source.size,
          agentId: managed.binding.machineId
        }
        const text = imageBlock({ path: target, agentId: managed.binding.machineId, caption: `Опубликованный результат: ${finalName}` })
        const now = new Date()
        const message = db.addMessage(userId, body.conversationId, 'ai', text, now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), 'codex', undefined, managed.binding.machineId, [artifact])
        return { artifact, message }
        })
      } catch (error) {
        return reply.code(422).send({ error: error instanceof Error ? error.message : String(error) }) as never
      }
    }
  )

  // Публичные совместимые маршруты проксируют физический каталог TTS Runner.
  app.get(REST.ttsVoices, async () => ttsClient.listVoices())
  app.delete<{ Params: { id: string } }>('/api/tts/voices/:id', async (req, reply) => {
    if (!opts.ttsClient && (!opts.config.ttsRunnerUrl || !opts.config.ttsRunnerToken)) return { ok: true }
    if (!ttsClient.deleteVoice) return reply.code(503).send({ error: 'TTS runner unavailable' })
    await ttsClient.deleteVoice(req.params.id)
    return { ok: true }
  })
  app.get(REST.ttsCatalog, async (): Promise<TtsVoiceCatalog> => {
    const voices = await ttsClient.listVoices()
    return { downloadable: false, voices: voices.map((voice) => ({ ...voice, installed: true })) }
  })

  // Один реестр ходов LLM на процесс: ходы переживают обрыв WS-соединения,
  // ответ сохраняется в БД сервером, клиенты получают события broadcast'ом.
  const turnManager = createTurnManager({
    db,
    claude,
    codex,
    engineClient: (engine) => new RemoteLlmClient({ kind: engine.kind, baseUrl: engine.baseUrl, ...(engine.token ? { token: engine.token } : {}) }),
    kb,
    kbUsage,
    kbToolEnabled: opts.config.kbToolEnabled,
    kbTool: kbToolBroker,
    resolveUpload: async (id) => {
      const upload = uploads.get(id)
      if (!upload) return null
      if (!upload.agentId) return upload.path
      try {
        const file = await agentRegistry.fsRead(upload.agentId, upload.path)
        if (!file.dataBase64) return null
        return { serverPath: upload.path, runnerName: upload.name, dataBase64: file.dataBase64, preserveServerPath: true }
      } catch {
        return null
      }
    },
    agents: {
      isOnline: (id) => agentRegistry.isOnline(id),
      nameOf: (id) => agentRegistry.nameOf(id),
      policyOf: (id) => agentRegistry.policyOf(id),
      fsList: (id, path) => agentRegistry.fsList(id, path),
      fsRead: (id, path) => agentRegistry.fsRead(id, path),
      fsMkdir: (id, path) => agentRegistry.fsMkdir(id, path),
      fsWrite: (id, path, data) => agentRegistry.fsWrite(id, path, data)
    },
    readServerFile: async (userId, path) => {
      if (runnerFs) return runnerFs.readFile(userId, path)
      const settings = db.getSettings(userId)
      const roots = [
        ensureCliProfile(opts.config.dataDir, userId).home,
        join(opts.config.dataDir, 'uploads'),
        ...(settings.workdir ? [settings.workdir] : [])
      ]
      const res = readUserFile(path, roots)
      return res.ok ? res.file : null
    },
    // MCP для исполнителя должен смотреть либо на loopback dev-сервера, либо на публичную базу из VC_MCP_PUBLIC_BASE.
    mcpBaseUrl: remoteBashMcpBaseUrl,
    kbMcpBaseUrl,
    previewMcpBaseUrl,
    consoleMcpBaseUrl,
    makeMcpBaseUrl,
    makeHub,
    makeContext: (id) => makeWorkspaces.promptContext(id),
    previewTool: previewToolBroker,
    remoteFileTool: remoteFileBroker,
    onAuthError: (userId, provider, message) => { authStatus.reportRunError(userId, provider, message) }
  })

  // CI-раннер (Авто-подготовка окружения для таска): процесс-глобальный менеджер
  // ранов. Исполнитель команд — поверх потокового exec машины. Хуки модели/фикса
  // подключаются здесь же (Срез 4).
  const ciExecutor = opts.ciExecutor ?? new AgentCommandExecutor(agentRegistry)
  const ciModelHooks = createCiModelHooks({
    db,
    claude,
    codex,
    engineClient: (engine) => new RemoteLlmClient({ kind: engine.kind, baseUrl: engine.baseUrl, ...(engine.token ? { token: engine.token } : {}) }),
    mcpBaseUrl: remoteBashMcpBaseUrl,
    ciMcpBaseUrl: ciCommandsMcpBaseUrl,
    agentNameOf: (agentId) => agentRegistry.nameOf(agentId),
    // Шагу «Актуализировать базу знаний» нужен диф рабочей копии: его собирает
    // сервер тем же исполнителем, что и команды слотов.
    executor: ciExecutor,
    // База знаний в ходах рана: авто-контекст по теме задачи и mcp__kb__*.
    // Режим берётся из настройки проекта и фиксируется в ране.
    kb,
    kbUsage,
    kbToolEnabled: opts.config.kbToolEnabled,
    kbTool: kbToolBroker,
    kbMcpBaseUrl
  })
  // Вопросы модели дублируются в связанный чат задачи обычными сообщениями:
  // UI разбирает блок ```questions тем же парсером, что и вопросы в чате.
  const ciChatTime = (): string => {
    const d = new Date()
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  const launchQaPreparation = (args: { userId: string; projectId: string; taskId: string; branch: string; commitSha: string; runId?: string }, retry = false): boolean => {
    const { userId, projectId, taskId, branch, commitSha } = args
    const preparation = db.startQaPreparationRun(projectId, taskId, branch, commitSha, retry)
    if (!preparation) return false
    const task = db.getCiTask(userId, projectId, taskId)
    const existing = db.getQaTaskState(userId, projectId, taskId)?.criteria.filter((criterion) => criterion.active) ?? []
    const development = args.runId ? db.getCiRun(userId, args.runId) : null
    const basePrompt = `Ты формируешь финальные структурированные сценарии ручного QA. Не запускай агентов или инструменты, не делегируй работу, не переходи в режим ожидания и не описывай свои действия. Ответь за один ход ТОЛЬКО JSON-массивом без Markdown и пояснений. Каждый объект обязан содержать строковые поля title, description, preconditions, steps, testData, expectedResult, boolean required и testType: manual|mixed|not_testable_in_app. title, steps и expectedResult должны быть непустыми.\n\nЗадача: ${task?.title ?? ''}\nОписание: ${task?.description ?? ''}\nAcceptance criteria: ${task?.acceptanceCriteria ?? ''}\nFeature branch: ${branch}\nCommit SHA: ${commitSha}\nАвтотесты: ${(development?.steps ?? []).map((step) => `${step.title}: ${step.status}`).join('; ')}\nУже активные сценарии (не дублировать): ${existing.map((criterion) => criterion.title).join('; ')}`
    const sendAttempt = (attempt: number, correction?: string): void => {
      const prompt = correction ? `${basePrompt}\n\nПредыдущий ответ отклонён: ${correction}. Исправь ошибку и верни только валидный JSON-массив установленной схемы.` : basePrompt
      claude.send({ userId, prompt, sessionId: null, model: 'sonnet', executionDisabled: true }, {
        onDelta: (chunk) => db.appendQaPreparationLog(preparation.id, chunk),
        onSession: () => {},
        onDone: (text) => {
          try {
            const scenarios = parseQaPreparationResponse(text)
            db.recordQaPreparationAttempt(preparation.id, attempt, text, null)
            const existingTitles = new Set(existing.map((criterion) => criterion.title.trim().toLocaleLowerCase()))
            for (const scenario of scenarios) {
              if (existingTitles.has(scenario.title.toLocaleLowerCase())) continue
              db.createAcceptanceCriterion(userId, projectId, taskId, scenario)
              existingTitles.add(scenario.title.toLocaleLowerCase())
            }
            db.completeQaPreparation(userId, projectId, taskId)
            const qaState = db.getQaTaskState(userId, projectId, taskId)
            if (!qaState?.activeSession) db.startQaSession(userId, { projectId, taskId, branch, commitSha, testRunId: args.runId ?? preparation.id }, true)
            db.finishQaPreparationRun(preparation.id, 'success')
            boardHub.emit(projectId)
          } catch (cause) {
            const message = cause instanceof Error ? cause.message : String(cause)
            db.recordQaPreparationAttempt(preparation.id, attempt, text, message)
            if (attempt < 2) sendAttempt(attempt + 1, message)
            else { db.finishQaPreparationRun(preparation.id, 'failed', message); boardHub.emit(projectId) }
          }
        },
        onError: (message) => {
          db.recordQaPreparationAttempt(preparation.id, attempt, '', message)
          if (attempt < 2) sendAttempt(attempt + 1, message)
          else { db.finishQaPreparationRun(preparation.id, 'failed', message); boardHub.emit(projectId) }
        }
      })
    }
    sendAttempt(1)
    boardHub.emit(projectId)
    return true
  }

  const parseTaskPreparation = (text: string): DevelopmentReadiness => {
    const raw = text.trim().replace(/^\`\`\`(?:json)?\\s*/i, '').replace(/\\s*\`\`\`$/, '')
    const value = JSON.parse(raw) as unknown
    const issues: string[] = []
    const record = (input: unknown): Record<string, unknown> | null =>
      input !== null && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : null
    const requireString = (input: Record<string, unknown>, key: string, path = key): void => {
      if (typeof input[key] !== 'string') issues.push(`${path} должен быть строкой`)
    }
    const requireBoolean = (input: Record<string, unknown>, key: string, path = key): void => {
      if (typeof input[key] !== 'boolean') issues.push(`${path} должен быть boolean`)
    }
    const requireArray = (input: Record<string, unknown>, key: string, path = key): unknown[] => {
      if (!Array.isArray(input[key])) {
        issues.push(`${path} должен быть массивом`)
        return []
      }
      return input[key]
    }
    const root = record(value)
    if (!root) throw new Error('Модель вернула неполную структуру готовности: корень должен быть JSON-объектом')
    requireString(root, 'functionalRequirements')
    requireString(root, 'acceptanceCriteria')
    requireBoolean(root, 'acceptanceCriteriaConflict')
    const uiImpact = root.uiImpact
    if (uiImpact !== null && !['none', 'existing_components', 'new_components', 'multi_component_flow'].includes(String(uiImpact))) {
      issues.push('uiImpact должен быть null или строкой none|existing_components|new_components|multi_component_flow')
    }
    const testCases = requireArray(root, 'testCases')
    const affectedComponents = requireArray(root, 'affectedComponents')
    for (const [index, item] of testCases.entries()) {
      const testCase = record(item)
      const path = `testCases[${index}]`
      if (!testCase) { issues.push(`${path} должен быть объектом`); continue }
      for (const key of ['id', 'title', 'description', 'preconditions', 'testData', 'steps', 'expectedResult', 'testType', 'notAutomatedReason', 'alternativeManualVerification', 'comments']) {
        requireString(testCase, key, `${path}.${key}`)
      }
      requireBoolean(testCase, 'required', `${path}.required`)
      requireBoolean(testCase, 'automatable', `${path}.automatable`)
      requireArray(testCase, 'automationLinks', `${path}.automationLinks`)
    }
    for (const [index, item] of affectedComponents.entries()) {
      const component = record(item)
      const path = `affectedComponents[${index}]`
      if (!component) { issues.push(`${path} должен быть объектом`); continue }
      // Однозначный список проверок сохраняем без потерь в каноническом объекте.
      if (Array.isArray(component.coverage) && component.coverage.length > 0 && component.coverage.every((entry) => typeof entry === 'string' && entry.trim())) {
        component.coverage = { required: [...component.coverage] }
      }
      for (const key of ['id', 'name', 'exclusionReason', 'alternativeVerification']) requireString(component, key, `${path}.${key}`)
      requireBoolean(component, 'reusable', `${path}.reusable`)
      if (component.storybookStoryId !== null && typeof component.storybookStoryId !== 'string') issues.push(`${path}.storybookStoryId должен быть строкой или null`)
      if (component.coverage !== null && !record(component.coverage)) issues.push(`${path}.coverage должен быть объектом или null`)
    }
    if (root.schemaVersion === 2) {
      requireString(root, 'goal')
      for (const key of ['scope', 'outOfScope', 'businessRules', 'errorsAndEdgeCases', 'uiStates', 'contractChanges', 'dataChanges', 'constraints', 'contradictions']) {
        const items = requireArray(root, key)
        root[key] = items.map((item) => {
          const objectItem = record(item)
          return objectItem && typeof objectItem.text === 'string' && objectItem.text.trim() ? objectItem.text : item
        })
        for (const [index, item] of (root[key] as unknown[]).entries()) {
          if (typeof item !== 'string' || !item.trim()) issues.push(`${key}[${index}] должен быть непустой строкой`)
        }
      }
      for (const key of ['acceptanceCriteriaItems', 'openQuestions', 'decisions', 'assumptions', 'sources']) requireArray(root, key)
      for (const [index, item] of (Array.isArray(root.acceptanceCriteriaItems) ? root.acceptanceCriteriaItems : []).entries()) {
        const criterion = record(item)
        const path = `acceptanceCriteriaItems[${index}]`
        if (!criterion) { issues.push(`${path} должен быть объектом`); continue }
        for (const key of ['id', 'title', 'precondition', 'action', 'observableResult']) requireString(criterion, key, `${path}.${key}`)
      }
      for (const [index, item] of (Array.isArray(root.openQuestions) ? root.openQuestions : []).entries()) {
        const question = record(item)
        const path = `openQuestions[${index}]`
        if (!question) { issues.push(`${path} должен быть объектом`); continue }
        requireString(question, 'questionId', `${path}.questionId`)
        requireString(question, 'text', `${path}.text`)
        requireBoolean(question, 'material', `${path}.material`)
        if (question.answer !== null && typeof question.answer !== 'string') issues.push(`${path}.answer должен быть строкой или null`)
      }
      for (const [index, item] of (Array.isArray(root.decisions) ? root.decisions : []).entries()) {
        const decision = record(item)
        const path = `decisions[${index}]`
        if (!decision) { issues.push(`${path} должен быть объектом`); continue }
        requireString(decision, 'id', `${path}.id`)
        requireString(decision, 'text', `${path}.text`)
        requireString(decision, 'rationale', `${path}.rationale`)
        if (decision.questionId !== undefined && typeof decision.questionId !== 'string') issues.push(`${path}.questionId должен быть строкой`)
      }
      for (const [index, item] of (Array.isArray(root.assumptions) ? root.assumptions : []).entries()) {
        const assumption = record(item)
        const path = `assumptions[${index}]`
        if (!assumption) { issues.push(`${path} должен быть объектом`); continue }
        requireString(assumption, 'id', `${path}.id`)
        requireString(assumption, 'text', `${path}.text`)
        requireString(assumption, 'rationale', `${path}.rationale`)
        requireBoolean(assumption, 'material', `${path}.material`)
      }
      for (const [index, item] of (Array.isArray(root.sources) ? root.sources : []).entries()) {
        const source = record(item)
        const path = `sources[${index}]`
        if (!source) { issues.push(`${path} должен быть объектом`); continue }
        const kindAliases: Record<string, string> = { knowledge_base: 'knowledge', 'knowledge-base': 'knowledge', 'knowledge-base-gap': 'knowledge', 'code-search': 'code' }
        if (typeof source.kind === 'string' && kindAliases[source.kind]) source.kind = kindAliases[source.kind]
        if (typeof source.refs === 'string') source.refs = [source.refs]
        for (const key of ['id', 'kind', 'status', 'summary']) requireString(source, key, `${path}.${key}`)
        if (typeof source.kind === 'string' && !['knowledge', 'hierarchy', 'related_tasks', 'code', 'tests', 'storybook'].includes(source.kind)) issues.push(`${path}.kind имеет недопустимое значение: ${String(source.kind)}`)
        if (typeof source.status === 'string' && !['available', 'absent', 'unavailable'].includes(source.status)) issues.push(`${path}.status имеет недопустимое значение`)
        for (const [refIndex, ref] of requireArray(source, 'refs', `${path}.refs`).entries()) if (typeof ref !== 'string') issues.push(`${path}.refs[${refIndex}] должен быть строкой`)
        requireBoolean(source, 'critical', `${path}.critical`)
      }
    }
    if (issues.length) throw new Error(`Модель вернула неполную структуру готовности: ${issues.slice(0, 12).join('; ')}`)
    return root as unknown as DevelopmentReadiness
  }
  const taskPreparationHandles = new Map<string, { cancel(): void }>()
  // CLI-дети подготовки не должны переживать app.close(): cancel() ставит
  // finished и глушит поздние onDone/onError, которые иначе читают закрытую БД.
  app.addHook('onClose', async () => {
    for (const handle of taskPreparationHandles.values()) handle.cancel()
    taskPreparationHandles.clear()
  })
  const launchTaskPreparation = (userId: string, projectId: string, taskId: string, selection?: import('@voicechat/shared').TaskPreparationLlmSelection): import('@voicechat/shared').TaskPreparationRun => {
    let run = db.activeTaskPreparationRun(userId, projectId, taskId)
    if (!run) {
      const project = db.getProject(userId, projectId)
      if (!project) throw new Error('Проект недоступен')
      const projectLlm = db.getCiLlmConfig('project', projectId) ?? db.ciLlmDefaultsForUser(userId)
      const explicitSelection = Boolean(selection?.machineId)
      const provider = explicitSelection ? selection!.provider : projectLlm.provider
      const model = taskPreparationModel(provider, explicitSelection ? selection!.model : projectLlm.model)
      const llmEngineId = explicitSelection ? selection!.llmEngineId ?? null : projectLlm.llmEngineId ?? null
      const access = db.getUserLlmAccess(userId)
      if (!isProviderAllowed(access, provider)) throw new Error(explicitSelection ? 'model_unavailable: выбранный провайдер недоступен' : `Проектный движок ${provider === 'codex' ? 'Codex' : 'Claude'} недоступен пользователю`)
      if (!isModelAllowedForUser(access, provider, model)) throw new Error(explicitSelection ? 'model_unavailable: выбранная модель недоступна' : `Проектная модель ${provider}:${model} недоступна пользователю`)
      const usable = db.listUsableAgents(userId, projectId)
      const machineId = selection?.machineId ?? db.getUserProjectDefaultMachine(userId, projectId) ?? project.defaultAgentId ?? project.machines.find((candidate) => candidate.canUse !== false && candidate.path.trim())?.agentId ?? ''
      const agent = usable.find((candidate) => candidate.id === machineId)
      const configured = project.machines.find((candidate) => candidate.agentId === machineId && candidate.canUse !== false && candidate.path.trim())
      if (explicitSelection && (!agent || !configured)) throw new Error('unknown_machine: выбранная машина недоступна проекту')
      if (explicitSelection && !agentRegistry.isOnline(machineId)) throw new Error('machine_offline: выбранная машина offline')
      run = db.startTaskPreparationRun(userId, projectId, taskId, {
        machineId: configured?.agentId ?? null,
        machineName: configured?.name ?? agent?.name ?? null,
        llmEngineId,
        provider,
        model
      })
    }
    if (run.status === 'waiting_for_answer' || taskPreparationHandles.has(run.id)) return run
    if (run.status !== 'running' && run.status !== 'queued') return run
    if (run.status === 'running' && run.log) return run
    const task = db.getCiTask(userId, projectId, taskId)
    // Любое продолжение использует снимок попытки, а не текущие настройки проекта.
    const provider: LlmProvider = run.provider ?? 'claude'
    const model = taskPreparationModel(provider, run.model ?? '')
    const llmEngineId = run.llmEngineId ?? null
    const client = provider === 'codex' ? codex : claude
    const project = db.getProject(userId, projectId)
    const configuredMachines = (project?.machines ?? []).filter((machine) => machine.canUse !== false && machine.path.trim())
    const selectedMachine = configuredMachines.find((machine) => machine.agentId === run.machineId) ?? null
    const projectMachines = db.listProjectMachines(projectId)
    const kbToken = randomUUID()
    const kbEnabled = opts.config.kbToolEnabled
    if (kbEnabled) {
      kbToolBroker.register(kbToken, {
        userId,
        conversationId: null,
        projectId,
        turnId: run.id,
        coreReadOnly: true,
        runtimeContext: {
          projectName: project?.name,
          projectGitUrl: project?.gitUrl ?? null,
          llm: { provider, model, engineId: llmEngineId, source: 'project' }
        }
      })
    }
    let toolsClosed = false
    const closePreparationTools = (): void => {
      if (toolsClosed) return
      toolsClosed = true
      if (kbEnabled) kbToolBroker.unregister(kbToken)
    }
    const remote = selectedMachine ? {
      remote: {
        mcpUrl: `${remoteBashMcpBaseUrl}&agent=${encodeURIComponent(selectedMachine.agentId)}&cwd=${encodeURIComponent(selectedMachine.path)}&project=${encodeURIComponent(projectId)}`,
        agentName: selectedMachine.name ?? selectedMachine.agentId,
        projectMachines: projectMachines.filter((machine) => machine.agentId !== selectedMachine.agentId).map((machine) => machine.name)
      }
    } : { executionDisabled: true as const }
    const kbFields = kbEnabled
      ? { kbMcpUrl: `${kbMcpBaseUrl}&turn=${encodeURIComponent(kbToken)}`, kbMode: 'manual' as const }
      : {}
    const machineDiagnostic = selectedMachine
      ? `Машина проекта: «${selectedMachine.name ?? selectedMachine.agentId}»; рабочая директория: ${selectedMachine.path}; статус: ${agentRegistry.isOnline(selectedMachine.agentId) ? 'online' : 'offline (инструменты вернут точную диагностику недоступности)'}.`
      : 'Критичный источник недоступен: в конфигурации проекта нет доступной машины с рабочей директорией.'
    // Чем шла подготовка — первой строкой ленты: без этого причину падения CLI
    // приходится искать в коде подготовки.
    db.setTaskPreparationExecution(run.id, { llmEngineId, provider, model })
    db.appendTaskPreparationLog(run.id, `[система] Движок: ${provider === 'codex' ? 'Codex' : 'Claude'}, модель: ${model}, CLI-профиль: ${userId}\n[система] ${machineDiagnostic}\n`)
    const answeredContext = (run.questions ?? []).filter((question) => question.answer).map((question) => `Вопрос ${question.questionId}: ${question.text}\\nОтвет: ${question.answer}`).join('\\n')
    const researchDirective = `Начни с базы знаний проекта, затем сверяй её с кодом; инструменты подготовки работают только на чтение.

Перед формированием DevelopmentReadiness обязательно выполни контролируемое исследование:
1. Сначала найди тему через mcp__kb__search и прочитай подходящий существующий раздел через mcp__kb__document.
2. Затем через read-only remote-инструменты найди релевантные файлы внутри настроенной рабочей директории проекта и прочитай фактические API-контракты, общие типы, клиентские компоненты и тесты. Код — источник истины при расхождении с БЗ.
3. Не вызывай edit, deploy, package managers, сборки, тесты и любые команды, меняющие файлы, процессы, данные или окружение. Разрешены read/grep/machines и bash только для ls/find/git status/log/diff.
4. Бюджет исследования: не более 12 вызовов инструментов суммарно, не более 8 файлов, не более 24 000 символов полезных выдержек; один вызов — не дольше 120 секунд. Исследуй только рабочую директорию проекта и docs/kb.
5. В sources перечисли только фактически прочитанные источники, с точным refs и status available|absent|unavailable. Конкретную причину недоступности запиши в summary. Подтверждённое расхождение БЗ и кода запиши как закрытое решение в decisions (contradictions оставь только для неразрешённых противоречий) и опирайся на код.
6. Не спрашивай доступ к машине или репозиторию: они определены конфигурацией ниже. Вопрос допустим только после исследования, если критичный источник реально недоступен, требования существенно противоречат друг другу либо нужно продуктовое решение.
7. Если БЗ неполна, не изменяй её сейчас: зафиксируй подтверждённый пробел в финальном блоке kb-gaps для последующего безопасного этапа актуализации.

${machineDiagnostic}`
    const basePrompt = `${researchDirective}

Подготовь подтверждаемый Development Brief в режиме только чтения. Не меняй код и данные. Если есть существенный вопрос, ответ на который меняет продукт, публичный контракт, данные, безопасность, обязательный scope или проверяемость, верни ТОЛЬКО JSON {"question":"текст","material":true}; не принимай такое решение самостоятельно. Иначе верни ТОЛЬКО JSON DevelopmentReadiness schemaVersion=2 со всеми полями: goal, scope, outOfScope, functionalRequirements, businessRules, errorsAndEdgeCases, uiImpact, uiStates, affectedComponents, contractChanges, dataChanges, acceptanceCriteria, acceptanceCriteriaItems (id,title,precondition,action,observableResult), testCases, constraints, contradictions, openQuestions, decisions, assumptions, sources, acceptanceCriteriaConflict. Типы обязательны: functionalRequirements и acceptanceCriteria — строки; uiImpact — строка none|existing_components|new_components|multi_component_flow; acceptanceCriteriaConflict — boolean; scope/outOfScope и остальные списки — массивы. Каждый testCase — объект со строками id, title, description, preconditions, testData, steps, expectedResult, testType, notAutomatedReason, alternativeManualVerification, comments, boolean required, automatable и массивом automationLinks. Каждый affectedComponent — объект со строками id, name, exclusionReason, alternativeVerification, boolean reusable, storybookStoryId string|null и coverage object|null. acceptanceCriteriaItems содержат строковые id,title,precondition,action,observableResult. Строковые списки scope, outOfScope, businessRules, errorsAndEdgeCases, uiStates, contractChanges, dataChanges, constraints и contradictions содержат только непустые строки. Объектные списки: openQuestions — объекты questionId,text,material,answer; decisions — объекты id,text,rationale,questionId; assumptions — объекты id,text,rationale,material; sources — объекты id,kind,status,summary,refs,critical. В sources kind допускает только knowledge|hierarchy|related_tasks|code|tests|storybook, а refs всегда является массивом строк string[]. Не заменяй строки массивами или объектами. Для каждого affectedComponent укажи непустой coverage object. Если Storybook неприменим или отсутствует, storybookStoryId должен быть null, а exclusionReason и alternativeVerification — непустыми и конкретными; coverage перечисляет существующие и обязательные альтернативные проверки. Существенные открытые вопросы и противоречия запрещены. Задача: ${task?.title ?? ''}\\nОписание: ${task?.description ?? ''}\\nКритерии: ${task?.acceptanceCriteria ?? ''}\\n${answeredContext}`
    const ordinaryResponses: string[] = []
    const terminalValidationFailure = (message: string, text: string, recoveryDetail?: string): void => {
      const terminalMessage = recoveryDetail ? `Recovery Development Brief завершился ошибкой: ${recoveryDetail}; исходная диагностика: ${message}` : message
      const readiness = (() => { try { return parseTaskPreparation(text) } catch { return null } })()
      const results = readiness ? developmentReadinessGateResults(readiness) : []
      db.blockTaskPreparationRun(run.id, terminalMessage, results.flatMap((item) => item.status === 'fail' ? item.refs : []), results)
      closePreparationTools()
      preparationRunUpdated(userId, projectId, taskId, run.id)
    }
    const sendRecovery = (reason: string): void => {
      const sourceName = `${provider}:${model}`
      const recoveryName = sourceName
      db.transitionTaskPreparationRun(run.id, 'running', 'brief_generation', 'Аварийное восстановление Development Brief')
      preparationRunUpdated(userId, projectId, taskId, run.id)
      db.appendTaskPreparationEvent(run.id, 'recovery_started', 'brief_generation', `Recovery через зафиксированную проектную пару ${recoveryName}: ${reason}`, { sourceProvider: provider, sourceModel: model, recoveryProvider: provider, recoveryModel: model, reason })
      db.appendTaskPreparationLog(run.id, `[система] Recovery через зафиксированную проектную пару: ${recoveryName}; причина: ${reason}\\n`)
      const recoveryPrompt = `Исправь ТОЛЬКО структуру уже подготовленного Development Brief без повторного исследования и без изменения смысла требований. Верни только один JSON-объект schemaVersion=2.\\n
Диагностика валидатора (точные пути/гейты): ${reason}\\n
Исходный ответ: ${ordinaryResponses[0] ?? ''}\\n
Повторный ответ: ${ordinaryResponses[1] ?? ''}\\n
Строгий контракт DevelopmentReadiness:
schemaVersion: 2; goal, functionalRequirements, acceptanceCriteria — string; scope, outOfScope, businessRules, errorsAndEdgeCases, uiStates, contractChanges, dataChanges, constraints, contradictions — string[]; uiImpact — none|existing_components|new_components|multi_component_flow; acceptanceCriteriaConflict — boolean.
acceptanceCriteriaItems: {id,title,precondition,action,observableResult:string}[].
testCases: {id,title,description,preconditions,testData,steps,expectedResult,testType,notAutomatedReason,alternativeManualVerification,comments:string,required:boolean,automatable:boolean,automationLinks:array}[].
affectedComponents: {id,name,exclusionReason,alternativeVerification:string,reusable:boolean,storybookStoryId:string|null,coverage:object}[]. Для каждого компонента coverage непустой; при storybookStoryId=null обязательны непустые exclusionReason и alternativeVerification.
openQuestions: {questionId:string,text:string,material:boolean,answer:string|null}[]; decisions: {id,text,rationale:string,questionId?:string}[]; assumptions: {id,text,rationale:string,material:boolean}[].
sources: {id:string,kind:knowledge|hierarchy|related_tasks|code|tests|storybook,status:available|absent|unavailable,summary:string,refs:string[],critical:boolean}[].
Сохрани исходные требования. Если диагностика выявляет дефект подготовки, добавь в scope, acceptanceCriteria/acceptanceCriteriaItems и testCases отдельные проверяемые работы: усиление prompt/schema, безопасная нормализация однозначных совместимых значений, регрессионные тесты и актуализация существующего раздела БЗ. Не добавляй новые исследования и не выдумывай источники.`
      const handle = client.send({ userId, prompt: recoveryPrompt, sessionId: null, model, executionDisabled: true }, {
        onDelta: () => {},
        onSession: () => {},
        onDone: (text) => {
          taskPreparationHandles.delete(run.id)
          if (db.getTaskPreparationRun(userId, run.id)?.status !== 'running') return
          try {
            db.transitionTaskPreparationRun(run.id, 'validating', 'readiness_validation', 'Проверка восстановленного Development Brief')
            preparationRunUpdated(userId, projectId, taskId, run.id)
            const readiness = parseTaskPreparation(text)
            const gate = canConfirmDevelopmentReadiness(readiness)
            if (!gate.allowed) throw new Error(`Гейт готовности не пройден: ${gate.reasons.join(', ')}`)
            db.appendTaskPreparationEvent(run.id, 'recovery_completed', 'readiness_validation', `Recovery ${recoveryName} успешно прошёл runtime-валидацию и readiness-гейт`, { sourceProvider: provider, sourceModel: model, recoveryProvider: provider, recoveryModel: model, result: 'success' })
            db.completeTaskPreparationRun(userId, run.id, readiness)
            closePreparationTools()
            preparationRunUpdated(userId, projectId, taskId, run.id)
          } catch (error) {
            const recoveryError = redactPreparationText(error instanceof Error ? error.message : String(error))
            db.appendTaskPreparationEvent(run.id, 'recovery_failed', 'readiness_validation', `Recovery ${recoveryName} отклонён: ${recoveryError}`, { sourceProvider: provider, sourceModel: model, recoveryProvider: provider, recoveryModel: model, result: 'failed', error: recoveryError })
            terminalValidationFailure(reason, text, recoveryError)
          }
        },
        onError: (message) => {
          taskPreparationHandles.delete(run.id)
          if (db.getTaskPreparationRun(userId, run.id)?.status !== 'running') return
          const recoveryError = taskPreparationFailure(provider, userId, message)
          db.appendTaskPreparationEvent(run.id, 'recovery_failed', 'brief_generation', `Recovery ${recoveryName} не выполнен: ${recoveryError}`, { result: 'failed', error: recoveryError })
          terminalValidationFailure(reason, ordinaryResponses[1] ?? '', recoveryError)
        }
      })
      if (handle) taskPreparationHandles.set(run.id, { cancel: () => { closePreparationTools(); handle.cancel() } })
    }
    const sendAttempt = (attempt: number, correction?: string): void => {
      const prompt = correction ? `${basePrompt}\\nПредыдущий ответ отклонён: ${correction}. Верни исправленный JSON.` : basePrompt
      const handle = client.send({ userId, prompt, sessionId: null, model, permissionMode: 'default', readOnlyRemote: true, ...remote, ...kbFields }, {
        onDelta: (chunk) => { db.appendTaskPreparationLog(run.id, chunk); preparationRunDelta(userId, projectId, taskId, run.id) },
        onSession: () => {},
        onDone: (text) => {
          taskPreparationHandles.delete(run.id)
          if (db.getTaskPreparationRun(userId, run.id)?.status !== 'running') return
          ordinaryResponses[attempt - 1] = text
          try {
            const candidate = JSON.parse(text.trim().replace(/^\`\`\`(?:json)?\\s*/i, '').replace(/\\s*\`\`\`$/, '')) as { question?: unknown; material?: unknown }
            if (typeof candidate.question === 'string' && candidate.question.trim()) {
              const question = db.createTaskPreparationQuestion(run.id, candidate.question, candidate.material !== false)
              if (!question) throw new Error('Не удалось сохранить уточняющий вопрос')
              closePreparationTools()
              preparationRunUpdated(userId, projectId, taskId, run.id)
              return
            }
          } catch {
            // Обычный readiness JSON разбирается и диагностируется ниже.
          }
          try {
            db.transitionTaskPreparationRun(run.id, 'validating', 'readiness_validation', 'Проверка Development Brief')
            preparationRunUpdated(userId, projectId, taskId, run.id)
            const readiness = parseTaskPreparation(text)
            const gate = canConfirmDevelopmentReadiness(readiness)
            if (!gate.allowed) throw new Error(`Гейт готовности не пройден: ${gate.reasons.join(', ')}`)
            db.completeTaskPreparationRun(userId, run.id, readiness)
            closePreparationTools()
            preparationRunUpdated(userId, projectId, taskId, run.id)
          } catch (error) {
            const message = redactPreparationText(error instanceof Error ? error.message : String(error))
            if (attempt < 2) {
              db.transitionTaskPreparationRun(run.id, 'running', 'brief_generation', 'Исправление Development Brief после проверки')
              preparationRunUpdated(userId, projectId, taskId, run.id)
              sendAttempt(attempt + 1, message)
            } else if (message.includes('.kind имеет недопустимое значение')) {
              terminalValidationFailure(message, text)
            } else {
              sendRecovery(message)
            }
          }
        },
        onError: (message) => {
          taskPreparationHandles.delete(run.id)
          if (db.getTaskPreparationRun(userId, run.id)?.status !== 'running') return
          if (attempt < 2) sendAttempt(attempt + 1, message)
          else { db.failTaskPreparationRun(run.id, taskPreparationFailure(provider, userId, message)); closePreparationTools(); preparationRunUpdated(userId, projectId, taskId, run.id) }
        }
      })
      if (handle) taskPreparationHandles.set(run.id, { cancel: () => { closePreparationTools(); handle.cancel() } })
    }
    sendAttempt(1)
    preparationRunUpdated(userId, projectId, taskId, run.id)
    return run
  }

  app.get('/api/task-preparation/notifications', async (req) =>
    db.listTaskPreparationNotifications(uid(req))
  )
  app.post<{ Params: { questionId: string } }>('/api/task-preparation/notifications/:questionId/dismiss', async (req, reply) => {
    const current = db.listTaskPreparationNotifications(uid(req)).find((item) => item.questionId === req.params.questionId)
    const dismissed = db.dismissTaskPreparationNotification(uid(req), req.params.questionId)
    if (!dismissed) return reply.code(404).send({ error: 'not found' })
    if (current) notificationHub.emit(current.projectId, uid(req))
    return { dismissed: true }
  })

  app.post<{ Params: { id: string; taskId: string }; Body: Partial<import('@voicechat/shared').TaskPreparationLlmSelection> }>('/api/projects/:id/tasks/:taskId/preparation/run', async (req, reply) => {
    const selection = req.body?.provider && typeof req.body.model === 'string' ? { llmEngineId: req.body.llmEngineId ?? null, provider: req.body.provider, model: req.body.model } : undefined
    try { return launchTaskPreparation(uid(req), req.params.id, req.params.taskId, selection) }
    catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) }) }
  })
  app.get<{ Params: { id: string; taskId: string } }>('/api/projects/:id/tasks/:taskId/preparation/runs', async (req) =>
    db.listTaskPreparationRuns(uid(req), req.params.id, req.params.taskId)
  )
  app.get<{ Params: { runId: string } }>('/api/task-preparation/runs/:runId', async (req, reply) =>
    db.getTaskPreparationRun(uid(req), req.params.runId) ?? reply.code(404).send({ error: 'not found' })
  )
  app.post<{ Params: { questionId: string }; Body: { answer?: string } }>('/api/task-preparation/questions/:questionId/answer', async (req, reply) => {
    try {
      const result = db.answerTaskPreparationQuestion(uid(req), req.params.questionId, req.body?.answer ?? '')
      if (!result) return reply.code(404).send({ error: 'not found' })
      if (result.accepted) {
        const run = db.getTaskPreparationRun(uid(req), result.question.attemptId)
        if (run) launchTaskPreparation(uid(req), run.projectId, run.taskId)
      }
      return result
    } catch (error) {
      return reply.code(400).send({ error: redactPreparationText(error instanceof Error ? error.message : String(error)) })
    }
  })
  app.get<{ Params: { runId: string; format: 'json' | 'md' | 'txt' } }>('/api/task-preparation/runs/:runId/export/:format', async (req, reply) => {
    const run = db.getTaskPreparationRun(uid(req), req.params.runId)
    if (!run) return reply.code(404).send({ error: 'not found' })
    const format = req.params.format
    if (format !== 'json' && format !== 'md' && format !== 'txt') return reply.code(400).send({ error: 'unsupported format' })
    const filename = preparationExportFilename(run.taskKey ?? run.taskId, run.attemptNumber ?? run.attempt, run.createdAt, format)
    reply.header('content-disposition', `attachment; filename="${filename}"`)
    if (format === 'json') {
      reply.type('application/json; charset=utf-8')
      return {
        schemaVersion: 1, taskId: run.taskId, taskKey: run.taskKey, attemptId: run.attemptId,
        attemptNumber: run.attemptNumber, llmEngineId: run.llmEngineId, provider: run.provider, model: run.model, profileId: run.profileId, status: run.status,
        phase: run.phase, createdAt: run.createdAt, startedAt: run.startedAt, finishedAt: run.finishedAt,
        durationMs: run.durationMs, events: run.events, questions: run.questions, readiness: run.readiness,
        gateResults: run.gateResults, gateReasons: run.gateReasons, error: run.error
      }
    }
    const lines = [
      `# Подготовка ${run.taskKey}: попытка ${run.attemptNumber}`, '',
      `- Attempt ID: ${run.attemptId}`, `- Статус: ${run.status}`, `- Фаза: ${run.phase}`,
      `- LLM: ${run.provider ?? 'claude'} · ${run.model || 'не указана'}`, `- Исполнитель: ${run.llmEngineId ?? 'по умолчанию'}`, `- Profile ID: ${run.profileId}`, `- Длительность: ${run.durationMs} мс`, '',
      '## Хронология', '', ...(run.events ?? []).map((event) => `${event.sequence}. [${new Date(event.timestamp).toISOString()}] ${event.type}: ${event.text}`), '',
      '## Вопросы и ответы', '', ...(run.questions ?? []).map((question) => `- ${question.text} — ${question.answer ?? 'без ответа'}`), '',
      '## Readiness-гейты', '', ...(run.gateResults ?? []).map((gate) => `- ${gate.code}: ${gate.status} — ${gate.explanation}`), '',
      '## Development Brief', '', run.readiness ? `\`\`\`json\\n${JSON.stringify(run.readiness, null, 2)}\\n\`\`\`` : 'Итоговый brief отсутствует.'
    ]
    reply.type('text/markdown; charset=utf-8')
    return redactPreparationText(lines.join('\\n'))
  })
  app.delete<{ Params: { runId: string } }>('/api/task-preparation/runs/:runId', async (req, reply) => {
    const run = db.cancelTaskPreparationRun(uid(req), req.params.runId)
    if (!run) return reply.code(404).send({ error: 'not found' })
    try { taskPreparationHandles.get(run.id)?.cancel() } finally { taskPreparationHandles.delete(run.id) }
    preparationRunUpdated(uid(req), run.projectId, run.taskId, run.id)
    return run
  })
  app.post<{ Params: { runId: string }; Body: Partial<import('@voicechat/shared').TaskPreparationLlmSelection> }>('/api/task-preparation/runs/:runId/retry', async (req, reply) => {
    const previous = db.getTaskPreparationRun(uid(req), req.params.runId)
    if (!previous) return reply.code(404).send({ error: 'not found' })
    if (!previous.canRetry) return reply.code(409).send({ error: 'Эту попытку нельзя повторить' })
    const selection = req.body?.provider && typeof req.body.model === 'string' ? { llmEngineId: req.body.llmEngineId ?? null, provider: req.body.provider, model: req.body.model } : undefined
    try { return launchTaskPreparation(uid(req), previous.projectId, previous.taskId, selection) }
    catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) }) }
  })

  const ciRunManager = createCiRunManager({
    db,
    executor: ciExecutor,
    boardChanged: (projectId) => boardHub.emit(projectId),
    // Боевой исполнитель не ждёт reconnect агента; тестовый executor сам задаёт
    // доступность и не зависит от реестра WebSocket.
    isAgentOnline: opts.ciExecutor ? undefined : (agentId) => agentRegistry.isOnline(agentId),
    postToChat: ({ userId, conversationId, text, runId, interactionId }) => {
      try {
        return db.addMessage(userId, conversationId, 'ai', text, ciChatTime(), undefined, { ciInteraction: { runId, interactionId } }).id
      } catch {
        return null
      }
    },
    postAnswerToChat: ({ userId, conversationId, text }) => {
      try {
        db.addMessage(userId, conversationId, 'u1', text, ciChatTime())
      } catch {
        /* чат мог быть удалён — не роняем ответ на вопрос */
      }
    },
    // Резюме законченного рана — обычное AI-сообщение чата; метка `ciRunSummary`
    // связывает его с раном и отличает от ответа хода модели.
    postSummaryToChat: ({ userId, conversationId, text, runId }) => {
      try {
        return db.addMessage(userId, conversationId, 'ai', text, ciChatTime(), undefined, { ciRunSummary: { runId } })
      } catch {
        return null // чат удалён — резюме от этого не падает
      }
    },
    modelWork: ciModelHooks.modelWork,
    modelSummary: ciModelHooks.modelSummary,
    attemptFix: ciModelHooks.attemptFix,
    kbUpdate: opts.ciKbUpdate ?? ciModelHooks.kbUpdate,
    qaPreparation: (args) => { void launchQaPreparation(args) }
  })
  registerCiRoutes(app, db, ciRunManager, agentRegistry, (projectId) => boardHub.emit(projectId))
  const featurePreviews = new FeaturePreviewManager({
    db,
    executor: ciExecutor,
    storePath: join(opts.config.dataDir, 'feature-previews.json'),
    isOnline: (agentId) => agentRegistry.isOnline(agentId),
    platformOf: (agentId) => agentRegistry.platformOf(agentId),
    allowedDirsOf: (agentId) => agentRegistry.policyOf(agentId)?.allowedDirs ?? [],
    fsRead: (agentId, path) => agentRegistry.fsRead(agentId, path),
    fsWrite: (agentId, path, dataBase64) => agentRegistry.fsWrite(agentId, path, dataBase64),
    fsMkdir: (agentId, path) => agentRegistry.fsMkdir(agentId, path),
    fsRename: (agentId, from, to) => agentRegistry.fsRename(agentId, from, to),
    fsDelete: (agentId, path) => agentRegistry.fsDelete(agentId, path),
    closeTunnelsForAgent: (agentId) => agentRegistry.closeTunnelsForTarget(agentId)
  })
  featurePreviewsRef.current = featurePreviews
  registerFeaturePreviewRoutes(app, featurePreviews, db, agentRegistry)
  void featurePreviews.reconcile()
  const releaseManager = new ReleaseManager(db, {
    exec: async (target, command, timeoutMs, onChunk) => {
      let output = ''
      const result = await agentRegistry.execStream(target.agentId, command, timeoutMs, (chunk) => {
        output += chunk
        onChunk?.(chunk)
      })
      return { ...result, output }
    },
    isOnline: (agentId) => agentRegistry.isOnline(agentId),
    prepareKnowledgeBase: async (releaseBranch, target) => {
      const result = await agentRegistry.exec(target.agentId, releaseKnowledgeBaseCommand(target, releaseBranch), 120_000)
      if (result.exitCode !== 0) throw new Error(result.output || 'Release-preflight базы знаний завершился с ошибкой')
    }
  })
  const managedEnvironments = new ManagedEnvironmentResolver(db, releaseManager, (agentId) => agentRegistry.policyOf(agentId)?.allowedDirs ?? [])
  releaseManager.reconcile((release) => {
    const project = db.getProject(release.triggeredBy, release.projectId)
    const agentId = project?.productionAgentId
    const linked = agentId ? project?.machines.some(machine => machine.agentId === agentId) : false
    if (!project || !agentId || !linked || !project.productionDeployCommand || !project.productionHealthCheckCommand || !project.gitUrl) return null
    // requireOnline:false — target resolvable даже если companion-агент прод-машины
    // ещё не переподключился после рестарта; monitorHealth сам дождётся онлайна и
    // корректной версии в пределах health-check бюджета, а не падает мгновенно.
    if(project.productionEnvironmentMode==='managed'){try{return managedEnvironments.resolve(release.triggeredBy,release.projectId,'production',{requireOnline:false}).target}catch{return null}}
    if(!project.productionCheckoutPath)return null
    return { projectId: release.projectId, agentId, path: project.productionCheckoutPath, prepareCheckout: false, gitUrl: project.gitUrl, baseBranch: project.ciBaseBranch || 'main', testCommand: project.testCommand?.trim() || 'npm run typecheck && npm run test', deployCommand: project.productionDeployCommand, healthCheckCommand: project.productionHealthCheckCommand, expectedRepository: project.gitUrl, mode:'legacy' }
  })
  registerReleaseRoutes(app, db, releaseManager, managedEnvironments, agentRegistry)
  const mergeRunManager = new MergeRunManager({ db, executor: ciExecutor, conflictFix: ciModelHooks.conflictFixForMerge, kbUpdate: ciModelHooks.kbUpdateForMerge, isOnline: (id) => agentRegistry.isOnline(id), platformOf: (id) => agentRegistry.platformOf(id), policyOf: (id) => agentRegistry.policyOf(id), fsRead: (id, path) => agentRegistry.fsRead(id, path), fsWrite: (id, path, data) => agentRegistry.fsWrite(id, path, data), fsDelete: (id, path) => agentRegistry.fsDelete(id, path), broadcast: (message, userId) => ciRunManager.publish(message, userId), boardChanged: (id) => boardHub.emit(id), repositoriesChanged: (projectId, taskId) => boardHub.emitTaskRepositories({ projectId, taskId }) })
  registerProjectRoutes(app, db, boardHub, { kb, toolEnabled: opts.config.kbToolEnabled }, ciRunManager, agentRegistry, mergeRunManager, (userId, projectId, taskId, selection) => launchTaskPreparation(userId, projectId, taskId, selection), (projectId, affectedUserId) => notificationHub.emit(projectId, affectedUserId))
  mergeRunManager.reconcile()
  const componentQaRunner=createComponentQaRunner({db,executor:ciExecutor,boardChanged:(id)=>boardHub.emit(id)})
  const integrationTestRunner=createIntegrationTestRunner({db,executor:ciExecutor,boardChanged:(id)=>boardHub.emit(id)})
  registerQaRoutes(app, db, uploads, ciRunManager, (args) => launchQaPreparation(args, true),(runId,userId)=>componentQaRunner.launch(runId,userId),(runId)=>componentQaRunner.cancel(runId),(runId,userId)=>integrationTestRunner.launch(runId,userId),(runId)=>integrationTestRunner.cancel(runId),(id)=>boardHub.emit(id))

  // Раны предыдущего процесса живут только в его памяти: после рестарта они
  // навсегда остались бы «running» и блокировали карточку задачи.
  const interrupted = db.failInterruptedCiRuns()
  if (interrupted.length) app.log.warn({ runs: interrupted.map((r) => r.id) }, 'ci: прерванные раны закрыты как failed')
  const interruptedPreparation = db.failInterruptedTaskPreparationRuns()
  if (interruptedPreparation.length) app.log.warn({ runs: interruptedPreparation }, 'task preparation: прерванные раны закрыты как failed')
  const interruptedQa = db.failInterruptedQaPreparationRuns()
  if (interruptedQa.length) app.log.warn({ runs: interruptedQa }, 'qa preparation: прерванные раны закрыты как failed')
  const interruptedQaStages = db.failInterruptedQaStageRuns()
  if (interruptedQaStages.length) app.log.warn({ runs: interruptedQaStages }, 'qa stages: прерванные раны закрыты как interrupted')
  const interruptedComponentQa=db.failInterruptedComponentQaRuns()
  if (interruptedComponentQa.length) app.log.warn({runs:interruptedComponentQa},'component QA: прерванные раны закрыты как blocked infrastructure')
  const interruptedIntegrationTests=db.failInterruptedIntegrationTestRuns()
  if(interruptedIntegrationTests.length)app.log.warn({runs:interruptedIntegrationTests},'integration tests: прерванные раны закрыты как blocked infrastructure')

  // Плановая остановка (деплой/SIGTERM → app.close()): сохранить частичные
  // ответы активных ходов, чтобы рестарт контейнера не терял набранный текст.
  app.addHook('onClose', async () => {
    turnManager.flushInterrupted()
  })

  const makeHandlers = (user: SessionUser): WsHandlers =>
    createSession({
      db,
      turns: turnManager,
      user,
      sttEngine,
      sttClient,
      getWhisperModel: machineWhisperModel,
      ttsClient,
      diarization,
      capabilities,
      modelDownload,
      agentsFeed: {
        // Список машин — только этого пользователя (изоляция).
        list: () => {
          const online = agentRegistry.onlineIds()
          return db.listAgents(user.name).map((a) => ({
            ...a,
            online: online.has(a.id),
            version: agentRegistry.versionOf(a.id),
            telemetry: agentRegistry.telemetryOf(a.id),
            imageHost: agentRegistry.imageHostOf(a.id)
          }))
        },
        subscribe: (cb) => agentRegistry.onChange(cb)
      },
      ...(runnerFs
        ? {
            observerTail: {
              watchCc: (userId, slug, id, onItems) => runnerFs.watchCc(userId, slug, id, onItems),
              watchCx: (userId, id, onItems) => runnerFs.watchCx(userId, id, onItems)
            }
          }
        : {}),
      pty: {
        start: (agentId, ptyId, cols, rows, cwd, emit) =>
          agentRegistry.ptyStart(agentId, ptyId, cols, rows, cwd, emit),
        input: (ptyId, data) => agentRegistry.ptyInput(ptyId, data),
        resize: (ptyId, cols, rows) => agentRegistry.ptyResize(ptyId, cols, rows),
        detach: (ptyId) => agentRegistry.ptyDetach(ptyId),
        kill: (ptyId) => agentRegistry.ptyKill(ptyId)
      },
      // Живая канбан-доска: чтение снапшота (с проверкой членства) + подписка на изменения.
      board: {
        getBoard: (projectId, includeCompleted) => db.getBoard(user.name, projectId, { includeCompleted }),
        subscribe: (cb) => boardHub.onChange(cb),
        subscribePreparationRuns: (cb) => boardHub.onPreparationRunChange(cb),
        subscribeTaskRepositories: (cb) => boardHub.onTaskRepositoriesChange(cb)
      },
      preparationNotifications: {
        canAccess: (projectId) => db.getProject(user.name, projectId) !== null,
        subscribe: (cb) => notificationHub.onChange(cb)
      },
      ci: ciRunManager,
      kbUsage,
      authStatus,
      preview: {
        subscribe: (userId, sink) => previewRelay.subscribe(userId, sink),
        resolve: (userId, requestId, outcome) => previewRelay.resolve(userId, requestId, outcome)
      },
      make: { subscribe: (userId, sink) => makeHub.subscribe(userId, sink) }
    })

  await app.register(async (scoped) => {
    scoped.get('/ws', { websocket: true }, (socket, request) => {
      // Тестовый оверрайд обработчиков — без аутентификации.
      if (opts.createWsHandlers) {
        attachWs(socket, opts.createWsHandlers())
        return
      }
      // Аутентификация WS: токен в query (?token=…). Нет/неверный/заблокирован → закрываем.
      // Токен в query (desktop/старые клиенты) либо cookie-сессия web (п.5): браузер шлёт cookie при upgrade сам.
      const token = (request.query as { token?: string } | undefined)?.token ?? cookieToken(request.headers.cookie)
      const user = resolveActiveUser(db, token, sessionSecret)
      if (!user) {
        socket.close()
        return
      }
      attachWs(socket, makeHandlers(user))
    })
    scoped.get('/agent', { websocket: true }, (socket) => {
      attachAgentWs(socket, db, agentRegistry)
    })
  })

  // Два независимых frontend build раздаются тем же сервером и используют общий
  // backend. Recorder регистрируется первым под собственным prefix, чтобы его index
  // и assets никогда не попадали в SPA-fallback основного ChatAI.
  if (opts.config.webDir && existsSync(opts.config.webDir)) {
    const webDir = opts.config.webDir
    const recorderDir =
      opts.config.webRecorderDir && existsSync(opts.config.webRecorderDir)
        ? opts.config.webRecorderDir
        : null
    const { default: fastifyStatic } = await import('@fastify/static')
    if (recorderDir) {
      await app.register(fastifyStatic, {
        root: recorderDir,
        prefix: '/web-recorder/',
        wildcard: false,
        decorateReply: false
      })
    }
    await app.register(fastifyStatic, { root: webDir, wildcard: false })
    // SPA-fallback относится только к ChatAI. Отсутствующий recorder-артефакт
    // должен дать 404, а не маскироваться index.html другого приложения.
    app.setNotFoundHandler((req, reply) => {
      const url = req.url.split('?')[0]
      if (
        req.method === 'GET' &&
        !url.startsWith('/api') &&
        !url.startsWith('/ws') &&
        !url.startsWith('/agent') &&
        !url.startsWith('/web-recorder')
      ) {
        return reply.type('text/html').sendFile('index.html')
      }
      return reply.code(404).send({ error: 'not found' })
    })
  }

  app.addHook('onClose', async () => {
    if (!opts.db) db.close() // закрываем только созданную нами БД
  })

  return app
}
