import type { BrowserSessionPaneProps } from '../panelContract'
export type { BrowserSessionPaneProps } from '../panelContract'
import { BrowserDownloadsPane } from './BrowserDownloadsPane'
import { BrowserSiteDialog } from './BrowserSiteDialog'
import { frameKeyAction, frameWheelDelta, remainingTypedDraft } from '../lib/browserInput'
import { fitScale, frameWidth, nextFrameZoom, panelShortcut, pinchDistance, touchScrollDelta, TOUCH_TAP_SLOP, type FrameZoom } from '../lib/frameView'
import { isBrowserSiteDataResetResult } from '@shared/browserProfile'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { isBrowserSessionMetadata, scaleBrowserCoordinates, type BrowserConsoleEntry, type BrowserCookieInfo, type BrowserDeviceState, type BrowserElementDescription, type BrowserEnvironmentState, type BrowserInspectResult, type BrowserNetworkEntry, type BrowserSelectorResult, type BrowserSessionMetadata, type BrowserViewport } from '@shared/types'
import { ambiguousSteps, brokenSteps, expectOnStep, fragileSteps, hasAssertions, loadScenario, moveStep, needsWaitHint, recordPointerClick, recordNavigate, recordScroll, recordType, removeStep, renameStep, toggleStep, toScenario, type ClickKind, type RecordedStep } from '../lib/scenarioRecorder'
import { aliasNote, isWebAddress, offOrigin, pushHistory } from '../lib/readerAddress'
import type { RendererBrowserBridge } from '@shared/ipc'
import type { ProjectTestUser } from '@shared/projects'
import { scenarioLabel } from '@shared/qa'
import { runScenarioStep, scenarioCommandError, scenarioProblems, stepHint } from '@shared/scenarioStep'
import { Button, EmptyState, IconButton } from '@voicechat/ui-kit'

// Панель Playwright Reader: живой изолированный Chromium разговора. В отличие от
// WebReaderFrame (iframe поверх /api/preview), здесь настоящий браузер на сервере —
// поэтому берёт сайты, которые прокси не поднимает (history-роутерные SPA).
//
// Screencast — поллинг скриншотов: кадр тянется таймером, пока сессия готова, и
// сразу после каждой команды. Ввод: клик по кадру пересчитывается в координаты
// вьюпорта (scaleBrowserCoordinates) и уходит командой input, набор текста — type.
// Оркестрацию (старт/жизнь/остановку Chromium) держит сервер; incarnation из
// start отсекает команды к пересозданной сессии.

const VIEWPORT: BrowserViewport = { width: 1280, height: 800, deviceScaleFactor: 1 }
/**
 * Кадры тянутся поллингом. Сразу после действия страница ещё меняется, поэтому
 * первые секунды опрашиваем чаще, потом возвращаемся к спокойному интервалу.
 * Скрытая вкладка не опрашивается вовсе: раньше таймер тикал всегда и жёг
 * трафик и Chromium, пока человек работал в другом окне.
 */
const POLL_MS = 1200
const POLL_ACTIVE_MS = 400
const ACTIVE_WINDOW_MS = 4000

/** Размеры для проверки адаптива: те же, на которых мы смотрим свои экраны. */
const VIEWPORTS: ReadonlyArray<{ id: 'phone' | 'tablet' | 'desktop'; label: string; viewport: BrowserViewport }> = [
  { id: 'phone', label: 'Телефон', viewport: { width: 390, height: 844, deviceScaleFactor: 1 } },
  { id: 'tablet', label: 'Планшет', viewport: { width: 820, height: 1180, deviceScaleFactor: 1 } },
  { id: 'desktop', label: 'Десктоп', viewport: VIEWPORT }
]

/** Сколько держать палец, чтобы это стало правым кликом — как в мобильных браузерах. */
const LONG_PRESS_MS = 550
/** Промежуток между двумя тапами, который страница считает двойным кликом. */
const DOUBLE_TAP_MS = 320
/** Сколько после касания клик считается тапом, а не щелчком мыши. */
const TOUCH_CLICK_WINDOW_MS = 700

/**
 * Масштаб — настройка экрана человека, а не свойство разговора: он одинаков и
 * при переключении чатов, и при повторном открытии панели. Живёт в модуле, а не
 * в хранилище браузера: своего порта предпочтений у панели нет, а обращаться к
 * хранилищу напрямую продуктовому пакету запрещает архитектурная проверка.
 */
let lastZoom: FrameZoom = 'fit'

/** Состояние сессии словами: сырое `ready`/`idle` человеку ничего не говорит. */
const STATE_LABELS: Record<string, string> = {
  idle: 'Простаивает', starting: 'Запуск Chromium…', ready: 'Готово',
  loading: 'Загружает страницу…', navigating: 'Переход…', stopped: 'Остановлена', error: 'Ошибка'
}

type Phase = 'starting' | 'ready' | 'unavailable' | 'error'

/**
 * Схема для адреса, набранного без протокола. Раньше подставлялся `https://`
 * всему подряд, и стенд по http (`89.125.68.35:8787`) превращался в неработающий
 * адрес. Явный порт — почти всегда простой http-сервис, поэтому для него https
 * не навязываем; для имени без порта https по-прежнему разумный выбор.
 */
