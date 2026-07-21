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
import { AgentRegistry } from './agents/registry.js'
import { attachAgentWs } from './agents/wsAgent.js'
import { registerRemoteBashMcp, REMOTE_BASH_MCP_PATH } from './mcp/remoteBashMcp.js'
import { createSession } from './session.js'
import { ClaudeCli } from './claude/claudeCli.js'
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

const VERSION = '0.1.0'

export interface BuildOptions {
  config: ServerConfig
  /** Готовый экземпляр БД (для тестов, напр. :memory:). Иначе создаётся из config. */
  db?: VoiceChatDb
  /** LLM-клиент (для тестов — мок). По умолчанию ClaudeCli. */
  claude?: LlmClient
  /** STT-движок (для тестов — мок). По умолчанию WhisperEngine из config. */
  sttEngine?: SttEngine
  /** TTS-движок (для тестов — мок). По умолчанию Piper/say из config. */
  ttsEngine?: TtsEngine
  /** Переопределение обработчиков WS (для тестов). Иначе — реальная сессия. */
  createWsHandlers?: () => WsHandlers
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

  app.get(REST.health, async (): Promise<HealthResponse> => ({ ok: true, version: VERSION }))

  await registerRest(app, db)

  // Машины-агенты: реестр онлайн-подключений + REST + MCP-мост для проброса Bash.
  const agentRegistry = new AgentRegistry()
  await registerAgentRoutes(app, db, agentRegistry, {
    agentApp: opts.config.agentAppPath,
    desktopApp: opts.config.desktopAppPath
  })
  const mcpSecret = randomBytes(16).toString('hex')
  registerRemoteBashMcp(app, agentRegistry, mcpSecret)

  app.get(REST.sttStatus, async (): Promise<SttStatus> => {
    const model = db.getSettings().whisperModel
    return { present: isModelPresent(opts.config.modelsDir, model, { existsSync, statSync }), model }
  })

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

  const claude = opts.claude ?? new ClaudeCli()
  const sttEngine =
    opts.sttEngine ??
    new WhisperEngine({
      whisperCli: opts.config.whisperCli,
      modelsDir: opts.config.modelsDir,
      getModel: () => db.getSettings().whisperModel
    })
  const ttsEngine = opts.ttsEngine ?? makeTtsEngine(opts.config)
  const diarization = new StubDiarizationEngine()

  // Один менеджер загрузки модели на процесс: переживает переподключения клиентов,
  // не рестартится при повторном клике, отдаёт текущий прогресс новым соединениям.
  const modelDownload = new ModelDownloadManager((onProgress) =>
    downloadModel(db.getSettings().whisperModel, opts.config.modelsDir, onProgress)
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

  const makeHandlers =
    opts.createWsHandlers ??
    (() =>
      createSession({
        db,
        claude,
        sttEngine,
        ttsEngine,
        diarization,
        modelDownload,
        downloadVoice: (id, onProgress) =>
          downloadPiperVoice(id, opts.config.piperVoicesDir, onProgress),
        resolveUpload: (id) => uploads.pathById(id),
        agents: agentRegistry,
        // claude спавнится на этом же хосте — loopback работает при любом HOST.
        mcpBaseUrl: `http://127.0.0.1:${opts.config.port}${REMOTE_BASH_MCP_PATH}?k=${mcpSecret}`
      }))

  await app.register(async (scoped) => {
    scoped.get('/ws', { websocket: true }, (socket) => {
      attachWs(socket, makeHandlers())
    })
    scoped.get('/agent', { websocket: true }, (socket) => {
      attachAgentWs(socket, db, agentRegistry)
    })
  })

  app.addHook('onClose', async () => {
    if (!opts.db) db.close() // закрываем только созданную нами БД
  })

  return app
}
