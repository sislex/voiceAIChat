// Общие типы, разделяемые между main, preload и renderer.

import type { PreviewElementPayload } from './previewInspector'

/** Состояния голосового пайплайна. */
export type VoiceState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

/** Роль автора сообщения. `u1`/`u2`/… — спикеры пользователя, `ai` — Claude. */
export type MessageRole = `u${number}` | 'ai'

/** Явный запрос ассистента на выбор способа начать разработку. */
export interface TaskLaunchRequest {
  title: string
  description: string
  acceptanceCriteria: string
}

/** Одно предложение в списке задач, сохранённом вместе с ответом ассистента. */
export interface TaskLaunchProposal extends TaskLaunchRequest {
  id: string
  status?: 'opened' | 'created' | 'declined'
  taskId?: string
  result?: TaskLaunchResult
}

/** Исход серверной обработки предложения; legacy in_progress остаётся читаемым. */
export type TaskLaunchResult =
  | { type: 'in_progress'; taskId: string }
  | { type: 'preparation'; status: 'success'; taskId: string; runId: string }
  | { type: 'preparation'; status: 'partial'; taskId: string; runId?: string; error: string; canRetry: true }

/** Сообщение в ленте чата. */
/** Компактная ссылка на файл чата. Байты никогда не попадают в SQLite. */
export interface MessageAttachment {
  /** Непрозрачный id UploadStore, если файл был загружен через чат. */
  uploadId?: string
  /** Фактический абсолютный путь файла на машине или сервере. */
  path: string
  name: string
  mimeType: string
  size: number
  /** Машина-источник; отсутствие означает сервер. */
  agentId?: string
  caption?: string
  /** Параметры локальной ретуши результата; позволяют восстановить выделение из истории. */
  retouch?: import('./imageRetouch').ImageRetouchRecord
}

export interface Message {
  id: string
  conversationId: string
  role: MessageRole
  text: string
  /** Локальное время в формате HH:MM для отображения. */
  time: string
  /** UNIX-время создания (мс) для сортировки/персиста. */
  createdAt: number
  /**
   * Движок, сгенерировавший ответ (только для роли 'ai'). Запекается в момент
   * ответа, чтобы подпись не менялась при смене движка в настройках.
   * Отсутствует у старых сообщений и у реплик пользователя.
   */
  engine?: LlmProvider
  /**
   * Метаданные хода (токены/тайминги/детали запроса) — только для ответов 'ai'.
   * Отсутствует у реплик пользователя и у ответов, сохранённых до этой фичи.
   */
  meta?: TurnMeta
  /** Снимок цели выполнения для этой реплики: id машины, null — сервер, 'none' — без выполнения. */
  execTarget?: string | null
  /** Метаданные файлов, приложенных к этой реплике; без байтов. */
  attachments?: MessageAttachment[]
}

/** Сегмент распознанной речи после диаризации. */
export interface Segment {
  speakerId: number
  text: string
  /** Таймкоды в секундах относительно начала записи. */
  start?: number
  end?: number
}

/** Спикер внутри разговора (стабильный id). */
export interface Speaker {
  id: number
  label: string
}

/** Разговор в сайдбаре. */
export type KbContextMode = 'auto' | 'manual' | 'off'

/** Статус жизненного цикла чата (бейдж в сайдбаре). */
export type ConversationStatus =
  | 'planned'          // планируется
  | 'developing'       // разрабатывается
  | 'planning_done'    // планирование закончено
  | 'development_done' // разработка закончена
  | 'done'             // закончено

export const PLAYWRIGHT_READER_KIND = 'playwright-reader' as const
export const CONSOLE_READER_KIND = 'console-reader' as const
export type AssistantKind = 'web-recorder' | 'playwright-reader' | 'console-reader' | 'make' | 'kanban'

/**
 * Живой контекст PTY-сессии консоли: агент периодически сообщает, где сейчас
 * находится терминал, чтобы ассистент знал, слать shell-команды или клавиши.
 * Всё best-effort: на не-Linux/Android-агентах поля могут быть неизвестны.
 */
export interface PtyContext {
  /** Рабочий каталог shell в фокусе (из /proc/<pid>/cwd), если удалось прочитать. */
  cwd: string | null
  /** Имя процесса в фокусе терминала (shell/nano/vim/ssh/top), если определено. */
  foreground: string | null
  /** Активен ли альтернативный экран (полноэкранный TUI: nano/vim/less/top). */
  altScreen: boolean
}

export type BrowserSessionState = 'idle' | 'starting' | 'ready' | 'reconnecting' | 'stopping' | 'stopped' | 'failed'

export interface BrowserViewport {
  width: number
  height: number
  deviceScaleFactor: number
}

export interface BrowserTab {
  id: string
  url: string
  title: string
  active: boolean
}

