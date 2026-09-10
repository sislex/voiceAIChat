import { READER_PROJECT_ORIGIN, readerProjectUrl } from '@shared/previewProject'
import { Button, IconButton } from '@voicechat/ui-kit'
import { appendWebRecorderStep, normalizeWebRecorderStep } from '@shared/webRecorderScenario'
import { loadScenario, scenarioKey } from './scenarioStorage'
import { createScenarioRunner, type ScenarioProgress } from './scenarioRunner'
import { normalizeReaderAddress } from './readerAddress'
import { useEffect, useRef, useState } from 'react'
import { PREVIEW_ACTION_LIMITS, PREVIEW_ACTION_COMMAND_TYPE, PREVIEW_ACTION_RESULT_TYPE, PREVIEW_PAGE_LOADING_TYPE, PREVIEW_PAGE_READY_TYPE } from '@shared/previewActions'
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
/** Пресеты адаптива: ширина iframe для проверки мобильной/планшетной вёрстки. */
const VIEWPORTS = [['', 'Адаптив'], ['375', 'iPhone 375'], ['768', 'Планшет 768'], ['1024', 'Ноутбук 1024']] as const

export function Recorder(): JSX.Element {
  const [url, setUrl] = useState<string | null>(null); const [draft, setDraft] = useState(''); const [recording, setRecording] = useState(false)
  const [inspecting, setInspecting] = useState(false); const [editing, setEditing] = useState(false); const [capturing, setCapturing] = useState(false); const [disposed, setDisposed] = useState(false)
  const [steps, setSteps] = useState<Step[]>([]); const [error, setError] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<DiagnosticsStep[] | null>(null)
  const [scenarioUrl, setScenarioUrl] = useState<string | null>(null)
  const [scenarioProgress, setScenarioProgress] = useState<ScenarioProgress | null>(null)
  const scenarioRunner = useRef<ReturnType<typeof createScenarioRunner> | null>(null)
  const scenarioRunning = scenarioProgress?.status === 'running'
  const [viewport, setViewport] = useState('')
  const [loadState, setLoadState] = useState<'empty' | 'loading' | 'ready' | 'error'>('empty')
  const [loadError, setLoadError] = useState<string | null>(null)
  const toolsMenu = useRef<HTMLDetailsElement>(null)
  const loadGeneration = useRef(0)
  const loadTimers = useRef(new Set<ReturnType<typeof setTimeout>>())
  // Значения секретных шагов на время запуска: не сохраняются и не покидают Reader.
  const [secretValues, setSecretValues] = useState<Record<number, string>>({})
  const frame = useRef<HTMLIFrameElement>(null); const pageReady = useRef(false); const currentUrl = useRef<string | null>(null)
  // Ключ пересоздания iframe: set-url(null)+set-url(url) могут слипнуться в один
  // React-рендер, и iframe с тем же src не перезагрузился бы — page-ready не пришёл бы.
  const [frameKey, setFrameKey] = useState(0)
  // Актуальная регистрация от init; до неё Reader шлёт только ready.
  const session = useRef<{ conversationId: string; registrationId: string } | null>(null)
  const modes = useRef({ recording, inspecting, editing, capturing })
  modes.current = { recording, inspecting, editing, capturing }
  const diagnosticsMode = useRef(false)
  // Времена стартов diagnostic-команд: по ним считается durationMs прогресса.
  const diagnosticStarts = useRef(new Map<string, { action: string; started: number }>())

  const reply = (message: ReplyBody): void => {
    const ids = session.current
    if (!ids) return
    window.parent.postMessage({ type: WEB_RECORDER_MESSAGE_TYPE, conversationId: ids.conversationId, registrationId: ids.registrationId, ...message }, sameOrigin)
  }
  const setRecordingMode = (enabled: boolean): void => {
    // Режим доходит до страницы в обработчике кнопки: passive effect мог
    // отложиться до следующего paint и потерять первый быстрый ввод.
    modes.current.recording = enabled
    frame.current?.contentWindow?.postMessage({ type: RECORD, enabled }, sameOrigin)
    setRecording(enabled)
  }
  const applyUrl = (next: string | null): void => {
    if (next) next = readerProjectUrl(next, sameOrigin)
    loadGeneration.current++
    scenarioRunner.current?.cancel('Открывается другая страница — запуск отменён.')
    scenarioRunner.current?.setReady(false)
    pageReady.current = false
    setLoadState(next ? 'loading' : 'empty'); setLoadError(null)
    currentUrl.current = next
    if (next) setFrameKey((value) => value + 1)
    setUrl(next); setDraft(next ?? ''); setError(null)
    // Сценарий этой страницы сохраняется в браузере — восстанавливаем при открытии.
    setScenarioUrl(next); setSteps(loadScenario(next)); setSecretValues({})
    reply({ kind: 'page-status', status: next ? 'loading' : 'empty', url: next })
  }

  useEffect(() => {
    let alive = true
    const runner = createScenarioRunner({
      newId: browserId,
      onProgress: progress => { if (alive) setScenarioProgress(progress) },
      send: (requestId, action) => {
        const target = frame.current?.contentWindow
        if (!target) throw new Error('Страница закрыта')
        target.postMessage({ type: PREVIEW_ACTION_COMMAND_TYPE, requestId, action }, sameOrigin)
      }
    })
    scenarioRunner.current = runner
    runner.setReady(pageReady.current)
    return () => { alive = false; runner.dispose(); if (scenarioRunner.current === runner) scenarioRunner.current = null }
  }, [])

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
        if (scenarioRunner.current?.isRunning()) { reply({ kind: 'result', requestId: message.requestId, ok: false, error: 'Выполняется сценарий — дождитесь окончания или остановите его.' }); return }
        // viewport исполняет сам Reader (ширина обёртки iframe) — страница не нужна.
        if (message.action.kind === 'viewport') {
          const width = Math.round(message.action.width)
          setViewport(width > 0 ? String(width) : '')
          reply({ kind: 'result', requestId: message.requestId, ok: true, result: { width: width > 0 ? width : 0 } })
          return
        }
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
        if (message.enabled) { setEditing(false); setCapturing(false) }
        setInspecting(message.enabled)
        frame.current?.contentWindow?.postMessage({ type: PREVIEW_INSPECTOR_COMMAND_TYPE, enabled: message.enabled }, sameOrigin)
        return
      }
      if (message.kind === 'recording-state') { setRecordingMode(message.enabled); return }
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
        scenarioRunner.current?.cancel('Reader отключён — запуск отменён.')
        scenarioRunner.current?.setReady(false)
        reply({ kind: 'disposed' })
        session.current = null
        pageReady.current = false; setLoadState('empty'); setLoadError(null)
        setDisposed(true)
      }
    }
    const receivePage = (data: unknown): void => {
      const message = data as { type?: unknown; requestId?: unknown; ok?: unknown; result?: unknown; error?: unknown; payload?: unknown; step?: unknown; enabled?: unknown; url?: unknown }
      if (message?.type === PREVIEW_PAGE_READY_TYPE) {
        loadGeneration.current++
        let next = typeof message.url === 'string' && message.url.length <= 4096 ? validUrl(message.url) : null
        if (next) {
          const reported = new URL(next)
          if (reported.origin === sameOrigin && reported.pathname === '/api/preview') {
            next = validUrl(reported.searchParams.get('url') ?? '')
            if (next && reported.hash) { const logical = new URL(next); logical.hash = reported.hash; next = logical.toString() }
          }
        }
        if (next && next !== currentUrl.current) {
          const previous = currentUrl.current
          currentUrl.current = next
          // Это подтверждённая навигация живого iframe: его src менять нельзя.
          setDraft(draft => draft === previous ? next : draft)
          // Обычная SPA-навигация выбирает сценарий новой страницы. Запись и
          // воспроизведение сохраняют исходный адрес многостраничного сценария.
          if (!modes.current.recording && !scenarioRunner.current?.isRunning()) {
            setScenarioUrl(next); setSteps(loadScenario(next)); setSecretValues({})
          }
        }
        scenarioRunner.current?.setReady(true)
        pageReady.current = true
        setLoadState('ready'); setLoadError(null)
        reply({ kind: 'page-status', status: 'ready', url: currentUrl.current })
        const state = modes.current
        for (const [type, enabled] of [[RECORD, state.recording], [PREVIEW_INSPECTOR_COMMAND_TYPE, state.inspecting], [EDIT, state.editing], [CAPTURE, state.capturing]] as const) {
          frame.current?.contentWindow?.postMessage({ type, enabled }, sameOrigin)
        }
        return
      }
      if (message?.type === PREVIEW_PAGE_LOADING_TYPE) { loadGeneration.current++; scenarioRunner.current?.setReady(false); pageReady.current = false; setLoadState('loading'); setLoadError(null); reply({ kind: 'page-status', status: 'loading', url: currentUrl.current }); return }
      if (message?.type === PREVIEW_ACTION_RESULT_TYPE && typeof message.requestId === 'string') {
        const diagnostic = diagnosticStarts.current.get(message.requestId)
        if (diagnostic) {
          diagnosticStarts.current.delete(message.requestId)
          const progress = { requestId: message.requestId, action: diagnostic.action, ok: message.ok === true, durationMs: Math.round(performance.now() - diagnostic.started) }
          setDiagnostics((current) => current ? [...current, progress] : current)
          reply({ kind: 'diagnostics-progress', ...progress })
        }
        // Локальные шаги сценария не имеют pending на стороне host — не отвечаем.
        if (message.requestId.startsWith('local-')) { scenarioRunner.current?.receive(message.requestId, { ok: message.ok === true, ...(typeof message.error === 'string' ? { error: message.error } : {}) }); return }
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
      if (message?.type === RECORD && modes.current.recording && !diagnosticsMode.current && !scenarioRunner.current?.isRunning()) {
        const step = normalizeWebRecorderStep(message.step)
        if (!step) return
        setSteps(old => appendWebRecorderStep(old, step))
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
    if (!scenarioUrl) return
    const key = scenarioKey(scenarioUrl)
    if (!key) return
    try {
      localStorage.setItem(key, JSON.stringify(steps.map(normalizeWebRecorderStep).filter(Boolean)))
    } catch { /* квота браузера — сценарий просто не сохранится */ }
  }, [steps, scenarioUrl])
  useEffect(() => { frame.current?.contentWindow?.postMessage({ type: EDIT, enabled: editing }, sameOrigin) }, [editing, url])
  useEffect(() => { frame.current?.contentWindow?.postMessage({ type: CAPTURE, enabled: capturing }, sameOrigin) }, [capturing, url])
  const closeTools = (): void => { if (toolsMenu.current) toolsMenu.current.open = false }
  const activateMode = (mode: 'inspect' | 'edit' | 'capture' | null): void => {
    setInspecting(mode === 'inspect'); setEditing(mode === 'edit'); setCapturing(mode === 'capture')
    closeTools()
  }
  useEffect(() => {
    const outside = (event: PointerEvent): void => { if (toolsMenu.current && !toolsMenu.current.contains(event.target as Node)) closeTools() }
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (toolsMenu.current?.open) { closeTools(); toolsMenu.current.querySelector('summary')?.focus() }
      setInspecting(false); setEditing(false); setCapturing(false)
    }
    window.addEventListener('pointerdown', outside); window.addEventListener('keydown', escape); window.addEventListener('blur', closeTools)
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape); window.removeEventListener('blur', closeTools) }
  }, [])
  useEffect(() => { frame.current?.contentWindow?.postMessage({ type: PREVIEW_INSPECTOR_COMMAND_TYPE, enabled: inspecting }, sameOrigin) }, [inspecting, url])
  const open = (): void => {
    const result = normalizeReaderAddress(draft, currentUrl.current)
    if (result.error) { setError(result.error); return }
    applyUrl(result.url)
    reply({ kind: 'save-url', url: result.url })
  }
  const reload = (): void => { if (currentUrl.current) applyUrl(currentUrl.current) }
  const failLoad = (message: string): void => {
    scenarioRunner.current?.cancel(message); scenarioRunner.current?.setReady(false)
    pageReady.current = false; setLoadState('error'); setLoadError(message)
    reply({ kind: 'page-status', status: 'error', url: currentUrl.current, error: message })
  }
  useEffect(() => {
    if (!url || loadState !== 'loading') return
    const timer = setTimeout(() => { if (!pageReady.current) failLoad('Страница не стала доступна за время ожидания. Попробуйте обновить её.') }, 12_000)
    loadTimers.current.add(timer)
    return () => { clearTimeout(timer); loadTimers.current.delete(timer) }
  }, [frameKey, url, loadState])
  useEffect(() => () => { for (const timer of loadTimers.current) clearTimeout(timer); loadTimers.current.clear() }, [])
  const loaded = (target: HTMLIFrameElement): void => {
    // Отложенный callback старого iframe не должен портить состояние нового open.
    const expected = currentUrl.current
    const generation = loadGeneration.current
    const timer = setTimeout(() => {
      loadTimers.current.delete(timer)
      if (generation !== loadGeneration.current || frame.current !== target || currentUrl.current !== expected || pageReady.current) return
      try { if (target.contentDocument?.URL === 'about:blank') return } catch { /* страница могла сменить origin */ }
      let message = 'Сайт недоступен или вернул страницу, которую Web Reader не может прочитать.'
      try {
        const body = target.contentDocument?.body?.textContent?.trim()
        if (body) { const parsed = JSON.parse(body) as { message?: unknown }; if (typeof parsed.message === 'string') message = parsed.message }
      } catch { /* не-JSON страница без клиентского моста */ }
      failLoad(message)
    }, 100)
    loadTimers.current.add(timer)
  }
  const run = (): void => {
    const runner = scenarioRunner.current
    if (!runner || runner.isRunning()) return
    setError(null)
    // Действия воспроизведения не записываются повторно в собственный сценарий.
    modes.current.recording = false
    setRecordingMode(false); setInspecting(false); setEditing(false); setCapturing(false)
    void runner.run(steps, secretValues).then(() => { if (scenarioRunner.current === runner) setSecretValues({}) })
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
  const editStepOrder = (index: number, direction: -1 | 1 | 0): void => {
    if (scenarioRunning) return
    setSecretValues({})
    setSteps(all => {
      if (direction === 0) return all.filter((_, i) => i !== index)
      const next = [...all], target = index + direction
      if (target < 0 || target >= next.length) return all
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }
  const exportPlaywright = (): void => {
    if (!scenarioUrl || !steps.length) return
    const blob = new Blob([scenarioToPlaywright(scenarioUrl, steps)], { type: 'text/typescript' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'web-reader-scenario.spec.ts'
    link.click()
    URL.revokeObjectURL(link.href)
  }
  if (disposed) return <section className="webpreview" aria-label="Web Reader"><div className="webpreview-empty" role="status">Панель Web Reader отключена host-приложением</div></section>
  return <section className="webpreview" aria-label="Web Reader">
    <form className="webpreview-bar" onSubmit={(event) => { event.preventDefault(); open() }}>
      <IconButton variant="secondary" type="button" disabled={!url} aria-label="Назад" title="Назад" onClick={() => historyGo(-1)}>‹</IconButton>
      <IconButton variant="secondary" type="button" disabled={!url} aria-label="Вперёд" title="Вперёд" onClick={() => historyGo(1)}>›</IconButton>
      <IconButton variant="secondary" aria-label="Обновить страницу" title="Обновить страницу" disabled={!url} onClick={reload}>↻</IconButton>
      <label className="webpreview-address"><span className="vc-sr-only">Адрес превью</span><input type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={PREVIEW_ACTION_LIMITS.url} value={draft} placeholder="https://example.com" onChange={(event) => setDraft(event.target.value)} /></label>
      <Button variant="secondary" type="submit">Открыть</Button>
      <label><span className="vc-sr-only">Ширина вьюпорта</span><select aria-label="Ширина вьюпорта" value={viewport} onChange={(event) => setViewport(event.target.value)}>{VIEWPORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}{viewport && !VIEWPORTS.some(([value]) => value === viewport) ? <option value={viewport}>{viewport} px</option> : null}</select></label>
      {/* Инструменты страницы собраны в свёрнутое меню, чтобы тулбар не переполнял
          узкую панель превью. Активные режимы подсвечивают саму сводку меню. */}
      <details ref={toolsMenu} className="webpreview-tools">
        <summary className="vc-btn vc-btn--secondary" aria-label="Инструменты страницы" data-active={(inspecting || editing || capturing || recording) || undefined}>Инструменты ▾</summary>
        <div className="webpreview-tools__menu" role="group" aria-label="Инструменты страницы">
          <Button variant="secondary" type="button" onClick={() => { applyUrl(READER_PROJECT_ORIGIN + '/'); toolsMenu.current?.removeAttribute('open') }}>Текущий проект</Button>
          <Button variant="secondary" type="button" disabled={!url} title="Сбросить cookie-сессии окружений (перелогиниться)" onClick={resetSession}>⟲ Сессия</Button>
          <Button variant="secondary" type="button" disabled={!url} aria-pressed={inspecting} onClick={() => activateMode(inspecting ? null : 'inspect')}>⌖ Выбор элемента</Button>
          <Button variant="secondary" type="button" disabled={!url} aria-pressed={editing} onClick={() => activateMode(editing ? null : 'edit')}>✎ Редактировать</Button>
          <Button variant="secondary" type="button" disabled={!url} aria-pressed={capturing} onClick={() => activateMode(capturing ? null : 'capture')}>📸 Область</Button>
          <Button variant="secondary" type="button" disabled={!url} aria-pressed={recording} onClick={() => { setRecordingMode(!modes.current.recording); closeTools() }}>{recording ? 'Остановить запись' : 'Записать сценарий'}</Button>
        </div>
      </details>
    </form>
    {loadState === 'loading' && <div className="webpreview-load-status" role="status" aria-live="polite">Загружаем страницу…</div>}
    {loadError && <div className="webpreview-error webpreview-load-error" role="alert"><span>{loadError}</span><Button size="sm" onClick={reload}>Повторить загрузку</Button></div>}
    {error && <p className="webpreview-error" role="alert">{error}</p>}
    {diagnostics && <section className="webpreview-scenario" aria-label="Диагностика Web Reader">
      <strong>Диагностика: {diagnostics.length} шаг.</strong>
      <ol>{diagnostics.map((step) => <li key={step.requestId} data-status={step.ok ? 'passed' : 'failed'}>{step.ok ? '✓' : '✕'} <code>{step.action}</code> — {step.durationMs} мс</li>)}</ol>
    </section>}
    {scenarioProgress && <div className="webpreview-run-status" role="status" aria-live="polite" data-status={scenarioProgress.status}>
      {scenarioProgress.status === 'running' ? 'Выполняется сценарий' : scenarioProgress.status === 'passed' ? 'Сценарий выполнен' : scenarioProgress.status === 'cancelled' ? 'Сценарий остановлен' : 'Ошибка сценария'}: {scenarioProgress.completed} из {scenarioProgress.total}
      {scenarioProgress.error && <span> — {scenarioProgress.error}</span>}
    </div>}
    {steps.length > 0 && <section className="webpreview-scenario" aria-label="Сценарий автотеста">
      <Button variant="secondary" disabled={scenarioRunning || loadState !== 'ready'} onClick={run}>Запустить</Button>
      {scenarioRunning && <Button variant="secondary" onClick={() => scenarioRunner.current?.cancel()}>Остановить сценарий</Button>}
      <Button variant="secondary" type="button" onClick={exportPlaywright}>Экспорт в Playwright</Button>
      <Button variant="secondary" type="button" disabled={scenarioRunning} onClick={() => { setSteps([]); setSecretValues({}); setScenarioProgress(null) }}>Очистить</Button>
      <ol>
      {steps.map((step, index) => <li key={index}><code>{step.kind}</code><input maxLength={PREVIEW_ACTION_LIMITS.selector} disabled={scenarioRunning} aria-label={'Селектор шага ' + (index + 1)} value={step.selector} onChange={(event) => setSteps((all) => all.map((item, i) => i === index ? { ...item, selector: event.target.value } : item))} />
        {step.kind === 'type' && !step.sensitive && <input maxLength={PREVIEW_ACTION_LIMITS.text} disabled={scenarioRunning} aria-label={'Значение шага ' + (index + 1)} value={step.text} onChange={(event) => setSteps((all) => all.map((item, i) => i === index ? { ...item, text: event.target.value } : item))} />}
        {step.kind === 'type' && step.sensitive && <input maxLength={PREVIEW_ACTION_LIMITS.text} disabled={scenarioRunning} aria-label={'Секретное значение шага ' + (index + 1)} type="password" value={secretValues[index] ?? ''} placeholder="введите для запуска" onChange={(event) => setSecretValues((all) => ({ ...all, [index]: event.target.value }))} />}
        {step.kind === 'type' && <label><input type="checkbox" disabled={scenarioRunning} aria-label={'Секрет шага ' + (index + 1)} checked={step.sensitive} onChange={event => {
          const sensitive = event.target.checked
          setSecretValues({})
          setSteps(all => all.map((item, i) => i === index ? { ...item, sensitive, text: '' } : item))
        }} />Секрет</label>}
        <IconButton size="sm" disabled={scenarioRunning || index === 0} title="Поднять шаг" aria-label={'Поднять шаг ' + (index + 1)} onClick={() => editStepOrder(index, -1)}>↑</IconButton>
        <IconButton size="sm" disabled={scenarioRunning || index === steps.length - 1} title="Опустить шаг" aria-label={'Опустить шаг ' + (index + 1)} onClick={() => editStepOrder(index, 1)}>↓</IconButton>
        <IconButton size="sm" disabled={scenarioRunning} title="Удалить шаг" aria-label={'Удалить шаг ' + (index + 1)} onClick={() => editStepOrder(index, 0)}>×</IconButton>
        {step.submit === true && <em>⏎ submit</em>}
        {step.sensitive && <em>секрет не сохраняется</em>}</li>)}
    </ol></section>}
    {url ? <div className="webpreview-viewport"><iframe key={frameKey} ref={frame} className="webpreview-frame" style={viewport ? { width: viewport + 'px', minWidth: viewport + 'px', flex: 'none' } : undefined} src={'/api/preview?url=' + encodeURIComponent(url)} title="Предпросмотр сайта" onLoad={event => loaded(event.currentTarget)} onError={() => failLoad('Не удалось загрузить сайт: сетевая ошибка.')} /></div> : <div className="webpreview-empty">Укажите адрес сайта или проекта</div>}

  </section>
}
