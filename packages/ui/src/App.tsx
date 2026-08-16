import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { parseProjectsRoute } from '@voicechat/projects-app'
import type { RendererApi } from '@shared/ipc'
import type { LlmProvider, PermissionMode, TaskLaunchProposal } from '@shared/types'
import { allowedModels, isProviderAllowed } from '@shared/llmAccess'
import type { Board, Task } from '@shared/projects'
import type { KanbanAssistantSelection, SupportedTaskPatch, WidgetAssistantCommand, WidgetAssistantContext, WidgetUserAction } from '@shared/widgetAssistant'
import type { HealthResponse } from '@shared/protocol'
import { PREVIEW_INSPECTOR_COMMAND_TYPE, isPreviewElementMessage, isPreviewInspectorCommand, type PreviewElementPayload } from '@shared/previewInspector'
import { PREVIEW_ACTION_COMMAND_TYPE, isPreviewActionResultMessage, type PreviewAction, type PreviewActionResult } from '@shared/previewActions'
import { WEB_RECORDER_MESSAGE_TYPE, type WebRecorderClientMessage } from '@shared/webRecorder'
import { Sidebar } from './components/Sidebar'
import { ChatColumn } from './components/ChatColumn'
import { TaskChatHeader } from './components/chat/TaskChatHeader'
import { VoiceBar } from './components/VoiceBar'
import { VOICE_INPUT_ENABLED } from './lib/featureFlags'
import { CHAT_COMPOSER_QUERY, useMediaQuery } from './lib/mediaQuery'
import { SettingsModal } from './components/SettingsModal'
import { ConsolePanel } from './components/ConsolePanel'
import { OnboardingModal } from './components/OnboardingModal'
import { LoginScreen } from './components/LoginScreen'
import { EnginesObserver, type ObserverEngine } from './components/EnginesObserver'
import { UsersAdmin } from './components/UsersAdmin'
import { ProjectSettings } from './components/ProjectSettings'
import { PersonalizationPage } from './components/SettingsPage'
import { ProjectBoard } from './components/ProjectBoard'
import { TaskModal, type TaskUpdateFields } from './components/kanban/TaskModal'
import { ProjectPage, ProjectsEmptyPage, ProjectNotFoundPage } from './components/ProjectPage'
import { ReleaseCenter } from './components/releases/ReleaseCenter'
import { WidgetAssistantFrame } from './components/WidgetAssistantFrame'
import { KanbanAssistant, ProjectAssistantChatSelector } from './components/KanbanAssistant'
import { MachineStatus } from './components/MachineStatus'
import { MachineUtility } from './components/MachineUtility'
import { CiCommands } from './components/ci/CiCommands'
import { RunFeed } from './components/ci/RunFeed'
import { ToolFrame } from './components/ToolFrame'
import type { ConsoleHistoryStore, MachineOps } from './components/machine'
import { ConversationSettings } from './components/ConversationSettings'
import { UiProviders } from '@voicechat/ui-kit'
import { Button } from '@voicechat/ui-kit'
import { Skeleton } from '@voicechat/ui-kit'
import { useToast } from '@voicechat/ui-kit'
import { useConfirm } from '@voicechat/ui-kit'
import { KnowledgeBase } from './components/KnowledgeBase'
import { KbUsagePanel } from './components/kb/KbUsagePanel'
import { hasPendingKbUsage } from './lib/kbUsage'
import { CommandPalette } from './components/CommandPalette'
import { HotkeysCheatSheet } from './components/HotkeysCheatSheet'
import {
  AppRuntimeProvider,
  useAdmin,
  useAdminActions,
  useAppRuntime,
  useChat,
  useChatActions,
  useCreateAppRuntime,
  useOperations,
  useOperationsActions,
  useProjects,
  useProjectsActions,
  useSession,
  useSettings,
  useSettingsActions,
  useShell,
  useShellActions,
  useVoice,
  useVoiceActions
} from './store/react'
import type { PipelineDelays } from './store/mockPipeline'
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
  delays?: Partial<PipelineDelays>
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
const UTILITY_PAGES: readonly string[] = ['claude-code', 'codex', 'machines', 'kb', 'users', 'ci', 'personalization']

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
export type PreviewActionRunner = (action: PreviewAction) => Promise<PreviewActionOutcome>

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
  return <section className="webpreview" aria-label="Web Reader">
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

/** Открывает независимое рабочее пространство, не меняя маршрут исходного чата. */
export function openWebReaderWorkspace(): void {
  const url = new URL(window.location.href)
  url.hash = '#/web-reader'
  window.open(url.toString(), '_blank', 'noopener,noreferrer')
}

/**
 * Host-side integration only. The recorder is a separately built application;
 * ChatAI communicates exclusively through @shared/webRecorder postMessage events.
 */
export function WebReaderHost({ conversationUrl, projectUrl, onSave, onSelectElement, onRegisterActionRunner }: PreviewPaneProps): JSX.Element {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const shellReady = useRef(false)
  const pageStatus = useRef<'empty' | 'loading' | 'ready' | 'error'>('empty')
  const pageError = useRef<string>()
  const pending = useRef(new Map<string, { action: PreviewAction; sent: boolean; timer: ReturnType<typeof setTimeout>; resolve: (outcome: PreviewActionOutcome) => void }>())
  const url = conversationUrl ?? projectUrl
  const send = (message: object): void => frameRef.current?.contentWindow?.postMessage({ type: WEB_RECORDER_MESSAGE_TYPE, ...message }, '*')
  const settle = (requestId: string, outcome: PreviewActionOutcome): void => {
    const entry = pending.current.get(requestId)
    if (!entry) return
    clearTimeout(entry.timer)
    pending.current.delete(requestId)
    entry.resolve(outcome)
  }
  const flush = (): void => {
    if (!shellReady.current || pageStatus.current !== 'ready') return
    for (const [requestId, entry] of pending.current) {
      if (entry.sent) continue
      if (entry.action.kind === 'open') { settle(requestId, { ok: true, result: { url: entry.action.url } }); continue }
      entry.sent = true
      send({ kind: 'run-action', requestId, action: entry.action })
    }
  }
  useEffect(() => { pageStatus.current = url ? 'loading' : 'empty'; pageError.current = undefined; send({ kind: 'set-url', url }) }, [url])
  useEffect(() => {
    const receive = (event: MessageEvent): void => {
      if (event.source !== frameRef.current?.contentWindow || event.data?.type !== WEB_RECORDER_MESSAGE_TYPE) return
      const message = event.data as WebRecorderClientMessage
      if (message.kind === 'ready') { shellReady.current = true; send({ kind: 'set-url', url }); return }
      if (message.kind === 'page-status') {
        pageStatus.current = message.status
        pageError.current = message.error
        if (message.status === 'ready') flush()
        if (message.status === 'error') for (const requestId of [...pending.current.keys()]) settle(requestId, { ok: false, error: 'Сайт или страница недоступны: ' + (message.error ?? 'ошибка загрузки.') })
        return
      }
      if (message.kind === 'save-url') { void onSave(message.url); return }
      if (message.kind === 'element') { onSelectElement?.(message.element); return }
      if (message.kind === 'action-result') settle(message.requestId, message.ok ? { ok: true, ...(message.result ? { result: message.result } : {}) } : { ok: false, error: message.error ?? 'Действие в превью не выполнено.' })
    }
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive)
  }, [onSave, onSelectElement, url])
  useEffect(() => {
    if (!onRegisterActionRunner) return
    onRegisterActionRunner((action) => {
      if (!shellReady.current) return Promise.resolve({ ok: false, error: 'Панель Web Reader не открыта или ещё не подключена.' })
      if (action.kind === 'open') { pageStatus.current = 'loading'; pageError.current = undefined }
      if (pageStatus.current === 'empty' && action.kind !== 'open') return Promise.resolve({ ok: false, error: 'Панель открыта, но в ней нет страницы — сначала вызови open.' })
      if (pageStatus.current === 'error' && action.kind !== 'open') return Promise.resolve({ ok: false, error: 'Сайт или страница недоступны: ' + (pageError.current ?? 'ошибка загрузки.') })
      return new Promise((resolve) => {
        const requestId = 'wr-' + crypto.randomUUID()
        const timer = setTimeout(() => settle(requestId, {
          ok: false,
          error: pageStatus.current === 'loading'
            ? 'Страница всё ещё загружается и не стала готова за время ожидания.'
            : 'Клиентский мост Web Reader не ответил на команду при открытой панели.'
        }), PREVIEW_ACTION_UI_TIMEOUT_MS)
        pending.current.set(requestId, { action, sent: false, timer, resolve })
        flush()
      })
    })
    return () => {
      onRegisterActionRunner(null)
      for (const requestId of [...pending.current.keys()]) settle(requestId, { ok: false, error: 'Панель Web Reader закрыта.' })
      shellReady.current = false
    }
  }, [onRegisterActionRunner])
  return <section className="webpreview" aria-label="Web Reader"><iframe ref={frameRef} className="webpreview-frame" src="/web-recorder/" title="Web Reader" aria-hidden="true" /></section>
}

/**
 * Корень приложения. Тосты и подтверждения — провайдеры вокруг всего дерева:
 * спросить подтверждение или показать ошибку может любой экран на любой глубине.
 * avoidSelector — композер: на телефоне стек тостов стоит над ним, а не поверх.
 */
export default function App(props: AppProps = {}): JSX.Element {
  return (
    <UiProviders avoidSelector=".voicebar">
      <AppRuntimeHost {...props} />
    </UiProviders>
  )
}

/** Чат из адреса на момент монтирования: его bootstrap откроет первым. */
function initialChatIdFromPath(path: string, segments: string[]): string | null {
  if (segments[0] === 'chat') return segments[1] ?? null
  if (segments[0] === 'web-reader' || segments[0] === 'web-recorder' || segments[0] === 'playwright-reader') {
    return segments[1] ?? null
  }
  const route = parseProjectsRoute(path)
  return route?.kind === 'task-chat' ? route.conversationId : null
}