export interface BrowserError {
  code: 'not_found' | 'forbidden' | 'not_ready' | 'stale_incarnation' | 'stale_tab' | 'stale_element_ref' | 'timeout' | 'policy_blocked' | 'confirmation_required' | 'runner_unavailable' | 'internal'
  message: string
  retryable: boolean
  details?: Record<string, string | number | boolean | null>
}

export interface BrowserSessionMetadata {
  id: string
  conversationId: string
  incarnation: string
  state: BrowserSessionState
  activeTabId: string | null
  tabs: BrowserTab[]
  viewport: BrowserViewport
  currentUrl: string | null
  title: string | null
  error?: BrowserError
}

export interface BrowserFrameMetadata {
  incarnation: string
  tabId: string
  sequence: number
  viewport: BrowserViewport
  mimeType: 'image/jpeg' | 'image/webp'
  timestamp: number
}

export type BrowserInputAction =
  | { type: 'mouseMove'; x: number; y: number }
  | { type: 'mouseDown'; x: number; y: number; button?: 'left' | 'middle' | 'right' }
  | { type: 'mouseUp'; x: number; y: number; button?: 'left' | 'middle' | 'right' }
  | { type: 'click'; x: number; y: number; button?: 'left' | 'middle' | 'right'; clickCount?: 1 | 2 }
  | { type: 'wheel'; deltaX: number; deltaY: number }
  | { type: 'type'; text: string }
  | { type: 'press'; key: string }
  | { type: 'keyDown'; key: string }
  | { type: 'keyUp'; key: string }

export type BrowserCommand =
  | { type: 'navigate'; url: string }
  | { type: 'back' | 'forward' | 'reload' | 'stop' }
  | { type: 'newTab'; url?: string }
  | { type: 'selectTab' | 'closeTab'; tabId: string }
  | { type: 'resize'; viewport: BrowserViewport }
  | { type: 'input'; action: BrowserInputAction }
  | { type: 'screenshot'; fullPage?: boolean; format?: 'png' | 'jpeg' | 'webp'; quality?: number }

export interface BrowserCommandRequest {
  requestId: string
  incarnation: string
  tabId?: string
  actor: 'user' | 'assistant'
  command: BrowserCommand
}

export function isPlaywrightReaderConversation(value: Pick<Conversation, 'assistantKind'>): boolean {
  return value.assistantKind === PLAYWRIGHT_READER_KIND
}

/** Разговор инструмента Make (веб-проект с ассистентом). */
export function isMakeConversation(value: Pick<Conversation, 'assistantKind'>): boolean {
  return value.assistantKind === 'make'
}
export function isConsoleReaderConversation(value: Pick<Conversation, 'assistantKind'>): boolean {
  return value.assistantKind === CONSOLE_READER_KIND
}

/** Детерминированный ptyId сессии консоли разговора: и UI, и MCP-инструменты
 *  ассистента адресуют один и тот же живой терминал без отдельной регистрации. */
export function consolePtyId(conversationId: string): string {
  return `console:${conversationId}`
}

export function shouldApplyBrowserFrame(current: Pick<BrowserSessionMetadata, 'incarnation' | 'activeTabId'>, lastSequence: number, frame: BrowserFrameMetadata): boolean {
  return frame.incarnation === current.incarnation && frame.tabId === current.activeTabId && frame.sequence > lastSequence
}

export function scaleBrowserCoordinates(x: number, y: number, renderedWidth: number, renderedHeight: number, viewport: BrowserViewport): { x: number; y: number } {
  if (renderedWidth <= 0 || renderedHeight <= 0) return { x: 0, y: 0 }
  return {
    x: Math.max(0, Math.min(viewport.width, x * viewport.width / renderedWidth)),
    y: Math.max(0, Math.min(viewport.height, y * viewport.height / renderedHeight))
  }
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  /** session-id Claude CLI, привязанный к разговору (null до первого ответа). */
  claudeSessionId: string | null
  /** Изменяемая цель новых ходов только этого чата. */
  execTarget: string | null
  /** Корневая директория для команд на выбранной машине. */
  workdir: string | null
  /** Фактический managed Git workspace; legacy workdir сам по себе его не определяет. */
  workspace?: import('./projects').WorkspaceView | null
  /** Имена навыков выбранной машины, включённых для этого разговора. */
  skillNames: string[]
  /** Исполнитель только этого разговора; null — из общих настроек пользователя. */
  llmEngineId?: string | null
  /** Движок только этого разговора; null — из общих настроек пользователя. */
  llmProvider: LlmProvider | null
  /**
   * Модель только этого разговора (алиас claude / id codex, '' — модель по
   * умолчанию codex). Действует лишь вместе с llmProvider; null — из настроек.
   */
  llmModel: string | null
  /** Режим прав агента только этого разговора; null — из общих настроек. */
  permissionMode: PermissionMode | null
  /** Использование базы знаний только в этом разговоре. */
  kbContextMode?: KbContextMode
  /** id пунктов контекста, выключенных пользователем в инспекторе: не попадают ассистенту. */
  disabledContext?: string[]
  /** Проект, к которому привязан чат (null/undefined — не привязан). */
  projectId?: string | null
  /** Служебный приватный чат виджета; его строковое имя становится лейблом источника в селекторах. */
  assistantKind?: AssistantKind | null
  /** URL веб-превью только этого разговора; null — наследовать у проекта. */
  previewUrl?: string | null
  /** URL проекта для превью; сервер отдаёт рядом, чтобы чат не зависел от загрузки списка проектов. */
  projectPreviewUrl?: string | null
  /** Задача, с которой связан чат (кнопка «Чат» на карточке); null — не связан. */
  taskId?: string | null

  /** Статус жизненного цикла чата; дефолт 'developing'. */
  status?: ConversationStatus
  /** Неизменяемая цель последнего сообщения; используется подписью в списке чатов. */
  lastExecTarget: string | null
}

