// Стор renderer (Шаг 5): единый источник состояния UI.
//
// Фреймворк-независим — обычное замыкание с getState/subscribe/actions, чтобы
// логику можно было тестировать без React. Голосовые переходы идут строго через
// машину состояний (src/shared/stateMachine.ts). Данные (разговоры, сообщения,
// настройки) — реальные, из SQLite через window.api (IPC). Рост транскрипта и
// ответ — мок-пайплайн (см. mockPipeline.ts).

import type {
  RendererApi,
  RendererBoardBridge,
  RendererFilesBridge,
  RendererFsBridge,
  RendererSessionBridge,
  SttSegmentWire,
  SttStatus,
  SttUpdate,
  UploadInfo
} from '@shared/ipc'
import type { Board, ProjectDetail, ProjectSummary, TaskChatBadge, TaskChatContext, TaskPriority, WorkItemType, WorkItemDefaultSkills } from '@shared/projects'

import type {
  CiCommand,
  CiCommandInput,
  CiGlobalSettings,
  CiCommandSuggestion,
  CiWorkspaceReportItem,
  CiRun,
  CiRunDetail,
  CiRunStep,
  CiFixAttempt,
  CiRunSummary,
  CiRunConclusion,
  CiInteraction,
  CiInteractionAnswer,
  CiRunMode,
  CiLogLine
} from '@shared/ci'
import { isTerminalCiStatus } from '@shared/ci'
import type { RendererCiBridge } from '../remote/ciBridge'
import type { RendererKbBridge } from '../remote/kbBridge'
import type { KbStatus, KbUsageQuery } from '@shared/kb'
import {
  applyKbUsageFrame,
  buildKbUsageFromMessages,
  emptyKbUsageCache,
  kbUsageSnapshot,
  mergeKbUsage,
  type KbUsageCache
} from '../lib/kbUsage'
import type { LoadStatus } from '../lib/loadState'
import type { AgentExecResult, FsResult } from '@shared/agentProtocol'
import { detectOpenUtility, toolBlock, type ToolSpec } from '@shared/tools'
import type { ActiveTurn, ServerFileInfo, SystemCapabilities } from '@shared/protocol'
import type { McpServer } from '@shared/mcp'
import type { LoginStatusMap } from '@shared/auth'
import type { AgentCreated, AgentInfo, AgentPolicy } from '@shared/agentProtocol'
import type {
  AdminLlmEngine,
  AdminLlmEngineHealth,
  AdminLlmEngineInput,
  ModelPrice,
  ModelPriceInput,
  LlmEngineOption,
  AdminUserInfo,
  UsageReport,
  UsageUnit,
  UserUsageSummary
} from '@shared/admin'
import type { CcProject, CcSession, CcItem } from '@shared/cc'
import type { SessionUsage } from '@shared/types'
import type { UserLlmAccess } from '@shared/llmAccess'
import type { CxProject, CxSession, CxItem } from '@shared/codexSessions'
import type { PreviewElementPayload } from '@shared/previewInspector'
import { withPreviewElementContext } from '@shared/prompt'
import type {
  CatalogVoice,
  ClaudeLogEntry,
  Conversation,
  LlmProvider,
  Message,
  MessageAttachment,
  MessageRole,
  MessageSearchHit,
  PermissionMode,
  KbContextMode,
  ConversationStatus,
  SessionUser,
  Settings,
  TtsVoiceInfo,
  TurnMeta,
  TurnUsage,
  WhisperModel,
  WhisperModelInfo
} from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { conversationToMarkdown, conversationToJson, exportFileName } from '@shared/export'
import { transition, type VoiceEvent } from '@shared/stateMachine'
import type { VoiceState } from '@shared/types'
import type { LiveSegment } from '../lib/view'
import { flushSpeakable, splitSpeakable } from '../lib/sentences'
import { VadDetector } from '../lib/vad'
import type { AudioController } from '../audio/browserAudio'
import type { MicDevice } from '../audio/microphones'
import {
  DEFAULT_DELAYS,
  formatTime,
  mockReply,
  type PipelineDelays,
  titleFromText,
  transcriptFrames
} from './mockPipeline'

/** Период опроса статуса входа claude/codex (ms). */
const LOGIN_STATUS_POLL_MS = 30_000

/** Шаг дробного ранга для оптимистичного порядка на клиенте. */
const BOARD_RANK_STEP = 1024

/** Сколько команд консоли помним по одной машине (дальше вытесняются старые). */
const CONSOLE_HISTORY_MAX = 100

/** Ключ localStorage для последнего выбранного в сайдбаре проекта. */
const SIDEBAR_PROJECT_KEY = 'vc.sidebar.project'
function loadSidebarProject(): string | null {
  try {
    return localStorage.getItem(SIDEBAR_PROJECT_KEY)
  } catch {
    return null
  }
}
function saveSidebarProject(id: string | null): void {
  try {
    if (id) localStorage.setItem(SIDEBAR_PROJECT_KEY, id)
    else localStorage.removeItem(SIDEBAR_PROJECT_KEY)
  } catch {
    // localStorage недоступен (приватный режим/SSR) — молча игнорируем.
  }
}

/**
 * Id задач, стоящих в колонках с семантикой `done`. Ровно этот набор решает,
 * какие чаты задач сервер прячет из списка бесед, — по его изменению видно
 * переезд карточки в «Готово» и обратно.
 */
function doneTaskIds(board: Board): Set<string> {
  const doneColumns = new Set(board.columns.filter((c) => c.semanticType === 'done').map((c) => c.id))
  return new Set(board.tasks.filter((t) => doneColumns.has(t.columnId)).map((t) => t.id))
}

/** Совпадают ли наборы «завершённых» задач двух снапшотов доски. */
function sameDoneTasks(a: Board, b: Board): boolean {
  const before = doneTaskIds(a)
  const after = doneTaskIds(b)
  return before.size === after.size && [...before].every((id) => after.has(id))
}

/**
 * Добавляет беседу в список, если её там нет, сохраняя порядок «свежее выше».
 * Нужно для активного чата завершённой задачи: из общего списка он скрыт.
 */
function withConversation(list: Conversation[], conv: Conversation): Conversation[] {
  if (list.some((c) => c.id === conv.id)) return list
  const at = list.findIndex((c) => c.updatedAt < conv.updatedAt)
  const out = [...list]
  out.splice(at < 0 ? out.length : at, 0, conv)
  return out
}

/**
 * Ключ localStorage для фильтра «Показывать чаты завершённых задач». Настройка
 * взгляда, а не данных, поэтому живёт рядом с выбранным проектом сайдбара, а не
 * на сервере.
 */
const DONE_TASK_CHATS_KEY = 'vc.sidebar.doneTaskChats'
function loadShowDoneTaskChats(): boolean {
  try {
    return localStorage.getItem(DONE_TASK_CHATS_KEY) === '1'
  } catch {
    return false
  }
}
function saveShowDoneTaskChats(show: boolean): void {
  try {
    if (show) localStorage.setItem(DONE_TASK_CHATS_KEY, '1')
    else localStorage.removeItem(DONE_TASK_CHATS_KEY)
  } catch {
    // localStorage недоступен (приватный режим/SSR) — молча игнорируем.
  }
}

/**
 * Уведомление для тоста. Стор их только копит: показывает App (useToast), потому
 * что рисовать умеет React, а стор фреймворк-независим.
 */
export interface AppNotice {
  id: string
  kind: 'error' | 'success' | 'info'
  text: string
  /** Безопасный повтор операции: тост покажет кнопку «Повторить». */
  retry?: () => void
}

/** Область поиска в сайдбаре: названия бесед или текст сообщений (FTS5). */
export type SearchScope = 'chats' | 'messages'

/** Состояние панели поиска по сообщениям (режим «Сообщения» в сайдбаре). */
export interface MessageSearchState {
  /**
   * Запрос, которому соответствуют `hits`. Отстаёт от `state.searchQuery`: тот
   * меняется на каждое нажатие клавиши, а этот — на каждый ушедший запрос.
   */
  query: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  hits: MessageSearchHit[]
  /** Курсор следующей страницы; null — результаты закончились. */
  nextCursor: string | null
  /** Идёт догрузка следующей страницы (кнопка «Показать ещё»). */
  loadingMore: boolean
  /** Текст ошибки: панель показывает его вместо результатов, с «Повторить». */
  error: string | null
}

/** Пауза перед запросом: пользователь печатает быстрее, чем ходит сервер. */
const MESSAGE_SEARCH_DEBOUNCE_MS = 250

/**
 * Окно склейки фоновых перезапросов списка бесед. Видимость строки в сайдбаре
 * считает сервер, а меняют её события, а не действия пользователя: завершение
 * рана, резюме в фоновом чате, переезд карточки. На одно такое событие прилетает
 * сразу несколько кадров (`ci.done` + `ci.summary` + `board.update`), поэтому
 * список перечитываем не чаще раза в окно.
 */
export const CONVERSATIONS_REFRESH_DEBOUNCE_MS = 300
/** Размер страницы результатов. */
const MESSAGE_SEARCH_PAGE = 20

const EMPTY_MESSAGE_SEARCH: MessageSearchState = {
  query: '',
  status: 'idle',
  hits: [],
  nextCursor: null,
  loadingMore: false,
  error: null
}

/** Полное состояние приложения в renderer. */
export interface AppState {
  /**
   * Требуется ли вход (есть мост сессии — web). false в desktop → без экрана логина.
   */
  authRequired: boolean
  /** Текущий пользователь; null при authRequired → показываем экран логина. */
  currentUser: SessionUser | null
  /** Ошибка последнего логина (для формы). */
  authError: string | null
  voice: VoiceState
  conversations: Conversation[]
  /** Состояние загрузки списка бесед (сайдбар: скелетон / ошибка с «Повторить»). */
  conversationsStatus: LoadStatus
  /** Текст ошибки загрузки списка бесед (деталь под «Подробнее»). */
  conversationsError: string | null
  /** Текущий поисковый запрос по разговорам (пусто — показываем все). */
  searchQuery: string
  /** Что ищем этим запросом: беседы по названию или сообщения по тексту. */
  searchScope: SearchScope
  /** Результаты поиска по сообщениям (пустые, пока область — «Беседы»). */
  messageSearch: MessageSearchState
  /**
   * Сообщение, к которому надо прокрутить ленту и подсветить его (переход из
   * результатов поиска). Гасит подсветку сама лента — через `clearMessageHighlight`.
   */
  highlightMessageId: string | null
  activeId: string | null
  messages: Message[]
  /** Идёт загрузка сообщений разговора (обновление страницы / открытие чата). */
  loadingMessages: boolean
  liveSegments: LiveSegment[]
  settings: Settings
  llmEngines: LlmEngineOption[]
  settingsOpen: boolean
  draft: string
  /** Помощник промптов: список переформулировок черновика и состояние панели. */
  promptHelper: {
    /** Открыта ли панель вариантов над композером. */
    open: boolean
    /** Идёт запрос вариантов к LLM. */
    loading: boolean
    /** Полученные переформулировки. */
    variants: string[]
    /** Текст ошибки запроса (панель показывает его вместо списка). */
    error: string | null
  }
  /** Вложения, прикреплённые к следующему сообщению (ещё не отправлены). */
  attachments: UploadInfo[]
  /** Доступные микрофоны для выбора в настройках. */
  mics: MicDevice[]
  /** Реальные голоса TTS активного движка для выбора в настройках. */
  ttsVoices: TtsVoiceInfo[]
  /** Каталог скачиваемых голосов Piper. */
  voiceCatalog: CatalogVoice[]
  /** Доступно ли скачивание голосов (активен Piper). */
  voicesDownloadable: boolean
  /** Прогресс скачивания по id голоса (0–100); наличие ключа = идёт загрузка. */
  voiceDownloads: Record<string, number>
  /** Модели Whisper на диске (наличие/размер) — для управления местом. */
  whisperModels: WhisperModelInfo[]
  /** Возможности системы (ресурсы контейнера): блок STT/TTS при нехватке памяти. null — ещё не загружено. */
  capabilities: SystemCapabilities | null
  /** Лог активности агента (режим консоли). */
  consoleLog: ClaudeLogEntry[]
  /** Развёрнута ли панель консоли. */
  consoleOpen: boolean
  /**
   * Активность текущего (незавершённого) хода активного разговора — для живого
   * статуса/секций стрим-пузыря. Сбрасывается в начале хода и по его завершении.
   */
  liveActivity: ClaudeLogEntry[]
  /** Стримящийся ответ Claude (растёт по токенам); пусто — нет активного стрима. */
  streamingReply: string
  /** Незавершённые ходы модели по разговорам: id → накопленный частичный текст. */
  activeTurns: Record<string, string>
  /** Активность незавершённых ходов по разговорам — восстановление счётчика действий. */
  activeActivity: Record<string, ClaudeLogEntry[]>
  /** Метаданные последнего завершённого хода (длительность/токены/стоимость). */
  lastTurnMeta: TurnMeta | null
  /** Живые счётчики токенов текущего хода активного разговора (растут по мере ответа). */
  liveUsage: TurnUsage | null
  /** Счётчики токенов незавершённых ходов по разговорам — восстановление живого счётчика. */
  activeUsage: Record<string, TurnUsage>
  /** Подключённые MCP-серверы (read-only показ в настройках). */
  mcpServers: McpServer[]
  /** Статус входа claude/codex (показ в настройках); null — ещё не загружен. */
  loginStatus: LoginStatusMap | null
  /** Машины-агенты для удалённого выполнения команд (настройки). */
  agents: AgentInfo[]
  /** Состояние загрузки реестра машин (меню «Машины»). */
  agentsStatus: LoadStatus
  /** Текст ошибки загрузки реестра машин. */
  agentsError: string | null
  /** Открыт ли Проводник Claude Code. */
  ccOpen: boolean
  /** Проекты Claude Code (~/.claude/projects). */
  ccProjects: CcProject[]
  /** Сессии выбранного проекта. */
  ccSessions: CcSession[]
  /** Транскрипт выбранной сессии. */
  ccTranscript: CcItem[]
  /** slug выбранного проекта (null — не выбран). */
  ccProjectSlug: string | null
  /** id выбранной сессии (null — не выбрана). */
  ccSessionId: string | null
  /** Сводка расхода выбранной сессии CC (модель/токены/оценка стоимости). */
  ccUsage: SessionUsage | null
  /** Открыт ли Проводник Codex. */
  cxOpen: boolean
  /** «Проекты» Codex (cwd-группы сессий ~/.codex/sessions). */
  cxProjects: CxProject[]
  /** Сессии выбранного проекта Codex. */
  cxSessions: CxSession[]
  /** Транскрипт выбранной сессии Codex. */
  cxTranscript: CxItem[]
  /** cwd выбранного проекта Codex (null — не выбран). */
  cxProjectCwd: string | null
  /** id выбранной сессии Codex (null — не выбрана). */
  cxSessionId: string | null
  /** Сводка расхода выбранной сессии Codex (модель/токены/оценка стоимости). */
  cxUsage: SessionUsage | null
  /** Открыта ли админ-страница пользователей (только admin). */
  usersOpen: boolean
  /** Открыто ли меню «Машины» (статус агентских машин). */
  machinesOpen: boolean
  /** Список пользователей для админки. */
  adminUsers: AdminUserInfo[]
  /** Сводный расход всех пользователей для таблицы дашборда. */
  adminUsageSummary: UserUsageSummary[]
  /** Состояние загрузки списка пользователей (админка). */
  adminUsersStatus: LoadStatus
  /** Текст ошибки загрузки списка пользователей. */
  adminUsersError: string | null
  /** Выбранный пользователь в админке (null — не выбран). */
  adminSelected: string | null
  /** Отчёт по токенам выбранного пользователя (null — не загружен). */
  adminUsage: UsageReport | null
  /** Разговоры выбранного пользователя (для просмотра истории админом). */
  adminConversations: Conversation[]
  /** Сообщения открытого разговора в админ-просмотре истории. */
  adminMessages: Message[]
  /** id разговора, открытого в админ-истории (null — не открыт). */
  adminConversationId: string | null
  /** Реестр LLM-исполнителей. */
  adminLlmEngines: AdminLlmEngine[]
  /** Состояние загрузки реестра LLM-исполнителей. */
  adminLlmEnginesStatus: LoadStatus
  /** Ошибка загрузки реестра LLM-исполнителей. */
  adminLlmEnginesError: string | null
  /** Последний health-снимок по id исполнителя. */
  adminLlmEngineHealth: Record<string, AdminLlmEngineHealth | undefined>
  /** Редактируемые цены моделей для админского виджета. */
  adminModelPrices: ModelPrice[]
  /** Персональные запреты моделей текущего пользователя; пусто = полный доступ. */
  llmAccess: UserLlmAccess[]
  /** Права выбранного пользователя в админке. */
  adminUserLlmAccess: UserLlmAccess[]
  /** Открытая из меню машинная утилита (консоль/проводник) + машина; null — закрыта. */
  utility: { kind: 'console' | 'explorer'; agentId: string | null; path?: string; dir?: boolean } | null
  /**
   * Набранные в консоли команды по id машины (старые → новые) — то, что листают
   * стрелками ↑/↓. Живёт в сторе, а не в самой консоли: утилиту закрывают и
   * открывают заново десятки раз за сеанс, и локальный стейт терял бы историю.
   */
  consoleHistory: Record<string, string[]>
  /** id сообщения, которое сейчас озвучивается по кнопке (ручной повтор); null — нет. */
  speakingMessageId: string | null
  /** Доступна ли озвучка (кнопка ▶ на ответах). */
  ttsAvailable: boolean
  /** Текст последней ошибки для баннера (null — нет). */
  error: string | null
  /**
   * Очередь уведомлений для тостов: неудавшиеся вызовы мостов, успех операций
   * без видимого результата. App показывает и сразу снимает их (dismissNotice).
   */
  notices: AppNotice[]
  /** Наличие локальной модели Whisper (для баннера первого запуска). */
  modelPresent: boolean
  /** Идёт ли скачивание модели. */
  downloading: boolean
  /** Прогресс скачивания модели (0–100). */
  downloadPercent: number
  // --- Проекты + канбан ---
  /** Открыт ли режим «Проекты». */
  projectsOpen: boolean
  /** Список проектов текущего пользователя. */
  projects: ProjectSummary[]
  /** Проект, выбранный в селекте сайдбара (null — «Без проекта»). Фильтрует список/поиск чатов. */
  sidebarProjectId: string | null
  /**
   * Показывать ли в списке бесед чаты задач из колонки «Готово». Фильтрует
   * сервер, поэтому переключатель — это перезапрос списка.
   */
  showDoneTaskChats: boolean
  /**
   * Открытый чат, которого нет в отфильтрованном списке (чат завершённой
   * задачи — пришли по ссылке или из карточки). Держим его строку в сайдбаре,
   * пока он активен: из списка берут машину и рабочую папку разговора.
   */
  pinnedConversation: Conversation | null
  /** Список проектов прочитан с сервера — иначе «проекта нет» не отличить от «ещё не грузили». */
  projectsLoaded: boolean
  /** Проект, выбранный в панели деталей (null — не выбран). */
  projectDetail: ProjectDetail | null
  /** id проекта с открытой доской (null — доска закрыта). */
  activeProjectId: string | null
  /** Открыт ли оверлей настроек проекта поверх его доски. */
  projectSettingsOpen: boolean
  /** Снапшот доски активного проекта (null — не загружена). */
  board: Board | null
  /** Идёт ли загрузка доски. */
  boardLoading: boolean
  /** Текст ошибки загрузки доски (экран ошибки вместо доски / баннер над ней). */
  boardError: string | null
  /** Показывать ли на доске давно завершённые задачи (переключатель в шапке). */
  boardIncludeCompleted: boolean
  /** Открыта ли страница «Команды» (CI-раннер). */
  ciOpen: boolean
  /** Справочник CI-команд (страница «Команды»). */
  ciCommands: CiCommand[]
  /** Состояние загрузки страницы «Команды». */
  ciStatus: LoadStatus
  /** Текст ошибки загрузки страницы «Команды». */
  ciError: string | null
  /** Глобальные настройки CI (null — не загружены). */
  ciSettings: CiGlobalSettings | null
  /** Предложения модели по правке команд. */
  ciSuggestions: CiCommandSuggestion[]
  /** Отчёт по занятому месту рабочих директорий. */
  ciWorkspaces: CiWorkspaceReportItem[]
  /** Кэш деталей ранов по runId (лента + лог, realtime). */
  ciRuns: Record<string, CiRunCache>
  /** Краткие сводки ранов по taskId (доска/карточка). */
  ciSummaries: Record<string, CiRunSummary>
  /** Открытый в модалке ран (лента), null — закрыта. */
  ciActiveRunId: string | null
  /** Контекст задачи активного чата для шапки; null — чат не привязан к задаче. */
  taskChatContext: TaskChatContext | null
  /**
   * Метки чатов задач по id беседы: ключ задачи и её тип для строки списка.
   * Живут отдельно от `board` — список чатов подсвечивается и без открытой
   * доски, состояние рана берётся из `ciSummaries` по `taskId`.
   */
  taskChatBadges: Record<string, TaskChatBadge>
  /**
   * Id закрытых пауз рана. Нужен чату: вопрос продублирован туда сообщением,
   * и после ответа (из чата или из ленты) форму надо погасить — сам текст
   * сообщения при этом не меняется.
   */
  answeredCiInteractions: string[]
  /** Открыта ли панель «Использование БЗ» активного чата. */
  kbUsageOpen: boolean
  /** Телеметрия БЗ по чатам (снапшот + инкременты kb.usage). */
  kbUsage: Record<string, KbUsageCache>
  /** Телеметрия БЗ по проектам (вкладка «По проекту»). */
  kbUsageByProject: Record<string, KbUsageCache>
  /** Статус индекса БЗ: панель отличает «обращений не было» от «БЗ недоступна». */
  kbStatus: KbStatus | null
}

/** Кэш одного рана: снимок ленты + накопленный лог + заключение. */
export interface CiRunCache {
  detail: CiRunDetail | null
  log: CiLogLine[]
  conclusion: CiRunConclusion | null
  /** Ошибка последней REST-подгрузки ленты (лента показывает её с «Повторить»). */
  error?: string | null
  /** Идёт REST-подгрузка ленты. */
  loading?: boolean
}

