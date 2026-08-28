import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { isReaderConversation, parseChatRoute } from '@voicechat/chat-app'
import { parseOperationsRoute } from '@voicechat/operations-app'
import { parseProjectsRoute } from '@voicechat/projects-app'
import type { RendererApi } from '@shared/ipc'
import { summarizeConversationUsage } from '@shared/usageSummary'
import { MakeSharedView } from './components/MakeSharedView'
import type { EditorContextPayload, LlmProvider, PermissionMode, TaskLaunchProposal } from '@shared/types'
import { allowedModels, isProviderAllowed } from '@shared/llmAccess'
import { recommendedChatStoragePath, validateStorageRelativePath, type Board, type ChatStorageView, type MachineStorage, type ProjectMember, type Task } from '@shared/projects'
import { AGENT_VERSION } from '@shared/version'
import type { RoleCommandPolicies } from '@shared/commandPolicy'
import type { PreparationClarificationNotification } from '@shared/qa'
import type { KanbanAssistantSelection, SupportedTaskPatch, WidgetAssistantCommand, WidgetAssistantContext, WidgetUserAction } from '@shared/widgetAssistant'
import type { HealthResponse } from '@shared/protocol'
import type { PreviewElementPayload } from '@shared/previewInspector'
import { WebReaderFrame, type PreviewActionOutcome, type ReaderHostRegistration, type WebRecorderAreaScreenshot } from '@voicechat/web-reader-app'
import { BrowserSessionPane } from './components/BrowserSessionPane'
import { ConsoleSessionPane } from './components/ConsoleSessionPane'
import { MakePane } from './components/MakePane'
import { SessionsDialog, describeUserAgent } from './components/SessionsDialog'
import { TwoFactorDialog } from './components/TwoFactorDialog'
import { InviteRegister } from './components/InviteRegister'
import { ChangePasswordDialog } from './components/ChangePasswordDialog'
import { SignupScreen, VerifyScreen } from './components/SignupScreen'
import { NewProjectDialog } from './components/NewProjectDialog'
import { InviteScreen } from './components/InviteScreen'
import { ALL_PROJECT_FEATURES } from '@shared/projectTypes'
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
import { PopupFrame } from './components/PopupFrame'
import { UiProviders } from '@voicechat/ui-kit'
import { Button } from '@voicechat/ui-kit'
import { Skeleton } from '@voicechat/ui-kit'
import { useToast } from '@voicechat/ui-kit'
import { useConfirm } from '@voicechat/ui-kit'
import { KnowledgeBase } from './components/KnowledgeBase'
import { NotificationContainer } from './components/ClarificationNotification'
import { KbUsagePanel } from './components/kb/KbUsagePanel'
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
import { isWebReaderDiagnosticsCommand, runWebReaderDiagnostics } from './webReaderDiagnostics'
import { isChatDiagnosticsCommand, runChatDiagnostics } from './chatDiagnostics'
import { isPlaywrightReaderDiagnosticsCommand, runPlaywrightReaderDiagnostics } from './playwrightReaderDiagnostics'
import { isConsoleReaderDiagnosticsCommand, runConsoleReaderDiagnostics } from './consoleReaderDiagnostics'
import { isMakeDiagnosticsCommand, runMakeDiagnostics } from './makeDiagnostics'
import { REST as REST_PATHS } from '@shared/protocol'
import { consolePtyId } from '@shared/types'
const PREVIEW_ACTIVE_REGISTRATION_KEY = 'voicechat:web-reader-active-registration:v1'

const UsersAdmin = lazy(async () => {
  const module = await import('@voicechat/admin-app')
  return { default: module.UsersAdmin }
})

import './styles/app.css'
import '@voicechat/operations-app/styles.css'
import '@voicechat/admin-app/styles.css'

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
const HOST_UTILITY_PAGES: readonly string[] = ['users', 'personalization', 'make-shared']

// Запуск задачи предлагает только явный структурированный сигнал ассистента.

