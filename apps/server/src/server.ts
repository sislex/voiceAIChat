// Сборка Fastify-приложения (HTTP + WebSocket). Экспортируется отдельно от запуска,
// чтобы тестировать через fastify.inject / ws-клиент.

import { mkdirSync, existsSync, statSync, readdirSync, rmSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import { ciToolOutputLimits, REST, clampModel, firstAllowedProvider, isProviderAllowed, type AcceptanceCriterionSnapshot, type HealthResponse, type SttStatus, type WhisperModel } from '@voicechat/shared'
import type { ServerConfig } from './config.js'
import { attachWs, type WsHandlers } from './ws.js'
import { VoiceChatDb } from './db/database.js'
import { registerRest } from './routes/rest.js'
import { registerPreviewProxy } from './routes/previewProxy.js'
import { registerAgentRoutes } from './routes/agents.js'
import { registerAdminRoutes } from './routes/admin.js'
import { registerProjectRoutes } from './routes/projects.js'
import { registerQaRoutes } from './routes/qa.js'
import { registerCiRoutes } from './routes/ci.js'
import { registerFeaturePreviewRoutes } from './routes/featurePreview.js'
import { registerReleaseRoutes } from './routes/releases.js'
import { ReleaseManager, releaseKnowledgeBaseCommand } from './releases/releaseManager.js'
import { FeaturePreviewManager } from './preview/manager.js'
import { createCiRunManager } from './ci/runManager.js'
import { AgentCommandExecutor } from './ci/executor.js'
import { MergeRunManager } from './merge/runManager.js'
import { createCiModelHooks } from './ci/modelHooks.js'
import { registerCiCommandsMcp, CI_COMMANDS_MCP_PATH } from './ci/ciCommandsMcp.js'
import type { CommandExecutor, CiKbUpdateHook } from './ci/types.js'
import { BoardHub } from './projects/boardHub.js'
import { registerAuth, resolveUser, uid } from './users/auth.js'
import { loadOrCreateSecret } from './users/accounts.js'
import type { SessionUser } from '@voicechat/shared'
import { AgentRegistry } from './agents/registry.js'
import { attachAgentWs } from './agents/wsAgent.js'
import { registerRemoteBashMcp, REMOTE_BASH_MCP_PATH } from './mcp/remoteBashMcp.js'
import { buildPublicMcpUrl } from './mcp/publicBase.js'
import { createSession } from './session.js'
import { createTurnManager } from './turns.js'
import { RemoteLlmClient } from './llm/remoteClient.js'
import { RunnerFsClient } from './llm/runnerFsClient.js'
import { PromptSuggester } from './prompt/suggester.js'
// Локальные spawn-реализации CLI живут в отдельном воркспейсе исполнителя
// (apps/llm-runner), а buildServer здесь выбирает между ними и HTTP-клиентом
// RemoteLlmClient по конфигу окружения.
import { ClaudeCli, CodexCli, ensureCliProfile } from '@voicechat/llm-runner/cli'
import type { LlmClient } from './claude/types.js'
import { WhisperEngine } from './stt/whisperEngine.js'
import { isModelPresent, listModels, modelPath } from './stt/models.js'
import type { SttEngine } from './stt/types.js'
import { StubDiarizationEngine } from './diarization/stubDiarization.js'
import { downloadModel } from './stt/download.js'
import { ModelDownloadManager } from './stt/downloadManager.js'
import { UploadStore, machineUploadDir, machineUploadPath } from './uploads.js'
import type { UploadInfo } from '@voicechat/shared'
import { PiperTtsEngine } from './tts/piperTts.js'
import { SayTtsEngine } from './tts/sayTts.js'
import { piperCatalog } from './tts/piperCatalog.js'
import { downloadPiperVoice } from './tts/voiceDownload.js'
import type { TtsEngine } from './tts/types.js'
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
import { readUserFile } from './serverFiles.js'
import { UnixDeployClient, type DeployTrigger } from './routes/admin.js'

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
  /** STT-движок (для тестов — мок). По умолчанию WhisperEngine из config. */
  sttEngine?: SttEngine
  /** TTS-движок (для тестов — мок). По умолчанию Piper/say из config. */
  ttsEngine?: TtsEngine
  /** Переопределение обработчиков WS (для тестов). Иначе — реальная сессия. */
  createWsHandlers?: () => WsHandlers
  /** Секрет подписи токенов сессии (для тестов). Иначе — из dataDir/эфемерный. */
  sessionSecret?: string
  /** Исполнитель CI-команд (в тестах — мок). По умолчанию поверх AgentRegistry. */
  ciExecutor?: CommandExecutor
  /** Хук шага «Актуализировать базу знаний» (в тестах — мок). По умолчанию — из createCiModelHooks. */
  ciKbUpdate?: CiKbUpdateHook
  /** Запуск host-side деплоя (в тестах — мок). */
  deployTrigger?: DeployTrigger
  /** Relay действий веб-превью (в тестах — свой, чтобы дёргать request напрямую). */
  previewRelay?: PreviewActionRelay
}

