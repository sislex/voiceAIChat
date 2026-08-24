import { useEffect, useRef, useState } from 'react'
import { PREVIEW_ACTION_COMMAND_TYPE, PREVIEW_ACTION_RESULT_TYPE, PREVIEW_PAGE_LOADING_TYPE, PREVIEW_PAGE_READY_TYPE, type PreviewDomAction } from '@shared/previewActions'
import { PREVIEW_INSPECTOR_COMMAND_TYPE, PREVIEW_INSPECTOR_MESSAGE_TYPE, isPreviewInspectorCommand } from '@shared/previewInspector'
import {
  WEB_RECORDER_CAPABILITIES,
  WEB_RECORDER_MESSAGE_TYPE,
  WEB_RECORDER_PROTOCOL_VERSION,
  isWebRecorderHostMessage,
  type WebRecorderClientMessage,
  type WebRecorderScenarioStep
} from '@shared/webRecorder'
import { browserId } from '@shared/browserId'
import { scenarioToPlaywright } from './playwrightExport'

// Самостоятельное iframe-приложение Web Reader. Владеет адресной строкой,
// внутренним iframe /api/preview, состояниями страницы, инспектором, записью
// сценария и панелью диагностического прогресса. С host ChatAI общается только
// версионированным контрактом @shared/webRecorder: каждое сообщение после init
// несёт conversationId и registrationId актуальной регистрации.

type Step = WebRecorderScenarioStep
/** Адресованные ответы Reader (без ready); Omit не дистрибутивен над union. */
type Addressed = Extract<WebRecorderClientMessage, { registrationId: string }>
type ReplyBody = Addressed extends infer M ? M extends Addressed ? Omit<M, 'type' | 'conversationId' | 'registrationId'> : never : never
interface DiagnosticsStep { requestId: string; action: string; ok: boolean; durationMs: number }
const RECORD = 'voicechat.preview.record.v1'
// Режим правок страницы: канал Reader ↔ инъецированный скрипт previewProxy.
const EDIT = 'voicechat.preview.edit.v1'
// Режим скриншота области: тот же канал Reader ↔ инъецированный скрипт.
const CAPTURE = 'voicechat.preview.capture.v1'
const sameOrigin = window.location.origin
const validUrl = (value: string): string | null => { try { const url = new URL(value.trim()); return /^https?:$/.test(url.protocol) ? url.toString() : null } catch { return null } }
/** Ключ сохранённого сценария страницы (localStorage браузера, по origin+path). */
const scenarioKey = (pageUrl: string): string | null => {
  try { const url = new URL(pageUrl); return 'voicechat.reader.scenario.v1:' + url.origin + url.pathname } catch { return null }
}
const loadScenario = (pageUrl: string | null): Step[] => {
  if (!pageUrl) return []
  const key = scenarioKey(pageUrl)
  if (!key) return []
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]') as Step[]
    return Array.isArray(parsed) ? parsed.filter((step) => (step.kind === 'click' || step.kind === 'type') && typeof step.selector === 'string') : []
  } catch { return [] }
}
/** Пресеты адаптива: ширина iframe для проверки мобильной/планшетной вёрстки. */
const VIEWPORTS = [['', 'Адаптив'], ['375', 'iPhone 375'], ['768', 'Планшет 768'], ['1024', 'Ноутбук 1024']] as const