export function withScheme(raw: string): string {
  const value = raw.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value
  const hasExplicitPort = /^[^/?#]+:\d+(?:[/?#]|$)/.test(value)
  return `${hasExplicitPort ? 'http' : 'https'}://${value}`
}

export function BrowserSessionPane(props: BrowserSessionPaneProps): JSX.Element {
  // Запись, черновики и поздние ответы принадлежат одному разговору. Новый key
  // сбрасывает их вместе, чтобы добавленный позднее state тоже не протекал.
  return <BrowserSessionPaneSession key={props.conversationId} {...props} />
}

function BrowserSessionPaneSession({ conversationId, browser, onAttachFrame, testUsers, onSaveScenario, savedScenarios, initialUrl, onPageChange }: BrowserSessionPaneProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>('starting')
  const [viewportId, setViewportId] = useState<'phone' | 'tablet' | 'desktop' | null>('desktop')
  // Навигация занимает секунды, а кадр всё это время старый: без отметки непонятно,
  // идёт работа или страница просто такая.
  const [busy, setBusy] = useState(false)
  // Момент последнего действия и счётчик перезапуска таймера: после команды
  // опрос ускоряется, через ACTIVE_WINDOW_MS возвращается к спокойному.
  const lastAction = useRef(0)
  const inputQueue = useRef<{ generation: number; promise: Promise<unknown> } | null>(null)
  const typingSubmission = useRef<number | null>(null)
  const busyRequests = useRef({ generation: 0, count: 0 })
  const [pollTick, setPollTick] = useState(0)
  const [retryable, setRetryable] = useState(false)
  /**
   * Разбор отказа от раннера: причина словами, совет и похожие элементы.
   * Человеку «Timeout 5000ms exceeded» говорит не больше, чем модели.
   */
  const [failure, setFailure] = useState<BrowserSelectorResult['failure'] | null>(null)
  const lastCommand = useRef<Parameters<RendererBrowserBridge['command']>[1]['command'] | null>(null)
  const [message, setMessage] = useState<string>('')
  // Журналы страницы: раннер копит их с открытия, но до круга 11 показать их
  // было негде — человек видел белый экран и не знал, что упал запрос.
  const [downloadsOpen, setDownloadsOpen] = useState(false)
  const [diagnostics, setDiagnostics] = useState<{ console: BrowserConsoleEntry[]; network: BrowserNetworkEntry[]; loading?: boolean; error?: string; truncated?: boolean; at?: number } | null>(null)
  const diagnosticRequest = useRef(0)
  const activeTab = useRef<string | undefined>(undefined)
  // Запись сценария: ради неё Reader и делается инструментом автотестов —
  // человек проходит путь руками, а на выходе воспроизводимые шаги.
  const [recording, setRecording] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const origin = useRef<string | null>(null)
  /** Последний описанный элемент — к нему привязывается записанный ввод текста. */
  const lastElement = useRef<BrowserElementDescription | null>(null)
  /** Когда записан прошлый шаг: длинная пауза значит, что человек ждал страницу. */
  const lastStepAt = useRef(0)
  /** Проставляет паузу последнему шагу — по ней потом подсказываем ожидание. */
  const withPause = (next: RecordedStep[]): RecordedStep[] => {
    const now = Date.now()
    const pauseMs = lastStepAt.current ? now - lastStepAt.current : 0
    lastStepAt.current = now
    return next.map((step, index) => (index === next.length - 1 ? { ...step, pauseMs } : step))
  }
  const [steps, setSteps] = useState<RecordedStep[]>([])
  const [expectText, setExpectText] = useState('')
  /** Шаг, к которому привяжется проверка; пусто — последний. */
  const [expectStepId, setExpectStepId] = useState('')
  // Результат прогона записанного сценария по шагам: цикл «записал → проверил →
  // поправил» иначе разорван — запись здесь, прогон на доске.
  const [stepResults, setStepResults] = useState<Record<string, { ok: boolean; detail: string }>>({})
  const [running, setRunning] = useState(false)
  /** Длительность последнего прогона: по ней прикидывают бюджет этапа. */
  const [replayMs, setReplayMs] = useState<number | null>(null)
  /** Имя записываемого сценария: в наборе их нечем различать. */
  const [scenarioName, setScenarioName] = useState('')
  const [meta, setMeta] = useState<BrowserSessionMetadata | null>(null)
  const activeDialog = meta?.dialogs?.find(dialog => dialog.tabId === meta.activeTabId)
  const dialogOpen = useRef(false)
  const [frame, setFrame] = useState<string | null>(null)
  const [address, setAddress] = useState<string>('')
  const addressDirty = useRef(false)
  const [frameError, setFrameError] = useState('')
  const frameFailures = useRef(0)
  const frameRevision = useRef(0)
  const frameRequest = useRef<{ generation: number; promise: Promise<void> } | null>(null)
  const [typing, setTyping] = useState<string>('')
  const incarnation = useRef<string | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  // Кадр вписан по ширине панели. На телефоне это десятая часть натурального
  // размера — читать нечем, поэтому масштаб отделён от раскладки.
  // Масштаб переживает переоткрытие панели: человек настраивает его под свой
  // экран один раз, а не заново в каждом разговоре.
  const [zoom, setZoom] = useState<FrameZoom>(lastZoom)
  const [fullscreen, setFullscreen] = useState(false)
  /** Поля формы глазами страницы: то же, что видит модель инструментом form-state. */
  const [formInfo, setFormInfo] = useState<{ loading?: boolean; error?: string; form?: BrowserSelectorResult['form']; validity?: BrowserSelectorResult['validity'] } | null>(null)
  /**
   * Поиск по странице. Ctrl+F внутри кадра ищет по странице приложения, а не по
   * той, что в Chromium: кадр — картинка, и найти в нём текст глазами на длинной
   * странице невозможно.
   */
  const [search, setSearch] = useState<{ open: boolean; query: string; matches: Array<{ selector: string; text: string }>; at: number; searching?: boolean; error?: string }>({ open: false, query: '', matches: [], at: 0 })
  const searchRef = useRef<HTMLInputElement>(null)
  /** Куда прокручена страница: «экранов ниже» отвечает на «это всё или начало». */
  const [metrics, setMetrics] = useState<BrowserSelectorResult['metrics'] | null>(null)
  /**
   * Среда, в которой якобы сидит человек: тёмная тема системы, отсутствие сети,
   * уменьшенная анимация, высокий контраст. Под каждой из них страница ведёт
   * себя иначе, а проверить это раньше было можно только на своей машине.
   */
  const [environment, setEnvironment] = useState<BrowserEnvironmentState | null>(null)
  const [environmentOpen, setEnvironmentOpen] = useState(false)
  /** Что страница считает об устройстве: тач, плотность пикселей, ориентация. */
  const [device, setDevice] = useState<BrowserDeviceState | null>(null)
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait')
  /**
   * Лента событий сессии. Человек смотрит на кадр и не понимает, что делает
   * модель: кадр показывает результат, а не намерение и не порядок шагов.
   */
  const [feedOpen, setFeedOpen] = useState(false)
  const [feedActor, setFeedActor] = useState<'all' | 'user' | 'assistant'>('all')
  const [cookies, setCookies] = useState<{ loading?: boolean; error?: string; items?: BrowserCookieInfo[]; total?: number } | null>(null)
  /** Хранилище сайта: тут живёт половина дефектов «у меня работает». */
  const [storage, setStorage] = useState<{ loading?: boolean; error?: string; data?: BrowserSelectorResult['storage'] } | null>(null)
  /** Правила сети: человеку они нужны там же, где модели, — и чтобы их снять. */
  const [networkRules, setNetworkRules] = useState<{ rules: Array<{ url: string; action: string; status?: number; delayMs?: number }>; total: number } | null>(null)
  /** Свайп пальцем: у телефона нет колеса, а страница длиннее одного экрана. */
  const touch = useRef<{ x: number; y: number; moved: boolean; pinch: number | null } | null>(null)
  /** Долгое нажатие вместо правой кнопки и двойной тап вместо двойного клика. */
  const longPress = useRef<{ timer: ReturnType<typeof setTimeout> | undefined; fired: boolean }>({ timer: undefined, fired: false })
  const lastTap = useRef(0)
  /** Когда экрана касались: двойной тап разбирается только для касаний. */
  const lastTouchAt = useRef(0)
  const addressRef = useRef<HTMLInputElement>(null)
  const paneRef = useRef<HTMLElement>(null)
  // Флаг актуальности: смена разговора или размонтирование отменяет поздние ответы.
  const alive = useRef(0)

  const openingUrl = useRef(initialUrl), pageCallback = useRef(onPageChange)
  openingUrl.current = initialUrl; pageCallback.current = onPageChange
  const savedPage = useRef<string | null>(initialUrl ?? null), addressFocused = useRef(false)
  const saveQueue = useRef(Promise.resolve())
  const observePage = useCallback((page: { url: string; title: string }): void => {
    let url = page.url
    try { const value = new URL(url); if (value.pathname === '/api/preview' && value.searchParams.has('url')) url = value.searchParams.get('url')! } catch { return }
    if (!/^https?:\/\//.test(url)) return
    if (!origin.current || origin.current === 'about:blank') origin.current = url
    setMeta(current => current ? { ...current, currentUrl: url, title: page.title, tabs: current.tabs.map(tab => tab.id === current.activeTabId ? { ...tab, url, title: page.title } : tab) } : current)
    setHistory(current => pushHistory(current, url))
    if (!addressFocused.current && !addressDirty.current) setAddress(url)
    if (savedPage.current === url) return
    savedPage.current = url
    const save = pageCallback.current, generation = alive.current
    saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
      if (generation !== alive.current) return
      try { await save?.(url) } catch {
        if (generation === alive.current) { if (savedPage.current === url) savedPage.current = null; setMessage('Не удалось сохранить адрес. Повторю при следующем обновлении страницы.') }
      }
    })
  }, [])


  const applyMeta = useCallback((next: BrowserSessionMetadata): void => {
    if (activeTab.current !== next.activeTabId || (incarnation.current && incarnation.current !== next.incarnation)) {
      diagnosticRequest.current++
      setDiagnostics(null)
    }
    activeTab.current = next.activeTabId ?? undefined
    incarnation.current = next.incarnation
    dialogOpen.current = Boolean(next.dialogs?.some(dialog => dialog.tabId === next.activeTabId))
    setMeta(next)
    if (next.currentUrl) observePage({ url: next.currentUrl, title: next.title ?? '' })
    setViewportId(VIEWPORTS.find(viewport => viewport.viewport.width === next.viewport.width && viewport.viewport.height === next.viewport.height)?.id ?? null)
    if (!addressDirty.current && !addressFocused.current) setAddress(isWebAddress(next.currentUrl) ? next.currentUrl : '')
    setHistory((current) => pushHistory(current, next.currentUrl))
    if (!origin.current && isWebAddress(next.currentUrl)) origin.current = next.currentUrl
  }, [observePage])

  const refreshFrame = useCallback((observe = false): Promise<void> => {
    if (!browser || !incarnation.current || (!observe && dialogOpen.current)) return Promise.resolve()
    const generation = alive.current
    if (frameRequest.current?.generation === generation) return frameRequest.current.promise
    const revision = frameRevision.current
    const currentIncarnation = incarnation.current
    const current = (): boolean => generation === alive.current && revision === frameRevision.current
    const request = { generation, promise: Promise.resolve() }
    // Отложенное начало гарантирует установку request даже если мост бросит
    // синхронно. За одну сессию одновременно запрашивается только один кадр.
    request.promise = Promise.resolve().then(async () => {
      try {
        let tabId: string | undefined
        if (observe) {
          const next = await browser.command(conversationId, { incarnation: currentIncarnation, command: { type: 'status' } })
          if (!current()) return
          if (isBrowserSessionMetadata(next)) {
            applyMeta(next)
            if (!next.activeTabId) { setFrame(null); frameFailures.current = 0; setFrameError(''); return }
            tabId = next.activeTabId
          }
        }
        if (dialogOpen.current) { frameFailures.current = 0; setFrameError(''); return }
        const shot = await browser.screenshot(conversationId, { incarnation: currentIncarnation, ...(tabId ? { tabId } : {}), format: 'jpeg', quality: 82 })
        if (current()) {
          setFrame(shot.dataUrl); frameFailures.current = 0; setFrameError('')
          if (shot.control) setMeta(value => value ? { ...value, control: shot.control, queuedCommands: shot.queuedCommands } : value)
          if (shot.page) observePage(shot.page)
        }
      } catch (err) {
        if (current() && ++frameFailures.current >= 3) setFrameError(`Кадр не обновляется: ${err instanceof Error ? err.message : 'нет связи с Chromium'}. Повторяем подключение…`)
      } finally {
        if (frameRequest.current === request) frameRequest.current = null
      }
    })
    frameRequest.current = request
    return request.promise
  }, [browser, conversationId, applyMeta, observePage])

  // Старт сессии на монтирование/смену разговора; stop — на уходе.
  useEffect(() => {
    const generation = ++alive.current
    busyRequests.current = { generation, count: 0 }; setBusy(false)
    incarnation.current = null
    setPhase('starting'); setFrame(null); setMeta(null); setMessage('')
    if (!browser) { setPhase('unavailable'); setMessage('Полный браузер недоступен на сервере. В Web Reader можно выбрать быстрый просмотр; для полного браузера требуется настройка администратором.'); return }
    void browser.start(conversationId).then(async started => {
      if (generation !== alive.current) return
      incarnation.current = started.incarnation
      if ((!started.currentUrl || started.currentUrl === 'about:blank') && openingUrl.current) {
        const next = await browser.command(conversationId, { incarnation: started.incarnation, command: { type: 'navigate', url: openingUrl.current } })
        if (generation !== alive.current) return
        if (isBrowserSessionMetadata(next)) started = next
      }
      applyMeta(started); setPhase('ready'); void refreshFrame()
    }).catch((err: unknown) => {
      if (generation !== alive.current) return
      const text = err instanceof Error ? err.message : 'Не удалось запустить Chromium'
      setPhase(/не настроен|недоступен/i.test(text) ? 'unavailable' : 'error'); setMessage(text)
    })
    return () => {
      alive.current++
      if (browser && incarnation.current) void browser.stop(conversationId).catch(() => undefined)
      incarnation.current = null
    }
  }, [browser, conversationId, refreshFrame])

  // Поллинг кадров, пока сессия готова и вкладка на экране.
  useEffect(() => {
    if (phase !== 'ready') return
    let timer: ReturnType<typeof setTimeout> | null = null
    let epoch = 0
    let disposed = false
    const stop = (): void => { epoch++; if (timer) { clearTimeout(timer); timer = null } }
    const schedule = (currentEpoch: number): void => {
      if (disposed || document.hidden || currentEpoch !== epoch) return
      const fresh = Date.now() - lastAction.current < ACTIVE_WINDOW_MS
      timer = setTimeout(() => {
        timer = null
        void refreshFrame(true).finally(() => schedule(currentEpoch))
      }, fresh ? POLL_ACTIVE_MS : POLL_MS)
    }
    const start = (): void => {
      stop()
      schedule(epoch)
    }
    const onVisibility = (): void => {
      stop()
      if (!document.hidden) {
        const currentEpoch = epoch
        void refreshFrame(true).finally(() => schedule(currentEpoch))
      }
    }
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { disposed = true; stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [phase, refreshFrame, pollTick])

  const run = useCallback(async (command: Parameters<RendererBrowserBridge['command']>[1]['command']): Promise<unknown> => {
    if (!browser || !incarnation.current) return
    const generation = alive.current
    frameRevision.current++
    if (busyRequests.current.generation !== generation) busyRequests.current = { generation, count: 0 }
    busyRequests.current.count++
    setBusy(true)
    setMessage(''); setRetryable(false); setFailure(null)
    lastCommand.current = command
    lastAction.current = Date.now()
    setPollTick((v) => v + 1)
    try {
      const request = { incarnation: incarnation.current, command }
      let next: unknown
      if (command.type === 'input') {
        const preceding = inputQueue.current?.generation === generation ? inputQueue.current.promise : Promise.resolve()
        const pending = preceding.catch(() => undefined).then(() => {
          if (generation !== alive.current) throw new Error('Сессия изменилась до выполнения ввода')
          return browser.command(conversationId, request)
        })
        inputQueue.current = { generation, promise: pending }
        next = await pending
      } else next = await browser.command(conversationId, request)
      if (generation !== alive.current) return
      // Метаданные приходят не на всякую команду: `selector` отдаёт чтение,
      // `inspect` — журналы. Обновляем состояние только по метаданным.
      if (command.type === 'handleDialog' && (!isBrowserSessionMetadata(next) || !Array.isArray(next.dialogs))) throw new Error('Сайт не подтвердил ответ. Обновите состояние и повторите.')
      // Селекторное действие отвечает значением: отказ не бросается исключением,
      // и без этой ветки человек видел бы просто «ничего не произошло».
      if (next && typeof next === 'object' && 'ok' in next && (next as { ok?: unknown }).ok === false) {
        const detail = next as { error?: string; failure?: BrowserSelectorResult['failure'] }
        setFailure(detail.failure ?? null)
        if (detail.error) setMessage(detail.failure?.reason ?? detail.error)
      }
      if (isBrowserSessionMetadata(next)) applyMeta(next)
      if (command.type !== 'cancel' && command.type !== 'control') await refreshFrame()
      return next
    } catch (err) {
      if (generation === alive.current) {
        const detail = err instanceof Error ? err.message : 'Команда не выполнена'
        setMessage(detail.startsWith('Открыт диалог ') ? 'Ответьте на диалог сайта, чтобы продолжить.' : detail)
        if (detail.startsWith('Открыт диалог ')) void refreshFrame(true)
        // `BrowserError.retryable` говорит, есть ли смысл в повторе. Раньше он
        // приходил и терялся: человеку показывали текст без выхода.
        const code = (err as { code?: unknown })?.code
        const retry = (err as { retryable?: unknown })?.retryable
        setRetryable(retry === true || code === 'timeout' || code === 'not_ready')
      }
      return { ok: false, error: err instanceof Error ? err.message : 'Команда не выполнена' }
    } finally {
      if (generation === alive.current) { busyRequests.current.count--; setBusy(busyRequests.current.count > 0) }
    }
  }, [browser, conversationId, refreshFrame, applyMeta])

  /** Координаты клика в системе вьюпорта: кадр показывается вписанным по ширине. */
  const pointFromEvent = (event: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const img = imgRef.current
    if (!img) return null
    const rect = img.getBoundingClientRect()
    const point = scaleBrowserCoordinates(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height, meta?.viewport ?? VIEWPORT)
    return { x: Math.round(point.x), y: Math.round(point.y) }
  }

  const clickAt = (event: ReactMouseEvent<HTMLImageElement>, button: 'left' | 'right', clickCount: 1 | 2): void => {
    if (dialogOpen.current) return
    const point = pointFromEvent(event)
    if (!point) return
    const modifiers: Array<'Shift' | 'Control' | 'Alt' | 'Meta'> = []
    const recordedModifiers: Array<'shift' | 'ctrl' | 'alt' | 'meta'> = []
    if (event.shiftKey) { modifiers.push('Shift'); recordedModifiers.push('shift') }
    if (event.ctrlKey) { modifiers.push('Control'); recordedModifiers.push('ctrl') }
    if (event.altKey) { modifiers.push('Alt'); recordedModifiers.push('alt') }
    if (event.metaKey) { modifiers.push('Meta'); recordedModifiers.push('meta') }
    const detail = button === 'left' && event.detail === 2 ? 2 : undefined
    void (async () => {
      // В режиме записи сначала спрашиваем, что под курсором: шаг сценария
      // обязан быть селекторным, координатная запись рассыплется от сдвига
      // вёрстки. Клик выполняется в любом случае — запись не мешает работе.
      if (recording) {
        const described = await run({ type: 'selector', action: { kind: 'describe', x: point.x, y: point.y } }) as { element?: BrowserElementDescription } | undefined
        if (described?.element) {
          lastElement.current = described.element
          const kind: ClickKind = button === 'right' ? 'right' : clickCount === 2 ? 'double' : 'left'
          setSteps((current) => withPause(recordPointerClick(current, described.element!, kind, recordedModifiers, detail)))
        }
      }
      await run({ type: 'input', action: { type: 'click', x: point.x, y: point.y, button, clickCount, ...(modifiers.length ? { modifiers } : {}), ...(detail ? { detail } : {}) } })
    })()
  }

  // Колесо: страница длиннее вьюпорта иначе недостижима — прокрутить её было нечем.
  const onFrameWheel = (event: ReactWheelEvent<HTMLImageElement>): void => {
    if (phase !== 'ready' || dialogOpen.current) return
    event.preventDefault()
    const point = pointFromEvent(event)
    if (!point) return
    const delta = frameWheelDelta(event, meta?.viewport ?? VIEWPORT)
    if (recording) setSteps((current) => recordScroll(current, delta.deltaY, delta.deltaX))
    void run({ type: 'input', action: { type: 'wheel', ...point, ...delta } })
  }

  const onFrameKeyDown = (event: ReactKeyboardEvent<HTMLImageElement>): void => {
    if (phase !== 'ready' || dialogOpen.current) return
    const action = frameKeyAction({ ...event, isComposing: event.nativeEvent.isComposing })
    if (!action) return
    event.preventDefault()
    void run({ type: 'input', action })
  }

  /**
   * Свайп по кадру. Телефон прокручивает страницу пальцем, а кадр — картинка:
   * без этого на мобильном была доступна только верхушка любой страницы.
   * Короткое касание остаётся кликом, поэтому дельта копится до порога.
   */
  const onFrameTouchStart = (event: { touches: ArrayLike<{ clientX: number; clientY: number }> }): void => {
    if (phase !== 'ready' || dialogOpen.current) return
    const first = event.touches[0]
    if (!first) return
    const second = event.touches[1]
    touch.current = { x: first.clientX, y: first.clientY, moved: false, pinch: second ? pinchDistance(first, second) : null }
    // Долгое нажатие — правый клик: контекстное меню страницы иначе недостижимо
    // с телефона, а именно в нём живут «скачать», «открыть в новой вкладке».
    longPress.current.fired = false
    lastTouchAt.current = Date.now()
    clearTimeout(longPress.current.timer)
    if (!second) longPress.current.timer = setTimeout(() => {
      const start = touch.current
      if (!start || start.moved) return
      longPress.current.fired = true
      const point = pointFromEvent({ clientX: start.x, clientY: start.y })
      if (point) void run({ type: 'input', action: { type: 'click', ...point, button: 'right' } })
    }, LONG_PRESS_MS)
  }

  const onFrameTouchMove = (event: { touches: ArrayLike<{ clientX: number; clientY: number }>; preventDefault(): void }): void => {
    const start = touch.current
    const first = event.touches[0]
    if (!start || !first || phase !== 'ready' || dialogOpen.current) return
    const second = event.touches[1]
    const pinchStart = start.pinch
    if (second && pinchStart !== null) {
      // Щипок меняет масштаб кадра, а не страницу: страница в Chromium уже
      // свёрстана под свой вьюпорт, растягивать её ещё раз незачем.
      const distance = pinchDistance(first, second)
      if (Math.abs(distance - pinchStart) > 24) {
        const rect = imgRef.current?.getBoundingClientRect()
        const scale = fitScale(rect?.width ?? 0, meta?.viewport.width ?? VIEWPORT.width)
        setZoom((current) => nextFrameZoom(current, distance > pinchStart ? 'in' : 'out', scale))
        touch.current = { ...start, pinch: distance, moved: true }
      }
      return
    }
    const rect = imgRef.current?.getBoundingClientRect()
    if (!rect) return
    if (!start.moved && Math.hypot(first.clientX - start.x, first.clientY - start.y) < TOUCH_TAP_SLOP) return
    clearTimeout(longPress.current.timer)
    event.preventDefault()
    const delta = touchScrollDelta({ clientX: start.x, clientY: start.y }, first, rect, meta?.viewport ?? VIEWPORT)
    touch.current = { x: first.clientX, y: first.clientY, moved: true, pinch: null }
    if (!delta.deltaX && !delta.deltaY) return
    if (recording) setSteps((current) => recordScroll(current, delta.deltaY, delta.deltaX))
    void run({ type: 'input', action: { type: 'wheel', ...delta } })
  }

  /** Жест закончился прокруткой — клик по кадру после него был бы случайным. */
  const swallowTapAfterScroll = (): boolean => {
    const scrolled = touch.current?.moved === true || longPress.current.fired
    touch.current = null
    longPress.current.fired = false
    return scrolled
  }

  useEffect(() => { lastZoom = zoom }, [zoom])

  /** Показать совпадение человеку: прокрутить к нему и обвести рамкой. */
  const showMatch = useCallback(async (selector: string): Promise<void> => {
    await run({ type: 'selector', action: { kind: 'scrollTo', selector } })
    await run({ type: 'selector', action: { kind: 'highlight', selector, ms: 1500 } })
  }, [run])

  /** Поиск по странице: те же find/highlight/scrollTo, которыми пользуется модель. */
  const runSearch = useCallback(async (query: string): Promise<void> => {
    const text = query.trim()
    if (!text) { setSearch((current) => ({ ...current, matches: [], at: 0, error: undefined })); return }
    setSearch((current) => ({ ...current, searching: true, error: undefined }))
    const found = await run({ type: 'selector', action: { kind: 'find', text, limit: 30, visibleOnly: true } }) as BrowserSelectorResult | undefined
    if (!found || found.ok === false) { setSearch((current) => ({ ...current, searching: false, matches: [], at: 0, error: found?.error ?? 'Поиск не выполнен' })); return }
    const matches = found.matches ?? []
    setSearch((current) => ({ ...current, searching: false, matches, at: 0 }))
    if (matches[0]) await showMatch(matches[0].selector)
  }, [run])

  /** Переход по совпадениям по кругу: так ведёт себя поиск в любом браузере. */
  const step = useCallback(async (direction: 1 | -1): Promise<void> => {
    let target: string | null = null
    setSearch((current) => {
      if (!current.matches.length) return current
      const at = (current.at + direction + current.matches.length) % current.matches.length
      target = current.matches[at].selector
      return { ...current, at }
    })
    // Прокрутка вынесена из setState: она асинхронная, а состояние — нет.
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (target) await showMatch(target)
  }, [showMatch])

  /** Переключить настройку среды и показать, что теперь в силе. */
  const changeEnvironment = useCallback(async (options: Record<string, unknown>): Promise<void> => {
    const result = await run({ type: 'environment', ...options } as never) as { environment?: BrowserEnvironmentState } | undefined
    if (result?.environment) setEnvironment(result.environment)
  }, [run])

  /** Cookies сессии: человеку они нужны там же, где модели, — для входа и выхода. */
  const loadCookies = useCallback(async (): Promise<void> => {
    setCookies({ loading: true })
    const result = await run({ type: 'cookies', action: 'list' } as never) as { cookies?: BrowserCookieInfo[]; total?: number; error?: string } | undefined
    if (!result || result.error) { setCookies({ error: result?.error ?? 'Cookies недоступны' }); return }
    setCookies({ items: result.cookies ?? [], total: result.total ?? 0 })
  }, [run])

  /** Хранилище сайта теми же данными, что видит модель инструментом storage. */
  const loadStorage = useCallback(async (): Promise<void> => {
    setStorage({ loading: true })
    const result = await run({ type: 'selector', action: { kind: 'storage' } }) as BrowserSelectorResult | undefined
    if (!result || result.ok === false) { setStorage({ error: result?.error ?? 'Хранилище недоступно' }); return }
    setStorage({ data: result.storage })
  }, [run])

  /** Правила сети сессии: их ставит модель, а снимать приходится человеку. */
  const loadNetworkRules = useCallback(async (operation: 'list' | 'remove' = 'list', url?: string): Promise<void> => {
    const result = await run({ type: 'network-rules', do: operation, ...(url ? { url } : {}) } as never) as { network?: { rules: Array<{ url: string; action: string }>; total: number } } | undefined
    if (result?.network) setNetworkRules(result.network)
  }, [run])

  /** Метрики страницы: обновляются по требованию, не поллингом — это команда. */
  const refreshMetrics = useCallback(async (): Promise<void> => {
    const result = await run({ type: 'selector', action: { kind: 'metrics' } }) as BrowserSelectorResult | undefined
    setMetrics(result?.metrics ?? null)
  }, [run])

  /** Поля формы и проверки браузера — то же, что модель видит form-state/validity. */
  const loadFormInfo = useCallback(async (): Promise<void> => {
    setFormInfo({ loading: true })
    const form = await run({ type: 'selector', action: { kind: 'formState' } }) as BrowserSelectorResult | undefined
    if (!form || form.ok === false) { setFormInfo({ error: form?.error ?? 'Форма не найдена' }); return }
    const validity = await run({ type: 'selector', action: { kind: 'validity' } }) as BrowserSelectorResult | undefined
    setFormInfo({ form: form.form, ...(validity?.validity ? { validity: validity.validity } : {}) })
  }, [run])

  /** Перезапуск сессии: останавливаем текущую и стартуем заново на том же разговоре. */
  const restartSession = (): void => {
    if (!browser) return
    const generation = ++alive.current
    busyRequests.current = { generation, count: 0 }; setBusy(false)
    incarnation.current = null
    addressDirty.current = false
    frameFailures.current = 0
    setPhase('starting'); setFrame(null); setMeta(null); setMessage(''); setRetryable(false); setFrameError('')
    void browser.stop(conversationId)
      // Выбранный размер окна переживает перезапуск: иначе проверка мобильной
      // вёрстки сбрасывалась на десктоп при каждом «Перезапустить».
      .then(() => browser.start(conversationId, meta?.viewport ?? VIEWPORT))
      .then((started) => {
        if (generation !== alive.current) return
        incarnation.current = started.incarnation
        applyMeta(started); setPhase('ready')
        void refreshFrame()
      }, (err: unknown) => {
        if (generation !== alive.current) return
        setPhase('error'); setMessage(err instanceof Error ? err.message : 'Не удалось перезапустить Chromium')
      })
  }

  /** Снимок всей страницы, а не только вьюпорта: fullPage контракт поддерживает. */
  const attachFullPage = async (): Promise<void> => {
    if (!browser || !incarnation.current || !onAttachFrame) return
    const generation = alive.current
    if (busyRequests.current.generation !== generation) busyRequests.current = { generation, count: 0 }
    busyRequests.current.count++
    setBusy(true)
    try {
      const shot = await browser.screenshot(conversationId, { incarnation: incarnation.current, fullPage: true, format: 'png' })
      if (generation === alive.current) onAttachFrame(shot.dataUrl)
    } catch (err) {
      if (generation === alive.current) setMessage(err instanceof Error ? err.message : 'Снимок не получился')
    } finally {
      if (generation === alive.current) { busyRequests.current.count--; setBusy(busyRequests.current.count > 0) }
    }
  }

  /** Читаем одну вкладку: модель может переключить её между ответами сети. */
  const loadDiagnostics = async (): Promise<void> => {
    if (!browser || !incarnation.current || !activeTab.current) return
    const generation = alive.current, requestId = ++diagnosticRequest.current, tabId = activeTab.current
    const currentIncarnation = incarnation.current
    const current = () => generation === alive.current && requestId === diagnosticRequest.current && activeTab.current === tabId
    setDiagnostics({ console: [], network: [], loading: true })
    try {
      const results = await Promise.all([
        browser.command(conversationId, { incarnation: currentIncarnation, command: { type: 'inspect', action: { kind: 'console', level: 'error', limit: 30, tabId } } }),
        browser.command(conversationId, { incarnation: currentIncarnation, command: { type: 'inspect', action: { kind: 'network', failedOnly: true, limit: 50, tabId } } })
      ]) as BrowserInspectResult[]
      if (!current()) return
      const [errors, network] = results
      if (!errors?.ok || !Array.isArray(errors.console)) throw new Error(errors?.error || 'Консоль не прочитана')
      if (!network?.ok || !Array.isArray(network.network)) throw new Error(network?.error || 'Сеть не прочитана')
      setDiagnostics({ console: [...errors.console].reverse(), network: [...network.network].reverse().filter(entry => entry.state ? entry.state === 'failed' || entry.status >= 400 : !entry.ok), truncated: Boolean(errors.truncated || network.truncated || errors.dropped || network.dropped), at: Date.now() })
    } catch (error) {
      if (current()) setDiagnostics({ console: [], network: [], error: error instanceof Error ? error.message : 'Диагностика не прочитана' })
    }
  }

  /**
   * «Телефон» — это не узкое окно, а тач, плотность пикселей и мобильный агент:
   * без них страница верстается как мобильная, но считает посетителя мышью, и
   * ровно там живут дефекты каруселей и меню «по наведению».
   */
  const changeViewport = (id: 'phone' | 'tablet' | 'desktop'): void => {
    const found = VIEWPORTS.find((v) => v.id === id)
    if (!found) return
    setViewportId(id)
    void (async () => {
      const result = await run({ type: 'device', preset: id, ...(orientation === 'landscape' ? { orientation } : {}) } as never) as BrowserSessionMetadata | undefined
      if (result?.device) setDevice(result.device)
      // Старый раннер команду device не знает — тогда остаётся прежний ресайз,
      // и человек хотя бы увидит мобильную вёрстку.
      else void run({ type: 'resize', viewport: found.viewport })
    })()
  }

  const changeOrientation = (next: 'portrait' | 'landscape'): void => {
    setOrientation(next)
    void (async () => {
      const result = await run({ type: 'device', preset: viewportId ?? 'desktop', orientation: next } as never) as BrowserSessionMetadata | undefined
      if (result?.device) setDevice(result.device)
    })()
  }

  const submitAddress = (): void => {
    const url = address.trim()
    if (!url) return
    const full = withScheme(url)
    addressDirty.current = false
    // После Enter адрес уже отправлен: фокус кадра позволяет показывать
    // последующие переходы модели и сразу вводить текст на самой странице.
    addressFocused.current = false
    imgRef.current?.focus()
    // Происхождение первого открытого адреса — то, с чем сверяемся дальше:
    // уход на другой хост посреди проверки почти всегда промах или редирект.
    if (!origin.current) origin.current = full
    if (recording) setSteps((current) => withPause(recordNavigate(current, full)))
    void run({ type: meta?.activeTabId ? 'navigate' : 'newTab', url: full })
  }

  const submitTyping = (): void => {
    const generation = alive.current
    if (!typing || dialogOpen.current || typingSubmission.current === generation) return
    const submitted = typing
    typingSubmission.current = generation
    void (async () => {
      try {
        const result = await run({ type: 'input', action: { type: 'type', text: submitted } })
        if (generation !== alive.current || scenarioCommandError(result)) return
        if (recording && lastElement.current) setSteps((current) => withPause(recordType(current, lastElement.current!, submitted)))
        setTyping(current => remainingTypedDraft(current, submitted))
      } finally { if (typingSubmission.current === generation) typingSubmission.current = null }
    })()
  }

  /**
   * Подстановка тестовой учётки в форму входа. Селекторы угадываются по типу
   * поля, а не по разметке конкретного сайта: `input[type=password]` — пароль,
   * поле перед ним — логин. Это эвристика, и если форма устроена иначе, шаг
   * честно ответит ошибкой, а не сделает вид, что вошёл.
   */
  const fillLogin = async (user: ProjectTestUser): Promise<void> => {
    const password = await run({ type: 'selector', action: { kind: 'type', selector: 'input[type=password]', text: user.password } }) as { ok?: boolean; error?: string } | undefined
    if (password && password.ok === false) { setMessage(`Поле пароля не найдено: ${password.error ?? 'форма входа не распознана'}`); return }
    const login = await run({ type: 'selector', action: { kind: 'type', selector: 'input:not([type=password]):not([type=checkbox]):not([type=hidden])', text: user.name, submit: true } }) as { ok?: boolean; error?: string } | undefined
    if (login && login.ok === false) setMessage(`Поле логина не найдено: ${login.error ?? 'форма входа не распознана'}`)
  }

  /**
   * Прогон записанного сценария в этой же сессии — тем же кодом, что исполняет
   * этап Automated QA. Останавливаемся на первом провале: дальше идти
   * бессмысленно, страница уже не в том состоянии.
   */
  const replay = async (upToId?: string): Promise<void> => {
    if (!steps.length) return
    setRunning(true)
    setStepResults({})
    setReplayMs(null)
    const startedAt = Date.now()
    const scenario = toScenario(steps, meta?.currentUrl ?? '')
    // Отметки прошлого прогона стираются: иначе на экране смесь свежих и старых,
    // и «ок» стоит у шага, который в этот раз не выполнялся.
    setStepResults({})
    try {
      if (scenario.startUrl) {
        const error = scenarioCommandError(await run({ type: 'navigate', url: scenario.startUrl }))
        if (error) { setMessage(`Стартовый адрес не открылся: ${error}`); return }
      }
      // Прогон до выбранного шага: длинный сценарий иначе отлаживается целиком.
      // Шаг-переход в сценарий не попадает (он уезжает в startUrl), и `findIndex`
      // по его id давал −1 — то есть «весь сценарий» вместо «только переход».
      const limit = upToId ? scenario.steps.findIndex((item) => item.id === upToId) : -1
      const planned = upToId && limit < 0 ? [] : limit >= 0 ? scenario.steps.slice(0, limit + 1) : scenario.steps
      for (const step of planned) {
        const outcome = await runScenarioStep(step, (command) => {
          // Мост панели не принимает `screenshot` — у него отдельный роут.
          // Сценарий его и не порождает, но тип об этом не знает.
          if (command.type === 'screenshot') return Promise.resolve({ ok: false, error: 'Снимок в сценарии не выполняется' })
          return run(command)
        })
        setStepResults((current) => ({ ...current, [step.id]: { ok: outcome.ok, detail: outcome.detail } }))
        if (!outcome.ok) { setMessage(`${step.title}: ${outcome.detail}${stepHint(outcome.detail) ? ` — ${stepHint(outcome.detail)}` : ''}`); break }
      }
    } finally { setRunning(false); setReplayMs(Date.now() - startedAt) }
  }

  /** Переход записывается отдельным шагом: с него начинается сценарий. */
  const startRecording = (): void => {
    setSteps(meta?.currentUrl ? recordNavigate([], meta.currentUrl) : [])
    lastStepAt.current = Date.now()
    setRecording(true)
  }

  if (phase === 'unavailable' || phase === 'error') {
    return <section className="playwright-browser-pane" aria-label="Browser session">
      <div className="playwright-reader-header"><strong>Playwright Reader</strong></div>
      <div className="webpreview-empty" role={phase === 'error' ? 'alert' : 'status'}>{message || 'Изолированный Chromium недоступен'}</div>
      {browser && <Button size="sm" onClick={restartSession}>Повторить запуск</Button>}
    </section>
  }

  const tabs = meta?.tabs ?? []
  const fragile = fragileSteps(steps)
  const ambiguous = ambiguousSteps(steps)
  const broken = brokenSteps(steps)
  const runnableSteps = toScenario(steps, meta?.currentUrl ?? '').steps.length
  // Оба поля берутся из одного ответа раннера: пока запрошенный адрес держали
  // отдельным состоянием, между нажатием Enter и ответом подсказка описывала
  // старую страницу новым адресом — и врала.
  const alias = aliasNote(meta?.currentUrl ?? '', meta?.aliasedHost ?? null)
  const strayed = offOrigin(origin.current, meta?.currentUrl ?? null, alias !== null)

  /** Сочетания окружающего браузера: человек жмёт их не думая, и внутри панели
   *  они должны означать то же самое, а не уходить в страницу Chromium. */
  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    const shortcut = panelShortcut(event)
    if (!shortcut) return
    if (shortcut === 'exitFullscreen') {
      // Escape закрывает сначала поиск, потом разворот: так же ведёт себя браузер.
      if (search.open) { event.preventDefault(); setSearch((current) => ({ ...current, open: false })); return }
      if (!fullscreen) return
      event.preventDefault()
      setFullscreen(false)
      return
    }
    if (phase !== 'ready') return
    event.preventDefault()
    if (shortcut === 'address') { addressRef.current?.focus(); addressRef.current?.select(); return }
    if (shortcut === 'find') {
      setSearch((current) => ({ ...current, open: true }))
      // Поле появляется в этом же кадре отрисовки — фокус ставим после него.
      setTimeout(() => { searchRef.current?.focus(); searchRef.current?.select() }, 0)
      return
    }
    void run({ type: shortcut })
  }

  return <section
      className={`playwright-browser-pane${fullscreen ? ' playwright-browser-pane--fullscreen' : ''}`}
      aria-label="Browser session"
      ref={paneRef}
      onKeyDown={onPanelKeyDown}
    >
      <div className="playwright-reader-tabs" role={tabs.length ? 'tablist' : 'group'} aria-label="Вкладки страницы">
        {tabs.map((tab) => (
          <span key={tab.id} className={`playwright-reader-tab${tab.id === meta?.activeTabId ? ' is-active' : ''}`}>
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === meta?.activeTabId}
              title={tab.url}
              aria-label={tab.dialogId ? `${tab.title || tab.url || 'Без названия'} — ожидает ответа` : undefined}
              onClick={() => void run({ type: 'selectTab', tabId: tab.id })}
            >{tab.dialogId && <span aria-hidden="true">● </span>}{tab.title || tab.url || 'Без названия'}</button>
            {tabs.length > 1 && (
              <IconButton size="sm" aria-label={`Закрыть вкладку ${tab.title || tab.url}`} title="Закрыть вкладку"
                onClick={() => void run({ type: 'closeTab', tabId: tab.id })}>✕</IconButton>
            )}
          </span>
        ))}
        <IconButton size="sm" aria-label="Новая вкладка" title="Новая вкладка" disabled={phase !== 'ready'}
          onClick={() => void run({ type: 'newTab' })}>+</IconButton>
        {/* За шестью вкладками начинается горизонтальная прокрутка, в которой
            нужную приходится искать глазами; список выбирает её по названию. */}
        {tabs.length > 5 && (
          <label className="playwright-reader-testusers">Вкладок: {tabs.length}
            <select className="sel" aria-label="Выбрать вкладку из списка" value={meta?.activeTabId ?? ''} disabled={phase !== 'ready'}
              onChange={(event) => { if (event.target.value) void run({ type: 'selectTab', tabId: event.target.value }) }}>
              {tabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.dialogId ? '● ' : ''}{tab.title || tab.url || 'Без названия'}</option>)}
            </select>
          </label>
        )}
      </div>
    <div className="playwright-reader-header">
      <IconButton size="sm" aria-label="Назад" title="Назад" disabled={phase !== 'ready' || !meta?.activeTabId} onClick={() => void run({ type: 'back' })}>‹</IconButton>
      <IconButton size="sm" aria-label="Вперёд" title="Вперёд" disabled={phase !== 'ready' || !meta?.activeTabId} onClick={() => void run({ type: 'forward' })}>›</IconButton>
      <IconButton size="sm" aria-label="Обновить" title="Обновить" disabled={phase !== 'ready' || !meta?.activeTabId} onClick={() => void run({ type: 'reload' })}>⟳</IconButton>
      <input
        ref={addressRef}
        type="url"
        className="playwright-reader-address"
        aria-label="Адрес страницы"
        placeholder="https://…"
        value={address}
        onFocus={() => { addressFocused.current = true }}
        onBlur={() => { addressFocused.current = false }}
        disabled={phase !== 'ready'}
        onChange={(event) => { addressDirty.current = true; setAddress(event.target.value) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submitAddress()
          if (event.key === 'Escape') {
            const loaded = meta?.currentUrl ?? null
            addressDirty.current = false
            setAddress(isWebAddress(loaded) ? loaded : '')
          }
        }}
      />
      <Button size="sm" variant="secondary" disabled={phase !== 'ready'} onClick={submitAddress}>Открыть</Button>
      {/* Адрес страницы нужен в задаче, письме и тикете чаще, чем кажется:
          выделять его в поле на телефоне — отдельное упражнение. */}
      <IconButton size="sm" aria-label="Скопировать адрес" title="Скопировать адрес"
        disabled={!meta?.currentUrl}
        onClick={() => void (async () => {
          const url = meta?.currentUrl
          if (!url) return
          try {
            if (!navigator.clipboard) throw new Error('Буфер обмена недоступен в этом контексте')
            await navigator.clipboard.writeText(url)
            setMessage('Адрес скопирован')
          } catch (err) { setMessage(err instanceof Error ? err.message : 'Скопировать не удалось') }
        })()}>⧉</IconButton>
      <IconButton size="sm" aria-label={fullscreen ? 'Свернуть кадр' : 'Развернуть кадр'} title={fullscreen ? 'Свернуть кадр' : 'Развернуть кадр на всю панель'}
        aria-pressed={fullscreen} onClick={() => setFullscreen((value) => !value)}>{fullscreen ? '⤡' : '⤢'}</IconButton>
    </div>
    {search.open && (
      <div className="playwright-reader-find" role="search">
        <input
          ref={searchRef}
          type="search"
          className="login-input"
          aria-label="Найти на странице"
          placeholder="Найти на странице"
          value={search.query}
          disabled={phase !== 'ready'}
          onChange={(event) => setSearch((current) => ({ ...current, query: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); void (search.matches.length ? step(event.shiftKey ? -1 : 1) : runSearch(search.query)) }
            if (event.key === 'Escape') { event.preventDefault(); setSearch((current) => ({ ...current, open: false })) }
          }}
        />
        <Button size="sm" variant="secondary" disabled={phase !== 'ready' || !search.query.trim() || search.searching} onClick={() => void runSearch(search.query)}>Найти</Button>
        <span role="status" className="playwright-reader-size">
          {search.searching ? 'ищем…' : search.error ? search.error : search.matches.length ? `${search.at + 1} из ${search.matches.length}` : search.query.trim() ? 'ничего не нашлось' : ''}
        </span>
        <IconButton size="sm" aria-label="Предыдущее совпадение" title="Предыдущее совпадение" disabled={search.matches.length < 2} onClick={() => void step(-1)}>↑</IconButton>
        <IconButton size="sm" aria-label="Следующее совпадение" title="Следующее совпадение" disabled={search.matches.length < 2} onClick={() => void step(1)}>↓</IconButton>
        <IconButton size="sm" aria-label="Закрыть поиск" title="Закрыть поиск" onClick={() => setSearch((current) => ({ ...current, open: false }))}>✕</IconButton>
      </div>
    )}
    <div className="playwright-reader-tools">
      <span className="playwright-reader-viewports" role="group" aria-label="Размер окна">
        {VIEWPORTS.map((v) => (
          <Button
            key={v.id}
            size="sm"
            variant={viewportId === v.id ? 'primary' : 'ghost'}
            aria-pressed={viewportId === v.id}
            disabled={phase !== 'ready'}
            onClick={() => changeViewport(v.id)}
          >{v.label}</Button>
        ))}
      </span>
      <Button size="sm" variant={search.open ? 'primary' : 'ghost'} aria-pressed={search.open} disabled={phase !== 'ready'}
        onClick={() => { setSearch((current) => ({ ...current, open: !current.open })); setTimeout(() => searchRef.current?.focus(), 0) }}>Поиск по странице</Button>
      {/* Длинную страницу человек листает концами: «в начало» и «в конец» —
          первые две кнопки, за которыми он тянется, и их не было вовсе. */}
      <span className="playwright-reader-keys" role="group" aria-label="Прокрутка страницы">
        <IconButton size="sm" aria-label="В начало страницы" title="В начало страницы" disabled={phase !== 'ready'}
          onClick={() => void (async () => { await run({ type: 'selector', action: { kind: 'scroll', to: 'top' } }); await refreshMetrics() })()}>⇱</IconButton>
        <IconButton size="sm" aria-label="В конец страницы" title="В конец страницы" disabled={phase !== 'ready'}
          onClick={() => void (async () => { await run({ type: 'selector', action: { kind: 'scroll', to: 'bottom' } }); await refreshMetrics() })()}>⇲</IconButton>
      </span>
      {/* «Экранов ниже» отвечает на вопрос, который кадр не отвечает никогда:
          это вся страница или только её начало. */}
      {metrics && <span className="playwright-reader-size" role="status">{metrics.atBottom ? 'страница долистана' : `ниже ещё ${metrics.screensBelow} экрана(ов)`}</span>}
      {/* Размер окна словами: пресет не говорит, какой ширины страница сейчас,
          а именно ширина объясняет, почему вёрстка выглядит так. */}
      {/* Ориентация — отдельная кнопка: «а если повернуть» это первое, что
          спрашивают о мобильной вёрстке, и одной шириной это не проверить. */}
      {viewportId && viewportId !== 'desktop' && (
        <Button size="sm" variant="ghost" disabled={phase !== 'ready'}
          onClick={() => changeOrientation(orientation === 'portrait' ? 'landscape' : 'portrait')}>
          {orientation === 'portrait' ? 'Повернуть' : 'Вернуть портрет'}
        </Button>
      )}
      {meta?.viewport && (
        <span className="playwright-reader-size">
          {meta.viewport.width}×{meta.viewport.height}
          {device?.touch ? ' · тач' : ''}
          {device && device.deviceScaleFactor > 1 ? ` · ×${device.deviceScaleFactor}` : ''}
        </span>
      )}
      {/* Масштаб кадра отделён от размера окна Chromium: «Телефон» меняет вёрстку
          страницы, а зум — только то, как кадр виден человеку. */}
      <span className="playwright-reader-zoom" role="group" aria-label="Масштаб кадра">
        <IconButton size="sm" aria-label="Уменьшить кадр" title="Уменьшить кадр"
          onClick={() => setZoom((current) => nextFrameZoom(current, 'out', fitScale(imgRef.current?.getBoundingClientRect().width ?? 0, meta?.viewport.width ?? VIEWPORT.width)))}>−</IconButton>
        <Button size="sm" variant={zoom === 'fit' ? 'primary' : 'ghost'} aria-pressed={zoom === 'fit'}
          onClick={() => setZoom('fit')}>{zoom === 'fit' ? 'Вписан' : `${Math.round(zoom * 100)}%`}</Button>
        <IconButton size="sm" aria-label="Увеличить кадр" title="Увеличить кадр"
          onClick={() => setZoom((current) => nextFrameZoom(current, 'in', fitScale(imgRef.current?.getBoundingClientRect().width ?? 0, meta?.viewport.width ?? VIEWPORT.width)))}>+</IconButton>
      </span>
      {onAttachFrame && (
        <Button size="sm" variant="ghost" disabled={phase !== 'ready' || !frame} onClick={() => { if (frame) onAttachFrame(frame) }}>
          Снимок в чат
        </Button>
      )}
      {/* Кадр показывает только вьюпорт; у длинной страницы это верхушка. */}
      {onAttachFrame && (
        <Button size="sm" variant="ghost" disabled={phase !== 'ready'} onClick={() => void attachFullPage()}>
          Вся страница
        </Button>
      )}
      {meta?.title && <span className="playwright-reader-title" title={meta.title}>{meta.title}</span>}
      {/* Сессия одна на разговор: без этого непонятно, кто увёл страницу. */}
      {phase === 'ready' && (!meta?.currentUrl || meta.currentUrl === 'about:blank') && <span className="playwright-reader-quick-sites">
        <Button size="sm" variant="ghost" onClick={() => void run({ type: 'navigate', url: 'https://app.internal/' })}>Текущий проект</Button>
        <Button size="sm" variant="ghost" onClick={() => void run({ type: 'navigate', url: 'https://mail.google.com/' })}>Gmail</Button>
        <Button size="sm" variant="ghost" onClick={() => void run({ type: 'navigate', url: 'https://www.instagram.com/' })}>Instagram</Button>
      </span>}
      {meta?.lastActor && (
        <span className="playwright-reader-actor" data-actor={meta.lastActor}>
          {meta.lastActor === 'assistant' ? 'последнее действие — модели' : 'последнее действие — ваше'}
        </span>
      )}
      <span className="playwright-reader-state" role="status" data-status={meta?.state ?? phase}>
        {phase === 'starting' ? STATE_LABELS.starting : (STATE_LABELS[meta?.state ?? 'ready'] ?? STATE_LABELS.ready)}
      </span>
      {/* Кнопка живёт в ряду инструментов, а не в панели записи: та появляется
          только при непустой записи, и загрузить туда было бы нечем. */}
      {(savedScenarios ?? []).length > 0 && steps.length === 0 && (
        <label className="playwright-reader-testusers">Загрузить сценарий
          <select className="sel" value="" disabled={phase !== 'ready'} onChange={(event) => {
            const found = (savedScenarios ?? [])[Number(event.target.value)]
            if (!found) return
            setScenarioName(found.name ?? '')
            setSteps(loadScenario(found))
            setStepResults({})
          }}>
            <option value="">выбрать…</option>
            {(savedScenarios ?? []).map((item, index) => <option key={index} value={index}>{scenarioLabel(item, index)}</option>)}
          </select>
        </label>
      )}
      <Button size="sm" variant={recording ? 'primary' : 'ghost'} aria-pressed={recording} disabled={phase !== 'ready'}
        onClick={() => (recording ? setRecording(false) : startRecording())}>
        {recording ? `Записывается: ${steps.length}` : 'Записать сценарий'}
      </Button>
      {(testUsers ?? []).length > 0 && (
        <label className="playwright-reader-testusers">Войти как
          <select className="sel" value="" disabled={phase !== 'ready'} onChange={(event) => {
            const found = (testUsers ?? []).find((user) => user.name === event.target.value)
            if (found) void fillLogin(found)
          }}>
            <option value="">выбрать учётку…</option>
            {(testUsers ?? []).map((user) => <option key={user.name} value={user.name}>{user.name}{user.role ? ` · ${user.role}` : ''}</option>)}
          </select>
        </label>
      )}
      <Button size="sm" variant="ghost" disabled={phase !== 'ready'} onClick={() => void loadDiagnostics()}>Ошибки страницы</Button>
      {/* Человек видит форму глазами страницы — теми же данными, что и модель:
          что заполнено, что обязательно и почему браузер не пустит дальше. */}
      <Button size="sm" variant={formInfo ? 'primary' : 'ghost'} aria-expanded={Boolean(formInfo)} disabled={phase !== 'ready'} onClick={() => (formInfo ? setFormInfo(null) : void loadFormInfo())}>Поля формы</Button>
      <Button size="sm" variant={environmentOpen ? 'primary' : 'ghost'} aria-expanded={environmentOpen} disabled={phase !== 'ready'} onClick={() => setEnvironmentOpen((value) => !value)}>Среда</Button>
      <Button size="sm" variant={feedOpen ? 'primary' : 'ghost'} aria-expanded={feedOpen} onClick={() => setFeedOpen((value) => !value)}>
        Что происходит{meta?.history?.length ? ` (${meta.history.length})` : ''}
      </Button>
      {/* Эмуляция незаметна на кадре: тёмная тема выглядит как решение сайта,
          а отсутствие сети — как зависшая страница. Поэтому она подписана. */}
      {environment && (environment.colorScheme === 'dark' || environment.offline || environment.reducedMotion === 'reduce' || environment.forcedColors === 'active') && (
        <span className="playwright-reader-size" role="status">
          {[environment.colorScheme === 'dark' ? 'тёмная тема' : null, environment.offline ? 'без сети' : null,
            environment.reducedMotion === 'reduce' ? 'без анимации' : null, environment.forcedColors === 'active' ? 'контраст' : null]
            .filter(Boolean).join(' · ')}
        </span>
      )}
      {/* Страницу иногда нужно доработать в своём браузере: скачать файл,
          открыть devtools, войти паролем из менеджера. */}
      <Button size="sm" variant="ghost" disabled={!meta?.currentUrl} onClick={() => { if (meta?.currentUrl) globalThis.open?.(meta.currentUrl, '_blank', 'noopener') }}>Открыть у себя</Button>
      <Button size="sm" variant={downloadsOpen ? 'primary' : 'ghost'} disabled={phase !== 'ready'} aria-expanded={downloadsOpen} onClick={() => setDownloadsOpen(value => !value)}>Скачивания{meta?.downloadCount ? ` (${meta.downloadCount})` : ''}</Button>
      {/* Профиль persistent, поэтому «выйти и посмотреть экран входа» иначе
          нечем: перезапуск сессии куки не трогает. */}
      <Button size="sm" variant="ghost" disabled={phase !== 'ready' || busy} onClick={() => void (async () => {
        const result = await run({ type: 'clearSiteData' })
        if (!isBrowserSiteDataResetResult(result)) {
          setMessage(result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : 'Раннер не подтвердил очистку данных сайта')
          return
        }
        await run({ type: 'reload' })
      })()}>
        Очистить сессию сайта
      </Button>
      {/* На телефоне экранная клавиатура не отдаёт ни стрелок, ни Backspace, а
          без них не пройти ни список, ни поле с ошибкой ввода. */}
      <span className="playwright-reader-keys" role="group" aria-label="Клавиши">
        {([['Enter', 'Enter'], ['Tab', 'Tab'], ['Escape', 'Esc'], ['ArrowUp', '↑'], ['ArrowDown', '↓'], ['Backspace', '⌫']] as const).map(([key, label]) => (
          <Button key={key} size="sm" variant="ghost" disabled={phase !== 'ready'}
            aria-label={key} title={key}
            onClick={() => void run({ type: 'input', action: { type: 'press', key } })}>{label}</Button>
        ))}
      </span>
      {/* Долгая навигация ничем не отличалась от зависшей: прервать её было
          нечем, оставался только перезапуск всей сессии. */}
      <Button size="sm" variant="ghost" disabled={!busy} onClick={() => void run({ type: 'stop' })}>Прервать</Button>
      <Button size="sm" variant="ghost" disabled={phase !== 'ready'} onClick={() => void run({ type: 'control', owner: meta?.control === 'user' ? 'shared' : 'user' })}>
        {meta?.control === 'user' ? 'Вернуть управление модели' : 'Взять управление'}
      </Button>
      {meta?.control === 'user' && <span role="status">Управление у вас. Действия модели приостановлены.</span>}
      {/* Место кнопок постоянно: иначе кадр сдвигается между двумя кликами. */}
      <Button size="sm" variant="ghost" disabled={!busy} onClick={() => void run({ type: 'cancel' })}>Отменить ожидающие команды</Button>
      {/* Зависшую страницу иначе не выкинуть: stop звался только при уходе с экрана. */}
      <Button size="sm" variant="ghost" disabled={phase !== 'ready'} onClick={restartSession}>Перезапустить</Button>
    </div>
    {(alias || strayed || history.length > 1) && (
      <div className="playwright-reader-where">
        {alias && <span className="playwright-reader-where__note">{alias}</span>}
        {strayed && <span className="playwright-reader-where__note" role="alert">Страница ушла с проверяемого сайта на {(() => { try { return new URL(meta!.currentUrl!).host } catch { return 'другой адрес' } })()}.</span>}
        {history.length > 1 && (
          <label className="playwright-reader-where__history">Где были
            <select className="sel" value="" disabled={phase !== 'ready'} onChange={(event) => { if (event.target.value) void run({ type: 'navigate', url: event.target.value }) }}>
              <option value="">выбрать адрес…</option>
              {history.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        )}
      </div>
    )}
    {/* Панели записи и диагностики — ПОД кадром: появляясь сверху, они сдвигали
        изображение, и следующий клик человека попадал мимо цели. */}
    <div className="playwright-browser-viewport">
      {frame
        ? <img
            ref={imgRef}
            src={frame}
            alt="Кадр Chromium"
            tabIndex={activeDialog ? -1 : 0}
            aria-disabled={Boolean(activeDialog)}
            role="application"
            aria-label="Страница в Chromium: клик, прокрутка и клавиатура работают прямо здесь"
            onClick={(event) => {
              clearTimeout(longPress.current.timer)
              if (swallowTapAfterScroll()) return
              // Два быстрых тапа = двойной клик: на телефоне иначе не открыть
              // то, что открывается двойным щелчком (строка таблицы, файл).
              // Мышь сюда не попадает: у неё двойной клик приходит своим detail,
              // и считать два соседних щелчка двойными было бы неверно.
              const now = Date.now()
              const touched = now - lastTouchAt.current < TOUCH_CLICK_WINDOW_MS
              const double = touched && now - lastTap.current < DOUBLE_TAP_MS
              lastTap.current = touched ? now : 0
              clickAt(event, 'left', double ? 2 : 1)
            }}
            onContextMenu={(event) => { event.preventDefault(); clickAt(event, 'right', 1) }}
            onWheel={onFrameWheel}
            onTouchStart={onFrameTouchStart}
            onTouchMove={onFrameTouchMove}
            onKeyDown={onFrameKeyDown}
            onPaste={(event) => {
              if (phase !== 'ready' || dialogOpen.current) return
              const text = event.clipboardData.getData('text/plain')
              if (!text) return
              event.preventDefault()
              void run({ type: 'input', action: { type: 'type', text } })
            }}
            style={{
              // Ширина задаётся числом только при явном масштабе: режим «вписать»
              // остаётся на CSS, иначе кадр дёргался бы на каждом ресайзе панели.
              width: frameWidth(zoom, meta?.viewport.width ?? VIEWPORT.width) ?? '100%',
              maxWidth: zoom === 'fit' ? '100%' : 'none',
              display: 'block',
              cursor: 'pointer',
              // Браузер не должен уводить страницу приложения, пока палец
              // прокручивает страницу внутри кадра.
              touchAction: 'none'
            }}
          />
        : phase === 'ready' && tabs.length === 0
          ? <EmptyState title="Все вкладки закрыты" description="Откройте новую вкладку кнопкой + над адресом страницы." />
          : <div className="webpreview-empty" role="status">{activeDialog ? 'Страница ожидает ответа' : 'Запуск изолированного Chromium…'}</div>}
      {activeDialog && <BrowserSiteDialog key={activeDialog.id} dialog={activeDialog} onAnswer={async answer => {
        const result = await run({ type: 'handleDialog', ...answer })
        const error = scenarioCommandError(result)
        if (error) throw new Error(error)
        if (!isBrowserSessionMetadata(result) || !Array.isArray(result.dialogs)) throw new Error('Сайт не подтвердил ответ. Обновите состояние и повторите.')
      }} />}
      {/* Полоса вместо одного слова: на длинной навигации «Выполняется…» не
          отличалось от зависшей страницы, и человек жал перезапуск зря. */}
      {(busy || meta?.state === 'starting' || meta?.state === 'reconnecting') && !activeDialog && (
        <span className="playwright-reader-progress" role="progressbar" aria-label="Страница выполняет действие" aria-busy="true" />
      )}
      {busy && !activeDialog && <span className="playwright-reader-busy" role="status">Выполняется…</span>}
    </div>
    {downloadsOpen && <BrowserDownloadsPane downloads={meta?.downloads ?? []} count={meta?.downloadCount ?? 0} onCommand={async command => {
      if (!browser || !incarnation.current) throw new Error('Браузер недоступен')
      const generation = alive.current
      const result = await browser.command(conversationId, { incarnation: incarnation.current, command })
      if (generation !== alive.current) throw new Error('Сессия изменилась')
      if (command.type === 'cancelDownload' || command.type === 'deleteDownload') void refreshFrame(true)
      return result
    }} />}
    {steps.length > 0 && (
      <div className="playwright-reader-record" role="region" aria-label="Записанный сценарий">
        <div className="playwright-reader-record__head">
          <strong>Сценарий: {steps.length} шаг(ов)</strong>
          {onSaveScenario && (
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void (async () => {
              const scenario = { ...toScenario(steps, meta?.currentUrl ?? ''), ...(scenarioName.trim() ? { name: scenarioName.trim() } : {}) }
              // Раньше в проект уезжали шаги с неисполнимым действием и пустым
              // селектором, и узнавалось это только на прогоне — через сутки, на
              // доске, у другого человека.
              const problems = scenarioProblems(scenario)
              if (problems.length) { setMessage(`Сценарий не сохранён: ${problems.join('; ')}`); return }
              try { await onSaveScenario(scenario); setMessage('Сценарий сохранён в настройках проекта') }
              catch (err) { setMessage(err instanceof Error ? err.message : 'Сценарий не сохранён') }
            })()}>Сохранить в проект</Button>
          )}
          {/* Считаем исполнимые шаги, а не записанные: шаг-переход уходит в
              startUrl, и запись из одного перехода прогонять нечем. */}
          <label className="playwright-reader-record__name">Название сценария
            <input className="login-input" value={scenarioName} placeholder="Вход и доска" onChange={(event) => setScenarioName(event.target.value)} />
          </label>
          <Button size="sm" disabled={running || !runnableSteps} onClick={() => void replay()}>
            {running ? 'Прогоняю…' : 'Прогнать сценарий'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setSteps(meta?.currentUrl ? recordNavigate([], meta.currentUrl) : []); lastStepAt.current = Date.now(); setStepResults({}); setRecording(true) }}>
            Начать заново
          </Button>
          {replayMs !== null && <span className="playwright-reader-record__time">прогон {Math.round(replayMs / 100) / 10} с</span>}
          <Button size="sm" variant="ghost" onClick={() => void (async () => {
            // Буфер обмена доступен не всегда (нужен secure-контекст); раньше
            // кнопка при отказе молча ничего не делала.
            const text = JSON.stringify(toScenario(steps, meta?.currentUrl ?? ''), null, 2)
            try {
              if (!navigator.clipboard) throw new Error('Буфер обмена недоступен в этом контексте')
              await navigator.clipboard.writeText(text)
              setMessage('Сценарий скопирован')
            } catch (err) { setMessage(err instanceof Error ? err.message : 'Скопировать не удалось') }
          })()}>Скопировать</Button>
          {/* Сценарий переносят между разговорами и машинами: без обмена JSON
              его приходилось записывать заново на каждом стенде. */}
          <Button size="sm" variant="ghost" onClick={() => {
            const text = globalThis.prompt?.('Вставьте JSON сценария')
            if (!text) return
            try {
              const parsed = JSON.parse(text) as { steps?: unknown[]; startUrl?: string }
              if (!Array.isArray(parsed.steps) || !parsed.steps.length) throw new Error('В сценарии нет шагов')
              setSteps(loadScenario({ startUrl: parsed.startUrl ?? '', steps: parsed.steps as never }))
              setStepResults({})
              setMessage('Сценарий загружен из JSON')
            } catch (err) { setMessage(err instanceof Error ? `Сценарий не загружен: ${err.message}` : 'Сценарий не загружен') }
          }}>Вставить JSON</Button>
          <IconButton size="sm" aria-label="Очистить запись" title="Очистить запись" onClick={() => { setSteps([]); setRecording(false) }}>✕</IconButton>
        </div>
        {!hasAssertions(steps) && (
          // Сценарий без единой проверки зелёный, пока клики попадают, — даже
          // если страница показала ошибку. Это не тест, и молчать об этом нельзя.
          <p className="playwright-reader-record__warn" role="status">Ни одной проверки: такой сценарий пройдёт, даже если страница сломана. Добавьте ожидаемый текст к любому шагу.</p>
        )}
        {needsWaitHint(steps) && (
          // Длинная пауза почти всегда значит, что человек ждал страницу; без
          // явного ожидания раннер нажмёт быстрее, чем появится элемент.
          <p className="playwright-reader-record__warn">Между шагами были долгие паузы: вы ждали страницу. Добавьте ожидаемый текст, иначе прогон будет нажимать раньше, чем элемент появится.</p>
        )}
        {broken.length > 0 && (
          // matches: 0 — построенный селектор невалиден, шаг упадёт наверняка.
          <p className="playwright-reader-record__warn" role="alert">Сломанных шагов: {broken.length}. Их селектор не находит на странице ничего — такой шаг упадёт при первом же прогоне.</p>
        )}
        {ambiguous.length > 0 && (
          <p className="playwright-reader-record__warn">Неоднозначных шагов: {ambiguous.length}. Их селектор находит несколько элементов, и шаг нажмёт первый.</p>
        )}
        <div className="playwright-reader-record__expect">
          {/* Шаг выбирается, а не всегда последний: понял на середине записи,
              что нужна проверка, — раньше приходилось переписывать сценарий. */}
          <label>Шаг для проверки
            <select className="sel" value={expectStepId || (steps.at(-1)?.id ?? '')} disabled={!steps.length}
              onChange={(event) => setExpectStepId(event.target.value)}>
              {steps.map((step, at) => <option key={step.id} value={step.id}>{at + 1}. {step.title.slice(0, 40)}</option>)}
            </select>
          </label>
          <label>Ожидаемый текст
            <input className="login-input" value={expectText} disabled={!steps.length} onChange={(event) => setExpectText(event.target.value)} />
          </label>
          <Button size="sm" disabled={!steps.length || !expectText.trim()} onClick={() => { setSteps((current) => expectOnStep(current, expectStepId || (current.at(-1)?.id ?? ''), expectText)); setExpectText('') }}>Ждать текст</Button>
          <Button size="sm" variant="ghost" disabled={!steps.length || !expectText.trim()} onClick={() => { setSteps((current) => expectOnStep(current, expectStepId || (current.at(-1)?.id ?? ''), expectText, true)); setExpectText('') }}>Не должно быть</Button>
        </div>
        {fragile.length > 0 && (
          // Селектор по пути в дереве ломается от вставки соседнего узла —
          // честно предупреждаем сразу, а не оставляем сценарий падать потом.
          <p className="playwright-reader-record__warn" role="alert">
            Ненадёжных шагов: {fragile.length}. Их селектор построен по месту в дереве и сломается от правки вёрстки — лучше добавить элементам `data-testid`.
          </p>
        )}
        <ol className="playwright-reader-record__list">
          {steps.map((step) => (
            <li key={step.id} data-stability={step.stability} data-skipped={step.skipped ? 'true' : undefined}>
              <span className="playwright-reader-record__row">
                {/* Название читается в отчёте этапа — его правят чаще всего. */}
                <input
                  className="playwright-reader-record__title"
                  aria-label={`Название шага ${step.id}`}
                  value={step.title}
                  onChange={(event) => setSteps((current) => renameStep(current, step.id, event.target.value))}
                />
                <IconButton size="sm" aria-label={`Прогнать до шага «${step.title}»`} title="Прогнать до этого шага" disabled={running} onClick={() => void replay(step.id)}>▸</IconButton>
                {/* Записанный проход почти никогда не идеален: шаг сделан рано,
                    шаг лишний. Раньше это лечилось только записью заново. */}
                <IconButton size="sm" aria-label={`Поднять шаг «${step.title}»`} title="Выше" onClick={() => { setSteps((current) => moveStep(current, step.id, -1)); setStepResults({}) }}>↑</IconButton>
                <IconButton size="sm" aria-label={`Опустить шаг «${step.title}»`} title="Ниже" onClick={() => { setSteps((current) => moveStep(current, step.id, 1)); setStepResults({}) }}>↓</IconButton>
                <IconButton size="sm" aria-label={step.skipped ? `Включить шаг «${step.title}»` : `Выключить шаг «${step.title}»`}
                  title={step.skipped ? 'Включить шаг' : 'Выключить шаг: останется в записи, но в сценарий не уедет'}
                  onClick={() => { setSteps((current) => toggleStep(current, step.id)); setStepResults({}) }}>{step.skipped ? '○' : '●'}</IconButton>
                <IconButton size="sm" aria-label={`Убрать шаг «${step.title}»`} title="Убрать шаг" onClick={() => {
                // Отметки прогона ключуются по id, а `removeStep` перенумеровывает:
                // без сброса «ок» удалённого шага доставался следующему.
                setSteps((current) => removeStep(current, step.id))
                setStepResults({})
              }}>✕</IconButton>
              </span>
              <code>{'selector' in step.action ? step.action.selector : ''}</code>
              {stepResults[step.id] && (
                <em className={`playwright-reader-record__result playwright-reader-record__result--${stepResults[step.id].ok ? 'ok' : 'fail'}`}>
                  {stepResults[step.id].ok ? 'прогон: ок' : `прогон: ${stepResults[step.id].detail}`}
                </em>
              )}
              {(step.expectText || step.expectAbsentText) && (
                <em className="playwright-reader-record__check">{step.expectText ? `ждём «${step.expectText}»` : `не должно быть «${step.expectAbsentText}»`}</em>
              )}
            </li>
          ))}
        </ol>
      </div>
    )}
    {feedOpen && (
      <div className="playwright-reader-diagnostics" role="region" aria-label="Что происходит в браузере">
        <div className="playwright-reader-diagnostics__head">
          <strong>Что происходит</strong>
          <span className="playwright-reader-keys" role="group" aria-label="Чьи действия показывать">
            {([['all', 'Все'], ['assistant', 'Модель'], ['user', 'Я']] as const).map(([value, label]) => (
              <Button key={value} size="sm" variant={feedActor === value ? 'primary' : 'ghost'} aria-pressed={feedActor === value} onClick={() => setFeedActor(value)}>{label}</Button>
            ))}
          </span>
          <IconButton size="sm" aria-label="Очистить ленту" title="Очистить ленту" disabled={phase !== 'ready'}
            onClick={() => void run({ type: 'history', clear: true } as never)}>🗑</IconButton>
          <IconButton size="sm" aria-label="Скрыть ленту" title="Скрыть ленту" onClick={() => setFeedOpen(false)}>✕</IconButton>
        </div>
        {!meta?.history?.length && <p className="proj-muted">Пока ничего не происходило.</p>}
        {Boolean(meta?.history?.length) && (
          <ul className="playwright-reader-diagnostics__list">
            {(meta?.history ?? [])
              .filter((entry) => feedActor === 'all' || entry.actor === feedActor)
              .slice()
              .reverse()
              .map((entry, index) => (
                <li key={`${entry.at}-${index}`} data-kind={entry.ok ? undefined : 'console'}>
                  <span className="playwright-reader-actor" data-actor={entry.actor}>{entry.actor === 'assistant' ? 'модель' : 'вы'}</span>
                  {' · '}
                  {entry.kind === 'note' ? <strong>{entry.title}</strong> : entry.title}
                  {entry.error && <small> · {entry.error}</small>}
                  {entry.selector && (
                    <IconButton size="sm" aria-label={`Показать ${entry.selector}`} title="Показать элемент на странице" disabled={phase !== 'ready'}
                      onClick={() => void showMatch(entry.selector!)}>◎</IconButton>
                  )}
                  <small className="playwright-reader-size"> {new Date(entry.at).toLocaleTimeString()}</small>
                </li>
              ))}
          </ul>
        )}
      </div>
    )}
    {environmentOpen && (
      <div className="playwright-reader-diagnostics" role="region" aria-label="Среда браузера">
        <div className="playwright-reader-diagnostics__head">
          <strong>Среда браузера</strong>
          <Button size="sm" variant="ghost" disabled={phase !== 'ready'} onClick={() => void changeEnvironment({ colorScheme: 'light', reducedMotion: 'no-preference', forcedColors: 'none', offline: false, geolocation: null, permissions: [] })}>Сбросить</Button>
          <IconButton size="sm" aria-label="Скрыть среду" title="Скрыть среду" onClick={() => setEnvironmentOpen(false)}>✕</IconButton>
        </div>
        <div className="playwright-reader-env">
          {([
            ['Тёмная тема', environment?.colorScheme === 'dark', () => changeEnvironment({ colorScheme: environment?.colorScheme === 'dark' ? 'light' : 'dark' })],
            ['Без сети', environment?.offline === true, () => changeEnvironment({ offline: !(environment?.offline === true) })],
            ['Без анимации', environment?.reducedMotion === 'reduce', () => changeEnvironment({ reducedMotion: environment?.reducedMotion === 'reduce' ? 'no-preference' : 'reduce' })],
            ['Высокий контраст', environment?.forcedColors === 'active', () => changeEnvironment({ forcedColors: environment?.forcedColors === 'active' ? 'none' : 'active' })]
          ] as const).map(([label, active, toggle]) => (
            <Button key={label} size="sm" variant={active ? 'primary' : 'ghost'} aria-pressed={active} disabled={phase !== 'ready'} onClick={() => void toggle()}>{label}</Button>
          ))}
          <Button size="sm" variant="ghost" disabled={phase !== 'ready'} onClick={() => void loadCookies()}>Cookies</Button>
          <Button size="sm" variant="ghost" disabled={phase !== 'ready'} onClick={() => void loadStorage()}>Хранилище сайта</Button>
          <Button size="sm" variant="ghost" disabled={phase !== 'ready'} onClick={() => void loadNetworkRules()}>Правила сети</Button>
        </div>
        {environment?.geolocation && <p className="proj-muted">Позиция: {environment.geolocation.latitude}, {environment.geolocation.longitude}</p>}
        {cookies?.loading && <p role="status">Читаем cookies…</p>}
        {cookies?.error && <p role="alert">{cookies.error}</p>}
        {storage?.loading && <p role="status">Читаем хранилище…</p>}
        {storage?.error && <p role="alert">{storage.error}</p>}
        {storage?.data && (
          <>
            <p className="proj-muted">
              {/* Подписи словами, а не именами API: панель не имеет права обращаться
                  к хранилищу браузера человека, и сторож архитектуры ищет их по тексту. */}
              {storage.data.origin}: постоянное {storage.data.localTotal ?? 0}, на вкладку {storage.data.sessionTotal ?? 0}
              {storage.data.truncated ? ' · показана часть ключей' : ''}
            </p>
            <ul className="playwright-reader-diagnostics__list">
              {[...(storage.data.local ?? []).map((item) => ({ ...item, area: 'local' })), ...(storage.data.session ?? []).map((item) => ({ ...item, area: 'session' }))].map((item) => (
                <li key={`${item.area}:${item.key}`}>
                  <code>{item.key}</code> · {item.area} · {item.bytes} Б · {item.value}
                  <IconButton size="sm" aria-label={`Удалить ${item.key}`} title="Удалить ключ" disabled={phase !== 'ready'}
                    onClick={() => void (async () => {
                      await run({ type: 'selector', action: { kind: 'storage', area: item.area as 'local' | 'session', do: 'remove', key: item.key } })
                      await loadStorage()
                    })()}>✕</IconButton>
                </li>
              ))}
            </ul>
          </>
        )}
        {networkRules && (
          <>
            <p className="proj-muted">
              Правила сети: {networkRules.total}.
              {networkRules.total ? ' Подменённый ответ и заблокированный запрос остаются до конца сессии.' : ' Страница работает с настоящей сетью.'}
            </p>
            {Boolean(networkRules.total) && (
              <ul className="playwright-reader-diagnostics__list">
                {networkRules.rules.map((rule) => (
                  <li key={rule.url}>
                    <code>{rule.url}</code> · {rule.action === 'mock' ? `подмена ${rule.status ?? 200}` : rule.action === 'block' ? 'блокировка' : `задержка ${rule.delayMs ?? 0} мс`}
                    <IconButton size="sm" aria-label={`Снять правило ${rule.url}`} title="Снять правило" disabled={phase !== 'ready'}
                      onClick={() => void loadNetworkRules('remove', rule.url)}>✕</IconButton>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {cookies?.items && (
          <>
            <p className="proj-muted">Cookies сессии: {cookies.total}. Значения длинных показаны сокращённо — это доступ к аккаунту.</p>
            <ul className="playwright-reader-diagnostics__list">
              {cookies.items.map((cookie) => (
                <li key={`${cookie.domain}${cookie.path}${cookie.name}`}><code>{cookie.name}</code> · {cookie.domain}{cookie.path} · {cookie.value}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    )}
    {/* Просьба модели живёт над кадром: человек смотрит на экран браузера, и
        вопрос должен быть там же, где то, чего он касается. */}
    {meta?.ask && !meta.ask.answered && (
      <div className="playwright-reader-ask" role="alert">
        <strong>Модель просит вас:</strong>
        <span>{meta.ask.text}</span>
        <Button size="sm" variant="primary" disabled={phase !== 'ready'}
          onClick={() => void run({ type: 'answer', askId: meta.ask!.id, done: true } as never)}>Сделал</Button>
        <Button size="sm" variant="ghost" disabled={phase !== 'ready'}
          onClick={() => void run({ type: 'answer', askId: meta.ask!.id, done: false } as never)}>Не буду</Button>
      </div>
    )}
    {formInfo && (
      <div className="playwright-reader-diagnostics" role="region" aria-label="Поля формы">
        <div className="playwright-reader-diagnostics__head">
          <strong>Поля формы{formInfo.form ? `: ${formInfo.form.total}` : ''}{formInfo.validity && !formInfo.validity.valid ? ` · не проходят проверку: ${formInfo.validity.blocking.length}` : ''}</strong>
          <IconButton size="sm" aria-label="Обновить поля формы" title="Обновить поля формы" disabled={formInfo.loading} onClick={() => void loadFormInfo()}>⟳</IconButton>
          <IconButton size="sm" aria-label="Скрыть поля формы" title="Скрыть поля формы" onClick={() => setFormInfo(null)}>✕</IconButton>
        </div>
        {formInfo.loading && <p role="status">Читаем форму…</p>}
        {formInfo.error && <p role="alert">{formInfo.error}</p>}
        {formInfo.form?.truncated && <p className="proj-muted">Показана часть полей. Остальные модель дочитает инструментом form-state.</p>}
        {formInfo.form && (
          <ul className="playwright-reader-diagnostics__list">
            {formInfo.form.fields.map((field, index) => (
              <li key={`${field.selector}-${index}`} data-kind={field.invalid ? 'console' : undefined}>
                <code>{field.label || field.name || field.selector}</code>
                {field.type ? ` · ${field.type}` : ''}
                {field.required ? ' · обязательное' : ''}
                {field.disabled ? ' · выключено' : ''}
                {field.checked !== undefined ? ` · ${field.checked ? 'отмечено' : 'снято'}` : field.value ? ` · «${field.value}»` : ' · пусто'}
                {field.invalid && <small> · {field.invalid}</small>}
              </li>
            ))}
          </ul>
        )}
      </div>
    )}
    {diagnostics && (
      <div className="playwright-reader-diagnostics" role="region" aria-label="Диагностика страницы">
        <div className="playwright-reader-diagnostics__head">
          <strong>Ошибки страницы: {diagnostics.console.length} · Неуспешные запросы: {diagnostics.network.length}</strong>
          <IconButton size="sm" aria-label="Обновить диагностику" title="Обновить диагностику" disabled={diagnostics.loading} onClick={() => void loadDiagnostics()}>⟳</IconButton>
          <IconButton size="sm" aria-label="Скрыть диагностику" title="Скрыть диагностику" onClick={() => { diagnosticRequest.current++; setDiagnostics(null) }}>✕</IconButton>
        </div>
        {diagnostics.loading && <p role="status">Читаем журналы вкладки…</p>}
        {diagnostics.error && <p role="alert">Диагностика недоступна: {diagnostics.error}</p>}
        {diagnostics.at && <p className="proj-muted">История выбранной вкладки · обновлено {new Date(diagnostics.at).toLocaleTimeString()}</p>}
        {diagnostics.truncated && <p className="proj-muted">Показана часть журнала. Модель может прочитать оставшиеся записи инструментами console и network.</p>}
        {!diagnostics.loading && !diagnostics.error && diagnostics.console.length === 0 && diagnostics.network.length === 0 && <p className="proj-muted">Страница не жаловалась.</p>}
        {diagnostics.network.length > 0 && (
          <ul className="playwright-reader-diagnostics__list">
            {diagnostics.network.map((entry, index) => <li key={`n${index}`} data-kind="network"><code>{entry.status || 'Сбой сети'}</code> {entry.method} {entry.url}{entry.error && <small> · {entry.error}</small>}</li>)}
          </ul>
        )}
        {diagnostics.console.length > 0 && (
          <ul className="playwright-reader-diagnostics__list">
            {diagnostics.console.map((entry, index) => <li key={`c${index}`} data-kind="console">{entry.text.length > 240 ? <details><summary>{entry.text.slice(0, 240)}…</summary><pre>{entry.text}</pre></details> : entry.text}{(entry.source?.url || entry.pageUrl) && <small> · {entry.source?.url || entry.pageUrl}{entry.source?.line ? `:${entry.source.line}` : ''}</small>}</li>)}
          </ul>
        )}
      </div>
    )}
    <div className="playwright-browser-input">
      <input
        type="text"
        aria-label="Ввод текста в страницу"
        placeholder="Текст в активное поле"
        readOnly={Boolean(activeDialog)}
        value={typing}
        disabled={phase !== 'ready'}
        onChange={(event) => setTyping(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') submitTyping() }}
      />
      <IconButton size="sm" aria-label="Очистить поле ввода" title="Очистить поле ввода" disabled={!typing} onClick={() => setTyping('')}>✕</IconButton>
      <Button size="sm" variant="secondary" disabled={phase !== 'ready' || Boolean(activeDialog) || !typing} onClick={submitTyping}>Ввести</Button>
      <Button size="sm" variant="ghost" disabled={phase !== 'ready'} onClick={() => void run({ type: 'input', action: { type: 'press', key: 'Enter' } })}>Enter</Button>
    </div>
    {frameError && <div className="playwright-reader-message" role="status">{frameError}</div>}
    {message && (
      <div className="playwright-reader-error" role="alert">
        <span>{message}</span>
        {/* Совет раннера — это следующий шаг, а не диагноз: прокрутить, закрыть
            перекрывающее окно, дождаться готовности. */}
        {failure?.advice && <span className="playwright-reader-size">{failure.advice}</span>}
        {failure?.candidates?.length && (
          <span className="playwright-reader-keys" role="group" aria-label="Похожие элементы страницы">
            {failure.candidates.slice(0, 3).map((candidate) => (
              <Button key={candidate.text} size="sm" variant="ghost" disabled={phase !== 'ready'}
                onClick={() => void run({ type: 'selector', action: { kind: 'find', text: candidate.text, limit: 1 } })}>
                {candidate.text}{candidate.disabled ? ' (выключен)' : candidate.visible ? '' : ' (скрыт)'}
              </Button>
            ))}
          </span>
        )}
        {retryable && lastCommand.current && (
          <Button size="sm" variant="secondary" onClick={() => { const cmd = lastCommand.current; if (cmd) void run(cmd) }}>Повторить</Button>
        )}
      </div>
    )}
  </section>
}