/** Найденное сообщение: карточка результата полнотекстового поиска. */
export interface MessageSearchHit {
  messageId: string
  conversationId: string
  /** Заголовок беседы — карточка результата показывает его вместо id. */
  conversationTitle: string
  /** Проект беседы (null — беседа без проекта). */
  projectId: string | null
  role: MessageRole
  createdAt: number
  /** Локальное время сообщения (HH:MM) — как в ленте чата. */
  time: string
  /**
   * Фрагмент текста вокруг совпадений: совпавшие слова обёрнуты в
   * `<mark>…</mark>`. Это **не HTML для вставки** — текст сообщения произволен,
   * поэтому клиент разбирает разметку сам (`splitSnippet` в UI).
   */
  snippet: string
  /** Оценка bm25: меньше — релевантнее (используется курсором пагинации). */
  score: number
}

/** Страница результатов поиска по сообщениям. */
export interface MessageSearchResult {
  hits: MessageSearchHit[]
  /** Курсор следующей страницы; null — результаты закончились. */
  nextCursor: string | null
  /**
   * Запрос, ушедший в FTS5 после экранирования. Пустая строка — искать было
   * нечего (только спецсимволы или пробелы), результат заведомо пустой.
   */
  match: string
}

/**
 * Алиас модели Claude. В `claude --model` уходит именно алиас — конкретную
 * версию («latest») резолвит сам CLI, поэтому версии тут не фиксируем.
 * `default` — тот же пункт, что «Default (recommended)» в самом CLI: модель
 * выбирает Claude Code. `opus[1m]` — суффикс окна 1M, который CLI понимает
 * наравне с голым алиасом.
 */
export type ClaudeModel = 'default' | 'opus[1m]' | 'fable' | 'sonnet' | 'haiku'

/** Модель Claude для меню настроек. */
export interface ClaudeModelInfo {
  id: ClaudeModel
  /** Подпись в меню (как в списке моделей самого CLI). */
  label: string
  /** Что за этим пунктом стоит — подсказка на наведение; у Default её нет. */
  hint?: string
}

/**
 * Актуальные модели Claude (порядок = порядок в меню `claude`). Подписи
 * отражают версию, которую CLI сейчас резолвит для алиаса; при обновлении CLI
 * меняется только резолв — правим подсказку здесь.
 */
export const CLAUDE_MODELS: ClaudeModelInfo[] = [
  { id: 'default', label: 'Default (recommended)' },
  { id: 'opus[1m]', label: 'Opus (1M context)', hint: 'Opus 5 with 1M context' },
  { id: 'fable', label: 'Fable', hint: 'Fable 5' },
  { id: 'sonnet', label: 'Sonnet', hint: 'Sonnet 5' },
  { id: 'haiku', label: 'Haiku', hint: 'Haiku 4.5' }
]

/**
 * Приводит значение модели из настроек/БД к валидному пункту меню. Терпит
 * старые значения (`opus`, `sonnet-4.5`, `claude-haiku-4-5`) — берёт пункт по
 * префиксу алиаса; неизвестное → `default`. Голый `opus` из прежних настроек
 * ведёт на единственный оставшийся пункт Opus — с окном 1M.
 */
export function normalizeClaudeModel(raw: string): ClaudeModel {
  const exact = CLAUDE_MODELS.find((m) => m.id === raw)
  if (exact) return exact.id
  const alias = raw.replace(/^claude-/, '')
  if (alias.startsWith('opus')) return 'opus[1m]'
  if (alias.startsWith('fable')) return 'fable'
  if (alias.startsWith('sonnet')) return 'sonnet'
  if (alias.startsWith('haiku')) return 'haiku'
  return 'default'
}

/** Роль пользователя приложения (многопользовательский режим web-версии). */
export type UserRole = 'admin' | 'developer' | 'tester' | 'observer'

