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
import type { Board, ProjectDetail, ProjectSummary, TaskPriority, WorkItemType, WorkItemDefaultSkills } from '@shared/projects'

import type { FeatureRun, AgentTask, FeatureStatus } from '@shared/features'
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
  CiLogLine
} from '@shared/ci'
import type { RendererCiBridge } from '../remote/ciBridge'
import type { AgentExecResult, FsResult } from '@shared/agentProtocol'
import { detectOpenUtility, toolBlock, type ToolSpec } from '@shared/tools'
import type { ActiveTurn, ServerFileInfo, SystemCapabilities } from '@shared/protocol'
import type { McpServer } from '@shared/mcp'
import type { LoginStatusMap } from '@shared/auth'
import type { AgentCreated, AgentInfo, AgentPolicy } from '@shared/agentProtocol'
import type { AdminUserInfo, UsageReport, UsageUnit } from '@shared/admin'
import type { CcProject, CcSession, CcItem } from '@shared/cc'
import type { SessionUsage } from '@shared/types'
import type { CxProject, CxSession, CxItem } from '@shared/codexSessions'
import type {
  CatalogVoice,
  ClaudeLogEntry,
  Conversation,
  LlmProvider,
  Message,
  MessageRole,
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

/** Ключ localStorage для последнего открытого проекта-доски (для авто-редиректа). */
const LAST_PROJECT_KEY = 'vc.lastProject'
function loadLastProject(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY)
  } catch {
    return null
  }
}
function saveLastProject(id: string): void {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, id)
  } catch {
    // localStorage недоступен — молча игнорируем.
  }
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
  /** Текущий поисковый запрос по разговорам (пусто — показываем все). */
  searchQuery: string
  activeId: string | null
  messages: Message[]
  /** Идёт загрузка сообщений разговора (обновление страницы / открытие чата). */
  loadingMessages: boolean
  liveSegments: LiveSegment[]
  settings: Settings
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
  /** Открытая из меню машинная утилита (консоль/проводник) + машина; null — закрыта. */
  utility: { kind: 'console' | 'explorer'; agentId: string | null; path?: string; dir?: boolean } | null
  /** id сообщения, которое сейчас озвучивается по кнопке (ручной повтор); null — нет. */
  speakingMessageId: string | null
  /** Доступна ли озвучка (кнопка ▶ на ответах). */
  ttsAvailable: boolean
  /** Текст последней ошибки для баннера (null — нет). */
  error: string | null
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
  /** Последний открытый проект-доска (для авто-редиректа с #/projects). */
  lastProjectId: string | null
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
  featureRuns: FeatureRun[]
  activeFeature: FeatureRun | null
  agentTasks: AgentTask[]
  /** Открыта ли страница «Команды» (CI-раннер). */
  ciOpen: boolean
  /** Справочник CI-команд (страница «Команды»). */
  ciCommands: CiCommand[]
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
}

