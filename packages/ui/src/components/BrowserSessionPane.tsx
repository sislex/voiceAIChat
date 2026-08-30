import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { isBrowserSessionMetadata, scaleBrowserCoordinates, type BrowserConsoleEntry, type BrowserElementDescription, type BrowserInspectResult, type BrowserNetworkEntry, type BrowserSessionMetadata, type BrowserViewport } from '@shared/types'
import { ambiguousSteps, expectOnLastStep, fragileSteps, hasAssertions, needsWaitHint, recordClick, recordNavigate, recordScroll, recordType, removeStep, renameStep, toScenario, type ClickKind, type RecordedStep } from '../lib/scenarioRecorder'
import { aliasNote, offOrigin, pushHistory } from '../lib/readerAddress'
import type { RendererBrowserBridge } from '@shared/ipc'
import type { ProjectTestUser } from '@shared/projects'
import type { AutomatedQaScenario } from '@shared/qa'
import { Button, IconButton } from '@voicechat/ui-kit'

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

/** Состояние сессии словами: сырое `ready`/`idle` человеку ничего не говорит. */
const STATE_LABELS: Record<string, string> = {
  idle: 'Простаивает', starting: 'Запуск Chromium…', ready: 'Готово',
  loading: 'Загружает страницу…', navigating: 'Переход…', stopped: 'Остановлена', error: 'Ошибка'
}