export interface StoreDeps {
  api: RendererApi
  /** Мост сессии (web). Отсутствует (desktop) → аутентификация не требуется. */
  session?: RendererSessionBridge
  /** Мост файлового проводника по машине (web). */
  fs?: RendererFsBridge
  /** Мост чтения файлов с диска сервера (web) — картинки, созданные CLI. */
  files?: RendererFilesBridge
  /** Мост живой канбан-доски (web). */
  board?: RendererBoardBridge
  /** Мост CI-раннера (web). */
  ci?: RendererCiBridge
  /** Мост телеметрии БЗ (web); без него панель живёт на фолбэке из истории. */
  kb?: RendererKbBridge
  /** Источник времени (для формата HH:MM). По умолчанию Date.now. */
  now?: () => number
  /** Переопределение задержек пайплайна (для тестов). */
  delays?: Partial<PipelineDelays>
  /** Контроллер захвата аудио. Отсутствует в тестах/headless → запись пропускается. */
  audio?: AudioController | null
  /** Источник списка микрофонов (enumerateDevices). Отсутствует → mics пуст. */
  listMics?: () => Promise<MicDevice[]>
  /**
   * true — live-транскрипт и финал приходят от реального STT (события stt:*),
   * мок-рост транскрипта отключён. false (по умолчанию) — мок-пайплайн.
   */
  sttEnabled?: boolean
  /** Разрешён ли запуск захвата микрофона. По умолчанию разрешён для обратной совместимости. */
  voiceInputEnabled?: boolean
  /**
   * true — ответ приходит от реального Claude (события claude:*), мок-ответ
   * отключён. false (по умолчанию) — мок-ответ.
   */
  claudeEnabled?: boolean
  /** Отправка реплики в Claude (renderer → main). Обязателен при claudeEnabled. */
  sendClaudePrompt?: (
    conversationId: string,
    segments: SttSegmentWire[],
    attachments?: string[],
    verbose?: boolean,
    execTarget?: string | null
  ) => void
  /** Отмена текущего запроса к Claude (renderer → main). */
  cancelClaude?: (conversationId?: string) => void
  /** Запрос статуса модели Whisper (наличие). */
  getSttStatus?: () => Promise<SttStatus>
  /** Запуск скачивания модели Whisper (renderer → main). */
  startModelDownload?: () => void
  /**
   * true — длительность speaking задаёт реальный TTS (события tts:*),
   * иначе (по умолчанию) — фиксированный мок-таймер.
   */
  ttsEnabled?: boolean
  /** Озвучить текст (renderer → main). Обязателен при ttsEnabled. */
  speakText?: (text: string, voice: string) => void
  /** Прервать озвучку (renderer → main). */
  cancelTts?: () => void
  /** Запустить скачивание голоса Piper (renderer → main). */
  startVoiceDownload?: (id: string) => void
  /** Сохранение файла на диск (экспорт). По умолчанию — через `<a download>`. */
  download?: (filename: string, mime: string, data: string) => void
  /** Открыть URL (скачивание .dmg). По умолчанию — window.location.assign. */
  openUrl?: (url: string) => void
  /** Начать live-tail сессии Claude Code (renderer → main/ws). */
  ccTailStart?: (slug: string, id: string) => void
  /** Остановить live-tail. */
  ccTailStop?: () => void
  /** Начать live-tail сессии Codex (renderer → main/ws). */
  cxTailStart?: (id: string) => void
  /** Остановить live-tail Codex. */
  cxTailStop?: () => void
}

/** Действия, дергаемые из UI. Все асинхронные операции инкапсулированы здесь. */
export interface StoreActions {
  /**
   * Первичная загрузка. `preferredChatId` — id чата из адреса (#/chat/:id):
   * открываем именно его, а не самый свежий.
   */
  init(preferredChatId?: string | null): Promise<void>
  /** Войти по логину/паролю (web). Успех → загрузка данных пользователя. */
  login(name: string, password: string): Promise<void>
  /** Выйти: очистить сессию и данные, показать экран логина (web). */
  logout(): Promise<void>
  /** Открыть локальный черновик; специальные web-recorder создаются сразу. */
  newConversation(assistantKind?: 'web-recorder'): Promise<string | null>
  /** Открыть разговор. `false` — такого разговора нет (удалён/чужой). */
  selectConversation(id: string): Promise<boolean>
  deleteConversation(id: string): Promise<void>
  /** Переименовать разговор (БД + список). Пустое имя игнорируется. */
  renameConversation(id: string, title: string): Promise<void>
  /** Изменить машину только одного разговора. */
  setConversationExecTarget(id: string, execTarget: string | null, workdir?: string | null, skillNames?: string[], llmProvider?: LlmProvider | null, llmModel?: string | null, permissionMode?: PermissionMode | null, kbContextMode?: KbContextMode, llmEngineId?: string | null): Promise<void>
  setConversationProject(id: string, projectId: string | null): Promise<void>
  fetchConversationMachines(id: string, projectId?: string | null): Promise<AgentInfo[]>
  setConversationPreviewUrl(id: string, previewUrl: string | null): Promise<void>
  /** Сменить статус жизненного цикла чата (дропдаун в сайдбаре). */
  setConversationStatus(id: string, status: ConversationStatus): Promise<void>
  /** Задать поисковый запрос (пусто — весь список / пустая панель поиска). */
  setSearchQuery(query: string): Promise<void>
  /** Переключить область поиска: беседы или сообщения. */
  setSearchScope(scope: SearchScope): Promise<void>
  /** Повторить упавший поиск по сообщениям (кнопка «Повторить»). */
  retryMessageSearch(): Promise<void>
  /** Повторить упавшую загрузку списка бесед (кнопка «Повторить» в сайдбаре). */
  retryConversations(): Promise<void>
  /** Перечитать реестр машин (кнопка «Повторить» в меню «Машины»). */
  refreshAgents(): Promise<void>
  /** Догрузить следующую страницу результатов поиска по сообщениям. */
  loadMoreMessageSearch(): Promise<void>
  /** Прокрутить ленту к сообщению и подсветить его (переход из поиска). */
  focusMessage(messageId: string): void
  /** Снять подсветку сообщения (лента отсветила своё). */
  clearMessageHighlight(): void
  /** Выбрать проект в сайдбаре (null — «Без проекта»); фильтрует список/поиск чатов. */
  setSidebarProject(projectId: string | null): Promise<void>
  /** Показывать ли в списке бесед чаты задач, завершённых на доске. */
  setShowDoneTaskChats(show: boolean): Promise<void>
  /** Экспортировать активный разговор в Markdown/JSON (скачивание файла). */
  exportConversation(format: 'md' | 'json'): void
  /** Завершить (или пропустить) приветственный мастер. */
  completeOnboarding(): Promise<void>
  openSettings(): void
  closeSettings(): void
  updateSettings(patch: Partial<Settings>): Promise<void>
  setDraft(value: string): void
  /** Отправить черновик; true означает успешную постановку хода. */
  submitText(previewElement?: PreviewElementPayload): Promise<boolean>
  /** Помощник промптов: запросить переформулировки текущего черновика у LLM. */
  suggestPrompts(): Promise<void>
  /** Применить выбранный вариант: заполнить черновик и закрыть панель. */
  applyPromptSuggestion(text: string): void
  /** Закрыть панель помощника промптов, ничего не меняя. */
  closePromptSuggestions(): void
  /** Отправить собранные ответы на вопросы модели (форма в чате) как реплику. */
  answerQuestions(text: string): Promise<void>
  /** Повторить исходный запрос планового ответа уже в режиме авто-правок. */
  executePlan(answerId: string): Promise<void>
  /** Отменить текущий запрос к Claude и вернуться в idle (случайно отправил). */
  cancelRequest(): void
  /** Удалить сообщение из истории (БД + лента). */
  deleteMessage(id: string): Promise<void>
  /** Исправить сообщение пользователя: удалить его и все последующие, переспросить. */
  editMessage(id: string, newText: string): Promise<void>
  /** Персистентно отметить одно предложение задачи созданным или отклонённым. */
  updateTaskLaunchStatus(messageId: string, proposalId: string, status: 'created' | 'declined'): Promise<void>
  /** Прикрепить файл к следующему сообщению (загрузка на сервер). */
  addAttachment(file: File): Promise<void>
  /** Убрать прикреплённый файл по id. */
  removeAttachment(id: string): void
  startVoice(): void
  stopVoice(): void
  stopSpeak(): void
  /** Кадр энергии микрофона (для VAD: barge-in во время озвучки, hands-free-пауза). */
  applyMicEnergy(rms: number): void
  /** Применить частичную гипотезу распознавания (stt:partial). */
  applySttPartial(update: SttUpdate): void
  /** Применить финальный транскрипт (stt:final) — запускает ответ. */
  applySttFinal(update: SttUpdate): void
  /** Обработать ошибку распознавания (stt:error). */
  applySttError(message: string): void
  /** Применить фрагмент ответа Claude (claude:token); conversationId — чей ход. */
  applyClaudeToken(delta: string, conversationId?: string): void
  /** Применить завершение ответа Claude (claude:done); message — сообщение, сохранённое сервером. */
  applyClaudeDone(
    text: string,
    meta?: TurnMeta,
    engine?: LlmProvider,
    message?: Message,
    conversationId?: string
  ): void
  /** Обработать ошибку Claude (claude:error). */
  applyClaudeError(message: string, conversationId?: string): void
  /** Применить снапшот активных ходов (claude:active) — восстановление стрима. */
  applyClaudeActive(turns: ActiveTurn[]): void
  /** Применить живые счётчики токенов хода (claude:usage); conversationId — чей ход. */
  applyClaudeUsage(usage: TurnUsage, conversationId?: string): void
  /** Скрыть баннер ошибки. */
  dismissError(): void
  /** Поставить уведомление в очередь тостов (успех операции, ошибка). */
  notify(notice: Omit<AppNotice, 'id'>): void
  /** Снять показанное уведомление из очереди. */
  dismissNotice(id: string): void
  /** Запустить скачивание модели Whisper. */
  downloadModel(): void
  /** Прогресс скачивания модели (stt:downloadProgress). */
  applyDownloadProgress(percent: number): void
  /** Скачивание модели завершено (stt:downloadDone). */
  applyDownloadDone(): void
  /** Ошибка скачивания модели (stt:downloadError). */
  applyDownloadError(message: string): void
  /** Пришло синтезированное аудио (tts:audio) — замер времени генерации речи. */
  applyTtsAudioReceived(): void
  /** Один клип озвучки доигран (tts:audio закончился). */
  applyTtsDone(): void
  /** Ошибка озвучки (tts:error). */
  applyTtsError(message: string): void
  /** Ручной повтор озвучки сообщения по кнопке (toggle ▶/⏹). */
  replayMessage(id: string, text: string): void
  /** Запустить скачивание голоса Piper по id. */
  downloadVoice(id: string): void
  /** Удалить установленный голос Piper (освободить место). */
  deleteVoice(id: string): Promise<void>
  /** Удалить файл модели Whisper (освободить место). */
  deleteModel(model: WhisperModel): Promise<void>
  /** Создать машину-агента; возвращает данные с одноразовым токеном. */
  createAgent(name: string): Promise<AgentCreated | null>
  /** Удалить машину-агента (отзыв токена). */
  deleteAgent(id: string): Promise<void>
  /** Скачать десктоп-приложение (Mac, .dmg). */
  downloadDesktopApp(): Promise<void>
  /** Скачать трей-приложение агента (Mac, .dmg). */
  downloadAgentApp(): Promise<void>
  /** Скачать скрипт агента (Node, .cjs). */
  downloadAgentScript(): Promise<void>
  /** Получить строку подключения для настройки агента (приложение или скрипт). */
  getAgentConnectionString(token: string): Promise<string | null>
  /** Применить живой список машин (пуш по WebSocket). */
  applyAgents(agents: AgentInfo[]): void
  /** Сохранить политику возможностей машины. */
  setAgentPolicy(id: string, policy: AgentPolicy): Promise<void>
  /** Перевыпустить токен машины; возвращает новую строку подключения (или null). */
  regenerateAgentToken(id: string): Promise<string | null>
  /** Обновить агента на машине; null — команда запущена, строка — ошибка. */
  updateAgent(id: string): Promise<string | null>
  /** Открыть меню «Машины» (статус агентских машин); подтягивает список. */
  openMachines(): void
  /** Закрыть меню «Машины». */
  closeMachines(): void
  /**
   * Добавить запись активности агента (claude:log) в лог консоли и, если запись
   * относится к активному разговору, — в активность текущего хода (liveActivity).
   */
  applyClaudeLog(entry: ClaudeLogEntry, conversationId?: string): void
  /** Свернуть/развернуть панель консоли. */
  toggleConsole(): void
  /** Открыть Проводник Claude Code (грузит проекты). */
  openObserver(): Promise<void>
  /** Закрыть Проводник (останавливает live-tail). */
  closeObserver(): void
  /** Выбрать проект (грузит сессии). */
  selectCcProject(slug: string): Promise<void>
  /** Выбрать сессию (грузит транскрипт + запускает live-tail). */
  selectCcSession(slug: string, id: string): Promise<void>
  /** Продолжить сессию: создать разговор с импортом истории и привязкой к session-id. */
  resumeCcSession(slug: string, id: string): Promise<string | null>
  /** Добавить пришедшие по live-tail записи в транскрипт. */
  applyCcTailItems(items: CcItem[]): void
  /** Открыть Проводник Codex (грузит проекты). */
  openCodexObserver(): Promise<void>
  /** Закрыть Проводник Codex (останавливает live-tail). */
  closeCodexObserver(): void
  /** Выбрать проект Codex по cwd (грузит сессии). */
  selectCxProject(cwd: string): Promise<void>
  /** Выбрать сессию Codex (грузит транскрипт + запускает live-tail). */
  selectCxSession(id: string): Promise<void>
  /** Продолжить сессию Codex: создать разговор с импортом истории и переключить движок на Codex. */
  resumeCxSession(id: string): Promise<string | null>
  /** Добавить пришедшие по live-tail записи в транскрипт Codex. */
  applyCxTailItems(items: CxItem[]): void
  /** Прогресс скачивания голоса (tts:voiceProgress). */
  applyVoiceProgress(id: string, percent: number): void
  /** Голос скачан (tts:voiceDone) — обновляет списки. */
  applyVoiceDone(id: string): void
  /** Ошибка скачивания голоса (tts:voiceError). */
  applyVoiceError(id: string, message: string): void
  // --- Админ-страница пользователей (только admin) ---
  /** Открыть страницу пользователей (грузит список). */
  openUsers(): Promise<void>
  /** Закрыть страницу пользователей. */
  closeUsers(): void
  /** Создать пользователя (admin). */
  createUserAccount(name: string, password: string, role: 'admin' | 'user'): Promise<void>
  /** Блокировать/разблокировать пользователя. */
  setUserBlocked(name: string, blocked: boolean): Promise<void>
  /** Удалить пользователя и все его данные. */
  deleteUserAccount(name: string): Promise<void>
  /** Выбрать пользователя в админке (грузит отчёт по токенам и разговоры). */
  selectAdminUser(name: string): Promise<void>
  /** Загрузить отчёт по токенам выбранного пользователя. */
  loadAdminUsage(unit: UsageUnit, from?: number, to?: number, conversationId?: string): Promise<void>
  /** Открыть разговор пользователя в админ-просмотре истории. */
  openAdminConversation(conversationId: string): Promise<void>
  /** Перечитать реестр LLM-исполнителей. */
  refreshAdminLlmEngines(): Promise<void>
  refreshAdminModelPrices(): Promise<void>
  saveAdminModelPrice(input: ModelPriceInput): Promise<void>
  deleteAdminModelPrice(provider: string, model: string): Promise<void>
  /** Создать запись исполнителя. */
  createAdminLlmEngine(input: AdminLlmEngineInput): Promise<void>
  /** Обновить запись исполнителя. */
  updateAdminLlmEngine(id: string, patch: AdminLlmEngineInput): Promise<void>
  /** Удалить запись исполнителя. */
  deleteAdminLlmEngine(id: string): Promise<void>
  /** Проверить живость исполнителя. */
  checkAdminLlmEngineHealth(id: string): Promise<void>
  loadAdminUserLlmAccess(name?: string): Promise<void>
  saveAdminUserLlmAccess(access: UserLlmAccess[]): Promise<void>
  // --- Машинные утилиты (консоль/проводник) ---
  /**
   * Открыть утилиту из меню (машина по умолчанию — первая онлайн-своя). `dir`
   * говорит, что `path` — это папка: проводник откроется ВНУТРИ неё, а не в
   * родителе файла (так переключаются утилиты в шапке, сохраняя папку).
   */
  openUtility(kind: 'console' | 'explorer', agentId?: string | null, path?: string, dir?: boolean): void
  openUtilityForActiveChat(kind: 'console' | 'explorer'): void
  /** Закрыть утилиту, открытую из меню. */
  closeUtility(): void
  /** Тонкие операции над машиной (используются самодостаточными виджетами). */
  fsList(agentId: string, path: string): Promise<FsResult>
  /** Прочитать файл машины (base64) — например, картинку для показа в сообщении. */
  fsRead(agentId: string, path: string): Promise<FsResult>
  /** Прочитать файл с диска сервера (картинки от CLI); null — файла там нет. */
  readServerFile(path: string): Promise<ServerFileInfo | null>
  fsWrite(agentId: string, path: string, dataBase64: string): Promise<FsResult>
  fsRemove(agentId: string, path: string): Promise<FsResult>
  fsRename(agentId: string, from: string, to: string): Promise<FsResult>
  fsMkdir(agentId: string, path: string): Promise<FsResult>
  /** Скачать файл машины (чтение + сохранение через браузер). */
  downloadFsFile(agentId: string, path: string, name: string): Promise<void>
  /** Загрузить файл на машину в указанный каталог; возвращает обновлённый листинг. */
  uploadFsFile(agentId: string, dir: string, file: File): Promise<FsResult>
  /** Выполнить команду на машине (консоль); `signal` — «Стоп» в консоли. */
  agentExec(agentId: string, command: string, signal?: AbortSignal): Promise<AgentExecResult>
  /** Запомнить выполненную в консоли команду (история ↑/↓ по машине). */
  pushConsoleCommand(agentId: string, command: string): void
  // --- Проекты + канбан ---
  /** Открыть режим «Проекты» (грузит список). */
  openProjects(): Promise<void>
  /** Закрыть режим «Проекты». */
  closeProjects(): void
  /** Перечитать список проектов. */
  refreshProjects(): Promise<ProjectSummary[]>
  /** Выбрать проект в панель деталей (грузит состав). */
  selectProject(id: string): Promise<void>
  /** Создать проект. */
  createProject(input: {
    name: string
    description?: string
    gitUrl?: string
    technologies?: string[]
    skills?: string[]
    defaultSkills?: Partial<WorkItemDefaultSkills>
    commitPolicy?: 'agent_commits' | 'final_system_commit' | 'manual_user_confirmation'

    mergeTransport?: 'local' | 'github_pull_request'
    agentPlanApprovalMode?: 'manual' | 'automatic'
    testCommand?: string
    productionDeployCommand?: string
    productionAgentId?: string | null
    productionCheckoutPath?: string
    productionHealthCheckCommand?: string
  }): Promise<ProjectDetail | null>
  /** Обновить поля проекта (только владелец). */
  updateProject(
    id: string,
    fields: {
      name?: string
      description?: string
      gitUrl?: string | null
      previewUrl?: string | null
      technologies?: string[]
      skills?: string[]
      defaultSkills?: Partial<WorkItemDefaultSkills>
    commitPolicy?: 'agent_commits' | 'final_system_commit' | 'manual_user_confirmation'

    mergeTransport?: 'local' | 'github_pull_request'
    agentPlanApprovalMode?: 'manual' | 'automatic'
    testCommand?: string
    productionDeployCommand?: string
    productionAgentId?: string | null
    productionCheckoutPath?: string
    productionHealthCheckCommand?: string
    ciBaseBranch?: string
    ciBranchTemplate?: string
    ciReuseStrategy?: 'reuse' | 'clean' | 'fail'
    ciExecAuthRef?: string
    doneRetentionDays?: number | null
    }
  ): Promise<void>
  /** Удалить проект (только владелец). */
  deleteProject(id: string): Promise<void>
  /** Добавить/убрать участника (только владелец). */
  addProjectMember(id: string, username: string): Promise<void>
  removeProjectMember(id: string, username: string): Promise<void>
  /** Привязать/отвязать машину-агента (только владелец). */
  linkProjectMachine(id: string, agentId: string): Promise<void>
  unlinkProjectMachine(id: string, agentId: string): Promise<void>
  setProjectMachinePath(id: string, agentId: string, path: string): Promise<void>
  setProjectReposRoot(id: string, agentId: string, reposRoot: string): Promise<void>
  setProjectDefaultMachine(id: string, agentId: string): Promise<void>
  fetchProjectDetail(id: string): Promise<ProjectDetail | null>
  /** Открыть доску проекта (грузит снапшот, подписывается на живые обновления). */
  openBoard(id: string): Promise<void>
  /** Закрыть доску (отписка). */
  closeBoard(): void
  /** Открыть/закрыть оверлей настроек проекта на его странице. */
  openProjectSettings(): void
  closeProjectSettings(): void
  /** Применить живой снапшот доски (из WS board.update). */
  applyBoardUpdate(projectId: string, board: Board): void
  /** Переключатель «Показать завершённые»: перезапрашивает доску и подписку. */
  setBoardIncludeCompleted(include: boolean): Promise<void>
  /** Колонки активной доски. */
  createColumn(name: string): Promise<void>
  updateColumn(columnId: string, fields: { name?: string; wipLimit?: number | null }): Promise<void>
  setColumnHidden(columnId: string, hidden: boolean): Promise<void>
  reorderColumns(order: string[]): Promise<void>
  deleteColumn(columnId: string): Promise<void>
  /** Задачи активной доски. */
  createTask(
    columnId: string,
    input: { title: string; description?: string; acceptanceCriteria?: string; type?: WorkItemType; parentId?: string | null; priority?: TaskPriority; assignee?: string | null }
  ): Promise<void>
  /** Создать задачу из чата проекта и сразу поставить её CI-ран в общую FIFO-очередь. */
  createTaskAndStartCi(
    projectId: string,
    input: { title: string; description?: string; acceptanceCriteria?: string; priority?: TaskPriority; assignee?: string | null; provider: 'claude' | 'codex'; model: string }
  ): Promise<CiRun | null>
  updateTask(
    taskId: string,
    fields: { title?: string; description?: string; acceptanceCriteria?: string; type?: WorkItemType; parentId?: string | null; priority?: TaskPriority; assignee?: string | null; labels?: string[]; skills?: string[]; storyPoints?: number | null; dueDate?: number | null; flagged?: boolean }
  ): Promise<void>

