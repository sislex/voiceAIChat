import { READER_PROJECT_ORIGIN, readerProjectUrl } from '@shared/previewProject'
import { Button, IconButton } from '@voicechat/ui-kit'
import { appendWebRecorderStep, normalizeWebRecorderStep } from '@shared/webRecorderScenario'
import { DiagnosticHistory, type DiagnosticsStep } from './DiagnosticHistory'
import { ScenarioTransfer } from './ScenarioTransfer'
import { useScenarioEditor } from './scenarioEditor'
import { loadScenario, scenarioKey } from './scenarioStorage'
import { createScenarioRunner, type ScenarioProgress } from './scenarioRunner'
import { normalizeReaderAddress } from './readerAddress'
import { loadRecentAddresses, recentAddressLabel, rememberRecentAddress, saveRecentAddresses } from './recentAddresses'
import { useEffect, useId, useRef, useState } from 'react'
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
const RECORD = 'voicechat.preview.record.v1'
// Режим правок страницы: канал Reader ↔ инъецированный скрипт previewProxy.
const EDIT = 'voicechat.preview.edit.v1'
// Режим скриншота области: тот же канал Reader ↔ инъецированный скрипт.
const CAPTURE = 'voicechat.preview.capture.v1'
const sameOrigin = window.location.origin
/** Same document when only the fragment differs and a fragment is present. */
const sameDocument = (current: string, next: string): boolean => {
  try {
    const a = new URL(current), b = new URL(next)
    return Boolean(b.hash) && a.origin === b.origin && a.pathname === b.pathname && a.search === b.search && a.hash !== b.hash
  } catch { return false }
}
const validUrl = (value: string): string | null => { try { const url = new URL(value.trim()); return /^https?:$/.test(url.protocol) ? url.toString() : null } catch { return null } }
/** Пресеты адаптива: ширина iframe для проверки мобильной/планшетной вёрстки. */
const VIEWPORTS = [['', 'Адаптив'], ['360', 'Телефон 360'], ['375', 'iPhone 375'], ['768', 'Планшет 768'], ['1024', 'Ноутбук 1024'], ['1280', 'Десктоп 1280']] as const

