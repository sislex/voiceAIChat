import type { PreviewAction, PreviewActionResult } from '@shared/previewActions'
import type { PreviewElementPayload } from '@shared/previewInspector'
import {
  WEB_RECORDER_MESSAGE_TYPE,
  WEB_RECORDER_PROTOCOL_VERSION,
  isWebRecorderClientMessage,
  type WebRecorderHostMessage,
  type WebRecorderPageStatus,
  type WebRecorderScenarioStep
} from '@shared/webRecorder'

// React-free ядро host-стороны iframe-контракта Web Reader: явный автомат
// состояний, очередь DOM-команд до готовности страницы, таймеры pending-запросов
// и ротация регистрации на каждый новый boot Reader (первый ready, reload, HMR).
// Транспорт инъецируется: send постит уже собранный конверт, receive получает
// сообщение, чей source/origin проверил вызывающий React-адаптер.

/** Итог DOM-действия модели в превью (форма ответа preview.result). */
export interface PreviewActionOutcome {
  ok: boolean
  result?: PreviewActionResult
  error?: string
}

/** Исполнитель DOM-действий модели на странице превью. */
export type PreviewActionRunner = (action: PreviewAction) => Promise<PreviewActionOutcome>

/** unmounted → booting → ready → page-loading → page-ready; error и disposed — терминалы страницы/моста. */
export type ReaderHostStatus = 'unmounted' | 'booting' | 'ready' | 'page-loading' | 'page-ready' | 'error' | 'disposed'

/** Актуальная регистрация iframe: по ней host сверяет MCP-команды и результаты. */
export interface ReaderHostRegistration {
  conversationId: string
  registrationId: string
  capabilities: readonly string[]
  run: PreviewActionRunner
  beginDiagnostics: () => void
  endDiagnostics: () => void
}

export interface ReaderHostBridgeOptions {
  conversationId: string
  /** Генератор registrationId/requestId (в приложении — browserId). */
  newId: () => string
  send: (message: WebRecorderHostMessage) => void
  /** Возможности host, объявляемые Reader-у в init. */
  capabilities?: readonly string[]
  timeoutMs?: number
  /** Новая регистрация после handshake либо null после dispose/ротации. */
  onRegistration?: (registration: ReaderHostRegistration | null) => void
  onSaveUrl?: (url: string | null) => void
  onElement?: (element: PreviewElementPayload) => void
  onRecordingStep?: (step: WebRecorderScenarioStep) => void
  onDiagnosticsProgress?: (progress: { requestId: string; action: string; ok: boolean; durationMs: number }) => void
  onStatus?: (status: ReaderHostStatus) => void
}

export interface ReaderHostBridge {
  getStatus(): ReaderHostStatus
  registrationId(): string | null
  /** Передать Reader-у одобренный (ensurePreview) адрес; null очищает страницу. */
  setUrl(url: string | null): void
  run: PreviewActionRunner
  setInspector(enabled: boolean): void
  setRecording(enabled: boolean): void
  beginDiagnostics(): void
  endDiagnostics(): void
  /** Сообщение от iframe, чей event.source/origin уже проверен адаптером. */
  receive(message: unknown): void
  dispose(): void
}

const DEFAULT_TIMEOUT_MS = 10_000

/** Omit не дистрибутивен над union — раскладываем конверт по вариантам сами. */
type HostMessageBody = WebRecorderHostMessage extends infer M
  ? M extends WebRecorderHostMessage ? Omit<M, 'type' | 'conversationId' | 'registrationId'> : never
  : never

interface PendingEntry {
  action: PreviewAction
  sent: boolean
  timer: ReturnType<typeof setTimeout>
  resolve: (outcome: PreviewActionOutcome) => void
}