export function Recorder(): JSX.Element {
  const [url, setUrl] = useState<string | null>(null); const [draft, setDraft] = useState(''); const [recording, setRecording] = useState(false)
  const [inspecting, setInspecting] = useState(false); const [editing, setEditing] = useState(false); const [capturing, setCapturing] = useState(false); const [disposed, setDisposed] = useState(false)
  const [steps, setSteps] = useState<Step[]>([]); const [error, setError] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<DiagnosticsStep[] | null>(null)
  const [viewport, setViewport] = useState('')
  // Значения секретных шагов на время запуска: не сохраняются и не покидают Reader.
  const [secretValues, setSecretValues] = useState<Record<number, string>>({})
  const frame = useRef<HTMLIFrameElement>(null); const pageReady = useRef(false); const currentUrl = useRef<string | null>(null)
  // Ключ пересоздания iframe: set-url(null)+set-url(url) могут слипнуться в один
  // React-рендер, и iframe с тем же src не перезагрузился бы — page-ready не пришёл бы.
  const [frameKey, setFrameKey] = useState(0)
  // Актуальная регистрация от init; до неё Reader шлёт только ready.
  const session = useRef<{ conversationId: string; registrationId: string } | null>(null)
  const diagnosticsMode = useRef(false)
  // Времена стартов diagnostic-команд: по ним считается durationMs прогресса.
  const diagnosticStarts = useRef(new Map<string, { action: string; started: number }>())

  const reply = (message: ReplyBody): void => {
    const ids = session.current
    if (!ids) return
    window.parent.postMessage({ type: WEB_RECORDER_MESSAGE_TYPE, conversationId: ids.conversationId, registrationId: ids.registrationId, ...message }, sameOrigin)
  }
  const applyUrl = (next: string | null): void => {
    pageReady.current = false
    currentUrl.current = next
    if (next) setFrameKey((value) => value + 1)
    setUrl(next); setDraft(next ?? ''); setError(null)
    // Сценарий этой страницы сохраняется в браузере — восстанавливаем при открытии.
    setSteps(loadScenario(next)); setSecretValues({})
    reply({ kind: 'page-status', status: next ? 'loading' : 'empty', url: next })
  }

  useEffect(() => {
    const applyUrlRef = applyUrl // замыкание стабильно: все изменяемые данные в ref
    const receiveHost = (data: unknown): void => {
      if (!isWebRecorderHostMessage(data)) return
      const message = data
      if (message.kind === 'init') {
        const same = session.current && session.current.conversationId === message.conversationId && session.current.registrationId === message.registrationId
        session.current = { conversationId: message.conversationId, registrationId: message.registrationId }
        setDisposed(false)
        // Идемпотентный повтор init той же регистрации не перезагружает страницу.
        if (same && message.previewUrl === currentUrl.current) {
          reply({ kind: 'page-status', status: pageReady.current ? 'ready' : currentUrl.current ? 'loading' : 'empty', url: currentUrl.current })
          return
        }
        applyUrlRef(message.previewUrl)
        return
      }
      const ids = session.current
      if (!ids || message.conversationId !== ids.conversationId || message.registrationId !== ids.registrationId) return
      if (message.kind === 'set-url') { applyUrlRef(message.url); return }
      if (message.kind === 'command') {
        if (!pageReady.current || !frame.current?.contentWindow) {
          reply({ kind: 'result', requestId: message.requestId, ok: false, error: 'Страница ещё загружается.' })
          return
        }
        if (diagnosticsMode.current || message.action.diagnostic === true) {
          diagnosticStarts.current.set(message.requestId, { action: message.action.kind, started: performance.now() })
        }
        frame.current.contentWindow.postMessage({ type: PREVIEW_ACTION_COMMAND_TYPE, requestId: message.requestId, action: message.action }, sameOrigin)
        return
      }
      if (message.kind === 'inspector-state') {
        setInspecting(message.enabled)
        frame.current?.contentWindow?.postMessage({ type: PREVIEW_INSPECTOR_COMMAND_TYPE, enabled: message.enabled }, sameOrigin)
        return
      }
      if (message.kind === 'recording-state') { setRecording(message.enabled); return }
      if (message.kind === 'diagnostics-start') {
        if (message.active) { diagnosticsMode.current = true; setDiagnostics([]) }
        else {
          diagnosticsMode.current = false
          setDiagnostics((current) => {
            reply({ kind: 'diagnostics-complete', total: current?.length ?? 0 })
            return current
          })
          diagnosticStarts.current.clear()
        }
        return
      }
      if (message.kind === 'dispose') {
        reply({ kind: 'disposed' })
        session.current = null
        setDisposed(true)
      }
    }
    const receivePage = (data: unknown): void => {
      const message = data as { type?: unknown; requestId?: unknown; ok?: unknown; result?: unknown; error?: unknown; payload?: unknown; step?: unknown; enabled?: unknown }
      if (message?.type === PREVIEW_PAGE_READY_TYPE) { pageReady.current = true; reply({ kind: 'page-status', status: 'ready', url: currentUrl.current }); return }
      if (message?.type === PREVIEW_PAGE_LOADING_TYPE) { pageReady.current = false; reply({ kind: 'page-status', status: 'loading', url: currentUrl.current }); return }
      if (message?.type === PREVIEW_ACTION_RESULT_TYPE && typeof message.requestId === 'string') {
        const diagnostic = diagnosticStarts.current.get(message.requestId)
        if (diagnostic) {
          diagnosticStarts.current.delete(message.requestId)
          const progress = { requestId: message.requestId, action: diagnostic.action, ok: message.ok === true, durationMs: Math.round(performance.now() - diagnostic.started) }
          setDiagnostics((current) => current ? [...current, progress] : current)
          reply({ kind: 'diagnostics-progress', ...progress })
        }
        // Локальные шаги сценария не имеют pending на стороне host — не отвечаем.
        if (message.requestId.startsWith('local-')) return
        reply({ kind: 'result', requestId: message.requestId, ok: message.ok === true, ...(message.result !== undefined ? { result: message.result as never } : {}), ...(typeof message.error === 'string' ? { error: message.error } : {}) })
        return
      }
      if (isPreviewInspectorCommand(message)) { setInspecting(message.enabled); return }
      if (message?.type === EDIT && message.enabled === false) { setEditing(false); return }
      if (message?.type === CAPTURE) {
        const capture = message as { enabled?: unknown; shot?: { dataUrl?: unknown; rect?: unknown; pageUrl?: unknown }; error?: unknown }
        if (capture.enabled === false) setCapturing(false)
        if (typeof capture.error === 'string') { setError('Снимок области не получился: ' + capture.error); return }
        const shot = capture.shot
        if (shot && typeof shot.dataUrl === 'string' && typeof shot.pageUrl === 'string' && shot.rect) {
          reply({ kind: 'area-screenshot', shot: { dataUrl: shot.dataUrl, rect: shot.rect as { x: number; y: number; width: number; height: number }, pageUrl: shot.pageUrl } })
        }
        return
      }
      if (message?.type === PREVIEW_INSPECTOR_MESSAGE_TYPE) { reply({ kind: 'element-selected', element: message.payload as never }); return }
      if (message?.type === RECORD && !diagnosticsMode.current) {
        const raw = message.step as { kind?: unknown; selector?: unknown; text?: unknown; sensitive?: unknown; submit?: unknown } | undefined
        if (!raw || (raw.kind !== 'click' && raw.kind !== 'type') || typeof raw.selector !== 'string') return
        const sensitive = raw.sensitive === true
        // Значение секретного поля не сохраняется и не покидает страницу.
        const step: Step = { kind: raw.kind, selector: raw.selector, text: sensitive ? '' : typeof raw.text === 'string' ? raw.text : '', sensitive, ...(raw.kind === 'type' && raw.submit === true ? { submit: true } : {}) }
        setSteps((old) => [...old, step])
        reply({ kind: 'recording-step', step })
      }
    }
    const receive = (event: MessageEvent): void => {
      if (event.origin !== sameOrigin) return
      const page = frame.current?.contentWindow
      if (page && event.source === page) { receivePage(event.data); return }
      if (event.source === window.parent) receiveHost(event.data)
    }
    window.addEventListener('message', receive)
    // ready уходит строго после установки listener; при remount той же загрузки
    // известные ID позволяют host-у повторить init идемпотентно, без ротации.
    window.parent.postMessage({
      type: WEB_RECORDER_MESSAGE_TYPE,
      kind: 'ready',
      protocolVersion: WEB_RECORDER_PROTOCOL_VERSION,
      conversationId: session.current?.conversationId ?? null,
      registrationId: session.current?.registrationId ?? null,
      capabilities: WEB_RECORDER_CAPABILITIES
    }, sameOrigin)
    return () => window.removeEventListener('message', receive)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!url) return
    const key = scenarioKey(url)
    if (!key) return
    try {
      if (steps.length) localStorage.setItem(key, JSON.stringify(steps))
      else localStorage.removeItem(key)
    } catch { /* квота браузера — сценарий просто не сохранится */ }
  }, [steps, url])
  useEffect(() => { frame.current?.contentWindow?.postMessage({ type: RECORD, enabled: recording }, sameOrigin) }, [recording, url])
  useEffect(() => { frame.current?.contentWindow?.postMessage({ type: EDIT, enabled: editing }, sameOrigin) }, [editing, url])
  useEffect(() => { frame.current?.contentWindow?.postMessage({ type: CAPTURE, enabled: capturing }, sameOrigin) }, [capturing, url])
  const open = (): void => {
    const next = validUrl(draft)
    if (draft && !next) { setError('Введите адрес с протоколом http:// или https://'); return }
    applyUrl(next)
    reply({ kind: 'save-url', url: next })
  }
  const toggleInspector = (): void => {
    const next = !inspecting
    setInspecting(next)
    frame.current?.contentWindow?.postMessage({ type: PREVIEW_INSPECTOR_COMMAND_TYPE, enabled: next }, sameOrigin)
  }
  const run = (): void => {
    if (!frame.current?.contentWindow || !url) return
    for (const [index, step] of steps.entries()) {
      // Секретные шаги воспроизводятся значением, введённым перед запуском.
      const text = step.sensitive ? (secretValues[index] ?? '') : step.text
      if (step.sensitive && !text) { setError(`Шаг ${index + 1}: введите секретное значение перед запуском (оно не сохраняется).`); return }
      const action: PreviewDomAction = step.kind === 'click'
        ? { kind: 'click', selector: step.selector }
        : { kind: 'type', selector: step.selector, text, ...(step.submit ? { submit: true } : {}) }
      frame.current.contentWindow.postMessage({ type: PREVIEW_ACTION_COMMAND_TYPE, requestId: 'local-' + browserId(), action }, sameOrigin)
    }
    setError(null)
  }
  const historyGo = (delta: -1 | 1): void => {
    try { delta === -1 ? frame.current?.contentWindow?.history.back() : frame.current?.contentWindow?.history.forward() } catch { /* cross-doc сразу после загрузки */ }
  }
  const resetSession = (): void => {
    void fetch('/api/preview/reset-cookies', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then((res) => {
        if (!res.ok) throw new Error('HTTP ' + res.status)
        // Разлогиненное состояние видно после перезагрузки страницы.
        if (currentUrl.current) applyUrl(currentUrl.current)
      })
      .catch(() => setError('Не удалось сбросить сессии превью.'))
  }
  const exportPlaywright = (): void => {
    if (!url || !steps.length) return
    const blob = new Blob([scenarioToPlaywright(url, steps)], { type: 'text/typescript' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'web-reader-scenario.spec.ts'
    link.click()
    URL.revokeObjectURL(link.href)
  }
  if (disposed) return <section className="webpreview" aria-label="Web Reader"><div className="webpreview-empty" role="status">Панель Web Reader отключена host-приложением</div></section>
  return <section className="webpreview" aria-label="Web Reader">
    <form className="webpreview-bar" onSubmit={(event) => { event.preventDefault(); open() }}>
      <button className="vc-btn vc-btn--secondary" type="button" disabled={!url} aria-label="Назад" title="Назад" onClick={() => historyGo(-1)}>‹</button>
      <button className="vc-btn vc-btn--secondary" type="button" disabled={!url} aria-label="Вперёд" title="Вперёд" onClick={() => historyGo(1)}>›</button>
      <label className="webpreview-address"><span className="vc-sr-only">Адрес превью</span><input type="url" value={draft} placeholder="https://example.com" onChange={(event) => setDraft(event.target.value)} /></label>
      <button className="vc-btn vc-btn--secondary">Открыть</button>
      <label><span className="vc-sr-only">Ширина вьюпорта</span><select aria-label="Ширина вьюпорта" value={viewport} onChange={(event) => setViewport(event.target.value)}>{VIEWPORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button className="vc-btn vc-btn--secondary" type="button" disabled={!url} title="Сбросить cookie-сессии окружений (перелогиниться)" onClick={resetSession}>⟲ Сессия</button>
      <button className="vc-btn vc-btn--secondary" type="button" disabled={!url} aria-pressed={inspecting} onClick={toggleInspector}>⌖ Выбор элемента</button>
      <button className="vc-btn vc-btn--secondary" type="button" disabled={!url} aria-pressed={editing} onClick={() => setEditing((value) => !value)}>✎ Редактировать</button>
      <button className="vc-btn vc-btn--secondary" type="button" disabled={!url} aria-pressed={capturing} onClick={() => setCapturing((value) => !value)}>📸 Область</button>
      <button className="vc-btn vc-btn--secondary" type="button" disabled={!url} onClick={() => setRecording((value) => !value)}>{recording ? 'Остановить запись' : 'Записать сценарий'}</button>
    </form>
    {error && <p className="webpreview-error" role="alert">{error}</p>}
    {diagnostics && <section className="webpreview-scenario" aria-label="Диагностика Web Reader">
      <strong>Диагностика: {diagnostics.length} шаг.</strong>
      <ol>{diagnostics.map((step) => <li key={step.requestId} data-status={step.ok ? 'passed' : 'failed'}>{step.ok ? '✓' : '✕'} <code>{step.action}</code> — {step.durationMs} мс</li>)}</ol>
    </section>}
    {steps.length > 0 && <section className="webpreview-scenario" aria-label="Сценарий автотеста">
      <button className="vc-btn vc-btn--secondary" onClick={run}>Запустить</button>
      <button className="vc-btn vc-btn--secondary" type="button" onClick={exportPlaywright}>Экспорт в Playwright</button>
      <button className="vc-btn vc-btn--secondary" type="button" onClick={() => { setSteps([]); setSecretValues({}) }}>Очистить</button>
      <ol>
      {steps.map((step, index) => <li key={index}><code>{step.kind}</code><input aria-label={'Селектор шага ' + (index + 1)} value={step.selector} onChange={(event) => setSteps((all) => all.map((item, i) => i === index ? { ...item, selector: event.target.value } : item))} />
        {step.kind === 'type' && !step.sensitive && <input aria-label={'Значение шага ' + (index + 1)} value={step.text} onChange={(event) => setSteps((all) => all.map((item, i) => i === index ? { ...item, text: event.target.value } : item))} />}
        {step.kind === 'type' && step.sensitive && <input aria-label={'Секретное значение шага ' + (index + 1)} type="password" value={secretValues[index] ?? ''} placeholder="введите для запуска" onChange={(event) => setSecretValues((all) => ({ ...all, [index]: event.target.value }))} />}
        {step.submit === true && <em>⏎ submit</em>}
        {step.sensitive && <em>секрет не сохраняется</em>}</li>)}
    </ol></section>}
    {url ? <iframe key={frameKey} ref={frame} className="webpreview-frame" style={viewport ? { width: viewport + 'px', maxWidth: '100%', margin: '0 auto', display: 'block' } : undefined} src={'/api/preview?url=' + encodeURIComponent(url)} title="Предпросмотр сайта" onLoad={() => { setTimeout(() => { if (pageReady.current) return; let message = 'Сайт недоступен или вернул страницу, которую Web Reader не может прочитать.'; try { const body = frame.current?.contentDocument?.body?.textContent?.trim(); if (body) { const parsed = JSON.parse(body) as { message?: unknown }; if (typeof parsed.message === 'string') message = parsed.message } } catch { /* не-JSON страница без клиентского моста */ }; reply({ kind: 'page-status', status: 'error', url, error: message }) }, 0) }} onError={() => { pageReady.current = false; reply({ kind: 'page-status', status: 'error', url, error: 'Не удалось загрузить сайт: сетевая ошибка.' }) }} /> : <div className="webpreview-empty">Укажите http/https-адрес проекта</div>}
  </section>
}