/** Аутентифицированный пользователь сессии. */
export interface SessionUser {
  /** Логин (он же идентификатор владельца данных). */
  name: string
  role: UserRole
  /** Временный пароль — до смены доступна только смена пароля (auth-roadmap п.11). */
  mustChangePassword?: boolean
}

/** Сессия пользователя (auth-roadmap п.4): устройство, адрес, активность; `current` — та, с которой сделан запрос. */
export interface SessionInfo {
  sid: string
  user: string
  createdAt: number
  lastSeen: number
  expiresAt: number
  ip: string
  userAgent: string
  current?: boolean
}
/** Ответ логина при включённом втором факторе (auth-roadmap п.6): пароль верен, нужен код по одноразовому тикету. */
export interface LoginChallenge { requires2fa: true; ticket: string }

/** TTL сессии: «запомнить меня» — 30 дней без активности; без него — 12 часов (auth-roadmap п.15). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000
export const SESSION_SHORT_TTL_MS = 12 * 60 * 60_000

/**
 * Режим прав агента (передаётся в `claude --permission-mode`). Безопасный для
 * неинтерактивного (`-p`) запуска набор: bypass (полный доступ, текущее поведение),
 * acceptEdits (авто-правки файлов), plan (только планирование, без изменений).
 */
export type PermissionMode = 'bypassPermissions' | 'acceptEdits' | 'plan'

/** Режим прав для меню настроек. */
export interface PermissionModeInfo {
  id: PermissionMode
  label: string
}

export const PERMISSION_MODES: PermissionModeInfo[] = [
  { id: 'bypassPermissions', label: 'Полный доступ' },
  { id: 'acceptEdits', label: 'Авто-правки файлов' },
  { id: 'plan', label: 'Только планирование' }
]

/** Значение статуса чата по умолчанию. */
export const DEFAULT_CONVERSATION_STATUS: ConversationStatus = 'developing'

/**
 * Допустимые значения жизненного цикла с подписями. Ручного селекта на карточке
 * чата больше нет (там режим чата, см. `chatModeLabel`), но список остаётся
 * источником валидации статуса на сервере и подписей для будущих поверхностей.
 */
export const CONVERSATION_STATUSES: Array<{ id: ConversationStatus; label: string }> = [
  { id: 'planned', label: 'планируется' },
  { id: 'developing', label: 'разрабатывается' },
  { id: 'planning_done', label: 'планирование закончено' },
  { id: 'development_done', label: 'разработка закончена' },
  { id: 'done', label: 'закончено' }
]

/**
 * Режим разговора словом — им подписана карточка чата в сайдбаре. Три подписи
 * ровно на три пункта «Режима разговора»: планирование, авто-правки и полный
 * доступ (у связанной с канбаном беседы — «задача»).
 */
export const CHAT_MODE_LABELS: Record<PermissionMode, string> = {
  plan: 'план',
  acceptEdits: 'разработка',
  bypassPermissions: 'задача'
}

/**
 * Подпись режима чата. `null`/`undefined` у разговора означает «как в общих
 * настройках», поэтому вызывающий передаёт вторым аргументом действующий
 * дефолт пользователя; без него берём дефолт настроек (`bypassPermissions`).
 * Для полного доступа обычный чат называется «чат», а беседа, связанная с
 * канбан-задачей, — «задача».
 */
export function chatModeLabel(
  mode: PermissionMode | null | undefined,
  fallback: PermissionMode = 'bypassPermissions',
  linkedToTask = false
): string {
  const effectiveMode = mode ?? fallback
  return effectiveMode === 'bypassPermissions' && !linkedToTask
    ? 'чат'
    : CHAT_MODE_LABELS[effectiveMode]
}

/** Подпись пульсирующего индикатора активного хода: «идет разработка». */
export function activeStatusLabel(
  mode: PermissionMode | null | undefined,
  fallback: PermissionMode = 'bypassPermissions',
  linkedToTask = false
): string {
  return `идет ${chatModeLabel(mode, fallback, linkedToTask)}`
}

export type WhisperModel = 'large-v3-turbo' | 'medium' | 'small'

/** Все поддерживаемые модели Whisper (для списков/управления). */
export const WHISPER_MODELS: WhisperModel[] = ['large-v3-turbo', 'medium', 'small']

/** Вид записи активности агента (для режима консоли). */
export type ClaudeLogKind =
  | 'system'
  | 'thinking'
  | 'tool_use'
  | 'tool_result'
  | 'result'
  | 'stt' // тайминг распознавания речи (клиентский замер)
  | 'tts' // тайминг генерации речи (клиентский замер)
  | 'other'

/** Счётчики токенов хода. Во время ответа растут (claude.usage), финал — в TurnMeta. */
export interface TurnUsage {
  /** Токены ввода. */
  inputTokens?: number
  /** Токены вывода. */
  outputTokens?: number
  /** Токены, прочитанные из кэша промпта (cache_read_input_tokens). */
  cacheReadTokens?: number
  /** Токены, записанные в кэш промпта (cache_creation_input_tokens). */
  cacheCreationTokens?: number
}

