// Per-connection сессия: маршрутизация WS-сообщений в сервисы (Claude, STT;
// TTS — Ф6). Хранит per-connection состояние.

import { existsSync } from 'node:fs'
import { claudeModelAlias, buildPrompt, buildConversationPrompt } from '@voicechat/shared'
import type { WsHandlers } from './ws.js'
import type { VoiceChatDb } from './db/database.js'
import type { LlmClient, LlmHandle } from './claude/types.js'
import type { SttEngine } from './stt/types.js'
import type { DiarizationEngine } from './diarization/types.js'
import { createSttSession, type SttSession } from './stt/sttSession.js'
import type { DownloadEvent } from './stt/downloadManager.js'
import type { TtsEngine } from './tts/types.js'
import { createTtsSession, type TtsSession } from './tts/ttsSession.js'
import { watchTranscript } from './cc/ccSessions.js'

export interface SessionDeps {
  db: VoiceChatDb
  claude: LlmClient
  sttEngine: SttEngine
  ttsEngine: TtsEngine
  diarization?: DiarizationEngine
  language?: string
  /** Процесс-глобальный менеджер скачивания модели Whisper (переживает переподключения). */
  modelDownload?: {
    start(): void
    subscribe(listener: (ev: DownloadEvent) => void): () => void
  }
  /** Скачивание голоса Piper по id с прогрессом. */
  downloadVoice?: (id: string, onProgress: (percent: number) => void) => Promise<void>
  /** Резолв id вложения → абсолютный путь на сервере (для промпта Claude). */
  resolveUpload?: (id: string) => string | undefined
}

export function createSession(deps: SessionDeps): WsHandlers {
  let claudeHandle: LlmHandle | null = null
  let stt: SttSession | null = null
  let tts: TtsSession | null = null
  let unsubDownload: (() => void) | null = null
  let ccTailStop: (() => void) | null = null

  function pcmFromBinary(data: Buffer): Int16Array {
    const copy = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    return new Int16Array(copy)
  }

  return {
    onOpen(ctx) {
      // Подписываемся на менеджер загрузки: если модель качается прямо сейчас
      // (например, страницу обновили посреди загрузки), сразу получим текущий
      // прогресс и последующие события — прогресс-бар восстановится.
      unsubDownload = deps.modelDownload?.subscribe((ev) => ctx.send(ev)) ?? null
    },
    onMessage(msg, ctx) {
      switch (msg.t) {
        case 'claude.send': {
          claudeHandle?.cancel()
          const conversationId = msg.conversationId
          const conv = deps.db.getConversation(conversationId)
          const sessionId = conv?.claudeSessionId ?? null
          const settings = deps.db.getSettings()
          const model = claudeModelAlias(settings.model)
          const permissionMode = settings.permissionMode
          // Рабочий каталог — только если задан и существует (иначе игнор).
          const cwd =
            settings.workdir && existsSync(settings.workdir) ? settings.workdir : undefined
          const attachmentPaths = (msg.attachments ?? [])
            .map((id) => deps.resolveUpload?.(id))
            .filter((p): p is string => typeof p === 'string')
          // Есть сессия → продолжаем одним ходом (--resume). Нет (новый разговор или
          // сессия сброшена после удаления/правки) → пересобираем промпт из текущей
          // истории БД, чтобы контекст модели совпадал с видимым (без удалённых реплик).
          const prompt = sessionId
            ? buildPrompt(msg.segments, attachmentPaths)
            : buildConversationPrompt(deps.db.listMessages(conversationId), attachmentPaths)
          claudeHandle = deps.claude.send(
            { prompt, sessionId, model, permissionMode, cwd },
            {
              onSession: (sid) => deps.db.setClaudeSession(conversationId, sid),
              onDelta: (delta) => ctx.send({ t: 'claude.token', conversationId, delta }),
              onDone: (text, meta) => ctx.send({ t: 'claude.done', conversationId, text, meta }),
              onError: (message) => ctx.send({ t: 'claude.error', conversationId, message }),
              // Режим консоли: активность агента шлём только если клиент попросил.
              onActivity: msg.verbose
                ? (entry) => ctx.send({ t: 'claude.log', conversationId, entry })
                : undefined
            }
          )
          break
        }
        case 'claude.cancel':
          claudeHandle?.cancel()
          claudeHandle = null
          break

        case 'audio.start':
          stt?.dispose()
          stt = createSttSession({
            engine: deps.sttEngine,
            send: ctx.send,
            language: deps.language,
            diarization: deps.diarization,
            isDiarizationEnabled: () => deps.db.getSettings().diarization
          })
          stt.start(msg.sampleRate)
          break
        case 'audio.stop':
          stt?.stop()
          break

        case 'stt.download':
          // Идемпотентно: если уже качается — просто дождёмся через подписку в onOpen.
          deps.modelDownload?.start()
          break

        case 'tts.speak':
          if (!tts) tts = createTtsSession({ engine: deps.ttsEngine, send: ctx.send })
          tts.speak(msg.text, msg.voice)
          break
        case 'tts.cancel':
          tts?.cancel()
          break
        case 'tts.downloadVoice':
          if (deps.downloadVoice) {
            const id = msg.id
            void deps
              .downloadVoice(id, (percent) => ctx.send({ t: 'tts.voiceProgress', id, percent }))
              .then(() => ctx.send({ t: 'tts.voiceDone', id }))
              .catch((err) =>
                ctx.send({
                  t: 'tts.voiceError',
                  id,
                  message: err instanceof Error ? err.message : String(err)
                })
              )
          }
          break

        case 'cc.tail.start': {
          ccTailStop?.()
          const { slug, id } = msg
          ccTailStop = watchTranscript(slug, id, (items) =>
            ctx.send({ t: 'cc.tail', slug, id, items })
          )
          break
        }
        case 'cc.tail.stop':
          ccTailStop?.()
          ccTailStop = null
          break

        default:
          break
      }
    },
    onBinary(data) {
      stt?.chunk(pcmFromBinary(data))
    },
    onClose() {
      claudeHandle?.cancel()
      claudeHandle = null
      stt?.dispose()
      stt = null
      tts?.dispose()
      tts = null
      unsubDownload?.() // отписка от менеджера загрузки; сама загрузка продолжается
      unsubDownload = null
      ccTailStop?.()
      ccTailStop = null
    }
  }
}
