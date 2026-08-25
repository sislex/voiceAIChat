import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { scaleBrowserCoordinates, type BrowserSessionMetadata, type BrowserViewport } from '@shared/types'
import type { RendererBrowserBridge } from '@shared/ipc'

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
const POLL_MS = 1200

export interface BrowserSessionPaneProps {
  conversationId: string
  browser?: RendererBrowserBridge
}

type Phase = 'starting' | 'ready' | 'unavailable' | 'error'

export function BrowserSessionPane({ conversationId, browser }: BrowserSessionPaneProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>('starting')
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

  // Поллинг кадров, пока сессия готова.
  useEffect(() => {
    if (phase !== 'ready') return
    const timer = setInterval(() => void refreshFrame(), POLL_MS)
    return () => clearInterval(timer)
  }, [phase, refreshFrame])

  const applyMeta = (next: BrowserSessionMetadata): void => {
    incarnation.current = next.incarnation
    setMeta(next); setAddress(next.currentUrl ?? '')
  }

  const run = useCallback(async (command: Parameters<RendererBrowserBridge['command']>[1]['command']): Promise<void> => {
    if (!browser || !incarnation.current) return
    const generation = alive.current
    try {
      const next = await browser.command(conversationId, { incarnation: incarnation.current, command })
      if (generation !== alive.current) return
      applyMeta(next)
      await refreshFrame()
    } catch (err) {
      if (generation === alive.current) setMessage(err instanceof Error ? err.message : 'Команда не выполнена')
    }
  }, [browser, conversationId, refreshFrame])

  const submitAddress = (): void => {
    const url = address.trim()
    if (!url) return
    void run({ type: 'navigate', url: /^https?:\/\//i.test(url) ? url : `https://${url}` })
  }

  const onFrameClick = (event: ReactMouseEvent<HTMLImageElement>): void => {
    const img = imgRef.current
    if (!img) return
    const rect = img.getBoundingClientRect()
    const point = scaleBrowserCoordinates(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height, meta?.viewport ?? VIEWPORT)
    void run({ type: 'input', action: { type: 'click', x: Math.round(point.x), y: Math.round(point.y), button: 'left', clickCount: 1 } })
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

  return <section className="playwright-browser-pane" aria-label="Browser session">
    <div className="playwright-reader-header">
      <button type="button" className="vc-btn vc-btn--icon" aria-label="Назад" title="Назад" disabled={phase !== 'ready'} onClick={() => void run({ type: 'back' })}>‹</button>
      <button type="button" className="vc-btn vc-btn--icon" aria-label="Вперёд" title="Вперёд" disabled={phase !== 'ready'} onClick={() => void run({ type: 'forward' })}>›</button>
      <button type="button" className="vc-btn vc-btn--icon" aria-label="Обновить" title="Обновить" disabled={phase !== 'ready'} onClick={() => void run({ type: 'reload' })}>⟳</button>
      <input
        type="url"
        aria-label="Адрес страницы"
        placeholder="https://…"
        value={address}
        disabled={phase !== 'ready'}
        onChange={(event) => setAddress(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') submitAddress() }}
      />
      <button type="button" className="vc-btn vc-btn--secondary" disabled={phase !== 'ready'} onClick={submitAddress}>Открыть</button>
      <span role="status" data-status={meta?.state ?? phase}>{phase === 'starting' ? 'Запуск Chromium…' : meta?.state ?? 'ready'}</span>
    </div>
    <div className="playwright-browser-viewport">
      {frame
        ? <img ref={imgRef} src={frame} alt="Кадр Chromium" onClick={onFrameClick} style={{ width: '100%', display: 'block', cursor: 'pointer' }} />
        : <div className="webpreview-empty" role="status">Запуск изолированного Chromium…</div>}
    </div>
    <div className="playwright-browser-input">
      <input
        type="text"
        aria-label="Ввод текста в страницу"
        placeholder="Текст для ввода в активное поле (сначала кликните по нему)"
        value={typing}
        disabled={phase !== 'ready'}
        onChange={(event) => setTyping(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') submitTyping() }}
      />
      <button type="button" className="vc-btn vc-btn--secondary" disabled={phase !== 'ready' || !typing} onClick={submitTyping}>Ввести</button>
      <button type="button" className="vc-btn vc-btn--ghost" disabled={phase !== 'ready'} onClick={() => void run({ type: 'input', action: { type: 'press', key: 'Enter' } })}>Enter</button>
    </div>
    {message && <div className="webpreview-empty" role="alert">{message}</div>}
  </section>
}