  /** Переместить задачу (смена статуса = смена колонки); оптимистично. */
  moveTask(taskId: string, columnId: string, afterId?: string | null, beforeId?: string | null): Promise<void>
  deleteTask(taskId: string): Promise<void>
  /** Открыть (создав при необходимости) связанный с задачей чат и переключиться на него. */
  openTaskChat(taskId: string): Promise<string | null>
  /** Создать связанный чат, не переключаясь на него (открытие карточки). */
  ensureTaskChat(taskId: string): Promise<void>
  loadTaskChatContext(id: string): Promise<void>

  // --- CI-раннер ---
  openCi(): Promise<void>
  closeCi(): void
  reloadCiCommands(projectId?: string): Promise<void>
  createCiCommand(input: CiCommandInput): Promise<CiCommand | null>
  updateCiCommand(id: string, input: CiCommandInput): Promise<void>
  deleteCiCommand(id: string): Promise<void>
  ciCommandUsage(id: string): Promise<{ projects: Array<{ id: string; name: string }>; tasks: Array<{ id: string; title: string }> }>
  saveCiSettings(settings: Partial<CiGlobalSettings>): Promise<void>
  resolveCiSuggestion(id: string, accept: boolean): Promise<void>
  reloadCiWorkspaces(projectId?: string): Promise<void>
  startCiRun(projectId: string, taskId: string, options?: CiRunMode | { mode?: CiRunMode; provider?: 'claude' | 'codex'; model?: string; launch?: 'queue' | 'parallel' }): Promise<CiRun | null>
  /** Запустить отдельный merge workflow; сервер повторно валидирует все условия. */
  startMergeRun(projectId: string, taskId: string, agentId?: string | null): Promise<boolean>
  cancelCiRun(runId: string): Promise<void>
  /** Исключить только ожидающий ран из очереди CI. */
  dequeueCiRun(runId: string): Promise<void>
  retryCiRun(runId: string): Promise<CiRun | null>
  retryCiRunFromStep(runId: string, selection?: { provider: 'claude' | 'codex'; model: string; llmEngineId?: string | null }): Promise<CiRun | null>
  discardCiWorkspaceAndRetry(runId: string): Promise<CiRun | null>
  loadCiRun(runId: string): Promise<void>
  openCiRun(runId: string): void
  closeCiRun(): void
  ciSubscribe(runId: string): void
  ciUnsubscribe(runId: string): void
  applyCiSnapshot(runId: string, detail: CiRunDetail, log: CiLogLine[]): void
  applyCiRun(runId: string, run: CiRun): void
  applyCiStep(runId: string, step: CiRunStep): void
  applyCiLog(runId: string, line: CiLogLine): void
  applyCiFix(runId: string, attempt: CiFixAttempt): void
  applyCiDone(runId: string, run: CiRun, conclusion?: CiRunConclusion): void
  applyCiSummary(projectId: string, summary: CiRunSummary): void
  applyCiInteraction(runId: string, interaction: CiInteraction): void
  /** Сообщение, дописанное сервером в чат (резюме CI-рана). */
  applyChatMessage(conversationId: string, message: Message): void
  /** Панель «Использование БЗ»: открыть/закрыть. */
  openKbUsage(): void
  closeKbUsage(): void
  /** Снапшот телеметрии БЗ чата (+ фолбэк по истории, если моста нет). */
  loadKbUsage(conversationId: string): Promise<void>
  /** Снапшот телеметрии БЗ проекта (вкладка «По проекту»). */
  loadProjectKbUsage(projectId: string): Promise<void>
  /** Живой кадр kb.usage: upsert по id с отсечкой по seq. */
  applyKbUsageQuery(conversationId: string, projectId: string | null, query: KbUsageQuery): void
  /** Статус индекса БЗ (для пустых состояний панели). */
  refreshKbStatus(): Promise<void>
  answerCiInteraction(runId: string, interactionId: string, answer: CiInteractionAnswer): Promise<void>
  /** Отмена всех активных таймеров пайплайна (напр. при размонтировании). */
  dispose(): void
}

export interface VoiceStore {
  getState(): AppState
  subscribe(listener: () => void): () => void
  actions: StoreActions
}

function initialState(): AppState {
  return {
    authRequired: false,
    currentUser: null,
    authError: null,
    voice: 'idle',
    conversations: [],
    conversationsStatus: 'loading',
    conversationsError: null,
    searchQuery: '',
    searchScope: 'chats',
    messageSearch: { ...EMPTY_MESSAGE_SEARCH },
    highlightMessageId: null,
    activeId: null,
    messages: [],
    loadingMessages: false,
    liveSegments: [],
    settings: { ...DEFAULT_SETTINGS },
    llmEngines: [],
    settingsOpen: false,
    draft: '',
    promptHelper: { open: false, loading: false, variants: [], error: null },
    attachments: [],
    mics: [],
    ttsVoices: [],
    voiceCatalog: [],
    voicesDownloadable: false,
    voiceDownloads: {},
    whisperModels: [],
    capabilities: null,
    consoleLog: [],
    consoleOpen: true,
    liveActivity: [],
    streamingReply: '',
    activeTurns: {},
    activeActivity: {},
    lastTurnMeta: null,
    liveUsage: null,
    activeUsage: {},
    mcpServers: [],
    loginStatus: null,
    agents: [],
    agentsStatus: 'loading',
    agentsError: null,
    ccOpen: false,
    ccProjects: [],
    ccSessions: [],
    ccTranscript: [],
    ccProjectSlug: null,
    ccSessionId: null,
    ccUsage: null,
    cxOpen: false,
    cxProjects: [],
    cxSessions: [],
    cxTranscript: [],
    cxProjectCwd: null,
    cxSessionId: null,
    cxUsage: null,
    usersOpen: false,
    machinesOpen: false,
    adminUsers: [],
    adminUsageSummary: [],
    adminUsersStatus: 'loading',
    adminUsersError: null,
    adminSelected: null,
    adminUsage: null,
    adminConversations: [],
    adminMessages: [],
    adminConversationId: null,
    adminLlmEngines: [],
    adminLlmEnginesStatus: 'loading',
    adminLlmEnginesError: null,
    adminLlmEngineHealth: {},
    adminModelPrices: [],
    llmAccess: [],
    adminUserLlmAccess: [],
    utility: null,
    consoleHistory: {},
    speakingMessageId: null,
    ttsAvailable: false,
    error: null,
    notices: [],
    modelPresent: true,
    downloading: false,
    downloadPercent: 0,
    projectsOpen: false,
    projects: [],
    sidebarProjectId: loadSidebarProject(),
    showDoneTaskChats: loadShowDoneTaskChats(),
    pinnedConversation: null,
    projectsLoaded: false,
    projectDetail: null,
    activeProjectId: null,
    projectSettingsOpen: false,
    board: null,
    boardLoading: false,
    boardError: null,
    boardIncludeCompleted: false,
    ciOpen: false,
    ciCommands: [],
    ciStatus: 'loading',
    ciError: null,
    ciSettings: null,
    ciSuggestions: [],
    ciWorkspaces: [],
    ciRuns: {},
    ciSummaries: {},
    ciActiveRunId: null,
    taskChatContext: null,
    taskChatBadges: {},
    answeredCiInteractions: [],
    kbUsageOpen: false,
    kbUsage: {},
    kbUsageByProject: {},
    kbStatus: null
  }
}

/** Кодирует File в base64 (без префикса data:) для загрузки на сервер. */
async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Текст сообщения пользователя с пометкой о вложениях (для истории). */
function composeUserText(text: string, attachments: UploadInfo[]): string {
  if (attachments.length === 0) return text
  const note = `📎 ${attachments.map((a) => a.name).join(', ')}`
  return text ? `${text}\n\n${note}` : note
}

