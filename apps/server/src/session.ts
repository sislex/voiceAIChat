// Per-connection сессия: маршрутизация WS-сообщений в сервисы (Claude, STT;
// TTS — Ф6). Хранит per-connection состояние (микрофон, озвучка, подписки).
// Сами ходы LLM живут в процесс-глобальном TurnManager и переживают обрыв
// соединения: обновление страницы не отменяет генерацию ответа.

import type { AgentInfo, SessionUser, SystemCapabilities } from '@voicechat/shared'
import type { WsHandlers } from './ws.js'
import type { VoiceChatDb } from './db/database.js'
import type { TurnManager } from './turns.js'
import type { PtyEvent } from './agents/registry.js'
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
  /** Пользователь этого соединения (изоляция данных/ходов). */
  user: SessionUser
  /** Процесс-глобальный реестр ходов LLM (ходы переживают reconnect). */
  turns: TurnManager
  sttEngine: SttEngine
  ttsEngine: TtsEngine
  diarization?: DiarizationEngine
  /** Возможности системы по ресурсам контейнера (блокировка STT/TTS при нехватке памяти). */
  capabilities: () => SystemCapabilities
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
  /** Релей живого PTY-терминала по машине (отдельно от однострочного exec). */
  pty?: PtyRelay
}

/** Минимальный релей PTY для сессии (реализует AgentRegistry). */
export interface PtyRelay {
  start(agentId: string, ptyId: string, cols: number, rows: number, emit: (e: PtyEvent) => void): void
  input(ptyId: string, data: string): void
  resize(ptyId: string, cols: number, rows: number): void
  kill(ptyId: string): void
}

export function createSession(deps: SessionDeps): WsHandlers {
  let stt: SttSession | null = null
  let tts: TtsSession | null = null
  let unsubDownload: (() => void) | null = null
  let unsubAgents: (() => void) | null = null
  let unsubTurns: (() => void) | null = null
  let ccTailStop: (() => void) | null = null
  let cxTailStop: (() => void) | null = null
  const ptyIds = new Set<string>()

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
      // События ходов LLM (token/done/error/log) — только своему пользователю;
      // плюс снапшот активных ходов, чтобы после обновления страницы стрим продолжился.
      unsubTurns = deps.turns.subscribe((m, ownerUserId) => {
        if (ownerUserId === deps.user.name) ctx.send(m)
      })
      ctx.send({ t: 'claude.active', turns: deps.turns.active(deps.user.name) })
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
            userId: deps.user.name,
            conversationId: msg.conversationId,
            segments: msg.segments,
            attachments: msg.attachments,
            verbose: msg.verbose,
            execTarget: msg.execTarget
          })
          break
        case 'claude.cancel':
          deps.turns.cancel(msg.conversationId)
          break

        case 'audio.start': {
          // Жёсткий блок: если ресурсов контейнера мало — STT не запускаем.
          const sttCap = deps.capabilities().stt
          if (!sttCap.available) {
            ctx.send({ t: 'stt.error', message: sttCap.reason })
            break
          }
          stt?.dispose()
          stt = createSttSession({
            engine: deps.sttEngine,
            send: ctx.send,
            language: deps.language,
            diarization: deps.diarization,
            isDiarizationEnabled: () => deps.db.getSettings(deps.user.name).diarization
          })
          stt.start(msg.sampleRate)
          break
        }
        case 'audio.stop':
          stt?.stop()
          break

        case 'stt.download':
          // Идемпотентно: если уже качается — просто дождёмся через подписку в onOpen.
          deps.modelDownload?.start()
          break

        case 'tts.speak': {
          // Жёсткий блок озвучки при нехватке ресурсов контейнера.
          const ttsCap = deps.capabilities().tts
          if (!ttsCap.available) {
            ctx.send({ t: 'tts.error', message: ttsCap.reason })
            break
          }
          if (!tts) tts = createTtsSession({ engine: deps.ttsEngine, send: ctx.send })
          tts.speak(msg.text, msg.voice)
          break
        }
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

        case 'pty.start': {
          // Живой терминал: только по своей машине (проверка владения по списку).
          const owns = deps.agentsFeed?.list().some((a) => a.id === msg.agentId) ?? false
          if (!owns) {
            ctx.send({ t: 'pty.error', ptyId: msg.ptyId, message: 'Машина не найдена' })
            break
          }
          ptyIds.add(msg.ptyId)
          deps.pty?.start(msg.agentId, msg.ptyId, msg.cols, msg.rows, (e) => ctx.send(e))
          break
        }
        case 'pty.input':
          deps.pty?.input(msg.ptyId, msg.data)
          break
        case 'pty.resize':
          deps.pty?.resize(msg.ptyId, msg.cols, msg.rows)
          break
        case 'pty.kill':
          ptyIds.delete(msg.ptyId)
          deps.pty?.kill(msg.ptyId)
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
      // Живые терминалы этого соединения закрываем (обновление страницы = новый сеанс).
      for (const id of ptyIds) deps.pty?.kill(id)
      ptyIds.clear()
    }
  }
}
