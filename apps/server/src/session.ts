// Per-connection сессия: маршрутизация WS-сообщений в сервисы (Claude, STT;
// TTS — Ф6). Хранит per-connection состояние.

import { existsSync } from 'node:fs'
import {
  claudeModelAlias,
  buildPrompt,
  buildConversationPrompt,
  type AgentInfo,
  type AgentPolicy
} from '@voicechat/shared'
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
  /** Онлайн-статус и политика машин-агентов (для проброса Bash на клиента). */
  agents?: {
    isOnline(id: string): boolean
    nameOf(id: string): string | undefined
    policyOf(id: string): AgentPolicy | undefined
  }
  /** База URL MCP-эндпоинта remote-bash (с секретом k); undefined — проброс выключен. */
  mcpBaseUrl?: string
  /** Живой список машин с онлайн-статусом + подписка на изменения (пуш веб-клиенту). */
  agentsFeed?: {
    list(): AgentInfo[]
    subscribe(cb: () => void): () => void
  }
}

/** Краткое описание политики машины для системного промпта Claude. */
function policySummary(p: AgentPolicy): string {
  const parts: string[] = []
  if (p.allowedDirs.length) parts.push(`Работай только в каталогах: ${p.allowedDirs.join(', ')}.`)
  parts.push(
    p.allowNetwork
      ? 'Доступ в сеть разрешён.'
      : 'Доступ в сеть запрещён — не используй curl/wget/ssh и подобное.'
  )
  parts.push(
    p.allowWrite ? 'Изменение файлов разрешено.' : 'Изменение файлов запрещено — только чтение.'
  )
  if (p.denyPatterns.length) parts.push(`Запрещённые паттерны команд: ${p.denyPatterns.join(', ')}.`)
  if (p.allowPatterns.length) parts.push(`Разрешены только команды: ${p.allowPatterns.join(', ')}.`)
  if (p.skills.length) {
    parts.push(`Доступные скрипты: ${p.skills.map((s) => `«${s.name}» → ${s.command}`).join('; ')}.`)
  }
  return `Политика машины: ${parts.join(' ')}`
}

export function createSession(deps: SessionDeps): WsHandlers {
  let claudeHandle: LlmHandle | null = null
  let stt: SttSession | null = null
  let tts: TtsSession | null = null
  let unsubDownload: (() => void) | null = null
  let unsubAgents: (() => void) | null = null
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
          // Цель выполнения команд: выбранная машина-агент. Офлайн — сразу ошибка:
          // молча выполнить команды не на той машине хуже, чем отказать.
          const target = settings.execTarget
          let remote: { mcpUrl: string; agentName: string; policySummary?: string } | undefined
          if (target && deps.agents && deps.mcpBaseUrl) {
            if (!deps.agents.isOnline(target)) {
              ctx.send({
                t: 'claude.error',
                conversationId,
                message: `Машина «${deps.agents.nameOf(target) ?? target}» не в сети. Запустите на ней агента или выберите «На сервере» в настройках.`
              })
              break
            }
            const policy = deps.agents.policyOf(target)
            remote = {
              mcpUrl: `${deps.mcpBaseUrl}&agent=${encodeURIComponent(target)}`,
              agentName: deps.agents.nameOf(target) ?? target,
              policySummary: policy ? policySummary(policy) : undefined
            }
          }
          claudeHandle = deps.claude.send(
            { prompt, sessionId, model, permissionMode, cwd, remote },
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
      unsubAgents?.()
      unsubAgents = null
      ccTailStop?.()
      ccTailStop = null
    }
  }
}