/** Кэш одного рана: снимок ленты + накопленный лог + заключение. */
export interface CiRunCache {
  detail: CiRunDetail | null
  log: CiLogLine[]
  conclusion: CiRunConclusion | null
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
  init(): Promise<void>
  /** Войти по логину/паролю (web). Успех → загрузка данных пользователя. */
  login(name: string, password: string): Promise<void>
  /** Выйти: очистить сессию и данные, показать экран логина (web). */
  logout(): Promise<void>
  newConversation(): Promise<void>
  selectConversation(id: string): Promise<void>
  deleteConversation(id: string): Promise<void>
  /** Переименовать разговор (БД + список). Пустое имя игнорируется. */
  renameConversation(id: string, title: string): Promise<void>
  /** Изменить машину только одного разговора. */
  setConversationExecTarget(id: string, execTarget: string | null, workdir?: string | null, skillNames?: string[], llmProvider?: LlmProvider | null, llmModel?: string | null, permissionMode?: PermissionMode | null, kbContextMode?: KbContextMode): Promise<void>
  setConversationProject(id: string, projectId: string | null): Promise<void>
  /** Сменить статус жизненного цикла чата (дропдаун в сайдбаре). */
  setConversationStatus(id: string, status: ConversationStatus): Promise<void>
  /** Задать поисковый запрос по разговорам (пусто — весь список). */
  setSearchQuery(query: string): Promise<void>
  /** Выбрать проект в сайдбаре (null — «Без проекта»); фильтрует список/поиск чатов. */
  setSidebarProject(projectId: string | null): Promise<void>
  /** Экспортировать активный разговор в Markdown/JSON (скачивание файла). */
  exportConversation(format: 'md' | 'json'): void
  /** Завершить (или пропустить) приветственный мастер. */
  completeOnboarding(): Promise<void>
  openSettings(): void
  closeSettings(): void
  updateSettings(patch: Partial<Settings>): Promise<void>
  setDraft(value: string): void
  submitText(): Promise<void>
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
  resumeCcSession(slug: string, id: string): Promise<void>
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
  resumeCxSession(id: string): Promise<void>
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
  loadAdminUsage(unit: UsageUnit, from?: number, to?: number): Promise<void>
  /** Открыть разговор пользователя в админ-просмотре истории. */
  openAdminConversation(conversationId: string): Promise<void>
  // --- Машинные утилиты (консоль/проводник) ---
  /** Открыть утилиту из меню (машина по умолчанию — первая онлайн-своя). */
  openUtility(kind: 'console' | 'explorer', agentId?: string | null, path?: string): void
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
  /** Выполнить команду на машине (консоль). */
  agentExec(agentId: string, command: string): Promise<AgentExecResult>
  // --- Проекты + канбан ---
  /** Открыть режим «Проекты» (грузит список). */
  openProjects(): Promise<void>
  /** Закрыть режим «Проекты». */
  closeProjects(): void
  /** Перечитать список проектов. */
  refreshProjects(): Promise<void>
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
  }): Promise<ProjectDetail | null>
  /** Обновить поля проекта (только владелец). */
  updateProject(
    id: string,
    fields: {
      name?: string
      description?: string
      gitUrl?: string | null
      technologies?: string[]
      skills?: string[]
      defaultSkills?: Partial<WorkItemDefaultSkills>
    commitPolicy?: 'agent_commits' | 'final_system_commit' | 'manual_user_confirmation'

    mergeTransport?: 'local' | 'github_pull_request'
    agentPlanApprovalMode?: 'manual' | 'automatic'
    testCommand?: string
    productionDeployCommand?: string
    ciBaseBranch?: string
    ciBranchTemplate?: string
    ciReuseStrategy?: 'reuse' | 'clean' | 'fail'
    ciExecAuthRef?: string
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
  setProjectFeatureReposRoot(id: string, agentId: string, featureReposRoot: string): Promise<void>
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
  updateTask(
    taskId: string,
    fields: { title?: string; description?: string; acceptanceCriteria?: string; type?: WorkItemType; parentId?: string | null; priority?: TaskPriority; assignee?: string | null; labels?: string[]; skills?: string[]; storyPoints?: number | null; dueDate?: number | null; flagged?: boolean }
  ): Promise<void>

  /** Переместить задачу (смена статуса = смена колонки); оптимистично. */
  moveTask(taskId: string, columnId: string, afterId?: string | null, beforeId?: string | null): Promise<void>
  deleteTask(taskId: string): Promise<void>
  /** Открыть (создав при необходимости) связанный с задачей чат и переключиться на него. */
  openTaskChat(taskId: string): Promise<void>

  startFeature(taskId: string, automation?: { autoMerge?: boolean; autoDeployProduction?: boolean }): Promise<void>
  startFeatureFromStory(storyId: string, automation?: { autoMerge?: boolean; autoDeployProduction?: boolean }): Promise<void>
  openFeature(featureId: string): Promise<void>
  closeFeature(): void
  transitionFeature(status: FeatureStatus): Promise<void>
  setFeatureAutomation(fields: { autoMerge?: boolean; autoDeployProduction?: boolean }): Promise<void>
  deployFeature(): Promise<void>
  createAgentTask(input: { title: string; description?: string; kind?: AgentTask['kind'] }): Promise<void>
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
  startCiRun(projectId: string, taskId: string): Promise<CiRun | null>
  cancelCiRun(runId: string): Promise<void>
  retryCiRun(runId: string): Promise<CiRun | null>
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
    searchQuery: '',
    activeId: null,
    messages: [],
    loadingMessages: false,
    liveSegments: [],
    settings: { ...DEFAULT_SETTINGS },
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
    adminSelected: null,
    adminUsage: null,
    adminConversations: [],
    adminMessages: [],
    adminConversationId: null,
    utility: null,
    speakingMessageId: null,
    ttsAvailable: false,
    error: null,
    modelPresent: true,
    downloading: false,
    downloadPercent: 0,
    projectsOpen: false,
    projects: [],
    sidebarProjectId: loadSidebarProject(),
    lastProjectId: loadLastProject(),
    projectDetail: null,
    activeProjectId: null,
    projectSettingsOpen: false,
    board: null,
    boardLoading: false,
    featureRuns: [],
    activeFeature: null,
    agentTasks: [],
    ciOpen: false,
    ciCommands: [],
    ciSettings: null,
    ciSuggestions: [],
    ciWorkspaces: [],
    ciRuns: {},
    ciSummaries: {},
    ciActiveRunId: null
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

  async function refreshConversations(): Promise<void> {
    const q = state.searchQuery.trim()
    const all = q
      ? await api['conversations:search']({ query: q })
      : await api['conversations:list']()
    // Список/поиск сужаем до выбранного в сайдбаре проекта (null — чаты без проекта).
    const pid = state.sidebarProjectId
    const conversations = all.filter((c) => (c.projectId ?? null) === pid)
    setState({ conversations })
  }

  async function setSearchQuery(query: string): Promise<void> {
    setState({ searchQuery: query })
    await refreshConversations()
  }

  async function setSidebarProject(projectId: string | null): Promise<void> {
    saveSidebarProject(projectId)
    setState({ sidebarProjectId: projectId })
    await refreshConversations()
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

  /** Создаёт разговор, если активного нет; заголовок — из первой реплики. */
  async function ensureConversation(titleSeed: string): Promise<string | null> {
    if (state.activeId) {
      const current = state.conversations.find((c) => c.id === state.activeId)
      if (current && current.messageCount === 0 && current.title === 'Новый разговор') {
        await api['conversations:rename']({ id: current.id, title: titleFromText(titleSeed) })
        await refreshConversations()
      }
      return state.activeId
    }
    const created = await api['conversations:create']({ title: titleFromText(titleSeed) })
    const conv = state.sidebarProjectId
      ? await api['conversations:setProject']({ id: created.id, projectId: state.sidebarProjectId })
      : created
    setState({ activeId: conv.id, messages: [] })
    await refreshConversations()
    return conv.id
  }

  /** Персист сообщения в БД и добавление в ленту. */
  async function persistMessage(
    role: MessageRole,
    text: string,
    engine?: LlmProvider,
    meta?: TurnMeta,
    execTarget?: string | null
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
      ...(execTarget !== undefined ? { execTarget } : {})
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

  async function init(): Promise<void> {
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
    setState({ loadingMessages: true }) // обновление страницы: лоадер до готовности ленты
    const [settings, conversations, projects] = await Promise.all([
      api['settings:get'](),
      api['conversations:list'](),
      api['projects:list']()
    ])
    // Сайдбар сразу фильтруем по восстановленному из localStorage проекту.
    const pid = state.sidebarProjectId
    const visible = conversations.filter((c) => (c.projectId ?? null) === pid)
    setState({ settings, projects, conversations: visible })
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
    if (visible.length > 0) {
      await selectConversation(visible[0].id)
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
    try {
      setState({ agents: await api['agents:list']() })
    } catch (err) {
      console.warn('[agents] не удалось получить список машин', err)
    }
  }

  /** Создаёт машину-агента; вернёт null при ошибке (баннер уже показан). */
  async function createAgent(name: string): Promise<AgentCreated | null> {
    try {
      const created = await api['agents:create']({ name })
      await refreshAgents()
      return created
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) })
      return null
    }
  }

  /** Удаляет машину-агента; сбрасывает цель выполнения, если она указывала на неё. */
  async function deleteAgent(id: string): Promise<void> {
    await api['agents:delete']({ id })
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
      setState({ error: err instanceof Error ? err.message : String(err) })
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
      setState({ error: err instanceof Error ? err.message : String(err) })
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
      setState({ error: err instanceof Error ? err.message : String(err) })
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
      setState({ error: err instanceof Error ? err.message : String(err) })
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
  async function resumeCcSession(slug: string, id: string): Promise<void> {
    if (!api['cc:resume']) return
    try {
      const { conversation, messages } = await api['cc:resume']({ slug, id })
      deps.ccTailStop?.()
      setState({
        activeId: conversation.id,
        messages,
        ccOpen: false,
        ccProjectSlug: null,
        ccSessionId: null,
        ccSessions: [],
        ccTranscript: [],
        ccUsage: null
      })
      await refreshConversations()
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) })
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
  async function resumeCxSession(id: string): Promise<void> {
    if (!api['cx:resume']) return
    try {
      const { conversation, messages } = await api['cx:resume']({ id })
      deps.cxTailStop?.()
      setState({
        activeId: conversation.id,
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
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) })
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
    setState({ adminUsers: await api['admin:users']() })
  }

  async function openUsers(): Promise<void> {
    setState({ usersOpen: true })
    try {
      await refreshAdminUsers()
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) })
    }
  }

  function closeUsers(): void {
    setState({
      usersOpen: false,
      adminSelected: null,
      adminUsage: null,
      adminConversations: [],
      adminMessages: [],
      adminConversationId: null
    })
  }

  async function createUserAccount(name: string, password: string, role: 'admin' | 'user'): Promise<void> {
    try {
      await api['admin:createUser']({ name, password, role })
      await refreshAdminUsers()
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) })
    }
  }

  async function setUserBlocked(name: string, blocked: boolean): Promise<void> {
    try {
      await api['admin:setBlocked']({ name, blocked })
      await refreshAdminUsers()
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) })
    }
  }

  async function deleteUserAccount(name: string): Promise<void> {
    try {
      await api['admin:deleteUser']({ name })
      if (state.adminSelected === name) closeUsers()
      await refreshAdminUsers()
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) })
    }
  }

  async function selectAdminUser(name: string): Promise<void> {
    setState({
      adminSelected: name,
      adminUsage: null,
      adminConversations: [],
      adminMessages: [],
      adminConversationId: null
    })
    try {
      const [usage, conversations] = await Promise.all([
        api['admin:usage']({ name, unit: 'day' }),
        api['admin:conversations']({ name })
      ])
      setState({ adminUsage: usage, adminConversations: conversations })
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) })
    }
  }

  async function loadAdminUsage(unit: UsageUnit, from?: number, to?: number): Promise<void> {
    const name = state.adminSelected
    if (!name) return
    try {
      setState({ adminUsage: await api['admin:usage']({ name, unit, from, to }) })
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) })
    }
  }

  async function openAdminConversation(conversationId: string): Promise<void> {
    const name = state.adminSelected
    if (!name) return
    setState({ adminConversationId: conversationId, adminMessages: [] })
    try {
      setState({ adminMessages: await api['admin:messages']({ name, conversationId }) })
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) })
    }
  }

  // --- Машинные утилиты (консоль/проводник) -------------------------------

  /** Машина утилиты: сначала цель активного чата, затем первая онлайн. */
  function defaultUtilityAgent(): string | null {
    const target = state.agents.find((a) => a.id === activeConversationExecTarget() && a.online)
    if (target) return target.id
    return state.agents.find((a) => a.online)?.id ?? state.agents[0]?.id ?? null
  }

  function openUtility(kind: 'console' | 'explorer', agentId?: string | null, path?: string): void {
    setState({ utility: { kind, agentId: agentId ?? defaultUtilityAgent(), ...(path ? { path } : {}) } })
  }

  // Открыть проводник/консоль на ЭФФЕКТИВНОЙ машине и папке активного чата
  // (для чата с проектом эти значения уже проектные; иначе — из настроек чата).
  function openUtilityForActiveChat(kind: 'console' | 'explorer'): void {
    const path = activeConversationWorkdir()
    setState({
      utility: {
        kind,
        agentId: defaultUtilityAgent(),
        ...(path ? { path } : {}),
        ...(path && kind === 'explorer' ? { dir: true } : {})
      }
    })
  }
  function closeUtility(): void {
    setState({ utility: null })
  }

  const noFs = (): never => {
    throw new Error('Файловые операции недоступны')
  }
  const fsList = (agentId: string, path: string): Promise<FsResult> =>
    deps.fs ? deps.fs.list(agentId, path) : noFs()
  const fsRead = (agentId: string, path: string): Promise<FsResult> =>
    deps.fs ? deps.fs.read(agentId, path) : noFs()
  /** Файл с диска сервера; null — сервер такого у себя не знает. */
  const readServerFile = (path: string): Promise<ServerFileInfo | null> =>
    deps.files ? deps.files.read(path) : Promise.resolve(null)
  const fsWrite = (agentId: string, path: string, dataBase64: string): Promise<FsResult> =>
    deps.fs ? deps.fs.write(agentId, path, dataBase64) : noFs()
  const fsRemove = (agentId: string, path: string): Promise<FsResult> =>
    deps.fs ? deps.fs.remove(agentId, path) : noFs()
  const fsRename = (agentId: string, from: string, to: string): Promise<FsResult> =>
    deps.fs ? deps.fs.rename(agentId, from, to) : noFs()
  const fsMkdir = (agentId: string, path: string): Promise<FsResult> =>
    deps.fs ? deps.fs.mkdir(agentId, path) : noFs()
  const agentExec = (agentId: string, command: string): Promise<AgentExecResult> =>
    deps.fs ? deps.fs.exec(agentId, command) : noFs()

  async function uploadFsFile(agentId: string, dir: string, file: File): Promise<FsResult> {
    if (!deps.fs) return noFs()
    const dataBase64 = await fileToBase64(file)
    const path = `${dir.replace(/\/$/, '')}/${file.name}`
    return deps.fs.write(agentId, path, dataBase64)
  }

  async function downloadFsFile(agentId: string, path: string, name: string): Promise<void> {
    if (!deps.fs) return
    const res = await deps.fs.read(agentId, path)
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

  async function newConversation(): Promise<void> {
    cancelTimers()
    stopCapture()
    resetTts() // ход текущего разговора не отменяем — он доиграет на сервере
    dispatchVoice('reset')
    const created = await api['conversations:create']({ title: 'Новый разговор' })
    // «Новый» создаёт чат сразу в выбранном проекте (сервер применит машину/папку/навыки).
    const conversation = state.sidebarProjectId
      ? await api['conversations:setProject']({ id: created.id, projectId: state.sidebarProjectId })
      : created
    setState({
      activeId: conversation.id,
      messages: [],
      liveSegments: [],
      draft: '',
      promptHelper: { open: false, loading: false, variants: [], error: null },
      attachments: [],
      consoleLog: [],
      liveActivity: [],
      voice: 'idle',
      streamingReply: '',
      lastTurnMeta: null,
      liveUsage: null
    })
    await refreshConversations()
  }

  async function selectConversation(id: string): Promise<void> {
    cancelTimers()
    stopCapture()
    resetTts() // ход прежнего разговора не отменяем — он доиграет на сервере
    setState({ liveSegments: [], consoleLog: [], liveActivity: [], voice: 'idle', streamingReply: '', lastTurnMeta: null, liveUsage: null, messages: [], loadingMessages: true })
    try {
      const res = await api['conversations:get']({ id })
      if (res) {
        setState({ activeId: res.conversation.id, messages: res.messages })
        restoreStreamIfActive() // у разговора есть недоигранный ход → показываем стрим
      }
    } finally {
      setState({ loadingMessages: false })
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
    kbContextMode?: KbContextMode
  ): Promise<void> {
    const conversation = await api['conversations:setExecTarget']({ id, execTarget, workdir, skillNames, llmProvider, llmModel, permissionMode, kbContextMode })
    setState({
      conversations: state.conversations.map((c) => (c.id === id ? conversation : c))
    })
  }

  async function deleteConversation(id: string): Promise<void> {
    try {
      await api['conversations:delete']({ id })
      const wasActive = state.activeId === id
      await refreshConversations()
      if (wasActive) {
        const next = state.conversations[0]
        if (next) await selectConversation(next.id)
        else await newConversation()
      }
    } catch (err) {
      setState({ error: perr(err) })
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

  async function submitText(): Promise<void> {
    const text = state.draft.trim()
    const atts = state.attachments
    if ((!text && atts.length === 0) || state.voice !== 'idle') return
    setState({ error: null })
    await ensureConversation(text || atts.map((a) => a.name).join(', '))
    const execTarget = activeConversationExecTarget()
    await persistMessage('u1', composeUserText(text, atts), undefined, undefined, execTarget)
    setState({ draft: '', attachments: [] })
    await refreshConversations()
    // Команда «открой консоль/проводник» → виджет прямо в ответе, без обращения к LLM.
    if (atts.length === 0 && (await maybeOpenUtility(text))) return
    if (!dispatchVoice('submit_text')) return // idle → thinking
    beginReply(
      [{ speakerId: 1, text: text || 'См. приложенные файлы.' }],
      atts.map((a) => a.id),
      execTarget
    )
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
      const info = await api['uploads:add']({ name: file.name, dataBase64 })
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
    console.warn('[claude] ошибка:', message)
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
    await ensureConversation(segments[0]?.text ?? '')
    for (const seg of segments) {
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
    if (loginStatusPoll) {
      clearInterval(loginStatusPoll)
      loginStatusPoll = null
    }
  }

  // --- Проекты + канбан ----------------------------------------------------

  const perr = (e: unknown): string => (e instanceof Error ? e.message : String(e))

  async function refreshProjects(): Promise<void> {
    setState({ projects: await api['projects:list']() })
  }
  async function openProjects(): Promise<void> {
    setState({ projectsOpen: true })
    try {
      await refreshProjects()
    } catch (err) {
      setState({ error: perr(err) })
    }
  }
  function closeProjects(): void {
    closeBoard()
    setState({ projectsOpen: false, projects: [], projectDetail: null })
  }
  async function selectProject(id: string): Promise<void> {
    try {
      setState({ projectDetail: await api['projects:get']({ id }) })
    } catch (err) {
      setState({ error: perr(err) })
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
  }): Promise<ProjectDetail | null> {
    try {
      const detail = await api['projects:create'](input)
      await refreshProjects()
      setState({ projectDetail: detail })
      return detail
    } catch (err) {
      setState({ error: perr(err) })
      return null
    }
  }
  async function updateProject(
    id: string,
    fields: {
      name?: string
      description?: string
      gitUrl?: string | null
      technologies?: string[]
      skills?: string[]
      defaultSkills?: Partial<WorkItemDefaultSkills>
    commitPolicy?: 'agent_commits' | 'final_system_commit' | 'manual_user_confirmation'

    mergeTransport?: 'local' | 'github_pull_request'
    agentPlanApprovalMode?: 'manual' | 'automatic'
    testCommand?: string
    productionDeployCommand?: string
    ciBaseBranch?: string
    ciBranchTemplate?: string
    ciReuseStrategy?: 'reuse' | 'clean' | 'fail'
    ciExecAuthRef?: string
    }
  ): Promise<void> {
    try {
      const detail = await api['projects:update']({ id, ...fields })
      setState({ projectDetail: detail })
      await refreshProjects()
    } catch (err) {
      setState({ error: perr(err) })
    }
  }
  async function deleteProject(id: string): Promise<void> {
    try {
      await api['projects:delete']({ id })
      if (state.activeProjectId === id) closeBoard()
      if (state.projectDetail?.id === id) setState({ projectDetail: null })
      await refreshProjects()
    } catch (err) {
      setState({ error: perr(err) })
    }
  }
  async function addProjectMember(id: string, username: string): Promise<void> {
    try {
      setState({ projectDetail: await api['projects:addMember']({ id, username }) })
      await refreshProjects()
    } catch (err) {
      setState({ error: perr(err) })
    }
  }
  async function removeProjectMember(id: string, username: string): Promise<void> {
    try {
      setState({ projectDetail: await api['projects:removeMember']({ id, username }) })
      if (state.activeProjectId === id) await refreshBoard()
    } catch (err) {
      setState({ error: perr(err) })
    }
  }
  async function linkProjectMachine(id: string, agentId: string): Promise<void> {
    try {
      setState({ projectDetail: await api['projects:linkMachine']({ id, agentId }) })
    } catch (err) {
      setState({ error: perr(err) })
    }
  }
  async function unlinkProjectMachine(id: string, agentId: string): Promise<void> {
    try {
      setState({ projectDetail: await api['projects:unlinkMachine']({ id, agentId }) })
    } catch (err) {
      setState({ error: perr(err) })
    }
  }
  async function setProjectMachinePath(id: string, agentId: string, path: string): Promise<void> {
    try {
      setState({ projectDetail: await api['projects:setMachinePath']({ id, agentId, path }) })
    } catch (err) {
      setState({ error: perr(err) })
    }
  }
  async function setProjectFeatureReposRoot(id: string, agentId: string, featureReposRoot: string): Promise<void> {
    try {
      setState({ projectDetail: await api['projects:setFeatureReposRoot']({ id, agentId, featureReposRoot }) })
    } catch (err) {
      setState({ error: perr(err) })
    }
  }
  async function setProjectDefaultMachine(id: string, agentId: string): Promise<void> {
    try {
      setState({ projectDetail: await api['projects:setDefaultMachine']({ id, agentId }) })
    } catch (err) {
      setState({ error: perr(err) })
    }
  }
  /** Загрузить детали проекта без записи в стор (для настроек чата). */
  async function fetchProjectDetail(id: string): Promise<ProjectDetail | null> {
    try {
      return await api['projects:get']({ id })
    } catch (err) {
      setState({ error: perr(err) })
      return null
    }
  }
  /** Привязать/отвязать чат к проекту; сервер перезаписывает машину/папку/навыки. */
  async function setConversationProject(id: string, projectId: string | null): Promise<void> {
    const conversation = await api['conversations:setProject']({ id, projectId })
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
    setState({ board: await api['board:get']({ id }) })
  }
  async function openBoard(id: string): Promise<void> {
    saveLastProject(id)
    setState({ activeProjectId: id, boardLoading: true, board: null, projectSettingsOpen: false, lastProjectId: id })
    try {
      const [board, detail, featureRuns] = await Promise.all([api['board:get']({ id }), api['projects:get']({ id }), api['features:list']({ projectId: id })])
      const ciSummaries = { ...state.ciSummaries }
      for (const r of board.ciRuns ?? []) ciSummaries[r.taskId] = r
      setState({ board, projectDetail: detail, featureRuns, ciSummaries, boardLoading: false })
      boardBridge?.subscribe(id)
    } catch (err) {
      setState({ boardLoading: false, error: perr(err) })
    }
  }
  function closeBoard(): void {
    if (state.activeProjectId) boardBridge?.unsubscribe()
    setState({ activeProjectId: null, projectSettingsOpen: false, board: null, boardLoading: false, featureRuns: [], activeFeature: null, agentTasks: [] })
  }
  function openProjectSettings(): void {
    setState({ projectSettingsOpen: true })
  }
  function closeProjectSettings(): void {
    setState({ projectSettingsOpen: false })
  }
  function applyBoardUpdate(projectId: string, board: Board): void {
    if (projectId !== state.activeProjectId) return
    const summaries = board.features ?? []
    const featureRuns = state.featureRuns.map((feature) => {
      const summary = summaries.find((item) => item.id === feature.id)
      return summary ? { ...feature, status: summary.status, deployStatus: summary.deployStatus } : feature
    })
    const activeSummary = state.activeFeature ? summaries.find((item) => item.id === state.activeFeature!.id) : undefined
    const ciSummaries = { ...state.ciSummaries }
    for (const r of board.ciRuns ?? []) ciSummaries[r.taskId] = r
    setState({ board, featureRuns, ciSummaries, activeFeature: activeSummary && state.activeFeature ? { ...state.activeFeature, status: activeSummary.status, deployStatus: activeSummary.deployStatus } : state.activeFeature })
  }

  // --- CI-раннер ---------------------------------------------------------

  function patchCiRun(runId: string, fn: (cache: CiRunCache) => CiRunCache): void {
    const prev = state.ciRuns[runId] ?? { detail: null, log: [], conclusion: null }
    setState({ ciRuns: { ...state.ciRuns, [runId]: fn(prev) } })
  }
  function mergeStep(detail: CiRunDetail | null, step: CiRunStep): CiRunDetail | null {
    if (!detail) return { run: { id: step.runId } as CiRun, steps: [step], fixAttempts: [] }
    const steps = detail.steps.some((x) => x.id === step.id)
      ? detail.steps.map((x) => (x.id === step.id ? step : x))
      : [...detail.steps, step]
    return { ...detail, steps }
  }

  async function openCi(): Promise<void> {
    setState({ ciOpen: true })
    if (!ciBridge) return
    try {
      const [commands, settings, suggestions, workspaces] = await Promise.all([
        ciBridge.listCommands(),
        ciBridge.getSettings(),
        ciBridge.listSuggestions(),
        ciBridge.listWorkspaces()
      ])
      setState({ ciCommands: commands, ciSettings: settings, ciSuggestions: suggestions, ciWorkspaces: workspaces })
    } catch (err) {
      setState({ error: perr(err) })
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
      setState({ error: perr(err) })
      return null
    }
  }
  async function updateCiCommand(id: string, input: CiCommandInput): Promise<void> {
    if (!ciBridge) return
    try {
      const cmd = await ciBridge.updateCommand(id, input)
      setState({ ciCommands: state.ciCommands.map((c) => (c.id === id ? cmd : c)) })
    } catch (err) {
      setState({ error: perr(err) })
    }
  }
  async function deleteCiCommand(id: string): Promise<void> {
    if (!ciBridge) return
    try {
      await ciBridge.deleteCommand(id)
      setState({ ciCommands: state.ciCommands.filter((c) => c.id !== id) })
    } catch (err) {
      setState({ error: perr(err) })
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
      setState({ error: perr(err) })
    }
  }
  async function resolveCiSuggestion(id: string, accept: boolean): Promise<void> {
    if (!ciBridge) return
    try {
      await ciBridge.resolveSuggestion(id, accept)
      setState({ ciSuggestions: state.ciSuggestions.filter((x) => x.id !== id) })
      if (accept) await reloadCiCommands()
    } catch (err) {
      setState({ error: perr(err) })
    }
  }
  async function reloadCiWorkspaces(projectId?: string): Promise<void> {
    if (!ciBridge) return
    setState({ ciWorkspaces: await ciBridge.listWorkspaces(projectId) })
  }
  async function startCiRun(projectId: string, taskId: string): Promise<CiRun | null> {
    if (!ciBridge) return null
    try {
      const run = await ciBridge.startRun(projectId, taskId)
      setState({ ciSummaries: { ...state.ciSummaries, [taskId]: { id: run.id, taskId, status: run.status, slotProgress: run.slotProgress, durationMs: run.durationMs, modelActive: false } } })
      patchCiRun(run.id, (c) => ({ ...c, detail: c.detail ? { ...c.detail, run } : { run, steps: [], fixAttempts: [] } }))
      return run
    } catch (err) {
      setState({ error: perr(err) })
      return null
    }
  }
  async function cancelCiRun(runId: string): Promise<void> {
    if (!ciBridge) return
    try { await ciBridge.cancelRun(runId) } catch (err) { setState({ error: perr(err) }) }
  }
  async function retryCiRun(runId: string): Promise<CiRun | null> {
    if (!ciBridge) return null
    try { return await ciBridge.retryRun(runId) } catch (err) { setState({ error: perr(err) }); return null }
  }
  async function loadCiRun(runId: string): Promise<void> {
    if (!ciBridge) return
    try {
      const [detail, log] = await Promise.all([ciBridge.getRun(runId), ciBridge.getRunLog(runId)])
      patchCiRun(runId, (c) => ({ ...c, detail, log }))
    } catch (err) {
      setState({ error: perr(err) })
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
    patchCiRun(runId, (c) => ({ ...c, detail: c.detail ? { ...c.detail, run } : { run, steps: [], fixAttempts: [] } }))
    setState({ ciSummaries: { ...state.ciSummaries, [run.taskId]: { id: run.id, taskId: run.taskId, status: run.status, slotProgress: run.slotProgress, durationMs: run.durationMs, modelActive: state.ciSummaries[run.taskId]?.modelActive ?? false } } })
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
    patchCiRun(runId, (c) => ({ ...c, conclusion: conclusion ?? c.conclusion, detail: c.detail ? { ...c.detail, run } : { run, steps: [], fixAttempts: [] } }))
    setState({ ciSummaries: { ...state.ciSummaries, [run.taskId]: { id: run.id, taskId: run.taskId, status: run.status, slotProgress: run.slotProgress, durationMs: run.durationMs, modelActive: false } } })
  }
  function applyCiSummary(_projectId: string, summary: CiRunSummary): void {
    setState({ ciSummaries: { ...state.ciSummaries, [summary.taskId]: summary } })
  }

  async function createColumn(name: string): Promise<void> {
    const id = state.activeProjectId
    if (!id) return
    try {
      await api['columns:create']({ projectId: id, name })
      await refreshBoard()
    } catch (err) {
      setState({ error: perr(err) })
    }
  }
  async function updateColumn(columnId: string, fields: { name?: string; wipLimit?: number | null }): Promise<void> {
    const id = state.activeProjectId
    if (!id) return
    try {
      await api['columns:rename']({ projectId: id, columnId, ...fields })
      await refreshBoard()
    } catch (err) {
      setState({ error: perr(err) })
    }
  }
  async function setColumnHidden(columnId: string, hidden: boolean): Promise<void> {
    const id = state.activeProjectId
    if (!id) return
    try {
      await api['columns:setHidden']({ projectId: id, columnId, hidden })
      await refreshBoard()
    } catch (err) {
      setState({ error: perr(err) })
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
      setState({ board: prev, error: perr(err) })
    }
  }
  async function deleteColumn(columnId: string): Promise<void> {
    const id = state.activeProjectId
    if (!id) return
    try {
      await api['columns:delete']({ projectId: id, columnId })
      await refreshBoard()
    } catch (err) {
      setState({ error: perr(err) })
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
      setState({ error: perr(err) })
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
      setState({ error: perr(err) })
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
    } catch (err) {
      setState({ board: prev, error: perr(err) })
    }
  }
  async function deleteTask(taskId: string): Promise<void> {
    const id = state.activeProjectId
    if (!id) return
    try {
      await api['tasks:delete']({ projectId: id, taskId })
      await refreshBoard()
    } catch (err) {
      setState({ error: perr(err) })
    }
  }

  async function openTaskChat(taskId: string): Promise<void> {
    const id = state.activeProjectId
    if (!id) return
    try {
      const conv = await api['tasks:openChat']({ projectId: id, taskId })
      await Promise.all([refreshConversations(), refreshBoard()])
      await selectConversation(conv.id)
    } catch (err) {
      setState({ error: perr(err) })
    }
  }


  async function refreshFeatures(): Promise<void> {
    if (state.activeProjectId) setState({ featureRuns: await api['features:list']({ projectId: state.activeProjectId }) })
  }

  async function startFeature(taskId: string, automation: { autoMerge?: boolean; autoDeployProduction?: boolean } = {}): Promise<void> {
    if (!state.activeProjectId) return
    try {
      const feature = await api['features:createFromTask']({ projectId: state.activeProjectId, taskId, ...automation })
      setState({ activeFeature: feature, agentTasks: [] })
      await Promise.all([refreshBoard(), refreshFeatures(), refreshConversations()])
      if (feature.conversationId) await selectConversation(feature.conversationId)
    } catch (err) { setState({ error: perr(err) }) }
  }
  async function startFeatureFromStory(storyId: string, automation: { autoMerge?: boolean; autoDeployProduction?: boolean } = {}): Promise<void> {
    if (!state.activeProjectId) return
    try {
      const feature = await api['features:createFromStory']({ projectId: state.activeProjectId, storyId, ...automation })
      setState({ activeFeature: feature, agentTasks: [] })
      await Promise.all([refreshBoard(), refreshFeatures(), refreshConversations()])
      if (feature.conversationId) await selectConversation(feature.conversationId)
    } catch (err) { setState({ error: perr(err) }) }
  }
  async function openFeature(featureId: string): Promise<void> {
    try {
      const feature = await api['features:get']({ id: featureId })
      if (!feature) return
      setState({ activeFeature: feature, agentTasks: await api['agentTasks:list']({ featureId }) })
      if (feature.conversationId) await selectConversation(feature.conversationId)
    } catch (err) { setState({ error: perr(err) }) }
  }
  function closeFeature(): void { setState({ activeFeature: null, agentTasks: [] }) }
  async function transitionFeature(status: FeatureStatus): Promise<void> {
    if (!state.activeFeature) return
    try {
      const feature = await api['features:transition']({ id: state.activeFeature.id, status, expectedVersion: state.activeFeature.version })
      setState({ activeFeature: feature })
      await Promise.all([refreshBoard(), refreshFeatures()])
    } catch (err) { setState({ error: perr(err) }) }
  }
  async function setFeatureAutomation(fields: { autoMerge?: boolean; autoDeployProduction?: boolean }): Promise<void> {
    const current = state.activeFeature ?? state.featureRuns.find((f) => f.conversationId === state.activeId)
    if (!current) return
    try {
      const updated = await api['features:setAutomation']({ id: current.id, ...fields })
      setState({ activeFeature: state.activeFeature?.id === updated.id ? updated : state.activeFeature, featureRuns: state.featureRuns.map((f) => f.id === updated.id ? updated : f) })
    } catch (err) { setState({ error: perr(err) }) }
  }
  async function deployFeature(): Promise<void> {
    if (!state.activeFeature) return
    try { setState({ activeFeature: await api['features:deploy']({ id: state.activeFeature.id }) }) }
    catch (err) { setState({ error: perr(err) }) }
  }
  async function createAgentTask(input: { title: string; description?: string; kind?: AgentTask['kind'] }): Promise<void> {
    if (!state.activeFeature) return
    try {
      await api['agentTasks:create']({ featureId: state.activeFeature.id, ...input })
      setState({ agentTasks: await api['agentTasks:list']({ featureId: state.activeFeature.id }) })
    } catch (err) { setState({ error: perr(err) }) }
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
      setSidebarProject,
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
      setProjectFeatureReposRoot,
      setProjectDefaultMachine,
      fetchProjectDetail,
      setConversationProject,
      setConversationStatus,
      openBoard,
      closeBoard,
      openProjectSettings,
      closeProjectSettings,
      applyBoardUpdate,
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
      cancelCiRun,
      retryCiRun,
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
      createColumn,
      updateColumn,
      setColumnHidden,
      reorderColumns,
      deleteColumn,
      createTask,
      updateTask,
      openTaskChat,

      moveTask,
      deleteTask,
      startFeature,
      startFeatureFromStory,
      openFeature,
      closeFeature,
      transitionFeature,
      setFeatureAutomation,
      deployFeature,
      createAgentTask,
      dispose
    }
  }
}