/**
 * Сводка расхода одной сессии наблюдателя (агрегат по всему транскрипту).
 * Токены — суммарные по сессии; `costUsd` — ОЦЕНКА по прайс-таблице (в файлах
 * сессий CLI реальной стоимости нет), поэтому в UI помечается «≈».
 */
export interface SessionUsage extends TurnUsage {
  /** Модель сессии (последняя замеченная в транскрипте). */
  model?: string
  /** Оценка стоимости сессии в USD; undefined — прайс модели неизвестен. */
  costUsd?: number
  /** Число ходов ассистента в сессии. */
  turns?: number
}

/** Метаданные завершённого хода Claude (из result-события stream-json). */
export interface TurnMeta extends TurnUsage {
  /** DOM-область, выбранная пользователем в веб-превью для этой реплики. */
  previewElement?: PreviewElementPayload
  /** Контекст редактора Make: какой файл открыт и что выделено (п.21). */
  editorContext?: EditorContextPayload
  /** Снимок «До правок», сделанный перед первой записью этого хода — для кнопки «Откатить правки». */
  makeSnapshotId?: string
  /** Длительность хода, мс. */
  durationMs?: number
  /** Число ходов агента (num_turns). */
  numTurns?: number
  /** Стоимость хода в USD (total_cost_usd), если доступна. */
  costUsd?: number
  /** Модель, которой отправлен ход (алиас claude / id codex). */
  model?: string
  /** Что именно ушло модели этим ходом — для панели «Подробнее». */
  request?: TurnRequestInfo
  /** Legacy-предложение одной задачи; читается UI для обратной совместимости. */
  taskLaunch?: TaskLaunchRequest
  /** Независимые предложения задач и их персистентное состояние. */
  taskLaunches?: TaskLaunchProposal[]
  /**
   * Активность хода (команды/thinking/результаты) для подробного вида сообщения.
   * Собирается всегда и персистится в составе `meta` (JSON-колонка), поэтому
   * подробный вид доступен и после перезагрузки/переоткрытия разговора.
   */
  activity?: ClaudeLogEntry[]
  /**
   * Ход прерван остановкой сервера (деплой/рестарт) — сохранена только
   * набранная к этому моменту часть ответа.
   */
  interrupted?: boolean
  /**
   * Сообщение не является ответом хода, а продублированный в чат вопрос
   * CI-рана: ответ на него уходит в ран, а не запускает новый ход чата.
   */
  ciInteraction?: { runId: string; interactionId: string }
  /**
   * Сообщение — резюме законченного CI-рана, дописанное сервером в связанный чат
   * задачи (а не ответ хода). Метка нужна, чтобы резюме можно было отличить от
   * обычного ответа модели и связать с раном.
   */
  ciRunSummary?: { runId: string }
}

/**
 * Детали запроса одного хода: всё, что мы отправили модели, плюс окружение хода
 * (инструменты/навыки из system/init CLI). Внутренний системный промпт Claude Code
 * из CLI недоступен и здесь не фигурирует.
 */
export interface TurnRequestInfo {
  /** Движок хода. */
  provider: LlmProvider
  /** Модель хода (алиас claude / id codex). */
  model: string
  /** Полный текст промпта, отправленный этим ходом. */
  prompt: string
  /** Размер промпта в символах. */
  promptChars: number
  /** Режим прав агента (permission mode). */
  permissionMode?: string
  /** Рабочий каталог процесса CLI. */
  cwd?: string
  /** Пути вложений, приложенных к ходу. */
  attachments?: string[]
  /** Имя машины, если команды выполняются удалённо (иначе — на сервере). */
  execTarget?: string
  /** true — продолжение сессии (--resume); false — холодный старт из истории. */
  resumed: boolean
  /** Разделы KB, автоматически добавленные перед ходом. */
  kbContext?: {
    confidence: 'high' | 'medium' | 'low'
    /**
     * Числа опциональны: сообщения, сохранённые до появления телеметрии БЗ,
     * остаются валидными (и панель собирает по ним отчёт-фолбэк).
     */
    sections: Array<{
      documentId: string
      title: string
      heading: string
      sourcePath: string
      anchor: string
      /** Символы этого раздела в отданном модели тексте. */
      chars?: number
      /** Оценка токенов раздела (ceil(chars/4), см. estimateKbTokens). */
      estimatedTokens?: number
      freshness?: 'current' | 'stale' | 'unknown'
    }>
  }
  /** Доступные инструменты (из system/init CLI). */
  tools?: string[]
  /** Доступные навыки/slash-команды (из system/init CLI). */
  slashCommands?: string[]
  /** MCP-серверы хода (из system/init CLI). */
  mcpServers?: string[]
  /**
   * Полный контекст разговора на момент хода: все сообщения (история + текущая
   * реплика), как они лежали в БД при отправке. При --resume история хранится в
   * сессии CLI и повторно не пересылается, но показывается здесь для наглядности.
   */
  messages?: TurnContextMessage[]
}