export function createReaderHostBridge(options: ReaderHostBridgeOptions): ReaderHostBridge {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const pending = new Map<string, PendingEntry>()
  let registration: string | null = null
  let shellCapabilities: readonly string[] = []
  // Мост создаётся адаптером вместе с монтированием iframe, поэтому стартует
  // с booting; 'unmounted' описывает состояние до создания моста.
  let status: ReaderHostStatus = 'booting'
  let pageStatus: WebRecorderPageStatus = 'empty'
  let pageError: string | undefined
  let approvedUrl: string | null = null
  let disposed = false

  const setStatus = (next: ReaderHostStatus): void => {
    if (status === next) return
    status = next
    options.onStatus?.(next)
  }
  const syncPageStatus = (): void => {
    if (disposed || registration === null) return
    setStatus(
      pageStatus === 'error' ? 'error' : pageStatus === 'loading' ? 'page-loading' : pageStatus === 'ready' ? 'page-ready' : 'ready'
    )
  }
  const post = (message: HostMessageBody): void => {
    if (registration === null) return
    options.send({
      type: WEB_RECORDER_MESSAGE_TYPE,
      conversationId: options.conversationId,
      registrationId: registration,
      ...message
    } as WebRecorderHostMessage)
  }
  const settle = (requestId: string, outcome: PreviewActionOutcome): void => {
    const entry = pending.get(requestId)
    if (!entry) return
    clearTimeout(entry.timer)
    pending.delete(requestId)
    entry.resolve(outcome)
  }
  const rejectAll = (error: string): void => {
    for (const requestId of [...pending.keys()]) settle(requestId, { ok: false, error })
  }
  const flush = (): void => {
    if (registration === null || pageStatus !== 'ready') return
    for (const [requestId, entry] of pending) {
      if (entry.sent) continue
      // open резолвится готовностью целевой страницы, в iframe не пересылается.
      if (entry.action.kind === 'open') {
        settle(requestId, { ok: true, result: { url: entry.action.url } })
        continue
      }
      entry.sent = true
      post({ kind: 'command', requestId, action: entry.action })
    }
  }
  const sendInit = (): void => {
    post({
      kind: 'init',
      protocolVersion: WEB_RECORDER_PROTOCOL_VERSION,
      previewUrl: approvedUrl,
      capabilities: options.capabilities ?? []
    })
  }

  const run: PreviewActionRunner = (action) => {
    if (disposed) return Promise.resolve({ ok: false, error: 'Панель Web Reader закрыта.' })
    if (registration === null) return Promise.resolve({ ok: false, error: 'Панель Web Reader не открыта или ещё не подключена.' })
    if (action.kind === 'open') {
      pageStatus = 'loading'
      pageError = undefined
      approvedUrl = action.url
      syncPageStatus()
      // Явный reset делает повторный open того же URL детерминированной перезагрузкой.
      post({ kind: 'set-url', url: null })
      queueMicrotask(() => post({ kind: 'set-url', url: action.url }))
    }
    if (pageStatus === 'empty' && action.kind !== 'open') {
      return Promise.resolve({ ok: false, error: 'Панель открыта, но в ней нет страницы — сначала вызови open.' })
    }
    if (pageStatus === 'error' && action.kind !== 'open') {
      return Promise.resolve({ ok: false, error: 'Сайт или страница недоступны: ' + (pageError ?? 'ошибка загрузки.') })
    }
    return new Promise((resolve) => {
      const requestId = 'wr-' + options.newId()
      const timer = setTimeout(() => settle(requestId, {
        ok: false,
        error: pageStatus === 'loading'
          ? 'Страница всё ещё загружается и не стала готова за время ожидания.'
          : 'Клиентский мост Web Reader не ответил на команду при открытой панели.'
      }), timeoutMs)
      pending.set(requestId, { action, sent: false, timer, resolve })
      flush()
    })
  }

  const registrationHandle = (): ReaderHostRegistration => ({
    conversationId: options.conversationId,
    registrationId: registration!,
    capabilities: shellCapabilities,
    run,
    beginDiagnostics: () => post({ kind: 'diagnostics-start', active: true }),
    endDiagnostics: () => post({ kind: 'diagnostics-start', active: false })
  })

  return {
    getStatus: () => status,
    registrationId: () => registration,
    setUrl(url) {
      if (disposed) return
      approvedUrl = url
      pageStatus = url ? 'loading' : 'empty'
      pageError = undefined
      syncPageStatus()
      post({ kind: 'set-url', url })
    },
    run,
    setInspector: (enabled) => post({ kind: 'inspector-state', enabled }),
    setRecording: (enabled) => post({ kind: 'recording-state', enabled }),
    beginDiagnostics: () => post({ kind: 'diagnostics-start', active: true }),
    endDiagnostics: () => post({ kind: 'diagnostics-start', active: false }),
    receive(message) {
      if (disposed || !isWebRecorderClientMessage(message)) return
      if (message.kind === 'ready') {
        shellCapabilities = message.capabilities
        if (message.registrationId !== null && message.registrationId === registration) {
          // Повтор handshake той же загрузки (например, remount при HMR) — init идемпотентен.
          sendInit()
          return
        }
        // Новый boot Reader: прежняя регистрация мертва вместе со своими pending.
        if (registration !== null) rejectAll('Web Reader перезагружен — повтори действие.')
        registration = options.newId()
        pageStatus = approvedUrl ? 'loading' : 'empty'
        pageError = undefined
        sendInit()
        syncPageStatus()
        options.onRegistration?.(registrationHandle())
        return
      }
      // Сообщения старого iframe, чужого разговора или устаревшей регистрации.
      if (message.conversationId !== options.conversationId || message.registrationId !== registration) return
      switch (message.kind) {
        case 'page-status':
          pageStatus = message.status
          pageError = message.error
          syncPageStatus()
          if (message.status === 'ready') flush()
          if (message.status === 'error') rejectAll('Сайт или страница недоступны: ' + (message.error ?? 'ошибка загрузки.'))
          return
        case 'result':
          settle(message.requestId, message.ok
            ? { ok: true, ...(message.result !== undefined ? { result: message.result } : {}) }
            : { ok: false, error: message.error ?? 'Действие в превью не выполнено.' })
          return
        case 'save-url':
          options.onSaveUrl?.(message.url)
          return
        case 'element-selected':
          options.onElement?.(message.element)
          return
        case 'recording-step':
          options.onRecordingStep?.(message.step)
          return
        case 'diagnostics-progress':
          options.onDiagnosticsProgress?.({ requestId: message.requestId, action: message.action, ok: message.ok, durationMs: message.durationMs })
          return
        case 'diagnostics-complete':
        case 'disposed':
          return
      }
    },
    dispose() {
      if (disposed) return
      post({ kind: 'dispose' })
      disposed = true
      rejectAll('Панель Web Reader закрыта.')
      registration = null
      setStatus('disposed')
      options.onRegistration?.(null)
    }
  }
}