/** Открывает независимое рабочее пространство, не меняя маршрут исходного чата. */
export function openWebReaderWorkspace(): void {
  const url = new URL(window.location.href)
  url.hash = '#/web-reader'
  window.open(url.toString(), '_blank', 'noopener,noreferrer')
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
  const chatRoute = parseChatRoute(path)
  if (chatRoute?.kind === 'chat' || chatRoute?.kind === 'context-item') return chatRoute.conversationId
  if (segments[0] === 'web-reader' || segments[0] === 'web-recorder' || segments[0] === 'playwright-reader' || segments[0] === 'console-reader' || segments[0] === 'make') {
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
  const operationsRoute = parseOperationsRoute(path)
  const utilitySeg = operationsRoute
    ? operationsRoute.page === 'history' ? (operationsRoute.engine === 'claude' ? 'claude-code' : 'codex') : operationsRoute.page === 'knowledge' ? 'kb' : operationsRoute.page
    : segments.length >= 1 && HOST_UTILITY_PAGES.includes(segments[0]) && (segments.length === 1 || ((segments[0] === 'users' || segments[0] === 'make-shared') && segments.length === 2)) ? segments[0] : null
  const routeKbDocumentId = operationsRoute?.page === 'knowledge' ? (operationsRoute.documentId ?? null) : null
  const routeUserName = segments[0] === 'users' ? (segments[1] ?? null) : null
  const onUtilityPage = utilitySeg !== null
  // Адрес открытого чата: #/chat/:id. Экран чата — всё, что не проекты и не
  // утилита («#/» тоже: с него сразу уводим на #/chat/:id активного чата).
  const chatRoute = parseChatRoute(path)
  const routeChatId = chatRoute?.kind === 'chat' || chatRoute?.kind === 'context-item' ? chatRoute.conversationId : routeTaskChatId
  const legacyReaderRoute = segments[0] === 'web-recorder'
  const inReader = segments[0] === 'web-reader' || legacyReaderRoute
  const routeReaderChatId = inReader ? (segments[1] ?? null) : null
  const inPlaywrightReader = segments[0] === 'playwright-reader'
  const routePlaywrightReaderChatId = inPlaywrightReader ? (segments[1] ?? null) : null
  const inConsoleReader = segments[0] === 'console-reader'
  const routeConsoleReaderChatId = inConsoleReader ? (segments[1] ?? null) : null
  const inMake = segments[0] === 'make'
  const routeMakeChatId = inMake ? (segments[1] ?? null) : null
  // Любой полноэкранный split-режим «чат | панель справа».
  const inSplit = inReader || inPlaywrightReader || inConsoleReader || inMake
  const inTaskChat = routeTaskChatId !== null
  const inChat = (!inProjects && !onUtilityPage && !inSplit) || inTaskChat
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
  // Возможности типа открытого проекта. Пока detail грузится, берём их из
  // summary в списке проектов: там уже есть typeChain, и вкладка «Релизы» не
  // мигает «показана → скрыта» при каждом входе в проект без релизов.
  const routeProjectSummary = routeProjectId ? projects.projects.find((p) => p.id === routeProjectId) : undefined
  const projectFeatures =
    projects.projectDetail?.typeChain.features ??
    routeProjectSummary?.typeChain?.features ??
    ALL_PROJECT_FEATURES
  /** Диалог «Сессии и устройства» (auth-roadmap п.4). */
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [twoFactorOpen, setTwoFactorOpen] = useState(false)
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  // Открытая регистрация: спрашиваем сервер один раз, пока пользователь не вошёл.
  const [signupOpen, setSignupOpen] = useState(() => window.location.hash === '#/signup')
  const [signupEnabled, setSignupEnabled] = useState(false)
  useEffect(() => {
    if (!session.authRequired || session.currentUser || !window.session?.signupEnabled) return
    let alive = true
    void window.session.signupEnabled().then((v) => { if (alive) setSignupEnabled(v) })
    return () => { alive = false }
  }, [session.authRequired, session.currentUser])
  // Уведомление о входе с нового устройства (auth-roadmap п.16): после входа/восстановления сессии показываем и отмечаем просмотренными.
  useEffect(() => {
    const name = session.currentUser?.name
    if (!name || !window.session?.securityNotices) return
    let alive = true
    void window.session.securityNotices().then((list) => {
      if (!alive || list.length === 0) return
      for (const n of list.slice(-3)) toast.info(`Вход в ваш аккаунт с нового устройства: ${describeUserAgent(n.userAgent)} · ${n.ip || 'адрес неизвестен'} · ${new Date(n.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}. Не вы — завершите сессии в меню аккаунта.`)
      void window.session?.securityNoticesSeen?.()
    }).catch(() => undefined)
    return () => { alive = false }
  }, [session.currentUser?.name]) // eslint-disable-line react-hooks/exhaustive-deps
  const [release, setRelease] = useState<HealthResponse | null>(null)
  const [chatView, setChatView] = useState<'chat' | 'preview'>('chat')
  const [previewElement, setPreviewElement] = useState<PreviewElementPayload | null>(null)
  // Открытый файл/выделение в Make — уходит вместе с сообщением (п.21).
  const [makeEditorContext, setMakeEditorContext] = useState<EditorContextPayload | null>(null)
  // Откат правок хода Make (roadmap-2 п.2): восстановить снимок «До правок»; текущее состояние сохранится отдельным снимком.
  const restoreMakeTurn = async (snapshotId: string): Promise<void> => {
    if (!chat.activeId || !window.api) return
    if (!(await confirm({ title: 'Откатить правки этого ответа?', message: 'Файлы проекта вернутся к состоянию до правок; текущее состояние сохранится снимком «Перед восстановлением».', confirmLabel: 'Откатить' }))) return
    try { await window.api['make:restore']({ conversationId: chat.activeId, snapshotId }); toast.success('Правки откачены') } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }
  const [makeAskOnly, setMakeAskOnly] = useState(false)
  const askRestoreRef = useRef<PermissionMode | null>(null)
  useEffect(() => {
    if (voice.voice !== 'idle' || !askRestoreRef.current) return
    const prev = askRestoreRef.current; askRestoreRef.current = null
    setMakeAskOnly(false)
    // Возврат режима без диалога подтверждения: пользователь его не менял, это откат нашего временного «Плана».
    if (activeConversation) void chatActions.setConversationExecTarget(activeConversation.id, activeConversation.execTarget ?? null, undefined, undefined, undefined, undefined, prev)
    else void settingsActions.updateSettings({ permissionMode: prev })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.voice])
  const makeUsage = useMemo(() => (inMake ? summarizeConversationUsage(chat.messages) : null), [inMake, chat.messages])
  const [activeProjectPreviewUrl, setActiveProjectPreviewUrl] = useState<string | null>(null)
  const [assistantOpen, setAssistantOpen] = useState(() => globalThis.localStorage?.getItem('voicechat.kanbanAssistantOpen') === '1')
  const [assistantConversationId, setAssistantConversationId] = useState<string | null>(null)
  const [assistantTaskId, setAssistantTaskId] = useState<string | null>(null)
  const [assistantField, setAssistantField] = useState<keyof SupportedTaskPatch | null>(null)
  const [widgetActions, setWidgetActions] = useState<WidgetUserAction[]>([])
  const [clarificationNotifications, setClarificationNotifications] = useState<PreparationClarificationNotification[]>([])
  const [clarificationErrors, setClarificationErrors] = useState<Record<string, string>>({})
  const [clarificationNavigatingId, setClarificationNavigatingId] = useState<string | null>(null)
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
  // Действия модели в превью (mcp__browser__*): регистрацию iframe создаёт
  // мост WebReaderFrame (registrationId ротируется на каждый boot Reader).
  // Хранение её вместе с conversationId не даёт переключившемуся чату обратиться
  // к host, который ещё размонтируется, и держит Reader-маршруты источником истины.
  const previewRunnerRef = useRef<ReaderHostRegistration | null>(null)
  // Платформенная привязка WebReaderFrame: пакет Reader не трогает window сам.
  const readerPlatform = useMemo(() => ({
    origin: window.location.origin,
    subscribeMessages: (listener: (event: MessageEvent) => void) => {
      window.addEventListener('message', listener)
      return () => window.removeEventListener('message', listener)
    }
  }), [])
  const diagnosticsControllerRef = useRef<AbortController | null>(null)
  useEffect(() => () => diagnosticsControllerRef.current?.abort(), [])
  useEffect(() => { diagnosticsControllerRef.current?.abort(); diagnosticsControllerRef.current = null }, [chat.activeId])
  const registerReaderHost = useCallback((registration: ReaderHostRegistration | null) => {
    if (registration && registration.conversationId === chat.activeId) {
      previewRunnerRef.current = registration
      globalThis.localStorage?.setItem(PREVIEW_ACTIVE_REGISTRATION_KEY, registration.registrationId)
    }
    // Снятие регистрации размонтированным host не должно стирать регистрацию
    // нового: обнуляем только запись собственного разговора.
    else if (!registration && previewRunnerRef.current?.conversationId === chat.activeId) previewRunnerRef.current = null
  }, [chat.activeId])
  useEffect(() => {
    const claimActiveTab = (): void => {
      const registration = previewRunnerRef.current
      if (registration) globalThis.localStorage?.setItem(PREVIEW_ACTIVE_REGISTRATION_KEY, registration.registrationId)
    }
    window.addEventListener('focus', claimActiveTab)
    return () => window.removeEventListener('focus', claimActiveTab)
  }, [])
  useEffect(() => {
    const bridge = window.preview
    if (!bridge) return
    return bridge.onAction(({ conversationId, requestId, action }) => {
      void (async (): Promise<PreviewActionOutcome> => {
        // Активный чат остаётся первым рубежом изоляции. Зарегистрированный
        // host — источник истины для Reader-панели: флаг hash-маршрута может на один
        // render отставать от уже подключённой панели.
        if (chat.activeId !== conversationId) {
          return { ok: false, error: 'Этот чат сейчас не открыт на странице Reader — панель превью недоступна.' }
        }
        const registration = previewRunnerRef.current
        if (!registration || registration.conversationId !== conversationId || globalThis.localStorage?.getItem(PREVIEW_ACTIVE_REGISTRATION_KEY) !== registration.registrationId) {
          return {
            ok: false,
            error: inReader || inPlaywrightReader
              ? 'Панель превью активного чата не открыта или ещё не подключена.'
              : 'Этот чат сейчас не открыт на странице Reader — панель превью недоступна.'
          }
        }
        if (action.kind === 'open') {
          try {
            await chatActions.setConversationPreviewUrl(conversationId, action.url)
            setPreviewElement(null)
            return registration.run(action)
          } catch {
            return { ok: false, error: 'Не удалось сохранить адрес превью.' }
          }
        }
        return registration.run(action)
      })().then((outcome) => bridge.result({ conversationId, registrationId: previewRunnerRef.current?.registrationId, requestId, ...outcome }))
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
  // Долгая команда машины завершилась: тост с переходом к логу/журналу; во вкладке в фоне — системное уведомление, если разрешено.
  useEffect(() => {
    const realtime = window.realtime
    if (!realtime?.onMachineCommand) return
    return realtime.onMachineCommand((event) => {
      const seconds = Math.round(event.durationMs / 1000)
      const outcome = event.error ? `ошибка: ${event.error}` : event.timedOut ? 'таймаут' : `код ${event.exitCode ?? '—'}`
      const text = `«${event.machineName}»: команда завершилась (${outcome}, ${seconds} с) — ${event.command.slice(0, 60)}`
      const action = event.logPath
        ? { label: 'Открыть лог', onClick: () => operationsActions.openUtility('explorer', event.machineId, event.logPath) }
        : { label: 'Журнал', onClick: () => navigate('/machines') }
      if (event.error || (event.exitCode !== null && event.exitCode !== 0)) toast.error(text, { action, duration: 0 })
      else toast.success(text, { action, duration: 8000 })
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        try { new Notification('Команда на машине завершилась', { body: text }) } catch { /* без системных уведомлений */ }
      }
    })
  }, [toast, navigate, operationsActions])
  // Ролевые правила команд (п.10) — читаются при открытии админки.
  const [roleCommandPolicies, setRoleCommandPolicies] = useState<RoleCommandPolicies | null>(null)
  useEffect(() => {
    if (!admin.usersOpen || !window.api || session.currentUser?.role !== 'admin') return
    window.api['admin:commandPolicy']().then((r) => setRoleCommandPolicies(r.roles)).catch(() => setRoleCommandPolicies({}))
    // Очередь типов на утверждение — там же, при открытии админки.
    void adminActions.refreshPendingProjectTypes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin.usersOpen, session.currentUser?.role])
  // Watchdog: машина пропала дольше порога / вернулась.
  useEffect(() => {
    const realtime = window.realtime
    if (!realtime?.onMachineStatus) return
    return realtime.onMachineStatus((event) => {
      const minutes = Math.max(1, Math.round(event.offlineForMs / 60_000))
      const action = { label: 'Машины', onClick: () => navigate('/machines') }
      if (event.state === 'offline') toast.error(`Машина «${event.machineName}» не в сети уже ${minutes} мин — проверьте агент на ней.`, { action, duration: 0 })
      else toast.success(`Машина «${event.machineName}» снова в сети (не было ${minutes} мин).`, { action })
    })
  }, [toast, navigate])
  const confirm = useConfirm()
  // Снимок области из Reader: PNG уходит вложением композера, координаты — в черновик.
  const attachAreaScreenshot = useCallback((shot: WebRecorderAreaScreenshot) => {
    try {
      const [meta, data] = shot.dataUrl.split(',')
      const mime = /data:([^;]+)/.exec(meta ?? '')?.[1] ?? 'image/png'
      const binary = atob(data ?? '')
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const file = new File([bytes], `web-reader-area-${shot.rect.width}x${shot.rect.height}.${mime === 'image/jpeg' ? 'jpg' : 'png'}`, { type: mime })
      void chatActions.addAttachment(file)
      const note = `Скриншот области страницы ${shot.pageUrl}: x=${shot.rect.x}, y=${shot.rect.y}, размер ${shot.rect.width}×${shot.rect.height} px.`
      chatActions.setDraft(chat.draft.trim() ? chat.draft + '\n' + note : note)
      toast.success('Снимок области добавлен в композер')
    } catch {
      toast.error('Не удалось обработать снимок области.')
    }
  }, [chat.draft, chatActions, toast])

  const authed = !session.authRequired || Boolean(session.currentUser)
  const refreshClarificationNotifications = useCallback(async (): Promise<PreparationClarificationNotification[]> => {
    if (!authed) { setClarificationNotifications([]); return [] }
    const snapshot = await api['tasks:listPreparationNotifications']()
    const visible = snapshot.filter((item) => item.dismissedAt == null)
    setClarificationNotifications((previous) => [
      ...visible,
      ...previous.filter((item) => clarificationErrors[item.questionId] && !visible.some((next) => next.questionId === item.questionId))
    ])
    return snapshot
  }, [api, authed, clarificationErrors])
  useEffect(() => {
    if (!authed) { setClarificationNotifications([]); return }
    let active = true
    let inFlight = false
    let trailing = false
    let debounceTimer: number | null = null

    const synchronize = async (): Promise<void> => {
      if (!active) return
      if (inFlight) { trailing = true; return }
      inFlight = true
      try {
        await refreshClarificationNotifications()
      } catch {
        // Ошибка фоновой синхронизации сохраняет последний успешный снимок.
      } finally {
        inFlight = false
        if (active && trailing) {
          trailing = false
          schedule()
        }
      }
    }
    const schedule = (): void => {
      if (!active) return
      if (debounceTimer !== null) window.clearTimeout(debounceTimer)
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null
        void synchronize()
      }, 75)
    }
    const onVisible = (): void => { if (document.visibilityState === 'visible') schedule() }
    const realtime = window.realtime
    const unsubs = realtime
      ? [
          realtime.onConnected(schedule),
          realtime.onTaskPreparationNotificationsInvalidated(schedule),
          // Приглашение приходит, пока человек уже в приложении: без этого он
          // увидел бы его только после перезагрузки страницы.
          ...(realtime.onInvitationsInvalidated ? [realtime.onInvitationsInvalidated(() => { void projectsActions.loadMyInvitations() })] : [])
        ]
      : []

    // Авторизация — первая контрольная точка; connect того же тика схлопнется debounce.
    schedule()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      active = false
      if (debounceTimer !== null) window.clearTimeout(debounceTimer)
      document.removeEventListener('visibilitychange', onVisible)
      unsubs.forEach((unsubscribe) => unsubscribe())
    }
  }, [authed, refreshClarificationNotifications])

  const dismissClarificationNotification = useCallback(async (notification: PreparationClarificationNotification): Promise<void> => {
    try {
      await api['tasks:dismissPreparationNotification']({ questionId: notification.questionId })
      setClarificationNotifications((items) => items.filter((item) => item.questionId !== notification.questionId))
      setClarificationErrors((errors) => { const next = { ...errors }; delete next[notification.questionId]; return next })
    } catch (reason) {
      setClarificationErrors((errors) => ({ ...errors, [notification.questionId]: reason instanceof Error ? reason.message : String(reason) }))
    }
  }, [api])

  const openClarificationNotification = useCallback(async (notification: PreparationClarificationNotification): Promise<void> => {
    setClarificationNavigatingId(notification.questionId)
    setClarificationErrors((errors) => { const next = { ...errors }; delete next[notification.questionId]; return next })
    try {
      // Проверка перехода не применяет снимок до успеха: если вопрос исчез во
      // время клика, карточка уведомления остаётся видимой вместе с ошибкой.
      const snapshot = await api['tasks:listPreparationNotifications']()
      const current = snapshot.find((item) => item.questionId === notification.questionId && item.dismissedAt == null)
      if (!current) throw new Error('Вопрос уже неактуален или недоступен.')
      setClarificationNotifications(snapshot.filter((item) => item.dismissedAt == null))
      navigate(`/projects/${current.projectId}/task/${current.taskId}/preparation`)
    } catch (reason) {
      setClarificationNotifications((items) => items.some((item) => item.questionId === notification.questionId) ? items : [...items, notification])
      setClarificationErrors((errors) => ({ ...errors, [notification.questionId]: reason instanceof Error ? reason.message : String(reason) }))
    } finally {
      setClarificationNavigatingId(null)
    }
  }, [api, navigate])
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
  const [conversationSettingsOpen, setConversationSettingsOpen] = useState(chatRoute?.kind === 'context-item')
  useEffect(() => {
    if (chatRoute?.kind === 'context-item') setConversationSettingsOpen(true)
  }, [chatRoute?.kind])
  const [createChatOpen, setCreateChatOpen] = useState(false)
  const [createChatTitle, setCreateChatTitle] = useState('Новый разговор')
  const [createChatMachineId, setCreateChatMachineId] = useState('')
  const [createChatStorages, setCreateChatStorages] = useState<MachineStorage[]>([])
  const [createChatStorageId, setCreateChatStorageId] = useState('')
  const [createChatPath, setCreateChatPath] = useState('')
  const [createChatError, setCreateChatError] = useState<string | null>(null)
  const [createChatSaving, setCreateChatSaving] = useState(false)
  useEffect(() => {
    if (!createChatOpen) return
    const effective = operations.agents.find((agent) => agent.isEffective && agent.online)
      ?? operations.agents.find((agent) => agent.id === settingsState.settings.defaultAgentId && agent.online)
      ?? operations.agents.find((agent) => agent.online)
    setCreateChatMachineId(effective?.id ?? '')
  }, [createChatOpen, operations.agents, settingsState.settings.defaultAgentId])
  useEffect(() => {
    let alive = true
    if (!createChatOpen || !createChatMachineId) { setCreateChatStorages([]); setCreateChatStorageId(''); return }
    void api['agents:listStorages']({ id: createChatMachineId }).then((items) => {
      if (!alive) return
      setCreateChatStorages(items)
      const primaryReady = items.find((item) => item.primary && item.status === 'ready') ?? items.find((item) => item.status === 'ready')
      setCreateChatStorageId(primaryReady?.id ?? '')
    }).catch((error) => { if (alive) setCreateChatError(error instanceof Error ? error.message : String(error)) })
    return () => { alive = false }
  }, [api, createChatOpen, createChatMachineId])
  const submitCreateChat = async (): Promise<void> => {
    if (!createChatTitle.trim()) { setCreateChatError('Введите название разговора.'); return }
    if (createChatPath.trim()) {
      try { validateStorageRelativePath(createChatPath.trim()) } catch { setCreateChatError('Укажите безопасный относительный каталог без абсолютного пути, пустых сегментов и ..'); return }
    }
    setCreateChatSaving(true); setCreateChatError(null)
    try {
      const id = await chatActions.createConversation({ title: createChatTitle.trim(), projectId: chat.sidebarProjectId })
      if (createChatMachineId && createChatStorageId) {
        const relativePath = createChatPath.trim() || recommendedChatStoragePath(
          chat.sidebarProjectId
            ? { kind: 'project', projectId: chat.sidebarProjectId, conversationId: id }
            : { kind: 'chat', conversationId: id }
        )
        await api['conversations:setStorage']({ id, machineId: createChatMachineId, storageId: createChatStorageId, relativePath })
      }
      setCreateChatOpen(false); setCreateChatPath(''); setSidebarOpen(false); navigate(`/chat/${id}`)
    } catch (error) {
      setCreateChatError(error instanceof Error ? error.message : String(error))
    } finally { setCreateChatSaving(false) }
  }
  const [taskProposal, setTaskProposal] = useState<{
    projectId: string
    messageId: string
    proposalId: string
    board: Board
    projectName: string
    members: ProjectMember[]
    task: Task
    provider: LlmProvider
    model: string
  } | null>(null)
  const [taskLaunchPending, setTaskLaunchPending] = useState(false)
  // Режим списка сайдбара: маршрут ведёт его автоматически, ручной выбор
  // (переключатель) живёт до следующей смены маршрута.
  const [sidebarMode, setSidebarMode] = useState<'chats' | 'projects'>('chats')
  const [sidebarWidth, setSidebarWidth] = useState(264)
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
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [creatingProject, setCreatingProject] = useState(false)
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
      project: project ? { id: project.id, name: project.name, description: project.description, technologies: project.technologies, skills: project.skills, typeChain: project.typeChain } : null,
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
      toggleTheme: () => void settingsActions.updateSettings({ theme: settingsState.settings.theme === 'light' ? 'dark' : 'light' }),
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
  const syncedChatId = useRef<string | null>(routeChatId ?? routeReaderChatId ?? routePlaywrightReaderChatId ?? routeConsoleReaderChatId ?? routeMakeChatId)
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

  const consoleReaderCreating = useRef(false)
  const createConsoleReaderChat = (replace = false): void => {
    if (consoleReaderCreating.current) return
    consoleReaderCreating.current = true
    void chatActions.newConversation('console-reader')
      .then((id) => { if (id) navigate(`/console-reader/${id}`, { replace }) })
      .catch(() => { /* store owns the visible error */ })
      .finally(() => { consoleReaderCreating.current = false })
  }
  useEffect(() => {
    if (!authed || !inConsoleReader || chat.conversationsStatus !== 'ready' || consoleReaderCreating.current) return
    const chats = chat.consoleReaderConversations
    const routed = chats.find((item) => item.id === routeConsoleReaderChatId)
    if (routed) {
      if (routed.id !== chat.activeId) void chatActions.selectConversation(routed.id)
      return
    }
    const fallback = chats[0]
    if (fallback) { navigate(`/console-reader/${fallback.id}`, { replace: true }); return }
    createConsoleReaderChat(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, inConsoleReader, routeConsoleReaderChatId, chat.activeId, chat.consoleReaderConversations, chat.conversationsStatus, chatActions, navigate])
  // Make: те же правила маршрутизации, что у Консоли (адрес → активный проект, иначе первый/новый).
  const makeCreating = useRef(false)
  const createMakeChat = (replace = false): void => {
    if (makeCreating.current) return
    makeCreating.current = true
    void chatActions.newConversation('make')
      .then((id) => { if (id) navigate(`/make/${id}`, { replace }) })
      .catch(() => { /* store owns the visible error */ })
      .finally(() => { makeCreating.current = false })
  }
  useEffect(() => {
    if (!authed || !inMake || chat.conversationsStatus !== 'ready' || makeCreating.current) return
    const chats = chat.makeConversations
    const routed = chats.find((item) => item.id === routeMakeChatId)
    if (routed) {
      if (routed.id !== chat.activeId) void chatActions.selectConversation(routed.id)
      return
    }
    const fallback = chats[0]
    if (fallback) { navigate(`/make/${fallback.id}`, { replace: true }); return }
    createMakeChat(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, inMake, routeMakeChatId, chat.activeId, chat.makeConversations, chat.conversationsStatus, chatActions, navigate])

  // URL → данные стора: вход/выход в раздел «Проекты», загрузка доски и
  // оверлея настроек. Навигацию делают клики (navigate), данные грузятся тут.
  useEffect(() => {
    if (!authed) return
    if (inProjects) {
      if (!projects.projectsOpen) void projectsActions.openProjects()
      // Свои приглашения нужны бейджу в сайдбаре и списку на пустой странице.
      void projectsActions.loadMyInvitations()
    }
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
  // Каталог типов нужен разделу «Типы проектов» в пользовательских настройках.
  useEffect(() => {
    if (authed && shell.settingsOpen && !projects.projectTypesLoaded) void projectsActions.loadProjectTypes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, shell.settingsOpen])
  useEffect(() => {
    if (!authed) return
    if (routeSettings || routeReleases) {
      if (!projects.projectSettingsOpen) projectsActions.openProjectSettings()
      // Каталог нужен селекту типа на вкладке «Общее».
      if (routeSettings && !projects.projectTypesLoaded) void projectsActions.loadProjectTypes()
      if (routeSettings && routeProjectId) void projectsActions.loadProjectInvitations(routeProjectId)
    }
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
    if (utilitySeg === 'users' && session.currentUser?.role === 'admin') {
      if (!admin.usersOpen) void runtime.openAdmin()
    } else if (admin.usersOpen) {
      adminActions.closeUsers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utilitySeg, session.currentUser?.role])
  useEffect(() => {
    if (utilitySeg !== 'users' || !routeUserName || !admin.usersOpen || admin.adminSelected === routeUserName) return
    void adminActions.selectAdminUser(routeUserName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utilitySeg, routeUserName, admin.usersOpen, admin.adminSelected])
  // Гейты: «Пользователи» — только админ; машины/пользователи — только web.
  useEffect(() => {
    if (utilitySeg === 'users' && session.currentUser && session.currentUser.role !== 'admin') navigate('/')
    if ((utilitySeg === 'users' || utilitySeg === 'machines' || utilitySeg === 'ci') && !session.authRequired) navigate('/')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utilitySeg, routeUserName, session.currentUser, session.authRequired])

  // Активный чат может быть ещё не выбран или не быть reader-чатом (грузится по
  // ссылке): подсвечивать вместо него первый пункт селектора нельзя — покажем плейсхолдер.
  const readerActiveListed = chat.readerConversations.some((c) => c.id === chat.activeId)
  const playwrightReaderActiveListed = chat.playwrightReaderConversations.some((c) => c.id === chat.activeId)
  const consoleReaderActiveListed = chat.consoleReaderConversations.some((c) => c.id === chat.activeId)
  const makeActiveListed = chat.makeConversations.some((c) => c.id === chat.activeId)
  // Reader route is authoritative. While its asynchronous conversation selection is
  // pending, the previous ChatColumn must not remain interactive: otherwise a user
  // can submit a turn for the old activeId while already seeing the new Reader URL.
  const readerRouteReady =
    !inReader ||
    (routeReaderChatId !== null && chat.activeId === routeReaderChatId && readerActiveListed)
  const playwrightReaderRouteReady =
    !inPlaywrightReader ||
    (routePlaywrightReaderChatId !== null &&
      chat.activeId === routePlaywrightReaderChatId &&
      playwrightReaderActiveListed)
  const consoleReaderRouteReady =
    !inConsoleReader ||
    (routeConsoleReaderChatId !== null &&
      chat.activeId === routeConsoleReaderChatId &&
      consoleReaderActiveListed)
  const makeRouteReady = !inMake || (routeMakeChatId !== null && chat.activeId === routeMakeChatId && makeActiveListed)
  const readerSurfaceReady = readerRouteReady && playwrightReaderRouteReady && consoleReaderRouteReady && makeRouteReady
  const activeConversation = chat.conversations.find((c) => c.id === chat.activeId)
  // Каталог результатов активного чата — для чипа в шапке; обновляется при смене чата, закрытии настроек и после хода.
  const [activeStorage, setActiveStorage] = useState<ChatStorageView | null>(null)
  useEffect(() => {
    const id = chat.activeId
    if (!id || !window.api) { setActiveStorage(null); return }
    let cancelled = false
    window.api['conversations:getStorage']({ id }).then((view) => { if (!cancelled) setActiveStorage(view) }).catch(() => { if (!cancelled) setActiveStorage(null) })
    return () => { cancelled = true }
  }, [chat.activeId, conversationSettingsOpen, voice.voice])
  const startWebReaderDiagnostics = useCallback((): void => {
    const conversationId = chat.activeId
    if (!inReader || !conversationId || !activeConversation || !isReaderConversation(activeConversation)) {
      toast.error('Самодиагностика доступна только в активном Web Reader-чате.')
      return
    }
    const registration = previewRunnerRef.current
    if (!registration || registration.conversationId !== conversationId) {
      toast.error('Панель превью активного чата не открыта или ещё не подключена.')
      return
    }
    diagnosticsControllerRef.current?.abort()
    const controller = new AbortController()
    diagnosticsControllerRef.current = controller
    setConversationSettingsOpen(false)
    // diagnostics-start переводит Reader в режим прогресс-панели и глушит запись
    // сценария на время проверок; finally гарантирует выключение режима.
    registration.beginDiagnostics()
    void runWebReaderDiagnostics({
      origin: window.location.origin,
      run: registration.run,
      handshake: {
        conversationId: registration.conversationId,
        registrationId: registration.registrationId,
        capabilities: registration.capabilities,
        expectedConversationId: conversationId,
        claimedRegistrationId: globalThis.localStorage?.getItem(PREVIEW_ACTIVE_REGISTRATION_KEY) ?? null
      },
      ensurePreview: window.session?.ensurePreview,
      signal: controller.signal,
      publish: (text) => chatActions.publishDiagnosticMessage(conversationId, text)
    }).finally(() => {
      registration.endDiagnostics()
      if (diagnosticsControllerRef.current === controller) diagnosticsControllerRef.current = null
    })
  }, [activeConversation, chat.activeId, chatActions, inReader, toast])
  // Самодиагностика чата: сквозная проверка «клиент → сервер → модель → БД»
  // публикуется служебными AI-сообщениями в текущий чат (без запуска LLM).
  // Пробы замыкают мосты window.* и стор; persistence идёт через api напрямую,
  // чтобы эфемерный разговор не попал в сайдбар.
  const startChatDiagnostics = useCallback((): void => {
    const conversationId = chat.activeId
    if (!conversationId) { toast.error('Откройте разговор, чтобы запустить самодиагностику чата.'); return }
    diagnosticsControllerRef.current?.abort()
    const controller = new AbortController()
    diagnosticsControllerRef.current = controller
    // Ход диагностики виден в ленте — настройки разговора закрываем сразу.
    setConversationSettingsOpen(false)
    const engine = (): 'claude' | 'codex' => (activeConversation?.llmProvider ?? settingsState.settings.llmProvider) === 'codex' ? 'codex' : 'claude'
    void runChatDiagnostics({
      signal: controller.signal,
      publish: (text) => chatActions.publishDiagnosticMessage(conversationId, text),
      probes: {
        engine,
        ping: () => api['app:ping'](),
        wsConnected: () => window.realtime?.connected() ?? false,
        sessionMe: async () => (window.session ? window.session.me() : null),
        capabilities: () => api['system:capabilities'](),
        authStatus: () => api['auth:status'](),
        mcpList: () => api['mcp:list'](),
        modelRoundtrip: async () => {
          const { variants } = await api['prompt:suggest']({ prompt: 'ping', modifiers: [] })
          return variants.map((v) => v.text).join(' ')
        },
        createConversation: async () => (await api['conversations:create']({ title: 'Самодиагностика чата' })).id,
        echoMessage: async (id, marker) => {
          await api['messages:add']({ conversationId: id, role: 'u0', text: marker, time: new Date().toISOString() })
          const loaded = await api['conversations:get']({ id })
          return (loaded?.messages ?? []).some((m) => m.text === marker)
        },
        deleteConversation: (id) => api['conversations:delete']({ id }),
        storeSnapshot: () => ({ conversations: chat.conversations.length, activeId: chat.activeId })
      }
    }).finally(() => {
      if (diagnosticsControllerRef.current === controller) diagnosticsControllerRef.current = null
    })
  }, [activeConversation, api, chat.activeId, chat.conversations, chatActions, settingsState.settings.llmProvider, toast])
  // Самодиагностика Playwright Reader: проверяет путь изолированного Chromium
  // (мост window.browser) — старт сессии идемпотентен, поэтому переиспользует
  // живую панель, а reload не уводит открытую страницу.
  const startPlaywrightReaderDiagnostics = useCallback((): void => {
    const conversationId = chat.activeId
    if (!inPlaywrightReader || !conversationId) {
      toast.error('Самодиагностика доступна только в активном Playwright Reader-чате.')
      return
    }
    const browser = window.browser
    diagnosticsControllerRef.current?.abort()
    const controller = new AbortController()
    diagnosticsControllerRef.current = controller
    setConversationSettingsOpen(false)
    let incarnation: string | null = null
    void runPlaywrightReaderDiagnostics({
      signal: controller.signal,
      publish: (text) => chatActions.publishDiagnosticMessage(conversationId, text),
      probes: {
        bridgePresent: () => Boolean(browser),
        start: async () => {
          const meta = await browser!.start(conversationId, { width: 1280, height: 800, deviceScaleFactor: 1 })
          incarnation = meta.incarnation
          return meta
        },
        screenshot: async () => {
          if (!browser || !incarnation) throw new Error('сессия не поднята')
          const shot = await browser.screenshot(conversationId, { incarnation, format: 'jpeg', quality: 60 })
          return shot.dataUrl
        },
        reload: async () => {
          if (!browser || !incarnation) throw new Error('сессия не поднята')
          const meta = await browser.command(conversationId, { incarnation, command: { type: 'reload' } })
          incarnation = meta.incarnation
          return meta
        }
      }
    }).finally(() => {
      if (diagnosticsControllerRef.current === controller) diagnosticsControllerRef.current = null
    })
  }, [chat.activeId, chatActions, inPlaywrightReader, toast])
  // Самодиагностика Консоли: проверяет живой разделяемый PTY — мост, машину и
  // round-trip команды в shell (маркер, который не совпадает с эхом ввода).
  const startMakeDiagnostics = useCallback((): void => {
    const conversationId = chat.activeId
    if (!inMake || !conversationId || !window.api) {
      toast.error('Самодиагностика доступна только в активном проекте Make.')
      return
    }
    const api = window.api
    diagnosticsControllerRef.current?.abort()
    const controller = new AbortController()
    diagnosticsControllerRef.current = controller
    setConversationSettingsOpen(false)
    void runMakeDiagnostics({
      signal: controller.signal,
      publish: (text) => chatActions.publishDiagnosticMessage(conversationId, text),
      probes: {
        state: async () => { const s = await api['make:state']({ conversationId }); return { files: s.files.length, snapshots: s.snapshots.length } },
        previewStatus: async () => {
          await window.session?.ensurePreview?.()
          const res = await fetch(`${REST_PATHS.makePreview(conversationId)}index.html`, { credentials: 'include', cache: 'no-store' })
          return res.status
        },
        writeReadDelete: async (path, content) => {
          await api['make:write']({ conversationId, path, content })
          const read = await api['make:read']({ conversationId, path })
          await api['make:delete']({ conversationId, path })
          return read.content
        },
        waitChanged: (path, timeoutMs) => new Promise<boolean>((resolve) => {
          const bridge = window.make
          if (!bridge) { resolve(false); return }
          const timer = setTimeout(() => { off(); resolve(false) }, timeoutMs)
          const off = bridge.onChanged((m) => { if (m.conversationId === conversationId && m.paths.includes(path)) { clearTimeout(timer); off(); resolve(true) } })
        })
      }
    }).finally(() => {
      if (diagnosticsControllerRef.current === controller) diagnosticsControllerRef.current = null
    })
  }, [chat.activeId, chatActions, inMake, toast])

  const startConsoleReaderDiagnostics = useCallback((): void => {
    const conversationId = chat.activeId
    if (!inConsoleReader || !conversationId) {
      toast.error('Самодиагностика доступна только в активном чате Консоли.')
      return
    }
    const pty = window.pty
    diagnosticsControllerRef.current?.abort()
    const controller = new AbortController()
    diagnosticsControllerRef.current = controller
    setConversationSettingsOpen(false)
    const ptyId = consolePtyId(conversationId)
    void runConsoleReaderDiagnostics({
      signal: controller.signal,
      publish: (text) => chatActions.publishDiagnosticMessage(conversationId, text),
      probes: {
        bridgePresent: () => Boolean(pty),
        machineOnline: () => operations.agents.some((a) => a.online),
        ptyRoundtrip: (marker) => new Promise<boolean>((resolve) => {
          if (!pty) { resolve(false); return }
          // Маркер бьётся так, чтобы эхо введённой строки (`echo VC''DIAGX`) не
          // содержало непрерывный маркер, а вывод (`VCDIAGX`) — содержал: значит
          // shell реально выполнил команду, а не просто отобразил ввод.
          const half = Math.ceil(marker.length / 2)
          const typed = `echo ${marker.slice(0, half)}''${marker.slice(half)}\r`
          let buffer = ''
          let done = false
          const finish = (ok: boolean): void => { if (done) return; done = true; off(); clearTimeout(timer); resolve(ok) }
          const off = pty.onOutput((m) => {
            if (m.ptyId !== ptyId) return
            buffer += m.data
            if (buffer.includes(marker)) finish(true)
          })
          const timer = setTimeout(() => finish(false), 6000)
          pty.input({ ptyId, data: typed })
        })
      }
    }).finally(() => {
      if (diagnosticsControllerRef.current === controller) diagnosticsControllerRef.current = null
    })
  }, [chat.activeId, chatActions, inConsoleReader, operations.agents, toast])
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
    const detail = projects.projectDetail?.id === projectId
      ? projects.projectDetail
      : await api['projects:get']({ id: projectId })
    const currentUserName = session.currentUser?.name ?? detail?.members.find((member) => member.role === 'owner')?.username ?? project?.createdBy ?? null
    const now = Date.now()
    const provider = allowedProviders.includes(ciProvider) ? ciProvider : (allowedProviders[0] ?? ciProvider)
    const models = provider === 'codex' ? allowedCodexModels : allowedClaudeModels
    setTaskProposal({
      projectId,
      messageId,
      proposalId: request.id,
      board,
      projectName: detail?.name ?? project?.name ?? 'Проект',
      members: detail?.members ?? [],
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
        assignee: currentUserName,
        createdBy: currentUserName,
        createdByName: currentUserName,
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
    if (taskProposal && !taskProposal.task.assignee && session.currentUser?.name) {
      setTaskProposal({ ...taskProposal, task: { ...taskProposal.task, assignee: session.currentUser.name } })
    }
  }, [taskProposal, session.currentUser?.name])

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

  const chooseTaskLaunch = async (mode: 'todo' | 'preparation' | 'chat'): Promise<void> => {
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
      } else if (mode === 'preparation') {
        const result = await projectsActions.createTaskFromProposalInPreparation(taskProposal.projectId, `${taskProposal.messageId}:${taskProposal.proposalId}:preparation`, { ...task, selection: { provider: taskProposal.provider, model: taskProposal.model } })
        await chatActions.updateTaskLaunchStatus(taskProposal.messageId, taskProposal.proposalId, 'created', result)
        chatActions.setDraft('Пользователь выбрал: создать предложенную задачу в подготовке к разработке')
        await chatActions.submitText()
        if (result.type === 'preparation' && result.status === 'partial') {
          toast.error(`Задача создана, но подготовка не запущена: ${result.error}. Повторите действие безопасно.`)
          return
        }
        toast.success('Задача создана, подготовка запущена')
        setTaskProposal(null)
        navigate(`/projects/${taskProposal.projectId}/task/${result.taskId}`)
        return
      }
      await chatActions.updateTaskLaunchStatus(taskProposal.messageId, taskProposal.proposalId, mode === 'chat' ? 'declined' : 'created')
      setTaskProposal(null)
      const selection = mode === 'todo'
        ? 'Пользователь выбрал: создать предложенную задачу в TODO.'
        : 'Пользователь выбрал: работать над предложенной задачей в текущем чате без создания карточки.'
      chatActions.setDraft(selection)
      await chatActions.submitText()
      if (mode === 'chat') toast.success('Продолжаем работу в текущем чате')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось создать задачу')
    } finally {
      setTaskLaunchPending(false)
    }
  }

  const changeConversationMode = async (mode: PermissionMode): Promise<void> => {
    if (mode === activePermissionMode) return
    if (!activeConversation) {
      await settingsActions.updateSettings({ permissionMode: mode })
      return
    }
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
        trash: operationsActions.fsTrash,
        copyTo: operationsActions.fsCopyTo,
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

  // Многопользовательский режим (web): пока `/me` не ответил — лоадер, иначе форма
  // логина мигает у уже вошедшего пользователя; не вошли — экран логина.
  if (session.authRequired && !session.currentUser && session.checking) {
    return (
      <div className="login-screen auth-loading" data-theme={settingsState.settings.theme} role="status" aria-live="polite" data-testid="auth-loading">
        <span className="auth-loading__spinner" aria-hidden="true" />
        <span className="vc-sr-only">Проверка сессии…</span>
      </div>
    )
  }
  const inviteToken = /^#\/invite\/([^/?#]+)/.exec(window.location.hash)?.[1] ?? null
  // Открытая регистрация с подтверждением email: #/signup — форма, #/verify/<token> — подтверждение из письма.
  // Ссылка из письма-приглашения в проект работает до входа: показываем, куда
  // зовут. Маршрут свой — `#/invite/` занят регистрацией по админскому инвайту.
  const projectInviteToken = /^#\/project-invite\/([^/?#]+)/.exec(window.location.hash)?.[1] ?? null
  if (session.authRequired && !session.currentUser && projectInviteToken && window.session?.projectInvitationPreview) {
    const preview = window.session.projectInvitationPreview
    return (
      <InviteScreen
        token={decodeURIComponent(projectInviteToken)}
        loadPreview={(token) => preview(token)}
        theme={settingsState.settings.theme}
        onLogin={() => { window.location.hash = '#/' }}
        onSignup={() => { window.location.hash = '#/signup' }}
        onDone={() => { window.location.hash = '#/' }}
      />
    )
  }
  const verifyToken = /^#\/verify\/([^/?#]+)/.exec(window.location.hash)?.[1] ?? null
  if (session.authRequired && !session.currentUser && verifyToken && window.session?.verifyEmail) {
    return <VerifyScreen token={decodeURIComponent(verifyToken)} verify={window.session.verifyEmail} theme={settingsState.settings.theme} onDone={() => { window.location.hash = '#/'; window.location.reload() }} onBack={() => { window.location.hash = '#/'; setSignupOpen(false) }} />
  }
  if (session.authRequired && !session.currentUser && signupOpen && window.session?.signup && window.session.signupResend) {
    return <SignupScreen api={{ signup: window.session.signup, resend: window.session.signupResend }} theme={settingsState.settings.theme} onBack={() => setSignupOpen(false)} />
  }
  if (session.authRequired && !session.currentUser && inviteToken && window.session?.inviteInfo && window.session.register) {
    return <InviteRegister token={decodeURIComponent(inviteToken)} api={{ inviteInfo: window.session.inviteInfo, register: window.session.register }} theme={settingsState.settings.theme} onDone={() => { window.location.hash = '#/'; window.location.reload() }} />
  }
  if (session.authRequired && !session.currentUser) {
    return (
      <LoginScreen
        onLogin={(name, password, remember) => void runtime.login(name, password, remember)}
        error={session.authError}
        theme={settingsState.settings.theme}
        twoFactor={Boolean(session.twoFactorTicket)}
        onCode={(code) => void runtime.loginCode(code)}
        onCancelTwoFactor={() => runtime.cancelTwoFactor()}
        onReset={window.session?.resetPassword ? (name, code, password) => void runtime.resetPassword(name, code, password) : undefined}
        onSignup={signupEnabled ? () => setSignupOpen(true) : undefined}
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
        inPlaywrightReader && 'app--playwright-reader',
        inConsoleReader && 'app--console-reader',
        inMake && 'app--make'
      ].filter(Boolean).join(' ')}
      data-theme={settingsState.settings.theme}
      style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
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
      {!inSplit && <>
      {createChatOpen && <PopupFrame title="Создание разговора" onClose={() => setCreateChatOpen(false)} testId="create-conversation-overlay" panelClassName="convsettings">
        <header className="convsettings-head"><div><h1>Новый разговор</h1><p>Настройте разговор и его файловое хранилище</p></div></header>
        <main className="convsettings-body">
          <section className="convsettings-card">
            <label className="convsettings-field"><span>Название разговора</span><input autoFocus value={createChatTitle} onChange={(event) => setCreateChatTitle(event.target.value)} /></label>
          </section>
          <section className="convsettings-card" aria-labelledby="create-chat-files-title">
            <div className="convsettings-sectionhead"><div><h2 id="create-chat-files-title">Файлы чата</h2><p>Вложения будут храниться на выбранной машине независимо от рабочего Git-каталога.</p></div></div>
            <label className="convsettings-field"><span>Машина</span><select aria-label="Машина файлов чата" value={createChatMachineId} onChange={(event) => { setCreateChatMachineId(event.target.value); setCreateChatPath('') }}>
              <option value="">Нет доступной машины</option>
              {operations.agents.map((agent) => <option key={agent.id} value={agent.id} disabled={!agent.online}>{agent.name}{agent.isEffective ? ' — эффективная' : ''}{agent.online ? '' : ' (офлайн)'}</option>)}
            </select></label>
            <label className="convsettings-field"><span>Хранилище</span><select aria-label="Хранилище файлов чата" value={createChatStorageId} onChange={(event) => { setCreateChatStorageId(event.target.value); setCreateChatPath('') }}>
              <option value="">Временный legacy-режим</option>
              {createChatStorages.map((storage) => <option key={storage.id} value={storage.id} disabled={storage.status !== 'ready'}>{storage.rootPath}{storage.primary ? ' — основное' : ''}{storage.status === 'ready' ? '' : ` (${storage.status === 'offline' ? 'офлайн' : 'недоступно'})`}</option>)}
            </select></label>
            {createChatStorageId ? <>
              <p className="convsettings-muted">Основное хранилище: {createChatStorages.find((item) => item.primary)?.rootPath ?? 'не назначено'}</p>
              <label className="convsettings-field"><span>Относительный каталог</span><input aria-label="Относительный каталог файлов чата" value={createChatPath} placeholder={chat.sidebarProjectId ? `projects/${chat.sidebarProjectId}/chats/<conversation-id>` : 'chats/<conversation-id>'} onChange={(event) => setCreateChatPath(event.target.value)} /></label>
              <p className="convsettings-muted">Итоговый каталог: {(createChatStorages.find((item) => item.id === createChatStorageId)?.rootPath ?? '')}/{createChatPath.trim() || (chat.sidebarProjectId ? `projects/${chat.sidebarProjectId}/chats/<conversation-id>` : 'chats/<conversation-id>')}</p>
            </> : <p className="convsettings-muted" role="alert">Временный режим хранит вложения в <b>.voicechat_uploads</b>. Он предназначен для совместимости; старые файлы автоматически не переносятся. <button type="button" className="vc-btn vc-btn--secondary" onClick={() => { setCreateChatOpen(false); navigate('/machines') }}>Настроить хранилище машины</button></p>}
            {createChatStorages.length > 0 && !createChatStorages.some((item) => item.status === 'ready') && <p className="convsettings-muted" role="status">У машины нет готового хранилища. Проверьте его в разделе машины.</p>}
          </section>
          {createChatError && <p className="convsettings-error" role="alert">{createChatError}</p>}
          <div className="convsettings-actions"><Button onClick={() => void submitCreateChat()} loading={createChatSaving}>Создать разговор</Button><Button variant="secondary" onClick={() => setCreateChatOpen(false)}>Отмена</Button></div>
        </main>
      </PopupFrame>}
      <NotificationContainer
        notifications={clarificationNotifications}
        navigatingId={clarificationNavigatingId}
        errors={clarificationErrors}
        onOpen={(notification) => void openClarificationNotification(notification)}
        onDismiss={(notification) => void dismissClarificationNotification(notification)}
      />
      <Sidebar
        open={sidebarOpen}
        width={sidebarWidth}
        onWidthChange={compactChat ? undefined : setSidebarWidth}
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
          setCreateChatError(null)
          setCreateChatTitle('Новый разговор')
          setCreateChatPath('')
          setCreateChatOpen(true)
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
        onOpenConsoleReader={session.authRequired ? menu(() => navigate('/console-reader')) : undefined}
        onOpenMake={session.authRequired ? menu(() => navigate('/make')) : undefined}
        onOpenUsers={session.authRequired ? menu(() => navigate('/users')) : undefined}
        onOpenMachines={session.authRequired ? menu(() => navigate('/machines')) : undefined}
        onOpenCi={session.authRequired ? menu(() => navigate('/ci')) : undefined}
        currentUser={session.currentUser}
        onOpenSessions={session.authRequired && window.session?.sessions ? () => setSessionsOpen(true) : undefined}
        onOpenTwoFactor={session.authRequired && window.session?.twoFactor ? () => setTwoFactorOpen(true) : undefined}
        onOpenChangePassword={session.authRequired && window.session?.changePassword ? () => setChangePasswordOpen(true) : undefined}
        avatar={settingsState.settings.personalization.avatar ?? null}
        onLogout={session.authRequired ? async () => {
          const accepted = await confirm({
            title: 'Выйти из ChatAI?',
            message: 'Текущая сессия завершится. Чаты, проекты, настройки и подключения внешних сервисов сохранятся.',
            confirmLabel: 'Выйти',
            variant: 'danger'
          })
          if (!accepted) return
          try {
            await runtime.logout()
            navigate('/')
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Не удалось завершить сессию. Попробуйте ещё раз.')
          }
        } : undefined}
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
        invitations={projects.myInvitations}
        invitationsError={projects.myInvitationsError}
        onRetryInvitations={() => void projectsActions.loadMyInvitations()}
        onAcceptInvitation={async (invitation) => {
          // Токен приглашённому не отдаётся: принимаем по id, сервер сверит адресата.
          const projectId = await projectsActions.acceptInvitation(invitation.id)
          if (projectId) navigate(`/projects/${projectId}`)
        }}
        onDeclineInvitation={(invitation) => { void projectsActions.declineInvitation(invitation.id) }}
        onCreateProject={() => {
          setSidebarOpen(false)
          setNewProjectOpen(true)
          // Каталог типов нужен окну сразу; повторное открытие обновит список.
          void projectsActions.loadProjectTypes()
        }}
        onOpenCommandPalette={() => {
          setSidebarOpen(false)
          setPaletteOpen(true)
        }}
      />
      {authed && projectInviteToken && window.session?.projectInvitationPreview && (
        <InviteScreen
          token={decodeURIComponent(projectInviteToken)}
          loadPreview={(token) => window.session!.projectInvitationPreview!(token)}
          theme={settingsState.settings.theme}
          onAccept={async (token) => {
            const projectId = await projectsActions.acceptInvitation(token)
            if (projectId) navigate(`/projects/${projectId}`)
            return projectId
          }}
          onDecline={(token) => projectsActions.declineInvitation(token)}
          onDone={() => navigate('/projects')}
        />
      )}
      {newProjectOpen && (
        <NewProjectDialog
          types={projects.projectTypes}
          busy={creatingProject}
          onClose={() => setNewProjectOpen(false)}
          onCreate={async (name, typeId) => {
            setCreatingProject(true)
            try {
              const detail = await projectsActions.createProject({ name, ...(typeId ? { typeId } : {}) })
              if (detail) {
                setNewProjectOpen(false)
                navigate(`/projects/${detail.id}`)
              }
            } finally {
              setCreatingProject(false)
            }
          }}
        />
      )}
      {sidebarOpen && (
        <div className="side-backdrop" aria-hidden onClick={() => closeMobileSidebar()} />
      )}
      </>}

      {(!inProjects || inTaskChat) && !onUtilityPage && (inChat || inSplit) && (
      <div className={inSplit ? `chat-split chat-split--${chatView}` : 'chat-page'} style={inSplit ? { '--preview-width': `${previewWidth}%` } as CSSProperties : undefined}>
      {inSplit && <nav className="chat-split-tabs" aria-label="Режим экрана"><div role="tablist"><button type="button" role="tab" aria-selected={chatView === 'chat'} onClick={() => setChatView('chat')}>Чат</button><button type="button" role="tab" aria-selected={chatView === 'preview'} onClick={() => setChatView('preview')}>{inConsoleReader ? 'Консоль' : inMake ? 'Проект' : 'Сайт'}</button></div></nav>}
      <div className="chat-split-chat">
      {inReader && <header className="web-recorder-selector"><label><span className="vc-sr-only">Разговор Web Reader</span><select aria-label="Разговор Web Reader" value={readerActiveListed ? chat.activeId ?? '' : ''} onChange={(event) => { if (event.target.value) navigate(`/web-reader/${event.target.value}`) }}>{!readerActiveListed && <option value="" disabled>Чат не выбран</option>}{chat.readerConversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title}</option>)}</select></label><button className="vc-btn vc-btn--secondary" type="button" onClick={() => createReaderChat()}>+ Новый</button></header>}
      {inPlaywrightReader && <header className="web-recorder-selector playwright-reader-selector"><strong>Playwright Reader</strong><label><span className="vc-sr-only">Разговор Playwright Reader</span><select aria-label="Разговор Playwright Reader" value={playwrightReaderActiveListed ? chat.activeId ?? '' : ''} onChange={(event) => { if (event.target.value) navigate(`/playwright-reader/${event.target.value}`) }}>{!playwrightReaderActiveListed && <option value="" disabled>Чат не выбран</option>}{chat.playwrightReaderConversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title}</option>)}</select></label><button className="vc-btn vc-btn--secondary" type="button" onClick={() => createPlaywrightReaderChat()}>+ Новый</button></header>}
      {inConsoleReader && <header className="web-recorder-selector console-reader-selector"><strong>Консоль</strong><label><span className="vc-sr-only">Разговор Консоли</span><select aria-label="Разговор Консоли" value={consoleReaderActiveListed ? chat.activeId ?? '' : ''} onChange={(event) => { if (event.target.value) navigate(`/console-reader/${event.target.value}`) }}>{!consoleReaderActiveListed && <option value="" disabled>Чат не выбран</option>}{chat.consoleReaderConversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title}</option>)}</select></label><button className="vc-btn vc-btn--secondary" type="button" onClick={() => createConsoleReaderChat()}>+ Новый</button></header>}
      {inMake && <header className="web-recorder-selector make-selector"><strong>Make</strong><label><span className="vc-sr-only">Проект Make</span><select aria-label="Проект Make" value={makeActiveListed ? chat.activeId ?? '' : ''} onChange={(event) => { if (event.target.value) navigate(`/make/${event.target.value}`) }}>{!makeActiveListed && <option value="" disabled>Проект не выбран</option>}{chat.makeConversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title}</option>)}</select></label><button className="vc-btn vc-btn--secondary" type="button" onClick={() => createMakeChat()}>+ Новый</button></header>}
      {readerSurfaceReady ? <ChatColumn
        conversationId={chat.activeId}
        onToggleSidebar={inSplit ? undefined : toggleSidebar}
        sidebarExpanded={sidebarExpanded}
        title={activeTitle}
        onRenameTitle={(t) => {
          if (chat.activeId) void chatActions.renameConversation(chat.activeId, t)
        }}
        onOpenConversationSettings={() => { setConversationSettingsOpen(true); void projectsActions.refreshProjects() }}
        permissionMode={activePermissionMode}
        workspace={activeConversation?.workspace}
        storage={activeStorage}
        onRunSkill={(agentId, command) => operationsActions.runSkill(agentId, command)}
        onExecutePlan={(answerId) => void chatActions.executePlan(answerId)}
        onMakeRestore={inMake ? (snapshotId) => void restoreMakeTurn(snapshotId) : undefined}
        canExecutePlan={!forcedPlan}
        state={voice.voice}
        messages={chat.messages.filter((message) => !(chat.activeId ? chat.queuedTurns[chat.activeId] ?? [] : []).some((item) => item.messageId === message.id))}
        loadingMessages={chat.loadingMessages}
        highlightMessageId={chat.highlightMessageId}
        onHighlightDone={chatActions.clearMessageHighlight}
        liveSegments={voice.liveSegments}
        diarization={settingsState.settings.diarization}
        preparingReply={chat.preparingReply}
        streamingReply={chat.streamingReply}
        liveActivity={chat.liveActivity}
        liveUsage={chat.liveUsage}
        liveTarget={chat.liveTarget}
        {...(inSplit ? { composerLayout: 'docked' as const } : {})}
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
        modelMissing={VOICE_INPUT_ENABLED && !settingsState.modelPresent}
        modelLabel={settingsState.settings.whisperModel}
        downloading={settingsState.downloading}
        downloadPercent={settingsState.downloadPercent}
        onDownloadModel={settingsActions.downloadModel}
        onExport={chatActions.exportConversation}
        turnMeta={chat.lastTurnMeta}
        agents={operations.agents}
        execTarget={activeExecTarget}
        aiLabel={(activeConversation?.llmProvider ?? settingsState.settings.llmProvider) === 'codex' ? 'Codex' : 'Claude'}
        voiceBar={
          <VoiceBar
            defaultCollapsed={compactChat && chat.messages.length > 0}
            allowCollapse={compactChat && chat.messages.length > 0}
            layout={chat.messages.length === 0 ? 'centered' : 'docked'}
            userDisplayName={session.currentUser?.name}
            state={voice.voice}
            submitPending={chat.pendingSubmit?.conversationId === chat.activeId || (chat.pendingSubmit !== null && chat.activeId === null)}
            replyStarted={chat.streamingReply.length > 0}
            requestError={shell.error}
            draft={chat.draft}
            diarization={settingsState.settings.diarization}
            detectedSpeakers={detectedSpeakers}
            aiLabel={(activeConversation?.llmProvider ?? settingsState.settings.llmProvider) === 'codex' ? 'Codex' : 'Claude'}
            attachments={chat.attachments}
            readServerFile={operationsActions.readServerFile}
            previewElement={previewElement}
            queuedTurns={chat.activeId ? chat.queuedTurns[chat.activeId] ?? [] : []}
            queuePaused={chat.activeId ? chat.queuePaused[chat.activeId] ?? false : false}
            onEditQueued={chatActions.editQueued}
            onDeleteQueued={chatActions.deleteQueued}
            onReorderQueued={chatActions.reorderQueued}
            onSendQueuedNow={chatActions.sendQueuedNow}
            onDraftChange={chatActions.setDraft}
            onSubmitText={() => {
              if (inReader && isWebReaderDiagnosticsCommand(chat.draft)) { chatActions.setDraft(''); startWebReaderDiagnostics(); return }
              if (inPlaywrightReader && isPlaywrightReaderDiagnosticsCommand(chat.draft)) { chatActions.setDraft(''); startPlaywrightReaderDiagnostics(); return }
              if (inConsoleReader && isConsoleReaderDiagnosticsCommand(chat.draft)) { chatActions.setDraft(''); startConsoleReaderDiagnostics(); return }
              if (inMake && isMakeDiagnosticsCommand(chat.draft)) { chatActions.setDraft(''); startMakeDiagnostics(); return }
              if (isChatDiagnosticsCommand(chat.draft)) { chatActions.setDraft(''); startChatDiagnostics(); return }
              void (async () => {
                // Режим вопроса Make (roadmap-4 п.4): один ход в «Плане», прежний режим вернётся по завершении хода.
                if (inMake && makeAskOnly && activePermissionMode !== 'plan') { askRestoreRef.current = activePermissionMode; await changeConversationMode('plan') }
                const sent = await chatActions.submitText(previewElement ?? undefined, inMake ? makeEditorContext ?? undefined : undefined)
                if (sent) setPreviewElement(null)
              })()
            }}
            onStartVoice={voiceActions.startVoice}
            onStopVoice={voiceActions.stopVoice}
            onStopSpeak={voiceActions.stopSpeak}
            onCancelRequest={chatActions.cancelRequest}
            onAddFiles={(files) => files.forEach((f) => void chatActions.addAttachment(f))}
            onRemoveAttachment={chatActions.removeAttachment}
            onRetryAttachment={(id) => { void chatActions.retryAttachment(id) }}
            onRemovePreviewElement={() => setPreviewElement(null)}
            permissionMode={activePermissionMode}
            onChangePermissionMode={(mode) => void changeConversationMode(mode)}
            voiceInputEnabled={VOICE_INPUT_ENABLED}
            aiAssistPrompts={settingsState.settings.aiAssistPrompts}
            onAiAssistPromptsChange={(next) => void settingsActions.updateSettings({ aiAssistPrompts: next })}
            generateAiAssist={async ({ prompt, modifiers }) => (await api['prompt:suggest']({ prompt, modifiers })).variants}
          />
        }
      /> : <div className="chat-route-loading" role="status">{inMake ? 'Открываем проект…' : 'Открываем выбранный Reader-разговор…'}</div>}
      </div>
      {inSplit && readerSurfaceReady && <div className="chat-split-divider" role="region" aria-label="Изменение ширины панелей" onPointerDown={resizePreview}><div role="separator" aria-label="Изменить ширину панелей" aria-orientation="vertical" /></div>}
      {/* Playwright Reader — живой изолированный Chromium (browser-runner); Web Reader — iframe поверх /api/preview; Консоль — живой PTY-терминал. */}
      {inPlaywrightReader && readerSurfaceReady && chat.activeId && <BrowserSessionPane key={chat.activeId} conversationId={chat.activeId} browser={window.browser} />}
      {inConsoleReader && readerSurfaceReady && chat.activeId && <ConsoleSessionPane key={chat.activeId} conversationId={chat.activeId} agents={operations.agents} pty={window.pty} initialAgentId={activeConversation?.execTarget ?? settingsState.settings.defaultAgentId ?? null} {...(activeConversation?.projectId ? { projectId: activeConversation.projectId } : {})} />}
      {(changePasswordOpen || session.currentUser?.mustChangePassword) && window.session?.changePassword && session.currentUser && <ChangePasswordDialog userName={session.currentUser.name} change={window.session.changePassword} forced={Boolean(session.currentUser.mustChangePassword)} onDone={() => { setChangePasswordOpen(false); void runtime.refreshUser() }} onClose={() => setChangePasswordOpen(false)} onLogout={() => void runtime.logout()} />}
      {twoFactorOpen && window.session?.twoFactor && <TwoFactorDialog api={window.session.twoFactor} onClose={() => setTwoFactorOpen(false)} />}
      {sessionsOpen && window.session?.sessions && window.session.logoutAll && window.session.revokeSession && <SessionsDialog load={window.session.sessions} revoke={window.session.revokeSession} logoutAll={window.session.logoutAll} onClose={() => setSessionsOpen(false)} />}
      {inMake && readerSurfaceReady && chat.activeId && window.api && <MakePane key={chat.activeId} conversationId={chat.activeId} api={window.api} make={window.make} ensurePreview={window.session?.ensurePreview} onInsertToChat={(text) => chatActions.setDraft(chat.draft.trim() ? `${chat.draft.trimEnd()} ${text}` : text)} onAskAssistant={(text) => { chatActions.setDraft(text); void chatActions.submitText() }} onAttachImage={(file) => void chatActions.addAttachment(file)} onEditorContext={setMakeEditorContext} usage={makeUsage} turnActive={voice.voice === 'thinking'} askOnly={makeAskOnly} onAskOnlyChange={setMakeAskOnly} lastRequest={[...chat.messages].reverse().find((m) => m.role !== 'ai')?.text ?? null} />}
      {inReader && readerSurfaceReady && chat.activeId && <WebReaderFrame key={chat.activeId} conversationId={chat.activeId} platform={readerPlatform} conversationUrl={activeConversation?.previewUrl ?? null} projectUrl={inReader ? (activeProjectPreviewUrl ?? activeConversation?.projectPreviewUrl ?? null) : null} ensurePreview={window.session?.ensurePreview} onSave={async (previewUrl) => { if (activeConversation) await chatActions.setConversationPreviewUrl(activeConversation.id, previewUrl); setPreviewElement(null) }} onSelectElement={setPreviewElement} onAreaScreenshot={attachAreaScreenshot} onRegisterHost={registerReaderHost} />}
      </div>
      )}

      {/* Проектов нет вообще: редиректу некуда вести — показываем, что делать. */}
      {inProjects && !routeProjectId && firstProjectId === null && <ProjectsEmptyPage invitationCount={projects.myInvitations.length} />}

      {inProjects && routeProjectId && projectMissing && <ProjectNotFoundPage />}

      {/* Одна страница проекта на все три маршрута: шапка с именем и вкладками
          общая, меняется только содержимое. */}
      {inProjects && !inTaskChat && routeProjectId && !projectMissing && (
        <ProjectPage
          projectName={routeProjectName}
          features={projectFeatures}
          {...(() => {
            const chain = projects.projectDetail?.typeChain ?? routeProjectSummary?.typeChain
            return chain?.nodes.length ? { typeLabel: chain.nodes[chain.nodes.length - 1].name } : {}
          })()}
          // Недоступный раздел в адресе не оставляем: тип мог измениться, а ссылка — остаться.
          section={routeSettings ? 'settings' : routeReleases && projectFeatures.releases ? 'releases' : 'board'}
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
                projectTypes={projects.projectTypes}
                invitations={projects.projectInvitations}
                onDeriveType={async (id, name) => { await projectsActions.deriveProjectType(id, name) }}
                onInvite={async (id, invitee, role) => {
                  const result = await projectsActions.inviteToProject(id, invitee, role)
                  if (!result) return
                  // Владелец должен понимать, ушло ли письмо: без этого он не
                  // знает, почему приглашённый молчит.
                  if (result.mailed && result.email) {
                    toast.success(`Приглашение отправлено на ${result.email}`)
                    return
                  }
                  // Письма нет (приглашение по логину) — ссылку надо чем-то передать.
                  toast.success('Приглашение создано. Письма не было — ссылку можно скопировать', {
                    action: {
                      label: 'Скопировать ссылку',
                      onClick: () => {
                        void navigator.clipboard?.writeText(result.link).then(
                          () => toast.success('Ссылка скопирована'),
                          () => toast.error('Не удалось скопировать — скопируйте вручную: ' + result.link)
                        )
                      }
                    }
                  })
                }}
                onResendInvitation={(id, invitationId) => projectsActions.resendProjectInvitation(id, invitationId)}
                onRevokeInvitation={(id, invitationId) => projectsActions.revokeProjectInvitation(id, invitationId)}
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
                onUpdateMemberRole={(id, username, role) => void projectsActions.updateProjectMemberRole(id, username, role)}
                onRemoveMember={(id, username) => void projectsActions.removeProjectMember(id, username)}
                onLinkMachine={(id, agentId) => void projectsActions.linkProjectMachine(id, agentId)}
                onSetMachineShareAccess={(id, agentId, access) => void projectsActions.setProjectMachineShareAccess(id, agentId, access)}
                onUnlinkMachine={(id, agentId) => void projectsActions.unlinkProjectMachine(id, agentId)}
                onConfigureMachineStorage={(id, agentId, storageId, directories) => projectsActions.configureProjectMachineStorage(id, agentId, storageId, directories)}
                onResetMachineDirectory={(id, agentId, kind) => projectsActions.resetProjectMachineDirectory(id, agentId, kind)}
                onSetMachinePath={(id, agentId, path) => projectsActions.setProjectMachinePath(id, agentId, path)}
                onSetReposRoot={(id, agentId, root) => projectsActions.setProjectReposRoot(id, agentId, root)}
                onSetMachineSsh={(id, agentId, host, user) => projectsActions.setProjectMachineSsh(id, agentId, host, user)}
                onSetDefaultMachine={(id, agentId) => void projectsActions.setProjectDefaultMachine(id, agentId)}
                gitAccessApi={{
                  'projects:gitAccessStatus': api['projects:gitAccessStatus'],
                  'projects:configureGitAccess': api['projects:configureGitAccess'],
                  'projects:verifyGitAccess': api['projects:verifyGitAccess'],
                  'projects:deleteGitAccess': api['projects:deleteGitAccess'],
                  'projects:gitAccessDiagnostics': api['projects:gitAccessDiagnostics']
                }}
                managedProductionApi={{
                  'releases:managedPreflight': api['releases:managedPreflight'],
                  'releases:managedConfirm': api['releases:managedConfirm'],
                  'projects:bootstrapProduction': api['projects:bootstrapProduction'],
                  'projects:get': api['projects:get']
                }}
                onManagedProductionConfirmed={() => projectsActions.selectProject(routeProjectId)}
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
                projectFeatures={projectFeatures}
              initialOpenTaskId={routeTaskId}
              initialOpenTaskTab={segments[4] === 'preparation' ? 'preparation' : undefined}
              onOpenTaskRouteChange={(taskId, tab) => navigate(taskId ? `/projects/${routeProjectId}/task/${taskId}${tab ? `/${tab}` : ''}` : `/projects/${routeProjectId}`)}
              projectName={routeProjectName}
              scrollScopeId={routeProjectId!}
              board={projects.board}
              loading={projects.boardLoading || projects.activeProjectId !== routeProjectId}
              error={projects.boardError}
              onRetry={() => void projectsActions.openBoard(routeProjectId)}
              showCompleted={projects.boardIncludeCompleted}
              onShowCompletedChange={(show) => void projectsActions.setBoardIncludeCompleted(show)}
              showDoneTaskChats={chat.showDoneTaskChats}
              onShowDoneTaskChatsChange={(show) => void chatActions.setShowDoneTaskChats(show)}
              members={projects.projectDetail?.members ?? []}
              currentUserId={session.currentUser?.name ?? null}
              currentUser={session.currentUser?.name ?? null}
              llmAccess={settingsState.llmAccess}
              llmEngines={settingsState.llmEngines}
              onCreateColumn={(name) => void projectsActions.createColumn(name)}
              onUpdateColumn={(id, fields) => void projectsActions.updateColumn(id, fields)}
              onSetColumnHidden={(id, hidden) => void projectsActions.setColumnHidden(id, hidden)}
              onReorderColumns={(order) => void projectsActions.reorderColumns(order)}
              onDeleteColumn={(id) => void projectsActions.deleteColumn(id)}
              onCreateTask={(columnId, input) => void projectsActions.createTask(columnId, input)}
              onUpdateTask={(taskId, fields) => void projectsActions.updateTask(taskId, fields)}
              onMoveTask={(taskId, columnId, afterId, beforeId) => projectsActions.moveTask(taskId, columnId, afterId, beforeId)}
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
              loadPreparationRun={(runId) => api['tasks:getPreparationRun']({ runId })}
              loadFullTask={(taskId) => api['tasks:get']({ projectId: routeProjectId!, taskId })}
              onStartPreparation={(taskId, selection) => api['tasks:startPreparationRun']({ projectId: routeProjectId!, taskId, selection })}
              onRetryPreparation={(runId, selection) => api['tasks:retryPreparationRun']({ runId, selection })}
              onCancelPreparation={(runId) => api['tasks:cancelPreparationRun']({ runId })}
              onAnswerPreparation={(questionId, answer) => api['tasks:answerPreparationQuestion']({ questionId, answer })}
              onExportPreparation={(runId, format) => api['tasks:exportPreparationRun']({ runId, format })}
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
          storages={operations.machineStorages}
          onRefreshStorages={(id) => void operationsActions.refreshMachineStorages(id)}
          onRegisterStorage={operationsActions.registerMachineStorage}
          onCreateAgent={operationsActions.createAgent}
          onRegenerateToken={operationsActions.regenerateAgentToken}
          onRevokeToken={(id) => void operationsActions.revokeAgentToken(id)}
          onSetPinIp={(id, pin) => void operationsActions.setAgentPinIp(id, pin)}
          onGetConnectionString={operationsActions.getAgentConnectionString}
          onUpdateAgent={operationsActions.updateAgent}
          onLoadCommands={(id, filter) => (window.api ? window.api['agents:commands']({ id, ...filter }) : Promise.resolve([]))}
          onExecTest={(id) => operationsActions.agentExec(id, 'uname -a 2>/dev/null || ver')}
          onExecBatch={(machineIds, command) => window.api!['agents:execBatch']({ machineIds, command })}
          onOpenConversation={(conversationId) => navigate(`/chat/${conversationId}`)}
          onDeleteAgent={(id) => void operationsActions.deleteAgent(id)}
          defaultAgentId={settingsState.settings.defaultAgentId}
          onSetDefault={(id) => void settingsActions.updateSettings({ defaultAgentId: id })}
          onClose={() => navigate('/')}
        />
      )}

      {utilitySeg === 'make-shared' && segments[1] && window.api && (
        <MakeSharedView key={segments[1]} token={segments[1]} api={window.api} ensurePreview={window.session?.ensurePreview} onBack={() => navigate('/')} />
      )}
      {utilitySeg === 'users' && admin.usersOpen && (
        <Suspense fallback={<div role="status">Загрузка Administration…</div>}><UsersAdmin
          variant="page"
          users={admin.adminUsers}
          latestAgentVersion={AGENT_VERSION}
          onUpdateMachine={async (id) => { try { await window.api!['admin:updateMachine']({ id }); return null } catch (err) { return err instanceof Error ? err.message : String(err) } }}
          usageSummary={admin.adminUsageSummary}
          makeStats={admin.adminMakeStats}
          machineStats={admin.adminMachineStats}
          roleCommandPolicies={roleCommandPolicies}
          onSaveRoleCommandPolicies={async (roles) => { const r = await window.api!['admin:setCommandPolicy']({ roles }); setRoleCommandPolicies(r.roles) }}
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
          onCreate={(name, password, role, mustChangePassword) => void adminActions.createUserAccount(name, password, role, mustChangePassword)}
          onResetCode={(name) => adminActions.issueResetCode(name)}
          onSetLlmLimit={(name, usd) => void adminActions.setUserLlmLimit(name, usd)}
          onUpdateRole={(name, role) => void adminActions.updateUserRole(name, role)}
          onSetBlocked={(name, blocked) => void adminActions.setUserBlocked(name, blocked)}
          onDelete={(name) => void adminActions.deleteUserAccount(name)}
          onLoadUsage={(unit, from, to, conversationId) => void adminActions.loadAdminUsage(unit, from, to, conversationId)}
          sessions={admin.adminSessions}
          onLoadSessions={() => void adminActions.loadAdminSessions()}
          onRevokeSession={(sid) => void adminActions.revokeAdminSession(sid)}
          security={admin.adminSecurity}
          onLoadSecurity={() => void adminActions.loadAdminSecurity()}
          invites={admin.adminInvites}
          onLoadInvites={() => void adminActions.loadAdminInvites()}
          onCreateInvite={(input) => void adminActions.createAdminInvite(input)}
          onDeleteInvite={(token) => void adminActions.deleteAdminInvite(token)}
          inviteBaseUrl={`${window.location.origin}${window.location.pathname}`}
          signup={admin.adminSignup}
          onLoadSignup={() => void adminActions.loadAdminSignup()}
          onSetSignup={(input) => void adminActions.setAdminSignup(input)}
          onOpenConversation={(id) => void adminActions.openAdminConversation(id)}
          llmAccess={admin.adminUserLlmAccess}
          onSaveLlmAccess={(access) => void adminActions.saveAdminUserLlmAccess(access)}
          pendingProjectTypes={admin.pendingProjectTypes}
          onReviewProjectType={(input) => adminActions.reviewProjectType(input)}
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
        /></Suspense>
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
          members={taskProposal.members}
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
            {taskLaunchPending && <span role="status">Создаём и запускаем подготовку…</span>}
            <Button variant="secondary" onClick={() => void chooseTaskLaunch('todo')} loading={taskLaunchPending} disabled={taskLaunchPending || !taskProposal.task.title.trim()}>Создать в TODO</Button>
            <Button variant="primary" onClick={() => void chooseTaskLaunch('preparation')} loading={taskLaunchPending} disabled={taskLaunchPending || !taskProposal.task.title.trim()}>Создать в подготовке к разработке</Button>
            <Button variant="secondary" onClick={() => void chooseTaskLaunch('chat')} loading={taskLaunchPending} disabled={taskLaunchPending}>Работать в текущем чате</Button>
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
          webReaderDiagnostics={inReader ? { running: diagnosticsControllerRef.current !== null, onRun: startWebReaderDiagnostics } : undefined}
          playwrightReaderDiagnostics={inPlaywrightReader ? { running: diagnosticsControllerRef.current !== null, onRun: startPlaywrightReaderDiagnostics } : undefined}
          consoleReaderDiagnostics={inConsoleReader ? { running: diagnosticsControllerRef.current !== null, onRun: startConsoleReaderDiagnostics } : undefined}
          makeDiagnostics={inMake ? { running: diagnosticsControllerRef.current !== null, onRun: startMakeDiagnostics } : undefined}
          chatDiagnostics={!inSplit ? { running: diagnosticsControllerRef.current !== null, onRun: startChatDiagnostics } : undefined}
          fetchProjectDetail={projectsActions.fetchProjectDetail}
          fetchMachines={chatActions.fetchConversationMachines}
          onOpenExplorer={(agentId, path) => { setConversationSettingsOpen(false); operationsActions.openUtility('explorer', agentId, path) }}
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
          onOpenKbUsage={() => {
            setConversationSettingsOpen(false)
            runtime.openKbUsage()
          }}
          onClose={() => {
            setConversationSettingsOpen(false)
            if (chatRoute?.kind === 'context-item') navigate(`/chat/${activeConversation.id}`)
          }}
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
            ...(operations.utility.dir ? { dir: true } : {}),
            ...(operations.utility.command ? { command: operations.utility.command } : {})
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
          projectTypes={projects.projectTypes}
          projectTypesStatus={projects.projectTypesStatus}
          projectTypesError={projects.projectTypesError}
          onRetryProjectTypes={() => void projectsActions.loadProjectTypes()}
          {...(session.currentUser?.name ? { currentUsername: session.currentUser.name } : {})}
          onCreateProjectType={async (input) => { await projectsActions.createProjectType(input) }}
          onDeleteProjectType={(id) => projectsActions.deleteProjectType(id)}
          onPublishProjectType={(id) => projectsActions.publishProjectType(id)}
          onUnpublishProjectType={(id) => projectsActions.unpublishProjectType(id)}
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