/** Одно сообщение контекста хода (роль + текст). */
export interface TurnContextMessage {
  role: MessageRole
  text: string
}

/** Сведения из system/init-события Claude CLI (окружение хода). */
export interface ClaudeInitInfo {
  tools?: string[]
  slashCommands?: string[]
  mcpServers?: string[]
  model?: string
  cwd?: string
  permissionMode?: string
}

/** Одна запись активности агента для панели консоли. */
export interface ClaudeLogEntry {
  kind: ClaudeLogKind
  /** Короткая читаемая строка для панели. */
  summary: string
  /**
   * Имя инструмента ровно в том виде, как его назвал CLI: `mcp__remote__read` у
   * claude, `remote:read` у codex, `Bash` у встроенного. Структурная метка для
   * счётчиков вызовов (`classifyCiToolCall`) — в панели показывается `summary`,
   * а не она. Есть только у `kind === 'tool_use'`; у старых записей нет.
   */
  tool?: string
  /**
   * id вызова инструмента (`tool_use.id` и `tool_result.tool_use_id`): по нему
   * ответ сшивается со своим вызовом, иначе объём ответа не привязать к
   * инструменту — в `tool_result` имени нет, а вызовы бывают параллельными.
   * Есть только у claude (codex id не даёт) и не у всех записей.
   */
  toolUseId?: string
  /** Доп. детали (полный ввод инструмента / результат / размышление). */
  detail?: string
  /** Сырая строка stream-json (для раскрытия «как в консоли»). */
  raw: string
  /** Смещение (символов) в тексте ответа, где произошло действие — для
   *  чередования действий с абзацами. Нет поля — старое сообщение (fallback). */
  at?: number
  /** Момент действия (epoch мс) — для длительностей в кратком виде. */
  ts?: number
}

/** Состояние одной модели Whisper на диске (для управления местом). */
export interface WhisperModelInfo {
  model: WhisperModel
  /** Файл модели присутствует и валиден. */
  present: boolean
  /** Размер файла в байтах (0, если не установлена). */
  sizeBytes: number
}

/** Реальный голос TTS активного движка. */
export interface TtsVoiceInfo {
  /** Идентификатор голоса движка (piper: имя .onnx без расширения; say: имя голоса). */
  id: string
  /** Человекочитаемое название для меню. */
  label: string
}

/** Голос из каталога для скачивания. */
export interface CatalogVoice {
  id: string
  label: string
  /** Уже скачан локально. */
  installed: boolean
}

/** Каталог скачиваемых голосов TTS. */
export interface TtsVoiceCatalog {
  /** Скачивание доступно (активный движок — Piper с доступным бинарём). */
  downloadable: boolean
  voices: CatalogVoice[]
}

/** Дополнительная инструкция AI-помощнику формулировки. */
export interface ModifierPrompt {
  id: string
  title: string
  text: string
  enabled: boolean
  readonly?: boolean
}

/** Системные подсказки помощника, с которых начинается новый профиль. */
export const DEFAULT_AI_ASSIST_PROMPTS: ModifierPrompt[] = [
  { id: 'clear', title: 'Ясно и конкретно', text: 'Сделай формулировку ясной, конкретной и однозначной.', enabled: true, readonly: true },
  { id: 'concise', title: 'Кратко', text: 'Убери повторы и лишние слова, сохранив важные детали.', enabled: true },
  { id: 'structured', title: 'Структурированно', text: 'Если уместно, добавь структуру и явный ожидаемый результат.', enabled: true }
]

export type PersonalizationResponseStyle = 'brief' | 'normal' | 'detailed' | 'step-by-step'
export type PersonalizationTone = 'neutral' | 'friendly' | 'business' | 'plain'

/** Персональные предпочтения общения, применяемые только к пользовательским LLM-ходам. */
export interface UserPersonalization {
  /** null — без обращения; пустая строка в форме нормализуется в null. */
  preferredName: string | null
  birthDay: number | null
  birthMonth: number | null
  birthYear: number | null
  /** BCP-47 код; null — определять по текущему сообщению. */
  responseLanguage: string | null
  responseStyle: PersonalizationResponseStyle
  tone: PersonalizationTone
  /** Аватар — эмодзи или 1–2 буквы (auth-roadmap п.12); null — стандартная иконка. */
  avatar?: string | null
}

export const DEFAULT_PERSONALIZATION: UserPersonalization = {
  preferredName: null,
  birthDay: null,
  birthMonth: null,
  birthYear: null,
  responseLanguage: null,
  responseStyle: 'normal',
  tone: 'neutral',
  avatar: null
}

