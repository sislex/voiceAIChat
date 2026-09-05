// Per-connection сессия: маршрутизация WS-сообщений в сервисы (Claude, STT;
// TTS — Ф6). Хранит per-connection состояние (микрофон, озвучка, подписки).
// Сами ходы LLM живут в процесс-глобальном TurnManager и переживают обрыв
// соединения: обновление страницы не отменяет генерацию ответа.

import type { AgentInfo, Board, PreviewActionResult, ServerMessage, SessionUser, SystemCapabilities, CcItem, CxItem, WidgetSurfaceSnapshot, WidgetUiActionResult } from '@voicechat/shared'
import type { WsHandlers } from './ws.js'
import type { VoiceChatDb } from './db/database.js'
import type { TurnManager } from './turns.js'
import type { PtyEvent } from './agents/registry.js'
import type { SttEngine } from './stt/types.js'
import type { SttClient } from './stt/client.js'
import type { DiarizationEngine } from './diarization/types.js'
import { createSttSession, type SttSession } from './stt/sttSession.js'
import type { DownloadEvent } from './stt/downloadManager.js'
import type { TtsClient } from './tts/client/types.js'
import { createTtsSession, type TtsSession } from './tts/ttsSession.js'
import { watchTranscript } from './cc/ccSessions.js'
import { watchCxTranscript } from './codex/codexSessions.js'
import type { CiRunManager } from './ci/runManager.js'
import type { KbUsageTracker } from './kb/usage.js'
import type { AuthStatusState } from './auth/statusState.js'

export interface SessionDeps {
  db: VoiceChatDb
  /** Пользователь этого соединения (изоляция данных/ходов). */
  user: SessionUser
  /** Sid сессии этого соединения; null — токен без записи (старый клиент). */
  sid?: string | null
  /** Живые изменения списка сессий пользователя. */
  sessions?: { onChange(listener: (event: { user: string; revokedSid?: string }) => void): () => void }
  /** Процесс-глобальный реестр ходов LLM (ходы переживают reconnect). */
  turns: TurnManager
  sttEngine?: SttEngine
  sttClient?: SttClient
  getWhisperModel?: () => import('@voicechat/shared').WhisperModel
  ttsClient: TtsClient
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
  /** Живая канбан-доска проекта: снапшот (с проверкой членства) + подписка на изменения. */
  board?: {
    getBoard(projectId: string, includeCompleted?: boolean): Board | null
    subscribe(cb: (projectId: string) => void): () => void
    subscribePreparationRuns(cb: (update: { userId: string; projectId: string; taskId: string; runId: string }) => void): () => void
    subscribeTaskRepositories(cb: (update: { projectId: string; taskId: string }) => void): () => void
    subscribeQaStages(cb: (update: { projectId: string; taskId: string; stage: import('@voicechat/shared').QaRunStage }) => void): () => void
  }
  /** Адресная инвалидизация HTTP-снимка уведомлений подготовки. */
  preparationNotifications?: {
    canAccess(projectId: string): boolean
    subscribe(cb: (event: { projectId: string; userId?: string; kind?: 'membership' }) => void): () => void
  }
  /** Live-tail проводника CC/Codex: локальный fs.watch или SSE исполнителя. */
  observerTail?: {
    watchCc(userId: string, slug: string, id: string, onItems: (items: CcItem[]) => void): () => void
    watchCx(userId: string, id: string, onItems: (items: CxItem[]) => void): () => void
  }
  /** Релей живого PTY-терминала по машине (отдельно от однострочного exec). */
  pty?: PtyRelay
  /** Процесс-глобальный менеджер CI-ранов (события переживают reconnect). */
  ci?: CiRunManager
  /** Телеметрия обращений к базе знаний (кадры kb.usage своему пользователю). */
  kbUsage?: KbUsageTracker
  /** Единый per-user auth-снимок и изменения CLI. */
  authStatus?: AuthStatusState
  /**
   * Relay действий веб-превью (mcp__browser__*): подписка доставляет клиенту
   * кадры preview.action его пользователя, resolve возвращает preview.result.
   */
  preview?: {
    subscribe(userId: string, sink: (m: ServerMessage) => void): () => void
    resolve(userId: string, requestId: string, outcome: { ok: boolean; result?: PreviewActionResult; error?: string }, conversationId?: string): void
  }
  /** Make: кадры make.changed своего пользователя (файлы проекта изменились). */
  make?: { subscribe(userId: string, sink: (m: ServerMessage) => void): () => void }
  /**
   * Действия канбан-ассистента в интерфейсе (mcp__kanban__ui_*): подписка
   * доставляет клиенту кадры widget.action, resolve принимает widget.result.
   */
  widgetUi?: {
    subscribe(userId: string, sink: (m: ServerMessage) => void): () => void
    resolve(userId: string, requestId: string, outcome: { ok: boolean; result?: WidgetUiActionResult; error?: string }, conversationId?: string): void
    /** Экран пользователя сменился во время хода — обновить снимок инструментов. */
    surfaceChanged(userId: string, conversationId: string, surface: WidgetSurfaceSnapshot): void
  }
}