function makeTtsEngine(config: ServerConfig): TtsEngine {
  // Piper выбираем, если есть бинарь и хотя бы один ONNX-голос в каталоге.
  // Не завязываемся на конкретный текущий голос: он может смениться (и не должен
  // ронять сервер обратно на say только потому, что старое значение — say-голос).
  const hasVoices = (() => {
    try {
      return readdirSync(config.piperVoicesDir).some((f) => f.endsWith('.onnx'))
    } catch {
      return false
    }
  })()
  if (existsSync(config.piperBin) && hasVoices) {
    return new PiperTtsEngine({
      piperBin: config.piperBin,
      voicesDir: config.piperVoicesDir,
      argsPrefix: config.piperArgsPrefix
    })
  }
  return new SayTtsEngine()
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
  await app.register(fastifyWebsocket)

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
  registerAuth(app, db, sessionSecret)

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

  await registerRest(app, db, opts.config.dataDir, { runnerFs: runnerFs ?? undefined })
  registerPreviewProxy(app)

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
  const agentRegistry = new AgentRegistry()
  await registerAgentRoutes(app, db, agentRegistry, {
    agentApp: opts.config.agentAppPath,
    desktopApp: opts.config.desktopAppPath
  })
  const mcpSecret = randomBytes(16).toString('hex')
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
    (projectId) => db.listProjectMachines(projectId)
  )
  registerCiCommandsMcp(app, mcpSecret)
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
  registerPreviewMcp(app, { secret: mcpSecret, relay: previewRelay })
  const remoteBashMcpBaseUrl = buildPublicMcpUrl(opts.config, REMOTE_BASH_MCP_PATH, mcpSecret)
  const kbMcpBaseUrl = buildPublicMcpUrl(opts.config, KB_MCP_PATH, mcpSecret)
  const ciCommandsMcpBaseUrl = buildPublicMcpUrl(opts.config, CI_COMMANDS_MCP_PATH, mcpSecret)
  const previewMcpBaseUrl = buildPublicMcpUrl(opts.config, PREVIEW_MCP_PATH, mcpSecret)

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
  registerAdminRoutes(app, db, agentRegistry, deployTrigger)

  // Проекты + канбан-доска (членство в проекте) + живой board.update по WS.
  const boardHub = new BoardHub()
  // Модель Whisper — общий машинный ресурс (файлы моделей одни на сервер), поэтому
  // её выбор берём у канонического пользователя (admin), а не per-user.
  const machineWhisperModel = (): WhisperModel => db.getSettings('admin').whisperModel

  app.get(REST.sttStatus, async (): Promise<SttStatus> => {
    const model = machineWhisperModel()
    return { present: isModelPresent(opts.config.modelsDir, model, { existsSync, statSync }), model }
  })

  // Ресурсы контейнера считаем один раз при старте (лимит cgroup стабилен). На их
  // основе — возможности STT/TTS: при нехватке памяти функции блокируются и в
  // настройках (UI), и жёстко в WS-сессии (см. createSession). Порог STT зависит
  // от выбранной модели Whisper, поэтому пересчитываем на каждый вызов (дёшево).
  const resources = detectResources()
  const capabilities = (): SystemCapabilities =>
    computeCapabilities(resources, machineWhisperModel(), undefined, {
      stt: opts.config.minMemSttBytes,
      tts: opts.config.minMemTtsBytes
    })
  app.get(REST.systemCapabilities, async (): Promise<SystemCapabilities> => capabilities())

  // Управление местом: список моделей с размером и удаление файлов.
  app.get(REST.sttModels, async () => listModels(opts.config.modelsDir, { existsSync, statSync }))
  app.delete<{ Params: { model: WhisperModel } }>('/api/stt/models/:model', async (req) => {
    const path = modelPath(opts.config.modelsDir, req.params.model)
    rmSync(path, { force: true })
    rmSync(`${path}.part`, { force: true }) // и недокачанный остаток
    return { ok: true }
  })
  app.delete<{ Params: { id: string } }>('/api/tts/voices/:id', async (req) => {
    const onnx = join(opts.config.piperVoicesDir, `${req.params.id}.onnx`)
    rmSync(onnx, { force: true })
    rmSync(`${onnx}.json`, { force: true }) // конфиг голоса
    return { ok: true }
  })

  const sttEngine =
    opts.sttEngine ??
    new WhisperEngine({
      whisperCli: opts.config.whisperCli,
      modelsDir: opts.config.modelsDir,
      getModel: () => machineWhisperModel()
    })
  const ttsEngine = opts.ttsEngine ?? makeTtsEngine(opts.config)
  const diarization = new StubDiarizationEngine()

  // Один менеджер загрузки модели на процесс: переживает переподключения клиентов,
  // не рестартится при повторном клике, отдаёт текущий прогресс новым соединениям.
  const modelDownload = new ModelDownloadManager((onProgress) =>
    downloadModel(machineWhisperModel(), opts.config.modelsDir, onProgress)
  )

  // Вложения разговора с выбранной машиной постоянно хранятся на ней. Сервер
  // только принимает байты запроса и пересылает агенту; без машины сохраняется
  // совместимый локальный режим.
  const uploads = new UploadStore(join(opts.config.dataDir, 'uploads'))
  app.post<{ Body: { name?: string; dataBase64?: string; agentId?: string; mimeType?: string } }>(
    REST.uploads,
    { bodyLimit: 64 * 1024 * 1024 }, // до 64 МБ на вложение (base64 раздувает ~на треть)
    async (req, reply): Promise<UploadInfo> => {
      const { name, dataBase64, agentId, mimeType } = req.body ?? {}
      if (!dataBase64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64) || dataBase64.length % 4 !== 0) return reply.code(400).send({ error: 'invalid data' }) as never
      const bytes = Buffer.from(dataBase64, 'base64')
      if (bytes.byteLength > 32 * 1024 * 1024) return reply.code(413).send({ error: 'too large' }) as never
      const uploadName = name ?? 'file'
      const safeMime = typeof mimeType === 'string' && /^[a-z]+\/[a-z0-9.+-]+$/i.test(mimeType) ? mimeType : 'application/octet-stream'
      if (agentId) {
        const userId = uid(req)
        if (!db.listAgents(userId).some((agent) => agent.id === agentId)) {
          return reply.code(404).send({ error: 'machine not found' }) as never
        }
        try {
          const root = (await agentRegistry.fsList(agentId, '')).root
          const target = machineUploadPath(root, randomBytes(16).toString('hex'), uploadName)
          await agentRegistry.fsMkdir(agentId, machineUploadDir(root))
          await agentRegistry.fsWrite(agentId, target, dataBase64)
          const rec = uploads.saveRemote(uploadName, target, agentId, bytes.byteLength, safeMime)
          return { id: rec.id, name: rec.name, path: rec.path, mimeType: rec.mimeType, size: rec.size, agentId: rec.agentId }
        } catch (err) {
          return reply.code(503).send({ error: err instanceof Error ? err.message : String(err) }) as never
        }
      }
      const rec = uploads.save(uploadName, bytes, safeMime)
      return { id: rec.id, name: rec.name, path: rec.path, mimeType: rec.mimeType, size: rec.size }
    }
  )

  // TTS: список голосов и каталог для скачивания.
  app.get(REST.ttsVoices, async () => ttsEngine.listVoices())
  app.get(REST.ttsCatalog, async (): Promise<TtsVoiceCatalog> => {
    const downloadable = existsSync(opts.config.piperBin)
    const voices = piperCatalog().map((v) => ({
      ...v,
      installed: existsSync(join(opts.config.piperVoicesDir, `${v.id}.onnx`))
    }))
    return { downloadable, voices }
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
        return { serverPath: upload.path, runnerName: upload.name, dataBase64: file.dataBase64 }
      } catch {
        return null
      }
    },
    agents: {
      isOnline: (id) => agentRegistry.isOnline(id),
      nameOf: (id) => agentRegistry.nameOf(id),
      policyOf: (id) => agentRegistry.policyOf(id),
      fsList: (id, path) => agentRegistry.fsList(id, path),
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
    previewTool: previewToolBroker
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
  registerCiRoutes(app, db, ciRunManager, agentRegistry)
  const featurePreviews = new FeaturePreviewManager({
    db,
    executor: ciExecutor,
    storePath: join(opts.config.dataDir, 'feature-previews.json'),
    isOnline: (agentId) => agentRegistry.isOnline(agentId)
  })
  registerFeaturePreviewRoutes(app, featurePreviews)
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
  releaseManager.reconcile((release) => {
    const project = db.getProject(release.triggeredBy, release.projectId)
    const agentId = project?.productionAgentId
    const linked = agentId ? project?.machines.some(machine => machine.agentId === agentId) : false
    if (!project || !agentId || !linked || !project.productionCheckoutPath || !project.productionDeployCommand || !project.productionHealthCheckCommand || !project.gitUrl) return null
    return { projectId: release.projectId, agentId, path: project.productionCheckoutPath, prepareCheckout: false, gitUrl: project.gitUrl, baseBranch: project.ciBaseBranch || 'main', testCommand: project.testCommand?.trim() || 'npm run typecheck && npm run test', deployCommand: project.productionDeployCommand, healthCheckCommand: project.productionHealthCheckCommand, expectedRepository: project.gitUrl }
  })
  registerReleaseRoutes(app, db, releaseManager)
  const mergeRunManager = new MergeRunManager({ db, executor: ciExecutor, kbUpdate: ciModelHooks.kbUpdateForMerge, isOnline: (id) => agentRegistry.isOnline(id), broadcast: (message, userId) => ciRunManager.publish(message, userId), boardChanged: (id) => boardHub.emit(id) })
  registerProjectRoutes(app, db, boardHub, { kb, toolEnabled: opts.config.kbToolEnabled }, ciRunManager, agentRegistry, mergeRunManager)
  mergeRunManager.reconcile()
  registerQaRoutes(app, db, uploads, ciRunManager, (args) => launchQaPreparation(args, true))

  // Раны предыдущего процесса живут только в его памяти: после рестарта они
  // навсегда остались бы «running» и блокировали карточку задачи.
  const interrupted = db.failInterruptedCiRuns()
  if (interrupted.length) app.log.warn({ runs: interrupted.map((r) => r.id) }, 'ci: прерванные раны закрыты как failed')
  const interruptedQa = db.failInterruptedQaPreparationRuns()
  if (interruptedQa.length) app.log.warn({ runs: interruptedQa }, 'qa preparation: прерванные раны закрыты как failed')

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
      ttsEngine,
      diarization,
      capabilities,
      modelDownload,
      downloadVoice: (id, onProgress) =>
        downloadPiperVoice(id, opts.config.piperVoicesDir, onProgress),
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
        subscribe: (cb) => boardHub.onChange(cb)
      },
      ci: ciRunManager,
      kbUsage,
      preview: {
        subscribe: (userId, sink) => previewRelay.subscribe(userId, sink),
        resolve: (userId, requestId, outcome) => previewRelay.resolve(userId, requestId, outcome)
      }
    })

  await app.register(async (scoped) => {
    scoped.get('/ws', { websocket: true }, (socket, request) => {
      // Тестовый оверрайд обработчиков — без аутентификации.
      if (opts.createWsHandlers) {
        attachWs(socket, opts.createWsHandlers())
        return
      }
      // Аутентификация WS: токен в query (?token=…). Нет/неверный/заблокирован → закрываем.
      const token = (request.query as { token?: string } | undefined)?.token
      const user = resolveUser(db, token, sessionSecret)
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
