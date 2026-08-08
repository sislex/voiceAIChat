import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { RendererApi } from '@shared/ipc'
import type { LlmProvider, PermissionMode, TaskLaunchProposal } from '@shared/types'
import { allowedModels, isProviderAllowed } from '@shared/llmAccess'
import { CLAUDE_MODELS, CODEX_MODELS } from '@shared/types'
import type { TaskPriority } from '@shared/projects'
import type { KanbanAssistantSelection, SupportedTaskPatch, WidgetAssistantCommand, WidgetAssistantContext, WidgetUserAction } from '@shared/widgetAssistant'
import type { HealthResponse } from '@shared/protocol'
import { PREVIEW_INSPECTOR_COMMAND_TYPE, isPreviewElementMessage, isPreviewInspectorCommand, type PreviewElementPayload } from '@shared/previewInspector'
import { PREVIEW_ACTION_COMMAND_TYPE, isPreviewActionResultMessage, type PreviewActionResult, type PreviewDomAction } from '@shared/previewActions'
import { WEB_RECORDER_MESSAGE_TYPE, type WebRecorderClientMessage } from '@shared/webRecorder'
import { Sidebar } from './components/Sidebar'
import { ChatColumn } from './components/ChatColumn'
import { TaskChatHeader } from './components/chat/TaskChatHeader'
import { VoiceBar } from './components/VoiceBar'
import { VOICE_INPUT_ENABLED } from './lib/featureFlags'
import { SettingsModal } from './components/SettingsModal'
import { ConsolePanel } from './components/ConsolePanel'
import { OnboardingModal } from './components/OnboardingModal'
import { LoginScreen } from './components/LoginScreen'
import { EnginesObserver, type ObserverEngine } from './components/EnginesObserver'
import { UsersAdmin } from './components/UsersAdmin'
import { ProjectSettings } from './components/ProjectSettings'
import { ProjectBoard } from './components/ProjectBoard'
import { ProjectPage, ProjectsEmptyPage, ProjectNotFoundPage } from './components/ProjectPage'
import { WidgetAssistantFrame } from './components/WidgetAssistantFrame'
import { KanbanAssistant } from './components/KanbanAssistant'
import { MachineStatus } from './components/MachineStatus'
import { MachineUtility } from './components/MachineUtility'
import { CiCommands } from './components/ci/CiCommands'
import { RunFeed } from './components/ci/RunFeed'
import { ToolFrame } from './components/ToolFrame'
import type { ConsoleHistoryStore, MachineOps } from './components/machine'
import { ConversationSettings } from './components/ConversationSettings'
import { UiProviders } from './components/ui/UiProviders'
import { Dialog } from './components/ui/Dialog'
import { Button } from './components/ui/Button'
import { Skeleton } from './components/ui/Skeleton'
import { useToast } from './components/ui/Toast'
import { useConfirm } from './components/ui/useConfirm'
import { KnowledgeBase } from './components/KnowledgeBase'
import { KbUsagePanel } from './components/kb/KbUsagePanel'
import { hasPendingKbUsage } from './lib/kbUsage'
import { CommandPalette } from './components/CommandPalette'
import { HotkeysCheatSheet } from './components/HotkeysCheatSheet'
import { useVoiceStore } from './store/useVoiceStore'
import { useVoiceCues } from './lib/useVoiceCues'
import { useHashRoute } from './lib/useHashRoute'
import { useHotkeys, type HotkeyBinding } from './lib/useHotkeys'
import { useCommandSource } from './lib/useCommands'
import { buildAppCommands, buildHotkeyBindings } from './lib/appCommands'
import './styles/app.css'

// Шаг 5: состояние живёт в сторе (store/voiceStore.ts) на базе машины состояний.
// Разговоры/сообщения/настройки — реальные из SQLite через window.api (IPC).
// Рост live-транскрипта и ответ — мок-пайплайн (реальные Whisper/Claude — Шаги 7–8).

export interface AppProps {
  /** Мост IPC. По умолчанию — window.api; в тестах инжектится фейк. */
  api?: RendererApi
  /** Источник времени для меток сообщений (тесты подменяют детерминированным). */
  now?: () => number
  /** Переопределение задержек мок-пайплайна (тесты ускоряют их). */
  delays?: Parameters<typeof useVoiceStore>[0]['delays']
}

export interface WidgetActionInput {
  kind: string
  label: string
  targetId?: string
}

/** Keep the bounded action journal free of repeated notifications for one user action. */
export function appendWidgetAction(items: WidgetUserAction[], action: WidgetActionInput, at = Date.now()): WidgetUserAction[] {
  const previous = items[items.length - 1]
  if (previous?.kind === action.kind && previous.label === action.label && previous.targetId === action.targetId) return items
  return [...items.slice(-19), {
    id: `${at}-${items.length}`,
    ...action,
    at
  }]
}

// Разделы-страницы утилит в контентной колонке (как «Проекты»).
const UTILITY_PAGES: readonly string[] = ['claude-code', 'codex', 'machines', 'kb', 'users', 'ci']

// Запуск задачи предлагает только явный структурированный сигнал ассистента.

function normalizeWebUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch { return null }
}

/** Итог DOM-действия модели в превью (форма ответа preview.result). */
export interface PreviewActionOutcome {
  ok: boolean
  result?: PreviewActionResult
  error?: string
}

/** Исполнитель DOM-действий модели на странице превью (регистрирует PreviewPane). */
export type PreviewActionRunner = (action: PreviewDomAction) => Promise<PreviewActionOutcome>

/** Сценарий автотеста хранит устойчивый CSS-селектор; секреты не содержат значение. */
export type WebScenarioStep =
  | { kind: 'click'; selector: string; text: string; sensitive?: false }
  | { kind: 'type'; selector: string; text: string; sensitive: boolean }
export type WebScenarioStepStatus = 'idle' | 'running' | 'passed' | 'failed'
const PREVIEW_RECORD_TYPE = 'voicechat.preview.record.v1'

/** Сколько ждём ответ страницы на действие: дольше — значит она ещё грузится. */
const PREVIEW_ACTION_UI_TIMEOUT_MS = 10_000

export interface PreviewPaneProps {
  conversationUrl: string | null
  projectUrl: string | null
  onSave: (url: string | null) => Promise<void>
  onSelectElement?: (element: PreviewElementPayload) => void
  /**
   * Регистрация исполнителя DOM-действий модели (mcp__browser__*): пока панель
   * смонтирована и страница загружена, действия уходят в iframe; null — снятие.
   */
  onRegisterActionRunner?: (runner: PreviewActionRunner | null) => void
}

