import { isPreviewAction, resolvePreviewUrl, type PreviewAction, type PreviewActionResult, type PreviewPageOutline } from '@shared/previewActions'
import { browserUrlMatches } from '@shared/browserWaiting'
import type { PreviewElementPayload } from '@shared/previewInspector'
import {
  WEB_RECORDER_MESSAGE_TYPE,
  WEB_RECORDER_PROTOCOL_VERSION,
  isWebRecorderClientMessage,
  type WebRecorderAreaScreenshot,
  type WebRecorderHostMessage,
  type WebRecorderPageStatus,
  type WebRecorderScenarioStep
} from '@shared/webRecorder'

// Реэкспорт для host: тип снимка области без прямого импорта @shared/webRecorder.
export type { WebRecorderAreaScreenshot } from '@shared/webRecorder'

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
  /** Заголовок готовой страницы (null — страницы нет): host показывает его на мобильной вкладке. */
  onPageTitle?: (title: string | null) => void
  /** Пользователь выделил текст на странице и просит спросить о нём ассистента. */
  onAsk?: (text: string) => void
  /** Пользователь взял управление страницей (true) или вернул его ассистенту (false). */
  onControl?: (manual: boolean) => void
  /** Модель ждёт человека: вопрос с вариантами ответа или переданный ему шаг (null — ожидание кончилось). */
  onWaitingForPerson?: (waiting: { kind: 'question' | 'handover'; text: string; options?: string[]; since: number } | null) => void
  /** Ассистент оставил человеку заметку в панели. */
  onNotes?: (notes: { text: string; url: string | null; at: number }[]) => void
  /** Закладки сеанса изменились: панель показывает тот же список, что видит модель. */
  onBookmarks?: (bookmarks: { url: string; label: string; at: number }[]) => void
  /** Ход выполнения последовательности: какой шаг идёт сейчас. */
  onSequenceProgress?: (progress: { done: number; total: number; action: PreviewAction } | null) => void
  onElement?: (element: PreviewElementPayload) => void
  onRecordingStep?: (step: WebRecorderScenarioStep) => void
  /** Снимок области, выделенной пользователем в Reader. */
  onAreaScreenshot?: (shot: WebRecorderAreaScreenshot) => void
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
  /** Ответ человека на вопрос модели; отказ (null) означает «не сейчас». */
  answerQuestion(answer: string | null): void
  /** Человек вернул управление после handover. */
  finishHandover(): void
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
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs! > 0
    ? Math.min(options.timeoutMs!, 120_000) : DEFAULT_TIMEOUT_MS
  let requestSequence = 0
  let diagnosticsMode = false
  const pending = new Map<string, PendingEntry>()
  let registration: string | null = null
  let shellCapabilities: readonly string[] = []
  // Мост создаётся адаптером вместе с монтированием iframe, поэтому стартует
  // с booting; 'unmounted' описывает состояние до создания моста.
  let status: ReaderHostStatus = 'booting'
  let pageStatus: WebRecorderPageStatus = 'empty'
  let pageError: string | undefined
  let approvedUrl: string | null = null
  // Заголовок готовой страницы: open отвечает им сразу, без отдельного read ради названия.
  let pageTitle: string | undefined
  let pageOutline: PreviewPageOutline | undefined
  // Куда ходила панель в этом разговоре: status отвечает историей, как вкладка браузера помнит путь.
  const history: string[] = []
  // Заголовки посещённых страниц: back {to} ищет по ним так же, как человек ищет вкладку по названию.
  const visited: { url: string; title: string }[] = []
  const remember = (url: string | null, title?: string): void => {
    if (!url) return
    if (history[0] !== url) { history.unshift(url); if (history.length > 5) history.length = 5 }
    const known = visited.find(item => item.url === url)
    if (known) { if (title) known.title = title; return }
    visited.unshift({ url, title: title ?? '' }); if (visited.length > 20) visited.length = 20
  }
  let manual = false
  let viewport: { width: number; height: number } | undefined
  // Последнее завершённое действие: модель после паузы спрашивает status и продолжает с того места.
  let lastAction: { kind: string; ok: boolean; at: number; error?: string } | undefined
  // Заметки ассистента человеку и начало сеанса: из них собирается человеческий отчёт.
  const notes: { text: string; url: string | null; at: number }[] = []
  const sessionStart = Date.now()
  /** Callback заметок объявлен отдельно: панель показывает их сразу, не дожидаясь отчёта. */
  // Вопрос человеку или переданный ему шаг: панель ждёт, модель стоит.
  let waiting: { kind: 'question' | 'handover'; text: string; since: number; settle: (answer: string | null) => void } | null = null
  const questions: { question: string; answer?: string; answered: boolean; at: number }[] = []
  // Закладки сеанса: человек и модель кладут их на страницы, к которым вернутся.
  const bookmarks: { url: string; label: string; at: number }[] = []
  // Журнал проверок и счётчик действий: report собирает из них отчёт по задаче.
  const checks: { summary: string; pass: boolean; at: number; url: string | null }[] = []
  let actionsCount = 0
  let disposed = false
  let navigationGeneration = 0
  let inspectorMode: boolean | undefined
  let recordingMode: boolean | undefined

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
  const post = (message: HostMessageBody): boolean => {
    if (registration === null || disposed) return false
    try {
      options.send({ type: WEB_RECORDER_MESSAGE_TYPE, conversationId: options.conversationId, registrationId: registration, ...message } as WebRecorderHostMessage)
      return true
    } catch {
      pageStatus = 'error'
      pageError = 'Не удалось передать команду в Web Reader.'
      rejectAll(pageError)
      syncPageStatus()
      return false
    }
  }
  const settle = (requestId: string, outcome: PreviewActionOutcome): void => {
    const entry = pending.get(requestId)
    if (!entry) return
    clearTimeout(entry.timer)
    pending.delete(requestId)
    if (entry.action.kind !== 'status') { lastAction = { kind: entry.action.kind, ok: outcome.ok, at: Date.now(), ...(outcome.error ? { error: outcome.error.slice(0, 200) } : {}) }; actionsCount++ }
    const checked = entry.action.kind === 'check' && outcome.ok ? outcome.result as { summary?: unknown; pass?: unknown } | undefined : undefined
    if (checked && typeof checked.summary === 'string') { checks.push({ summary: checked.summary.slice(0, 200), pass: checked.pass === true, at: Date.now(), url: approvedUrl }); if (checks.length > 50) checks.shift() }
    entry.resolve(outcome)
  }
  const rejectAll = (error: string): void => {
    for (const requestId of [...pending.keys()]) settle(requestId, { ok: false, error })
  }
  const flush = (): void => {
    if (registration === null || disposed) return
    for (const [requestId, entry] of pending) {
      if (entry.sent || entry.action.kind !== 'viewport' && pageStatus !== 'ready') continue
      // open резолвится готовностью целевой страницы, в iframe не пересылается.
      if (entry.action.kind === 'open') {
        // Итоговый адрес не совпал с запрошенным — сайт перенаправил; модели важно это знать.
        const finalUrl = approvedUrl ?? entry.action.url
        // Смена сайта заметна человеку по адресной строке — отмечаем её и для модели.
        const hostOf = (value: string | null): string => { try { return value ? new URL(value).host : '' } catch { return '' } }
        const previousHost = hostOf(history[1] ?? null)
        const crossSite = Boolean(previousHost) && hostOf(finalUrl) !== previousHost
        const opened = { url: finalUrl, ...(pageTitle ? { title: pageTitle } : {}), ...(pageOutline ? { outline: pageOutline } : {}), ...(finalUrl !== entry.action.url ? { redirected: true } : {}), ...(crossSite ? { crossSite: true } : {}) }
        const waitFor = entry.action.waitFor
        if (waitFor) {
          // open + wait одним действием: страница готова, теперь дождаться нужного текста.
          const pendingEntry = entry
          pending.delete(requestId)
          clearTimeout(pendingEntry.timer)
          void run({ kind: 'wait', text: waitFor, timeoutMs: 8000 }).then((waited) => pendingEntry.resolve({ ok: true, result: { ...opened, waited: { text: waitFor, found: waited.ok, ...(waited.ok ? {} : { error: waited.error ?? 'не дождались' }) } } }))
          continue
        }
        settle(requestId, { ok: true, result: opened })
        continue
      }
      entry.sent = true
      if (!post({ kind: 'command', requestId, action: entry.action })) break
    }
  }
  const sendInit = (): boolean => {
    return post({
      kind: 'init',
      protocolVersion: WEB_RECORDER_PROTOCOL_VERSION,
      previewUrl: approvedUrl,
      capabilities: options.capabilities ?? []
    })
  }

  const run: PreviewActionRunner = (input) => {
    if (!isPreviewAction(input)) return Promise.resolve({ ok: false, error: 'Некорректное действие Web Reader.' })
    let action: PreviewAction
    try { action = structuredClone(input) }
    catch { return Promise.resolve({ ok: false, error: 'Не удалось скопировать действие Web Reader.' }) }
    // status отвечает мост сам: вопрос «что с панелью» не должен зависеть от готовности страницы.
    if (action.kind === 'status') {
      const connected = !disposed && registration !== null
      return Promise.resolve({ ok: true, result: {
        connected, pageStatus: connected ? pageStatus : 'empty',
        page: connected && approvedUrl && pageStatus !== 'empty' ? { url: approvedUrl, title: pageTitle ?? '' } : null,
        ...(pageStatus === 'error' && pageError ? { error: pageError } : {}),
        ...(history.length ? { history: [...history] } : {}),
        ...(manual ? { manual: true } : {}),
        ...(viewport ? { viewport } : {}),
        ...(pending.size ? { pending: pending.size } : {}),
        ...(lastAction ? { lastAction } : {}),
        ...(checks.length ? { checks: { passed: checks.filter((item) => item.pass).length, failed: checks.filter((item) => !item.pass).length } } : {}),
        ...(pageOutline && pageStatus === 'ready' ? { outline: pageOutline } : {}),
        ...(bookmarks.length ? { bookmarks: [...bookmarks] } : {}),
        ...(waiting ? { waitingFor: { kind: waiting.kind, text: waiting.text, since: waiting.since } } : {}),
        actions: actionsCount, since: sessionStart
      } })
    }
    // waitFor у действия: после успеха дождаться текста тем же ходом, как у open.
    if ('waitFor' in action && typeof action.waitFor === 'string' && action.waitFor && action.kind !== 'open') {
      const { waitFor, ...rest } = action
      return run(rest as PreviewAction).then(async (outcome) => {
        if (!outcome.ok) return outcome
        const waited = await run({ kind: 'wait', text: waitFor, timeoutMs: 8000 })
        return { ok: true, result: { ...(outcome.result as object), waited: { text: waitFor, found: waited.ok, ...(waited.ok ? {} : { error: waited.error ?? 'не дождались' }) } } as PreviewActionResult }
      })
    }
    // Последовательность: шаги идут друг за другом через тот же run, стоп на первой ошибке.
    if (action.kind === 'sequence') {
      const steps = action.steps
      return (async (): Promise<PreviewActionOutcome> => {
        const results: { kind: string; ok: boolean; error?: string; summary?: string }[] = []
        let lastPage: { url: string; title: string } | null = null
        for (let index = 0; index < steps.length; index++) {
          const step = steps[index]!
          options.onSequenceProgress?.({ done: index, total: steps.length, action: step })
          const outcome = await run(step)
          const result = outcome.result as { page?: { url: string; title: string }; summary?: unknown } | undefined
          if (result?.page) lastPage = result.page
          results.push({ kind: step.kind, ok: outcome.ok, ...(outcome.error ? { error: outcome.error } : {}), ...(typeof result?.summary === 'string' ? { summary: result.summary } : {}) })
          // Чек-лист проверок проходит до конца; обычная рутина останавливается на первом сбое.
          if (!outcome.ok && !action.continueOnError) break
        }
        options.onSequenceProgress?.(null)
        const completed = results.filter((item) => item.ok).length
        const failed = results.map((item, index) => ({ item, index })).filter(({ item }) => !item.ok)
        const error = failed.length ? failed.map(({ item, index }) => `Шаг ${index + 1} из ${steps.length} (${item.kind}): ${item.error ?? 'не выполнен'}`).join('; ') : undefined
        return { ok: completed === steps.length, result: { page: lastPage, steps: results, completed, total: steps.length }, ...(error ? { error } : {}) }
      })()
    }
    // back {to} — «вернись на страницу поиска»: мост знает адреса и заголовки этого сеанса и открывает найденный.
    if (action.kind === 'back' && action.to) {
      const needle = action.to.trim().toLowerCase()
      const match = visited.find(item => item.url !== approvedUrl && (item.url.toLowerCase().includes(needle) || item.title.toLowerCase().includes(needle)))
      if (!match) return Promise.resolve({ ok: false, error: `Страницы «${action.to}» не было в этом сеансе. Открытые адреса: ${visited.map(item => item.title || item.url).slice(0, 5).join(', ') || 'нет'}.` })
      return run({ kind: 'open', url: match.url })
    }
    if (action.kind === 'report') {
      const page = approvedUrl && pageStatus !== 'empty' ? { url: approvedUrl, title: pageTitle ?? '' } : null
      const passed = checks.filter((item) => item.pass).length, failed = checks.filter((item) => !item.pass).length
      const durationMs = Date.now() - sessionStart
      const result = {
        page, history: [...history], checks: [...checks], passed, failed, actions: actionsCount, durationMs,
        ...(lastAction ? { lastAction } : {}), ...(bookmarks.length ? { bookmarks: [...bookmarks] } : {}),
        ...(questions.length ? { questions: [...questions] } : {}), ...(notes.length ? { notes: [...notes] } : {})
      }
      // Готовый текст отчёта: человек читает его как есть, а модель вкладывает в ответ без пересказа.
      if (!action.readable) return Promise.resolve({ ok: true, result })
      const minutes = Math.max(1, Math.round(durationMs / 60_000))
      const lines = [
        `Сеанс Web Reader: ${minutes} мин, действий — ${actionsCount}.`,
        page ? `Открыто сейчас: ${page.title || page.url} (${page.url}).` : 'Страница сейчас не открыта.',
        history.length > 1 ? `Были на страницах: ${history.slice(0, 5).join(', ')}.` : '',
        checks.length ? `Проверок: ${checks.length}, пройдено ${passed}, не пройдено ${failed}.` : '',
        ...checks.filter((item) => !item.pass).slice(0, 5).map((item) => `Не прошло: ${item.summary}`),
        ...questions.slice(0, 5).map((item) => item.answered ? `Спросил «${item.question}» — ответ: ${item.answer ?? ''}` : `Спросил «${item.question}» — без ответа`),
        ...notes.slice(0, 10).map((item) => `Заметка: ${item.text}`),
        bookmarks.length ? `Закладки: ${bookmarks.map((item) => item.label).join(', ')}.` : ''
      ].filter(Boolean)
      return Promise.resolve({ ok: true, result: { ...result, text: lines.join('\n') } })
    }
    // Пока панель ждёт человека, действовать за его спиной нельзя: так не делает и человек, задавший вопрос.
    // status и report отвечены выше по потоку, поэтому здесь остаются только действия над страницей.
    if (waiting && action.kind !== 'question' && action.kind !== 'handover') {
      return Promise.resolve({ ok: false, error: `Панель ждёт человека: «${waiting.text}». Дождись ответа и продолжай.` })
    }
    // Вопрос человеку и передача шага — дело панели: страница о них не знает, а модель ждёт живого ответа.
    if (action.kind === 'question' || action.kind === 'handover') {
      if (waiting) return Promise.resolve({ ok: false, error: `Панель уже ждёт человека: «${waiting.text}». Дождись ответа.` })
      const page = approvedUrl && pageStatus !== 'empty' ? { url: approvedUrl, title: pageTitle ?? '' } : null
      const text = action.kind === 'question' ? action.question : action.reason
      const timeout = Math.min(action.timeoutMs ?? 120_000, 600_000)
      const started = Date.now()
      return new Promise((resolve) => {
        const finish = (answer: string | null): void => {
          if (waiting?.settle !== finish) return
          clearTimeout(timer)
          waiting = null
          options.onWaitingForPerson?.(null)
          const waitedMs = Date.now() - started
          if (action.kind === 'question') {
            questions.push({ question: text, ...(answer === null ? {} : { answer }), answered: answer !== null, at: Date.now() })
            if (questions.length > 50) questions.shift()
            resolve({ ok: true, result: { page, question: text, answered: answer !== null, ...(answer === null ? {} : { answer }), waitedMs } })
            return
          }
          resolve({ ok: true, result: { page, reason: text, returned: answer !== null, waitedMs } })
        }
        const timer = setTimeout(() => finish(null), timeout)
        waiting = { kind: action.kind === 'question' ? 'question' : 'handover', text, since: started, settle: finish }
        options.onWaitingForPerson?.({ kind: waiting.kind, text, ...(action.kind === 'question' && action.options ? { options: [...action.options] } : {}), since: started })
      })
    }
    if (action.kind === 'note') {
      const page = approvedUrl && pageStatus !== 'empty' ? { url: approvedUrl, title: pageTitle ?? '' } : null
      notes.push({ text: action.text.trim().slice(0, 500), url: approvedUrl, at: Date.now() })
      if (notes.length > 30) notes.shift()
      options.onNotes?.([...notes])
      return Promise.resolve({ ok: true, result: { page, notes: [...notes] } })
    }
    // Закладка — дело панели, а не страницы: человек видит тот же список, что и модель.
    if (action.kind === 'bookmark') {
      const page = approvedUrl && pageStatus !== 'empty' ? { url: approvedUrl, title: pageTitle ?? '' } : null
      const removing = action.remove
      if (removing) {
        const index = bookmarks.findIndex(item => item.url === removing || item.label === removing)
        if (index < 0) return Promise.resolve({ ok: false, error: `Закладки «${removing}» нет. Сейчас: ${bookmarks.map(item => item.label).join(', ') || 'ни одной'}.` })
        const [removed] = bookmarks.splice(index, 1)
        options.onBookmarks?.([...bookmarks])
        return Promise.resolve({ ok: true, result: { page, bookmarks: [...bookmarks], removed } })
      }
      if (!page) return Promise.resolve({ ok: false, error: 'Страница не открыта — закладывать нечего.' })
      const label = (action.label ?? page.title ?? '').trim().slice(0, 120) || page.url
      const known = bookmarks.find(item => item.url === page.url)
      if (known) { known.label = label; options.onBookmarks?.([...bookmarks]); return Promise.resolve({ ok: true, result: { page, bookmarks: [...bookmarks], added: known } }) }
      const added = { url: page.url, label, at: Date.now() }
      bookmarks.push(added); if (bookmarks.length > 20) bookmarks.shift()
      options.onBookmarks?.([...bookmarks])
      return Promise.resolve({ ok: true, result: { page, bookmarks: [...bookmarks], added } })
    }
    // check {url|title} — про адрес и заголовок панели: мост отвечает сам, страница не нужна.
    if (action.kind === 'check' && !action.selector && !action.text && (action.url !== undefined || action.title !== undefined)) {
      const page = approvedUrl && pageStatus !== 'empty' ? { url: approvedUrl, title: pageTitle ?? '' } : null
      const urlOk = action.url === undefined || Boolean(page && browserUrlMatches(page.url, action.url))
      const titleOk = action.title === undefined || Boolean(page && page.title.toLowerCase().includes(action.title.toLowerCase()))
      const pass = Boolean(page) && urlOk && titleOk
      const summary = !page ? 'Страница не открыта' : !urlOk ? `Адрес ${page.url} не совпал с ${action.url}` : !titleOk ? `Заголовок «${page.title}» не содержит «${action.title}»` : action.url !== undefined ? `Адрес ${page.url} совпал` : `Заголовок содержит «${action.title}»`
      checks.push({ summary, pass, at: Date.now(), url: approvedUrl }); if (checks.length > 50) checks.shift()
      return Promise.resolve({ ok: true, result: { page: page ?? { url: '', title: '' }, pass, expected: { state: 'present' as const, ...(action.url !== undefined ? { url: action.url } : {}), ...(action.title !== undefined ? { title: action.title } : {}) }, actual: { count: page ? 1 : 0, visible: page ? 1 : 0, ...(page ? { value: page.title } : {}) }, summary } as never })
    }
    // wait {url} — про адрес панели, а не про DOM: мост знает подтверждённый адрес и ждёт его сам.
    if (action.kind === 'wait' && action.url && !action.selector && !action.text) {
      const pattern = action.url, timeout = Math.min(action.timeoutMs ?? 5000, 30_000), started = Date.now()
      return new Promise((resolve) => {
        const check = (): void => {
          if (disposed) { resolve({ ok: false, error: 'Панель Web Reader закрыта.' }); return }
          if (approvedUrl && pageStatus === 'ready' && browserUrlMatches(approvedUrl, pattern)) { resolve({ ok: true, result: { page: { url: approvedUrl, title: pageTitle ?? '' }, waitedMs: Date.now() - started } }); return }
          if (Date.now() - started >= timeout) { resolve({ ok: false, error: `Адрес не стал ${pattern} за ${timeout} мс: сейчас ${approvedUrl ?? 'страницы нет'}.` }); return }
          setTimeout(check, 150)
        }
        check()
      })
    }
    if (disposed) return Promise.resolve({ ok: false, error: 'Панель Web Reader закрыта.' })
    if (registration === null) return Promise.resolve({ ok: false, error: 'Панель Web Reader не открыта или ещё не подключена.' })
    if (action.kind === 'open') {
      // Относительный путь — от страницы, которая открыта сейчас: так пользователь переходит по сайту.
      const resolved = resolvePreviewUrl(action.url, approvedUrl)
      if (!resolved) return Promise.resolve({ ok: false, error: 'Относительный адрес требует открытой страницы: сначала open с полным http(s) адресом.' })
      action = { ...action, url: resolved }
      rejectAll('Открывается другая страница — повтори действие.')
    }
    if (pageStatus === 'empty' && action.kind !== 'open' && action.kind !== 'viewport') {
      return Promise.resolve({ ok: false, error: 'Панель открыта, но в ней нет страницы — сначала вызови open.' })
    }
    if (pageStatus === 'error' && action.kind !== 'open' && action.kind !== 'viewport') {
      return Promise.resolve({ ok: false, error: 'Сайт или страница недоступны: ' + (pageError ?? 'ошибка загрузки.') })
    }
    if (pending.size >= 64) return Promise.resolve({ ok: false, error: 'Слишком много ожидающих действий Reader. Дождитесь завершения.' })
    return new Promise((resolve) => {
      const requestId = 'wr-' + options.newId() + '-' + ++requestSequence
      const timer = setTimeout(() => settle(requestId, {
        ok: false,
        error: pageStatus === 'loading'
          ? 'Страница всё ещё загружается и не стала готова за время ожидания.'
          : 'Клиентский мост Web Reader не ответил на команду при открытой панели.'
      }), timeoutMs)
      pending.set(requestId, { action, sent: false, timer, resolve })
      if (action.kind === 'open') {
        const generation = ++navigationGeneration
        const registered = registration
        pageStatus = 'loading'
        pageError = undefined
        approvedUrl = action.url
        syncPageStatus()
        if (!post({ kind: 'set-url', url: null })) return
        // Микрозадача прежнего open не должна оживлять отменённую навигацию.
        queueMicrotask(() => {
          if (disposed || !pending.has(requestId) || generation !== navigationGeneration || registered !== registration) return
          post({ kind: 'set-url', url: action.url })
        })
      }
      flush()
    })
  }

  const registrationHandle = (): ReaderHostRegistration => {
    const id = registration!
    const current = (): boolean => !disposed && id === registration
    return {
      conversationId: options.conversationId,
      registrationId: id,
      capabilities: shellCapabilities,
      run: action => current() ? run(action) : Promise.resolve({ ok: false, error: 'Регистрация Web Reader устарела — повтори действие.' }),
      beginDiagnostics: () => { if (current()) { diagnosticsMode = true; post({ kind: 'diagnostics-start', active: true }) } },
      endDiagnostics: () => { if (current()) { diagnosticsMode = false; post({ kind: 'diagnostics-start', active: false }) } }
    }
  }

  return {
    getStatus: () => status,
    registrationId: () => registration,
    setUrl(url) {
      if (disposed || url === approvedUrl && pageStatus !== 'error') return
      navigationGeneration++
      if (url === null || url !== approvedUrl) rejectAll(url ? 'Адрес страницы изменён — повтори действие.' : 'Страница закрыта.')
      approvedUrl = url
      pageStatus = url ? 'loading' : 'empty'
      pageError = undefined
      syncPageStatus()
      post({ kind: 'set-url', url })
    },
    run,
    answerQuestion: (answer) => { waiting?.settle(answer) },
    finishHandover: () => { if (waiting?.kind === 'handover') waiting.settle('готово') },
    setInspector: (enabled) => { inspectorMode = enabled; post({ kind: 'inspector-state', enabled }) },
    setRecording: (enabled) => { recordingMode = enabled; post({ kind: 'recording-state', enabled }) },
    beginDiagnostics: () => { diagnosticsMode = true; post({ kind: 'diagnostics-start', active: true }) },
    endDiagnostics: () => { diagnosticsMode = false; post({ kind: 'diagnostics-start', active: false }) },
    receive(message) {
      if (disposed || !isWebRecorderClientMessage(message)) return
      if (message.kind === 'ready') {
        if (message.conversationId !== null && message.conversationId !== options.conversationId) return
        shellCapabilities = message.capabilities
        if (message.registrationId !== null && message.registrationId === registration) {
          // Повтор handshake той же загрузки (например, remount при HMR) — init идемпотентен.
          sendInit()
          return
        }
        // Новый boot Reader: прежняя регистрация мертва вместе со своими pending.
        if (registration !== null) rejectAll('Web Reader перезагружен — повтори действие.')
        navigationGeneration++
        registration = options.newId()
        manual = false
        pageStatus = approvedUrl ? 'loading' : 'empty'
        pageError = undefined
        if (!sendInit()) return
        if (inspectorMode !== undefined && !post({ kind: 'inspector-state', enabled: inspectorMode })) return
        if (recordingMode !== undefined && !post({ kind: 'recording-state', enabled: recordingMode })) return
        if (diagnosticsMode && !post({ kind: 'diagnostics-start', active: true })) return
        syncPageStatus()
        options.onRegistration?.(registrationHandle())
        return
      }
      // Сообщения старого iframe, чужого разговора или устаревшей регистрации.
      if (message.conversationId !== options.conversationId || message.registrationId !== registration) return
      switch (message.kind) {
        case 'page-status':
          // Промежуточный reset open не означает, что пользователь закрыл страницу.
          if (message.status === 'empty' && approvedUrl !== null && [...pending.values()].some(entry => entry.action.kind === 'open')) return
          pageStatus = message.status
          pageError = message.error
          pageTitle = message.status === 'ready' && typeof message.title === 'string' && message.title ? message.title : undefined
          pageOutline = message.status === 'ready' ? message.outline : undefined
          if (message.status === 'ready' && message.viewport) viewport = message.viewport
          if (message.status === 'ready' || message.status === 'empty') options.onPageTitle?.(pageTitle ?? null)
          syncPageStatus()
          if (message.status === 'ready') {
            const changed = message.url !== approvedUrl
            approvedUrl = message.url
            remember(message.url, pageTitle)
            if (changed) options.onSaveUrl?.(message.url)
            flush()
          }
          if (message.status === 'empty' && approvedUrl === null) rejectAll('Страница закрыта.')
          if (message.status === 'error') rejectAll('Сайт или страница недоступны: ' + (message.error ?? 'ошибка загрузки.'))
          return
        case 'result':
          if (!pending.get(message.requestId)?.sent) return
          settle(message.requestId, message.ok
            ? { ok: true, ...(message.result !== undefined ? { result: message.result } : {}) }
            : { ok: false, error: message.error ?? 'Действие в превью не выполнено.' })
          return
        case 'ask':
          options.onAsk?.(message.text)
          return
        case 'control':
          manual = message.manual
          options.onControl?.(message.manual)
          return
        case 'save-url':
          if (message.url !== approvedUrl) { navigationGeneration++; rejectAll('Адрес страницы изменён пользователем — повтори действие.') }
          approvedUrl = message.url
          if (message.url === null) { pageStatus = 'empty'; syncPageStatus(); rejectAll('Страница закрыта.') }
          options.onSaveUrl?.(message.url)
          return
        case 'element-selected':
          options.onElement?.(message.element)
          return
        case 'recording-step':
          options.onRecordingStep?.(message.step)
          return
        case 'area-screenshot':
          options.onAreaScreenshot?.(message.shot)
          return
        case 'diagnostics-progress':
          options.onDiagnosticsProgress?.({ requestId: message.requestId, action: message.action, ok: message.ok, durationMs: message.durationMs })
          return
        case 'diagnostics-complete':
          return
        case 'disposed':
          disposed = true
          navigationGeneration++
          rejectAll('Панель Web Reader закрыта.')
          registration = null
          setStatus('disposed')
          options.onRegistration?.(null)
          return
      }
    },
    dispose() {
      if (disposed) return
      // Незаконченный вопрос отпускаем: иначе ход модели висит до таймаута уже закрытой панели.
      waiting?.settle(null)
      rejectAll('Панель Web Reader закрыта.')
      post({ kind: 'dispose' })
      disposed = true
      navigationGeneration++
      registration = null
      setStatus('disposed')
      options.onRegistration?.(null)
    }
  }
}