/** Минимальный релей PTY для сессии (реализует AgentRegistry). */
export interface PtyRelay {
  start(agentId: string, ptyId: string, cols: number, rows: number, cwd: string | undefined, emit: (e: PtyEvent) => void): void
  input(ptyId: string, data: string): void
  resize(ptyId: string, cols: number, rows: number): void
  /** Отвязать WS-клиента, сохранив shell для повторного подключения. */
  detach(ptyId: string): void
  kill(ptyId: string): void
}

export function createSession(deps: SessionDeps): WsHandlers {
  let stt: SttSession | null = null
  let tts: TtsSession | null = null
  let unsubDownload: (() => void) | null = null
  let unsubAgents: (() => void) | null = null
  let unsubBoard: (() => void) | null = null
  let unsubSessions: (() => void) | null = null
  let unsubPreparationRuns: (() => void) | null = null
  let unsubTaskRepositories: (() => void) | null = null
  let unsubQaStages: (() => void) | null = null
  let unsubPreparationNotifications: (() => void) | null = null
  let boardProjectId: string | null = null
  /** Просит ли подписчик отдавать и давно завершённые задачи («Показать завершённые»). */
  let unsubTurns: (() => void) | null = null
  let unsubCi: (() => void) | null = null
  let unsubKbUsage: (() => void) | null = null
  let unsubPreview: (() => void) | null = null
  let unsubMake: (() => void) | null = null
  let unsubWidgetUi: (() => void) | null = null
  let unsubAuthStatus: (() => void) | null = null
  let ccTailStop: (() => void) | null = null
  let cxTailStop: (() => void) | null = null
  const ptyIds = new Set<string>()

  function pcmFromBinary(data: Buffer): Int16Array {
    const copy = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    return new Int16Array(copy)
  }

  return {
    onOpen(ctx) {
      if (deps.authStatus) {
        let delivered = ''
        unsubAuthStatus = deps.authStatus.subscribe((status, userId) => {
          if (userId !== deps.user.name) return
          delivered = JSON.stringify(status)
          ctx.send({ t: 'auth.status', v: 1, status })
        })
        void deps.authStatus.get(deps.user.name, true).then((status) => {
          if (JSON.stringify(status) !== delivered) ctx.send({ t: 'auth.status', v: 1, status })
        }).catch(() => undefined)
      }
      unsubDownload = deps.modelDownload?.subscribe((ev) => ctx.send(ev)) ?? null
      unsubTurns = deps.turns.subscribe((m, ownerUserId) => {
        if (ownerUserId === deps.user.name) ctx.send(m)
      })
      ctx.send({ t: 'claude.active', turns: deps.turns.active(deps.user.name) })
      deps.turns.resumeQueues(deps.user.name)
      if (deps.ci) {
        unsubCi = deps.ci.subscribe((m, ownerUserId) => {
          if (ownerUserId === deps.user.name) ctx.send(m)
        })
      }
      if (deps.kbUsage) {
        unsubKbUsage = deps.kbUsage.subscribe((m, ownerUserId) => {
          if (ownerUserId === deps.user.name) ctx.send(m)
        })
      }
      if (deps.preview) {
        unsubPreview = deps.preview.subscribe(deps.user.name, (m) => ctx.send(m))
      }
      if (deps.make) {
        unsubMake = deps.make.subscribe(deps.user.name, (m) => ctx.send(m))
      }
      if (deps.widgetUi) {
        unsubWidgetUi = deps.widgetUi.subscribe(deps.user.name, (m) => ctx.send(m))
      }
      if (deps.agentsFeed) {
        ctx.send({ t: 'agents', agents: deps.agentsFeed.list() })
        unsubAgents = deps.agentsFeed.subscribe(() =>
          ctx.send({ t: 'agents', agents: deps.agentsFeed!.list() })
        )
      }
      if (deps.preparationNotifications) {
        unsubPreparationNotifications = deps.preparationNotifications.subscribe((event) => {
          if (event.userId ? event.userId !== deps.user.name : !deps.preparationNotifications!.canAccess(event.projectId)) return
          // Смена состава участников меняет и доступные уведомления, и роль, поэтому
          // кадра нужно два: старый инвалидирует список уведомлений, новый говорит
          // перечитать сам проект. Обратной дороги нет — по кадру уведомлений
          // проект перечитывать нельзя, он приходит на каждое событие рана.
          if (event.kind === 'membership') ctx.send({ t: 'project.membership', v: 1, projectId: event.projectId })
          ctx.send({ t: 'task-preparation.notifications.invalidate', v: 1, projectId: event.projectId })
          // Адресное событие может касаться приглашения — а приглашённый ещё не
          // участник проекта, и по членству его не найти.
          if (event.userId) ctx.send({ t: 'invitations.invalidate', v: 1 })
        })
      }
      if (deps.sessions) {
        unsubSessions = deps.sessions.onChange((event) => {
          if (event.user !== deps.user.name) return
          // Завершили именно это соединение — говорим об этом адресно: иначе
          // вкладка узнает о потере доступа только на следующем запросе к API.
          if (event.revokedSid && deps.sid && event.revokedSid === deps.sid) ctx.send({ t: 'session.revoked', v: 1, sid: event.revokedSid })
          else ctx.send({ t: 'sessions.update', v: 1 })
        })
      }
      if (deps.board) {
        unsubBoard = deps.board.subscribe((projectId) => {
          if (projectId !== boardProjectId) return
          ctx.send({ t: 'board.changed', projectId })
        })
        unsubPreparationRuns = deps.board.subscribePreparationRuns((update) => {
          if (update.userId !== deps.user.name) return
          ctx.send({ t: 'preparation.run.updated', projectId: update.projectId, taskId: update.taskId, runId: update.runId })
        })
        unsubTaskRepositories = deps.board.subscribeTaskRepositories((update) => {
          if (!deps.board?.getBoard(update.projectId, false)) return
          ctx.send({ t: 'task.repositories.updated', projectId: update.projectId, taskId: update.taskId })
        })
        // Гейт тот же, что у репозиториев: кадр уходит только тем, кому доска видна.
        unsubQaStages = deps.board.subscribeQaStages((update) => {
          if (!deps.board?.getBoard(update.projectId, false)) return
          ctx.send({ t: 'qa.stage.updated', projectId: update.projectId, taskId: update.taskId, stage: update.stage })
        })
      }
    },
    onMessage(msg, ctx) {
      switch (msg.t) {
        case 'claude.send':
          void deps.turns.start({
            userId: deps.user.name,
            conversationId: msg.conversationId,
            messageId: msg.messageId,
            segments: msg.segments,
            attachments: msg.attachments,
            verbose: msg.verbose,
            execTarget: msg.execTarget,
            skipProjectSync: msg.skipProjectSync,
            assistantContext: msg.assistantContext
          })
          break
        case 'claude.cancel':
          deps.turns.cancel(msg.conversationId)
          break
        case 'claude.queue.edit':
          deps.turns.editQueued(deps.user.name, msg.conversationId, msg.id, msg.text, msg.segments)
          break
        case 'claude.queue.delete':
          deps.turns.deleteQueued(deps.user.name, msg.conversationId, msg.id)
          break
        case 'claude.queue.reorder':
          deps.turns.reorderQueued(deps.user.name, msg.conversationId, msg.ids)
          break
        case 'claude.queue.now':
          deps.turns.sendQueuedNow(deps.user.name, msg.conversationId, msg.id)
          break

        case 'audio.start': {
          const sttCap = deps.capabilities().stt
          if (!sttCap.available) {
            ctx.send({ t: 'stt.error', message: sttCap.reason })
            break
          }
          stt?.dispose()
          stt = createSttSession({
            engine: deps.sttEngine,
            client: deps.sttClient,
            getModel: deps.getWhisperModel,
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
          deps.modelDownload?.start()
          break

        case 'tts.speak': {
          const ttsCap = deps.capabilities().tts
          if (!ttsCap.available) {
            ctx.send({ t: 'tts.error', message: ttsCap.reason })
            break
          }
          if (!tts) tts = createTtsSession({ client: deps.ttsClient, send: ctx.send, ownerId: deps.user.name })
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
          const watchCc =
            deps.observerTail?.watchCc ??
            ((_: string, s: string, sessId: string, onItems: (items: CcItem[]) => void) =>
              watchTranscript(s, sessId, onItems))
          ccTailStop = watchCc(deps.user.name, slug, id, (items) =>
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
          const watchCx =
            deps.observerTail?.watchCx ??
            ((_: string, sessId: string, onItems: (items: CxItem[]) => void) =>
              watchCxTranscript(sessId, onItems))
          cxTailStop = watchCx(deps.user.name, id, (items) => ctx.send({ t: 'cx.tail', id, items }))
          break
        }
        case 'cx.tail.stop':
          cxTailStop?.()
          cxTailStop = null
          break

        case 'pty.start': {
          const allowed = deps.db.canUseAgent(deps.user.name, msg.agentId, msg.projectId)
          if (!allowed) {
            ctx.send({ t: 'pty.error', ptyId: msg.ptyId, message: 'Машина не найдена' })
            break
          }
          // Живой shell — это полный доступ: машине, предоставленной «только для чтения», терминал не открываем (п.18).
          if (!deps.db.canWriteAgent(deps.user.name, msg.agentId, msg.projectId)) {
            ctx.send({ t: 'pty.error', ptyId: msg.ptyId, message: 'Машина предоставлена проекту только для чтения: терминал недоступен' })
            break
          }
          ptyIds.add(msg.ptyId)
          deps.pty?.start(msg.agentId, msg.ptyId, msg.cols, msg.rows, msg.cwd, (e) => ctx.send(e))
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

        case 'board.subscribe': {
          // getBoard сохраняет действующую проверку членства, но снапшот по WS не отправляется.
          if (!deps.board?.getBoard(msg.projectId, false)) break
          boardProjectId = msg.projectId
          break
        }
        case 'board.unsubscribe':
          boardProjectId = null
          break
        case 'ci.subscribe': {
          const snap = deps.ci?.snapshot(deps.user.name, msg.runId)
          if (snap) ctx.send(snap)
          break
        }
        case 'ci.unsubscribe':
          break
        case 'widget.surface':
          deps.widgetUi?.surfaceChanged(deps.user.name, msg.conversationId, msg.surface)
          break
        case 'widget.result':
          // Ответ на действие ассистента в UI: релей сам сверит пользователя.
          deps.widgetUi?.resolve(deps.user.name, msg.requestId, {
            ok: msg.ok === true,
            ...(msg.result !== undefined ? { result: msg.result } : {}),
            ...(typeof msg.error === 'string' ? { error: msg.error } : {})
          }, msg.conversationId)
          break
        case 'preview.result':
          // Ответ на действие превью: relay сам сверит пользователя и requestId.
          deps.preview?.resolve(deps.user.name, msg.requestId, {
            ok: msg.ok === true,
            ...(msg.result !== undefined ? { result: msg.result } : {}),
            ...(typeof msg.error === 'string' ? { error: msg.error } : {})
          }, msg.conversationId)
          break

        default:
          break
      }
    },
    onBinary(data) {
      stt?.chunk(pcmFromBinary(data))
    },
    onClose() {
      stt?.dispose()
      stt = null
      tts?.dispose()
      tts = null
      unsubDownload?.()
      unsubDownload = null
      unsubAgents?.()
      unsubAgents = null
      unsubBoard?.()
      unsubBoard = null
      unsubSessions?.()
      unsubSessions = null
      unsubPreparationRuns?.()
      unsubPreparationRuns = null
      unsubTaskRepositories?.()
      unsubTaskRepositories = null
      unsubQaStages?.()
      unsubQaStages = null
      unsubPreparationNotifications?.()
      unsubPreparationNotifications = null
      boardProjectId = null
      unsubTurns?.()
      unsubTurns = null
      unsubCi?.()
      unsubCi = null
      unsubKbUsage?.()
      unsubKbUsage = null
      unsubPreview?.()
      unsubMake?.()
      unsubWidgetUi?.()
      unsubWidgetUi = null
      unsubMake = null
      unsubAuthStatus?.()
      unsubPreview = null
      ccTailStop?.()
      ccTailStop = null
      cxTailStop?.()
      cxTailStop = null
      for (const id of ptyIds) deps.pty?.detach(id)
      ptyIds.clear()
    }
  }
}