/**
 * Композиционный корень состояния: создаёт AppRuntime (он владеет доменными
 * хранилищами и координирует их) и отдаёт его дереву. Универсального хука со
 * всеми доменами сразу нет — экраны подписываются на свой домен.
 */
function AppRuntimeHost({ api = window.api, now, delays }: AppProps = {}): JSX.Element {
  const { path, segments } = useHashRoute()
  const initialChatId = useRef(initialChatIdFromPath(path, segments))
  const runtime = useCreateAppRuntime({
    api,
    ...(now ? { now } : {}),
    ...(delays ? { delays } : {}),
    initialChatId: initialChatId.current
  })
  return (
    <AppRuntimeProvider runtime={runtime}>
      <AppBody api={api} {...(now ? { now } : {})} />
    </AppRuntimeProvider>
  )
}

function AppBody({ api = window.api, now }: AppProps = {}): JSX.Element {
  // Hash-роутинг: URL — источник навигации (см. useHashRoute).
  const { path, segments, navigate } = useHashRoute()
  const projectsRoute = parseProjectsRoute(path)
  const inProjects = projectsRoute !== null
  const routeProjectId = projectsRoute && projectsRoute.kind !== 'index' ? projectsRoute.projectId : null
  const routeSettings = projectsRoute?.kind === 'settings'
  const routeReleases = projectsRoute?.kind === 'releases'
  // Проектный parser владеет deep links карточки, подготовки и связанного чата.
  const routeTaskId = projectsRoute && 'taskId' in projectsRoute ? projectsRoute.taskId : null
  const routeTaskChatId = projectsRoute?.kind === 'task-chat' ? projectsRoute.conversationId : null
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
  const routeChatId = segments[0] === 'chat' ? (segments[1] ?? null) : routeTaskChatId
  const legacyReaderRoute = segments[0] === 'web-recorder'
  const inReader = segments[0] === 'web-reader' || legacyReaderRoute
  const routeReaderChatId = inReader ? (segments[1] ?? null) : null
  const inPlaywrightReader = segments[0] === 'playwright-reader'
  const routePlaywrightReaderChatId = inPlaywrightReader ? (segments[1] ?? null) : null
  const inTaskChat = routeTaskChatId !== null
  const inChat = (!inProjects && !onUtilityPage && !inReader && !inPlaywrightReader) || inTaskChat
  const compactChat = useMediaQuery(CHAT_COMPOSER_QUERY)
  // Каждый домен — своя подписка: обновление аудио или админских данных не
  // тянет за собой перерисовку соседних экранов.
  const runtime = useAppRuntime()
  const shell = useShell((s) => s)
  const session = useSession((s) => s)
  const settingsState = useSettings((s) => s)
  const chat = useChat((s) => s)
  const voice = useVoice((s) => s)
  const operations = useOperations((s) => s)
  const admin = useAdmin((s) => s)
  const projects = useProjects((s) => s)
  const shellActions = useShellActions()
  const settingsActions = useSettingsActions()
  const chatActions = useChatActions()
  const voiceActions = useVoiceActions()
  const operationsActions = useOperationsActions()
  const adminActions = useAdminActions()
  const projectsActions = useProjectsActions()
  const [release, setRelease] = useState<HealthResponse | null>(null)
  const [chatView, setChatView] = useState<'chat' | 'preview'>('chat')
  const [previewElement, setPreviewElement] = useState<PreviewElementPayload | null>(null)
  const [activeProjectPreviewUrl, setActiveProjectPreviewUrl] = useState<string | null>(null)
  const [assistantOpen, setAssistantOpen] = useState(() => globalThis.localStorage?.getItem('voicechat.kanbanAssistantOpen') === '1')
  const [assistantConversationId, setAssistantConversationId] = useState<string | null>(null)
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
  useEffect(() => { setPreviewElement(null) }, [chat.activeId])
  // Действия модели в превью (mcp__browser__*): регистрация хранит не только
  // runner, но и чат панели. Это не даёт переключившемуся чату обратиться к host,
  // который ещё размонтируется, и делает Reader-маршруты единым источником истины.
  const previewRunnerRef = useRef<{ conversationId: string; runner: PreviewActionRunner } | null>(null)
  const registerPreviewRunner = useCallback((runner: PreviewActionRunner | null) => {
    if (runner && chat.activeId) previewRunnerRef.current = { conversationId: chat.activeId, runner }
    else if (!runner && previewRunnerRef.current?.conversationId === chat.activeId) previewRunnerRef.current = null
  }, [chat.activeId])
  useEffect(() => {
    const bridge = window.preview
    if (!bridge) return
    return bridge.onAction(({ conversationId, requestId, action }) => {
      void (async (): Promise<PreviewActionOutcome> => {
        // Действия ограничены активной Reader-страницей и host-ом того же чата.
        if (chat.activeId !== conversationId || (!inReader && !inPlaywrightReader)) {
          return { ok: false, error: 'Этот чат сейчас не открыт на странице Reader — панель превью недоступна.' }
        }
        const registration = previewRunnerRef.current
        if (!registration || registration.conversationId !== conversationId) {
          return { ok: false, error: 'Панель превью активного чата не открыта или ещё не подключена.' }
        }
        if (action.kind === 'open') {
          try {
            await chatActions.setConversationPreviewUrl(conversationId, action.url)
            setPreviewElement(null)
            return registration.runner(action)
          } catch {
            return { ok: false, error: 'Не удалось сохранить адрес превью.' }
          }
        }
        return registration.runner(action)
      })().then((outcome) => bridge.result({ requestId, ...outcome }))
    })
  }, [chat.activeId, chatActions, inReader, inPlaywrightReader])
  useEffect(() => {
    let alive = true
    const projectId = chat.conversations.find((conversation) => conversation.id === chat.activeId)?.projectId
    if (!projectId) { setActiveProjectPreviewUrl(null); return }
    void api['projects:get']({ id: projectId }).then((project) => { if (alive) setActiveProjectPreviewUrl(project?.previewUrl ?? null) })
    return () => { alive = false }
  }, [api, chat.activeId, chat.conversations])
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
  const authed = !session.authRequired || Boolean(session.currentUser)
  // Состояние оболочки живёт в shellStore: выдвижной сайдбар на телефоне и
  // свёрнутый на десктопе (персист под прежним ключом `vc:sidebarCollapsed`).
  const sidebarOpen = shell.sidebarOpen
  const collapsed = shell.sidebarCollapsed
  const setSidebarOpen = shellActions.setSidebarOpen
  // Любой переход закрывает выдвижной сайдбар: он рисуется поверх контента, и
  // забытая открытой панель закрывала собой открытую страницу или карточку
  // (напр. переход «Открыть задачу» из шапки связанного чата).
  useEffect(() => { setSidebarOpen(false) }, [path, setSidebarOpen])
  const sidebarExpanded = compactChat ? sidebarOpen : !collapsed
  const focusSidebarToggle = (): void => {
    document.querySelector<HTMLButtonElement>('.sidebar-toggle')?.focus()
  }
  const closeMobileSidebar = (restoreFocus = true): void => {
    setSidebarOpen(false)
    if (restoreFocus) focusSidebarToggle()
  }
  const toggleSidebar = (): void => {
    if (compactChat) setSidebarOpen(!sidebarOpen)
    else shellActions.setSidebarCollapsed(!collapsed)
  }
  useEffect(() => {
    if (!compactChat || !sidebarOpen) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeMobileSidebar()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [compactChat, sidebarOpen])
  const [conversationSettingsOpen, setConversationSettingsOpen] = useState(false)
  const [taskProposal, setTaskProposal] = useState<{
    projectId: string
    messageId: string
    proposalId: string
    board: Board
    projectName: string
    task: Task
    provider: LlmProvider
    model: string
  } | null>(null)
  const [taskLaunchPending, setTaskLaunchPending] = useState(false)
  // Режим списка сайдбара: маршрут ведёт его автоматически, ручной выбор
  // (переключатель) живёт до следующей смены маршрута.
  const [sidebarMode, setSidebarMode] = useState<'chats' | 'projects'>('chats')
  useEffect(() => { setSidebarMode(inProjects ? 'projects' : 'chats') }, [inProjects])
  useVoiceCues(voice.voice) // звуковые сигналы: старт/стоп записи, «думает»

  // Канал уведомлений стора → тосты. Показанные сразу снимаем из очереди, а
  // отданные id помним: без этого повторный прогон эффекта (StrictMode) показал
  // бы каждое уведомление дважды.
  const shownNotices = useRef(new Set<string>())
  useEffect(() => {
    for (const notice of shell.notices) {
      if (!shownNotices.current.has(notice.id)) {
        shownNotices.current.add(notice.id)
        toast[notice.kind](notice.text, notice.retry ? { action: { label: 'Повторить', onClick: notice.retry } } : undefined)
      }
      shellActions.dismissNotice(notice.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell.notices])

  // Тема дублируется на <html>: модальные окна уходят порталом в document.body,
  // вне .app, и без этого теряли бы токены [data-theme='dark'].
  useEffect(() => {
    document.documentElement.dataset.theme = settingsState.settings.theme
  }, [settingsState.settings.theme])

  // Командная палитра (⌘K) и шпаргалка (?) — окна поверх всего остального.
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [cheatSheetOpen, setCheatSheetOpen] = useState(false)

  const stopOrCancel = (): void => {
    const v = voice.voice
    if (v === 'thinking' || v === 'speaking') chatActions.cancelRequest()
    else if (v === 'listening') voiceActions.stopVoice()
  }

  // Горячие клавиши: пробел (hold) — запись, Esc — стоп/отмена по состоянию,
  // плюс биндинги палитры и шпаргалки. `enabled` гасит только голосовые клавиши
  // (модал настроек — свои поля и фокус); у остальных биндингов свой `enabled`.
  const hotkeyBindings: HotkeyBinding[] = buildHotkeyBindings({
    onboarded: settingsState.settings.onboarded,
    voice: voice.voice,
    togglePalette: () => setPaletteOpen((v) => !v),
    openCheatSheet: () => setCheatSheetOpen(true)
  })

  useHotkeys({
    enabled: !shell.settingsOpen && settingsState.settings.onboarded,
    onPushStart: voiceActions.startVoice,
    onPushEnd: voiceActions.stopVoice,
    onEscape: stopOrCancel,
    bindings: hotkeyBindings
  })

  // Команды уровня приложения в общем реестре (lib/commands.ts): базовый набор
  // плюс пункты по данным — беседы, проекты, задачи открытой доски, машины.
  // Экранные команды регистрируют сами экраны (канбан, лента CI-рана).
  // Источник — функция: она вызывается в момент сборки списка, поэтому видит
  // свежее состояние стора, а не то, что было на момент регистрации.
  const boardProjectName =
    projects.projectDetail?.id === projects.activeProjectId
      ? projects.projectDetail.name
      : projects.projects.find((p) => p.id === projects.activeProjectId)?.name ?? null
  // Куда ведёт вход в раздел «Проекты» и удаление текущего проекта.
  const firstProjectId = projects.projects[0]?.id ?? null
  const routeProjectName =
    (projects.projectDetail?.id === routeProjectId ? projects.projectDetail!.name : null) ??
    projects.projects.find((p) => p.id === routeProjectId)?.name ??
    'Проект'
  const kanbanAssistantContext = useMemo<WidgetAssistantContext<KanbanAssistantSelection>>(() => {
    const project = projects.projects.find((item) => item.id === routeProjectId) ?? null
    const board = projects.activeProjectId === routeProjectId ? projects.board : null
    const openTask = board?.tasks.find((task) => task.id === assistantTaskId) ?? null
    return {
      version: 1,
      widget: { kind: 'kanban', instanceId: routeProjectId ?? 'none', title: routeProjectName },
      project: project ? { id: project.id, name: project.name, description: project.description, technologies: project.technologies, skills: project.skills } : null,
      selection: board && routeProjectId ? { board: { projectId: routeProjectId, columns: board.columns, tasks: board.tasks, revision: String(Math.max(0, ...board.tasks.map((task) => task.updatedAt)) ) }, openTask, selectedField: assistantField } : null,
      recentActions: widgetActions
    }
  }, [projects.projects, projects.board, projects.activeProjectId, routeProjectId, routeProjectName, assistantTaskId, assistantField, widgetActions])
  // Список загружен, а проекта из адреса в нём нет: удалён или нет доступа.
  const projectMissing =
    routeProjectId !== null && projects.projectsLoaded && !projects.projects.some((p) => p.id === routeProjectId)
  useCommandSource(() =>
    buildAppCommands({
      voiceEnabled: VOICE_INPUT_ENABLED,
      voice: voice.voice,
      autoSpeak: settingsState.settings.autoSpeak,
      theme: settingsState.settings.theme,
      web: session.authRequired,
      paletteOpen,
      boardProjectId: projects.activeProjectId ?? projects.projects[0]?.id ?? null,
      chats: chat.conversations,
      projects: projects.projects,
      tasks: projects.board?.tasks ?? [],
      taskProject:
        projects.activeProjectId && boardProjectName
          ? { id: projects.activeProjectId, name: boardProjectName }
          : null,
      machines: session.authRequired ? operations.agents : [],
      newChat: () => void chatActions.newConversation().then((id) => navigate(id ? `/chat/${id}` : '/')),
      toggleMic: () => (voice.voice === 'listening' ? voiceActions.stopVoice() : voiceActions.startVoice()),
      stopOrCancel,
      toggleAutoSpeak: () => void settingsActions.updateSettings({ autoSpeak: !settingsState.settings.autoSpeak }),
      toggleTheme: () => void settingsActions.updateSettings({ theme: settingsState.settings.theme === 'dark' ? 'light' : 'dark' }),
      openSettings: shellActions.openSettings,
      openBoard: (projectId) => navigate(`/projects/${projectId}`),
      openMachineConsole: (agentId) =>
        agentId ? operationsActions.openUtility('console', agentId) : operationsActions.openUtilityForActiveChat('console'),
      openKnowledgeBase: () => navigate('/kb'),
      openKbUsage: runtime.openKbUsage,
      logout: () => void runtime.logout(),
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
  const syncedChatId = useRef<string | null>(routeChatId ?? routeReaderChatId ?? routePlaywrightReaderChatId)
  useEffect(() => {
    if (!authed || !inChat) return
    if (routeChatId && routeChatId !== syncedChatId.current) {
      syncedChatId.current = routeChatId
      if (routeChatId === chat.activeId) return // стор уже открыл этот чат
      const fallback = chat.activeId
      void chatActions.selectConversation(routeChatId).then((ok) => {
        if (ok || syncedChatId.current !== routeChatId) return
        // Чата нет (удалён или чужой) — возвращаемся к прежнему.
        syncedChatId.current = fallback
        if (fallback) {
          void chatActions.selectConversation(fallback)
          navigate(`/chat/${fallback}`, { replace: true })
        } else {
          navigate('/', { replace: true })
        }
      })
      return
    }
    if (chat.activeId && (routeChatId === null || chat.activeId !== syncedChatId.current)) {
      syncedChatId.current = chat.activeId
      navigate(`/chat/${chat.activeId}`, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, inChat, routeChatId, chat.activeId])

  // Отдельный экран Web Reader держит только типизированные чаты; старые
  // разговоры с сохранённым URL совместимы с ним и остаются доступны после переноса.
  // ID обычного чата в адресе не должен превращать Reader во второй экран чата.
  // Список — chat.readerConversations (полный ответ conversations:list): фильтр
  // проекта в сайдбаре обычного чата не должен ни сжимать его, ни зациклить
  // создание, когда только что созданный чат не попал бы в срез проекта.
  const readerCreating = useRef(false)
  const createReaderChat = (replace = false): void => {
    if (readerCreating.current) return
    readerCreating.current = true
    void chatActions.newConversation('web-recorder')
      .then((id) => { if (id) navigate(`/web-reader/${id}`, { replace }) })
      .catch(() => { /* ошибка уже показана стором */ })
      .finally(() => { readerCreating.current = false })
  }
  useEffect(() => {
    if (!authed || !inReader || chat.conversationsStatus !== 'ready') return
    if (legacyReaderRoute) {
      navigate(`/web-reader${routeReaderChatId ? `/${routeReaderChatId}` : ''}`, { replace: true })
      return
    }
    // Пока создание нового чата в полёте, авто-выбор молчит: иначе обновление
    // списка успело бы увести activeId на старый чат или создать второй.
    if (readerCreating.current) return
    const readerChats = chat.readerConversations
    const routedReaderChat = readerChats.find((item) => item.id === routeReaderChatId)
    if (routedReaderChat) {
      if (routedReaderChat.id !== chat.activeId) void chatActions.selectConversation(routedReaderChat.id)
      return
    }
    const target = readerChats[0]
    if (target) { navigate(`/web-reader/${target.id}`, { replace: true }); return }
    createReaderChat(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, inReader, legacyReaderRoute, routeReaderChatId, chat.activeId, chat.readerConversations, chat.conversationsStatus, chatActions, navigate])

  const playwrightReaderCreating = useRef(false)
  const createPlaywrightReaderChat = (replace = false): void => {
    if (playwrightReaderCreating.current) return
    playwrightReaderCreating.current = true
    void chatActions.newConversation('playwright-reader')
      .then((id) => { if (id) navigate(`/playwright-reader/${id}`, { replace }) })
      .catch(() => { /* store owns the visible error */ })
      .finally(() => { playwrightReaderCreating.current = false })
  }
  useEffect(() => {
    if (!authed || !inPlaywrightReader || chat.conversationsStatus !== 'ready' || playwrightReaderCreating.current) return
    const chats = chat.playwrightReaderConversations
    const routed = chats.find((item) => item.id === routePlaywrightReaderChatId)
    if (routed) {
      if (routed.id !== chat.activeId) void chatActions.selectConversation(routed.id)
      return
    }
    const fallback = chats[0]
    if (fallback) { navigate(`/playwright-reader/${fallback.id}`, { replace: true }); return }
    createPlaywrightReaderChat(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, inPlaywrightReader, routePlaywrightReaderChatId, chat.activeId, chat.playwrightReaderConversations, chat.conversationsStatus, chatActions, navigate])

  // URL → данные стора: вход/выход в раздел «Проекты», загрузка доски и
  // оверлея настроек. Навигацию делают клики (navigate), данные грузятся тут.
  useEffect(() => {
    if (!authed) return
    if (inProjects) { if (!projects.projectsOpen) void projectsActions.openProjects() }
    else if (projects.projectsOpen) projectsActions.closeProjects()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, inProjects])
  useEffect(() => {
    if (!authed || !inProjects) return
    if (routeProjectId) { if (projects.activeProjectId !== routeProjectId) void projectsActions.openBoard(routeProjectId) }
    else if (projects.activeProjectId) projectsActions.closeBoard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, inProjects, routeProjectId])
  // Прямая ссылка на завершённую задачу: сервер прячет с доски давно готовые
  // карточки, и открывать было бы нечего. Если задачи из URL в снапшоте нет —
  // один раз включаем «Показать завершённые» и доска приходит целиком.
  useEffect(() => {
    if (!authed || !inProjects || !routeTaskId) return
    if (projects.boardIncludeCompleted || projects.boardLoading || !projects.board) return
    if (projects.board.tasks.some((t) => t.id === routeTaskId)) return
    void projectsActions.setBoardIncludeCompleted(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, inProjects, routeTaskId, projects.board, projects.boardLoading, projects.boardIncludeCompleted])
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
    if (routeSettings || routeReleases) { if (!projects.projectSettingsOpen) projectsActions.openProjectSettings() }
    else if (projects.projectSettingsOpen) projectsActions.closeProjectSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, routeSettings, routeReleases])
  // URL → данные стора: утилиты-страницы. Вход на маршрут грузит данные, уход
  // зовёт close* — store-экшены прежние, поменялся только триггер (URL).
  useEffect(() => {
    if (utilitySeg === 'claude-code') { if (!operations.ccOpen) void operationsActions.openObserver() }
    else if (operations.ccOpen) operationsActions.closeObserver()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utilitySeg])
  useEffect(() => {
    if (utilitySeg === 'codex') { if (!operations.cxOpen) void operationsActions.openCodexObserver() }
    else if (operations.cxOpen) operationsActions.closeCodexObserver()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utilitySeg])
  useEffect(() => {
    if (!session.authRequired) return
    if (utilitySeg === 'machines') { if (!operations.machinesOpen) operationsActions.openMachines() }
    else if (operations.machinesOpen) operationsActions.closeMachines()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utilitySeg])
  useEffect(() => {
    if (!session.authRequired) return
    if (utilitySeg === 'ci') { if (!projects.ciOpen) void projectsActions.openCi() }
    else if (projects.ciOpen) projectsActions.closeCi()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utilitySeg])
  useEffect(() => {
    if (!session.authRequired) return
    if (utilitySeg === 'users') { if (!admin.usersOpen) void runtime.openAdmin() }
    else if (admin.usersOpen) adminActions.closeUsers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utilitySeg])
  useEffect(() => {
    if (utilitySeg !== 'users' || !routeUserName || !admin.usersOpen || admin.adminSelected === routeUserName) return
    void adminActions.selectAdminUser(routeUserName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utilitySeg, routeUserName, admin.usersOpen, admin.adminSelected])
  // Гейты: «Пользователи» — только админ; машины/пользователи — только web.
  useEffect(() => {
    if (utilitySeg === 'users' && session.currentUser && session.currentUser.role !== 'admin' && routeUserName && routeUserName !== session.currentUser.name) navigate('/users')
    if ((utilitySeg === 'users' || utilitySeg === 'machines' || utilitySeg === 'ci') && !session.authRequired) navigate('/')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utilitySeg, routeUserName, session.currentUser, session.authRequired])

  // Активный чат может быть ещё не выбран или не быть reader-чатом (грузится по
  // ссылке): подсвечивать вместо него первый пункт селектора нельзя — покажем плейсхолдер.
  const readerActiveListed = chat.readerConversations.some((c) => c.id === chat.activeId)
  const playwrightReaderActiveListed = chat.playwrightReaderConversations.some((c) => c.id === chat.activeId)
  const activeConversation = chat.conversations.find((c) => c.id === chat.activeId)
  const activeTitle = activeConversation?.title ?? 'Новый разговор'
  const activeExecTarget = activeConversation?.execTarget ?? null
  const activeKbUsage = chat.activeId ? chat.kbUsage[chat.activeId] : undefined
  // Счётчик обращений на кнопке «Использование БЗ» должен быть честным ДО
  // открытия панели, поэтому снапшот читаем при открытии чата и после каждого
  // нового сообщения (новый ход = возможные новые обращения).
  useEffect(() => {
    if (authed && chat.activeId) void chatActions.loadKbUsage(chat.activeId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, chat.activeId, chat.messages.length])
  const forcedPlan = session.currentUser?.role !== 'admin' && (!activeExecTarget || activeExecTarget === 'none')
  const activePermissionMode: PermissionMode = forcedPlan
    ? 'plan'
    : activeConversation?.permissionMode ?? settingsState.settings.permissionMode
  const ciProvider = settingsState.settings.llmProvider
  const ciModel = ciProvider === 'codex' ? settingsState.settings.codexModel : settingsState.settings.model
  const allowedClaudeModels = allowedModels(settingsState.llmAccess, 'claude')
  const allowedCodexModels = allowedModels(settingsState.llmAccess, 'codex')
  const allowedProviders = (['claude', 'codex'] as const).filter((provider) => isProviderAllowed(settingsState.llmAccess, provider) && (provider === 'claude' ? allowedClaudeModels.length : allowedCodexModels.length))
  const proposalModels = taskProposal?.provider === 'codex' ? allowedCodexModels : allowedClaudeModels
  const openedTaskLaunches = useRef(new Set<string>())

  const openTaskProposal = async (request: TaskLaunchProposal, messageId: string): Promise<boolean> => {
    if (!activeConversation?.projectId) {
      toast.error('Невозможно создать задачу: этот чат не привязан к проекту.')
      return false
    }
    const projectId = activeConversation.projectId
    const board = projects.activeProjectId === projectId && projects.board
      ? projects.board
      : await api['board:get']({ id: projectId })
    const column = board.columns.find((item) => item.semanticType === 'backlog') ?? board.columns[0]
    if (!column) {
      toast.error('Невозможно создать задачу: в проекте нет колонок.')
      return false
    }
    const project = projects.projects.find((item) => item.id === projectId)
    const now = Date.now()
    const provider = allowedProviders.includes(ciProvider) ? ciProvider : (allowedProviders[0] ?? ciProvider)
    const models = provider === 'codex' ? allowedCodexModels : allowedClaudeModels
    setTaskProposal({
      projectId,
      messageId,
      proposalId: request.id,
      board,
      projectName: project?.name ?? 'Проект',
      task: {
        id: `task-launch-draft:${messageId}:${request.id}`,
        projectId,
        columnId: column.id,
        type: 'task',
        parentId: null,
        title: request.title,
        description: request.description,
        acceptanceCriteria: request.acceptanceCriteria,
        priority: 'medium',
        assignee: session.currentUser?.name ?? null,
        labels: [],
        skills: project?.defaultSkills.task ?? [],
        storyPoints: null,
        dueDate: null,
        flagged: false,
        seq: 0,
        position: 0,
        createdAt: now,
        updatedAt: now,
        chatId: null
      },
      provider,
      model: models[0]?.id ?? ciModel
    })
    return true
  }

  useEffect(() => {
    if (taskProposal || !activeConversation || !inChat || routeChatId !== chat.activeId) return
    const message = [...chat.messages].reverse().find((item) => item.role === 'ai' && (item.meta?.taskLaunches?.length || item.meta?.taskLaunch))
    if (!message) return
    const proposals: TaskLaunchProposal[] = message.meta?.taskLaunches?.length
      ? message.meta.taskLaunches
      : message.meta?.taskLaunch
        ? [{ id: 'legacy', ...message.meta.taskLaunch }]
        : []
    const proposal = proposals.find((item) => !item.status && !openedTaskLaunches.current.has(`${message.id}:${item.id}`))
    if (!proposal) return
    openedTaskLaunches.current.add(`${message.id}:${proposal.id}`)
    void openTaskProposal(proposal, message.id).then((opened) => {
      if (opened) void chatActions.updateTaskLaunchStatus(message.id, proposal.id, 'opened')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.messages, chat.activeId, routeChatId, inChat, taskProposal, activeConversation?.id, activeConversation?.projectId])

  const chooseTaskLaunch = async (mode: 'todo' | 'in-progress' | 'chat'): Promise<void> => {
    if (!taskProposal || taskLaunchPending) return
    const task = taskProposal.task
    if (!task.title.trim()) return
    setTaskLaunchPending(true)
    try {
      if (mode === 'todo') {
        const board = await api['board:get']({ id: taskProposal.projectId })
        const column = board.columns.find((item) => item.semanticType === 'backlog') ?? board.columns[0]
        if (!column) return
        await api['tasks:create']({
          projectId: taskProposal.projectId,
          columnId: column.id,
          title: task.title,
          description: task.description,
          acceptanceCriteria: task.acceptanceCriteria,
          type: task.type,
          parentId: task.parentId,
          priority: task.priority,
          assignee: task.assignee,
          labels: task.labels,
          skills: task.skills,
          storyPoints: task.storyPoints,
          dueDate: task.dueDate
        })
        toast.success('Задача создана в TODO')
      } else if (mode === 'in-progress') {
        const run = await projectsActions.createTaskAndStartCi(taskProposal.projectId, { ...task, provider: taskProposal.provider, model: taskProposal.model })
        if (!run) return
        toast.success('Задача создана и поставлена в CI-очередь')
      }
      await chatActions.updateTaskLaunchStatus(taskProposal.messageId, taskProposal.proposalId, mode === 'chat' ? 'declined' : 'created')
      setTaskProposal(null)
      const selection = mode === 'todo'
        ? 'Пользователь выбрал: создать предложенную задачу в TODO.'
        : mode === 'in-progress'
          ? 'Пользователь выбрал: создать предложенную задачу в InProgress и начать разработку.'
          : 'Пользователь выбрал: работать над предложенной задачей в текущем чате без создания карточки.'
      chatActions.setDraft(selection)
      await chatActions.submitText()
      if (mode === 'chat') toast.success('Продолжаем работу в текущем чате')
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
    await chatActions.setConversationExecTarget(
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
  const liveSpeakers = [...new Set(voice.liveSegments.map((s) => s.speakerId))].sort((a, b) => a - b)
  const detectedSpeakers =
    liveSpeakers.length > 0 ? liveSpeakers : settingsState.settings.diarization ? [1, 2] : [1]

  const showConsole = settingsState.settings.showConsole

  // Операции над машиной для утилит (консоль/проводник); только web (есть мост fs).
  const machineOps: MachineOps | undefined = session.authRequired
    ? {
        list: operationsActions.fsList,
        read: operationsActions.fsRead,
        write: operationsActions.fsWrite,
        remove: operationsActions.fsRemove,
        rename: operationsActions.fsRename,
        mkdir: operationsActions.fsMkdir,
        download: operationsActions.downloadFsFile,
        upload: operationsActions.uploadFsFile,
        exec: operationsActions.agentExec
      }
    : undefined

  // История команд консоли живёт в сторе: утилиту закрывают и открывают заново, а
  // ↑/↓ должны листать то же, что набирали до этого. Объект пересобирается на
  // каждый рендер (как machineOps) — в зависимости эффектов его не кладут.
  const consoleHistory: ConsoleHistoryStore = {
    get: (agentId) => operations.consoleHistory[agentId] ?? [],
    push: operationsActions.pushConsoleCommand
  }

  // Закрывает мобильный сайдбар и выполняет действие пункта меню.
  const menu = (fn: () => void) => (): void => {
    setSidebarOpen(false)
    fn()
  }

  // Многопользовательский режим (web): пока не вошли — показываем экран логина.
  if (session.authRequired && !session.currentUser) {
    return (
      <LoginScreen
        onLogin={(name, password) => void runtime.login(name, password)}
        error={session.authError}
        theme={settingsState.settings.theme}
      />
    )
  }

  return (
    <div
      className={[
        'app',
        showConsole && 'app--console',
        collapsed && 'app--sidebar-collapsed',
        inReader && 'app--web-reader',
        inPlaywrightReader && 'app--playwright-reader'
      ].filter(Boolean).join(' ')}
      data-theme={settingsState.settings.theme}
    >
      {release?.version && (() => {
        const details = [
          `выпущена: ${new Date(release.releasedAt).toLocaleString()}`,
          ...(release.commit ? [`Коммит: ${release.commit}`] : []),
          ...(release.task ? [`Задача: ${release.task}`] : [])
        ]
        return (
          <footer
            className="release-version"
            title={details.join('\n')}
            aria-label={`Версия ${release.version}; ${details.join('; ')}`}
          >
            v{release.version}
          </footer>
        )
      })()}
      {!inReader && !inPlaywrightReader && <>
      <Sidebar
        open={sidebarOpen}
        onToggleCollapse={() => shellActions.setSidebarCollapsed(true)}
        conversations={chat.conversations.filter((conversation) => conversation.assistantKind !== 'web-recorder' && !conversation.previewUrl)}
        conversationsStatus={chat.conversationsStatus}
        conversationsError={chat.conversationsError}
        onRetryConversations={() => void chatActions.retryConversations()}
        activeId={chat.activeId}
        taskBadges={chat.taskChatBadges}
        ciSummaries={projects.ciSummaries}
        workingIds={[
          ...Object.keys(chat.activeTurns),
          ...((voice.voice === 'thinking' || voice.voice === 'speaking') && chat.activeId
            ? [chat.activeId]
            : [])
        ]}
        now={now ? now() : Date.now()}
        onNew={() => {
          setSidebarOpen(false)
          void chatActions.newConversation().then((id) => navigate(id ? `/chat/${id}` : '/'))
        }}
        onPick={(id) => {
          setSidebarOpen(false)
          navigate(`/chat/${id}`)
        }}
        onDelete={chatActions.deleteConversation}
        defaultPermissionMode={settingsState.settings.permissionMode}
        agents={operations.agents}
        searchQuery={chat.searchQuery}
        onSearch={chatActions.setSearchQuery}
        searchScope={chat.searchScope}
        onSearchScopeChange={(scope) => void chatActions.setSearchScope(scope)}
        messageSearch={chat.messageSearch}
        onPickMessage={(hit) => {
          setSidebarOpen(false)
          // Подсветку просим заранее: лента прокрутится к сообщению, как только
          // оно окажется в DOM (беседа может ещё грузиться).
          chatActions.focusMessage(hit.messageId)
          navigate(`/chat/${hit.conversationId}`)
        }}
        onRetryMessageSearch={() => void chatActions.retryMessageSearch()}
        onLoadMoreMessages={() => void chatActions.loadMoreMessageSearch()}
        showDoneTaskChats={chat.showDoneTaskChats}
        onShowDoneTaskChatsChange={(show) => void chatActions.setShowDoneTaskChats(show)}
        projects={projects.projects}
        selectedProjectId={chat.sidebarProjectId}
        onSelectProject={(id) => void chatActions.setSidebarProject(id)}
        onOpenObserver={menu(() => navigate('/claude-code'))}
        onOpenKnowledgeBase={menu(() => navigate('/kb'))}
        onOpenPersonalization={session.currentUser ? menu(() => navigate('/personalization')) : undefined}
        onOpenSettings={menu(shellActions.openSettings)}
        onOpenFiles={session.authRequired ? menu(() => operationsActions.openUtilityForActiveChat('explorer')) : undefined}
        onOpenConsole={session.authRequired ? menu(() => operationsActions.openUtilityForActiveChat('console')) : undefined}
        onOpenWebReader={session.authRequired ? menu(openWebReaderWorkspace) : undefined}
        onOpenPlaywrightReader={session.authRequired ? menu(() => navigate('/playwright-reader')) : undefined}
        onOpenUsers={session.authRequired ? menu(() => navigate('/users')) : undefined}
        onOpenMachines={session.authRequired ? menu(() => navigate('/machines')) : undefined}
        onOpenCi={session.authRequired ? menu(() => navigate('/ci')) : undefined}
        currentUser={session.currentUser}
        onLogout={session.authRequired ? () => void runtime.logout() : undefined}
        mode={sidebarMode}
        onModeChange={session.authRequired ? (m) => {
          setSidebarMode(m)
          // «Проекты» — не просто другой список в сайдбаре: раздел открывается
          // страницей первого проекта. Список сначала перечитываем — выходя из
          // раздела, стор его чистит (closeProjects).
          if (m === 'projects') {
            void projectsActions.refreshProjects().catch(() => projects.projects).then((list) => {
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
          void projectsActions.createProject({ name }).then((detail) => {
            if (detail) navigate(`/projects/${detail.id}`)
          })
        }}
        onOpenCommandPalette={() => {
          setSidebarOpen(false)
          setPaletteOpen(true)
        }}
      />
      {sidebarOpen && (
        <div className="side-backdrop" aria-hidden onClick={() => closeMobileSidebar()} />
      )}
      </>}

      {(!inProjects || inTaskChat) && !onUtilityPage && (inChat || inReader || inPlaywrightReader) && (
      <div className={(inReader || inPlaywrightReader) ? `chat-split chat-split--${chatView}` : 'chat-page'} style={(inReader || inPlaywrightReader) ? { '--preview-width': `${previewWidth}%` } as CSSProperties : undefined}>
      {(inReader || inPlaywrightReader) && <nav className="chat-split-tabs" aria-label="Режим экрана"><div role="tablist"><button type="button" role="tab" aria-selected={chatView === 'chat'} onClick={() => setChatView('chat')}>Чат</button><button type="button" role="tab" aria-selected={chatView === 'preview'} onClick={() => setChatView('preview')}>Сайт</button></div></nav>}
      <div className="chat-split-chat">
      {inReader && <header className="web-recorder-selector"><label><span className="vc-sr-only">Разговор Web Reader</span><select aria-label="Разговор Web Reader" value={readerActiveListed ? chat.activeId ?? '' : ''} onChange={(event) => { if (event.target.value) navigate(`/web-reader/${event.target.value}`) }}>{!readerActiveListed && <option value="" disabled>Чат не выбран</option>}{chat.readerConversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title}</option>)}</select></label><button className="vc-btn vc-btn--secondary" type="button" onClick={() => createReaderChat()}>+ Новый</button></header>}
      {inPlaywrightReader && <header className="web-recorder-selector playwright-reader-selector"><strong>Playwright Reader</strong><label><span className="vc-sr-only">Разговор Playwright Reader</span><select aria-label="Разговор Playwright Reader" value={playwrightReaderActiveListed ? chat.activeId ?? '' : ''} onChange={(event) => { if (event.target.value) navigate(`/playwright-reader/${event.target.value}`) }}>{!playwrightReaderActiveListed && <option value="" disabled>Чат не выбран</option>}{chat.playwrightReaderConversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title}</option>)}</select></label><button className="vc-btn vc-btn--secondary" type="button" onClick={() => createPlaywrightReaderChat()}>+ Новый</button></header>}
      <ChatColumn
        conversationId={chat.activeId}
        onToggleSidebar={(inReader || inPlaywrightReader) ? undefined : toggleSidebar}
        sidebarExpanded={sidebarExpanded}
        title={activeTitle}
        onRenameTitle={(t) => {
          if (chat.activeId) void chatActions.renameConversation(chat.activeId, t)
        }}
        onOpenConversationSettings={() => { setConversationSettingsOpen(true); void projectsActions.refreshProjects() }}
        permissionMode={activePermissionMode}
        onExecutePlan={(answerId) => void chatActions.executePlan(answerId)}
        canExecutePlan={!forcedPlan}
        state={voice.voice}
        messages={chat.messages.filter((message) => !(chat.activeId ? chat.queuedTurns[chat.activeId] ?? [] : []).some((item) => item.messageId === message.id))}
        loadingMessages={chat.loadingMessages}
        highlightMessageId={chat.highlightMessageId}
        onHighlightDone={chatActions.clearMessageHighlight}
        liveSegments={voice.liveSegments}
        diarization={settingsState.settings.diarization}
        streamingReply={chat.streamingReply}
        liveActivity={chat.liveActivity}
        liveUsage={chat.liveUsage}
        canSpeak={settingsState.ttsAvailable}
        speakingMessageId={voice.speakingMessageId}
        onSpeakMessage={voiceActions.replayMessage}
        onDeleteMessage={chatActions.deleteMessage}
        onEditMessage={chatActions.editMessage}
        onAnswerQuestions={(text) => void chatActions.answerQuestions(text)}
        onAnswerCiInteraction={(runId, interactionId, text) => void projectsActions.answerCiInteraction(runId, interactionId, { text })}
        answeredCiInteractions={projects.answeredCiInteractions}
        taskHeader={
          // Виджет задачи — свойство открытого чата: показываем только контекст
          // этого чата. Так залипание невозможно по построению, кто бы и где ни
          // сменил `activeId` (новый чат, resume CC/Codex, переход по адресу).
          chat.taskChatContext && chat.taskChatContext.conversationId === chat.activeId ? (
            <TaskChatHeader
              context={chat.taskChatContext}
              summary={projects.ciSummaries[chat.taskChatContext.task.id] ?? null}
              onOpenTask={(projectId, taskId) => navigate(`/projects/${projectId}/task/${taskId}`)}
              renderRunFeed={(runId) => (
                <RunFeed
                  runId={runId}
                  cache={projects.ciRuns[runId]}
                  onSubscribe={projectsActions.ciSubscribe}
                  onUnsubscribe={projectsActions.ciUnsubscribe}
                  onLoad={(id) => void projectsActions.loadCiRun(id)}
                  onRetry={(id) => void projectsActions.retryCiRun(id)}
                  onRetryFromStep={(id, selection) => void projectsActions.retryCiRunFromStep(id, selection)}
                  onDiscardAndRetry={(id) => void projectsActions.discardCiWorkspaceAndRetry(id)}
                  onCancel={(id) => void projectsActions.cancelCiRun(id)}
                  onAnswerInteraction={(id, interactionId, answer) => void projectsActions.answerCiInteraction(id, interactionId, answer)}
                />
              )}
            />
          ) : null
        }
        machineOps={machineOps}
        consoleHistory={consoleHistory}
        readServerFile={operationsActions.readServerFile}
        onOpenImageInExplorer={(agentId, path) => operationsActions.openUtility('explorer', agentId, path)}
        // Переключение утилиты из шапки встроенной карточки: та же машина и папка,
        // но окном (в сообщении карточка остаётся такой, какой её прислала модель).
        onSwitchUtility={(kind, agentId, dir) => operationsActions.openUtility(kind, agentId, dir, kind === 'explorer')}
        onOpenMachines={session.authRequired ? () => navigate('/machines') : undefined}
        onOpenKbDocument={(documentId) => navigate(`/kb/${encodeURIComponent(documentId)}`)}
        error={shell.error}
        onDismissError={shellActions.dismissError}
        modelMissing={!settingsState.modelPresent}
        modelLabel={settingsState.settings.whisperModel}
        downloading={settingsState.downloading}
        downloadPercent={settingsState.downloadPercent}
        onDownloadModel={settingsActions.downloadModel}
        onExport={chatActions.exportConversation}
        onOpenKbUsage={chat.activeId ? runtime.openKbUsage : undefined}
        kbUsageCount={activeKbUsage?.report?.unreadCount ?? 0}
        kbUsageActive={hasPendingKbUsage(activeKbUsage?.report ?? null)}
        kbContextMode={activeConversation?.kbContextMode ?? 'auto'}
        turnMeta={chat.lastTurnMeta}
        agents={operations.agents}
        execTarget={activeExecTarget}
        aiLabel={(activeConversation?.llmProvider ?? settingsState.settings.llmProvider) === 'codex' ? 'Codex' : 'Claude'}
        voiceBar={
          <VoiceBar
            defaultCollapsed={compactChat}
            state={voice.voice}
            replyStarted={chat.streamingReply.length > 0}
            requestError={shell.error}
            draft={chat.draft}
            diarization={settingsState.settings.diarization}
            detectedSpeakers={detectedSpeakers}
            aiLabel={(activeConversation?.llmProvider ?? settingsState.settings.llmProvider) === 'codex' ? 'Codex' : 'Claude'}
            attachments={chat.attachments}
            previewElement={previewElement}
            queuedTurns={chat.activeId ? chat.queuedTurns[chat.activeId] ?? [] : []}
            queuePaused={chat.activeId ? chat.queuePaused[chat.activeId] ?? false : false}
            onEditQueued={chatActions.editQueued}
            onDeleteQueued={chatActions.deleteQueued}
            onSendQueuedNow={chatActions.sendQueuedNow}
            onDraftChange={chatActions.setDraft}
            onSubmitText={() => { void chatActions.submitText(previewElement ?? undefined).then((sent) => { if (sent) setPreviewElement(null) }) }}
            onStartVoice={voiceActions.startVoice}
            onStopVoice={voiceActions.stopVoice}
            onStopSpeak={voiceActions.stopSpeak}
            onCancelRequest={chatActions.cancelRequest}
            onAddFiles={(files) => files.forEach((f) => void chatActions.addAttachment(f))}
            onRemoveAttachment={chatActions.removeAttachment}
            onRemovePreviewElement={() => setPreviewElement(null)}
            permissionMode={activePermissionMode}
            onChangePermissionMode={(mode) => void changeConversationMode(mode)}
            voiceInputEnabled={VOICE_INPUT_ENABLED}
            aiAssistPrompts={settingsState.settings.aiAssistPrompts}
            onAiAssistPromptsChange={(next) => void settingsActions.updateSettings({ aiAssistPrompts: next })}
            generateAiAssist={async ({ prompt, modifiers }) => (await api['prompt:suggest']({ prompt, modifiers })).variants}
          />
        }
      />
      </div>
      {(inReader || inPlaywrightReader) && <div className="chat-split-divider" role="region" aria-label="Изменение ширины панелей" onPointerDown={resizePreview}><div role="separator" aria-label="Изменить ширину панелей" aria-orientation="vertical" /></div>}
      {(inReader || inPlaywrightReader) && <WebReaderHost conversationUrl={activeConversation?.previewUrl ?? null} projectUrl={inReader ? (activeProjectPreviewUrl ?? activeConversation?.projectPreviewUrl ?? null) : null} onSave={async (previewUrl) => { if (activeConversation) await chatActions.setConversationPreviewUrl(activeConversation.id, previewUrl); setPreviewElement(null) }} onSelectElement={setPreviewElement} onRegisterActionRunner={registerPreviewRunner} />}
      </div>
      )}

      {/* Проектов нет вообще: редиректу некуда вести — показываем, что делать. */}
      {inProjects && !routeProjectId && firstProjectId === null && <ProjectsEmptyPage />}

      {inProjects && routeProjectId && projectMissing && <ProjectNotFoundPage />}

      {/* Одна страница проекта на все три маршрута: шапка с именем и вкладками
          общая, меняется только содержимое. */}
      {inProjects && !inTaskChat && routeProjectId && !projectMissing && (
        <ProjectPage
          projectName={routeProjectName}
          section={routeSettings ? 'settings' : routeReleases ? 'releases' : 'board'}
          onSectionChange={(section) =>
            navigate(section === 'settings' ? `/projects/${routeProjectId}/settings` : section === 'releases' ? `/projects/${routeProjectId}/releases` : `/projects/${routeProjectId}`)
          }
          onToggleSidebar={toggleSidebar}
          sidebarExpanded={sidebarExpanded}
          onSidebarEscape={compactChat && sidebarOpen ? () => { closeMobileSidebar(); return true } : undefined}
          assistantOpen={assistantOpen || segments[2] === 'assistant'}
          onAssistantOpenChange={(open) => { if (!open && segments[2] === 'assistant') navigate(`/projects/${routeProjectId}`); setKanbanAssistantOpen(open) }}
          onOpenAssistantPage={() => navigate(`/projects/${routeProjectId}/assistant`) }
        >
          {routeReleases ? (
            projects.projectDetail?.id === routeProjectId ? <ReleaseCenter projectId={routeProjectId} baseBranch={projects.projectDetail!.ciBaseBranch ?? 'main'} owner={projects.projectDetail!.role === 'owner'} machines={projects.projectDetail!.machines} agents={operations.agents} agentsStatus={operations.agentsStatus} agentsError={operations.agentsError} defaultAgentId={projects.projectDetail!.defaultAgentId} releaseTimeouts={projects.projectDetail!.releaseTimeouts} api={api} /> : <div className="proj-page-state" aria-busy="true"><Skeleton variant="list" count={4} item="block" height={64} gap={12} /></div>
          ) : routeSettings ? (
            projects.projectDetail?.id === routeProjectId ? (
              <ProjectSettings
                detail={projects.projectDetail!}
                agents={operations.agents}
                currentUsername={session.currentUser?.name}
                llmAccess={settingsState.llmAccess}
                llmEngines={settingsState.llmEngines}
                onUpdate={(id, fields) => void projectsActions.updateProject(id, fields)}
                onDelete={(id) => {
                  // Удалили проект — уводим на другой доступный, а если их не
                  // осталось, в пустое состояние (#/projects без id).
                  const next = projects.projects.find((p) => p.id !== id)?.id ?? null
                  void projectsActions.deleteProject(id).then(() => {
                    navigate(next ? `/projects/${next}` : '/projects', { replace: true })
                  })
                }}
                onAddMember={(id, username) => void projectsActions.addProjectMember(id, username)}
                onUpdateMemberRole={(id, username, role) => void projectsActions.updateProjectMemberRole(id, username, role)}
                onRemoveMember={(id, username) => void projectsActions.removeProjectMember(id, username)}
                onLinkMachine={(id, agentId) => void projectsActions.linkProjectMachine(id, agentId)}
                onUnlinkMachine={(id, agentId) => void projectsActions.unlinkProjectMachine(id, agentId)}
                onSetMachinePath={(id, agentId, path) => void projectsActions.setProjectMachinePath(id, agentId, path)}
                onSetReposRoot={(id, agentId, root) => void projectsActions.setProjectReposRoot(id, agentId, root)}
                onSetDefaultMachine={(id, agentId) => void projectsActions.setProjectDefaultMachine(id, agentId)}
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
              assistantHeader={<ProjectAssistantChatSelector
                projectId={routeProjectId!}
                api={api}
                selectedId={assistantConversationId}
                onSelect={setAssistantConversationId}
              />}
              widget={<ProjectBoard
              initialOpenTaskId={routeTaskId}
              initialOpenTaskTab={segments[4] === 'preparation' ? 'preparation' : undefined}
              onOpenTaskRouteChange={(taskId, tab) => navigate(taskId ? `/projects/${routeProjectId}/task/${taskId}${tab ? `/${tab}` : ''}` : `/projects/${routeProjectId}`)}
              projectName={routeProjectName}
              board={projects.board}
              loading={projects.boardLoading || projects.activeProjectId !== routeProjectId}
              error={projects.boardError}
              onRetry={() => void projectsActions.openBoard(routeProjectId)}
              showCompleted={projects.boardIncludeCompleted}
              onShowCompletedChange={(show) => void projectsActions.setBoardIncludeCompleted(show)}
              showDoneTaskChats={chat.showDoneTaskChats}
              onShowDoneTaskChatsChange={(show) => void chatActions.setShowDoneTaskChats(show)}
              members={projects.projectDetail?.members ?? []}
              currentUser={session.currentUser?.name ?? null}
              onCreateColumn={(name) => void projectsActions.createColumn(name)}
              onUpdateColumn={(id, fields) => void projectsActions.updateColumn(id, fields)}
              onSetColumnHidden={(id, hidden) => void projectsActions.setColumnHidden(id, hidden)}
              onReorderColumns={(order) => void projectsActions.reorderColumns(order)}
              onDeleteColumn={(id) => void projectsActions.deleteColumn(id)}
              onCreateTask={(columnId, input) => void projectsActions.createTask(columnId, input)}
              onUpdateTask={(taskId, fields) => void projectsActions.updateTask(taskId, fields)}
              onMoveTask={(taskId, columnId, afterId, beforeId) => void projectsActions.moveTask(taskId, columnId, afterId, beforeId)}
              onDeleteTask={(taskId) => void projectsActions.deleteTask(taskId)}
              onOpenChat={(taskId) => void projectsActions.openTaskChat(taskId).then((id) => navigate(id ? `/projects/${routeProjectId}/task/${taskId}/chat/${id}` : '/'))}
              onEnsureChat={(taskId) => void projectsActions.ensureTaskChat(taskId)}
              ciSummaries={projects.ciSummaries}
              onStartCi={async (taskId) => { if (routeProjectId) { const run = await projectsActions.startCiRun(routeProjectId, taskId); if (run) projectsActions.openCiRun(run.id) } }}
              onStartCiParallel={async (taskId) => { if (routeProjectId) { const run = await projectsActions.startCiRun(routeProjectId, taskId, { launch: 'parallel' }); if (run) projectsActions.openCiRun(run.id) } }}
              onOpenCiRun={(runId) => projectsActions.openCiRun(runId)}
              onDequeueCiRun={(runId) => void projectsActions.dequeueCiRun(runId)}
              onStartMerge={(taskId, agentId) => { if (routeProjectId) void projectsActions.startMergeRun(routeProjectId, taskId, agentId) }}
              loadPreparationRuns={(taskId) => api['tasks:listPreparationRuns']({ projectId: routeProjectId!, taskId })}
              onRetryPreparation={(runId) => api['tasks:retryPreparationRun']({ runId })}
              onCancelPreparation={(runId) => api['tasks:cancelPreparationRun']({ runId })}
              aiAssistPrompts={settingsState.settings.aiAssistPrompts}
              onAiAssistPromptsChange={(next) => void settingsActions.updateSettings({ aiAssistPrompts: next })}
              generateAiAssist={async ({ prompt, modifiers }) => (await api['prompt:suggest']({ prompt, modifiers })).variants}
              onAssistantSelectionChange={handleAssistantSelectionChange}
            />}
              assistant={<KanbanAssistant
                projectId={routeProjectId!}
                context={kanbanAssistantContext}
                api={api}
                llmEngines={settingsState.llmEngines}
                conversationId={assistantConversationId}
                onCommand={async (command: WidgetAssistantCommand) => {
                  rememberWidgetAction('assistant.command', command.type, 'taskId' in command ? command.taskId : undefined)
                  if (command.type === 'navigate.project-settings') { navigate(`/projects/${command.projectId}/settings`); return }
                  if (command.type === 'navigate.task') { navigate(`/projects/${command.projectId}/task/${command.taskId}`); return }
                  if (command.type === 'propose.settings-update') { await settingsActions.updateSettings(command.patch); return }
                  if (command.type === 'propose.task-create') { await projectsActions.createTask(command.input.columnId, command.input); return }
                  const patch: SupportedTaskPatch = command.type === 'propose.task-update'
                    ? command.patch
                    : command.type === 'propose.acceptance-criteria'
                      ? { acceptanceCriteria: command.value }
                      : { [command.field]: command.value }
                  const { columnId, ...fields } = patch
                  if (columnId) await projectsActions.moveTask(command.taskId, columnId, null, null)
                  if (Object.keys(fields).length > 0) await projectsActions.updateTask(command.taskId, fields)
                }}
              />}
            />
          )}
        </ProjectPage>
      )}

      {utilitySeg === 'kb' && (
        <KnowledgeBase api={api} variant="page" documentId={routeKbDocumentId} onClose={() => navigate('/')} />
      )}

      {utilitySeg === 'personalization' && session.currentUser && (
        <PersonalizationPage user={session.currentUser} value={settingsState.settings.personalization} onSave={async (personalization) => { await settingsActions.updateSettings({ personalization }); navigate('/') }} onCancel={() => navigate('/')} />
      )}

      {/* Объединённый наблюдатель агентов: один компонент с переключателем
          движка Claude/Codex. Движок и открытость выводятся из маршрута
          (/claude-code | /codex) — переключатель просто навигирует между ними. */}
      {(() => {
        const engine: ObserverEngine | null =
          utilitySeg === 'claude-code' ? 'claude' : utilitySeg === 'codex' ? 'codex' : null
        const open = engine === 'claude' ? operations.ccOpen : engine === 'codex' ? operations.cxOpen : false
        if (!engine || !open) return null
        return (
          <EnginesObserver
            variant="page"
            engine={engine}
            onSwitchEngine={(e) => navigate(e === 'claude' ? '/claude-code' : '/codex')}
            onClose={() => navigate('/')}
            claude={{
              projects: operations.ccProjects,
              sessions: operations.ccSessions,
              transcript: operations.ccTranscript,
              activeProject: operations.ccProjectSlug,
              activeSession: operations.ccSessionId,
              usage: operations.ccUsage,
              onSelectProject: operationsActions.selectCcProject,
              onSelectSession: operationsActions.selectCcSession,
              onResumeSession: (slug, id) =>
                void runtime.resumeCcSession(slug, id).then((cid) => navigate(cid ? `/chat/${cid}` : '/'))
            }}
            codex={{
              projects: operations.cxProjects,
              sessions: operations.cxSessions,
              transcript: operations.cxTranscript,
              activeProject: operations.cxProjectCwd,
              activeSession: operations.cxSessionId,
              usage: operations.cxUsage,
              onSelectProject: operationsActions.selectCxProject,
              onSelectSession: operationsActions.selectCxSession,
              onResumeSession: (id) =>
                void runtime.resumeCxSession(id).then((cid) => navigate(cid ? `/chat/${cid}` : '/'))
            }}
          />
        )
      })()}

      {utilitySeg === 'machines' && operations.machinesOpen && (
        <MachineStatus
          variant="page"
          agents={operations.agents}
          status={operations.agentsStatus}
          error={operations.agentsError}
          onRetry={() => void operationsActions.refreshAgents()}
          onSetPolicy={(id, policy) => void operationsActions.setAgentPolicy(id, policy)}
          onCreateAgent={operationsActions.createAgent}
          onRegenerateToken={operationsActions.regenerateAgentToken}
          onGetConnectionString={operationsActions.getAgentConnectionString}
          onUpdateAgent={operationsActions.updateAgent}
          onDeleteAgent={(id) => void operationsActions.deleteAgent(id)}
          defaultAgentId={settingsState.settings.defaultAgentId}
          onSetDefault={(id) => void settingsActions.updateSettings({ defaultAgentId: id })}
          onClose={() => navigate('/')}
        />
      )}

      {utilitySeg === 'users' && admin.usersOpen && (
        <UsersAdmin
          variant="page"
          users={admin.adminUsers}
          usageSummary={admin.adminUsageSummary}
          isAdmin={session.currentUser?.role === 'admin'}
          status={admin.adminUsersStatus}
          error={admin.adminUsersError}
          onRetry={() => void runtime.openAdmin()}
          selected={routeUserName ?? admin.adminSelected}
          usage={admin.adminUsage}
          conversations={admin.adminConversations}
          messages={admin.adminMessages}
          conversationId={admin.adminConversationId}
          currentUserName={session.currentUser?.name ?? ''}
          onSelect={(name) => { navigate(`/users/${encodeURIComponent(name)}`); void adminActions.selectAdminUser(name) }}
          onCreate={(name, password, role) => void adminActions.createUserAccount(name, password, role)}
          onSetBlocked={(name, blocked) => void adminActions.setUserBlocked(name, blocked)}
          onDelete={(name) => void adminActions.deleteUserAccount(name)}
          onLoadUsage={(unit, from, to, conversationId) => void adminActions.loadAdminUsage(unit, from, to, conversationId)}
          onOpenConversation={(id) => void adminActions.openAdminConversation(id)}
          llmAccess={admin.adminUserLlmAccess}
          onSaveLlmAccess={(access) => void adminActions.saveAdminUserLlmAccess(access)}
          engines={admin.adminLlmEngines}
          enginesStatus={admin.adminLlmEnginesStatus}
          enginesError={admin.adminLlmEnginesError}
          engineHealth={admin.adminLlmEngineHealth}
          onRetryEngines={() => void adminActions.refreshAdminLlmEngines()}
          onCreateEngine={(input) => void adminActions.createAdminLlmEngine(input)}
          onUpdateEngine={(id, patch) => void adminActions.updateAdminLlmEngine(id, patch)}
          onDeleteEngine={(id) => void adminActions.deleteAdminLlmEngine(id)}
          onCheckEngineHealth={(id) => void adminActions.checkAdminLlmEngineHealth(id)}
          modelPrices={admin.adminModelPrices}
          onSaveModelPrice={(input) => void adminActions.saveAdminModelPrice(input)}
          onDeleteModelPrice={(provider, model) => void adminActions.deleteAdminModelPrice(provider, model)}
          onClose={() => navigate('/')}
        />
      )}

      {utilitySeg === 'ci' && projects.ciOpen && (
        <CiCommands
          commands={projects.ciCommands}
          status={projects.ciStatus}
          error={projects.ciError}
          onRetry={() => void projectsActions.openCi()}
          settings={projects.ciSettings}
          suggestions={projects.ciSuggestions}
          workspaces={projects.ciWorkspaces}
          role={session.currentUser?.role ?? 'admin'}
          llmAccess={settingsState.llmAccess}
          projects={projects.projects.map((p) => ({ id: p.id, name: p.name }))}
          onCreate={(input) => projectsActions.createCiCommand(input)}
          onUpdate={(id, input) => projectsActions.updateCiCommand(id, input)}
          onDelete={(id) => projectsActions.deleteCiCommand(id)}
          onUsage={(id) => projectsActions.ciCommandUsage(id)}
          onSaveSettings={(next) => projectsActions.saveCiSettings(next)}
          onResolveSuggestion={(id, accept) => projectsActions.resolveCiSuggestion(id, accept)}
          onClose={() => navigate('/')}
        />
      )}

      {taskProposal && inChat && routeChatId === chat.activeId && (
        <TaskModal
          draft
          task={taskProposal.task}
          board={taskProposal.board}
          projectName={taskProposal.projectName}
          members={projects.projectDetail?.id === taskProposal.projectId ? projects.projectDetail.members : []}
          onUpdate={(_taskId: string, fields: TaskUpdateFields) => setTaskProposal((current) => current ? { ...current, task: { ...current.task, ...fields } } : null)}
          onDelete={() => undefined}
          onMoveToColumn={(_taskId, columnId) => setTaskProposal((current) => current ? { ...current, task: { ...current.task, columnId } } : null)}
          onOpenTask={() => undefined}
          onClose={() => { if (!taskLaunchPending) setTaskProposal(null) }}
          detailsExtra={<>
            <label className="jmodal-field">Движок
              <select className="sel" aria-label="Движок" value={taskProposal.provider} onChange={(event) => {
                const provider = event.target.value as LlmProvider
                const models = provider === 'codex' ? allowedCodexModels : allowedClaudeModels
                setTaskProposal({ ...taskProposal, provider, model: models[0]?.id ?? '' })
              }}>
                {allowedProviders.includes('claude') && <option value="claude">Claude</option>}
                {allowedProviders.includes('codex') && <option value="codex">Codex</option>}
              </select>
            </label>
            <label className="jmodal-field">Модель
              <select className="sel" aria-label="Модель" value={taskProposal.model} onChange={(event) => setTaskProposal({ ...taskProposal, model: event.target.value })}>
                {!proposalModels.some((model) => model.id === taskProposal.model) && <option value={taskProposal.model}>{taskProposal.model || 'По умолчанию'}</option>}
                {proposalModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
              </select>
            </label>
          </>}
          footer={<>
            <Button variant="secondary" onClick={() => void chooseTaskLaunch('todo')} loading={taskLaunchPending} disabled={!taskProposal.task.title.trim()}>Создать в TODO</Button>
            <Button variant="primary" onClick={() => void chooseTaskLaunch('in-progress')} loading={taskLaunchPending} disabled={!taskProposal.task.title.trim()}>Создать в InProgress</Button>
            <Button variant="secondary" onClick={() => void chooseTaskLaunch('chat')} loading={taskLaunchPending}>Работать в текущем чате</Button>
          </>}
        />
      )}

      {conversationSettingsOpen && activeConversation && (
        <ConversationSettings
          conversation={activeConversation}
          agents={operations.agents}
          machineOps={machineOps}
          role={session.currentUser?.role ?? 'admin'}
          settings={settingsState.settings}
          engines={settingsState.llmEngines}
          llmAccess={settingsState.llmAccess}
          defaultAgentId={settingsState.settings.defaultAgentId}
          projects={projects.projects}
          fetchProjectDetail={projectsActions.fetchProjectDetail}
          fetchMachines={chatActions.fetchConversationMachines}
          onSave={async ({ title, execTarget, workdir, skillNames, llmEngineId, llmProvider, llmModel, permissionMode, kbContextMode, projectId }) => {
            await chatActions.renameConversation(activeConversation.id, title)
            await chatActions.setConversationProject(activeConversation.id, projectId)
            await chatActions.setConversationExecTarget(activeConversation.id, execTarget, workdir, skillNames, llmProvider, llmModel, permissionMode, kbContextMode, llmEngineId)
          }}
          onAddSkill={async (agentId, skill) => {
            const agent = operations.agents.find((item) => item.id === agentId)
            if (!agent) return
            await operationsActions.setAgentPolicy(agentId, { ...agent.policy, skills: [...agent.policy.skills, skill] })
          }}
          onClose={() => setConversationSettingsOpen(false)}
        />
      )}

      {showConsole && (
        <ConsolePanel
          log={chat.consoleLog}
          open={shell.consoleOpen}
          onToggle={shellActions.toggleConsole}
        />
      )}


      {operations.utility && machineOps && (
        <MachineUtility
          tool={{
            kind: operations.utility.kind,
            ...(operations.utility.agentId ? { agentId: operations.utility.agentId } : {}),
            ...(operations.utility.path ? { path: operations.utility.path } : {}),
            ...(operations.utility.dir ? { dir: true } : {})
          }}
          agents={operations.agents}
          ops={machineOps}
          consoleHistory={consoleHistory}
          variant="modal"
          onSwitchUtility={(kind, agentId, dir) => operationsActions.openUtility(kind, agentId, dir, kind === 'explorer')}
          // Раздел «Машины» — страница контентной колонки, поэтому окно утилиты
          // закрываем: иначе оно осталось бы висеть поверх неё.
          onOpenMachines={
            session.authRequired
              ? () => {
                  operationsActions.closeUtility()
                  navigate('/machines')
                }
              : undefined
          }
          onClose={operationsActions.closeUtility}
        />
      )}

      {shell.kbUsageOpen && chat.activeId && (
        <KbUsagePanel
          conversationId={chat.activeId}
          projectId={activeConversation?.projectId ?? null}
          cache={activeKbUsage}
          projectCache={activeConversation?.projectId ? chat.kbUsageByProject[activeConversation.projectId] : undefined}
          kbStatus={chat.kbStatus}
          mode={activeConversation?.kbContextMode ?? 'auto'}
          onLoad={(id) => { void chatActions.loadKbUsage(id, true); void chatActions.refreshKbStatus() }}
          onLoadProject={(id) => void chatActions.loadProjectKbUsage(id)}
          onClose={runtime.closeKbUsage}
          onOpenDocument={(documentId) => { runtime.closeKbUsage(); navigate(`/kb/${encodeURIComponent(documentId)}`) }}
          onOpenKnowledgeBase={() => { runtime.closeKbUsage(); navigate('/kb') }}
          onOpenConversationSettings={() => { runtime.closeKbUsage(); setConversationSettingsOpen(true) }}
          titleOf={(id) => chat.conversations.find((c) => c.id === id)?.title}
          onOpenRun={(runId) => { runtime.closeKbUsage(); projectsActions.openCiRun(runId) }}
        />
      )}

      {projects.ciActiveRunId && (
        <ToolFrame title="Лента CI-рана" variant="modal" testId="ci-run-modal" onClose={projectsActions.closeCiRun}>
          <div style={{ padding: '12px', overflow: 'auto' }}>
            <RunFeed
              runId={projects.ciActiveRunId}
              cache={projects.ciRuns[projects.ciActiveRunId]}
              llmAccess={settingsState.llmAccess}
              onSubscribe={projectsActions.ciSubscribe}
              onUnsubscribe={projectsActions.ciUnsubscribe}
              onLoad={(runId) => void projectsActions.loadCiRun(runId)}
              onRetry={(runId) => void projectsActions.retryCiRun(runId).then((run) => { if (run) projectsActions.openCiRun(run.id) })}
              onRetryFromStep={(runId, selection) => { void projectsActions.retryCiRunFromStep(runId, selection); projectsActions.openCiRun(runId) }}
              onDiscardAndRetry={(runId) => void projectsActions.discardCiWorkspaceAndRetry(runId).then((run) => { if (run) projectsActions.openCiRun(run.id) })}
              onCancel={(runId) => void projectsActions.cancelCiRun(runId)}
              onAnswerInteraction={(runId, interactionId, answer) => void projectsActions.answerCiInteraction(runId, interactionId, answer)}
            />
          </div>
        </ToolFrame>
      )}

      {!settingsState.settings.onboarded && (
        <OnboardingModal
          modelPresent={settingsState.modelPresent}
          modelLabel={settingsState.settings.whisperModel}
          downloading={settingsState.downloading}
          downloadPercent={settingsState.downloadPercent}
          onDownloadModel={settingsActions.downloadModel}
          hasVoice={settingsState.ttsVoices.length > 0}
          onDone={settingsActions.completeOnboarding}
        />
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <HotkeysCheatSheet open={cheatSheetOpen} onClose={() => setCheatSheetOpen(false)} />

      {shell.settingsOpen && (
        <SettingsModal
          settings={settingsState.settings}
          engines={settingsState.llmEngines}
          mics={settingsState.mics}
          voices={settingsState.ttsVoices}
          voiceCatalog={settingsState.voiceCatalog}
          voicesDownloadable={settingsState.voicesDownloadable}
          voiceDownloads={settingsState.voiceDownloads}
          whisperModels={settingsState.whisperModels}
          capabilities={settingsState.capabilities}
          mcpServers={settingsState.mcpServers}
          loginStatus={settingsState.loginStatus}
          onDownloadDesktopApp={() => void operationsActions.downloadDesktopApp()}
          onDownloadAgentApp={() => void operationsActions.downloadAgentApp()}
          onDownloadAgentScript={() => void operationsActions.downloadAgentScript()}
          onChange={settingsActions.updateSettings}
          onDownloadVoice={settingsActions.downloadVoice}
          onDeleteVoice={settingsActions.deleteVoice}
          onDeleteModel={settingsActions.deleteModel}
          role={session.currentUser?.role ?? 'admin'}
          llmAccess={settingsState.llmAccess}
          voiceInputEnabled={VOICE_INPUT_ENABLED}
          onClose={shellActions.closeSettings}
        />
      )}
    </div>
  )
}