export function PreviewPane({ conversationUrl, projectUrl, onSave, onSelectElement, onRegisterActionRunner }: PreviewPaneProps): JSX.Element {
  const effective = conversationUrl ?? projectUrl
  const [draft, setDraft] = useState(effective ?? '')
  const [loaded, setLoaded] = useState(effective)
  const [reloadKey, setReloadKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [inspecting, setInspecting] = useState(false)
  const [recording, setRecording] = useState(false)
  const [scenario, setScenario] = useState<WebScenarioStep[]>([])
  const [scenarioStatus, setScenarioStatus] = useState<WebScenarioStepStatus[]>([])
  // Без HttpOnly-cookie превью same-origin /api/preview отвечает 401, поэтому iframe
  // ждёт ensurePreview session-моста; в desktop моста нет — там гейт не нужен.
  const [previewSession, setPreviewSession] = useState<'pending' | 'ready' | 'failed'>(
    () => (window.session?.ensurePreview ? 'pending' : 'ready')
  )
  const frameRef = useRef<HTMLIFrameElement>(null)
  // Ожидающие ответа DOM-действия модели: requestId → resolve с таймером.
  const pendingActions = useRef(new Map<string, { resolve: (outcome: PreviewActionOutcome) => void; timer: ReturnType<typeof setTimeout> }>())
  const actionSeq = useRef(0)
  const sendInspectorState = (enabled: boolean): void => {
    frameRef.current?.contentWindow?.postMessage({ type: PREVIEW_INSPECTOR_COMMAND_TYPE, enabled }, window.location.origin)
  }
  useEffect(() => {
    setDraft(effective ?? ''); setLoaded(effective); setError(null); setInspecting(false)
  }, [effective])
  useEffect(() => {
    const receive = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return
      if (event.data?.type === PREVIEW_RECORD_TYPE && event.data.step && (event.data.step.kind === 'click' || event.data.step.kind === 'type') && typeof event.data.step.selector === 'string') {
        const raw = event.data.step as { kind: 'click' | 'type'; selector: string; text?: unknown; sensitive?: unknown }
        const step: WebScenarioStep = raw.kind === 'click'
          ? { kind: 'click', selector: raw.selector, text: typeof raw.text === 'string' ? raw.text : '' }
          : { kind: 'type', selector: raw.selector, text: typeof raw.text === 'string' ? raw.text : '', sensitive: raw.sensitive === true }
        setScenario((previous) => [...previous, step])
        setScenarioStatus((previous) => [...previous, 'idle'])
        return
      }
      if (isPreviewInspectorCommand(event.data)) { setInspecting(event.data.enabled); return }
      if (isPreviewActionResultMessage(event.data)) {
        const pending = pendingActions.current.get(event.data.requestId)
        if (!pending) return
        clearTimeout(pending.timer)
        pendingActions.current.delete(event.data.requestId)
        pending.resolve(
          event.data.ok
            ? { ok: true, ...(event.data.result !== undefined ? { result: event.data.result } : {}) }
            : { ok: false, error: event.data.error ?? 'Действие в превью не выполнено' }
        )
        return
      }
      if (isPreviewElementMessage(event.data)) onSelectElement?.(event.data.payload)
    }
    const hotkey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && inspecting) { event.preventDefault(); setInspecting(false); return }
      if (event.altKey && event.key.toLowerCase() === 'i') { event.preventDefault(); setInspecting((value) => !value) }
    }
    window.addEventListener('message', receive)
    window.addEventListener('keydown', hotkey)
    return () => { sendInspectorState(false); window.removeEventListener('message', receive); window.removeEventListener('keydown', hotkey) }
  }, [inspecting, onSelectElement])
  useEffect(() => { sendInspectorState(inspecting) }, [inspecting])
  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ type: PREVIEW_RECORD_TYPE, enabled: recording }, window.location.origin)
  }, [recording, reloadKey, loaded])
  const runScenario = async (): Promise<void> => {
    const runner = frameRef.current?.contentWindow
    if (!loaded || !runner) { setError('Сначала откройте страницу для запуска сценария'); return }
    setScenarioStatus(scenario.map(() => 'idle'))
    for (let index = 0; index < scenario.length; index++) {
      const step = scenario[index]
      setScenarioStatus((current) => current.map((status, position) => position === index ? 'running' : status))
      if (step.kind === 'type' && step.sensitive) {
        setScenarioStatus((current) => current.map((status, position) => position === index ? 'failed' : status))
        setError(`Шаг ${index + 1}: чувствительное значение не записано; заполните его вручную и запустите снова.`)
        return
      }
      const outcome = await new Promise<PreviewActionOutcome>((resolve) => {
        const requestId = `scenario-${++actionSeq.current}`
        const timer = setTimeout(() => { pendingActions.current.delete(requestId); resolve({ ok: false, error: 'Страница не ответила' }) }, PREVIEW_ACTION_UI_TIMEOUT_MS)
        pendingActions.current.set(requestId, { resolve, timer })
        runner.postMessage({ type: PREVIEW_ACTION_COMMAND_TYPE, requestId, action: step }, window.location.origin)
      })
      if (!outcome.ok) {
        setScenarioStatus((current) => current.map((status, position) => position === index ? 'failed' : status))
        setError(`Шаг ${index + 1}: ${outcome.error ?? 'не выполнен'}`)
        return
      }
      setScenarioStatus((current) => current.map((status, position) => position === index ? 'passed' : status))
    }
    setError(null)
  }
  // Исполнитель DOM-действий модели: постит команду в iframe и ждёт ответ.
  // Пока страница не загружена (или грузится после open) — честная ошибка,
  // модель повторит чтение позже.
  useEffect(() => {
    if (!onRegisterActionRunner) return
    const runner: PreviewActionRunner = (action) => {
      const frame = frameRef.current?.contentWindow
      if (!loaded || !frame) {
        return Promise.resolve({ ok: false, error: 'В панели превью нет загруженной страницы — сначала open.' })
      }
      const requestId = `pa-${++actionSeq.current}`
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingActions.current.delete(requestId)
          resolve({ ok: false, error: 'Страница превью не ответила — возможно, ещё загружается. Повтори действие.' })
        }, PREVIEW_ACTION_UI_TIMEOUT_MS)
        pendingActions.current.set(requestId, { resolve, timer })
        frame.postMessage({ type: PREVIEW_ACTION_COMMAND_TYPE, requestId, action }, window.location.origin)
      })
    }
    onRegisterActionRunner(runner)
    return () => {
      onRegisterActionRunner(null)
      // Снятые ожидания закрываем ошибкой, чтобы ход модели не ждал таймаута сервера.
      for (const [requestId, pending] of pendingActions.current) {
        clearTimeout(pending.timer)
        pendingActions.current.delete(requestId)
        pending.resolve({ ok: false, error: 'Панель превью закрыта.' })
      }
    }
  }, [onRegisterActionRunner, loaded, reloadKey])
  useEffect(() => {
    const ensure = window.session?.ensurePreview
    if (!ensure) { setPreviewSession('ready'); return }
    if (!loaded) return
    let alive = true
    setPreviewSession('pending')
    void ensure().then(
      (ok) => { if (alive) setPreviewSession(ok ? 'ready' : 'failed') },
      () => { if (alive) setPreviewSession('failed') }
    )
    return () => { alive = false }
  }, [loaded, reloadKey])
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const raw = draft.trim()
    const normalized = raw ? normalizeWebUrl(raw) : null
    if (raw && !normalized) { setError('Введите адрес с протоколом http:// или https://'); return }
    try {
      sendInspectorState(false); setInspecting(false)
      await onSave(normalized)
      setDraft(normalized ?? projectUrl ?? '')
      setLoaded(normalized ?? projectUrl)
      setError(null)
    } catch {
      setError('Не удалось сохранить адрес превью')
    }
  }
  return <section className="webpreview" aria-label="Веб-рекордер">
    <form className="webpreview-bar" onSubmit={(event) => void submit(event)}>
      <label className="webpreview-address"><span className="vc-sr-only">Адрес превью</span><input type="url" inputMode="url" value={draft} placeholder="https://example.com" aria-invalid={Boolean(error)} aria-describedby={error ? 'webpreview-error' : undefined} onChange={(event) => setDraft(event.target.value)} /></label>
      <button className="vc-btn vc-btn--secondary" type="submit">Открыть</button>
      <button className="vc-btn vc-btn--secondary" type="button" disabled={!loaded} aria-label="Обновить" title="Обновить" onClick={() => setReloadKey((value) => value + 1)}>↻</button>
      <button className="vc-btn vc-btn--secondary" type="button" disabled={!loaded} aria-label="Открыть в новой вкладке" title="Открыть в новой вкладке" onClick={() => { if (loaded) window.open(loaded, '_blank', 'noopener,noreferrer') }}>↗</button>
      <button className="vc-btn vc-btn--secondary webpreview-inspector-toggle" type="button" aria-pressed={inspecting} disabled={!loaded} title="Выбор элемента (Alt+I)" onClick={() => setInspecting((value) => !value)}>⌖ <span>Выбор элемента</span></button>
      <button className="vc-btn vc-btn--secondary" type="button" aria-pressed={recording} disabled={!loaded} onClick={() => setRecording((value) => !value)}>{recording ? 'Остановить запись' : 'Записать сценарий'}</button>
    </form>
    {error && <p className="webpreview-error" id="webpreview-error" role="alert">{error}</p>}
    {scenario.length > 0 && <section className="webpreview-scenario" aria-label="Сценарий автотеста">
      <div className="webpreview-scenario-header"><strong>Сценарий: {scenario.length} шаг.</strong><button className="vc-btn vc-btn--secondary" type="button" onClick={() => void runScenario()}>Запустить</button><button className="vc-btn vc-btn--secondary" type="button" onClick={() => { setScenario([]); setScenarioStatus([]) }}>Очистить</button></div>
      <ol>{scenario.map((step, index) => <li key={`${step.selector}-${index}`} data-status={scenarioStatus[index] ?? 'idle'}><span>{scenarioStatus[index] === 'passed' ? '✓' : scenarioStatus[index] === 'failed' ? '✕' : `${index + 1}.`}</span> <code>{step.kind}</code> <input aria-label={`Селектор шага ${index + 1}`} value={step.selector} onChange={(event) => setScenario((items) => items.map((item, position) => position === index ? { ...item, selector: event.target.value } as WebScenarioStep : item))} />{step.kind === 'type' && <input aria-label={`Значение шага ${index + 1}`} value={step.sensitive ? '••••••' : step.text} readOnly={step.sensitive} onChange={(event) => setScenario((items) => items.map((item, position) => position === index ? { ...item, text: event.target.value } as WebScenarioStep : item))} />}{step.kind === 'type' && step.sensitive && <em>секрет не сохранён</em>}</li>)}</ol>
    </section>}
    {loaded && previewSession === 'ready' && <iframe key={reloadKey} ref={frameRef} className="webpreview-frame" src={'/api/preview?url=' + encodeURIComponent(loaded)} title="Предпросмотр сайта" onLoad={() => sendInspectorState(inspecting)} onError={() => setError('Сайт недоступен или не разрешает загрузку')} />}
    {loaded && previewSession === 'pending' && <div className="webpreview-empty" role="status">Подключение превью…</div>}
    {loaded && previewSession === 'failed' && <div className="webpreview-empty" role="alert">Превью недоступно: войдите в приложение заново и обновите превью</div>}
    {!loaded && <div className="webpreview-empty">Укажите http/https-адрес проекта</div>}
  </section>
}

/** Совместимый экспорт для существующих интеграций. */
export const WebPreview = PreviewPane

/**
 * Host-side integration only. The recorder is a separately built application;
 * ChatAI communicates exclusively through @shared/webRecorder postMessage events.
 */
function WebRecorderHost({ conversationUrl, projectUrl, onSave, onSelectElement, onRegisterActionRunner }: PreviewPaneProps): JSX.Element {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const pending = useRef(new Map<string, (outcome: PreviewActionOutcome) => void>())
  const ready = useRef(false)
  const url = conversationUrl ?? projectUrl
  const send = (message: object): void => frameRef.current?.contentWindow?.postMessage({ type: WEB_RECORDER_MESSAGE_TYPE, ...message }, '*')
  useEffect(() => { send({ kind: 'set-url', url }) }, [url])
  useEffect(() => {
    const receive = (event: MessageEvent): void => {
      if (event.source !== frameRef.current?.contentWindow || event.data?.type !== WEB_RECORDER_MESSAGE_TYPE) return
      const message = event.data as WebRecorderClientMessage
      if (message.kind === 'ready') { ready.current = true; send({ kind: 'set-url', url }); return }
      if (message.kind === 'save-url') { void onSave(message.url); return }
      if (message.kind === 'element') { onSelectElement?.(message.element); return }
      if (message.kind === 'action-result') { const resolve = pending.current.get(message.requestId); if (resolve) { pending.current.delete(message.requestId); resolve({ ok: message.ok, result: message.result, error: message.error }) } }
    }
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive)
  }, [onSave, onSelectElement, url])
  useEffect(() => {
    if (!onRegisterActionRunner) return
    onRegisterActionRunner((action) => {
      if (!ready.current) return Promise.resolve({ ok: false, error: 'Веб-рекордер ещё не готов.' })
      return new Promise((resolve) => { const requestId = 'wr-' + crypto.randomUUID(); pending.current.set(requestId, resolve); send({ kind: 'run-action', requestId, action }) })
    })
    return () => { onRegisterActionRunner(null); for (const resolve of pending.current.values()) resolve({ ok: false, error: 'Веб-рекордер закрыт.' }); pending.current.clear() }
  }, [onRegisterActionRunner])
  return <section className="webpreview" aria-label="Веб-рекордер"><iframe ref={frameRef} className="webpreview-frame" src="/web-recorder/" title="Веб-рекордер" aria-hidden="true" /></section>
}