export function createVoiceStore(deps: StoreDeps): VoiceStore {
  const { api } = deps
  const boardBridge = deps.board
  const ciBridge = deps.ci
  const kbBridge = deps.kb
  const now = deps.now ?? Date.now
  const delays: PipelineDelays = { ...DEFAULT_DELAYS, ...deps.delays }
  const audio = deps.audio ?? null
  const sttEnabled = deps.sttEnabled ?? false
  const claudeEnabled = deps.claudeEnabled ?? false
  const ttsEnabled = deps.ttsEnabled ?? false

  let state = { ...initialState(), ttsAvailable: ttsEnabled }
  const listeners = new Set<() => void>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  // Периодический опрос статуса входа claude/codex — чтобы вход в CLI при
  // работающем приложении отражался без перезагрузки.
  let loginStatusPoll: ReturnType<typeof setInterval> | null = null

  function getState(): AppState {
    return state
  }

  function setState(patch: Partial<AppState>): void {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  }

  /**
   * Состояние, принадлежащее конкретному чату: при любой смене `activeId` его
   * надо обнулить одним патчем. Иначе оно залипает в следующем чате — так виджет
   * задачи оставался в новом разговоре, потому что контекст чистила только
   * `loadTaskChatContext`, а её звал лишь `selectConversation`.
   */
  function chatScopedReset(): Pick<AppState, 'messages' | 'taskChatContext'> {
    return { messages: [], taskChatContext: null }
  }

  /**
   * То же плюс живое состояние хода: нужно там, где чат открывают заново
   * (выбор чата, «Новый разговор»), а не досылают в него готовую историю.
   */
  function chatSwitchReset(): Partial<AppState> {
    return {
      ...chatScopedReset(),
      liveSegments: [],
      consoleLog: [],
      liveActivity: [],
      voice: 'idle',
      streamingReply: '',
      lastTurnMeta: null,
      liveUsage: null
    }
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  /** Планирование шага пайплайна с отменяемым таймером. */
  function schedule(fn: () => void, ms: number): void {
    const id = setTimeout(() => {
      timers.delete(id)
      fn()
    }, ms)
    timers.add(id)
  }

  function cancelTimers(): void {
    timers.forEach((id) => clearTimeout(id))
    timers.clear()
  }

  // --- VAD: barge-in (speaking) и hands-free авто-пауза (listening) --------
  const bargeVad = new VadDetector()
  const handsVad = new VadDetector()
  let bargeMonitorStop: (() => void) | null = null

  /** Держит энерго-монитор включённым ровно в состоянии speaking при bargeIn. */
  function syncBargeMonitor(): void {
    const want = state.voice === 'speaking' && state.settings.bargeIn && !!audio?.monitor
    if (want && !bargeMonitorStop) {
      bargeVad.reset()
      // Плейсхолдер, пока промис стартует (чтобы не запустить два монитора).
      bargeMonitorStop = () => {}
      void audio!
        .monitor!(state.settings.micDeviceId, (r) => applyMicEnergy(r))
        .then((stop) => {
          if (state.voice === 'speaking') bargeMonitorStop = stop
          else stop() // уже вышли из speaking, пока стартовали
        })
        .catch(() => {
          bargeMonitorStop = null
        })
    } else if (!want && bargeMonitorStop) {
      bargeMonitorStop()
      bargeMonitorStop = null
    }
  }

  /** Голосовой переход через машину состояний. Возвращает true, если он допустим. */
  function dispatchVoice(event: VoiceEvent): boolean {
    const prev = state.voice
    const res = transition(prev, event)
    if (res.ok) {
      setState({ voice: res.state })
      syncBargeMonitor()
      // Hands-free: ход завершён (speaking → idle) → снова слушаем.
      if (res.state === 'idle' && prev === 'speaking' && state.settings.handsFree) {
        schedule(() => {
          if (state.voice === 'idle' && state.settings.handsFree) startVoice()
        }, HANDS_FREE_GAP_MS)
      }
    }
    return res.ok
  }

  /**
   * Кадр энергии микрофона: VAD.
   * - speaking + bargeIn → начало речи прерывает озвучку и включает запись (barge-in);
   * - listening + handsFree → пауза после речи авто-финализирует запись.
   */
  function applyMicEnergy(rmsValue: number): void {
    if (state.voice === 'speaking' && state.settings.bargeIn) {
      if (bargeVad.push(rmsValue) === 'speech-start') startVoice() // barge-in
    } else if (state.voice === 'listening' && state.settings.handsFree) {
      if (handsVad.push(rmsValue) === 'speech-end') stopVoice() // авто-пауза
    }
  }

  /**
   * Перечитать список бесед. `keepActiveListed` — обновление по событию, а не по
   * действию пользователя: активный чат, который сервер только что скрыл (задача
   * уехала в «Готово»), закрепляем, чтобы строка не исчезла из-под открытого
   * чата. В действиях пользователя так делать нельзя: удаление активного чата
   * тоже убирает его из ответа, а закреплять удалённое незачем.
   */
  async function refreshConversations(
    { keepActiveListed = false }: { keepActiveListed?: boolean } = {}
  ): Promise<void> {
    const q = state.searchQuery.trim()
    // Статус ведём отдельно от данных: сайдбар покажет скелетон только пока
    // списка нет, а при повторном чтении оставит его на месте (lib/loadState.ts).
    setState({ conversationsStatus: 'loading', conversationsError: null })
    try {
      const includeCompleted = state.showDoneTaskChats
      const all = q
        ? await api['conversations:search']({ query: q, includeCompleted })
        : await api['conversations:list']({ includeCompleted })
      if (keepActiveListed) pinActiveIfHidden(all, q)
      // Список/поиск сужаем до выбранного в сайдбаре проекта (null — чаты без проекта).
      const pid = state.sidebarProjectId
      const conversations = keepPinned(all.filter((c) => (c.projectId ?? null) === pid), pid, q)
      setState({ conversations, conversationsStatus: 'ready', conversationsError: null })
      void loadTaskChatBadges()
    } catch (err) {
      setState({
        conversationsStatus: 'error',
        conversationsError: err instanceof Error ? err.message : String(err)
      })
      throw err
    }
  }

  /**
   * Активный чат пропал из ответа сервера, хотя поиска нет — значит его скрыли
   * как чат завершённой задачи. Закрепляем строку (дальше её вернёт `keepPinned`):
   * вместе с ней из шапки пропали бы машина и рабочая папка разговора.
   */
  function pinActiveIfHidden(all: Conversation[], query: string): void {
    const active = state.activeId
    if (!active || query || all.some((c) => c.id === active)) return
    const conv =
      state.pinnedConversation?.id === active
        ? state.pinnedConversation
        : state.conversations.find((c) => c.id === active) ?? null
    if (conv) setState({ pinnedConversation: conv })
  }

  /**
   * Возвращает в список закреплённый чат — открытый, но скрытый как чат
   * завершённой задачи (`pinnedConversation`). Только его: пропажа строки из-за
   * поиска или смены проекта — это нормальная фильтрация, а не потеря доступа.
   */
  function keepPinned(list: Conversation[], pid: string | null, query: string): Conversation[] {
    const pinned = state.pinnedConversation
    if (!pinned || pinned.id !== state.activeId) return list
    if (query || (pinned.projectId ?? null) !== pid) return list
    return withConversation(list, pinned)
  }

  let conversationsRefreshTimer: ReturnType<typeof setTimeout> | null = null
  // Стабилен между повторами одной первой отправки: потерянный HTTP-ответ не
  // создаст второй разговор. Сбрасывается новым черновиком или после успеха.
  let pendingDraftKey: string | null = null

  /**
   * Перечитать список бесед из-за события, а не действия пользователя. Раньше
   * список обновляли только действия (отправка, выбор, поиск), и открытая
   * страница не узнавала, что чат уехавшей в «Готово» задачи сервер уже скрыл:
   * строка висела до перезагрузки.
   *
   * Кто виден — по-прежнему решает сервер: клиент только перезапрашивает.
   * Запросы склеиваются в окно (`CONVERSATIONS_REFRESH_DEBOUNCE_MS`), поэтому
   * пачка терминальных кадров одного рана стоит одного `conversations:list`.
   */
  function scheduleConversationsRefresh(): void {
    if (conversationsRefreshTimer) return // окно уже открыто — этот повод склеится с прошлым
    conversationsRefreshTimer = setTimeout(() => {
      conversationsRefreshTimer = null
      void refreshConversations({ keepActiveListed: true }).catch(() => {
        /* ошибка уже в conversationsError; список на экране остаётся прежним */
      })
    }, CONVERSATIONS_REFRESH_DEBOUNCE_MS)
  }

  /** Повторить загрузку списка бесед (кнопка «Повторить» в сайдбаре). */
  async function retryConversations(): Promise<void> {
    try {
      await refreshConversations()
    } catch {
      /* состояние уже помечено ошибкой — экран сайдбара её показывает */
    }
  }

  async function setSearchQuery(query: string): Promise<void> {
    setState({ searchQuery: query })
    if (state.searchScope === 'messages') {
      scheduleMessageSearch()
      return
    }
    await refreshConversations()
  }

  // --- Поиск по сообщениям (FTS5 на сервере) -------------------------------
  //
  // Запрос уходит с задержкой, а ответы обесцененных запросов отбрасываются по
  // номеру: сам HTTP-запрос предыдущей заявки отменяет мост (`httpApi`), но
  // отменённым может оказаться и уже улетевший ответ.
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let searchSeq = 0

  function cancelPendingMessageSearch(): void {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = null
    // Инкремент номера обесценивает ответы всех улетевших запросов.
    searchSeq += 1
  }

  /** Ставит поиск в очередь после паузы; пустой запрос просто чистит панель. */
  function scheduleMessageSearch(): void {
    cancelPendingMessageSearch()
    const query = state.searchQuery.trim()
    if (!query) {
      setState({ messageSearch: { ...EMPTY_MESSAGE_SEARCH } })
      return
    }
    // Скелетоны показываем сразу, не дожидаясь конца паузы: иначе панель
    // выглядит замершей на первом же символе.
    setState({ messageSearch: { ...state.messageSearch, status: 'loading', error: null } })
    searchTimer = setTimeout(() => {
      searchTimer = null
      void runMessageSearch(query)
    }, MESSAGE_SEARCH_DEBOUNCE_MS)
  }

  async function runMessageSearch(query: string): Promise<void> {
    if (!query) return
    searchSeq += 1
    const seq = searchSeq
    setState({ messageSearch: { ...state.messageSearch, query, status: 'loading', error: null } })
    try {
      const res = await api['messages:search']({
        query,
        // Поиск живёт в сайдбаре и подчиняется его фильтру проекта.
        projectId: state.sidebarProjectId,
        limit: MESSAGE_SEARCH_PAGE
      })
      if (seq !== searchSeq) return // ответ на устаревший запрос
      setState({
        messageSearch: { query, status: 'ready', hits: res.hits, nextCursor: res.nextCursor, loadingMore: false, error: null }
      })
    } catch (err) {
      if (seq !== searchSeq) return
      // Ошибку показывает сама панель с кнопкой «Повторить» — она рядом с
      // запросом, в отличие от тоста, и не мешает продолжать печатать.
      setState({
        messageSearch: {
          ...state.messageSearch,
          query,
          status: 'error',
          error: err instanceof Error ? err.message : String(err)
        }
      })
    }
  }

  async function setSearchScope(scope: SearchScope): Promise<void> {
    if (scope === state.searchScope) return
    setState({ searchScope: scope })
    if (scope === 'messages') {
      scheduleMessageSearch()
      return
    }
    cancelPendingMessageSearch()
    setState({ messageSearch: { ...EMPTY_MESSAGE_SEARCH } })
    await refreshConversations()
  }

  async function retryMessageSearch(): Promise<void> {
    cancelPendingMessageSearch()
    await runMessageSearch(state.searchQuery.trim())
  }

  async function loadMoreMessageSearch(): Promise<void> {
    const cursor = state.messageSearch.nextCursor
    if (!cursor || state.messageSearch.loadingMore || state.messageSearch.status !== 'ready') return
    const seq = searchSeq
    const query = state.messageSearch.query
    setState({ messageSearch: { ...state.messageSearch, loadingMore: true } })
    try {
      const res = await api['messages:search']({
        query,
        projectId: state.sidebarProjectId,
        limit: MESSAGE_SEARCH_PAGE,
        cursor
      })
      if (seq !== searchSeq) return // запрос успел смениться — страница уже не та
      setState({
        messageSearch: {
          ...state.messageSearch,
          hits: [...state.messageSearch.hits, ...res.hits],
          nextCursor: res.nextCursor,
          loadingMore: false
        }
      })
    } catch (err) {
      if (seq !== searchSeq) return
      setState({
        messageSearch: {
          ...state.messageSearch,
          loadingMore: false,
          status: 'error',
          error: err instanceof Error ? err.message : String(err)
        }
      })
    }
  }

  function focusMessage(messageId: string): void {
    setState({ highlightMessageId: messageId })
  }

  function clearMessageHighlight(): void {
    if (state.highlightMessageId) setState({ highlightMessageId: null })
  }

  async function setSidebarProject(projectId: string | null): Promise<void> {
    saveSidebarProject(projectId)
    setState({ sidebarProjectId: projectId })
    // Поиск по сообщениям тоже сужен проектом — перезапрашиваем.
    if (state.searchScope === 'messages') scheduleMessageSearch()
    await refreshConversations()
  }

  /**
   * «Показывать чаты завершённых задач»: список фильтрует сервер, поэтому
   * переключатель — это перезапрос списка (или поиска, если он активен).
   */
  async function setShowDoneTaskChats(show: boolean): Promise<void> {
    if (state.showDoneTaskChats === show) return
    saveShowDoneTaskChats(show)
    setState({ showDoneTaskChats: show })
    try {
      await refreshConversations()
    } catch {
      /* состояние уже помечено ошибкой — сайдбар покажет «Повторить» */
    }
  }

  /** Скачивание файла по умолчанию — через временный `<a download>`. */
  function defaultDownload(filename: string, mime: string, data: string): void {
    const blob = new Blob([data], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function completeOnboarding(): Promise<void> {
    await updateSettings({ onboarded: true })
  }

  function exportConversation(format: 'md' | 'json'): void {
    const conv = state.conversations.find((c) => c.id === state.activeId)
    if (!conv) return
    const download = deps.download ?? defaultDownload
    if (format === 'json') {
      download(exportFileName(conv.title, 'json'), 'application/json', conversationToJson(conv, state.messages))
    } else {
      download(exportFileName(conv.title, 'md'), 'text/markdown', conversationToMarkdown(conv, state.messages))
    }
  }

  /** Атомарно сохраняет локальный черновик вместе с первой репликой. */
  async function ensureConversation(
    titleSeed: string,
    firstMessage: Parameters<RendererApi['conversations:createDraft']>[0]['message']
  ): Promise<boolean> {
    if (state.activeId) return false
    pendingDraftKey ??= globalThis.crypto?.randomUUID?.() ?? `draft-${Date.now()}-${Math.random()}`
    const result = await api['conversations:createDraft']({
      idempotencyKey: pendingDraftKey,
      title: titleFromText(titleSeed),
      projectId: state.sidebarProjectId,
      message: firstMessage
    })
    pendingDraftKey = null
    setState({
      activeId: result.conversation.id,
      ...chatScopedReset(),
      messages: result.messages,
      conversations: withConversation(state.conversations, result.conversation)
    })
    await refreshConversations()
    return true
  }

  /** Персист сообщения в БД и добавление в ленту. */
  async function persistMessage(
    role: MessageRole,
    text: string,
    engine?: LlmProvider,
    meta?: TurnMeta,
    execTarget?: string | null,
    attachments?: MessageAttachment[]
  ): Promise<Message | undefined> {
    const conversationId = state.activeId
    if (!conversationId) return undefined
    const message = await api['messages:add']({
      conversationId,
      role,
      text,
      time: formatTime(now()),
      ...(engine ? { engine } : {}),
      ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
      ...(execTarget !== undefined ? { execTarget } : {}),
      ...(attachments?.length ? { attachments } : {})
    })
    setState({ messages: [...state.messages, message] })
    return message
  }

  /** Добавляет в ленту сообщение, уже сохранённое сервером (без записи в БД). */
  function appendPersisted(message: Message): void {
    if (state.messages.some((m) => m.id === message.id)) return
    setState({ messages: [...state.messages, message] })
  }

  /** Если у текущего разговора есть недоигранный ход — восстанавливаем его стрим. */
  function restoreStreamIfActive(): void {
    const id = state.activeId
    if (!id) return
    const partial = state.activeTurns[id]
    if (partial === undefined || state.voice !== 'idle') return
    setState({
      streamingReply: partial,
      voice: 'thinking',
      lastTurnMeta: null,
      // Счётчики действий и токенов продолжаются с накопленного, а не с нуля.
      liveActivity: state.activeActivity[id] ?? [],
      liveUsage: state.activeUsage[id] ?? null
    })
  }

  // --- TTS: сессия и очередь синтеза по предложениям (стриминг) --------------
  interface TtsSession {
    kind: 'pipeline' | 'replay'
    messageId: string | null
    queued: number
    played: number
    sourceComplete: boolean
  }
  let ttsSession: TtsSession | null = null
  let ttsBuffer = '' // накопление токенов для нарезки на предложения

  /** Активна ли автоозвучка ответа: есть TTS и включён тумблер настройки. */
  function autoSpeakActive(): boolean {
    return ttsEnabled && !!deps.speakText && state.settings.autoSpeak
  }

  function enqueueSpeak(text: string): void {
    if (!ttsEnabled || !deps.speakText || !ttsSession) return
    const t = text.trim()
    if (!t) return
    if (ttsReqAt === 0) {
      ttsReqAt = now() // засекаем генерацию речи (запрос → первое аудио)
      ttsAudioLogged = false
    }
    ttsSession.queued += 1
    deps.speakText(t, state.settings.voice)
  }

  /** Пришло синтезированное аудио (tts:audio) — логируем время до первого аудио. */
  function applyTtsAudioReceived(): void {
    if (ttsReqAt > 0 && !ttsAudioLogged) {
      logTiming('tts', 'Генерация речи', now() - ttsReqAt)
      ttsAudioLogged = true
    }
  }

  /** Начинает pipeline-озвучку: сессия + переход thinking → speaking. */
  function startPipelineSpeaking(): void {
    if (ttsSession) return
    ttsSession = { kind: 'pipeline', messageId: null, queued: 0, played: 0, sourceComplete: false }
    if (state.voice === 'thinking') dispatchVoice('reply_ready')
  }

  /** Завершает сессию, когда все чанки синтезированы и проиграны. */
  function finishTtsSessionIfDone(): void {
    const s = ttsSession
    if (!s || !s.sourceComplete || s.played < s.queued) return
    ttsSession = null
    ttsReqAt = 0 // сессия озвучки завершена — сбрасываем таймер генерации
    ttsAudioLogged = false
    if (s.kind === 'pipeline' && state.voice === 'speaking') dispatchVoice('speaking_done')
    if (s.kind === 'replay') setState({ speakingMessageId: null })
  }

  /** Сброс TTS: очередь синтеза/воспроизведения, сессия, буфер. */
  function resetTts(): void {
    ttsSession = null
    ttsBuffer = ''
    ttsReqAt = 0
    ttsAudioLogged = false
    deps.cancelTts?.()
    if (state.speakingMessageId) setState({ speakingMessageId: null })
  }

  /** Фиксация мок-ответа и переход thinking → speaking → idle (без стрима). */
  async function finishReply(
    fullText: string,
    engine?: LlmProvider,
    meta?: TurnMeta,
    persisted?: Message
  ): Promise<void> {
    const text = fullText.trim()
    setState({ streamingReply: '' })
    if (!text) {
      if (state.voice === 'thinking') dispatchVoice('reset') // пустой ответ → idle
      return
    }
    if (persisted) appendPersisted(persisted)
    else await persistMessage('ai', text, engine, meta)
    await refreshConversations()
    if (!dispatchVoice('reply_ready')) return // thinking → speaking
    if (autoSpeakActive()) {
      ttsSession = { kind: 'pipeline', messageId: null, queued: 0, played: 0, sourceComplete: false }
      enqueueSpeak(text)
      ttsSession.sourceComplete = true
      finishTtsSessionIfDone()
    } else {
      schedule(() => {
        dispatchVoice('speaking_done') // speaking → idle (мок-таймер)
      }, delays.speak)
    }
  }

  /** Мок-ответ (когда реальный Claude недоступен/выключен). */
  async function produceReplyMock(prompt: string): Promise<void> {
    await finishReply(mockReply(prompt))
  }

  /** Цель активного разговора; у нового несохранённого чата — сервер. */
  function activeConversationExecTarget(): string | null {
    return state.conversations.find((c) => c.id === state.activeId)?.execTarget ?? null
  }

  function activeConversationWorkdir(): string | null {
    return state.conversations.find((c) => c.id === state.activeId)?.workdir ?? null
  }

  function activeConversationProjectId(): string | undefined {
    return state.conversations.find((c) => c.id === state.activeId)?.projectId ?? undefined
  }

  /** Роутинг ответа: реальный Claude (стрим событиями) или мок-пайплайн. */
  function beginReply(segments: SttSegmentWire[], attachments: string[] = [], execTarget: string | null = activeConversationExecTarget()): void {
    if (claudeEnabled && deps.sendClaudePrompt && state.activeId) {
      setState({ streamingReply: '', lastTurnMeta: null, liveActivity: [], liveUsage: null })
      ttsBuffer = ''
      // verbose=true всегда: активность нужна для живого статуса и подробного вида
      // сообщения (глобальная консоль всё равно рендерится только при showConsole).
      if (execTarget === null) deps.sendClaudePrompt(state.activeId, segments, attachments, true)
      else deps.sendClaudePrompt(state.activeId, segments, attachments, true, execTarget)
      return
    }
    const prompt = segments.map((s) => s.text).join(' ')
    schedule(() => void produceReplyMock(prompt), delays.think)
  }

  /** Отмена текущего ответа: запрос к Claude и озвучка (barge-in/смена разговора). */
  function cancelReply(): void {
    deps.cancelClaude?.(state.activeId ?? undefined)
    resetTts()
    if (state.streamingReply) setState({ streamingReply: '' })
  }

  // --- Публичные действия -------------------------------------------------

  // Чат из адреса (#/chat/:id) на момент загрузки страницы: bootstrap откроет
  // его вместо самого свежего. Одноразовый — после первой загрузки данных
  // выбором рулит маршрут (см. App.tsx).
  let preferredChatId: string | null = null

  async function init(wantedChatId?: string | null): Promise<void> {
    preferredChatId = wantedChatId ?? null
    // Без моста сессии (desktop) — аутентификация не нужна: полный доступ (admin).
    if (!deps.session) {
      setState({ authRequired: false, currentUser: { name: '', role: 'admin' } })
      await bootstrap()
      return
    }
    // Web: восстанавливаем сессию по сохранённому токену; нет — экран логина.
    setState({ authRequired: true })
    const user = await deps.session.me().catch(() => null)
    if (user) {
      setState({ currentUser: user })
      await bootstrap()
    } else {
      setState({ currentUser: null })
    }
  }

  /** Тяжёлая загрузка данных пользователя (после успешной аутентификации). */
  async function bootstrap(): Promise<void> {
    setState({ loadingMessages: true, conversationsStatus: 'loading', conversationsError: null }) // обновление страницы: лоадер до готовности ленты
    let settings, conversations, projects, llmEngines, llmAccess
    try {
      ;[settings, conversations, projects, llmEngines, llmAccess] = await Promise.all([
        api['settings:get'](),
        api['conversations:list']({ includeCompleted: state.showDoneTaskChats }),
        api['projects:list'](),
        api['llm:engines'](),
        api['llm:access']()
      ])
    } catch (err) {
      // Иначе сайдбар остался бы со скелетоном навсегда: показываем ошибку с «Повторить».
      setState({
        loadingMessages: false,
        conversationsStatus: 'error',
        conversationsError: err instanceof Error ? err.message : String(err)
      })
      throw err
    }
    // Сайдбар сразу фильтруем по восстановленному из localStorage проекту.
    const pid = state.sidebarProjectId
    const visible = conversations.filter((c) => (c.projectId ?? null) === pid)
    setState({ settings, llmEngines, llmAccess, projects, projectsLoaded: true, conversations: visible, conversationsStatus: 'ready', conversationsError: null })
    void loadTaskChatBadges()
    await refreshMics()
    await refreshModelStatus()
    await refreshWhisperModels()
    await refreshTtsVoices()
    await refreshVoiceCatalog()
    await refreshCapabilities()
    await refreshMcpServers()
    await refreshLoginStatus()
    startLoginStatusPolling()
    await refreshAgents()
    // Адрес важнее «самого свежего»: чат по ссылке может быть и из другого
    // проекта — selectConversation сам переключит фильтр сайдбара.
    const wanted = preferredChatId
    preferredChatId = null
    const target = (wanted && conversations.some((c) => c.id === wanted) ? wanted : null) ?? visible[0]?.id ?? null
    // Ссылка на удалённый/чужой чат — открываем обычный список и говорим об этом.
    if (wanted && target !== wanted) setState({ error: 'Разговор не найден: возможно, он удалён.' })
    if (target) {
      await selectConversation(target)
    } else {
      setState({ loadingMessages: false })
    }
  }

  /** Вход по логину/паролю (web): успех → загрузка данных, иначе — ошибка формы. */
  async function login(name: string, password: string): Promise<void> {
    if (!deps.session) return
    setState({ authError: null })
    const user = await deps.session.login({ name, password }).catch(() => null)
    if (!user) {
      setState({ authError: 'Неверный логин или пароль' })
      return
    }
    setState({ currentUser: user, authError: null })
    await bootstrap()
  }

  /** Выход: гасим таймеры/аудио, чистим сессию и состояние, показываем логин. */
  async function logout(): Promise<void> {
    cancelTimers()
    stopCapture()
    resetTts()
    if (loginStatusPoll) {
      clearInterval(loginStatusPoll)
      loginStatusPoll = null
    }
    await deps.session?.logout().catch(() => {})
    setState({ ...initialState(), authRequired: true, ttsAvailable: ttsEnabled })
  }

  /** Запускает периодический опрос статуса входа (идемпотентно). */
  function startLoginStatusPolling(): void {
    if (loginStatusPoll || !api['auth:status']) return
    loginStatusPoll = setInterval(() => void refreshLoginStatus(), LOGIN_STATUS_POLL_MS)
  }

  /** Грузит список MCP-серверов (read-only; ошибки не критичны). */
  async function refreshMcpServers(): Promise<void> {
    if (!api['mcp:list']) return
    try {
      setState({ mcpServers: await api['mcp:list']() })
    } catch (err) {
      console.warn('[mcp] не удалось получить список серверов', err)
    }
  }

  /** Грузит статус входа claude/codex (read-only; ошибки не критичны). */
  async function refreshLoginStatus(): Promise<void> {
    if (!api['auth:status']) return
    try {
      setState({ loginStatus: await api['auth:status']() })
    } catch (err) {
      console.warn('[auth] не удалось получить статус входа', err)
    }
  }

  /** Грузит машины-агенты с онлайн-статусом (ошибки не критичны). */
  async function refreshAgents(): Promise<void> {
    if (!api['agents:list']) return
    setState({ agentsStatus: 'loading', agentsError: null })
    try {
      setState({ agents: await api['agents:list'](), agentsStatus: 'ready', agentsError: null })
    } catch (err) {
      // Раньше промах уходил только в console.warn, и меню «Машины» выглядело
      // как «машин нет». Теперь состояние видно на экране.
      console.warn('[agents] не удалось получить список машин', err)
      setState({ agentsStatus: 'error', agentsError: err instanceof Error ? err.message : String(err) })
    }
  }

  /** Создаёт машину-агента; вернёт null при ошибке (баннер уже показан). */
  async function createAgent(name: string): Promise<AgentCreated | null> {
    try {
      const created = await api['agents:create']({ name })
      await refreshAgents()
      return created
    } catch (err) {
      fail(err)
      return null
    }
  }

  /**
   * Удаляет машину-агента (токен отзывается, соединение рвётся). Цель выполнения
   * и машину по умолчанию сбрасывает и сервер (в БД), и стор — иначе до
   * перезагрузки страницы селекторы показывали бы удалённую машину.
   * Ошибка — тостом без «Повторить»: удаление не идемпотентно.
   */
  async function deleteAgent(id: string): Promise<void> {
    try {
      await api['agents:delete']({ id })
    } catch (err) {
      fail(err)
      return
    }
    setState({
      conversations: state.conversations.map((c) =>
        c.execTarget === id ? { ...c, execTarget: null } : c
      ),
      ...(state.settings.execTarget === id || state.settings.defaultAgentId === id
        ? {
            settings: {
              ...state.settings,
              ...(state.settings.execTarget === id ? { execTarget: null } : {}),
              ...(state.settings.defaultAgentId === id ? { defaultAgentId: null } : {})
            }
          }
        : {})
    })
    await refreshAgents()
  }

  /** Скачивает артефакт по прямой ссылке (десктоп/агент-приложение/скрипт). */
  async function downloadArtifact(kind: 'desktop' | 'agent-app' | 'agent-script'): Promise<void> {
    try {
      const url = await api['downloads:url']({ kind })
      if (deps.openUrl) deps.openUrl(url)
      else window.location.assign(url)
    } catch (err) {
      fail(err, () => void downloadArtifact(kind))
    }
  }
  const downloadDesktopApp = (): Promise<void> => downloadArtifact('desktop')
  const downloadAgentApp = (): Promise<void> => downloadArtifact('agent-app')
  const downloadAgentScript = (): Promise<void> => downloadArtifact('agent-script')

  /** Строка подключения для вставки в трей-приложение (null при ошибке). */
  async function getAgentConnectionString(token: string): Promise<string | null> {
    try {
      return await api['agents:connectionString']({ token })
    } catch (err) {
      fail(err)
      return null
    }
  }

  /** Открывает меню «Машины»; освежает список (пуш по WS дальше держит его актуальным). */
  function openMachines(): void {
    setState({ machinesOpen: true })
    void refreshAgents()
  }

  /** Закрывает меню «Машины». */
  function closeMachines(): void {
    setState({ machinesOpen: false })
  }

  /** Живой список машин из пуша по WebSocket. */
  function applyAgents(agents: AgentInfo[]): void {
    setState({ agents })
  }

  /** Сохранить политику машины (сервер сразу применит её онлайн-агенту). */
  async function setAgentPolicy(id: string, policy: AgentPolicy): Promise<void> {
    try {
      await api['agents:setPolicy']({ id, policy })
      setState({ agents: state.agents.map((a) => (a.id === id ? { ...a, policy } : a)) })
    } catch (err) {
      fail(err, () => void setAgentPolicy(id, policy))
    }
  }

  /**
   * Перевыпустить токен машины; вернуть НОВЫЙ ТОКЕН (старый сразу перестаёт
   * работать). Строку подключения по нему собирает `getAgentConnectionString` —
   * так вызывающий сам решает, что показать: команду, строку или токен.
   */
  async function regenerateAgentToken(id: string): Promise<string | null> {
    try {
      const { token } = await api['agents:regenerateToken']({ id })
      return token
    } catch (err) {
      fail(err)
      return null
    }
  }

  /** Обновить агента на машине; null — запуск удался, иначе текст ошибки. */
  async function updateAgent(id: string): Promise<string | null> {
    try {
      await api['agents:update']({ id })
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }

  /**
   * Грузит реальные голоса TTS; если выбранный отсутствует — переключает на
   * дефолтный голос (если он доступен), иначе на первый из списка.
   */
  async function refreshTtsVoices(): Promise<void> {
    const voices = await api['tts:voices']()
    setState({ ttsVoices: voices })
    if (voices.length > 0 && !voices.some((v) => v.id === state.settings.voice)) {
      const fallback = voices.find((v) => v.id === DEFAULT_SETTINGS.voice) ?? voices[0]
      await updateSettings({ voice: fallback.id })
    }
  }

  /** Грузит каталог скачиваемых голосов Piper. */
  async function refreshVoiceCatalog(): Promise<void> {
    const catalog = await api['tts:catalog']()
    setState({ voiceCatalog: catalog.voices, voicesDownloadable: catalog.downloadable })
  }

  /** Грузит возможности системы (ресурсы контейнера); ошибки/старый мост — не критичны. */
  async function refreshCapabilities(): Promise<void> {
    if (!api['system:capabilities']) return
    try {
      setState({ capabilities: await api['system:capabilities']() })
    } catch (err) {
      console.warn('[system] не удалось получить возможности системы', err)
    }
  }

  /** Грузит список моделей Whisper с размерами (для управления местом). */
  async function refreshWhisperModels(): Promise<void> {
    if (!api['stt:models']) return
    try {
      setState({ whisperModels: await api['stt:models']() })
    } catch (err) {
      console.warn('[stt] не удалось получить список моделей', err)
    }
  }

  /** Удалить установленный голос Piper и обновить списки. */
  async function deleteVoice(id: string): Promise<void> {
    await api['tts:deleteVoice']({ id })
    await refreshVoiceCatalog()
    await refreshTtsVoices()
  }

  /** Удалить файл модели Whisper и обновить список/статус. */
  async function deleteModel(model: WhisperModel): Promise<void> {
    await api['stt:deleteModel']({ model })
    await refreshWhisperModels()
    await refreshModelStatus()
  }

  const HANDS_FREE_GAP_MS = 400 // пауза перед авто-стартом записи после ответа (hands-free)
  const CONSOLE_LOG_CAP = 500 // ограничиваем рост лога консоли
  function applyClaudeLog(entry: ClaudeLogEntry, conversationId?: string): void {
    const next = [...state.consoleLog, entry]
    const patch: Partial<AppState> = {
      consoleLog: next.length > CONSOLE_LOG_CAP ? next.slice(-CONSOLE_LOG_CAP) : next
    }
    // Копим активность per-разговор (как activeTurns копит текст) — для
    // восстановления живого статуса после смены разговора или reconnect.
    if (conversationId !== undefined) {
      const acc = [...(state.activeActivity[conversationId] ?? []), entry]
      patch.activeActivity = {
        ...state.activeActivity,
        [conversationId]: acc.length > CONSOLE_LOG_CAP ? acc.slice(-CONSOLE_LOG_CAP) : acc
      }
    }
    // Активность текущего хода активного разговора — для живого статуса/секций.
    // (conversationId не задан у клиентских таймингов stt/tts — считаем их своими.)
    if (conversationId === undefined || conversationId === state.activeId) {
      const live = [...state.liveActivity, entry]
      patch.liveActivity = live.length > CONSOLE_LOG_CAP ? live.slice(-CONSOLE_LOG_CAP) : live
    }
    setState(patch)
  }

  // Клиентские тайминги STT/TTS для консоли (перцептивная задержка).
  let sttStartAt = 0 // момент остановки записи (реальный STT)
  let ttsReqAt = 0 // момент запроса синтеза первого чанка ответа
  let ttsAudioLogged = false // время до первого аудио уже залогировано

  /** Пишет запись тайминга в консоль (только при включённом режиме консоли). */
  function logTiming(kind: 'stt' | 'tts', label: string, ms: number): void {
    if (!state.settings.showConsole) return
    const summary = `${label}: ${(ms / 1000).toFixed(1)} с`
    applyClaudeLog({ kind, summary, raw: JSON.stringify({ kind, label, ms }) })
  }

  function toggleConsole(): void {
    setState({ consoleOpen: !state.consoleOpen })
  }

  // --- Проводник Claude Code (read-only + live-tail) -----------------------
  const CC_TRANSCRIPT_CAP = 4000

  async function openObserver(): Promise<void> {
    setState({ ccOpen: true })
    if (!api['cc:projects']) return
    try {
      setState({ ccProjects: await api['cc:projects']() })
    } catch (err) {
      console.warn('[cc] не удалось получить проекты', err)
    }
  }

  function closeObserver(): void {
    deps.ccTailStop?.()
    setState({
      ccOpen: false,
      ccProjectSlug: null,
      ccSessionId: null,
      ccSessions: [],
      ccTranscript: [],
      ccUsage: null
    })
  }

  /** Продолжить выбранную сессию Claude Code: импорт истории + привязка session-id. */
  async function resumeCcSession(slug: string, id: string): Promise<string | null> {
    if (!api['cc:resume']) return null
    try {
      const { conversation, messages } = await api['cc:resume']({ slug, id })
      deps.ccTailStop?.()
      setState({
        activeId: conversation.id,
        ...chatScopedReset(),
        messages,
        ccOpen: false,
        ccProjectSlug: null,
        ccSessionId: null,
        ccSessions: [],
        ccTranscript: [],
        ccUsage: null
      })
      await refreshConversations()
      return conversation.id
    } catch (err) {
      fail(err)
      return null
    }
  }

  async function selectCcProject(slug: string): Promise<void> {
    deps.ccTailStop?.()
    setState({ ccProjectSlug: slug, ccSessionId: null, ccSessions: [], ccTranscript: [], ccUsage: null })
    try {
      setState({ ccSessions: await api['cc:sessions']({ slug }) })
    } catch (err) {
      console.warn('[cc] не удалось получить сессии', err)
    }
  }

  async function selectCcSession(slug: string, id: string): Promise<void> {
    deps.ccTailStop?.()
    setState({ ccProjectSlug: slug, ccSessionId: id, ccTranscript: [], ccUsage: null })
    try {
      const { items, usage } = await api['cc:transcript']({ slug, id })
      setState({ ccTranscript: items, ccUsage: usage })
    } catch (err) {
      console.warn('[cc] не удалось получить транскрипт', err)
    }
    deps.ccTailStart?.(slug, id) // live-слежение за активной сессией
  }

  function applyCcTailItems(items: CcItem[]): void {
    if (items.length === 0) return
    const next = [...state.ccTranscript, ...items]
    setState({ ccTranscript: next.length > CC_TRANSCRIPT_CAP ? next.slice(-CC_TRANSCRIPT_CAP) : next })
  }

  // --- Проводник Codex (read-only + live-tail) -----------------------------
  async function openCodexObserver(): Promise<void> {
    setState({ cxOpen: true })
    if (!api['cx:projects']) return
    try {
      setState({ cxProjects: await api['cx:projects']() })
    } catch (err) {
      console.warn('[cx] не удалось получить проекты', err)
    }
  }

  function closeCodexObserver(): void {
    deps.cxTailStop?.()
    setState({
      cxOpen: false,
      cxProjectCwd: null,
      cxSessionId: null,
      cxSessions: [],
      cxTranscript: [],
      cxUsage: null
    })
  }

  async function selectCxProject(cwd: string): Promise<void> {
    deps.cxTailStop?.()
    setState({ cxProjectCwd: cwd, cxSessionId: null, cxSessions: [], cxTranscript: [], cxUsage: null })
    try {
      setState({ cxSessions: await api['cx:sessions']({ cwd }) })
    } catch (err) {
      console.warn('[cx] не удалось получить сессии', err)
    }
  }

  async function selectCxSession(id: string): Promise<void> {
    deps.cxTailStop?.()
    setState({ cxSessionId: id, cxTranscript: [], cxUsage: null })
    try {
      const { items, usage } = await api['cx:transcript']({ id })
      setState({ cxTranscript: items, cxUsage: usage })
    } catch (err) {
      console.warn('[cx] не удалось получить транскрипт', err)
    }
    deps.cxTailStart?.(id) // live-слежение за активной сессией
  }

  /** Продолжить сессию Codex: импорт истории + привязка session-id + переключение движка на Codex. */
  async function resumeCxSession(id: string): Promise<string | null> {
    if (!api['cx:resume']) return null
    try {
      const { conversation, messages } = await api['cx:resume']({ id })
      deps.cxTailStop?.()
      setState({
        activeId: conversation.id,
        ...chatScopedReset(),
        messages,
        cxOpen: false,
        cxProjectCwd: null,
        cxSessionId: null,
        cxSessions: [],
        cxTranscript: [],
        cxUsage: null
      })
      // Следующий ход должен продолжить именно через Codex.
      if (state.settings.llmProvider !== 'codex') await updateSettings({ llmProvider: 'codex' })
      await refreshConversations()
      return conversation.id
    } catch (err) {
      fail(err)
      return null
    }
  }

  function applyCxTailItems(items: CxItem[]): void {
    if (items.length === 0) return
    const next = [...state.cxTranscript, ...items]
    setState({ cxTranscript: next.length > CC_TRANSCRIPT_CAP ? next.slice(-CC_TRANSCRIPT_CAP) : next })
  }

  // --- Админ-страница пользователей ---------------------------------------

  async function refreshAdminUsers(): Promise<void> {
    if (!api['admin:users']) return
    setState({ adminUsersStatus: 'loading', adminUsersError: null })
    try {
      const [adminUsers, adminUsageSummary] = await Promise.all([api['admin:users'](), api['admin:usageSummary']()])
      setState({ adminUsers, adminUsageSummary, adminUsersStatus: 'ready', adminUsersError: null })
    } catch (err) {
      setState({
        adminUsersStatus: 'error',
        adminUsersError: err instanceof Error ? err.message : String(err)
      })
      throw err
    }
  }

  async function refreshAdminLlmEngines(): Promise<void> {
    if (!api['admin:llmEngines']) return
    setState({ adminLlmEnginesStatus: 'loading', adminLlmEnginesError: null })
    try {
      setState({
        adminLlmEngines: await api['admin:llmEngines'](),
        adminLlmEnginesStatus: 'ready',
        adminLlmEnginesError: null
      })
    } catch (err) {
      setState({
        adminLlmEnginesStatus: 'error',
        adminLlmEnginesError: err instanceof Error ? err.message : String(err)
      })
      throw err
    }
  }

  async function refreshAdminModelPrices(): Promise<void> {
    if (!api['admin:modelPrices']) return
    try { setState({ adminModelPrices: await api['admin:modelPrices']() }) } catch (err) { fail(err, () => void refreshAdminModelPrices()) }
  }

  async function saveAdminModelPrice(input: ModelPriceInput): Promise<void> {
    try { await api['admin:saveModelPrice'](input); await refreshAdminModelPrices() } catch (err) { fail(err) }
  }

  async function deleteAdminModelPrice(provider: string, model: string): Promise<void> {
    try { await api['admin:deleteModelPrice']({ provider, model }); await refreshAdminModelPrices() } catch (err) { fail(err) }
  }

  async function openUsers(): Promise<void> {
    setState({ usersOpen: true })
    try {
      // Персональная страница — только для заведомо не-админа. Пока пользователь
      // неизвестен (currentUser === null), остаётся прежнее админское поведение:
      // иначе открытие страницы не грузило бы вообще ничего.
      if (state.currentUser && state.currentUser.role !== 'admin') {
        setState({
          adminUsers: [{ name: state.currentUser.name, role: 'user', blocked: false, createdAt: 0, conversationCount: state.conversations.length, agents: [] }],
          adminUsageSummary: []
        })
        await selectAdminUser(state.currentUser.name)
      } else {
        await Promise.all([refreshAdminUsers(), refreshAdminLlmEngines(), refreshAdminModelPrices()])
      }
    } catch (err) {
      fail(err, () => void openUsers())
    }
  }

  function closeUsers(): void {
    setState({
      usersOpen: false,
      adminSelected: null,
      adminUsage: null,
      adminConversations: [],
      adminMessages: [],
      adminConversationId: null,
      adminLlmEngineHealth: {}
    })
  }

  async function createUserAccount(name: string, password: string, role: 'admin' | 'user'): Promise<void> {
    try {
      await api['admin:createUser']({ name, password, role })
      await refreshAdminUsers()
    } catch (err) {
      fail(err)
    }
  }

  async function setUserBlocked(name: string, blocked: boolean): Promise<void> {
    try {
      await api['admin:setBlocked']({ name, blocked })
      await refreshAdminUsers()
    } catch (err) {
      fail(err, () => void setUserBlocked(name, blocked))
    }
  }

  async function deleteUserAccount(name: string): Promise<void> {
    try {
      await api['admin:deleteUser']({ name })
      if (state.adminSelected === name) closeUsers()
      await refreshAdminUsers()
    } catch (err) {
      fail(err)
    }
  }

  async function selectAdminUser(name: string): Promise<void> {
    setState({
      adminSelected: name,
      adminUsage: null,
      adminConversations: [],
      adminMessages: [],
      adminConversationId: null,
      adminUserLlmAccess: []
    })
    try {
      const mine = state.currentUser?.role !== 'admin'
      if (mine && name !== state.currentUser?.name) return
      const [usage, conversations, access] = await Promise.all(mine
        ? [api['usage:report']({ unit: 'day' }), api['conversations:list']({ includeCompleted: true }), api['llm:access']()]
        : [api['admin:usage']({ name, unit: 'day' }), api['admin:conversations']({ name }), api['admin:llmAccess']({ name })]
      )
      setState({ adminUsage: usage, adminConversations: conversations, adminUserLlmAccess: access })
    } catch (err) {
      fail(err, () => void selectAdminUser(name))
    }
  }

  async function loadAdminUserLlmAccess(name = state.adminSelected ?? ''): Promise<void> {
    if (!name) return
    try {
      setState({ adminUserLlmAccess: await api['admin:llmAccess']({ name }) })
    } catch (err) { fail(err, () => void loadAdminUserLlmAccess(name)) }
  }

  async function saveAdminUserLlmAccess(access: UserLlmAccess[]): Promise<void> {
    const name = state.adminSelected
    if (!name) return
    try {
      setState({ adminUserLlmAccess: await api['admin:saveLlmAccess']({ name, access }) })
      notify({ kind: 'success', text: 'Доступ к моделям сохранён' })
    } catch (err) { fail(err, () => void saveAdminUserLlmAccess(access)) }
  }

  async function loadAdminUsage(unit: UsageUnit, from?: number, to?: number, conversationId?: string): Promise<void> {
    const name = state.adminSelected
    if (!name) return
    try {
      setState({ adminUsage: await api['admin:usage']({ name, unit, from, to, conversationId }) })
    } catch (err) {
      fail(err, () => void loadAdminUsage(unit, from, to, conversationId))
    }
  }

  async function openAdminConversation(conversationId: string): Promise<void> {
    const name = state.adminSelected
    if (!name) return
    setState({ adminConversationId: conversationId, adminMessages: [] })
    try {
      setState({ adminMessages: await api['admin:messages']({ name, conversationId }) })
    } catch (err) {
      fail(err, () => void openAdminConversation(conversationId))
    }
  }

  async function createAdminLlmEngine(input: AdminLlmEngineInput): Promise<void> {
    try {
      await api['admin:createLlmEngine'](input)
      await refreshAdminLlmEngines()
    } catch (err) {
      fail(err)
    }
  }

  async function updateAdminLlmEngine(id: string, patch: AdminLlmEngineInput): Promise<void> {
    try {
      await api['admin:updateLlmEngine']({ id, patch })
      await refreshAdminLlmEngines()
    } catch (err) {
      fail(err)
    }
  }

  async function deleteAdminLlmEngine(id: string): Promise<void> {
    try {
      await api['admin:deleteLlmEngine']({ id })
      const nextHealth = { ...state.adminLlmEngineHealth }
      delete nextHealth[id]
      setState({ adminLlmEngineHealth: nextHealth })
      await refreshAdminLlmEngines()
    } catch (err) {
      fail(err)
    }
  }

  async function checkAdminLlmEngineHealth(id: string): Promise<void> {
    try {
      const health = await api['admin:checkLlmEngineHealth']({ id })
      setState({ adminLlmEngineHealth: { ...state.adminLlmEngineHealth, [id]: health } })
    } catch (err) {
      fail(err, () => void checkAdminLlmEngineHealth(id))
    }
  }

  // --- Машинные утилиты (консоль/проводник) -------------------------------

  /** Машина утилиты: сначала цель активного чата, затем первая онлайн. */
  function defaultUtilityAgent(): string | null {
    const target = state.agents.find((a) => a.id === activeConversationExecTarget() && a.online)
    if (target) return target.id
    return state.agents.find((a) => a.online)?.id ?? state.agents[0]?.id ?? null
  }

  function openUtility(
    kind: 'console' | 'explorer',
    agentId?: string | null,
    path?: string,
    dir?: boolean
  ): void {
    setState({
      utility: {
        kind,
        agentId: agentId ?? defaultUtilityAgent(),
        ...(path ? { path } : {}),
        ...(path && dir ? { dir: true } : {})
      }
    })
  }

  // Открыть проводник/консоль на ЭФФЕКТИВНОЙ машине и папке активного чата
  // (для чата с проектом эти значения уже проектные; иначе — из настроек чата).
  function openUtilityForActiveChat(kind: 'console' | 'explorer'): void {
    const path = activeConversationWorkdir()
    // Утилита должна оставаться на эффективной машине чата даже во время
    // переподключения: иначе проводник/терминал незаметно открывались бы на
    // другой онлайн-машине вместо явного сообщения о недоступности нужной.
    const target = activeConversationExecTarget()
    const agentId = target && target !== 'none' ? target : defaultUtilityAgent()
    setState({
      utility: {
        kind,
        agentId,
        ...(path ? { path } : {}),
        ...(path && kind === 'explorer' ? { dir: true } : {}),
        ...(activeConversationProjectId() ? { projectId: activeConversationProjectId() } : {})
      }
    })
  }
  function closeUtility(): void {
    setState({ utility: null })
  }

  const noFs = (): never => {
    throw new Error('Файловые операции недоступны')
  }
  const fsList = (agentId: string, path: string): Promise<FsResult> => {
    if (!deps.fs) return noFs()
    const projectId = activeConversationProjectId()
    return projectId ? deps.fs.list(agentId, path, projectId) : deps.fs.list(agentId, path)
  }
  const fsRead = (agentId: string, path: string): Promise<FsResult> => {
    if (!deps.fs) return noFs()
    const projectId = activeConversationProjectId()
    return projectId ? deps.fs.read(agentId, path, projectId) : deps.fs.read(agentId, path)
  }
  /** Файл с диска сервера; null — сервер такого у себя не знает. */
  const readServerFile = (path: string): Promise<ServerFileInfo | null> =>
    deps.files ? deps.files.read(path) : Promise.resolve(null)
  const fsWrite = (agentId: string, path: string, dataBase64: string): Promise<FsResult> =>
    deps.fs ? deps.fs.write(agentId, path, dataBase64, activeConversationProjectId()) : noFs()
  const fsRemove = (agentId: string, path: string): Promise<FsResult> =>
    deps.fs ? deps.fs.remove(agentId, path, activeConversationProjectId()) : noFs()
  const fsRename = (agentId: string, from: string, to: string): Promise<FsResult> =>
    deps.fs ? deps.fs.rename(agentId, from, to, activeConversationProjectId()) : noFs()
  const fsMkdir = (agentId: string, path: string): Promise<FsResult> =>
    deps.fs ? deps.fs.mkdir(agentId, path, activeConversationProjectId()) : noFs()
  const agentExec = (
    agentId: string,
    command: string,
    signal?: AbortSignal
  ): Promise<AgentExecResult> => {
    if (!deps.fs) return noFs()
    const projectId = activeConversationProjectId()
    return projectId ? deps.fs.exec(agentId, command, signal, projectId) : deps.fs.exec(agentId, command, signal)
  }

  /**
   * История команд консоли по машине. Подряд повторённую команду не дублируем —
   * под ↑ она и так первая, а список от этого только длиннее.
   */
  function pushConsoleCommand(agentId: string, command: string): void {
    const cmd = command.trim()
    if (!agentId || !cmd) return
    const prev = state.consoleHistory[agentId] ?? []
    if (prev[prev.length - 1] === cmd) return
    setState({
      consoleHistory: { ...state.consoleHistory, [agentId]: [...prev, cmd].slice(-CONSOLE_HISTORY_MAX) }
    })
  }

  async function uploadFsFile(agentId: string, dir: string, file: File): Promise<FsResult> {
    if (!deps.fs) return noFs()
    const dataBase64 = await fileToBase64(file)
    const path = `${dir.replace(/\/$/, '')}/${file.name}`
    return deps.fs.write(agentId, path, dataBase64, activeConversationProjectId())
  }

  async function downloadFsFile(agentId: string, path: string, name: string): Promise<void> {
    if (!deps.fs) return
    const res = await deps.fs.read(agentId, path, activeConversationProjectId())
    const bytes = Uint8Array.from(atob(res.dataBase64 ?? ''), (c) => c.charCodeAt(0))
    const blob = new Blob([bytes], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  /**
   * Если текст — команда «открой консоль/проводник», сохраняет ai-сообщение с
   * tool-блоком (виджет прямо в ответе) и возвращает true (в LLM не идём).
   */
  async function maybeOpenUtility(text: string): Promise<boolean> {
    const tool = detectOpenUtility(text, state.agents)
    if (!tool) return false
    if (activeConversationExecTarget() === 'none') {
      await persistMessage('ai', 'Команды отключены: для этого сообщения выбрано «Без машины».')
      await refreshConversations()
      return true
    }
    const agent = tool.agentId ? state.agents.find((a) => a.id === tool.agentId) : undefined
    const label = tool.kind === 'console' ? 'Консоль' : 'Проводник'
    const where = agent ? ` — машина «${agent.name}»` : ''
    const spec: ToolSpec = { kind: tool.kind, ...(tool.agentId ? { agentId: tool.agentId } : {}) }
    await persistMessage('ai', `🖥 ${label}${where}\n\n${toolBlock(spec)}`)
    await refreshConversations()
    return true
  }

  function downloadVoice(id: string): void {
    if (!deps.startVoiceDownload || id in state.voiceDownloads) return
    setState({ voiceDownloads: { ...state.voiceDownloads, [id]: 0 }, error: null })
    deps.startVoiceDownload(id)
  }

  function applyVoiceProgress(id: string, percent: number): void {
    setState({ voiceDownloads: { ...state.voiceDownloads, [id]: percent } })
  }

  async function applyVoiceDone(id: string): Promise<void> {
    const next = { ...state.voiceDownloads }
    delete next[id]
    setState({ voiceDownloads: next })
    await refreshVoiceCatalog()
    await refreshTtsVoices()
  }

  function applyVoiceError(id: string, message: string): void {
    const next = { ...state.voiceDownloads }
    delete next[id]
    setState({ voiceDownloads: next, error: message })
  }

  async function refreshModelStatus(): Promise<void> {
    if (!deps.getSttStatus) return
    try {
      const status = await deps.getSttStatus()
      setState({ modelPresent: status.present })
    } catch (err) {
      console.warn('[stt] не удалось получить статус модели', err)
    }
  }

  async function refreshMics(): Promise<void> {
    if (!deps.listMics) return
    try {
      setState({ mics: await deps.listMics() })
    } catch (err) {
      console.warn('[audio] не удалось получить список микрофонов', err)
    }
  }

  /** Запуск реального захвата (fire-and-forget); ошибки не рвут UX-цикл. */
  function startCapture(): void {
    if (!audio) return
    handsVad.reset() // новая сессия слушания — сбрасываем детектор паузы
    void audio
      .start({
        deviceId: state.settings.micDeviceId,
        onEnergy: (r) => applyMicEnergy(r) // hands-free авто-пауза по тишине
      })
      .then(() => refreshMics()) // после разрешения появляются реальные метки
      .catch((err) => console.warn('[audio] запуск захвата не удался', err))
  }

  function stopCapture(): void {
    if (!audio) return
    void audio.stop().catch((err) => console.warn('[audio] остановка захвата не удалась', err))
  }

  async function newConversation(assistantKind?: 'web-recorder'): Promise<string | null> {
    cancelTimers()
    stopCapture()
    resetTts() // ход текущего разговора не отменяем — он доиграет на сервере
    dispatchVoice('reset')
    pendingDraftKey = null
    if (!assistantKind) {
      setState({
        activeId: null,
        ...chatSwitchReset(),
        draft: '',
        promptHelper: { open: false, loading: false, variants: [], error: null },
        attachments: []
      })
      return null
    }
    // Web Reader — специальный сохраняемый lifecycle, он не является ручным черновиком.
    const conversation = await api['conversations:create']({ title: 'Новый разговор', assistantKind })
    setState({
      activeId: conversation.id,
      ...chatSwitchReset(),
      draft: '',
      promptHelper: { open: false, loading: false, variants: [], error: null },
      attachments: []
    })
    await refreshConversations()
    return conversation.id
  }

  async function selectConversation(id: string): Promise<boolean> {
    cancelTimers()
    stopCapture()
    resetTts() // ход прежнего разговора не отменяем — он доиграет на сервере
    setState({ ...chatSwitchReset(), loadingMessages: true })
    let opened: Conversation | null = null
    let known = true
    try {
      const res = await api['conversations:get']({ id })
      if (res) {
        opened = res.conversation
        known = state.conversations.some((c) => c.id === res.conversation.id)
        setState({ activeId: res.conversation.id, messages: res.messages })
        restoreStreamIfActive() // у разговора есть недоигранный ход → показываем стрим
      }
    } finally {
      setState({ loadingMessages: false })
    }
    if (!opened) {
      setState({ error: 'Разговор не найден: возможно, он удалён.' })
      return false
    }
    // Чата нет в списке сайдбара (пришли по ссылке на чат другого проекта) —
    // переключаем фильтр, иначе активный чат не виден.
    if (!known) await setSidebarProject(opened.projectId ?? null)
    // Чат завершённой задачи из списка скрыт совсем: открыли его по ссылке или
    // из карточки — закрепляем строку, пока он активен (см. `keepPinned`).
    const listed = state.conversations.some((c) => c.id === opened.id)
    setState({
      pinnedConversation: listed ? null : opened,
      conversations: listed ? state.conversations : withConversation(state.conversations, opened)
    })
    // Шапка чата задачи: иерархия, этап, машина/папка, ран. Грузим отдельно,
    // чтобы не задерживать показ сообщений.
    void loadTaskChatContext(id)
    return true
  }

  /**
   * Метки чатов задач для списка бесед. Ран из ответа кладём в `ciSummaries`
   * только когда он другой (или про задачу ещё ничего не знаем): состояние
   * известного рана ведут живые кадры `ci.*`, и медленный ответ на этот запрос
   * не должен откатывать их назад.
   */
  async function loadTaskChatBadges(): Promise<void> {
    try {
      const badges = await api['conversations:taskChats']()
      const byConversation: Record<string, TaskChatBadge> = {}
      const ciSummaries = { ...state.ciSummaries }
      for (const badge of badges) {
        byConversation[badge.conversationId] = badge
        const known = ciSummaries[badge.taskId]
        if (badge.run && (!known || known.id !== badge.run.id)) ciSummaries[badge.taskId] = badge.run
      }
      setState({ taskChatBadges: byConversation, ciSummaries })
    } catch {
      /* подсветка — украшение: список чатов работает и без неё */
    }
  }

  /**
   * Контекст задачи активного чата (null — чат не привязан к задаче). Ответ на
   * уже закрытый чат отбрасываем; вторая страховка — `conversationId` внутри
   * самого контекста, по нему сверяется и рендер виджета.
   */
  async function loadTaskChatContext(id: string): Promise<void> {
    setState({ taskChatContext: null })
    try {
      const ctx = await api['conversations:taskContext']({ id })
      if (state.activeId === id) setState({ taskChatContext: ctx })
    } catch {
      /* шапка необязательна — молча без неё */
    }
  }

  async function renameConversation(id: string, title: string): Promise<void> {
    const name = title.trim()
    if (!name) return
    await api['conversations:rename']({ id, title: name })
    await refreshConversations()
  }

  async function setConversationExecTarget(
    id: string,
    execTarget: string | null,
    workdir?: string | null,
    skillNames?: string[],
    llmProvider?: LlmProvider | null,
    llmModel?: string | null,
    permissionMode?: PermissionMode | null,
    kbContextMode?: KbContextMode,
    llmEngineId?: string | null
  ): Promise<void> {
    const conversation = await api['conversations:setExecTarget']({ id, execTarget, workdir, skillNames, llmEngineId, llmProvider, llmModel, permissionMode, kbContextMode })
    setState({
      conversations: state.conversations.map((c) => (c.id === id ? conversation : c))
    })
  }

  async function deleteConversation(id: string): Promise<void> {
    try {
      await api['conversations:delete']({ id })
      // Иначе закреплённая строка удалённого чата вернулась бы в список.
      if (state.pinnedConversation?.id === id) setState({ pinnedConversation: null })
      const wasActive = state.activeId === id
      await refreshConversations()
      if (wasActive) {
        const next = state.conversations[0]
        if (next) await selectConversation(next.id)
        else await newConversation()
      }
    } catch (err) {
      fail(err)
    }
  }

  function openSettings(): void {
    setState({ settingsOpen: true })
    // Онлайн-статус машин мог измениться — обновляем бейджи в фоне.
    void refreshAgents()
  }

  function closeSettings(): void {
    setState({ settingsOpen: false })
  }

  async function updateSettings(patch: Partial<Settings>): Promise<void> {
    const settings = { ...state.settings, ...patch }
    setState({ settings })
    await api['settings:save'](settings)
  }

  function setDraft(value: string): void {
    setState({ draft: value })
  }

  // Помощник промптов: параллельные запросы не нужны — панель открывается по одному
  // черновику за раз; повторный клик по палочке во время загрузки игнорируем.
  async function suggestPrompts(): Promise<void> {
    const text = state.draft.trim()
    if (!text || state.promptHelper.loading) return
    setState({ promptHelper: { open: true, loading: true, variants: [], error: null } })
    try {
      const { variants } = await api['prompt:suggest']({ prompt: text, modifiers: state.settings.aiAssistPrompts.filter((item) => item.enabled) })
      // Черновик мог поменяться, пока ждали ответ, но панель по-прежнему про этот
      // запрос — показываем варианты (пользователь сам решит, применять ли).
      if (!state.promptHelper.open) return
      setState({ promptHelper: { open: true, loading: false, variants: variants.map((item) => item.text), error: variants.length ? null : 'Не удалось предложить варианты' } })
    } catch (err) {
      if (!state.promptHelper.open) return
      const message = err instanceof Error ? err.message : 'Не удалось получить подсказки'
      setState({ promptHelper: { open: true, loading: false, variants: [], error: message } })
    }
  }

  function applyPromptSuggestion(text: string): void {
    setState({ draft: text, promptHelper: { open: false, loading: false, variants: [], error: null } })
  }

  function closePromptSuggestions(): void {
    setState({ promptHelper: { open: false, loading: false, variants: [], error: null } })
  }

  async function submitText(previewElement?: PreviewElementPayload): Promise<boolean> {
    const text = state.draft.trim()
    const atts = state.attachments
    if (!text && atts.length === 0 && !previewElement) return false
    const queueOnly = state.voice === 'thinking' || state.voice === 'speaking' || state.voice === 'transcribing'
    setState({ error: null })
    const messageAttachments = atts.map((file) => ({ uploadId: file.id, path: file.path, name: file.name, mimeType: file.mimeType, size: file.size, ...(file.agentId ? { agentId: file.agentId } : {}) }))
    const messageText = composeUserText(text, atts)
    const messageMeta = previewElement ? { previewElement } : undefined
    const created = await ensureConversation(text || atts.map((a) => a.name).join(', '), {
      role: 'u1',
      text: messageText,
      time: formatTime(now()),
      ...(messageMeta ? { meta: messageMeta } : {}),
      ...(messageAttachments.length ? { attachments: messageAttachments } : {})
    })
    const execTarget = activeConversationExecTarget()
    if (!created) {
      await persistMessage('u1', messageText, undefined, messageMeta, execTarget, messageAttachments)
    }
    setState({ draft: '', attachments: [] })
    await refreshConversations()
    // Команда «открой консоль/проводник» → виджет прямо в ответе, без обращения к LLM.
    if (!queueOnly && atts.length === 0 && !previewElement && (await maybeOpenUtility(text))) return true
    if (!queueOnly && !dispatchVoice('submit_text')) return false // idle → thinking
    const segments = [{ speakerId: 1, text: withPreviewElementContext(text || 'См. приложенные файлы.', previewElement) }]
    if (queueOnly && claudeEnabled && deps.sendClaudePrompt && state.activeId) {
      deps.sendClaudePrompt(state.activeId, segments, atts.map((a) => a.id), true, execTarget)
    } else {
      beginReply(segments, atts.map((a) => a.id), execTarget)
    }
    return true
  }

  /** Ответы формы вопросов: обычная реплика пользователя + новый ход модели. */
  async function answerQuestions(text: string): Promise<void> {
    const t = text.trim()
    if (!t || state.voice !== 'idle' || !state.activeId) return
    setState({ error: null })
    const execTarget = activeConversationExecTarget()
    await persistMessage('u1', t, undefined, undefined, execTarget)
    await refreshConversations()
    if (!dispatchVoice('submit_text')) return // idle → thinking
    beginReply([{ speakerId: 1, text: t }], [], execTarget)
  }

  async function executePlan(answerId: string): Promise<void> {
    if (!state.activeId || state.voice !== 'idle') return
    const answerIndex = state.messages.findIndex((message) => message.id === answerId && message.role === 'ai')
    if (answerIndex < 0 || state.messages[answerIndex].meta?.request?.permissionMode !== 'plan') return
    const source = state.messages.slice(0, answerIndex).reverse().find((message) => message.role !== 'ai')
    const conversation = state.conversations.find((item) => item.id === state.activeId)
    if (!source || !conversation) return

    // Режим разработки здесь намеренно = acceptEdits: он разрешает применить план,
    // не выдавая полный bypass. Сервер всё равно форсит plan для user без машины.
    await setConversationExecTarget(
      conversation.id,
      conversation.execTarget,
      conversation.workdir,
      conversation.skillNames,
      conversation.llmProvider,
      conversation.llmModel,
      'acceptEdits'
    )
    const execTarget = activeConversationExecTarget()
    await persistMessage('u1', source.text, undefined, undefined, execTarget)
    await refreshConversations()
    if (!dispatchVoice('submit_text')) return
    beginReply([{ speakerId: 1, text: source.text }], [], execTarget)
  }

  function cancelRequest(): void {
    // Пользователь случайно отправил — отменяем запрос и возвращаемся в idle.
    if (state.voice !== 'thinking' && state.voice !== 'speaking') return
    cancelTimers()
    cancelReply() // отмена запроса к Claude + сброс озвучки + очистка стрима
    dispatchVoice('reset') // thinking/speaking → idle
  }

  async function deleteMessage(id: string): Promise<void> {
    if (!state.activeId) return
    await api['messages:delete']({ conversationId: state.activeId, messageId: id })
    setState({ messages: state.messages.filter((m) => m.id !== id) })
    await refreshConversations()
  }

  async function updateTaskLaunchStatus(messageId: string, proposalId: string, status: 'created' | 'declined'): Promise<void> {
    if (!state.activeId) return
    const message = state.messages.find((item) => item.id === messageId)
    if (!message?.meta) return
    const proposals = message.meta.taskLaunches?.length
      ? message.meta.taskLaunches
      : message.meta.taskLaunch
        ? [{ id: 'legacy', ...message.meta.taskLaunch }]
        : []
    const meta = {
      ...message.meta,
      taskLaunches: proposals.map((proposal) => proposal.id === proposalId ? { ...proposal, status } : proposal)
    }
    const updated = await api['messages:updateMeta']({ conversationId: state.activeId, messageId, meta })
    setState({ messages: state.messages.map((item) => item.id === messageId ? updated : item) })
    try {
      localStorage.setItem('vc:message-meta-update', JSON.stringify({ conversationId: state.activeId, message: updated, at: Date.now() }))
    } catch { /* storage недоступен — серверная персистентность остаётся */ }
  }

  async function editMessage(id: string, newText: string): Promise<void> {
    const text = newText.trim()
    if (!state.activeId || !text || state.voice !== 'idle') return
    const idx = state.messages.findIndex((m) => m.id === id)
    if (idx < 0) return
    const role = state.messages[idx].role
    const messageExecTarget = state.messages[idx].execTarget ?? null
    // Удаляем правимое сообщение и все последующие (в БД и в ленте) — перегенерация.
    const removed = state.messages.slice(idx)
    for (const m of removed) {
      await api['messages:delete']({ conversationId: state.activeId, messageId: m.id })
    }
    setState({ messages: state.messages.slice(0, idx), error: null })
    const execTarget = messageExecTarget
    await persistMessage(role, text, undefined, undefined, execTarget)
    await refreshConversations()
    if (!dispatchVoice('submit_text')) return // idle → thinking
    beginReply([{ speakerId: 1, text }], [], execTarget)
  }

  async function addAttachment(file: File): Promise<void> {
    try {
      const dataBase64 = await fileToBase64(file)
      const conversation = state.conversations.find((item) => item.id === state.activeId)
      const selectedTarget = conversation?.execTarget ?? state.settings.execTarget
      const agentId = selectedTarget && selectedTarget !== 'none' ? selectedTarget : undefined
      const info = await api['uploads:add']({ name: file.name, dataBase64, ...(file.type ? { mimeType: file.type } : {}), ...(agentId ? { agentId } : {}) })
      setState({ attachments: [...state.attachments, info] })
    } catch (err) {
      setState({
        error: `Не удалось загрузить файл: ${err instanceof Error ? err.message : String(err)}`
      })
    }
  }

  function removeAttachment(id: string): void {
    setState({ attachments: state.attachments.filter((a) => a.id !== id) })
  }

  function startVoice(): void {
    if (deps.voiceInputEnabled === false) return
    // mic_press: idle → listening, либо barge-in speaking → listening.
    if (!dispatchVoice('mic_press')) return
    cancelTimers() // на barge-in гасим таймеры озвучки
    deps.cancelTts?.() // и прерываем реальную озвучку
    setState({ liveSegments: [], error: null })
    startCapture() // реальный захват аудио → чанки в main
    if (!sttEnabled) startTranscriptGrowth() // мок-транскрипт только без реального STT
  }

  /** Постепенно наращивает live-транскрипт по кадрам, пока идёт запись. */
  function startTranscriptGrowth(): void {
    const frames = transcriptFrames(state.settings.diarization)
    let i = 0
    const step = (): void => {
      if (state.voice !== 'listening' || i >= frames.length) return
      setState({ liveSegments: frames[i] })
      i += 1
      if (i < frames.length) schedule(step, delays.frame)
    }
    step()
  }

  function stopVoice(): void {
    // stop_listening: listening → transcribing.
    if (!dispatchVoice('stop_listening')) return
    cancelTimers()
    stopCapture()
    // При реальном STT финал придёт событием stt:final → applySttFinal.
    if (sttEnabled) {
      sttStartAt = now() // засекаем распознавание (стоп → финал)
      return
    }
    // Мок-путь: имитируем финализацию из накопленного мок-транскрипта.
    const finalSegments =
      state.liveSegments.length > 0 ? state.liveSegments : [{ speakerId: 1, text: '(тишина)' }]
    schedule(() => {
      if (!dispatchVoice('transcribed')) return // transcribing → thinking
      void finalizeAndReply(finalSegments)
    }, delays.transcribe)
  }

  /** Частичная гипотеза распознавания → обновление live-блока (только при записи). */
  function applySttPartial(update: SttUpdate): void {
    if (state.voice !== 'listening') return
    const segments = update.segments.map((s) => ({ speakerId: s.speakerId, text: s.text }))
    if (segments.length > 0) setState({ liveSegments: segments })
  }

  /** Финальный транскрипт: фиксируем реплики и запускаем ответ. */
  async function applySttFinal(update: SttUpdate): Promise<void> {
    if (state.voice !== 'transcribing' && state.voice !== 'listening') return
    // Если стоп ещё не был нажат (быстрый финал) — досрочно уходим из listening.
    if (state.voice === 'listening') dispatchVoice('stop_listening')

    if (sttStartAt > 0) {
      logTiming('stt', 'Распознавание речи', now() - sttStartAt)
      sttStartAt = 0
    }
    const text = update.text.trim()
    if (update.segments.length === 0 || !text) {
      // Ничего не распознано — тихо возвращаемся в idle.
      dispatchVoice('reset')
      setState({ liveSegments: [] })
      return
    }
    if (!dispatchVoice('transcribed')) return // transcribing → thinking
    const segments = update.segments.map((s) => ({ speakerId: s.speakerId, text: s.text }))
    await finalizeAndReply(segments)
  }

  /** Ошибка распознавания: гасим запись и возвращаемся в idle. */
  function applySttError(message: string): void {
    console.warn('[stt] ошибка распознавания:', message)
    cancelTimers()
    stopCapture()
    if (state.voice === 'listening' || state.voice === 'transcribing') dispatchVoice('error')
    setState({ liveSegments: [], error: message })
  }

  /**
   * Фрагмент ответа Claude: растим отображаемый текст и, если включён TTS,
   * нарезаем поток на предложения и озвучиваем их на лету (не дожидаясь конца).
   */
  function applyClaudeToken(delta: string, conversationId?: string): void {
    // Копим текст хода per-разговор — для восстановления стрима после
    // переключения разговора или обновления страницы.
    const convId = conversationId ?? state.activeId
    if (convId) {
      setState({
        activeTurns: { ...state.activeTurns, [convId]: (state.activeTurns[convId] ?? '') + delta }
      })
    }
    if (convId !== state.activeId) return // фоновый разговор — в ленту не рисуем
    // Защита: если снапшот claude.active был пропущен (гонка подписки WS), но
    // токены активного разговора идут — поднимаем стрим из накопленного и выходим
    // (этот delta уже учтён в activeTurns выше).
    if (convId && state.voice === 'idle' && (state.activeTurns[convId] ?? '') !== '') {
      restoreStreamIfActive()
      return
    }
    if (state.voice !== 'thinking' && state.voice !== 'speaking') return
    setState({ streamingReply: state.streamingReply + delta })
    if (!autoSpeakActive()) return
    ttsBuffer += delta
    const { chunks, rest } = splitSpeakable(ttsBuffer)
    ttsBuffer = rest
    for (const chunk of chunks) {
      if (!ttsSession) startPipelineSpeaking()
      enqueueSpeak(chunk)
    }
  }

  /** Завершение ответа Claude: фиксируем сообщение; TTS дозвучивает хвост. */
  async function applyClaudeDone(
    text: string,
    meta?: TurnMeta,
    engine?: LlmProvider,
    message?: Message,
    conversationId?: string
  ): Promise<void> {
    // Ход завершён — убираем из активных.
    const convId = conversationId ?? state.activeId
    let statusUpdate: Promise<void> = Promise.resolve()
    if (convId) {
      const { [convId]: _done, ...rest } = state.activeTurns
      const { [convId]: _act, ...restActivity } = state.activeActivity
      const { [convId]: _usage, ...restUsage } = state.activeUsage
      setState({ activeTurns: rest, activeActivity: restActivity, activeUsage: restUsage })
      // Обновление статуса вторично: запускаем сразу, но не задерживаем очистку
      // живого индикатора завершившегося хода.
      statusUpdate = bumpTurnStatus(convId, meta).catch((error: unknown) => {
        console.warn('[conversation] не удалось обновить статус завершённого хода:', error)
      })
    }
    if (convId !== state.activeId) {
      // Фоновый разговор: ответ уже сохранён сервером — обновляем только сайдбар.
      await statusUpdate
      if (message) await refreshConversations()
      return
    }
    // Ход активного разговора завершён — активность живёт теперь в meta сообщения.
    if (state.liveActivity.length) setState({ liveActivity: [] })
    if (state.liveUsage) setState({ liveUsage: null }) // итог хода — в meta
    await statusUpdate
    // Мета хода (длительность/токены/стоимость) — показываем под последним ответом.
    if (meta && Object.keys(meta).length > 0) setState({ lastTurnMeta: meta })
    if (state.voice !== 'thinking' && state.voice !== 'speaking') {
      setState({ streamingReply: '' })
      ttsBuffer = ''
      // Ход доиграл, пока вкладка была в idle (например, после обновления
      // страницы) — сохранённое сервером сообщение просто добавляем в ленту.
      if (message) {
        appendPersisted(message)
        await refreshConversations()
      }
      return
    }

    if (!autoSpeakActive()) {
      // Без автоозвучки — единый ответ, короткий таймер speaking → idle.
      void finishReply(text || state.streamingReply, engine, meta, message)
      return
    }

    const full = (text || state.streamingReply).trim()
    setState({ streamingReply: '' })
    if (full) {
      if (message) appendPersisted(message)
      else await persistMessage('ai', full, engine, meta)
      await refreshConversations()
    }
    // Дозвучиваем незавершённый хвост (закрывая незавершённый блок кода).
    const tail = flushSpeakable(ttsBuffer)
    ttsBuffer = ''
    for (const chunk of tail) {
      if (!ttsSession) startPipelineSpeaking()
      enqueueSpeak(chunk)
    }
    if (ttsSession) {
      ttsSession.sourceComplete = true
      finishTtsSessionIfDone()
    } else {
      // Нечего озвучивать (пустой ответ) — возвращаемся в idle.
      if (state.voice === 'thinking') dispatchVoice('reset')
      else if (state.voice === 'speaking') dispatchVoice('speaking_done')
    }
  }

  /** Ошибка Claude: показываем баннер и возвращаемся в idle. */
  function applyClaudeError(message: string, conversationId?: string): void {
    const convId = conversationId ?? state.activeId
    if (convId) {
      const { [convId]: _failed, ...rest } = state.activeTurns
      const { [convId]: _act, ...restActivity } = state.activeActivity
      const { [convId]: _usage, ...restUsage } = state.activeUsage
      setState({ activeTurns: rest, activeActivity: restActivity, activeUsage: restUsage })
    }
    if (convId !== state.activeId) return // ошибка фонового хода — текущий UI не трогаем
    const warning = message.startsWith('WARNING:')
    const visibleMessage = warning ? message.slice('WARNING:'.length).trim() : message
    console.warn(`[claude] ${warning ? 'предупреждение' : 'ошибка'}:`, visibleMessage)
    if (warning) {
      setState({ error: visibleMessage })
      return
    }
    resetTts()
    setState({ streamingReply: '', error: message, liveActivity: [], liveUsage: null })
    if (state.voice === 'thinking' || state.voice === 'speaking') dispatchVoice('error')
  }

  /** Снапшот активных ходов при (пере)подключении WS — восстановление стрима. */
  function applyClaudeActive(turns: ActiveTurn[]): void {
    setState({
      activeTurns: Object.fromEntries(turns.map((t) => [t.conversationId, t.partial])),
      activeActivity: Object.fromEntries(
        turns
          .filter((t) => t.activity && t.activity.length > 0)
          .map((t) => [t.conversationId, t.activity ?? []])
      ),
      activeUsage: Object.fromEntries(
        turns.flatMap((t) => (t.usage ? [[t.conversationId, t.usage] as const] : []))
      )
    })
    restoreStreamIfActive()
  }

  /** Живые счётчики токенов хода (claude:usage): per-разговор и, если ход активного, в liveUsage. */
  function applyClaudeUsage(usage: TurnUsage, conversationId?: string): void {
    const patch: Partial<AppState> = {}
    if (conversationId !== undefined) {
      patch.activeUsage = { ...state.activeUsage, [conversationId]: usage }
    }
    if (conversationId === undefined || conversationId === state.activeId) {
      patch.liveUsage = usage
    }
    setState(patch)
  }

  function dismissError(): void {
    setState({ error: null })
  }

  // --- Канал уведомлений ---------------------------------------------------
  // Ошибка вызова моста раньше в лучшем случае писалась в баннер чата, а на
  // страницах проектов/CI/машин не было видно вообще ничего: запрос упал, экран
  // не изменился. Теперь любой такой промах кладётся сюда, а App показывает
  // тостом — с кнопкой «Повторить» там, где повтор безопасен (чтение и
  // идемпотентная правка; создание, удаление и запуск рана повтора не получают).

  let noticeSeq = 0

  function notify(notice: Omit<AppNotice, 'id'>): void {
    noticeSeq += 1
    setState({ notices: [...state.notices, { ...notice, id: `n${noticeSeq}` }] })
  }

  function dismissNotice(id: string): void {
    setState({ notices: state.notices.filter((item) => item.id !== id) })
  }

  // Merge — длинная операция: терминальный исход показываем тостом, где бы
  // пользователь ни находился. Дедуп по (ран, статус) — снимки приходят повторно.
  const mergeNoticeSeen = new Map<string, string>()
  ciBridge?.onMerge?.(({ run }) => {
    if (!['success', 'failed', 'cancelled', 'decision_required'].includes(run.status)) { mergeNoticeSeen.set(run.id, run.status); return }
    if (mergeNoticeSeen.get(run.id) === run.status) return
    mergeNoticeSeen.set(run.id, run.status)
    if (run.status === 'success') notify({ kind: 'success', text: `Merge ${run.sourceBranch} → main завершён успешно` })
    else if (run.status === 'decision_required') notify({ kind: 'error', text: `Merge ${run.sourceBranch}: нужно решение — ${run.error ?? 'см. вкладку Merge задачи'}` })
    else if (run.status === 'failed') notify({ kind: 'error', text: `Merge ${run.sourceBranch} завершился с ошибкой: ${run.error ?? 'см. вкладку Merge задачи'}` })
  })

  /** Показать ошибку упавшего вызова моста; retry — если повтор безопасен. */
  function fail(err: unknown, retry?: () => void): void {
    notify({ kind: 'error', text: err instanceof Error ? err.message : String(err), ...(retry ? { retry } : {}) })
  }

  function downloadModel(): void {
    if (!deps.startModelDownload || state.downloading) return
    setState({ downloading: true, downloadPercent: 0, error: null })
    deps.startModelDownload()
  }

  function applyDownloadProgress(percent: number): void {
    setState({ downloading: true, downloadPercent: percent })
  }

  function applyDownloadDone(): void {
    setState({ downloading: false, downloadPercent: 100, modelPresent: true })
    void refreshWhisperModels() // обновить размеры в списке моделей
  }

  function applyDownloadError(message: string): void {
    setState({ downloading: false, error: message })
  }

  /** Персист распознанных сегментов как реплик пользователя, затем ответ. */
  async function finalizeAndReply(segments: LiveSegment[]): Promise<void> {
    const first = segments[0]
    if (!first) return
    const firstRole = `u${state.settings.diarization ? first.speakerId : 1}` as MessageRole
    const created = await ensureConversation(first.text, {
      role: firstRole,
      text: first.text,
      time: formatTime(now())
    })
    for (const seg of created ? segments.slice(1) : segments) {
      const role = `u${state.settings.diarization ? seg.speakerId : 1}` as MessageRole
      await persistMessage(role, seg.text)
    }
    setState({ liveSegments: [] })
    await refreshConversations()
    // Голосовая команда «открой консоль/проводник» → виджет в ответе, без LLM.
    if (await maybeOpenUtility(segments.map((s) => s.text).join(' '))) {
      dispatchVoice('reset') // thinking → idle
      return
    }
    beginReply(segments)
  }

  function stopSpeak(): void {
    // stop_speaking: speaking → idle.
    if (!dispatchVoice('stop_speaking')) return
    cancelTimers()
    resetTts()
  }

  /** Один клип озвучки доигран: считаем в сессии, завершаем при готовности. */
  function applyTtsDone(): void {
    if (!ttsSession) return
    ttsSession.played += 1
    finishTtsSessionIfDone()
  }

  /** Ошибка синтеза одного чанка: считаем его «проигранным», чтобы не зависнуть. */
  function applyTtsError(message: string): void {
    console.warn('[tts] ошибка озвучки:', message)
    if (ttsSession) {
      ttsSession.played += 1
      finishTtsSessionIfDone()
    } else if (state.voice === 'speaking') {
      dispatchVoice('speaking_done')
    }
  }

  /** Ручной повтор озвучки сообщения по кнопке (▶/⏹). Вне машины состояний. */
  function replayMessage(id: string, text: string): void {
    if (!ttsEnabled || !deps.speakText) return
    if (state.speakingMessageId === id) {
      resetTts() // повторный клик — стоп
      return
    }
    if (state.voice === 'speaking')
      dispatchVoice('stop_speaking') // прервать авто-озвучку → idle
    else if (state.voice !== 'idle') return // во время записи/распознавания не мешаем

    resetTts()
    ttsSession = { kind: 'replay', messageId: id, queued: 0, played: 0, sourceComplete: false }
    setState({ speakingMessageId: id })
    for (const c of flushSpeakable(text)) enqueueSpeak(c)
    ttsSession.sourceComplete = true
    finishTtsSessionIfDone()
  }

  function dispose(): void {
    cancelTimers()
    if (conversationsRefreshTimer) {
      clearTimeout(conversationsRefreshTimer)
      conversationsRefreshTimer = null
    }
    if (loginStatusPoll) {
      clearInterval(loginStatusPoll)
      loginStatusPoll = null
    }
  }

  // --- Проекты + канбан ----------------------------------------------------

  /** Возвращает свежий список: вход в раздел ведёт на первый проект, и его нужно знать сразу. */
  async function refreshProjects(): Promise<ProjectSummary[]> {
    const projects = await api['projects:list']()
    setState({ projects, projectsLoaded: true })
    return projects
  }
  async function openProjects(): Promise<void> {
    setState({ projectsOpen: true })
    try {
      await refreshProjects()
    } catch (err) {
      fail(err, () => void openProjects())
    }
  }
  function closeProjects(): void {
    closeBoard()
    setState({ projectsOpen: false, projects: [], projectsLoaded: false, projectDetail: null })
  }
  async function selectProject(id: string): Promise<void> {
    try {
      setState({ projectDetail: await api['projects:get']({ id }) })
    } catch (err) {
      fail(err, () => void selectProject(id))
    }
  }
  async function createProject(input: {
    name: string
    description?: string
    gitUrl?: string
    technologies?: string[]
    skills?: string[]
    defaultSkills?: Partial<WorkItemDefaultSkills>
    commitPolicy?: 'agent_commits' | 'final_system_commit' | 'manual_user_confirmation'

    mergeTransport?: 'local' | 'github_pull_request'
    agentPlanApprovalMode?: 'manual' | 'automatic'
    testCommand?: string
    productionDeployCommand?: string
    productionAgentId?: string | null
    productionCheckoutPath?: string
    productionHealthCheckCommand?: string
  }): Promise<ProjectDetail | null> {
    try {
      const detail = await api['projects:create'](input)
      await refreshProjects()
      setState({ projectDetail: detail })
      return detail
    } catch (err) {
      fail(err)
      return null
    }
  }
  async function updateProject(
    id: string,
    fields: {
      name?: string
      description?: string
      gitUrl?: string | null
      previewUrl?: string | null
      technologies?: string[]
      skills?: string[]
      defaultSkills?: Partial<WorkItemDefaultSkills>
    commitPolicy?: 'agent_commits' | 'final_system_commit' | 'manual_user_confirmation'

    mergeTransport?: 'local' | 'github_pull_request'
    agentPlanApprovalMode?: 'manual' | 'automatic'
    testCommand?: string
    productionDeployCommand?: string
    productionAgentId?: string | null
    productionCheckoutPath?: string
    productionHealthCheckCommand?: string
    ciBaseBranch?: string
    ciBranchTemplate?: string
    ciReuseStrategy?: 'reuse' | 'clean' | 'fail'
    ciExecAuthRef?: string
    doneRetentionDays?: number | null
    }
  ): Promise<void> {
    try {
      const detail = await api['projects:update']({ id, ...fields })
      setState({ projectDetail: detail })
      await refreshProjects()
    } catch (err) {
      fail(err, () => void updateProject(id, fields))
    }
  }
  async function deleteProject(id: string): Promise<void> {
    try {
      await api['projects:delete']({ id })
      if (state.activeProjectId === id) closeBoard()
      if (state.projectDetail?.id === id) setState({ projectDetail: null })
      await refreshProjects()
    } catch (err) {
      fail(err)
    }
  }
  async function addProjectMember(id: string, username: string): Promise<void> {
    try {
      setState({ projectDetail: await api['projects:addMember']({ id, username }) })
      await refreshProjects()
    } catch (err) {
      fail(err)
    }
  }
  async function removeProjectMember(id: string, username: string): Promise<void> {
    try {
      setState({ projectDetail: await api['projects:removeMember']({ id, username }) })
      if (state.activeProjectId === id) await refreshBoard()
    } catch (err) {
      fail(err)
    }
  }
  async function linkProjectMachine(id: string, agentId: string): Promise<void> {
    try {
      setState({ projectDetail: await api['projects:linkMachine']({ id, agentId }) })
    } catch (err) {
      fail(err)
    }
  }
  async function unlinkProjectMachine(id: string, agentId: string): Promise<void> {
    try {
      setState({ projectDetail: await api['projects:unlinkMachine']({ id, agentId }) })
    } catch (err) {
      fail(err)
    }
  }
  async function setProjectMachinePath(id: string, agentId: string, path: string): Promise<void> {
    try {
      setState({ projectDetail: await api['projects:setMachinePath']({ id, agentId, path }) })
    } catch (err) {
      fail(err, () => void setProjectMachinePath(id, agentId, path))
    }
  }
  async function setProjectReposRoot(id: string, agentId: string, reposRoot: string): Promise<void> {
    try {
      setState({ projectDetail: await api['projects:setReposRoot']({ id, agentId, reposRoot }) })
    } catch (err) {
      fail(err, () => void setProjectReposRoot(id, agentId, reposRoot))
    }
  }
  async function setProjectDefaultMachine(id: string, agentId: string): Promise<void> {
    try {
      setState({ projectDetail: await api['projects:setDefaultMachine']({ id, agentId }) })
    } catch (err) {
      fail(err, () => void setProjectDefaultMachine(id, agentId))
    }
  }
  /** Загрузить детали проекта без записи в стор (для настроек чата). */
  async function fetchProjectDetail(id: string): Promise<ProjectDetail | null> {
    try {
      return await api['projects:get']({ id })
    } catch (err) {
      fail(err)
      return null
    }
  }
  async function fetchConversationMachines(id: string, projectId?: string | null): Promise<AgentInfo[]> {
    return api['conversations:listMachines']({ id, projectId })
  }
  /** Привязать/отвязать чат к проекту; сервер перезаписывает машину/папку/навыки. */
  async function setConversationProject(id: string, projectId: string | null): Promise<void> {
    const conversation = await api['conversations:setProject']({ id, projectId })
    setState({ conversations: state.conversations.map((c) => (c.id === id ? conversation : c)) })
  }
  async function setConversationPreviewUrl(id: string, previewUrl: string | null): Promise<void> {
    const conversation = await api['conversations:setPreviewUrl']({ id, previewUrl })
    setState({ conversations: state.conversations.map((c) => (c.id === id ? conversation : c)) })
  }
  async function setConversationStatus(id: string, status: ConversationStatus): Promise<void> {
    const conversation = await api['conversations:setStatus']({ id, status })
    setState({ conversations: state.conversations.map((c) => (c.id === id ? conversation : c)) })
  }
  // Авто-переход статуса по завершению хода: режим «План» → «планирование
  // закончено», иначе (Разработка) → «разработка закончена». Режим берём из meta
  // завершённого хода, с фолбэком на настройку чата/общий дефолт.
  async function bumpTurnStatus(convId: string, meta?: TurnMeta): Promise<void> {
    const conv = state.conversations.find((c) => c.id === convId)
    const mode = (meta?.request?.permissionMode as PermissionMode | undefined)
      ?? conv?.permissionMode ?? state.settings.permissionMode
    await setConversationStatus(convId, mode === 'plan' ? 'planning_done' : 'development_done')
  }
  async function refreshBoard(): Promise<void> {
    const id = state.activeProjectId
    if (!id) return
    setState({ board: await api['board:get']({ id, includeCompleted: state.boardIncludeCompleted }) })
  }
  /**
   * «Показать завершённые»: доска фильтруется на сервере, поэтому переключатель
   * — это новый запрос снапшота и переподписка (живые board.update должны
   * приходить в том же составе).
   */
  async function setBoardIncludeCompleted(include: boolean): Promise<void> {
    if (state.boardIncludeCompleted === include) return
    setState({ boardIncludeCompleted: include })
    const id = state.activeProjectId
    if (!id) return
    boardBridge?.subscribe(id, include)
    try {
      setState({ board: await api['board:get']({ id, includeCompleted: include }) })
    } catch (err) {
      fail(err, () => void setBoardIncludeCompleted(include))
    }
  }
  async function openBoard(id: string): Promise<void> {
    setState({ activeProjectId: id, boardLoading: true, boardError: null, board: null, projectSettingsOpen: false })
    try {
      const includeCompleted = state.boardIncludeCompleted
      const [board, detail] = await Promise.all([
        api['board:get']({ id, includeCompleted }),
        api['projects:get']({ id })
      ])
      const ciSummaries = { ...state.ciSummaries }
      for (const r of board.ciRuns ?? []) ciSummaries[r.taskId] = r
      setState({ board, projectDetail: detail, ciSummaries, boardLoading: false, boardError: null })
      boardBridge?.subscribe(id, includeCompleted)
    } catch (err) {
      // Ошибку видно и на странице (экран ошибки с «Повторить»), и тостом: тост
      // живёт секунды, а пустая доска без объяснения — вечно.
      setState({ boardLoading: false, boardError: err instanceof Error ? err.message : String(err) })
      fail(err, () => void openBoard(id))
    }
  }
  function closeBoard(): void {
    if (state.activeProjectId) boardBridge?.unsubscribe()
    setState({ activeProjectId: null, projectSettingsOpen: false, board: null, boardLoading: false, boardError: null })
  }
  function openProjectSettings(): void {
    setState({ projectSettingsOpen: true })
  }
  function closeProjectSettings(): void {
    setState({ projectSettingsOpen: false })
  }
  function applyBoardUpdate(projectId: string, board: Board): void {
    if (projectId !== state.activeProjectId) return
    const ciSummaries = { ...state.ciSummaries }
    for (const r of board.ciRuns ?? []) ciSummaries[r.taskId] = r
    const prev = state.board
    setState({ board, ciSummaries })
    // Карточку перенесли в «Готово» (или вернули в работу) — сервер спрятал или
    // вернул чат задачи в список бесед. Сверяем только набор done-задач: на
    // обычный переезд между рабочими колонками список не дёргаем.
    if (prev && !sameDoneTasks(prev, board)) scheduleConversationsRefresh()
  }

  // --- CI-раннер ---------------------------------------------------------

  // ---- Использование базы знаний -----------------------------------------

  function patchKbUsage(conversationId: string, fn: (cache: KbUsageCache) => KbUsageCache): void {
    const prev = state.kbUsage[conversationId] ?? emptyKbUsageCache()
    setState({ kbUsage: { ...state.kbUsage, [conversationId]: fn(prev) } })
  }
  function patchKbProjectUsage(projectId: string, fn: (cache: KbUsageCache) => KbUsageCache): void {
    const prev = state.kbUsageByProject[projectId] ?? emptyKbUsageCache()
    setState({ kbUsageByProject: { ...state.kbUsageByProject, [projectId]: fn(prev) } })
  }
  function openKbUsage(): void {
    setState({ kbUsageOpen: true })
  }
  function closeKbUsage(): void {
    setState({ kbUsageOpen: false })
  }
  /** Фолбэк для старых чатов и для desktop без моста: отчёт из истории ходов. */
  function kbUsageFallback(conversationId: string): ReturnType<typeof buildKbUsageFromMessages> {
    const conv = state.conversations.find((c) => c.id === conversationId)
    return buildKbUsageFromMessages(conversationId === state.activeId ? state.messages : [], {
      conversationId,
      projectId: conv?.projectId ?? null,
      kbContextMode: conv?.kbContextMode ?? 'auto',
      available: state.kbStatus ? state.kbStatus.available : true
    })
  }
  async function loadKbUsage(conversationId: string): Promise<void> {
    const fallback = kbUsageFallback(conversationId)
    if (!kbBridge) {
      // Моста нет (desktop) — панель всё равно показывает, что видела модель.
      patchKbUsage(conversationId, () => kbUsageSnapshot(fallback))
      return
    }
    patchKbUsage(conversationId, (c) => ({ ...c, loading: true, error: null }))
    try {
      const report = await kbBridge.getConversationUsage(conversationId)
      patchKbUsage(conversationId, () => kbUsageSnapshot(mergeKbUsage(report, fallback)))
    } catch (err) {
      patchKbUsage(conversationId, (c) => ({ ...c, loading: false, error: err instanceof Error ? err.message : String(err) }))
    }
  }
  async function loadProjectKbUsage(projectId: string): Promise<void> {
    if (!kbBridge) return
    patchKbProjectUsage(projectId, (c) => ({ ...c, loading: true, error: null }))
    try {
      const report = await kbBridge.getProjectUsage(projectId)
      // Проектный отчёт кладём в тот же кэш: у него те же итоги, разделы и лента.
      patchKbProjectUsage(projectId, () => ({
        ...kbUsageSnapshot({
          conversationId: '',
          projectId,
          kbContextMode: 'auto',
          toolEnabled: report.toolEnabled,
          available: report.available,
          lastSeq: 0,
          totals: report.totals,
          sections: report.sections,
          recent: report.recent
        }),
        conversations: report.conversations
      }))
    } catch (err) {
      patchKbProjectUsage(projectId, (c) => ({ ...c, loading: false, error: err instanceof Error ? err.message : String(err) }))
    }
  }
  function applyKbUsageQuery(conversationId: string, projectId: string | null, query: KbUsageQuery): void {
    // Кадры приходят по пользователю, а не по подписке: незагруженные чаты
    // пропускаем — их отчёт соберётся при открытии панели.
    if (state.kbUsage[conversationId]?.report) {
      patchKbUsage(conversationId, (c) => applyKbUsageFrame(c, query))
    }
    if (projectId && state.kbUsageByProject[projectId]?.report) {
      patchKbProjectUsage(projectId, (c) => applyKbUsageFrame(c, query))
    }
  }
  async function refreshKbStatus(): Promise<void> {
    try {
      setState({ kbStatus: await deps.api['kb:status']() })
    } catch {
      // Статус индекса — украшение пустого состояния, ошибку не показываем тостом.
    }
  }

  function patchCiRun(runId: string, fn: (cache: CiRunCache) => CiRunCache): void {
    const prev = state.ciRuns[runId] ?? { detail: null, log: [], conclusion: null }
    setState({ ciRuns: { ...state.ciRuns, [runId]: fn(prev) } })
  }
  function mergeStep(detail: CiRunDetail | null, step: CiRunStep): CiRunDetail | null {
    if (!detail) return { run: { id: step.runId } as CiRun, steps: [step], fixAttempts: [], interactions: [] }
    const steps = detail.steps.some((x) => x.id === step.id)
      ? detail.steps.map((x) => (x.id === step.id ? step : x))
      : [...detail.steps, step]
    return { ...detail, steps }
  }

  async function openCi(): Promise<void> {
    setState({ ciOpen: true, ciStatus: 'loading', ciError: null })
    if (!ciBridge) return
    try {
      const [commands, settings, suggestions, workspaces] = await Promise.all([
        ciBridge.listCommands(),
        ciBridge.getSettings(),
        ciBridge.listSuggestions(),
        ciBridge.listWorkspaces()
      ])
      setState({ ciCommands: commands, ciSettings: settings, ciSuggestions: suggestions, ciWorkspaces: workspaces, ciStatus: 'ready', ciError: null })
    } catch (err) {
      setState({ ciStatus: 'error', ciError: err instanceof Error ? err.message : String(err) })
      fail(err, () => void openCi())
    }
  }
  function closeCi(): void {
    setState({ ciOpen: false })
  }
  async function reloadCiCommands(projectId?: string): Promise<void> {
    if (!ciBridge) return
    setState({ ciCommands: await ciBridge.listCommands(projectId) })
  }
  async function createCiCommand(input: CiCommandInput): Promise<CiCommand | null> {
    if (!ciBridge) return null
    try {
      const cmd = await ciBridge.createCommand(input)
      setState({ ciCommands: [...state.ciCommands, cmd] })
      return cmd
    } catch (err) {
      fail(err)
      return null
    }
  }
  async function updateCiCommand(id: string, input: CiCommandInput): Promise<void> {
    if (!ciBridge) return
    try {
      const cmd = await ciBridge.updateCommand(id, input)
      setState({ ciCommands: state.ciCommands.map((c) => (c.id === id ? cmd : c)) })
    } catch (err) {
      fail(err, () => void updateCiCommand(id, input))
    }
  }
  async function deleteCiCommand(id: string): Promise<void> {
    if (!ciBridge) return
    try {
      await ciBridge.deleteCommand(id)
      setState({ ciCommands: state.ciCommands.filter((c) => c.id !== id) })
    } catch (err) {
      fail(err)
    }
  }
  async function ciCommandUsage(id: string): Promise<{ projects: Array<{ id: string; name: string }>; tasks: Array<{ id: string; title: string }> }> {
    if (!ciBridge) return { projects: [], tasks: [] }
    return ciBridge.commandUsage(id)
  }
  async function saveCiSettings(settings: Partial<CiGlobalSettings>): Promise<void> {
    if (!ciBridge) return
    try {
      setState({ ciSettings: await ciBridge.putSettings(settings) })
    } catch (err) {
      fail(err, () => void saveCiSettings(settings))
    }
  }
  async function resolveCiSuggestion(id: string, accept: boolean): Promise<void> {
    if (!ciBridge) return
    try {
      await ciBridge.resolveSuggestion(id, accept)
      setState({ ciSuggestions: state.ciSuggestions.filter((x) => x.id !== id) })
      if (accept) await reloadCiCommands()
    } catch (err) {
      fail(err)
    }
  }
  async function reloadCiWorkspaces(projectId?: string): Promise<void> {
    if (!ciBridge) return
    setState({ ciWorkspaces: await ciBridge.listWorkspaces(projectId) })
  }
  async function startCiRun(projectId: string, taskId: string, options?: CiRunMode | { mode?: CiRunMode; provider?: 'claude' | 'codex'; model?: string; launch?: 'queue' | 'parallel' }): Promise<CiRun | null> {
    if (!ciBridge) return null
    try {
      const launchOptions = typeof options === 'string' ? { mode: options } : options
      const run = await ciBridge.startRun(projectId, taskId, launchOptions)
      setState({ ciSummaries: { ...state.ciSummaries, [taskId]: { id: run.id, taskId, status: run.status, slotProgress: run.slotProgress, durationMs: run.durationMs, modelActive: false, awaitingInput: false } } })
      patchCiRun(run.id, (c) => ({ ...c, detail: c.detail ? { ...c.detail, run } : { run, steps: [], fixAttempts: [], interactions: [] } }))
      return run
    } catch (err) {
      fail(err)
      return null
    }
  }
  async function startMergeRun(projectId: string, taskId: string, agentId?: string | null): Promise<boolean> {
    if (!ciBridge) return false
    try {
      await ciBridge.startMerge(projectId, taskId, agentId)
      await openBoard(projectId)
      notify({ kind: 'info', text: 'Merge-ран запущен' })
      return true
    } catch (err) {
      fail(err)
      return false
    }
  }

  async function cancelCiRun(runId: string): Promise<void> {
    if (!ciBridge) return
    try { await ciBridge.cancelRun(runId) } catch (err) { fail(err) }
  }
  async function dequeueCiRun(runId: string): Promise<void> {
    if (!ciBridge) return
    try {
      const result = await ciBridge.dequeueRun(runId)
      if (result.status === 'removed') {
        // Ответ HTTP уже содержит финальный ран; не ждём WS, чтобы кнопка не
        // оставалась в старом состоянии при медленном кадре.
        applyCiDone(runId, result.run)
      } else if (result.status === 'running') {
        applyCiRun(runId, result.run)
        notify({ kind: 'error', text: 'Ран уже выполняется. Откройте ленту и остановите выполнение, если нужно вернуть задачу в TODO.' })
      } else if (result.status === 'not_queued') {
        applyCiRun(runId, result.run)
        notify({ kind: 'error', text: 'Ран больше не ожидает запуска: очередь не была изменена.' })
      } else {
        notify({ kind: 'error', text: 'Ран не найден.' })
      }
    } catch (err) { fail(err) }
  }
  async function retryCiRun(runId: string): Promise<CiRun | null> {
    if (!ciBridge) return null
    try { return await ciBridge.retryRun(runId) } catch (err) { fail(err); return null }
  }
  async function retryCiRunFromStep(runId: string, selection?: { provider: 'claude' | 'codex'; model: string; llmEngineId?: string | null }): Promise<CiRun | null> {
    // Повтор с упавшего шага — тот же ран; после запуска перечитываем деталь/лог.
    if (!ciBridge) return null
    try { const r = await ciBridge.retryRunFromStep(runId, selection); await loadCiRun(runId); return r } catch (err) { fail(err); return null }
  }
  async function discardCiWorkspaceAndRetry(runId: string): Promise<CiRun | null> {
    if (!ciBridge) return null
    try { return await ciBridge.discardChangesAndRetry(runId) } catch (err) { fail(err); return null }
  }
  async function loadCiRun(runId: string): Promise<void> {
    if (!ciBridge) return
    patchCiRun(runId, (c) => ({ ...c, loading: true, error: null }))
    try {
      const [detail, log] = await Promise.all([ciBridge.getRun(runId), ciBridge.getRunLog(runId)])
      patchCiRun(runId, (c) => ({ ...c, detail, log, loading: false, error: null }))
    } catch (err) {
      // Лента без шагов и без объяснения читалась как «ран пустой» — теперь в ней
      // экран ошибки с «Повторить».
      patchCiRun(runId, (c) => ({ ...c, loading: false, error: err instanceof Error ? err.message : String(err) }))
      fail(err, () => void loadCiRun(runId))
    }
  }
  function ciSubscribe(runId: string): void {
    ciBridge?.subscribe(runId)
  }
  function ciUnsubscribe(runId: string): void {
    ciBridge?.unsubscribe(runId)
  }
  function openCiRun(runId: string): void {
    setState({ ciActiveRunId: runId })
  }
  function closeCiRun(): void {
    setState({ ciActiveRunId: null })
  }
  function applyCiSnapshot(runId: string, detail: CiRunDetail, log: CiLogLine[]): void {
    patchCiRun(runId, (c) => ({ ...c, detail, log }))
  }
  function applyCiRun(runId: string, run: CiRun): void {
    patchCiRun(runId, (c) => ({ ...c, detail: c.detail ? { ...c.detail, run } : { run, steps: [], fixAttempts: [], interactions: [] } }))
    const known = state.ciSummaries[run.taskId]
    setState({ ciSummaries: { ...state.ciSummaries, [run.taskId]: { id: run.id, taskId: run.taskId, status: run.status, slotProgress: run.slotProgress, durationMs: run.durationMs, modelActive: known?.modelActive ?? false, awaitingInput: run.status === 'awaiting_input', progress: known?.id === run.id ? known.progress : undefined } } })
  }
  function applyCiStep(runId: string, step: CiRunStep): void {
    patchCiRun(runId, (c) => ({ ...c, detail: mergeStep(c.detail, step) }))
  }
  function applyCiLog(runId: string, line: CiLogLine): void {
    patchCiRun(runId, (c) => ({ ...c, log: [...c.log, line] }))
  }
  function applyCiFix(runId: string, attempt: CiFixAttempt): void {
    patchCiRun(runId, (c) => {
      if (!c.detail) return c
      const fixAttempts = c.detail.fixAttempts.some((x) => x.id === attempt.id)
        ? c.detail.fixAttempts.map((x) => (x.id === attempt.id ? attempt : x))
        : [...c.detail.fixAttempts, attempt]
      return { ...c, detail: { ...c.detail, fixAttempts } }
    })
  }
  function applyCiDone(runId: string, run: CiRun, conclusion?: CiRunConclusion): void {
    patchCiRun(runId, (c) => ({ ...c, conclusion: conclusion ?? c.conclusion, detail: c.detail ? { ...c.detail, run } : { run, steps: [], fixAttempts: [], interactions: [] } }))
    const previous = state.ciSummaries[run.taskId]
    const terminal = { id: run.id, taskId: run.taskId, status: run.status, slotProgress: run.slotProgress, durationMs: run.durationMs, modelActive: false, awaitingInput: false, terminalColumnId: run.terminalColumnId }
    const display = (run.status === 'cancelled' || run.status === 'skipped') && previous?.status === 'success'
      ? { ...previous, latestAttempt: terminal }
      : terminal
    setState({ ciSummaries: { ...state.ciSummaries, [run.taskId]: display } })
    // Финализация рана увозит карточку по колонкам (успех с мержем — в «Готово»),
    // а с ней меняется и видимость чата задачи в сайдбаре.
    scheduleConversationsRefresh()
  }
  function applyCiSummary(_projectId: string, summary: CiRunSummary): void {
    const known = state.ciSummaries[summary.taskId]
    // Новый runId всегда сильнее старого. Внутри одного запуска принимаем только
    // монотонную серверную версию: запоздалый WS/snapshot не откатывает прогресс.
    if (known?.progress && summary.progress) {
      if (known.progress.runId !== summary.progress.runId && known.progress.startedAt != null && summary.progress.startedAt != null && known.progress.startedAt > summary.progress.startedAt) return
      if (known.progress.runId === summary.progress.runId && known.progress.version > summary.progress.version) return
    }
    setState({ ciSummaries: { ...state.ciSummaries, [summary.taskId]: summary } })
    // Сводка приходит на все соединения пользователя, а не только подписчикам
    // ленты: для страницы без открытой ленты рана это единственный сигнал, что
    // ран кончился. Дёргаем только на терминальном статусе — очередь и работа
    // видимости чатов не меняют.
    if (isTerminalCiStatus(summary.status)) scheduleConversationsRefresh()
  }
  /** Пауза рана: вопрос модели или гейт плана (создание и ответ приходят одним типом). */
  function applyCiInteraction(runId: string, interaction: CiInteraction): void {
    if (interaction.status !== 'pending' && !state.answeredCiInteractions.includes(interaction.id)) {
      setState({ answeredCiInteractions: [...state.answeredCiInteractions, interaction.id] })
    }
    patchCiRun(runId, (c) => {
      if (!c.detail) return c
      const list = c.detail.interactions ?? []
      const interactions = list.some((x) => x.id === interaction.id)
        ? list.map((x) => (x.id === interaction.id ? interaction : x))
        : [...list, interaction]
      return { ...c, detail: { ...c.detail, interactions } }
    })
  }
  /**
   * Сервер сам дописал сообщение в чат (резюме законченного рана). В открытый
   * чат кладём реплику сразу; в остальных она уже сохранена и придёт с историей,
   * но сайдбар о ней не знает — перечитываем список, чтобы строка поднялась по
   * `updatedAt`, а свежесозданный чат задачи в нём появился.
   */
  function applyChatMessage(conversationId: string, message: Message): void {
    if (conversationId !== state.activeId) {
      scheduleConversationsRefresh()
      return
    }
    const existing = state.messages.some((item) => item.id === message.id)
    if (existing) setState({ messages: state.messages.map((item) => item.id === message.id ? message : item) })
    else appendPersisted(message)
  }
  /** Ответить на паузу рана из ленты. Ошибка 409 (ответили из чата) — не фатальна. */
  async function answerCiInteraction(runId: string, interactionId: string, answer: CiInteractionAnswer): Promise<void> {
    // Пауза гасится сразу, даже если запрос упал с 409 (ответили из другого места).
    if (!state.answeredCiInteractions.includes(interactionId)) {
      setState({ answeredCiInteractions: [...state.answeredCiInteractions, interactionId] })
    }
    try {
      const updated = await ciBridge?.answerInteraction(runId, interactionId, answer)
      if (updated) applyCiInteraction(runId, updated)
    } catch (err) {
      fail(err)
      void loadCiRun(runId)
    }
    // Сервер дописывает ответ репликой в связанный чат — подтягиваем ленту.
    if (state.activeId) {
      const res = await api['conversations:get']({ id: state.activeId }).catch(() => null)
      if (res && res.conversation.id === state.activeId) setState({ messages: res.messages })
    }
  }

  async function createColumn(name: string): Promise<void> {
    const id = state.activeProjectId
    if (!id) return
    try {
      await api['columns:create']({ projectId: id, name })
      await refreshBoard()
    } catch (err) {
      fail(err)
    }
  }
  async function updateColumn(columnId: string, fields: { name?: string; wipLimit?: number | null }): Promise<void> {
    const id = state.activeProjectId
    if (!id) return
    try {
      await api['columns:rename']({ projectId: id, columnId, ...fields })
      await refreshBoard()
    } catch (err) {
      fail(err, () => void updateColumn(columnId, fields))
    }
  }
  async function setColumnHidden(columnId: string, hidden: boolean): Promise<void> {
    const id = state.activeProjectId
    if (!id) return
    try {
      await api['columns:setHidden']({ projectId: id, columnId, hidden })
      await refreshBoard()
    } catch (err) {
      fail(err, () => void setColumnHidden(columnId, hidden))
    }
  }
  async function reorderColumns(order: string[]): Promise<void> {
    const id = state.activeProjectId
    const prev = state.board
    if (!id || !prev) return
    const byId = new Map(prev.columns.map((c) => [c.id, c]))
    const columns = order
      .map((cid, i) => {
        const c = byId.get(cid)
        return c ? { ...c, position: (i + 1) * BOARD_RANK_STEP } : null
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
    setState({ board: { ...prev, columns } })
    try {
      await api['columns:reorder']({ projectId: id, order })
      await refreshBoard()
    } catch (err) {
      setState({ board: prev })
      fail(err, () => void reorderColumns(order))
    }
  }
  async function deleteColumn(columnId: string): Promise<void> {
    const id = state.activeProjectId
    if (!id) return
    try {
      await api['columns:delete']({ projectId: id, columnId })
      await refreshBoard()
    } catch (err) {
      fail(err)
    }
  }
  async function createTask(
    columnId: string,
    input: { title: string; description?: string; acceptanceCriteria?: string; type?: WorkItemType; parentId?: string | null; priority?: TaskPriority; assignee?: string | null }
  ): Promise<void> {
    const id = state.activeProjectId
    if (!id) return
    try {
      await api['tasks:create']({ projectId: id, columnId, ...input })
      await refreshBoard()
    } catch (err) {
      fail(err)
    }
  }
  async function createTaskAndStartCi(
    projectId: string,
    input: { title: string; description?: string; acceptanceCriteria?: string; priority?: TaskPriority; assignee?: string | null; provider: 'claude' | 'codex'; model: string }
  ): Promise<CiRun | null> {
    if (!ciBridge) return null
    try {
      // Чат может быть открыт без доски, поэтому колонку берём свежим снимком, а
      // не из state.board. «Готово» не годится: ран сам переведёт задачу в разработку.
      const board = await api['board:get']({ id: projectId })
      const column = board.columns.find((item) => item.semanticType === 'ready')
        ?? board.columns.find((item) => item.semanticType === 'backlog')
        ?? board.columns[0]
      if (!column) throw new Error('В проекте нет колонки для новой задачи')
      const task = await api['tasks:create']({
        projectId,
        columnId: column.id,
        title: input.title,
        description: input.description,
        acceptanceCriteria: input.acceptanceCriteria,
        priority: input.priority,
        assignee: input.assignee
      })
      if (state.activeProjectId === projectId) await refreshBoard()
      return await startCiRun(projectId, task.id, { provider: input.provider, model: input.model })
    } catch (err) {
      fail(err)
      return null
    }
  }

  async function updateTask(
    taskId: string,
    fields: { title?: string; description?: string; acceptanceCriteria?: string; type?: WorkItemType; parentId?: string | null; priority?: TaskPriority; assignee?: string | null; labels?: string[]; skills?: string[]; storyPoints?: number | null; dueDate?: number | null; flagged?: boolean }
  ): Promise<void> {
    const id = state.activeProjectId

    if (!id) return
    try {
      await api['tasks:update']({ projectId: id, taskId, ...fields })
      await refreshBoard()
    } catch (err) {
      fail(err, () => void updateTask(taskId, fields))
    }
  }
  async function moveTask(
    taskId: string,
    columnId: string,
    afterId?: string | null,
    beforeId?: string | null
  ): Promise<void> {
    const id = state.activeProjectId
    const prev = state.board
    if (!id || !prev) return
    const tasks = prev.tasks.map((t) => ({ ...t }))
    const moving = tasks.find((t) => t.id === taskId)
    if (moving) {
      moving.columnId = columnId
      const done = prev.columns.find((column) => column.id === columnId)?.semanticType === 'done'
      moving.doneAt = done ? moving.doneAt ?? now() : null
      const after = afterId ? tasks.find((t) => t.id === afterId) : null
      const before = beforeId ? tasks.find((t) => t.id === beforeId) : null
      moving.position =
        after && before
          ? (after.position + before.position) / 2
          : after
            ? after.position + BOARD_RANK_STEP
            : before
              ? before.position - BOARD_RANK_STEP
              : Math.max(0, ...tasks.filter((t) => t.columnId === columnId && t.id !== taskId).map((t) => t.position)) +
                BOARD_RANK_STEP
      setState({ board: { ...prev, tasks } })
    }
    try {
      await api['tasks:move']({ projectId: id, taskId, columnId, afterId: afterId ?? null, beforeId: beforeId ?? null })
      await refreshBoard()
      // Переезд в «Готово» и обратно прячет/возвращает чат задачи в сайдбаре.
      // Не в общем try: упавший список — не повод откатывать удавшийся перенос.
      void refreshConversations({ keepActiveListed: true }).catch(() => {})
    } catch (err) {
      setState({ board: prev })
      fail(err, () => void moveTask(taskId, columnId, afterId, beforeId))
    }
  }
  async function deleteTask(taskId: string): Promise<void> {
    const id = state.activeProjectId
    if (!id) return
    try {
      await api['tasks:delete']({ projectId: id, taskId })
      await refreshBoard()
    } catch (err) {
      fail(err)
    }
  }

  async function openTaskChat(taskId: string): Promise<string | null> {
    const id = state.activeProjectId
    if (!id) return null
    try {
      const conv = await api['tasks:openChat']({ projectId: id, taskId })
      await Promise.all([refreshConversations(), refreshBoard()])
      await selectConversation(conv.id)
      return conv.id
    } catch (err) {
      fail(err)
      return null
    }
  }

  /**
   * Создать связанный чат, не переключаясь на него: карточку открыли — чат уже
   * есть. Идемпотентно на сервере, поэтому повторный вызов безопасен.
   */
  async function ensureTaskChat(taskId: string): Promise<void> {
    const id = state.activeProjectId
    if (!id) return
    try {
      await api['tasks:openChat']({ projectId: id, taskId })
      await refreshBoard()
    } catch {
      /* без чата карточка всё равно работает */
    }
  }



  return {
    getState,
    subscribe,
    actions: {
      init,
      login,
      logout,
      newConversation,
      selectConversation,
      deleteConversation,
      renameConversation,
      setConversationExecTarget,
      setSearchQuery,
      setSearchScope,
      retryMessageSearch,
      retryConversations,
      refreshAgents,
      loadMoreMessageSearch,
      focusMessage,
      clearMessageHighlight,
      setSidebarProject,
      setShowDoneTaskChats,
      exportConversation,
      completeOnboarding,
      openSettings,
      closeSettings,
      updateSettings,
      setDraft,
      submitText,
      suggestPrompts,
      applyPromptSuggestion,
      closePromptSuggestions,
      answerQuestions,
      executePlan,
      cancelRequest,
      deleteMessage,
      editMessage,
      updateTaskLaunchStatus,
      addAttachment,
      removeAttachment,
      startVoice,
      stopVoice,
      stopSpeak,
      applyMicEnergy,
      applySttPartial,
      applySttFinal,
      applySttError,
      applyClaudeToken,
      applyClaudeDone,
      applyClaudeError,
      applyClaudeActive,
      applyClaudeUsage,
      dismissError,
      notify,
      dismissNotice,
      downloadModel,
      applyDownloadProgress,
      applyDownloadDone,
      applyDownloadError,
      applyTtsAudioReceived,
      applyTtsDone,
      applyTtsError,
      replayMessage,
      downloadVoice,
      deleteVoice,
      deleteModel,
      createAgent,
      deleteAgent,
      downloadDesktopApp,
      downloadAgentApp,
      downloadAgentScript,
      getAgentConnectionString,
      applyAgents,
      setAgentPolicy,
      regenerateAgentToken,
      updateAgent,
      openMachines,
      closeMachines,
      applyClaudeLog,
      toggleConsole,
      openObserver,
      closeObserver,
      selectCcProject,
      selectCcSession,
      resumeCcSession,
      applyCcTailItems,
      openCodexObserver,
      closeCodexObserver,
      selectCxProject,
      selectCxSession,
      resumeCxSession,
      applyCxTailItems,
      openUsers,
      closeUsers,
      createUserAccount,
      setUserBlocked,
      deleteUserAccount,
      selectAdminUser,
      loadAdminUsage,
      openAdminConversation,
      refreshAdminLlmEngines,
      refreshAdminModelPrices,
      saveAdminModelPrice,
      deleteAdminModelPrice,
      createAdminLlmEngine,
      updateAdminLlmEngine,
      deleteAdminLlmEngine,
      checkAdminLlmEngineHealth,
      loadAdminUserLlmAccess,
      saveAdminUserLlmAccess,
      openUtility,
      openUtilityForActiveChat,
      closeUtility,
      fsList,
      fsRead,
      readServerFile,
      fsWrite,
      fsRemove,
      fsRename,
      fsMkdir,
      downloadFsFile,
      uploadFsFile,
      agentExec,
      pushConsoleCommand,
      applyVoiceProgress,
      applyVoiceDone,
      applyVoiceError,
      openProjects,
      closeProjects,
      refreshProjects,
      selectProject,
      createProject,
      updateProject,
      deleteProject,
      addProjectMember,
      removeProjectMember,
      linkProjectMachine,
      unlinkProjectMachine,
      setProjectMachinePath,
      setProjectReposRoot,
      setProjectDefaultMachine,
      fetchProjectDetail,
      fetchConversationMachines,
      setConversationProject,
      setConversationPreviewUrl,
      setConversationStatus,
      openBoard,
      closeBoard,
      openProjectSettings,
      closeProjectSettings,
      applyBoardUpdate,
      setBoardIncludeCompleted,
      openCi,
      closeCi,
      reloadCiCommands,
      createCiCommand,
      updateCiCommand,
      deleteCiCommand,
      ciCommandUsage,
      saveCiSettings,
      resolveCiSuggestion,
      reloadCiWorkspaces,
      startCiRun,
      startMergeRun,
      cancelCiRun,
      dequeueCiRun,
      retryCiRun,
      retryCiRunFromStep,
      discardCiWorkspaceAndRetry,
      loadCiRun,
      openCiRun,
      closeCiRun,
      ciSubscribe,
      ciUnsubscribe,
      applyCiSnapshot,
      applyCiRun,
      applyCiStep,
      applyCiLog,
      applyCiFix,
      applyCiDone,
      applyCiSummary,
      applyCiInteraction,
      applyChatMessage,
      answerCiInteraction,
      openKbUsage,
      closeKbUsage,
      loadKbUsage,
      loadProjectKbUsage,
      applyKbUsageQuery,
      refreshKbStatus,
      ensureTaskChat,
      loadTaskChatContext,
      createColumn,
      updateColumn,
      setColumnHidden,
      reorderColumns,
      deleteColumn,
      createTask,
      createTaskAndStartCi,
      updateTask,
      openTaskChat,

      moveTask,
      deleteTask,
      dispose
    }
  }
}