export interface BrowserSessionPaneProps {
  conversationId: string
  browser?: RendererBrowserBridge
  /** Приложить кадр к сообщению чата: панель отдаёт data-URL, хост решает, что с ним делать. */
  onAttachFrame?: (dataUrl: string) => void
  /**
   * Тестовые учётки проекта. Без них проверять сайт можно только до экрана
   * входа, а логин руками при каждом перезапуске сессии — главная морока.
   */
  testUsers?: ProjectTestUser[]
  /**
   * Сохранить записанный сценарий в настройки проекта. Без этого запись живёт
   * только в буфере обмена, и её надо переносить руками на другой экран — для
   * «много автотестов» это главный барьер.
   */
  onSaveScenario?: (scenario: AutomatedQaScenario) => Promise<void>
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

export function BrowserSessionPane({ conversationId, browser, onAttachFrame, testUsers, onSaveScenario }: BrowserSessionPaneProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>('starting')
  const [viewportId, setViewportId] = useState<'phone' | 'tablet' | 'desktop'>('desktop')
  // Навигация занимает секунды, а кадр всё это время старый: без отметки непонятно,
  // идёт работа или страница просто такая.
  const [busy, setBusy] = useState(false)
  // Момент последнего действия и счётчик перезапуска таймера: после команды
  // опрос ускоряется, через ACTIVE_WINDOW_MS возвращается к спокойному.
  const lastAction = useRef(0)
  const [pollTick, setPollTick] = useState(0)
  const [retryable, setRetryable] = useState(false)
  const lastCommand = useRef<Parameters<RendererBrowserBridge['command']>[1]['command'] | null>(null)
  const [message, setMessage] = useState<string>('')
  // Журналы страницы: раннер копит их с открытия, но до круга 11 показать их
  // было негде — человек видел белый экран и не знал, что упал запрос.
  const [diagnostics, setDiagnostics] = useState<{ console: BrowserConsoleEntry[]; network: BrowserNetworkEntry[] } | null>(null)
  // Запись сценария: ради неё Reader и делается инструментом автотестов —
  // человек проходит путь руками, а на выходе воспроизводимые шаги.
  const [recording, setRecording] = useState(false)
  // Адрес, который человек попросил, — отдельно от того, что загрузилось: раннер
  // мог подменить его алиасом, и молчать об этом нельзя.
  const [requested, setRequested] = useState<string>('')
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
  const [meta, setMeta] = useState<BrowserSessionMetadata | null>(null)
  const [frame, setFrame] = useState<string | null>(null)
  const [address, setAddress] = useState<string>('')
  const [typing, setTyping] = useState<string>('')
  const incarnation = useRef<string | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  // Флаг актуальности: смена разговора или размонтирование отменяет поздние ответы.
  const alive = useRef(0)

  const refreshFrame = useCallback(async (): Promise<void> => {
    if (!browser || !incarnation.current) return
    const generation = alive.current
    try {
      // Качество 60 мылило мелкий текст, а панель нужна именно для разбора
      // вёрстки; 82 заметно читаемее, а кадр остаётся лёгким.
      const shot = await browser.screenshot(conversationId, { incarnation: incarnation.current, format: 'jpeg', quality: 82 })
      if (generation === alive.current) setFrame(shot.dataUrl)
    } catch { /* один пропущенный кадр не роняет панель */ }
  }, [browser, conversationId])

  // Старт сессии на монтирование/смену разговора; stop — на уходе.
  useEffect(() => {
    const generation = ++alive.current
    incarnation.current = null
    setPhase('starting'); setFrame(null); setMeta(null); setMessage('')
    if (!browser) { setPhase('unavailable'); setMessage('Изолированный Chromium недоступен: browser-runner не настроен на сервере. Используйте Web Reader для доступных через прокси страниц или попросите администратора задать VC_BROWSER_RUNNER_URL и VC_BROWSER_RUNNER_TOKEN.'); return }
    void browser.start(conversationId, VIEWPORT).then(
      (started) => {
        if (generation !== alive.current) return
        incarnation.current = started.incarnation
        applyMeta(started); setPhase('ready')
        void refreshFrame()
      },
      (err: unknown) => {
        if (generation !== alive.current) return
        const text = err instanceof Error ? err.message : 'Не удалось запустить Chromium'
        // 501 от сервера означает «раннер не настроен» — это недоступность, не сбой.
        setPhase(/не настроен|недоступен/i.test(text) ? 'unavailable' : 'error')
        setMessage(text)
      }
    )
    return () => {
      alive.current++
      if (browser && incarnation.current) void browser.stop(conversationId)
      incarnation.current = null
    }
  }, [browser, conversationId, refreshFrame])

  // Поллинг кадров, пока сессия готова и вкладка на экране.
  useEffect(() => {
    if (phase !== 'ready') return
    let timer: ReturnType<typeof setInterval> | null = null
    const stop = (): void => { if (timer) { clearInterval(timer); timer = null } }
    const start = (): void => {
      stop()
      const fresh = Date.now() - lastAction.current < ACTIVE_WINDOW_MS
      timer = setInterval(() => void refreshFrame(), fresh ? POLL_ACTIVE_MS : POLL_MS)
    }
    const onVisibility = (): void => { if (document.hidden) stop(); else { void refreshFrame(); start() } }
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [phase, refreshFrame, pollTick])

  /** Единая точка приёма метаданных: и старт, и команда идут через неё —
   *  иначе история посещённого начиналась бы со второй страницы, а сверять уход
   *  с проверяемого сайта было бы не с чем. */
  const applyMeta = (next: BrowserSessionMetadata): void => {
    incarnation.current = next.incarnation
    setMeta(next); setAddress(next.currentUrl ?? '')
    setHistory((current) => pushHistory(current, next.currentUrl))
    if (!origin.current && next.currentUrl) origin.current = next.currentUrl
  }

  const run = useCallback(async (command: Parameters<RendererBrowserBridge['command']>[1]['command']): Promise<unknown> => {
    if (!browser || !incarnation.current) return
    const generation = alive.current
    setBusy(true)
    setMessage(''); setRetryable(false)
    lastCommand.current = command
    lastAction.current = Date.now()
    setPollTick((v) => v + 1)
    try {
      const next = await browser.command(conversationId, { incarnation: incarnation.current, command })
      if (generation !== alive.current) return
      // Метаданные приходят не на всякую команду: `selector` отдаёт чтение,
      // `inspect` — журналы. Обновляем состояние только по метаданным.
      if (isBrowserSessionMetadata(next)) applyMeta(next)
      await refreshFrame()
      return next
    } catch (err) {
      if (generation === alive.current) {
        setMessage(err instanceof Error ? err.message : 'Команда не выполнена')
        // `BrowserError.retryable` говорит, есть ли смысл в повторе. Раньше он
        // приходил и терялся: человеку показывали текст без выхода.
        const code = (err as { code?: unknown })?.code
        const retry = (err as { retryable?: unknown })?.retryable
        setRetryable(retry === true || code === 'timeout' || code === 'not_ready')
      }
    } finally {
      if (generation === alive.current) setBusy(false)
    }
  }, [browser, conversationId, refreshFrame])

  /** Координаты клика в системе вьюпорта: кадр показывается вписанным по ширине. */
  const pointFromEvent = (event: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const img = imgRef.current
    if (!img) return null
    const rect = img.getBoundingClientRect()
    const point = scaleBrowserCoordinates(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height, meta?.viewport ?? VIEWPORT)
    return { x: Math.round(point.x), y: Math.round(point.y) }
  }

  const clickAt = (event: ReactMouseEvent<HTMLImageElement>, button: 'left' | 'right', clickCount: 1 | 2): void => {
    const point = pointFromEvent(event)
    if (!point) return
    void (async () => {
      // В режиме записи сначала спрашиваем, что под курсором: шаг сценария
      // обязан быть селекторным, координатная запись рассыплется от сдвига
      // вёрстки. Клик выполняется в любом случае — запись не мешает работе.
      if (recording) {
        const described = await run({ type: 'selector', action: { kind: 'describe', x: point.x, y: point.y } }) as { element?: BrowserElementDescription } | undefined
        if (described?.element) {
          lastElement.current = described.element
          const kind: ClickKind = button === 'right' ? 'right' : clickCount === 2 ? 'double' : 'left'
          setSteps((current) => withPause(recordClick(current, described.element!, kind)))
        }
      }
      await run({ type: 'input', action: { type: 'click', x: point.x, y: point.y, button, clickCount } })
    })()
  }

  // Колесо: страница длиннее вьюпорта иначе недостижима — прокрутить её было нечем.
  const onFrameWheel = (event: ReactWheelEvent<HTMLImageElement>): void => {
    if (phase !== 'ready') return
    event.preventDefault()
    // Длинная страница без прокрутки не проверяется, поэтому она тоже шаг —
    // слитый, а не по одному на каждый щелчок колеса.
    if (recording) setSteps((current) => recordScroll(current, Math.round(event.deltaY)))
    void run({ type: 'input', action: { type: 'wheel', deltaX: Math.round(event.deltaX), deltaY: Math.round(event.deltaY) } })
  }

  // Клавиатура прямо в кадр: раньше требовалось отдельное поле и подсказка
  // «сначала кликните по нему».
  const onFrameKeyDown = (event: ReactKeyboardEvent<HTMLImageElement>): void => {
    if (phase !== 'ready') return
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      void run({ type: 'input', action: { type: 'type', text: event.key } })
      return
    }
    if (['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault()
      void run({ type: 'input', action: { type: 'press', key: event.key } })
    }
  }

  /** Перезапуск сессии: останавливаем текущую и стартуем заново на том же разговоре. */
  const restartSession = (): void => {
    if (!browser) return
    const generation = ++alive.current
    incarnation.current = null
    setPhase('starting'); setFrame(null); setMeta(null); setMessage(''); setRetryable(false)
    void browser.stop(conversationId)
      .catch(() => {})
      // Выбранный размер окна переживает перезапуск: иначе проверка мобильной
      // вёрстки сбрасывалась на десктоп при каждом «Перезапустить».
      .then(() => browser.start(conversationId, VIEWPORTS.find((v) => v.id === viewportId)?.viewport ?? VIEWPORT))
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
    setBusy(true)
    try {
      const shot = await browser.screenshot(conversationId, { incarnation: incarnation.current, fullPage: true, format: 'png' })
      if (generation === alive.current) onAttachFrame(shot.dataUrl)
    } catch (err) {
      if (generation === alive.current) setMessage(err instanceof Error ? err.message : 'Снимок не получился')
    } finally {
      if (generation === alive.current) setBusy(false)
    }
  }

  /** Ошибки страницы и неуспешные запросы — одним запросом на оба журнала. */
  const loadDiagnostics = async (): Promise<void> => {
    const errors = await run({ type: 'inspect', action: { kind: 'console', level: 'error', limit: 30 } }) as BrowserInspectResult | undefined
    const network = await run({ type: 'inspect', action: { kind: 'network', limit: 50 } }) as BrowserInspectResult | undefined
    setDiagnostics({
      console: errors?.console ?? [],
      // Показываем только неуспешные: успешные запросы человеку не нужны, а
      // список из полусотни строк прячет то, ради чего его открыли.
      network: (network?.network ?? []).filter((entry) => !entry.ok)
    })
  }

  const changeViewport = (id: 'phone' | 'tablet' | 'desktop'): void => {
    const found = VIEWPORTS.find((v) => v.id === id)
    if (!found) return
    setViewportId(id)
    void run({ type: 'resize', viewport: found.viewport })
  }

  const submitAddress = (): void => {
    const url = address.trim()
    if (!url) return
    const full = withScheme(url)
    setRequested(full)
    // Происхождение первого открытого адреса — то, с чем сверяемся дальше:
    // уход на другой хост посреди проверки почти всегда промах или редирект.
    if (!origin.current) origin.current = full
    if (recording) setSteps((current) => withPause(recordNavigate(current, full)))
    void run({ type: 'navigate', url: full })
  }

  const submitTyping = (): void => {
    if (!typing) return
    void (async () => {
      // Ввод тоже обязан попадать в сценарий: без этого в записи остаётся клик
      // по полю и пустое поле — прогон такого шага ничего не проверит.
      if (recording && lastElement.current) setSteps((current) => withPause(recordType(current, lastElement.current!, typing)))
      await run({ type: 'input', action: { type: 'type', text: typing } })
      setTyping('')
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
    </section>
  }

  const tabs = meta?.tabs ?? []
  const fragile = fragileSteps(steps)
  const ambiguous = ambiguousSteps(steps)
  const alias = aliasNote(requested, meta?.currentUrl ?? null)
  const strayed = offOrigin(origin.current, meta?.currentUrl ?? null, alias !== null)

  return <section className="playwright-browser-pane" aria-label="Browser session">
    {tabs.length > 0 && (
      <div className="playwright-reader-tabs" role="tablist" aria-label="Вкладки страницы">
        {tabs.map((tab) => (
          <span key={tab.id} className={`playwright-reader-tab${tab.id === meta?.activeTabId ? ' is-active' : ''}`}>
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === meta?.activeTabId}
              title={tab.url}
              onClick={() => void run({ type: 'selectTab', tabId: tab.id })}
            >{tab.title || tab.url || 'Без названия'}</button>
            {tabs.length > 1 && (
              <IconButton size="sm" aria-label={`Закрыть вкладку ${tab.title || tab.url}`} title="Закрыть вкладку"
                onClick={() => void run({ type: 'closeTab', tabId: tab.id })}>✕</IconButton>
            )}
          </span>
        ))}
        <IconButton size="sm" aria-label="Новая вкладка" title="Новая вкладка" disabled={phase !== 'ready'}
          onClick={() => void run({ type: 'newTab' })}>+</IconButton>
      </div>
    )}
    <div className="playwright-reader-header">
      <IconButton size="sm" aria-label="Назад" title="Назад" disabled={phase !== 'ready'} onClick={() => void run({ type: 'back' })}>‹</IconButton>
      <IconButton size="sm" aria-label="Вперёд" title="Вперёд" disabled={phase !== 'ready'} onClick={() => void run({ type: 'forward' })}>›</IconButton>
      <IconButton size="sm" aria-label="Обновить" title="Обновить" disabled={phase !== 'ready'} onClick={() => void run({ type: 'reload' })}>⟳</IconButton>
      <input
        type="url"
        className="playwright-reader-address"
        aria-label="Адрес страницы"
        placeholder="https://…"
        value={address}
        disabled={phase !== 'ready'}
        onChange={(event) => setAddress(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') submitAddress() }}
      />
      <Button size="sm" variant="secondary" disabled={phase !== 'ready'} onClick={submitAddress}>Открыть</Button>
    </div>
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
      {meta?.lastActor && (
        <span className="playwright-reader-actor" data-actor={meta.lastActor}>
          {meta.lastActor === 'assistant' ? 'последнее действие — модели' : 'последнее действие — ваше'}
        </span>
      )}
      <span className="playwright-reader-state" role="status" data-status={meta?.state ?? phase}>
        {phase === 'starting' ? STATE_LABELS.starting : (STATE_LABELS[meta?.state ?? 'ready'] ?? STATE_LABELS.ready)}
      </span>
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
      {/* Профиль persistent, поэтому «выйти и посмотреть экран входа» иначе
          нечем: перезапуск сессии куки не трогает. */}
      <Button size="sm" variant="ghost" disabled={phase !== 'ready'} onClick={() => void run({ type: 'inspect', action: { kind: 'evaluate', code: 'document.cookie.split(";").forEach(c=>{document.cookie=c.split("=")[0]+"=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/"});localStorage.clear();sessionStorage.clear();"очищено"' } }).then(() => run({ type: 'reload' }))}>
        Очистить сессию сайта
      </Button>
      <span className="playwright-reader-keys" role="group" aria-label="Клавиши">
        {(['Enter', 'Tab', 'Escape'] as const).map((key) => (
          <Button key={key} size="sm" variant="ghost" disabled={phase !== 'ready'} onClick={() => void run({ type: 'input', action: { type: 'press', key } })}>{key}</Button>
        ))}
      </span>
      {/* Долгая навигация ничем не отличалась от зависшей: прервать её было
          нечем, оставался только перезапуск всей сессии. */}
      {busy && <Button size="sm" variant="ghost" onClick={() => void run({ type: 'stop' })}>Прервать</Button>}
      {/* Зависшую страницу иначе не выкинуть: stop звался только при уходе с экрана. */}
      <Button size="sm" variant="ghost" disabled={phase !== 'ready'} onClick={restartSession}>Перезапустить</Button>
    </div>
    {(alias || strayed || history.length > 1) && (
      <div className="playwright-reader-where">
        {alias && <span className="playwright-reader-where__note">{alias}</span>}
        {strayed && <span className="playwright-reader-where__note" role="alert">Страница ушла с проверяемого сайта на {(() => { try { return new URL(meta!.currentUrl!).host } catch { return 'другой адрес' } })()}.</span>}
        {history.length > 1 && (
          <label className="playwright-reader-where__history">Где были
            <select className="sel" value="" disabled={phase !== 'ready'} onChange={(event) => { if (event.target.value) { setRequested(event.target.value); void run({ type: 'navigate', url: event.target.value }) } }}>
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
            tabIndex={0}
            role="application"
            aria-label="Страница в Chromium: клик, прокрутка и клавиатура работают прямо здесь"
            onClick={(event) => clickAt(event, 'left', 1)}
            onDoubleClick={(event) => clickAt(event, 'left', 2)}
            onContextMenu={(event) => { event.preventDefault(); clickAt(event, 'right', 1) }}
            onWheel={onFrameWheel}
            onKeyDown={onFrameKeyDown}
            style={{ width: '100%', display: 'block', cursor: 'pointer' }}
          />
        : <div className="webpreview-empty" role="status">Запуск изолированного Chromium…</div>}
      {busy && <span className="playwright-reader-busy" role="status">Выполняется…</span>}
    </div>
    {steps.length > 0 && (
      <div className="playwright-reader-record" role="region" aria-label="Записанный сценарий">
        <div className="playwright-reader-record__head">
          <strong>Сценарий: {steps.length} шаг(ов)</strong>
          {onSaveScenario && (
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void (async () => {
              const scenario = toScenario(steps, meta?.currentUrl ?? '')
              // Пустой сценарий сохранялся молча, а этап потом блокировался — и
              // узнавалось это только на прогоне.
              if (!scenario.steps.length) { setMessage('Сценарий пуст: запишите хотя бы один шаг'); return }
              try { await onSaveScenario(scenario); setMessage('Сценарий сохранён в настройках проекта') }
              catch (err) { setMessage(err instanceof Error ? err.message : 'Сценарий не сохранён') }
            })()}>Сохранить в проект</Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => { setSteps(meta?.currentUrl ? recordNavigate([], meta.currentUrl) : []); lastStepAt.current = Date.now(); setRecording(true) }}>
            Начать заново
          </Button>
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
          <IconButton size="sm" aria-label="Очистить запись" title="Очистить запись" onClick={() => { setSteps([]); setRecording(false) }}>✕</IconButton>
        </div>
        {!hasAssertions(steps) && (
          // Сценарий без единой проверки зелёный, пока клики попадают, — даже
          // если страница показала ошибку. Это не тест, и молчать об этом нельзя.
          <p className="playwright-reader-record__warn" role="status">Ни одной проверки: такой сценарий пройдёт, даже если страница сломана. Добавьте ожидаемый текст к последнему шагу.</p>
        )}
        {needsWaitHint(steps) && (
          // Длинная пауза почти всегда значит, что человек ждал страницу; без
          // явного ожидания раннер нажмёт быстрее, чем появится элемент.
          <p className="playwright-reader-record__warn">Между шагами были долгие паузы: вы ждали страницу. Добавьте ожидаемый текст, иначе прогон будет нажимать раньше, чем элемент появится.</p>
        )}
        {ambiguous.length > 0 && (
          <p className="playwright-reader-record__warn">Неоднозначных шагов: {ambiguous.length}. Их селектор находит несколько элементов, и шаг нажмёт первый.</p>
        )}
        <div className="playwright-reader-record__expect">
          <label>Ожидаемый текст после последнего шага
            <input className="login-input" value={expectText} disabled={!steps.length} onChange={(event) => setExpectText(event.target.value)} />
          </label>
          <Button size="sm" disabled={!steps.length || !expectText.trim()} onClick={() => { setSteps((current) => expectOnLastStep(current, expectText)); setExpectText('') }}>Ждать текст</Button>
          <Button size="sm" variant="ghost" disabled={!steps.length || !expectText.trim()} onClick={() => { setSteps((current) => expectOnLastStep(current, expectText, true)); setExpectText('') }}>Не должно быть</Button>
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
            <li key={step.id} data-stability={step.stability}>
              <span className="playwright-reader-record__row">
                {/* Название читается в отчёте этапа — его правят чаще всего. */}
                <input
                  className="playwright-reader-record__title"
                  aria-label={`Название шага ${step.id}`}
                  value={step.title}
                  onChange={(event) => setSteps((current) => renameStep(current, step.id, event.target.value))}
                />
                <IconButton size="sm" aria-label={`Убрать шаг «${step.title}»`} title="Убрать шаг" onClick={() => setSteps((current) => removeStep(current, step.id))}>✕</IconButton>
              </span>
              <code>{'selector' in step.action ? step.action.selector : ''}</code>
              {(step.expectText || step.expectAbsentText) && (
                <em className="playwright-reader-record__check">{step.expectText ? `ждём «${step.expectText}»` : `не должно быть «${step.expectAbsentText}»`}</em>
              )}
            </li>
          ))}
        </ol>
      </div>
    )}
    {diagnostics && (
      <div className="playwright-reader-diagnostics" role="region" aria-label="Диагностика страницы">
        <div className="playwright-reader-diagnostics__head">
          <strong>Ошибки страницы: {diagnostics.console.length} · Неуспешные запросы: {diagnostics.network.length}</strong>
          <IconButton size="sm" aria-label="Скрыть диагностику" title="Скрыть диагностику" onClick={() => setDiagnostics(null)}>✕</IconButton>
        </div>
        {diagnostics.console.length === 0 && diagnostics.network.length === 0 && <p className="proj-muted">Страница не жаловалась.</p>}
        {diagnostics.console.length > 0 && (
          <ul className="playwright-reader-diagnostics__list">
            {diagnostics.console.map((entry, index) => <li key={`c${index}`} data-kind="console">{entry.text}</li>)}
          </ul>
        )}
        {diagnostics.network.length > 0 && (
          <ul className="playwright-reader-diagnostics__list">
            {diagnostics.network.map((entry, index) => <li key={`n${index}`} data-kind="network"><code>{entry.status}</code> {entry.method} {entry.url}</li>)}
          </ul>
        )}
      </div>
    )}
    <div className="playwright-browser-input">
      <input
        type="text"
        aria-label="Ввод текста в страницу"
        placeholder="Текст в активное поле"
        value={typing}
        disabled={phase !== 'ready'}
        onChange={(event) => setTyping(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') submitTyping() }}
      />
      <Button size="sm" variant="secondary" disabled={phase !== 'ready' || !typing} onClick={submitTyping}>Ввести</Button>
      <Button size="sm" variant="ghost" disabled={phase !== 'ready'} onClick={() => void run({ type: 'input', action: { type: 'press', key: 'Enter' } })}>Enter</Button>
    </div>
    {message && (
      <div className="playwright-reader-error" role="alert">
        <span>{message}</span>
        {retryable && lastCommand.current && (
          <Button size="sm" variant="secondary" onClick={() => { const cmd = lastCommand.current; if (cmd) void run(cmd) }}>Повторить</Button>
        )}
      </div>
    )}
  </section>
}