/**
 * Корень приложения. Тосты и подтверждения — провайдеры вокруг всего дерева:
 * спросить подтверждение или показать ошибку может любой экран на любой глубине.
 * avoidSelector — композер: на телефоне стек тостов стоит над ним, а не поверх.
 */
export default function App(props: AppProps = {}): JSX.Element {
  return (
    <UiProviders avoidSelector=".voicebar">
      <AppBody {...props} />
    </UiProviders>
  )
}

function AppBody({ api = window.api, now, delays }: AppProps = {}): JSX.Element {
  // Hash-роутинг: URL — источник навигации (см. useHashRoute).
  const { path, segments, navigate } = useHashRoute()
  const inProjects = segments[0] === 'projects'
  const routeProjectId = inProjects ? (segments[1] ?? null) : null
  const routeSettings = inProjects && segments[2] === 'settings'
  // «Открыть задачу» из шапки связанного чата: #/projects/:id/task/:taskId.
  const routeTaskId = inProjects && segments[2] === 'task' ? (segments[3] ?? null) : null
  // Утилиты-страницы: один сегмент из белого списка (#/machines, #/kb, …).
  // У базы знаний есть второй сегмент — открытый документ (#/kb/:documentId):
  // так на раздел можно дать ссылку из панели «Использование БЗ» и из «Подробнее».
  const utilitySeg =
    segments.length >= 1 && UTILITY_PAGES.includes(segments[0]) && (segments.length === 1 || ((segments[0] === 'kb' || segments[0] === 'users') && segments.length === 2))
      ? segments[0]
      : null
  const routeKbDocumentId = segments[0] === 'kb' ? (segments[1] ?? null) : null
  const routeUserName = segments[0] === 'users' ? (segments[1] ?? null) : null
  const onUtilityPage = utilitySeg !== null
  // Адрес открытого чата: #/chat/:id. Экран чата — всё, что не проекты и не
  // утилита («#/» тоже: с него сразу уводим на #/chat/:id активного чата).
  const routeChatId = segments[0] === 'chat' ? (segments[1] ?? null) : null
  const inChat = !inProjects && !onUtilityPage
  const { state, actions } = useVoiceStore({ api, now, delays, initialChatId: routeChatId })
  const [release, setRelease] = useState<HealthResponse | null>(null)
  const [chatView, setChatView] = useState<'chat' | 'preview'>('chat')
  const [previewElement, setPreviewElement] = useState<PreviewElementPayload | null>(null)
  const [activeProjectPreviewUrl, setActiveProjectPreviewUrl] = useState<string | null>(null)
  const [assistantOpen, setAssistantOpen] = useState(() => globalThis.localStorage?.getItem('voicechat.kanbanAssistantOpen') === '1')
  const [assistantTaskId, setAssistantTaskId] = useState<string | null>(null)
  const [assistantField, setAssistantField] = useState<keyof SupportedTaskPatch | null>(null)
  const [widgetActions, setWidgetActions] = useState<WidgetUserAction[]>([])
  const setKanbanAssistantOpen = (open: boolean): void => { setAssistantOpen(open); globalThis.localStorage?.setItem('voicechat.kanbanAssistantOpen', open ? '1' : '0') }
  const rememberWidgetAction = useCallback((kind: string, label: string, targetId?: string): void => {
    setWidgetActions((items) => appendWidgetAction(items, { kind, label, ...(targetId ? { targetId } : {}) }))
  }, [])
  const handleAssistantSelectionChange = useCallback((taskId: string | null, field: keyof SupportedTaskPatch | null): void => {
    setAssistantTaskId(taskId)
    setAssistantField(field)
    if (taskId) rememberWidgetAction(field ? 'field.select' : 'task.open', field ? `Выбрано поле ${field}` : 'Открыта карточка', taskId)
  }, [rememberWidgetAction])
  const [previewWidth, setPreviewWidth] = useState(() => {
    const saved = Number(globalThis.localStorage?.getItem('voicechat.previewWidth'))
    return Number.isFinite(saved) && saved >= 25 && saved <= 75 ? saved : 45
  })
  useEffect(() => { setPreviewElement(null) }, [state.activeId])
  // Действия модели в превью (mcp__browser__*): исполнителя DOM-действий даёт
  // смонтированная PreviewPane, `open` выполняем сохранением адреса превью чата.
  const previewRunnerRef = useRef<PreviewActionRunner | null>(null)
  const registerPreviewRunner = useCallback((runner: PreviewActionRunner | null) => {
    previewRunnerRef.current = runner
  }, [])
  useEffect(() => {
    const bridge = window.preview
    if (!bridge) return
    return bridge.onAction(({ conversationId, requestId, action }) => {
      void (async (): Promise<PreviewActionOutcome> => {
        // Действия ограничены активной страницей: чужой или свёрнутый чат не трогаем.
        if (state.activeId !== conversationId) {
          return { ok: false, error: 'Этот чат сейчас не открыт у пользователя — превью недоступно.' }
        }
        if (action.kind === 'open') {
          try {
            await actions.setConversationPreviewUrl(conversationId, action.url)
            setPreviewElement(null)
            return { ok: true, result: { url: action.url } }
          } catch {
            return { ok: false, error: 'Не удалось сохранить адрес превью.' }
          }
        }
        const runner = previewRunnerRef.current
        if (!runner) return { ok: false, error: 'Панель превью не открыта у пользователя.' }
        return runner(action)
      })().then((outcome) => bridge.result({ requestId, ...outcome }))
    })
  }, [state.activeId, actions])
  useEffect(() => {
    let alive = true
    const projectId = state.conversations.find((conversation) => conversation.id === state.activeId)?.projectId
    if (!projectId) { setActiveProjectPreviewUrl(null); return }
    void api['projects:get']({ id: projectId }).then((project) => { if (alive) setActiveProjectPreviewUrl(project?.previewUrl ?? null) })
    return () => { alive = false }
  }, [api, state.activeId, state.conversations])
  const resizePreview = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const container = event.currentTarget.parentElement
    if (!container) return
    const move = (pointer: PointerEvent): void => {
      const rect = container.getBoundingClientRect()
      const next = Math.min(75, Math.max(25, ((rect.right - pointer.clientX) / rect.width) * 100))
      setPreviewWidth(next)
      globalThis.localStorage?.setItem('voicechat.previewWidth', String(next))
    }
    const stop = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop)
  }
  useEffect(() => {
    let active = true
    void api['app:ping']().then((value) => { if (active) setRelease(value) }).catch(() => undefined)
    return () => { active = false }
  }, [api])
  const toast = useToast()
  const confirm = useConfirm()
  const authed = !state.authRequired || Boolean(state.currentUser)
  // Мобильный режим: выдвинут ли сайдбар (на десктопе класс side--open не влияет).
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Любой переход закрывает выдвижной сайдбар: он рисуется поверх контента, и
  // забытая открытой панель закрывала собой открытую страницу или карточку
  // (напр. переход «Открыть задачу» из шапки связанного чата).
  useEffect(() => { setSidebarOpen(false) }, [path])
  // Десктоп: свёрнут ли сайдбар (колонка → 0). Персист в localStorage.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('vc:sidebarCollapsed') === '1' } catch { return false }
  })
  const setCollapsedPersist = (v: boolean): void => {
    setCollapsed(v)
    try { localStorage.setItem('vc:sidebarCollapsed', v ? '1' : '0') } catch { /* приватный режим */ }
  }
  const [conversationSettingsOpen, setConversationSettingsOpen] = useState(false)
  const [taskProposal, setTaskProposal] = useState<{
    projectId: string
    messageId: string
    proposalId: string
    title: string
    description: string
    acceptanceCriteria: string
    priority: TaskPriority
    assignee: string | null
    provider: LlmProvider
    model: string
  } | null>(null)
  const [taskLaunchPending, setTaskLaunchPending] = useState(false)
  // Режим списка сайдбара: маршрут ведёт его автоматически, ручной выбор
  // (переключатель) живёт до следующей смены маршрута.
  const [sidebarMode, setSidebarMode] = useState<'chats' | 'projects'>('chats')
  useEffect(() => { setSidebarMode(inProjects ? 'projects' : 'chats') }, [inProjects])
  useVoiceCues(state.voice) // звуковые сигналы: старт/стоп записи, «думает»

  // Канал уведомлений стора → тосты. Показанные сразу снимаем из очереди, а
  // отданные id помним: без этого повторный прогон эффекта (StrictMode) показал
  // бы каждое уведомление дважды.
  const shownNotices = useRef(new Set<string>())
  useEffect(() => {
    for (const notice of state.notices) {
      if (!shownNotices.current.has(notice.id)) {
        shownNotices.current.add(notice.id)
        toast[notice.kind](notice.text, notice.retry ? { action: { label: 'Повторить', onClick: notice.retry } } : undefined)
      }
      actions.dismissNotice(notice.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.notices])

  // Тема дублируется на <html>: модальные окна уходят порталом в document.body,
  // вне .app, и без этого теряли бы токены [data-theme='dark'].
  useEffect(() => {
    document.documentElement.dataset.theme = state.settings.theme
  }, [state.settings.theme])

  // Командная палитра (⌘K) и шпаргалка (?) — окна поверх всего остального.
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [cheatSheetOpen, setCheatSheetOpen] = useState(false)

  const stopOrCancel = (): void => {
    const v = state.voice
    if (v === 'thinking' || v === 'speaking') actions.cancelRequest()
    else if (v === 'listening') actions.stopVoice()
  }

  // Горячие клавиши: пробел (hold) — запись, Esc — стоп/отмена по состоянию,
  // плюс биндинги палитры и шпаргалки. `enabled` гасит только голосовые клавиши
  // (модал настроек — свои поля и фокус); у остальных биндингов свой `enabled`.
  const hotkeyBindings: HotkeyBinding[] = buildHotkeyBindings({
    onboarded: state.settings.onboarded,
    voice: state.voice,
    togglePalette: () => setPaletteOpen((v) => !v),
    openCheatSheet: () => setCheatSheetOpen(true)
  })

  useHotkeys({
    enabled: !state.settingsOpen && state.settings.onboarded,
    onPushStart: actions.startVoice,
    onPushEnd: actions.stopVoice,
    onEscape: stopOrCancel,
    bindings: hotkeyBindings
  })

  // Команды уровня приложения в общем реестре (lib/commands.ts): базовый набор
  // плюс пункты по данным — беседы, проекты, задачи открытой доски, машины.
  // Экранные команды регистрируют сами экраны (канбан, лента CI-рана).
  // Источник — функция: она вызывается в момент сборки списка, поэтому видит
  // свежее состояние стора, а не то, что было на момент регистрации.
  const boardProjectName =
    state.projectDetail?.id === state.activeProjectId
      ? state.projectDetail.name
      : state.projects.find((p) => p.id === state.activeProjectId)?.name ?? null
  // Куда ведёт вход в раздел «Проекты» и удаление текущего проекта.
  const firstProjectId = state.projects[0]?.id ?? null
  const routeProjectName =
    (state.projectDetail?.id === routeProjectId ? state.projectDetail.name : null) ??
    state.projects.find((p) => p.id === routeProjectId)?.name ??
    'Проект'
  const kanbanAssistantContext = useMemo<WidgetAssistantContext<KanbanAssistantSelection>>(() => {
    const project = state.projects.find((item) => item.id === routeProjectId) ?? null
    const board = state.activeProjectId === routeProjectId ? state.board : null
    const openTask = board?.tasks.find((task) => task.id === assistantTaskId) ?? null
    return {
      version: 1,
      widget: { kind: 'kanban', instanceId: routeProjectId ?? 'none', title: routeProjectName },
      project: project ? { id: project.id, name: project.name, description: project.description, technologies: project.technologies, skills: project.skills } : null,
      selection: board && routeProjectId ? { board: { projectId: routeProjectId, columns: board.columns }, openTask, selectedField: assistantField } : null,
      recentActions: widgetActions
    }
  }, [state.projects, state.board, state.activeProjectId, routeProjectId, routeProjectName, assistantTaskId, assistantField, widgetActions])
  // Список загружен, а проекта из адреса в нём нет: удалён или нет доступа.
  const projectMissing =
    routeProjectId !== null && state.projectsLoaded && !state.projects.some((p) => p.id === routeProjectId)
  useCommandSource(() =>
    buildAppCommands({
      voiceEnabled: VOICE_INPUT_ENABLED,
      voice: state.voice,
      autoSpeak: state.settings.autoSpeak,
      theme: state.settings.theme,
      web: state.authRequired,
      paletteOpen,
      boardProjectId: state.activeProjectId ?? state.projects[0]?.id ?? null,
      chats: state.conversations,
      projects: state.projects,
      tasks: state.board?.tasks ?? [],
      taskProject:
        state.activeProjectId && boardProjectName
          ? { id: state.activeProjectId, name: boardProjectName }
          : null,
      machines: state.authRequired ? state.agents : [],
      newChat: () => void actions.newConversation().then((id) => navigate(`/chat/${id}`)),
      toggleMic: () => (state.voice === 'listening' ? actions.stopVoice() : actions.startVoice()),
      stopOrCancel,
      toggleAutoSpeak: () => void actions.updateSettings({ autoSpeak: !state.settings.autoSpeak }),
      toggleTheme: () => void actions.updateSettings({ theme: state.settings.theme === 'dark' ? 'light' : 'dark' }),
      openSettings: actions.openSettings,
      openBoard: (projectId) => navigate(`/projects/${projectId}`),
      openMachineConsole: (agentId) =>
        agentId ? actions.openUtility('console', agentId) : actions.openUtilityForActiveChat('console'),
      openKnowledgeBase: () => navigate('/kb'),
      openKbUsage: actions.openKbUsage,
      logout: () => void actions.logout(),
      openPalette: () => setPaletteOpen(true),
      openCheatSheet: () => setCheatSheetOpen(true),
      openChat: (id) => navigate(`/chat/${id}`),
      openProject: (id) => navigate(`/projects/${id}`),
      openTask: (projectId, taskId) => navigate(`/projects/${projectId}/task/${taskId}`)
    })
  )

  // Маршрут ↔ активный чат. Одна точка синхронизации, чтобы стороны не тянули
  // адрес друг у друга: syncedChatId — последний согласованный id. Изменился
  // адрес (клик по чату, «Назад», ссылка извне) — грузим чат из адреса;
  // изменился активный чат в сторе (создание, удаление, resume, автосоздание
  // первой репликой) — переписываем адрес без новой записи в истории.
  const syncedChatId = useRef<string | null>(routeChatId)
  useEffect(() => {
    if (!authed || !inChat) return
    if (routeChatId && routeChatId !== syncedChatId.current) {
      syncedChatId.current = routeChatId
      if (routeChatId === state.activeId) return // стор уже открыл этот чат
      const fallback = state.activeId
      void actions.selectConversation(routeChatId).then((ok) => {
        if (ok || syncedChatId.current !== routeChatId) return
        // Чата нет (удалён или чужой) — возвращаемся к прежнему.
        syncedChatId.current = fallback
        if (fallback) {
          void actions.selectConversation(fallback)
          navigate(`/chat/${fallback}`, { replace: true })
        } else {
          navigate('/', { replace: true })
        }
      })
      return
    }
    if (state.activeId && (routeChatId === null || state.activeId !== syncedChatId.current)) {
      syncedChatId.current = state.activeId
      navigate(`/chat/${state.activeId}`, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, inChat, routeChatId, state.activeId])

  // URL → данные стора: вход/выход в раздел «Проекты», загрузка доски и
  // оверлея настроек. Навигацию делают клики (navigate), данные грузятся тут.
  useEffect(() => {
    if (!authed) return
    if (inProjects) { if (!state.projectsOpen) void actions.openProjects() }
    else if (state.projectsOpen) actions.closeProjects()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, inProjects])
  useEffect(() => {
    if (!authed || !inProjects) return
    if (routeProjectId) { if (state.activeProjectId !== routeProjectId) void actions.openBoard(routeProjectId) }
    else if (state.activeProjectId) actions.closeBoard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, inProjects, routeProjectId])
  // Прямая ссылка на завершённую задачу: сервер прячет с доски давно готовые
  // карточки, и открывать было бы нечего. Если задачи из URL в снапшоте нет —
  // один раз включаем «Показать завершённые» и доска приходит целиком.
  useEffect(() => {
    if (!authed || !inProjects || !routeTaskId) return
    if (state.boardIncludeCompleted || state.boardLoading || !state.board) return
    if (state.board.tasks.some((t) => t.id === routeTaskId)) return
    void actions.setBoardIncludeCompleted(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, inProjects, routeTaskId, state.board, state.boardLoading, state.boardIncludeCompleted])
  // Страницы-списка проектов нет: #/projects без id — это всегда переход на
  // первый проект списка. Правило то же, что у клика «Проекты» в сайдбаре,
  // поэтому персист последнего проекта не нужен. Нет проектов — редиректа нет,
  // и в области контента остаётся пустое состояние (создать — в сайдбаре).
  useEffect(() => {
    if (!authed || !inProjects || routeProjectId || !firstProjectId) return
    navigate(`/projects/${firstProjectId}`, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, inProjects, routeProjectId, firstProjectId])
  useEffect(() => {
    if (!authed) return
    if (routeSettings) { if (!state.projectSettingsOpen) actions.openProjectSettings() }
    else if (state.projectSettingsOpen) actions.closeProjectSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, routeSettings])
  // URL → данные стора: утилиты-страницы. Вход на маршрут грузит данные, уход
  // зовёт close* — store-экшены прежние, поменялся только триггер (URL).
  useEffect(() => {
    if (utilitySeg === 'claude-code') { if (!state.ccOpen) void actions.openObserver() }
    else if (state.ccOpen) actions.closeObserver()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utilitySeg])
  useEffect(() => {
    if (utilitySeg === 'codex') { if (!state.cxOpen) void actions.openCodexObserver() }
    else if (state.cxOpen) actions.closeCodexObserver()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utilitySeg])
  useEffect(() => {
    if (!state.authRequired) return
    if (utilitySeg === 'machines') { if (!state.machinesOpen) actions.openMachines() }
    else if (state.machinesOpen) actions.closeMachines()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utilitySeg])
  useEffect(() => {
    if (!state.authRequired) return
    if (utilitySeg === 'ci') { if (!state.ciOpen) void actions.openCi() }
    else if (state.ciOpen) actions.closeCi()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utilitySeg])
  useEffect(() => {
    if (!state.authRequired) return
    if (utilitySeg === 'users') { if (!state.usersOpen) void actions.openUsers() }
    else if (state.usersOpen) actions.closeUsers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utilitySeg])
  useEffect(() => {
    if (utilitySeg !== 'users' || !routeUserName || !state.usersOpen || state.adminSelected === routeUserName) return
    void actions.selectAdminUser(routeUserName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utilitySeg, routeUserName, state.usersOpen, state.adminSelected])
  // Гейты: «Пользователи» — только админ; машины/пользователи — только web.
  useEffect(() => {
    if (utilitySeg === 'users' && state.currentUser && state.currentUser.role !== 'admin' && routeUserName && routeUserName !== state.currentUser.name) navigate('/users')
    if ((utilitySeg === 'users' || utilitySeg === 'machines' || utilitySeg === 'ci') && !state.authRequired) navigate('/')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utilitySeg, routeUserName, state.currentUser, state.authRequired])

  const activeConversation = state.conversations.find((c) => c.id === state.activeId)
  const activeTitle = activeConversation?.title ?? 'Новый разговор'
  const activeExecTarget = activeConversation?.execTarget ?? null
  const activeKbUsage = state.activeId ? state.kbUsage[state.activeId] : undefined
  // Счётчик обращений на кнопке «Использование БЗ» должен быть честным ДО
  // открытия панели, поэтому снапшот читаем при открытии чата и после каждого
  // нового сообщения (новый ход = возможные новые обращения).
  useEffect(() => {
    if (authed && state.activeId) void actions.loadKbUsage(state.activeId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, state.activeId, state.messages.length])
  const forcedPlan = state.currentUser?.role === 'user' && (!activeExecTarget || activeExecTarget === 'none')
  const activePermissionMode: PermissionMode = forcedPlan
    ? 'plan'
    : activeConversation?.permissionMode ?? state.settings.permissionMode
  const ciProvider = state.settings.llmProvider
  const ciModel = ciProvider === 'codex' ? state.settings.codexModel : state.settings.model
  const allowedClaudeModels = allowedModels(state.llmAccess, 'claude')
  const allowedCodexModels = allowedModels(state.llmAccess, 'codex')
  const allowedProviders = (['claude', 'codex'] as const).filter((provider) => isProviderAllowed(state.llmAccess, provider) && (provider === 'claude' ? allowedClaudeModels.length : allowedCodexModels.length))
  const proposalModels = taskProposal?.provider === 'codex' ? allowedCodexModels : allowedClaudeModels

  const openTaskProposal = (request: TaskLaunchProposal, messageId: string): void => {
    if (!activeConversation?.projectId) {
      toast.error('Невозможно создать задачу: этот чат не привязан к проекту.')
      return
    }
    setTaskProposal({
      projectId: activeConversation.projectId,
      messageId,
      proposalId: request.id,
      title: request.title,
      description: request.description,
      acceptanceCriteria: request.acceptanceCriteria,
      priority: 'medium',
      assignee: state.currentUser?.name ?? null,
      provider: allowedProviders.includes(ciProvider) ? ciProvider : (allowedProviders[0] ?? ciProvider),
      model: (allowedProviders.includes(ciProvider) ? (ciProvider === 'codex' ? allowedCodexModels : allowedClaudeModels) : (allowedProviders[0] === 'codex' ? allowedCodexModels : allowedClaudeModels))[0]?.id ?? ciModel
    })
  }

  const chooseTaskLaunch = async (mode: 'todo' | 'in-progress' | 'chat'): Promise<void> => {
    if (!taskProposal || taskLaunchPending) return
    setTaskLaunchPending(true)
    try {
      if (mode === 'todo') {
        const board = await api['board:get']({ id: taskProposal.projectId })
        const column = board.columns.find((item) => item.semanticType === 'backlog') ?? board.columns[0]
        if (!column) return
        await api['tasks:create']({
          projectId: taskProposal.projectId,
          columnId: column.id,
          title: taskProposal.title,
          description: taskProposal.description,
          acceptanceCriteria: taskProposal.acceptanceCriteria,
          priority: taskProposal.priority,
          assignee: taskProposal.assignee
        })
        toast.success('Задача создана в TODO')
      } else if (mode === 'in-progress') {
        const run = await actions.createTaskAndStartCi(taskProposal.projectId, taskProposal)
        if (!run) return
        toast.success('Задача создана и поставлена в CI-очередь')
      }
      await actions.updateTaskLaunchStatus(taskProposal.messageId, taskProposal.proposalId, mode === 'chat' ? 'declined' : 'created')
      setTaskProposal(null)
      if (mode === 'chat') {
        toast.success('Предложение отклонено')
      }
    } finally {
      setTaskLaunchPending(false)
    }
  }

  const changeConversationMode = async (mode: PermissionMode): Promise<void> => {
    if (!activeConversation || mode === activePermissionMode) return
    if (
      activePermissionMode === 'plan' &&
      mode === 'bypassPermissions' &&
      !(await confirm({
        title: 'Полный доступ',
        message: 'Перейти из планирования в «Полный доступ»? Агент сможет выполнять команды и изменять любые доступные файлы.',
        confirmLabel: 'Перейти'
      }))
    ) return
    await actions.setConversationExecTarget(
      activeConversation.id,
      activeConversation.execTarget,
      activeConversation.workdir,
      activeConversation.skillNames,
      activeConversation.llmProvider,
      activeConversation.llmModel,
      mode
    )
  }

  // Номера обнаруженных спикеров — из растущего транскрипта; при пустом live —
  // от режима диаризации (как в прототипе).
  const liveSpeakers = [...new Set(state.liveSegments.map((s) => s.speakerId))].sort((a, b) => a - b)
  const detectedSpeakers =
    liveSpeakers.length > 0 ? liveSpeakers : state.settings.diarization ? [1, 2] : [1]

  const showConsole = state.settings.showConsole

  // Операции над машиной для утилит (консоль/проводник); только web (есть мост fs).
  const machineOps: MachineOps | undefined = state.authRequired
    ? {
        list: actions.fsList,
        read: actions.fsRead,
        write: actions.fsWrite,
        remove: actions.fsRemove,
        rename: actions.fsRename,
        mkdir: actions.fsMkdir,
        download: actions.downloadFsFile,
        upload: actions.uploadFsFile,
        exec: actions.agentExec
      }
    : undefined

  // История команд консоли живёт в сторе: утилиту закрывают и открывают заново, а
  // ↑/↓ должны листать то же, что набирали до этого. Объект пересобирается на
  // каждый рендер (как machineOps) — в зависимости эффектов его не кладут.
  const consoleHistory: ConsoleHistoryStore = {
    get: (agentId) => state.consoleHistory[agentId] ?? [],
    push: actions.pushConsoleCommand
  }

  // Закрывает мобильный сайдбар и выполняет действие пункта меню.
  const menu = (fn: () => void) => (): void => {
    setSidebarOpen(false)
    fn()
  }

  // Многопользовательский режим (web): пока не вошли — показываем экран логина.
  if (state.authRequired && !state.currentUser) {
    return (
      <LoginScreen
        onLogin={(name, password) => void actions.login(name, password)}
        error={state.authError}
        theme={state.settings.theme}
      />
    )
  }

  return (
    <div
      className={[
        'app',
        showConsole && 'app--console',
        collapsed && 'app--sidebar-collapsed'
      ].filter(Boolean).join(' ')}
      data-theme={state.settings.theme}
    >
      {release && (
        <footer
          className="release-version"
          title={new Date(release.releasedAt).toLocaleString()}
          aria-label={`Версия ${release.version}; выпущена ${new Date(release.releasedAt).toLocaleString()}`}
        >
          v{release.version}
        </footer>
      )}
      <Sidebar
        open={sidebarOpen}
        onToggleCollapse={() => setCollapsedPersist(true)}
        conversations={state.conversations}
        conversationsStatus={state.conversationsStatus}
        conversationsError={state.conversationsError}
        onRetryConversations={() => void actions.retryConversations()}
        activeId={state.activeId}
        taskBadges={state.taskChatBadges}
        ciSummaries={state.ciSummaries}
        workingIds={[
          ...Object.keys(state.activeTurns),
          ...((state.voice === 'thinking' || state.voice === 'speaking') && state.activeId
            ? [state.activeId]
            : [])
        ]}
        now={now ? now() : Date.now()}
        onNew={() => {
          setSidebarOpen(false)
          void actions.newConversation().then((id) => navigate(`/chat/${id}`))
        }}
        onPick={(id) => {
          setSidebarOpen(false)
          navigate(`/chat/${id}`)
        }}
        onDelete={actions.deleteConversation}
        defaultPermissionMode={state.settings.permissionMode}
        agents={state.agents}
        searchQuery={state.searchQuery}
        onSearch={actions.setSearchQuery}
        searchScope={state.searchScope}
        onSearchScopeChange={(scope) => void actions.setSearchScope(scope)}
        messageSearch={state.messageSearch}
        onPickMessage={(hit) => {
          setSidebarOpen(false)
          // Подсветку просим заранее: лента прокрутится к сообщению, как только
          // оно окажется в DOM (беседа может ещё грузиться).
          actions.focusMessage(hit.messageId)
          navigate(`/chat/${hit.conversationId}`)
        }}
        onRetryMessageSearch={() => void actions.retryMessageSearch()}
        onLoadMoreMessages={() => void actions.loadMoreMessageSearch()}
        showDoneTaskChats={state.showDoneTaskChats}
        onShowDoneTaskChatsChange={(show) => void actions.setShowDoneTaskChats(show)}
        projects={state.projects}
        selectedProjectId={state.sidebarProjectId}
        onSelectProject={(id) => void actions.setSidebarProject(id)}
        onOpenObserver={menu(() => navigate('/claude-code'))}
        onOpenKnowledgeBase={menu(() => navigate('/kb'))}
        onOpenSettings={menu(actions.openSettings)}
        onOpenFiles={state.authRequired ? menu(() => actions.openUtilityForActiveChat('explorer')) : undefined}
        onOpenConsole={state.authRequired ? menu(() => actions.openUtilityForActiveChat('console')) : undefined}
        onOpenUsers={state.authRequired ? menu(() => navigate('/users')) : undefined}
        onOpenMachines={state.authRequired ? menu(() => navigate('/machines')) : undefined}
        onOpenCi={state.authRequired ? menu(() => navigate('/ci')) : undefined}
        currentUser={state.currentUser}
        onLogout={state.authRequired ? () => void actions.logout() : undefined}
        mode={sidebarMode}
        onModeChange={state.authRequired ? (m) => {
          setSidebarMode(m)
          // «Проекты» — не просто другой список в сайдбаре: раздел открывается
          // страницей первого проекта. Список сначала перечитываем — выходя из
          // раздела, стор его чистит (closeProjects).
          if (m === 'projects') {
            void actions.refreshProjects().catch(() => state.projects).then((list) => {
              if (inProjects) return
              const first = list[0]?.id
              navigate(first ? `/projects/${first}` : '/projects')
            })
          }
        } : undefined}
        activeProjectId={routeProjectId}
        onPickProject={(id) => {
          setSidebarOpen(false)
          navigate(`/projects/${id}`)
        }}
        onCreateProject={(name) => {
          setSidebarOpen(false)
          void actions.createProject({ name }).then((detail) => {
            if (detail) navigate(`/projects/${detail.id}`)
          })
        }}
        onOpenCommandPalette={() => {
          setSidebarOpen(false)
          setPaletteOpen(true)
        }}
      />
      {sidebarOpen && (
        <div className="side-backdrop" aria-hidden onClick={() => setSidebarOpen(false)} />
      )}

      {!inProjects && !onUtilityPage && (
      <div className={`chat-split chat-split--${chatView}`} style={{ '--preview-width': `${previewWidth}%` } as CSSProperties}>
      <nav className="chat-split-tabs" aria-label="Режим экрана"><div role="tablist"><button type="button" role="tab" aria-selected={chatView === 'chat'} onClick={() => setChatView('chat')}>Чат</button><button type="button" role="tab" aria-selected={chatView === 'preview'} onClick={() => setChatView('preview')}>Превью</button></div></nav>
      <div className="chat-split-chat">
      <ChatColumn
        onToggleSidebar={() => {
          if (collapsed) setCollapsedPersist(false)
          else setSidebarOpen((v) => !v)
        }}
        title={activeTitle}
        onRenameTitle={(t) => {
          if (state.activeId) void actions.renameConversation(state.activeId, t)
        }}
        onOpenConversationSettings={() => { setConversationSettingsOpen(true); void actions.refreshProjects() }}
        permissionMode={activePermissionMode}
        onExecutePlan={(answerId) => void actions.executePlan(answerId)}
        canExecutePlan={!forcedPlan}
        state={state.voice}
        messages={state.messages}
        loadingMessages={state.loadingMessages}
        highlightMessageId={state.highlightMessageId}
        onHighlightDone={actions.clearMessageHighlight}
        liveSegments={state.liveSegments}
        diarization={state.settings.diarization}
        streamingReply={state.streamingReply}
        liveActivity={state.liveActivity}
        liveUsage={state.liveUsage}
        canSpeak={state.ttsAvailable}
        speakingMessageId={state.speakingMessageId}
        onSpeakMessage={actions.replayMessage}
        onDeleteMessage={actions.deleteMessage}
        onEditMessage={actions.editMessage}
        onAnswerQuestions={(text) => void actions.answerQuestions(text)}
        onCreateTask={openTaskProposal}
        onAnswerCiInteraction={(runId, interactionId, text) => void actions.answerCiInteraction(runId, interactionId, { text })}
        answeredCiInteractions={state.answeredCiInteractions}
        taskHeader={
          // Виджет задачи — свойство открытого чата: показываем только контекст
          // этого чата. Так залипание невозможно по построению, кто бы и где ни
          // сменил `activeId` (новый чат, resume CC/Codex, переход по адресу).
          state.taskChatContext && state.taskChatContext.conversationId === state.activeId ? (
            <TaskChatHeader
              context={state.taskChatContext}
              summary={state.ciSummaries[state.taskChatContext.task.id] ?? null}
              onOpenTask={(projectId, taskId) => navigate(`/projects/${projectId}/task/${taskId}`)}
              renderRunFeed={(runId) => (
                <RunFeed
                  runId={runId}
                  cache={state.ciRuns[runId]}
                  onSubscribe={actions.ciSubscribe}
                  onUnsubscribe={actions.ciUnsubscribe}
                  onLoad={(id) => void actions.loadCiRun(id)}
                  onRetry={(id) => void actions.retryCiRun(id)}
                  onRetryFromStep={(id, selection) => void actions.retryCiRunFromStep(id, selection)}
                  onDiscardAndRetry={(id) => void actions.discardCiWorkspaceAndRetry(id)}
                  onCancel={(id) => void actions.cancelCiRun(id)}
                  onAnswerInteraction={(id, interactionId, answer) => void actions.answerCiInteraction(id, interactionId, answer)}
                />
              )}
            />
          ) : null
        }
        machineOps={machineOps}
        consoleHistory={consoleHistory}
        readServerFile={actions.readServerFile}
        onOpenImageInExplorer={(agentId, path) => actions.openUtility('explorer', agentId, path)}
        // Переключение утилиты из шапки встроенной карточки: та же машина и папка,
        // но окном (в сообщении карточка остаётся такой, какой её прислала модель).
        onSwitchUtility={(kind, agentId, dir) => actions.openUtility(kind, agentId, dir, kind === 'explorer')}
        onOpenMachines={state.authRequired ? () => navigate('/machines') : undefined}
        onOpenKbDocument={(documentId) => navigate(`/kb/${encodeURIComponent(documentId)}`)}
        error={state.error}
        onDismissError={actions.dismissError}
        modelMissing={!state.modelPresent}
        modelLabel={state.settings.whisperModel}
        downloading={state.downloading}
        downloadPercent={state.downloadPercent}
        onDownloadModel={actions.downloadModel}
        onExport={actions.exportConversation}
        onOpenKbUsage={state.activeId ? actions.openKbUsage : undefined}
        kbUsageCount={activeKbUsage?.report?.totals.queries ?? 0}
        kbUsageActive={hasPendingKbUsage(activeKbUsage?.report ?? null)}
        kbContextMode={activeConversation?.kbContextMode ?? 'auto'}
        turnMeta={state.lastTurnMeta}
        agents={state.agents}
        execTarget={activeExecTarget}
        aiLabel={(activeConversation?.llmProvider ?? state.settings.llmProvider) === 'codex' ? 'Codex' : 'Claude'}
        voiceBar={
          <VoiceBar
            state={state.voice}
            replyStarted={state.streamingReply.length > 0}
            draft={state.draft}
            diarization={state.settings.diarization}
            detectedSpeakers={detectedSpeakers}
            aiLabel={(activeConversation?.llmProvider ?? state.settings.llmProvider) === 'codex' ? 'Codex' : 'Claude'}
            attachments={state.attachments}
            previewElement={previewElement}
            onDraftChange={actions.setDraft}
            onSubmitText={() => { void actions.submitText(previewElement ?? undefined).then((sent) => { if (sent) setPreviewElement(null) }) }}
            onStartVoice={actions.startVoice}
            onStopVoice={actions.stopVoice}
            onStopSpeak={actions.stopSpeak}
            onCancelRequest={actions.cancelRequest}
            onAddFiles={(files) => files.forEach((f) => void actions.addAttachment(f))}
            onRemoveAttachment={actions.removeAttachment}
            onRemovePreviewElement={() => setPreviewElement(null)}
            permissionMode={activePermissionMode}
            onChangePermissionMode={(mode) => void changeConversationMode(mode)}
            voiceInputEnabled={VOICE_INPUT_ENABLED}
            aiAssistPrompts={state.settings.aiAssistPrompts}
            onAiAssistPromptsChange={(next) => void actions.updateSettings({ aiAssistPrompts: next })}
            generateAiAssist={async ({ prompt, modifiers }) => (await api['prompt:suggest']({ prompt, modifiers })).variants}
          />
        }
      />
      </div>
      <div className="chat-split-divider" role="region" aria-label="Изменение ширины панелей" onPointerDown={resizePreview}><div role="separator" aria-label="Изменить ширину панелей" aria-orientation="vertical" /></div>
      <WebRecorderHost conversationUrl={activeConversation?.previewUrl ?? null} projectUrl={activeProjectPreviewUrl ?? activeConversation?.projectPreviewUrl ?? null} onSave={async (previewUrl) => { if (activeConversation) await actions.setConversationPreviewUrl(activeConversation.id, previewUrl); setPreviewElement(null) }} onSelectElement={setPreviewElement} onRegisterActionRunner={registerPreviewRunner} />
      </div>
      )}

      {/* Проектов нет вообще: редиректу некуда вести — показываем, что делать. */}
      {inProjects && !routeProjectId && firstProjectId === null && <ProjectsEmptyPage />}

      {inProjects && routeProjectId && projectMissing && <ProjectNotFoundPage />}

      {/* Одна страница проекта на все три маршрута: шапка с именем и вкладками
          общая, меняется только содержимое. */}
      {inProjects && routeProjectId && !projectMissing && (
        <ProjectPage
          projectName={routeProjectName}
          section={routeSettings ? 'settings' : 'board'}
          onSectionChange={(section) =>
            navigate(section === 'settings' ? `/projects/${routeProjectId}/settings` : `/projects/${routeProjectId}`)
          }
          onToggleSidebar={() => {
            if (collapsed) setCollapsedPersist(false)
            setSidebarOpen((v) => !v)
          }}
          assistantOpen={assistantOpen || segments[2] === 'assistant'}
          onAssistantOpenChange={(open) => { if (!open && segments[2] === 'assistant') navigate(`/projects/${routeProjectId}`); setKanbanAssistantOpen(open) }}
          onOpenAssistantPage={() => navigate(`/projects/${routeProjectId}/assistant`) }
        >
          {routeSettings ? (
            state.projectDetail?.id === routeProjectId ? (
              <ProjectSettings
                detail={state.projectDetail}
                agents={state.agents}
                llmAccess={state.llmAccess}
                llmEngines={state.llmEngines}
                onUpdate={(id, fields) => void actions.updateProject(id, fields)}
                onDelete={(id) => {
                  // Удалили проект — уводим на другой доступный, а если их не
                  // осталось, в пустое состояние (#/projects без id).
                  const next = state.projects.find((p) => p.id !== id)?.id ?? null
                  void actions.deleteProject(id).then(() => {
                    navigate(next ? `/projects/${next}` : '/projects', { replace: true })
                  })
                }}
                onAddMember={(id, username) => void actions.addProjectMember(id, username)}
                onRemoveMember={(id, username) => void actions.removeProjectMember(id, username)}
                onLinkMachine={(id, agentId) => void actions.linkProjectMachine(id, agentId)}
                onUnlinkMachine={(id, agentId) => void actions.unlinkProjectMachine(id, agentId)}
                onSetMachinePath={(id, agentId, path) => void actions.setProjectMachinePath(id, agentId, path)}
                onSetReposRoot={(id, agentId, root) => void actions.setProjectReposRoot(id, agentId, root)}
                onSetDefaultMachine={(id, agentId) => void actions.setProjectDefaultMachine(id, agentId)}
              />
            ) : (
              <div className="proj-page-state" aria-busy="true">
                <Skeleton variant="list" count={4} item="block" height={64} gap={12} />
              </div>
            )
          ) : (
            <WidgetAssistantFrame
              open={assistantOpen || segments[2] === 'assistant'}
              onOpenChange={(open) => { if (!open && segments[2] === 'assistant') navigate(`/projects/${routeProjectId}`); setKanbanAssistantOpen(open) }}
              mode={segments[2] === 'assistant' ? 'page' : 'embedded'}
              storageKey="voicechat.kanbanAssistantWidth"
              widget={<ProjectBoard
              initialOpenTaskId={routeTaskId}
              projectName={routeProjectName}
              board={state.board}
              loading={state.boardLoading || state.activeProjectId !== routeProjectId}
              error={state.boardError}
              onRetry={() => void actions.openBoard(routeProjectId)}
              showCompleted={state.boardIncludeCompleted}
              onShowCompletedChange={(show) => void actions.setBoardIncludeCompleted(show)}
              showDoneTaskChats={state.showDoneTaskChats}
              onShowDoneTaskChatsChange={(show) => void actions.setShowDoneTaskChats(show)}
              members={state.projectDetail?.members ?? []}
              currentUser={state.currentUser?.name ?? null}
              onCreateColumn={(name) => void actions.createColumn(name)}
              onUpdateColumn={(id, fields) => void actions.updateColumn(id, fields)}
              onSetColumnHidden={(id, hidden) => void actions.setColumnHidden(id, hidden)}
              onReorderColumns={(order) => void actions.reorderColumns(order)}
              onDeleteColumn={(id) => void actions.deleteColumn(id)}
              onCreateTask={(columnId, input) => void actions.createTask(columnId, input)}
              onUpdateTask={(taskId, fields) => void actions.updateTask(taskId, fields)}
              onMoveTask={(taskId, columnId, afterId, beforeId) => void actions.moveTask(taskId, columnId, afterId, beforeId)}
              onDeleteTask={(taskId) => void actions.deleteTask(taskId)}
              onOpenChat={(taskId) => void actions.openTaskChat(taskId).then((id) => navigate(id ? `/chat/${id}` : '/'))}
              onEnsureChat={(taskId) => void actions.ensureTaskChat(taskId)}
              ciSummaries={state.ciSummaries}
              onStartCi={(taskId) => { if (routeProjectId) void actions.startCiRun(routeProjectId, taskId).then((run) => { if (run) actions.openCiRun(run.id) }) }}
              onStartCiParallel={(taskId) => { if (routeProjectId) void actions.startCiRun(routeProjectId, taskId, { launch: 'parallel' }).then((run) => { if (run) actions.openCiRun(run.id) }) }}
              onOpenCiRun={(runId) => actions.openCiRun(runId)}
              onDequeueCiRun={(runId) => void actions.dequeueCiRun(runId)}
              aiAssistPrompts={state.settings.aiAssistPrompts}
              onAiAssistPromptsChange={(next) => void actions.updateSettings({ aiAssistPrompts: next })}
              generateAiAssist={async ({ prompt, modifiers }) => (await api['prompt:suggest']({ prompt, modifiers })).variants}
              onAssistantSelectionChange={handleAssistantSelectionChange}
            />}
              assistant={<KanbanAssistant
                projectId={routeProjectId!}
                context={kanbanAssistantContext}
                api={api}
                llmEngines={state.llmEngines}
                onCommand={async (command: WidgetAssistantCommand) => {
                  rememberWidgetAction('assistant.command', command.type, 'taskId' in command ? command.taskId : undefined)
                  if (command.type === 'navigate.project-settings') { navigate(`/projects/${command.projectId}/settings`); return }
                  if (command.type === 'navigate.task') { navigate(`/projects/${command.projectId}/task/${command.taskId}`); return }
                  if (command.type === 'propose.settings-update') { await actions.updateSettings(command.patch); return }
                  const patch: SupportedTaskPatch = command.type === 'propose.task-update'
                    ? command.patch
                    : command.type === 'propose.acceptance-criteria'
                      ? { acceptanceCriteria: command.value }
                      : { [command.field]: command.value }
                  const { columnId, ...fields } = patch
                  if (columnId) await actions.moveTask(command.taskId, columnId, null, null)
                  if (Object.keys(fields).length > 0) await actions.updateTask(command.taskId, fields)
                }}
              />}
            />
          )}
        </ProjectPage>
      )}

      {utilitySeg === 'kb' && (
        <KnowledgeBase api={api} variant="page" documentId={routeKbDocumentId} onClose={() => navigate('/')} />
      )}

      {/* Объединённый наблюдатель агентов: один компонент с переключателем
          движка Claude/Codex. Движок и открытость выводятся из маршрута
          (/claude-code | /codex) — переключатель просто навигирует между ними. */}
      {(() => {
        const engine: ObserverEngine | null =
          utilitySeg === 'claude-code' ? 'claude' : utilitySeg === 'codex' ? 'codex' : null
        const open = engine === 'claude' ? state.ccOpen : engine === 'codex' ? state.cxOpen : false
        if (!engine || !open) return null
        return (
          <EnginesObserver
            variant="page"
            engine={engine}
            onSwitchEngine={(e) => navigate(e === 'claude' ? '/claude-code' : '/codex')}
            onClose={() => navigate('/')}
            claude={{
              projects: state.ccProjects,
              sessions: state.ccSessions,
              transcript: state.ccTranscript,
              activeProject: state.ccProjectSlug,
              activeSession: state.ccSessionId,
              usage: state.ccUsage,
              onSelectProject: actions.selectCcProject,
              onSelectSession: actions.selectCcSession,
              onResumeSession: (slug, id) =>
                void actions.resumeCcSession(slug, id).then((cid) => navigate(cid ? `/chat/${cid}` : '/'))
            }}
            codex={{
              projects: state.cxProjects,
              sessions: state.cxSessions,
              transcript: state.cxTranscript,
              activeProject: state.cxProjectCwd,
              activeSession: state.cxSessionId,
              usage: state.cxUsage,
              onSelectProject: actions.selectCxProject,
              onSelectSession: actions.selectCxSession,
              onResumeSession: (id) =>
                void actions.resumeCxSession(id).then((cid) => navigate(cid ? `/chat/${cid}` : '/'))
            }}
          />
        )
      })()}

      {utilitySeg === 'machines' && state.machinesOpen && (
        <MachineStatus
          variant="page"
          agents={state.agents}
          status={state.agentsStatus}
          error={state.agentsError}
          onRetry={() => void actions.refreshAgents()}
          onSetPolicy={(id, policy) => void actions.setAgentPolicy(id, policy)}
          onCreateAgent={actions.createAgent}
          onRegenerateToken={actions.regenerateAgentToken}
          onGetConnectionString={actions.getAgentConnectionString}
          onUpdateAgent={actions.updateAgent}
          onDeleteAgent={(id) => void actions.deleteAgent(id)}
          defaultAgentId={state.settings.defaultAgentId}
          onSetDefault={(id) => void actions.updateSettings({ defaultAgentId: id })}
          onClose={() => navigate('/')}
        />
      )}

      {utilitySeg === 'users' && state.usersOpen && (
        <UsersAdmin
          variant="page"
          users={state.adminUsers}
          usageSummary={state.adminUsageSummary}
          isAdmin={state.currentUser?.role === 'admin'}
          status={state.adminUsersStatus}
          error={state.adminUsersError}
          onRetry={() => void actions.openUsers()}
          selected={routeUserName ?? state.adminSelected}
          usage={state.adminUsage}
          conversations={state.adminConversations}
          messages={state.adminMessages}
          conversationId={state.adminConversationId}
          currentUserName={state.currentUser?.name ?? ''}
          onSelect={(name) => { navigate(`/users/${encodeURIComponent(name)}`); void actions.selectAdminUser(name) }}
          onCreate={(name, password, role) => void actions.createUserAccount(name, password, role)}
          onSetBlocked={(name, blocked) => void actions.setUserBlocked(name, blocked)}
          onDelete={(name) => void actions.deleteUserAccount(name)}
          onLoadUsage={(unit, from, to, conversationId) => void actions.loadAdminUsage(unit, from, to, conversationId)}
          onOpenConversation={(id) => void actions.openAdminConversation(id)}
          llmAccess={state.adminUserLlmAccess}
          onSaveLlmAccess={(access) => void actions.saveAdminUserLlmAccess(access)}
          engines={state.adminLlmEngines}
          enginesStatus={state.adminLlmEnginesStatus}
          enginesError={state.adminLlmEnginesError}
          engineHealth={state.adminLlmEngineHealth}
          onRetryEngines={() => void actions.refreshAdminLlmEngines()}
          onCreateEngine={(input) => void actions.createAdminLlmEngine(input)}
          onUpdateEngine={(id, patch) => void actions.updateAdminLlmEngine(id, patch)}
          onDeleteEngine={(id) => void actions.deleteAdminLlmEngine(id)}
          onCheckEngineHealth={(id) => void actions.checkAdminLlmEngineHealth(id)}
          modelPrices={state.adminModelPrices}
          onSaveModelPrice={(input) => void actions.saveAdminModelPrice(input)}
          onDeleteModelPrice={(provider, model) => void actions.deleteAdminModelPrice(provider, model)}
          onClose={() => navigate('/')}
        />
      )}

      {utilitySeg === 'ci' && state.ciOpen && (
        <CiCommands
          commands={state.ciCommands}
          status={state.ciStatus}
          error={state.ciError}
          onRetry={() => void actions.openCi()}
          settings={state.ciSettings}
          suggestions={state.ciSuggestions}
          workspaces={state.ciWorkspaces}
          role={state.currentUser?.role ?? 'admin'}
          llmAccess={state.llmAccess}
          projects={state.projects.map((p) => ({ id: p.id, name: p.name }))}
          onCreate={(input) => actions.createCiCommand(input)}
          onUpdate={(id, input) => actions.updateCiCommand(id, input)}
          onDelete={(id) => actions.deleteCiCommand(id)}
          onUsage={(id) => actions.ciCommandUsage(id)}
          onSaveSettings={(next) => actions.saveCiSettings(next)}
          onResolveSuggestion={(id, accept) => actions.resolveCiSuggestion(id, accept)}
          onClose={() => navigate('/')}
        />
      )}

      {taskProposal && inChat && routeChatId === state.activeId && (
        <Dialog
          title="Как начать разработку?"
          ariaLabel="Настройки задачи разработки"
          size="sm"
          onClose={() => { if (!taskLaunchPending) setTaskProposal(null) }}
          closeOnOverlay={!taskLaunchPending}
          className="task-launch-dialog"
          footer={<>
            <Button variant="secondary" onClick={() => void chooseTaskLaunch('todo')} loading={taskLaunchPending} disabled={!taskProposal.title.trim()}>Создать в TODO</Button>
            <Button variant="primary" onClick={() => void chooseTaskLaunch('in-progress')} loading={taskLaunchPending} disabled={!taskProposal.title.trim()}>Создать в InProgress</Button>
            <Button variant="secondary" onClick={() => void chooseTaskLaunch('chat')} loading={taskLaunchPending}>Работать в текущем чате</Button>
          </>}
        >
          <p className="task-launch-intro">Ассистент подготовил задачу. Выберите, где начать работу.</p>
          <div className="task-launch-fields">
            <label>Название
              <input value={taskProposal.title} onChange={(event) => setTaskProposal({ ...taskProposal, title: event.target.value })} />
            </label>
            <label>Описание
              <textarea value={taskProposal.description} rows={4} onChange={(event) => setTaskProposal({ ...taskProposal, description: event.target.value })} />
            </label>
            <label>Критерии приёмки
              <textarea value={taskProposal.acceptanceCriteria} rows={4} onChange={(event) => setTaskProposal({ ...taskProposal, acceptanceCriteria: event.target.value })} />
            </label>
            <label>Движок
              <select value={taskProposal.provider} onChange={(event) => {
                const provider = event.target.value as LlmProvider
                setTaskProposal({ ...taskProposal, provider, model: provider === 'codex' ? CODEX_MODELS[0].id : CLAUDE_MODELS[0].id })
              }}>
                {allowedProviders.includes('claude') && <option value="claude">Claude</option>}
                {allowedProviders.includes('codex') && <option value="codex">Codex</option>}
                {allowedProviders.length === 0 && <option value="">Нет доступных движков</option>}
              </select>
            </label>
            <label>Модель
              <select value={taskProposal.model} onChange={(event) => setTaskProposal({ ...taskProposal, model: event.target.value })}>
                {!proposalModels.some((model) => model.id === taskProposal.model) && <option value={taskProposal.model}>{taskProposal.model || 'По умолчанию'}</option>}
                {proposalModels.length === 0 && <option value="">Нет доступных моделей</option>}
                {proposalModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
              </select>
            </label>
            <label>Очередь
              <input value="FIFO" readOnly />
            </label>
            <label>Приоритет
              <select value={taskProposal.priority} onChange={(event) => setTaskProposal({ ...taskProposal, priority: event.target.value as TaskPriority })}>
                <option value="low">Низкий</option>
                <option value="medium">Средний</option>
                <option value="high">Высокий</option>
                <option value="urgent">Срочный</option>
              </select>
            </label>
            <label>Слияние
              <input value="Влить в main" readOnly />
            </label>
            <label>Ответственный
              <input value={taskProposal.assignee ?? ''} onChange={(event) => setTaskProposal({ ...taskProposal, assignee: event.target.value || null })} />
            </label>
          </div>
        </Dialog>
      )}

      {conversationSettingsOpen && activeConversation && (
        <ConversationSettings
          conversation={activeConversation}
          agents={state.agents}
          machineOps={machineOps}
          role={state.currentUser?.role ?? 'admin'}
          settings={state.settings}
          engines={state.llmEngines}
          llmAccess={state.llmAccess}
          defaultAgentId={state.settings.defaultAgentId}
          projects={state.projects}
          fetchProjectDetail={actions.fetchProjectDetail}
          onSave={async ({ title, execTarget, workdir, skillNames, llmEngineId, llmProvider, llmModel, permissionMode, kbContextMode, projectId }) => {
            await actions.renameConversation(activeConversation.id, title)
            await actions.setConversationProject(activeConversation.id, projectId)
            await actions.setConversationExecTarget(activeConversation.id, execTarget, workdir, skillNames, llmProvider, llmModel, permissionMode, kbContextMode, llmEngineId)
          }}
          onAddSkill={async (agentId, skill) => {
            const agent = state.agents.find((item) => item.id === agentId)
            if (!agent) return
            await actions.setAgentPolicy(agentId, { ...agent.policy, skills: [...agent.policy.skills, skill] })
          }}
          onClose={() => setConversationSettingsOpen(false)}
        />
      )}

      {showConsole && (
        <ConsolePanel
          log={state.consoleLog}
          open={state.consoleOpen}
          onToggle={actions.toggleConsole}
        />
      )}


      {state.utility && machineOps && (
        <MachineUtility
          tool={{
            kind: state.utility.kind,
            ...(state.utility.agentId ? { agentId: state.utility.agentId } : {}),
            ...(state.utility.path ? { path: state.utility.path } : {}),
            ...(state.utility.dir ? { dir: true } : {})
          }}
          agents={state.agents}
          ops={machineOps}
          consoleHistory={consoleHistory}
          variant="modal"
          onSwitchUtility={(kind, agentId, dir) => actions.openUtility(kind, agentId, dir, kind === 'explorer')}
          // Раздел «Машины» — страница контентной колонки, поэтому окно утилиты
          // закрываем: иначе оно осталось бы висеть поверх неё.
          onOpenMachines={
            state.authRequired
              ? () => {
                  actions.closeUtility()
                  navigate('/machines')
                }
              : undefined
          }
          onClose={actions.closeUtility}
        />
      )}

      {state.kbUsageOpen && state.activeId && (
        <KbUsagePanel
          conversationId={state.activeId}
          projectId={activeConversation?.projectId ?? null}
          cache={activeKbUsage}
          projectCache={activeConversation?.projectId ? state.kbUsageByProject[activeConversation.projectId] : undefined}
          kbStatus={state.kbStatus}
          mode={activeConversation?.kbContextMode ?? 'auto'}
          onLoad={(id) => { void actions.loadKbUsage(id); void actions.refreshKbStatus() }}
          onLoadProject={(id) => void actions.loadProjectKbUsage(id)}
          onClose={actions.closeKbUsage}
          onOpenDocument={(documentId) => { actions.closeKbUsage(); navigate(`/kb/${encodeURIComponent(documentId)}`) }}
          onOpenKnowledgeBase={() => { actions.closeKbUsage(); navigate('/kb') }}
          onOpenConversationSettings={() => { actions.closeKbUsage(); setConversationSettingsOpen(true) }}
          titleOf={(id) => state.conversations.find((c) => c.id === id)?.title}
          onOpenRun={(runId) => { actions.closeKbUsage(); actions.openCiRun(runId) }}
        />
      )}

      {state.ciActiveRunId && (
        <ToolFrame title="Лента CI-рана" variant="modal" testId="ci-run-modal" onClose={actions.closeCiRun}>
          <div style={{ padding: '12px', overflow: 'auto' }}>
            <RunFeed
              runId={state.ciActiveRunId}
              cache={state.ciRuns[state.ciActiveRunId]}
              llmAccess={state.llmAccess}
              onSubscribe={actions.ciSubscribe}
              onUnsubscribe={actions.ciUnsubscribe}
              onLoad={(runId) => void actions.loadCiRun(runId)}
              onRetry={(runId) => void actions.retryCiRun(runId).then((run) => { if (run) actions.openCiRun(run.id) })}
              onRetryFromStep={(runId, selection) => { void actions.retryCiRunFromStep(runId, selection); actions.openCiRun(runId) }}
              onDiscardAndRetry={(runId) => void actions.discardCiWorkspaceAndRetry(runId).then((run) => { if (run) actions.openCiRun(run.id) })}
              onCancel={(runId) => void actions.cancelCiRun(runId)}
              onAnswerInteraction={(runId, interactionId, answer) => void actions.answerCiInteraction(runId, interactionId, answer)}
            />
          </div>
        </ToolFrame>
      )}

      {!state.settings.onboarded && (
        <OnboardingModal
          modelPresent={state.modelPresent}
          modelLabel={state.settings.whisperModel}
          downloading={state.downloading}
          downloadPercent={state.downloadPercent}
          onDownloadModel={actions.downloadModel}
          hasVoice={state.ttsVoices.length > 0}
          onDone={actions.completeOnboarding}
        />
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <HotkeysCheatSheet open={cheatSheetOpen} onClose={() => setCheatSheetOpen(false)} />

      {state.settingsOpen && (
        <SettingsModal
          settings={state.settings}
          engines={state.llmEngines}
          mics={state.mics}
          voices={state.ttsVoices}
          voiceCatalog={state.voiceCatalog}
          voicesDownloadable={state.voicesDownloadable}
          voiceDownloads={state.voiceDownloads}
          whisperModels={state.whisperModels}
          capabilities={state.capabilities}
          mcpServers={state.mcpServers}
          loginStatus={state.loginStatus}
          onDownloadDesktopApp={() => void actions.downloadDesktopApp()}
          onDownloadAgentApp={() => void actions.downloadAgentApp()}
          onDownloadAgentScript={() => void actions.downloadAgentScript()}
          onChange={actions.updateSettings}
          onDownloadVoice={actions.downloadVoice}
          onDeleteVoice={actions.deleteVoice}
          onDeleteModel={actions.deleteModel}
          role={state.currentUser?.role ?? 'admin'}
          llmAccess={state.llmAccess}
          voiceInputEnabled={VOICE_INPUT_ENABLED}
          onClose={actions.closeSettings}
        />
      )}
    </div>
  )
}