export function Recorder(): JSX.Element {
  const [url, setUrl] = useState<string | null>(null); const [draft, setDraft] = useState(''); const [recording, setRecording] = useState(false)
  const [inspecting, setInspecting] = useState(false); const [editing, setEditing] = useState(false); const [capturing, setCapturing] = useState(false); const [disposed, setDisposed] = useState(false)
  const addressRef = useRef<HTMLInputElement>(null)
  const addressErrorId = useId()
  const [addressError, setAddressError] = useState<string | null>(null)
  const { steps, setSteps, editSteps, past, future, undo, redo } = useScenarioEditor(); const [error, setError] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<DiagnosticsStep[] | null>(null)
  const [scenarioUrl, setScenarioUrl] = useState<string | null>(null)
  const [scenarioCollapsed, setScenarioCollapsed] = useState(false)
  const [storageError, setStorageError] = useState<string | null>(null)
  const sessionReset = useRef<AbortController | null>(null)
  const sessionResetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [resettingSession, setResettingSession] = useState(false)
  const [scenarioProgress, setScenarioProgress] = useState<ScenarioProgress | null>(null)
  const scenarioRunner = useRef<ReturnType<typeof createScenarioRunner> | null>(null)
  const scenarioRunning = scenarioProgress?.status === 'running'
  const [viewport, setViewport] = useState('')
  const [loadState, setLoadState] = useState<'empty' | 'loading' | 'ready' | 'error'>('empty')
  const [loadError, setLoadError] = useState<string | null>(null)
  // Page title from the injected bridge: the person sees where they are without reading the URL.
  const [pageTitle, setPageTitle] = useState('')
  const [recent, setRecent] = useState<string[]>(() => loadRecentAddresses())
  // Link to the chat host: without it the assistant cannot drive this panel, and the person should know why.
  const [linked, setLinked] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  // The person can take the page over: model commands are refused with a clear reason until released.
  const [manual, setManual] = useState(false)
  // Text the person selected on the page: one tap turns it into a question for the assistant.
  const [selection, setSelection] = useState('')
  // Site icon and a redirect notice: the small cues a browser tab gives about where you landed.
  const [pageIcon, setPageIcon] = useState<string | null>(null)
  const [pageLang, setPageLang] = useState('')
  // Address suggestions from recent visits while typing: our own listbox keeps the input a plain textbox for ARIA.
  const [addressFocused, setAddressFocused] = useState(false)
  const [longLoad, setLongLoad] = useState(false)
  const suggestionsId = useId()
  // Rough history depth of this page session: «Назад» is disabled until there is somewhere to go.
  const [historyDepth, setHistoryDepth] = useState(0)
  const historyGrew = useRef(false)
  const [redirectedFrom, setRedirectedFrom] = useState<string | null>(null)
  const requestedUrl = useRef<string | null>(null)
  const manualRef = useRef(false)
  manualRef.current = manual
  const setManualMode = (next: boolean): void => { setManual(next); reply({ kind: 'control', manual: next }) }
  // Actions that may start a navigation keep their result briefly: if the page begins
  // loading, the model learns `navigated: true` and the new page instead of a stale DOM.
  const commandKinds = useRef(new Map<string, string>())
  const navigationWatch = useRef<{ requestId: string; result: Record<string, unknown>; timer: ReturnType<typeof setTimeout> | null; navigating: boolean } | null>(null)
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
  const settleNavigationWatch = (navigated: boolean, page?: { url: string | null; title: string }): void => {
    const watch = navigationWatch.current
    if (!watch) return
    navigationWatch.current = null
    if (watch.timer) clearTimeout(watch.timer)
    reply({ kind: 'result', requestId: watch.requestId, ok: true, result: { ...watch.result, navigated, ...(navigated && page?.url ? { page: { url: page.url, title: page.title } } : {}) } as never })
  }
  const setRecordingMode = (enabled: boolean): void => {
    // Режим доходит до страницы в обработчике кнопки: passive effect мог
    // отложиться до следующего paint и потерять первый быстрый ввод.
    modes.current.recording = enabled
    frame.current?.contentWindow?.postMessage({ type: RECORD, enabled }, sameOrigin)
    setRecording(enabled)
  }
  const cancelSessionReset = (): void => { sessionReset.current?.abort(); sessionReset.current = null; if (sessionResetTimeout.current) clearTimeout(sessionResetTimeout.current); sessionResetTimeout.current = null; setResettingSession(false) }
  const applyUrl = (next: string | null): void => {
    if (next) next = readerProjectUrl(next, sameOrigin)
    // Same document, different hash: a hash router handles it live — reloading would lose the page state.
    const current = currentUrl.current
    if (next && current && pageReady.current && frame.current?.contentWindow && sameDocument(current, next)) {
      try {
        currentUrl.current = next
        frame.current.contentWindow.location.hash = new URL(next).hash
        setUrl(next); setDraft(next); setAddressError(null)
        return
      } catch { /* cross-document after a redirect: fall through to a full load */ }
    }
    loadGeneration.current++
    cancelSessionReset()
    setScenarioCollapsed(false); setStorageError(null)
    diagnosticStarts.current.clear()
    scenarioRunner.current?.cancel('Открывается другая страница — запуск отменён.')
    scenarioRunner.current?.setReady(false)
    pageReady.current = false
    settleNavigationWatch(false)
    setPageTitle('')
    setSelection(''); setPageIcon(null); setRedirectedFrom(null); setPageLang('')
    requestedUrl.current = next
    setHistoryDepth(0); historyGrew.current = false
    setLoadState(next ? 'loading' : 'empty'); setLoadError(null)
    currentUrl.current = next
    if (next) setFrameKey((value) => value + 1)
    setUrl(next); setDraft(next ?? ''); setError(null); setAddressError(null)
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
        if (!same) { diagnosticStarts.current.clear(); diagnosticsMode.current = false; setDiagnostics(null) }
        session.current = { conversationId: message.conversationId, registrationId: message.registrationId }
        setDisposed(false); setLinked(true)
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
        if (manualRef.current && message.action.kind !== 'status') { reply({ kind: 'result', requestId: message.requestId, ok: false, error: 'Пользователь взял управление страницей на себя (режим «Только я управляю»). Не повторяй действие сам — спроси, когда можно продолжить.' }); return }
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
          if (diagnosticStarts.current.size >= 64) diagnosticStarts.current.delete(diagnosticStarts.current.keys().next().value!)
          diagnosticStarts.current.set(message.requestId, { action: message.action.kind, started: performance.now() })
        }
        if (commandKinds.current.size >= 128) commandKinds.current.delete(commandKinds.current.keys().next().value!)
        commandKinds.current.set(message.requestId, message.action.kind)
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
        if (message.active) { diagnosticStarts.current.clear(); diagnosticsMode.current = true; setDiagnostics([]) }
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
        cancelSessionReset()
        settleNavigationWatch(false)
        scenarioRunner.current?.cancel('Reader отключён — запуск отменён.')
        scenarioRunner.current?.setReady(false)
        reply({ kind: 'disposed' })
        session.current = null
        setLinked(false)
        pageReady.current = false; setLoadState('empty'); setLoadError(null)
        setDisposed(true)
      }
    }
    const receivePage = (data: unknown): void => {
      const message = data as { type?: unknown; requestId?: unknown; ok?: unknown; result?: unknown; error?: unknown; payload?: unknown; step?: unknown; enabled?: unknown; url?: unknown; title?: unknown; outline?: unknown }
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
          cancelSessionReset()
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
        const title = typeof message.title === 'string' ? message.title.slice(0, 500) : ''
        const iconUrl = typeof (message as { icon?: unknown }).icon === 'string' ? validUrl((message as { icon: string }).icon) : null
        setPageIcon(iconUrl)
        setPageLang(typeof (message as { lang?: unknown }).lang === 'string' ? String((message as { lang: string }).lang).slice(0, 8) : '')
        // Landed somewhere else than asked: tell the person, like a browser does with a redirect.
        if (requestedUrl.current && currentUrl.current && requestedUrl.current !== currentUrl.current && !sameDocument(requestedUrl.current, currentUrl.current)) setRedirectedFrom(requestedUrl.current)
        requestedUrl.current = null
        const outline = message.outline && typeof message.outline === 'object' ? message.outline as { headings?: unknown; links?: unknown; buttons?: unknown; inputs?: unknown } : null
        const summary = outline && Array.isArray(outline.headings) && [outline.links, outline.buttons, outline.inputs].every(value => typeof value === 'number')
          ? { headings: (outline.headings as unknown[]).filter((item): item is string => typeof item === 'string').slice(0, 8).map(item => item.slice(0, 200)), links: outline.links as number, buttons: outline.buttons as number, inputs: outline.inputs as number }
          : null
        setPageTitle(title)
        if (currentUrl.current) setRecent(list => { const updated = rememberRecentAddress(list, currentUrl.current!); saveRecentAddresses(updated); return updated })
        setLoadState('ready'); setLoadError(null)
        const vp = (message as { viewport?: unknown }).viewport as { width?: unknown; height?: unknown } | undefined
        const viewportInfo = vp && typeof vp.width === 'number' && typeof vp.height === 'number' ? { width: vp.width, height: vp.height } : null
        // Read the refs now: a state updater runs later, when the flag below is already flipped.
        const grewInPage = requestedUrl.current === null && historyGrew.current
        if (grewInPage) setHistoryDepth(depth => depth + 1)
        historyGrew.current = true
        reply({ kind: 'page-status', status: 'ready', url: currentUrl.current, ...(title ? { title } : {}), ...(summary ? { outline: summary } : {}), ...(viewportInfo ? { viewport: viewportInfo } : {}) })
        settleNavigationWatch(true, { url: currentUrl.current, title })
        const state = modes.current
        for (const [type, enabled] of [[RECORD, state.recording], [PREVIEW_INSPECTOR_COMMAND_TYPE, state.inspecting], [EDIT, state.editing], [CAPTURE, state.capturing]] as const) {
          frame.current?.contentWindow?.postMessage({ type, enabled }, sameOrigin)
        }
        return
      }
      if (message?.type === PREVIEW_PAGE_LOADING_TYPE) {
        cancelSessionReset(); loadGeneration.current++; scenarioRunner.current?.setReady(false); pageReady.current = false; setLoadState('loading'); setLoadError(null)
        const watch = navigationWatch.current
        if (watch && !watch.navigating) {
          // The click did start a navigation: hold the answer until the new page reports ready.
          if (watch.timer) clearTimeout(watch.timer)
          watch.navigating = true
          watch.timer = setTimeout(() => settleNavigationWatch(true, { url: currentUrl.current, title: '' }), 6_000)
        }
        reply({ kind: 'page-status', status: 'loading', url: currentUrl.current }); return
      }
      if (message?.type === PREVIEW_ACTION_RESULT_TYPE && typeof message.requestId === 'string') {
        const diagnostic = diagnosticStarts.current.get(message.requestId)
        if (diagnostic) {
          diagnosticStarts.current.delete(message.requestId)
          const progress = { requestId: message.requestId, action: diagnostic.action, ok: message.ok === true, durationMs: Math.round(performance.now() - diagnostic.started) }
          setDiagnostics((current) => [...(current ?? []), progress])
          reply({ kind: 'diagnostics-progress', ...progress })
        }
        if (message.requestId.startsWith('snap-')) {
          const shot = message.result as { dataUrl?: unknown; rect?: unknown; page?: { url?: unknown } } | undefined
          if (message.ok === true && shot && typeof shot.dataUrl === 'string' && shot.rect && typeof shot.page?.url === 'string') reply({ kind: 'area-screenshot', shot: { dataUrl: shot.dataUrl, rect: shot.rect as { x: number; y: number; width: number; height: number }, pageUrl: shot.page.url } })
          else setError('Снимок страницы не получился' + (typeof message.error === 'string' ? ': ' + message.error : '.'))
          return
        }
        // Локальные шаги сценария не имеют pending на стороне host — не отвечаем.
        if (message.requestId.startsWith('local-')) { scenarioRunner.current?.receive(message.requestId, { ok: message.ok === true, ...(typeof message.error === 'string' ? { error: message.error } : {}) }); return }
        const kind = commandKinds.current.get(message.requestId)
        commandKinds.current.delete(message.requestId)
        const result = message.result as Record<string, unknown> | undefined
        // back/forward always navigate: their answer waits for the new page like a navigating click.
        const mayNavigate = message.ok === true && result && (kind === 'click' || kind === 'press' || kind === 'back' || kind === 'forward' || kind === 'choose' || (kind === 'type' || kind === 'fill') && result.submitted === true)
        if (mayNavigate && !navigationWatch.current) {
          const watch = { requestId: message.requestId, result, timer: null as ReturnType<typeof setTimeout> | null, navigating: false }
          navigationWatch.current = watch
          watch.timer = setTimeout(() => { if (navigationWatch.current === watch) settleNavigationWatch(false) }, 350)
          return
        }
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
      if (message?.type === 'voicechat.preview.selection.v1') { const text = typeof (message as { text?: unknown }).text === 'string' ? String((message as { text: string }).text).slice(0, 2000) : ''; setSelection(text); return }
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

  const saveScenario = (): void => {
    const key = scenarioUrl ? scenarioKey(scenarioUrl) : null
    if (!key) { setStorageError(null); return }
    try {
      localStorage.setItem(key, JSON.stringify(steps.map(normalizeWebRecorderStep).filter(Boolean)))
      setStorageError(null)
    } catch { setStorageError('Сценарий не сохранён в браузере. Освободите место или разрешите хранилище и повторите сохранение.') }
  }
  useEffect(() => { saveScenario() }, [steps, scenarioUrl])
  useEffect(() => () => { sessionReset.current?.abort(); sessionReset.current = null; if (sessionResetTimeout.current) clearTimeout(sessionResetTimeout.current); sessionResetTimeout.current = null }, [])
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
    if (result.error) { setAddressError(result.error); addressRef.current?.focus(); return }
    applyUrl(result.url)
    reply({ kind: 'save-url', url: result.url })
  }
  const reload = (): void => { if (currentUrl.current) applyUrl(currentUrl.current) }
  const failLoad = (message: string): void => {
    settleNavigationWatch(navigationWatch.current?.navigating === true, { url: currentUrl.current, title: '' })
    scenarioRunner.current?.cancel(message); scenarioRunner.current?.setReady(false)
    pageReady.current = false; setLoadState('error'); setLoadError(message)
    reply({ kind: 'page-status', status: 'error', url: currentUrl.current, error: message })
  }
  useEffect(() => {
    if (!url || loadState !== 'loading') { setLongLoad(false); return }
    // After eight seconds a slow site deserves a way out, before the twelve-second failure.
    const slow = setTimeout(() => setLongLoad(true), 8_000)
    loadTimers.current.add(slow)
    const timer = setTimeout(() => { if (!pageReady.current) failLoad('Страница не стала доступна за время ожидания. Попробуйте обновить её.') }, 12_000)
    loadTimers.current.add(timer)
    return () => { clearTimeout(timer); loadTimers.current.delete(timer) }
  }, [frameKey, url, loadState])
  useEffect(() => () => { for (const timer of loadTimers.current) clearTimeout(timer); loadTimers.current.clear(); if (navigationWatch.current?.timer) clearTimeout(navigationWatch.current.timer); navigationWatch.current = null }, [])
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
    if (sessionReset.current) return
    const controller = new AbortController()
    sessionReset.current = controller; setResettingSession(true); setError(null)
    const target = currentUrl.current
    const generation = loadGeneration.current
    const timeout = sessionResetTimeout.current = setTimeout(() => {
      if (sessionReset.current === controller) { setError('Сброс сессии занял слишком много времени. Повторите попытку.'); controller.abort() }
    }, 15_000)
    void fetch('/api/preview/reset-cookies', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status)
        if (sessionReset.current === controller && !controller.signal.aborted && target && currentUrl.current === target && generation === loadGeneration.current) applyUrl(target)
      })
      .catch(() => { if (sessionReset.current === controller && !controller.signal.aborted) setError('Не удалось сбросить сессии превью.') })
      .finally(() => {
        clearTimeout(timeout)
        if (sessionResetTimeout.current === timeout) sessionResetTimeout.current = null
        if (sessionReset.current === controller) { sessionReset.current = null; setResettingSession(false) }
      })
  }
  const editStepOrder = (index: number, direction: -1 | 1 | 0): void => {
    if (scenarioRunning) return
    setSecretValues({})
    editSteps(all => {
      if (direction === 0) return all.filter((_, i) => i !== index)
      const next = [...all], target = index + direction
      if (target < 0 || target >= next.length) return all
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }
  const addStep = (kind: Step['kind']): void => {
    if (scenarioRunning || steps.length >= 200) return
    setSecretValues({}); editSteps(all => [...all, { kind, selector: '', text: '', sensitive: false }]); closeTools()
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
  const openAddress = (next: string): void => { applyUrl(next); reply({ kind: 'save-url', url: next }) }
  const needle = draft.trim().toLowerCase()
  const suggestions = needle && needle !== (url ?? '').toLowerCase() ? recent.filter(item => item !== url && item.toLowerCase().includes(needle)).slice(0, 5) : []
  const selectionLooksLikeUrl = /^https?:\/\/\S+$/.test(selection) || (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(selection) && !/\s/.test(selection))
  const copyAddress = (): void => {
    const target = currentUrl.current
    if (!target) return
    void navigator.clipboard?.writeText(target).catch(() => setError('Не удалось скопировать адрес.'))
    closeTools()
  }
  const copyLink = (): void => {
    const target = currentUrl.current
    if (!target) return
    // Markdown link with the page title: pasteable into the chat, a task or a note.
    void navigator.clipboard?.writeText(pageTitle ? `[${pageTitle}](${target})` : target).catch(() => setError('Не удалось скопировать ссылку.'))
    closeTools()
  }
  // Visible area as a picture for the chat: the same capture the model gets, attached by the person.
  const snapshotToChat = (): void => {
    const target = frame.current?.contentWindow
    if (!target || !pageReady.current) return
    target.postMessage({ type: PREVIEW_ACTION_COMMAND_TYPE, requestId: 'snap-' + browserId(), action: { kind: 'screenshot' } }, sameOrigin)
    closeTools()
  }
  const openExternal = (): void => {
    if (currentUrl.current) window.open(currentUrl.current, '_blank', 'noopener,noreferrer')
    closeTools()
  }
  return <section className="webpreview" aria-label="Web Reader" onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
      event.preventDefault(); addressRef.current?.focus(); addressRef.current?.select()
    }
    if (event.key === 'Escape' && selection) setSelection('')
    // Browser-like history keys work anywhere in the panel, not only over the page.
    if (event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && url) {
      event.preventDefault(); historyGo(event.key === 'ArrowLeft' ? -1 : 1)
    }
    if (event.altKey && event.key === 'Home' && url) { event.preventDefault(); try { frame.current?.contentWindow?.scrollTo({ top: 0, behavior: 'smooth' }) } catch { /* cross-document */ } }
  }}>
    <form className="webpreview-bar" onSubmit={(event) => { event.preventDefault(); open() }}>
      <IconButton variant="secondary" type="button" disabled={!url || historyDepth === 0} aria-label="Назад" aria-keyshortcuts="Alt+ArrowLeft" title="Назад (Alt+←)" onClick={() => historyGo(-1)}>‹</IconButton>
      <IconButton variant="secondary" type="button" disabled={!url} aria-label="Вперёд" aria-keyshortcuts="Alt+ArrowRight" title="Вперёд (Alt+→)" onClick={() => historyGo(1)}>›</IconButton>
      <IconButton variant="secondary" aria-label="Обновить страницу" title={loadState === 'loading' ? 'Страница загружается…' : 'Обновить страницу'} disabled={!url || loadState === 'loading'} aria-busy={loadState === 'loading' || undefined} className={loadState === 'loading' ? 'webpreview-reload--busy' : undefined} onClick={reload}>↻</IconButton>
      <span className="webpreview-link" role="img" title={linked ? 'Панель связана с чатом: ассистент может управлять страницей' : 'Панель не связана с чатом: ассистент не видит эту страницу'} aria-label={linked ? 'Связь с чатом есть' : 'Связи с чатом нет'} data-linked={linked || undefined} data-manual={manual || undefined}>{linked ? '●' : '○'}</span>
      <label className="webpreview-address">{url && <span className="webpreview-scheme" aria-hidden="true" title={url.startsWith('https:') ? 'Защищённое соединение' : 'Незащищённое соединение'}>{url.startsWith('https:') ? '🔒' : '⚠'}</span>}<span className="vc-sr-only">Адрес превью</span><input ref={addressRef} aria-invalid={Boolean(addressError)} aria-describedby={addressError ? addressErrorId : undefined} type="text" inputMode="url" enterKeyHint="go" autoComplete="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={PREVIEW_ACTION_LIMITS.url} aria-keyshortcuts="Control+L Meta+L" value={draft} placeholder="https://example.com" onFocus={event => { event.currentTarget.select(); setAddressFocused(true) }} onBlur={() => setTimeout(() => setAddressFocused(false), 120)} aria-autocomplete="list" aria-controls={suggestionsId} aria-expanded={addressFocused && suggestions.length > 0} onPaste={event => {
        // Paste-and-go: a pasted full address opens at once, like mobile browsers do.
        const pasted = event.clipboardData.getData('text').trim()
        if (!draft.trim() && /^https?:\/\/\S+$/.test(pasted)) { event.preventDefault(); openAddress(pasted) }
      }} onChange={(event) => { setDraft(event.target.value); setAddressError(null) }} onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); setDraft(currentUrl.current ?? ''); setAddressError(null) }
        // Cmd/Ctrl+Enter opens the typed address in a real browser tab, like the address bar of a browser.
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); const result = normalizeReaderAddress(draft, currentUrl.current); if (result.url) window.open(result.url, '_blank', 'noopener,noreferrer'); else setAddressError(result.error ?? null) }
      }} />
      {addressFocused && suggestions.length > 0 && <ul id={suggestionsId} className="webpreview-suggestions" role="listbox" aria-label="Недавние адреса, похожие на ввод">{suggestions.map(item => <li key={item} role="option" aria-selected={false}><button type="button" onMouseDown={event => event.preventDefault()} onClick={() => { openAddress(item); setAddressFocused(false) }}>{recentAddressLabel(item)}</button></li>)}</ul>}</label>
      <Button variant="secondary" type="submit" disabled={!draft.trim()}>Открыть</Button>
      <IconButton variant="secondary" type="button" aria-label="Очистить страницу" title="Очистить страницу" disabled={!url && !draft} onClick={() => { applyUrl(null); reply({ kind: 'save-url', url: null }); addressRef.current?.focus() }}>×</IconButton>
      <label><span className="vc-sr-only">Ширина вьюпорта</span><select aria-label="Ширина вьюпорта" value={viewport} onChange={(event) => setViewport(event.target.value)}>{VIEWPORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}{viewport && !VIEWPORTS.some(([value]) => value === viewport) ? <option value={viewport}>{viewport} px</option> : null}</select></label>
      {viewport && <Button variant="secondary" size="sm" type="button" className="webpreview-viewport-chip" aria-label={`Сбросить ширину ${viewport} px`} title="Вернуть адаптивную ширину" onClick={() => setViewport('')}>{viewport} px ×</Button>}
      {/* Инструменты страницы собраны в свёрнутое меню, чтобы тулбар не переполнял
          узкую панель превью. Активные режимы подсвечивают саму сводку меню. */}
      <details ref={toolsMenu} className="webpreview-tools">
        <summary className="vc-btn vc-btn--secondary" aria-label="Инструменты страницы" data-active={(inspecting || editing || capturing || recording) || undefined}>{(inspecting || editing || capturing || recording) && <span className="webpreview-tools__badge" aria-hidden="true">●</span>}Инструменты ▾</summary>
        <div className="webpreview-tools__menu" role="group" aria-label="Инструменты страницы" onKeyDown={event => {
          // Arrow keys walk the menu like a native menu; Home/End jump to the ends.
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
          const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
          if (!items.length) return
          const index = items.indexOf(document.activeElement as HTMLButtonElement)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
          event.preventDefault(); items[next]?.focus()
        }}>
          <div className="webpreview-tools__group" role="group" aria-label="Страница">
          <Button variant="secondary" type="button" onClick={() => { applyUrl(READER_PROJECT_ORIGIN + '/'); toolsMenu.current?.removeAttribute('open') }}>Текущий проект</Button>
          <Button variant="secondary" type="button" disabled={!url} onClick={copyAddress}>Копировать адрес</Button>
          <Button variant="secondary" type="button" disabled={!url} onClick={copyLink}>Копировать ссылку с названием</Button>
          <Button variant="secondary" type="button" disabled={!url || loadState !== 'ready'} onClick={snapshotToChat}>Снимок страницы в чат</Button>
          {typeof navigator.share === 'function' && <Button variant="secondary" type="button" disabled={!url} onClick={() => { const target = currentUrl.current; if (target) void navigator.share({ url: target, ...(pageTitle ? { title: pageTitle } : {}) }).catch(() => {}); closeTools() }}>Поделиться…</Button>}
          <Button variant="secondary" type="button" disabled={!url} onClick={openExternal}>Открыть в новой вкладке</Button>
          <Button variant="secondary" type="button" aria-pressed={manual} onClick={() => { setManualMode(!manualRef.current); closeTools() }}>{manual ? 'Вернуть управление ассистенту' : 'Только я управляю'}</Button>
          </div>
          <div className="webpreview-tools__group" role="group" aria-label="Сценарий">
          <Button variant="secondary" type="button" aria-pressed={transferOpen} onClick={() => { setTransferOpen(value => !value); closeTools() }}>Файл сценария (JSON)</Button>
          <Button variant="secondary" type="button" disabled={!url || scenarioRunning || steps.length >= 200} onClick={() => addStep('click')}>Добавить клик</Button>
          <Button variant="secondary" type="button" disabled={!url || scenarioRunning || steps.length >= 200} onClick={() => addStep('type')}>Добавить ввод</Button>
          <Button variant="secondary" type="button" disabled={!url || resettingSession} title="Сбросить cookie-сессии окружений (перелогиниться)" onClick={resetSession}>{resettingSession ? 'Сбрасываем сессию…' : '⟲ Сессия'}</Button>
          <Button variant="secondary" type="button" disabled={!url} aria-pressed={inspecting} onClick={() => activateMode(inspecting ? null : 'inspect')}>⌖ Выбор элемента</Button>
          <Button variant="secondary" type="button" disabled={!url} aria-pressed={editing} onClick={() => activateMode(editing ? null : 'edit')}>✎ Редактировать</Button>
          <Button variant="secondary" type="button" disabled={!url} aria-pressed={capturing} onClick={() => activateMode(capturing ? null : 'capture')}>📸 Область</Button>
          <Button variant="secondary" type="button" disabled={!url} aria-pressed={recording} onClick={() => { setRecordingMode(!modes.current.recording); closeTools() }}>{recording ? 'Остановить запись' : 'Записать сценарий'}</Button>
          </div>
          {recent.length > 0 && <div className="webpreview-tools__group" role="group" aria-label="Недавние">
          {recent.filter(item => item !== url).slice(0, 3).map(item => <Button key={item} variant="secondary" type="button" title={item} onClick={() => { openAddress(item); closeTools() }}>↩ {recentAddressLabel(item)}</Button>)}
          <Button variant="secondary" type="button" onClick={() => { setRecent([]); saveRecentAddresses([]); closeTools() }}>Очистить недавние</Button>
          </div>}
        </div>
      </details>
    </form>
    {loadState === 'loading' && <div className="webpreview-progress" aria-hidden="true" />}
    {pageTitle && loadState === 'ready' && <button type="button" className="webpreview-title" title="Скопировать ссылку с названием" aria-label={`Скопировать ссылку: ${pageTitle}`} onClick={copyLink}>{pageIcon && <img className="webpreview-title__icon" src={'/api/preview?url=' + encodeURIComponent(pageIcon)} alt="" onError={() => setPageIcon(null)} />}<span>{pageTitle}</span>{pageLang && <small className="webpreview-title__lang" title={`Язык страницы: ${pageLang}`}>{pageLang}</small>}</button>}
    {redirectedFrom && loadState === 'ready' && <div className="webpreview-load-status" role="status">Перенаправлено с {(() => { try { return new URL(redirectedFrom).host } catch { return redirectedFrom } })()}</div>}
    {selection && loadState === 'ready' && <div className="webpreview-selection" role="status"><span className="webpreview-selection__text" title={selection}>«{selection.length > 80 ? selection.slice(0, 79) + '…' : selection}»</span><Button size="sm" onClick={() => { reply({ kind: 'ask', text: selection }); setSelection('') }}>Спросить ассистента</Button><Button size="sm" variant="secondary" onClick={() => { void navigator.clipboard?.writeText(selection).catch(() => setError('Не удалось скопировать выделение.')); setSelection('') }}>Скопировать</Button>{selectionLooksLikeUrl && <Button size="sm" variant="secondary" onClick={() => { const result = normalizeReaderAddress(selection, currentUrl.current); if (result.url) openAddress(result.url); setSelection('') }}>Открыть как адрес</Button>}<IconButton size="sm" aria-label="Скрыть выделение" title="Скрыть выделение" onClick={() => setSelection('')}>×</IconButton></div>}
    {(transferOpen || steps.length > 0 || recording) && <ScenarioTransfer key={frameKey} pageUrl={scenarioUrl} steps={steps} disabled={scenarioRunning} onImport={next => { setSecretValues({}); setScenarioProgress(null); setSteps(next) }} />}
    {addressError && <p id={addressErrorId} className="webpreview-error" role="alert">{addressError}</p>}
    {loadState === 'loading' && <div className="webpreview-load-status" role="status" aria-live="polite">Загружаем {(() => { try { return url ? new URL(url).host : 'страницу' } catch { return 'страницу' } })()}…{longLoad && <> Долго. <Button size="sm" variant="secondary" onClick={openExternal}>Открыть во внешней вкладке</Button></>}</div>}
    {loadError && <div className="webpreview-error webpreview-load-error" role="alert"><span>{loadError}</span><Button size="sm" onClick={reload}>Повторить загрузку</Button>{url && <Button size="sm" variant="secondary" onClick={openExternal}>Открыть во внешней вкладке</Button>}<small className="webpreview-load-error__hint">Если сайт не работает в быстром просмотре, переключите «Полный браузер» в шапке.</small></div>}
    {loadState === 'ready' && url && <p className="vc-sr-only" aria-live="polite">{`Открыта страница${pageTitle ? `: ${pageTitle}` : ''}`}</p>}
    {error && <div className="webpreview-error webpreview-load-error" role="alert"><span>{error}</span><Button size="sm" aria-label="Скрыть ошибку Reader" onClick={() => setError(null)}>×</Button></div>}
    {storageError && <div className="webpreview-error webpreview-load-error" role="alert"><span>{storageError}</span><Button size="sm" onClick={saveScenario}>Повторить сохранение</Button></div>}
    {recording && <div className="webpreview-run-status" role="status" aria-live="polite">Идёт запись сценария: {steps.length} шаг.</div>}
    {manual && <div className="webpreview-run-status webpreview-manual" role="status" aria-live="polite">Управляете только вы: действия ассистента отклоняются. <Button size="sm" onClick={() => setManualMode(false)}>Вернуть ассистенту</Button></div>}
    {diagnostics && <DiagnosticHistory key={`${session.current?.conversationId}:${session.current?.registrationId}`} steps={diagnostics} />}
    {scenarioProgress && <div className="webpreview-run-status" role="status" aria-live="polite" data-status={scenarioProgress.status}>
      {scenarioProgress.status === 'running' ? 'Выполняется сценарий' : scenarioProgress.status === 'passed' ? 'Сценарий выполнен' : scenarioProgress.status === 'cancelled' ? 'Сценарий остановлен' : 'Ошибка сценария'}: {scenarioProgress.completed} из {scenarioProgress.total}
      {scenarioProgress.error && <span> — {scenarioProgress.error}</span>}
      {!scenarioRunning && <Button size="sm" aria-label="Скрыть результат сценария" onClick={() => setScenarioProgress(null)}>×</Button>}
    </div>}
    {(steps.length > 0 || past.length > 0 || future.length > 0) && <section className="webpreview-scenario" aria-label="Сценарий автотеста">
      <div className="webpreview-scenario-header">
      <Button size="sm" aria-expanded={!scenarioCollapsed} onClick={() => setScenarioCollapsed(value => !value)}>{scenarioCollapsed ? 'Показать шаги' : 'Скрыть шаги'}</Button>
      <Button variant="secondary" disabled={scenarioRunning || loadState !== 'ready' || !steps.length || steps.some(step => !step.selector.trim())} onClick={run}>Запустить</Button>
      {scenarioRunning && <Button variant="secondary" onClick={() => scenarioRunner.current?.cancel()}>Остановить сценарий</Button>}
      <strong>Шагов: {steps.length} / 200</strong>
      <Button variant="secondary" disabled={scenarioRunning || !past.length} onClick={() => { setSecretValues({}); undo() }}>Отменить правку</Button>
      <Button variant="secondary" disabled={scenarioRunning || !future.length} onClick={() => { setSecretValues({}); redo() }}>Повторить правку</Button>
      <Button variant="secondary" type="button" disabled={!steps.length || steps.some(step => !step.selector.trim())} onClick={exportPlaywright}>Экспорт в Playwright</Button>
      <Button variant="secondary" type="button" disabled={scenarioRunning} onClick={() => { editSteps([]); setSecretValues({}); setScenarioProgress(null) }}>Очистить</Button>
      </div>
      <ol hidden={scenarioCollapsed}>
      {steps.map((step, index) => <li key={index}><span>Шаг {index + 1}</span><select aria-label={'Действие шага ' + (index + 1)} value={step.kind} disabled={scenarioRunning} onChange={event => {
        const kind = event.target.value as Step['kind']; setSecretValues({}); editSteps(all => all.map((item, i) => i === index ? { kind, selector: item.selector, text: '', sensitive: false } : item))
      }}><option value="click">Клик</option><option value="type">Ввод</option></select><input aria-invalid={!step.selector.trim()} maxLength={PREVIEW_ACTION_LIMITS.selector} disabled={scenarioRunning} aria-label={'Селектор шага ' + (index + 1)} value={step.selector} onChange={(event) => { setSecretValues({}); editSteps((all) => all.map((item, i) => i === index ? { ...item, selector: event.target.value } : item)) }} />
        {step.kind === 'type' && !step.sensitive && <input maxLength={PREVIEW_ACTION_LIMITS.text} disabled={scenarioRunning} aria-label={'Значение шага ' + (index + 1)} value={step.text} onChange={(event) => editSteps((all) => all.map((item, i) => i === index ? { ...item, text: event.target.value } : item))} />}
        {step.kind === 'type' && step.sensitive && <input maxLength={PREVIEW_ACTION_LIMITS.text} disabled={scenarioRunning} aria-label={'Секретное значение шага ' + (index + 1)} type="password" value={secretValues[index] ?? ''} placeholder="введите для запуска" onChange={(event) => setSecretValues((all) => ({ ...all, [index]: event.target.value }))} />}
        {step.kind === 'type' && <label><input type="checkbox" disabled={scenarioRunning} aria-label={'Секрет шага ' + (index + 1)} checked={step.sensitive} onChange={event => {
          const sensitive = event.target.checked
          setSecretValues({})
          setSteps(all => all.map((item, i) => i === index ? { ...item, sensitive, text: '' } : item))
        }} />Секрет</label>}
        {!step.selector.trim() && <span role="status">Шаг {index + 1}: укажите селектор</span>}
        {step.kind === 'type' && <label><input type="checkbox" aria-label={'Enter после шага ' + (index + 1)} checked={step.submit === true} disabled={scenarioRunning} onChange={event => { const submit = event.target.checked; editSteps(all => all.map((item, i) => i === index ? { ...item, submit } : item)) }} />Enter</label>}
        <Button size="sm" disabled={scenarioRunning || steps.length >= 200} aria-label={'Дублировать шаг ' + (index + 1)} onClick={() => { setSecretValues({}); editSteps(all => [...all.slice(0, index + 1), { ...all[index] }, ...all.slice(index + 1)]) }}>Дублировать</Button>
        <IconButton size="sm" disabled={scenarioRunning || index === 0} title="Поднять шаг" aria-label={'Поднять шаг ' + (index + 1)} onClick={() => editStepOrder(index, -1)}>↑</IconButton>
        <IconButton size="sm" disabled={scenarioRunning || index === steps.length - 1} title="Опустить шаг" aria-label={'Опустить шаг ' + (index + 1)} onClick={() => editStepOrder(index, 1)}>↓</IconButton>
        <IconButton size="sm" disabled={scenarioRunning} title="Удалить шаг" aria-label={'Удалить шаг ' + (index + 1)} onClick={() => editStepOrder(index, 0)}>×</IconButton>
        {step.submit === true && <em>⏎ submit</em>}
        {step.sensitive && <em>секрет не сохраняется</em>}</li>)}
    </ol></section>}
    {url ? <div className="webpreview-viewport"><iframe key={frameKey} ref={frame} className="webpreview-frame" aria-busy={loadState === 'loading' || undefined} style={viewport ? { width: viewport + 'px', minWidth: viewport + 'px', flex: 'none' } : undefined} src={'/api/preview?url=' + encodeURIComponent(url)} title="Предпросмотр сайта" onLoad={event => loaded(event.currentTarget)} onError={() => failLoad('Не удалось загрузить сайт: сетевая ошибка.')} /></div> : <div className="webpreview-empty"><div>
      <p>Укажите адрес сайта или проекта</p>
      <p className="webpreview-empty__hint">или попросите ассистента в чате: «открой …» — страница появится здесь. Вставленный в поле адрес открывается сразу.</p>
      <p className="webpreview-empty__hint webpreview-empty__keys">Ctrl/Cmd+L — адрес · Alt+←/→ — история · Esc — отмена</p>
      <Button variant="secondary" size="sm" type="button" onClick={() => applyUrl(READER_PROJECT_ORIGIN + '/')}>Открыть текущий проект</Button>
      {recent.length > 0 && <p className="webpreview-empty__hint">Недавние:</p>}
      {recent.length > 0 && <nav className="webpreview-recent" aria-label="Недавние адреса">{recent.map((item, index) => <Button key={item} variant={index === 0 ? 'primary' : 'secondary'} size="sm" type="button" title={item} onClick={() => openAddress(item)}>{index === 0 ? `Продолжить: ${recentAddressLabel(item)}` : recentAddressLabel(item)}</Button>)}</nav>}
    </div></div>}

  </section>
}