/** Пользовательские настройки приложения. */
/**
 * Встроенные виды инструкций чата: у каждого — стандартный текст подсказки и парсер
 * ответного fenced-блока (сборка и вырезание — `chatInstructions.ts`).
 */
export const CHAT_INSTRUCTION_KINDS = ['console', 'explorer', 'questions', 'image', 'taskLaunch'] as const
export type ChatInstructionKind = (typeof CHAT_INSTRUCTION_KINDS)[number]

/**
 * Инструкция чата — текст, который сервер дописывает к каждому промпту. Встроенная
 * (`kind` задан) без `text` использует стандартный текст своего вида; `text` — правка
 * пользователя. Пользовательская (без `kind`) — просто текст, блоков в ответе у неё нет.
 */
export interface ChatInstruction {
  id: string
  title: string
  description: string
  enabled: boolean
  kind?: ChatInstructionKind
  text?: string
}

/** Стандартный набор: пять встроенных, все включены, текст — стандартный. */
export const DEFAULT_CHAT_INSTRUCTIONS: ChatInstruction[] = [
  { id: 'console', kind: 'console', enabled: true, title: 'Открывать терминал в чате', description: 'По просьбе «открой консоль» модель вставляет в ответ живой терминал машины.' },
  { id: 'explorer', kind: 'explorer', enabled: true, title: 'Открывать проводник в чате', description: 'По просьбе «открой проводник» модель вставляет файловый проводник машины.' },
  { id: 'questions', kind: 'questions', enabled: true, title: 'Уточняющие вопросы с вариантами', description: 'Модель может закончить ответ вопросами с кнопками-вариантами ответа.' },
  { id: 'image', kind: 'image', enabled: true, title: 'Показывать созданные изображения', description: 'Файл-картинку, созданный на машине, модель показывает прямо в сообщении.' },
  { id: 'taskLaunch', kind: 'taskLaunch', enabled: true, title: 'Спрашивать разрешение перед изменением проекта', description: 'Перед правкой файлов модель предлагает завести задачу в канбан или работать в чате.' }
]

/**
 * Приводит сохранённое значение к списку. Принимает и первый формат настройки —
 * `Record<kind, boolean>` (тогда это стандартный набор с флагами), и отсутствие
 * значения (стандартный набор). Пустой массив — осознанный выбор «ни одной».
 */
export function normalizeChatInstructions(raw: unknown): ChatInstruction[] {
  if (Array.isArray(raw)) {
    return raw.filter((item): item is ChatInstruction =>
      !!item && typeof item === 'object' && typeof (item as ChatInstruction).id === 'string' && typeof (item as ChatInstruction).title === 'string'
    ).map((item) => ({ ...item, enabled: item.enabled !== false, description: item.description ?? '' }))
  }
  const flags = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return DEFAULT_CHAT_INSTRUCTIONS.map((item) => ({ ...item, enabled: flags[item.id] !== false }))
}

export interface Settings {
  model: ClaudeModel
  whisperModel: WhisperModel
  diarization: boolean
  /** id выбранного голоса TTS (реальный id движка; '' — голос по умолчанию). */
  voice: string
  /** deviceId выбранного микрофона или null (по умолчанию). */
  micDeviceId: string | null
  /** Автоматически озвучивать ответы Claude по мере генерации. */
  autoSpeak: boolean
  /** Режим консоли: показывать активность агента (команды, thinking, mode…). */
  showConsole: boolean
  /** Тема интерфейса. */
  theme: 'light' | 'dark' | 'green'
  /** Пользователь прошёл (или пропустил) приветственный мастер. */
  onboarded: boolean
  /** Режим прав агента для Claude CLI. */
  permissionMode: PermissionMode
  /** Рабочий каталог для сессии агента (доступ к репозиторию); null — по умолчанию. */
  workdir: string | null
  /** Barge-in голосом: речь во время озвучки прерывает её и начинает запись. */
  bargeIn: boolean
  /** Hands-free: непрерывный диалог — авто-стоп по тишине и авто-старт после ответа. */
  handsFree: boolean
  /** id машины-агента, где выполнять shell-команды; null — на сервере. */
  execTarget: string | null
  /** Выбранный исполнитель LLM; null — default для роли и провайдера. */
  llmEngineId: string | null
  /** LLM-движок: Claude Code CLI или Codex CLI. */
  llmProvider: LlmProvider
  /** Модель Codex (`codex exec -m`); '' — модель по умолчанию из конфига codex. */
  codexModel: string
  /** id машины-агента по умолчанию для новых разговоров; null — сервер. */
  defaultAgentId: string | null
  /** Отдельный движок AI-помощника формулировки. */
  aiAssistProvider: LlmProvider
  /** Модель AI-помощника; пусто — быстрая модель по умолчанию движка. */
  aiAssistModel: string
  /** Дефолтные модификаторы для полей ввода. */
  aiAssistPrompts: ModifierPrompt[]
  /** TTL временных файлов managed `.generated` в днях (1–3650). */
  generatedFilesTtlDays: number
  /** Централизованные предпочтения общения с моделью. */
  personalization: UserPersonalization
  /** Инструкции чата (терминал, вопросы, картинки, свои тексты): что получает модель с каждым ходом. */
  chatInstructions: ChatInstruction[]
}

