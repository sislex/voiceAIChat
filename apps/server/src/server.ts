// Сборка Fastify-приложения (HTTP + WebSocket). Экспортируется отдельно от запуска,
// чтобы тестировать через fastify.inject / ws-клиент.

import { mkdirSync, existsSync, statSync, readdirSync, rmSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import { REST, type HealthResponse, type SttStatus, type WhisperModel } from '@voicechat/shared'
import type { ServerConfig } from './config.js'
import { attachWs, type WsHandlers } from './ws.js'
import { VoiceChatDb } from './db/database.js'
import { registerRest } from './routes/rest.js'
import { registerAgentRoutes } from './routes/agents.js'
import { registerAdminRoutes } from './routes/admin.js'
import { registerProjectRoutes } from './routes/projects.js'
import { registerFeatureRoutes } from './routes/features.js'
import { BoardHub } from './projects/boardHub.js'
import { registerAuth, resolveUser, uid } from './users/auth.js'
import { loadOrCreateSecret } from './users/accounts.js'
import type { SessionUser } from '@voicechat/shared'
import { AgentRegistry } from './agents/registry.js'
import { attachAgentWs } from './agents/wsAgent.js'
import { registerRemoteBashMcp, REMOTE_BASH_MCP_PATH } from './mcp/remoteBashMcp.js'
import { createSession } from './session.js'
import { createTurnManager } from './turns.js'
import { ClaudeCli } from './claude/claudeCli.js'
import { PromptSuggester } from './prompt/suggester.js'
import { CodexCli } from './codex/codexCli.js'
import type { LlmClient } from './claude/types.js'
import { WhisperEngine } from './stt/whisperEngine.js'
import { isModelPresent, listModels, modelPath } from './stt/models.js'
import type { SttEngine } from './stt/types.js'
import { StubDiarizationEngine } from './diarization/stubDiarization.js'
import { downloadModel } from './stt/download.js'
import { ModelDownloadManager } from './stt/downloadManager.js'
import { UploadStore } from './uploads.js'
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
import { ensureCliProfile } from './users/cliProfiles.js'
import { AgentWorkspaceExecutor, type WorkspaceExecutor } from './features/workspace.js'
import { GitHubPullRequestService, type PullRequestService } from './features/pullRequests.js'
import { FeatureCoordinator, type FeatureTurnStarter } from './features/coordinator.js'
import { FileKnowledgeBaseService } from './kb/service.js'
import { registerKbRoutes } from './kb/routes.js'
import type { KnowledgeBaseService } from './kb/types.js'
import { LlmKbReranker } from './kb/reranker.js'

const VERSION = '0.1.0'

export interface BuildOptions {
  config: ServerConfig
  /** Готовый экземпляр БД (для тестов, напр. :memory:). Иначе создаётся из config. */
  db?: VoiceChatDb
  /** Read-only база знаний (для тестов — мок). */
  kbService?: KnowledgeBaseService
  /** LLM-клиент (для тестов — мок). По умолчанию ClaudeCli. */
  claude?: LlmClient
  /** Codex-клиент (для тестов — мок). По умолчанию CodexCli. */
  codex?: LlmClient
  /** STT-движок (для тестов — мок). По умолчанию WhisperEngine из config. */
  sttEngine?: SttEngine
  /** TTS-движок (для тестов — мок). По умолчанию Piper/say из config. */
  ttsEngine?: TtsEngine
  /** Переопределение обработчиков WS (для тестов). Иначе — реальная сессия. */
  createWsHandlers?: () => WsHandlers
  /** Секрет подписи токенов сессии (для тестов). Иначе — из dataDir/эфемерный. */
  sessionSecret?: string
  /** Выполнение Git-команд в рабочих копиях Feature Run (в тестах — fake). */
  workspaceExecutor?: WorkspaceExecutor
  pullRequestService?: PullRequestService
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

  app.get(REST.health, async (): Promise<HealthResponse> => ({ ok: true, version: VERSION }))

  await registerRest(app, db, opts.config.dataDir)

  const profileHome = (userId: string): string =>
    ensureCliProfile(opts.config.dataDir, userId).home
  const claude = opts.claude ?? new ClaudeCli({ profileHome })
  const codex = opts.codex ?? new CodexCli({ profileHome })
  const reranker = opts.config.kbRerankProvider === 'disabled'
    ? undefined
    : new LlmKbReranker(opts.config.kbRerankProvider === 'claude' ? claude : codex)
  const kb = opts.kbService ?? new FileKnowledgeBaseService(opts.config.kbRoot, reranker)
  registerKbRoutes(app, kb)

  // Помощник формулировки — одноразовый вызов выбранного пользователем CLI.
  // Историю разговора не трогает, shell выключен.
  app.post<{ Body: { prompt?: string; modifiers?: import('@voicechat/shared').ModifierPrompt[] } }>(REST.promptSuggest, async (req, reply) => {
    const prompt = (req.body?.prompt ?? '').trim()
    if (!prompt) return { variants: [] as Array<{ id: string; text: string }> }
    const settings = db.getSettings(uid(req))
    const client = settings.aiAssistProvider === 'codex' ? codex : claude
    const model = settings.aiAssistModel || (settings.aiAssistProvider === 'claude' ? 'haiku' : '')
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
  registerRemoteBashMcp(app, agentRegistry, mcpSecret)

  // Админ-страница пользователей (роуты под guard requireAdmin).
  registerAdminRoutes(app, db, agentRegistry)

  // Проекты + канбан-доска (членство в проекте) + живой board.update по WS.
  const boardHub = new BoardHub()
  registerProjectRoutes(app, db, boardHub)
  let startFeatureTurn: FeatureTurnStarter = async () => {}
  const featureCoordinator = new FeatureCoordinator(
    db,
    opts.workspaceExecutor ?? new AgentWorkspaceExecutor(agentRegistry),
    opts.pullRequestService ?? new GitHubPullRequestService(opts.config.githubToken),
    (projectId) => boardHub.emit(projectId),
    (input) => startFeatureTurn(input)
  )
  registerFeatureRoutes(app, db, boardHub, featureCoordinator)

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

  // Загрузка вложений: клиент шлёт base64, сервер сохраняет файл и возвращает id.
  const uploads = new UploadStore(join(opts.config.dataDir, 'uploads'))
  app.post<{ Body: { name?: string; dataBase64?: string } }>(
    REST.uploads,
    { bodyLimit: 64 * 1024 * 1024 }, // до 64 МБ на вложение (base64 раздувает ~на треть)
    async (req, reply): Promise<UploadInfo> => {
      const { name, dataBase64 } = req.body ?? {}
      if (!dataBase64) return reply.code(400).send({ error: 'no data' }) as never
      const buf = Buffer.from(dataBase64, 'base64')
      const rec = uploads.save(name ?? 'file', buf)
      return { id: rec.id, name: rec.name }
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
    kb,
    resolveUpload: (id) => uploads.pathById(id),
    agents: {
      isOnline: (id) => agentRegistry.isOnline(id),
      nameOf: (id) => agentRegistry.nameOf(id),
      policyOf: (id) => agentRegistry.policyOf(id),
      fsList: (id, path) => agentRegistry.fsList(id, path),
      fsMkdir: (id, path) => agentRegistry.fsMkdir(id, path),
      fsWrite: (id, path, data) => agentRegistry.fsWrite(id, path, data)
    },
    // Откуда можно забирать файл картинки: профиль CLI, загрузки, рабочий каталог.
    serverFileRoots: (userId) => {
      const settings = db.getSettings(userId)
      return [
        ensureCliProfile(opts.config.dataDir, userId).home,
        join(opts.config.dataDir, 'uploads'),
        ...(settings.workdir ? [settings.workdir] : [])
      ]
    },
    // claude спавнится на этом же хосте — loopback работает при любом HOST.
    mcpBaseUrl: `http://127.0.0.1:${opts.config.port}${REMOTE_BASH_MCP_PATH}?k=${mcpSecret}`
  })

  startFeatureTurn = ({ userId, conversationId, text }) =>
    turnManager.start({ userId, conversationId, segments: [{ speakerId: 1, text }], verbose: true })

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
      pty: {
        start: (agentId, ptyId, cols, rows, cwd, emit) =>
          agentRegistry.ptyStart(agentId, ptyId, cols, rows, cwd, emit),
        input: (ptyId, data) => agentRegistry.ptyInput(ptyId, data),
        resize: (ptyId, cols, rows) => agentRegistry.ptyResize(ptyId, cols, rows),
        kill: (ptyId) => agentRegistry.ptyKill(ptyId)
      },
      // Живая канбан-доска: чтение снапшота (с проверкой членства) + подписка на изменения.
      board: {
        getBoard: (projectId) => db.getBoard(user.name, projectId),
        subscribe: (cb) => boardHub.onChange(cb)
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

  // Раздача собранного web-приложения тем же сервером (один порт, same-origin).
  // Включается только если задан VC_WEB_DIR и каталог существует — в dev/тестах
  // не активируется (там фронт крутит Vite). API/WS остаются под /api, /ws, /agent.
  if (opts.config.webDir && existsSync(opts.config.webDir)) {
    const webDir = opts.config.webDir
    const { default: fastifyStatic } = await import('@fastify/static')
    await app.register(fastifyStatic, { root: webDir, wildcard: false })
    // SPA-fallback: неизвестный GET (не /api, не /ws, не /agent) → index.html.
    app.setNotFoundHandler((req, reply) => {
      const url = req.url.split('?')[0]
      if (
        req.method === 'GET' &&
        !url.startsWith('/api') &&
        !url.startsWith('/ws') &&
        !url.startsWith('/agent')
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
