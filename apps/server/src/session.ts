// Per-connection сессия: маршрутизация WS-сообщений в сервисы (Claude, STT;
// TTS — Ф6). Хранит per-connection состояние (микрофон, озвучка, подписки).
// Сами ходы LLM живут в процесс-глобальном TurnManager и переживают обрыв
// соединения: обновление страницы не отменяет генерацию ответа.

import type { AgentInfo } from '@voicechat/shared'
import type { WsHandlers } from './ws.js'
import type { VoiceChatDb } from './db/database.js'
import type { TurnManager } from './turns.js'
import type { SttEngine } from './stt/types.js'
import type { DiarizationEngine } from './diarization/types.js'
import { createSttSession, type SttSession } from './stt/sttSession.js'
import type { DownloadEvent } from './stt/downloadManager.js'
import type { TtsEngine } from './tts/types.js'
import { createTtsSession, type TtsSession } from './tts/ttsSession.js'
import { watchTranscript } from './cc/ccSessions.js'
import { watchCxTranscript } from './codex/codexSessions.js'

export interface SessionDeps {
  db: VoiceChatDb
  /** Процесс-глобальный реестр ходов LLM (ходы переживают reconnect). */
  turns: TurnManager
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
  /** Живой список машин с онлайн-статусом + подписка на изменения (пуш веб-клиенту). */
  agentsFeed?: {
    list(): AgentInfo[]
    subscribe(cb: () => void): () => void
  }
}

export function createSession(deps: SessionDeps): WsHandlers {
  let stt: SttSession | null = null
  let tts: TtsSession | null = null
  let unsubDownload: (() => void) | null = null
  let unsubAgents: (() => void) | null = null
  let unsubTurns: (() => void) | null = null
  let ccTailStop: (() => void) | null = null
  let cxTailStop: (() => void) | null = null

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
      // События ходов LLM (token/done/error/log) — каждому клиенту; плюс снапшот
      // активных ходов, чтобы после обновления страницы стрим продолжился.
      unsubTurns = deps.turns.subscribe((m) => ctx.send(m))
      ctx.send({ t: 'claude.active', turns: deps.turns.active() })
      // Живой список машин-агентов: начальное состояние + пуш при изменениях.
      if (deps.agentsFeed) {
        ctx.send({ t: 'agents', agents: deps.agentsFeed.list() })
        unsubAgents = deps.agentsFeed.subscribe(() =>
          ctx.send({ t: 'agents', agents: deps.agentsFeed!.list() })
        )
      }
    },
    onMessage(msg, ctx) {
      switch (msg.t) {
        case 'claude.send':
          deps.turns.start({
            conversationId: msg.conversationId,
            segments: msg.segments,
            attachments: msg.attachments,
            verbose: msg.verbose
          })
          break
        case 'claude.cancel':
          deps.turns.cancel(msg.conversationId)
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

        case 'cx.tail.start': {
          cxTailStop?.()
          const { id } = msg
          cxTailStop = watchCxTranscript(id, (items) => ctx.send({ t: 'cx.tail', id, items }))
          break
        }
        case 'cx.tail.stop':
          cxTailStop?.()
          cxTailStop = null
          break

        default:
          break
      }
    },
    onBinary(data) {
      stt?.chunk(pcmFromBinary(data))
    },
    onClose() {
      // Ходы LLM НЕ отменяем: они доигрывают в TurnManager, ответ сохранит сервер.
      stt?.dispose()
      stt = null
      tts?.dispose()
      tts = null
      unsubDownload?.() // отписка от менеджера загрузки; сама загрузка продолжается
      unsubDownload = null
      unsubAgents?.()
      unsubAgents = null
      unsubTurns?.()
      unsubTurns = null
      ccTailStop?.()
      ccTailStop = null
      cxTailStop?.()
      cxTailStop = null
    }
  }
}