/** Поддерживаемые LLM-движки (CLI). */
export type LlmProvider = 'claude' | 'codex'

/** Авторизованный серверный снимок эффективного контекста следующего хода. */
export interface ContextSnapshotItem {
  id: string
  type: string
  source: string
  scope: string
  priority: string
  title: string
  description: string
  explanation: string
  configured: boolean
  available: boolean
  includedInNextTurn: boolean
  /** Можно ли выключить пункт (безопасность и чистая информация — нельзя). */
  toggleable: boolean
  /** Включён ли пункт пользователем. Выключенный не попадает ассистенту в следующих ходах. */
  enabled: boolean
  details?: Record<string, string | number | boolean | string[] | null>
}

export interface ContextSnapshotGroup {
  id: string
  order: number
  title: string
  description: string
  items: ContextSnapshotItem[]
}

export interface ConversationContextSnapshot {
  schemaVersion: 1
  conversationId: string
  generatedAt: string
  freshnessWarning: string
  summary: {
    provider: LlmProvider
    model: string
    permissionMode: { value: PermissionMode; displayName: string; explanation: string }
    kbMode: { value: KbContextMode; displayName: string; explanation: string }
  }
  groups: ContextSnapshotGroup[]
}

/** Модель Codex для меню (id → в `codex exec -m`). */
export interface CodexModelInfo {
  id: string
  label: string
}

/**
 * Пресеты моделей Codex (порядок = порядок в меню). Список фиксированный (у
 * codex нет CLI для перечисления); если в настройках сохранена модель не из
 * списка — в том числе пустая строка старых настроек, означавшая модель из
 * ~/.codex/config.toml, — UI добавит её отдельным пунктом.
 */
export const CODEX_MODELS: CodexModelInfo[] = [
  { id: 'gpt-5.6-sol', label: 'gpt-5.6-sol (default) — Latest frontier agentic coding model.' },
  { id: 'gpt-5.6-terra', label: 'gpt-5.6-terra — Balanced agentic coding model for everyday work.' },
  { id: 'gpt-5.6-luna', label: 'gpt-5.6-luna — Fast and affordable agentic coding model.' },
  { id: 'gpt-5.5', label: 'gpt-5.5 — Frontier model for complex coding, research, and real-world work.' },
  { id: 'gpt-5.4', label: 'gpt-5.4 — Strong model for everyday coding.' },
  { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini — Small, fast, and cost-efficient model for simpler coding tasks.' },
  { id: 'gpt-5.3-codex-spark', label: 'gpt-5.3-codex-spark — Ultra-fast coding model.' }
]

/** Модель Codex по умолчанию — первый пункт меню. */
export const DEFAULT_CODEX_MODEL = CODEX_MODELS[0].id

export const DEFAULT_SETTINGS: Settings = {
  model: 'default',
  whisperModel: 'large-v3-turbo',
  diarization: true,
  voice: 'ru_RU-ruslan-medium',
  micDeviceId: null,
  autoSpeak: false,
  showConsole: false,
  theme: 'light',
  onboarded: false,
  permissionMode: 'bypassPermissions',
  workdir: null,
  bargeIn: false,
  handsFree: false,
  execTarget: null,
  llmEngineId: null,
  llmProvider: 'claude',
  codexModel: DEFAULT_CODEX_MODEL,
  defaultAgentId: null,
  aiAssistProvider: 'claude',
  aiAssistModel: 'haiku',
  aiAssistPrompts: DEFAULT_AI_ASSIST_PROMPTS,
  generatedFilesTtlDays: 30,
  personalization: DEFAULT_PERSONALIZATION,
  chatInstructions: DEFAULT_CHAT_INSTRUCTIONS.map((item) => ({ ...item }))
}

/** Один сегмент распознанной речи (speakerId=1 до диаризации). */
export interface SttSegment {
  speakerId: number
  text: string
  /** Таймкоды в секундах от начала записи (если движок их даёт). */
  start?: number
  end?: number
}

/** Результат распознавания буфера аудио. */
export interface SttResult {
  segments: SttSegment[]
  /** Полный текст (сегменты, склеенные пробелом). */
  text: string
  /** true — финальный результат; false — частичная гипотеза. */
  isFinal: boolean
}

/** Открытый файл и выделение в редакторе Make — уходит модели вместе с сообщением как контекст «правь здесь». */
export interface EditorContextPayload {
  path: string
  startLine?: number
  endLine?: number
  /** Фрагмент выделения (обрезан до 2000 символов). */
  snippet?: string
}
