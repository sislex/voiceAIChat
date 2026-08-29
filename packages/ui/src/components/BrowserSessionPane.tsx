import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { scaleBrowserCoordinates, type BrowserSessionMetadata, type BrowserViewport } from '@shared/types'
import type { RendererBrowserBridge } from '@shared/ipc'
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
}

type Phase = 'starting' | 'ready' | 'unavailable' | 'error'

export function BrowserSessionPane({ conversationId, browser, onAttachFrame }: BrowserSessionPaneProps): JSX.Element {
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
      const shot = await browser.screenshot(conversationId, { incarnation: incarnation.current, format: 'jpeg', quality: 60 })
      if (generation === alive.current) setFrame(shot.dataUrl)
    } catch { /* один пропущенный кадр не роняет панель */ }
  }, [browser, conversationId])

  // Старт сессии на монтирование/смену разговора; stop — на уходе.
  useEffect(() => {
    const generation = ++alive.current
    incarnation.current = null
    setPhase('starting'); setFrame(null); setMeta(null); setMessage('')
    if (!browser) { setPhase('unavailable'); setMessage('Изолированный Chromium недоступен: браузерный мост не подключён.'); return }
    void browser.start(conversationId, VIEWPORT).then(
      (started) => {
        if (generation !== alive.current) return
        incarnation.current = started.incarnation
        setMeta(started); setAddress(started.currentUrl ?? ''); setPhase('ready')
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

  const applyMeta = (next: BrowserSessionMetadata): void => {
    incarnation.current = next.incarnation
    setMeta(next); setAddress(next.currentUrl ?? '')
  }

  const run = useCallback(async (command: Parameters<RendererBrowserBridge['command']>[1]['command']): Promise<void> => {
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
      applyMeta(next)
      await refreshFrame()
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
    void run({ type: 'input', action: { type: 'click', x: point.x, y: point.y, button, clickCount } })
  }

  // Колесо: страница длиннее вьюпорта иначе недостижима — прокрутить её было нечем.
  const onFrameWheel = (event: ReactWheelEvent<HTMLImageElement>): void => {
    if (phase !== 'ready') return
    event.preventDefault()
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
      .then(() => browser.start(conversationId, VIEWPORT))
      .then((started) => {
        if (generation !== alive.current) return
        incarnation.current = started.incarnation
        setMeta(started); setAddress(started.currentUrl ?? ''); setPhase('ready')
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

  const changeViewport = (id: 'phone' | 'tablet' | 'desktop'): void => {
    const found = VIEWPORTS.find((v) => v.id === id)
    if (!found) return
    setViewportId(id)
    void run({ type: 'resize', viewport: found.viewport })
  }

  const submitAddress = (): void => {
    const url = address.trim()
    if (!url) return
    void run({ type: 'navigate', url: /^https?:\/\//i.test(url) ? url : `https://${url}` })
  }

  const submitTyping = (): void => {
    if (!typing) return
    void run({ type: 'input', action: { type: 'type', text: typing } }).then(() => setTyping(''))
  }

  if (phase === 'unavailable' || phase === 'error') {
    return <section className="playwright-browser-pane" aria-label="Browser session">
      <div className="playwright-reader-header"><strong>Playwright Reader</strong></div>
      <div className="webpreview-empty" role={phase === 'error' ? 'alert' : 'status'}>{message || 'Изолированный Chromium недоступен'}</div>
    </section>
  }

  const tabs = meta?.tabs ?? []

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
      <span className="playwright-reader-state" role="status" data-status={meta?.state ?? phase}>
        {phase === 'starting' ? STATE_LABELS.starting : (STATE_LABELS[meta?.state ?? 'ready'] ?? STATE_LABELS.ready)}
      </span>
      {/* Зависшую страницу иначе не выкинуть: stop звался только при уходе с экрана. */}
      <Button size="sm" variant="ghost" disabled={phase !== 'ready'} onClick={restartSession}>Перезапустить</Button>
    </div>
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
