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
export type AssistantKind = 'web-recorder' | 'playwright-reader' | 'console-reader' | 'make' | 'images' | 'kanban'
export type ConversationScope = 'chat' | 'kanban' | 'make' | 'images' | 'console' | 'playwright-reader' | 'web-reader'

export function conversationScopeForAssistantKind(kind: AssistantKind | null | undefined, projectId?: string | null): ConversationScope {
  if (kind === 'kanban' && projectId) return 'kanban'
  if (kind === 'make') return 'make'
  if (kind === 'images') return 'images'
  if (kind === 'console-reader') return 'console'
  if (kind === 'playwright-reader') return 'playwright-reader'
  if (kind === 'web-recorder') return 'web-reader'
  return 'chat'
}

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
  /**
   * Кто выполнял последнюю команду. Сессия одна на разговор, человек и модель
   * делят страницу — без этого непонятно, кто её только что увёл.
   */
  lastActor?: 'user' | 'assistant'
  /**
   * Внутренний адрес, с которого страница пришла на самом деле, если оператор
   * настроил алиас. Сам `currentUrl` при этом остаётся тем, который назвал
   * человек: алиас — деталь транспорта, ей нечего делать в записанном сценарии.
   */
  aliasedHost?: string
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

/**
 * Действие по селектору или тексту. Раньше раннер понимал только координаты
 * (`click(x, y)`), а MCP-инструменты модели — селекторы, поэтому модель не могла
 * управлять изолированным Chromium вовсе. В Playwright каждое такое действие —
 * один вызов локатора, поэтому разрыв закрывается контрактом, а не обвязкой.
 */
export type BrowserSelectorAction =
  | { kind: 'click'; selector?: string; text?: string; button?: 'left' | 'right'; clickCount?: 1 | 2 }
  | { kind: 'type'; selector: string; text: string; submit?: boolean }
  | { kind: 'read'; selector?: string; limit?: number }
  | { kind: 'find'; text?: string; selector?: string; limit?: number }
  | { kind: 'wait'; selector?: string; text?: string; timeoutMs?: number }
  /** Наведение курсора: выпадающие меню и тултипы иначе не открыть. */
  | { kind: 'hover'; selector?: string; text?: string }
  /** Сложный контрол: select по значению или подписи, checkbox/radio, date/range. */
  | { kind: 'set'; selector: string; value?: string; checked?: boolean }
  /** Перетаскивание от одного селектора к другому (перенос карточки на доске). */
  | { kind: 'drag'; from: string; to: string }
  /** Дерево доступности: роли и имена, как их видит скринридер. */
  | { kind: 'a11y'; selector?: string; limit?: number }
  /** Загрузка файла в input[type=file]: содержимое приходит base64 от модели. */
  | { kind: 'upload'; selector: string; name: string; mimeType?: string; base64: string }
  /**
   * Что за элемент в точке кадра. Нужен записи сценария: клик по кадру
   * координатный, а шаг сценария обязан быть селекторным — иначе запись
   * рассыплется от любого сдвига вёрстки.
   */
  | { kind: 'describe'; x: number; y: number }
  /** Прокрутить к элементу: вслепую колесом до него можно не добраться. */
  | { kind: 'scrollTo'; selector: string }

/** Результат селекторного действия: чтение и поиск возвращают данные, остальные — только факт. */
export interface BrowserSelectorResult {
  ok: boolean
  /** Текст страницы, найденного узла (`read`) или снимок дерева ролей (`a11y`). */
  text?: string
  /** Совпадения для `find`: селектор, видимый текст и признак видимости. */
  matches?: Array<{ selector: string; text: string; visible: boolean }>
  /** Описание элемента под точкой (`describe`). */
  element?: BrowserElementDescription
  /**
   * Текст отдан не целиком: страница длиннее запрошенного лимита. Признак нужен
   * проверкам сценария — «текста нет» и «до текста не дочитали» это разные
   * беды, и вторую нельзя выдавать за первую.
   */
  truncated?: boolean
  error?: string
}

/** Элемент кадра, пригодный для шага сценария и для разбора вёрстки. */
export interface BrowserElementDescription {
  /** Устойчивый селектор: data-testid → id → aria-label → роль → путь по тегам. */
  selector: string
  /** Насколько селектор надёжен: по testid переживает правки вёрстки, по пути — нет. */
  stability: 'testid' | 'id' | 'label' | 'role' | 'path'
  /** Сколько узлов страницы отвечает этому селектору; больше одного — шаг кликнет по первому. */
  matches?: number
  tag: string
  text: string
  /** Положение и размер во вьюпорте — для разбора вёрстки и целей нажатия. */
  rect: { x: number; y: number; width: number; height: number }
}

/**
 * Осмотр страницы: журнал консоли, сетевые запросы и вычисленные стили. Нужен
 * этапу автотестов — без него проверять нечего: модель видит только картинку и
 * текст, но не знает об ошибках страницы и упавших запросах.
 */
export type BrowserInspectAction =
  | { kind: 'console'; level?: 'log' | 'info' | 'warn' | 'error'; pattern?: string; limit?: number; clear?: boolean }
  | { kind: 'network'; filter?: string; limit?: number; clear?: boolean }
  | { kind: 'styles'; selector: string; properties?: string[] }
  /**
   * Выполнить JS в контексте страницы. Гейт (политика проекта и подтверждение
   * опасного кода) стоит на уровне MCP-инструмента, до выбора транспорта, и
   * действует на этот путь так же, как на превью пользователя.
   */
  | { kind: 'evaluate'; code: string }

export interface BrowserConsoleEntry { level: string; text: string; at: number }
export interface BrowserNetworkEntry { method: string; url: string; status: number; ok: boolean; at: number }

export interface BrowserInspectResult {
  ok: boolean
  /** JSON-сериализованный результат `evaluate`. */
  value?: unknown
  console?: BrowserConsoleEntry[]
  network?: BrowserNetworkEntry[]
  styles?: Record<string, string>
  error?: string
}

export type BrowserCommand =
  | { type: 'navigate'; url: string }
  | { type: 'selector'; action: BrowserSelectorAction }
  | { type: 'inspect'; action: BrowserInspectAction }
  | { type: 'back' | 'forward' | 'reload' | 'stop' }
  | { type: 'newTab'; url?: string }
  | { type: 'selectTab' | 'closeTab'; tabId: string }
  | { type: 'resize'; viewport: BrowserViewport }
  | { type: 'input'; action: BrowserInputAction }
  /** Снимок: всей страницы, вьюпорта или узла по селектору. */
  | { type: 'screenshot'; fullPage?: boolean; selector?: string; format?: 'png' | 'jpeg' | 'webp'; quality?: number }

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
  /** Обязательная область происхождения и авторизации разговора. */
  scope: ConversationScope
  /** Проект, к которому привязан чат (null/undefined — не привязан). */
  projectId?: string | null
  /** Служебный приватный чат виджета; его строковое имя становится лейблом источника в селекторах. */
  assistantKind?: AssistantKind | null
  /**
   * Режим применения мутаций канбан-ассистентом: `auto` — сразу, `confirm` —
   * через подтверждение пользователя. Дефолт `auto`.
   */
  assistantAutonomy?: import('./widgetAssistant').WidgetAssistantAutonomy
  /** URL веб-превью только этого разговора; null — наследовать у проекта. */
  previewUrl?: string | null
  /** URL проекта для превью; сервер отдаёт рядом, чтобы чат не зависел от загрузки списка проектов. */
  projectPreviewUrl?: string | null
  /** Задача, с которой связан чат (кнопка «Чат» на карточке); null — не связан. */
  taskId?: string | null

  /** Статус жизненного цикла чата; дефолт 'developing'. */
  status?: ConversationStatus
  /** Суммарная стоимость всех сохранённых AI-ходов; null, пока итог недостоверен. */
  costUsd?: number | null
  /** Полнота серверного агрегата стоимости. Поле отсутствует у legacy-клиентов. */
  costStatus?: 'known' | 'partial' | 'unknown'
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

/** Почему сессия закончилась: показывается в списке недавно завершённых. */
export type SessionEndReason = 'revoked' | 'expired' | 'evicted' | 'panic' | 'logout_all' | 'admin' | 'stale'

/** Место входа по адресу: город и страна либо признак локальной сети. */
export interface SessionGeo {
  country?: string
  city?: string
  local?: boolean
  /** Готовая подпись для показа — считает её сервер, клиент не собирает сам. */
  label: string
}

/**
 * Сессия пользователя (auth-roadmap п.4): устройство, адрес, активность;
 * `current` — та, с которой сделан запрос. Зеркало `DeviceSession` из
 * @voicechat/sessions-core: совместимость проверяет `sessions.test.ts`, все
 * поля сверх базовых — необязательные, чтобы старые записи читались как есть.
 */
export interface SessionInfo {
  sid: string
  user: string
  createdAt: number
  lastSeen: number
  expiresAt: number
  ip: string
  userAgent: string
  current?: boolean
  /** Имя устройства, заданное пользователем. */
  label?: string | null
  /** Ключ устройства: на нём держатся доверие и распознавание нового входа. */
  deviceKey?: string | null
  trustedAt?: number | null
  platform?: string | null
  clientVersion?: string | null
  geo?: SessionGeo | null
  /** Сколько раз отмечалась активность (не чаще раза в минуту) — грубая мера. */
  requests?: number
  lastPath?: string | null
  /**
   * SHA-256 секрета устройства из cookie. Нужен серверу, чтобы решить, доверять
   * ли устройству; клиенту не показывается — роут списка его вырезает.
   */
  deviceSecret?: string | null
  /** Вход подтверждён вторым фактором (или доверенным устройством после него). */
  twoFactor?: boolean
  /** Сессия уже завершена (отозвана или истекла) — показывается отдельным списком. */
  ended?: boolean
  /** Когда завершилась: момент отзыва либо истечения. */
  endedAt?: number
  endReason?: SessionEndReason | null
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

/**
 * Режимы контекста базы знаний с подписями. Раньше подписи были литералами в
 * `<option>` настроек разговора; инспектор контекста показывает тот же выбор, и
 * две копии подписей разошлись бы при первой же правке формулировки.
 */
export const KB_CONTEXT_MODES: Array<{ id: KbContextMode; label: string }> = [
  { id: 'auto', label: 'Авто-контекст + инструменты модели' },
  { id: 'manual', label: 'По запросу модели (только инструменты)' },
  { id: 'off', label: 'Не использовать' }
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
export const CHAT_INSTRUCTION_KINDS = ['console', 'explorer', 'git', 'questions', 'image', 'taskLaunch'] as const
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
  { id: 'git', kind: 'git', enabled: true, title: 'Открывать панель кода в чате', description: 'По просьбе «покажи изменения» модель вставляет панель кода рабочей копии: diff, правка, коммит.' },
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
  /** Письма о входе с нового сочетания IP и User-Agent. */
  loginNewDeviceEmails: boolean
  /**
   * Пресеты контекста: именованные наборы выключенных источников. Настроил один
   * раз («минимальный контекст», «без базы знаний») — применяешь к любому чату,
   * вместо того чтобы щёлкать тумблеры по памяти.
   */
  contextPresets: ContextPreset[]
  /**
   * Пресет, который применяется к **новым** разговорам. Настроил «минимальный
   * контекст» один раз — и он действует сразу, а не после того как человек
   * вспомнит про кнопку. null — новые чаты начинают с полным контекстом.
   */
  defaultContextPresetId: string | null
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
  /**
   * На что влияет тумблер: `prompt-block` — исчезает блок промпта, `tool` —
   * инструмент попадает в `--disallowedTools`, `skill` — навык не уходит
   * исполнителю. Поле обязательно у выключаемого пункта: без него однажды
   * появился тумблер, который писал в `disabledContext`, где его никто не
   * читает, и делал вид, что что-то меняет. Инвариантный тест сверяет
   * объявленный эффект с фактическим.
   */
  effect?: 'prompt-block' | 'tool' | 'skill' | null
  /** Включён ли пункт пользователем. Выключенный не попадает ассистенту в следующих ходах. */
  enabled: boolean
  /**
   * Почему пункт нельзя выключить: `safety` — правила платформы и приложения,
   * `info` — чистая информация без вклада в промпт, `kind` — инструмент даёт
   * сам вид чата (превью, консоль, Make, панель ассистента). У выключаемого — null.
   * UI объясняет замок словами, а не догадкой по id.
   */
  lockReason?: 'safety' | 'info' | 'kind' | null
  /** Размер вклада пункта в промпт: символы и грубая оценка токенов (chars/4). */
  size?: { chars: number; approxTokens: number } | null
  /**
   * Наследование значения: откуда взято и что стояло бы без переопределения.
   * Строка `source` отвечает «откуда», а это — «что переопределено и чем».
   */
  inheritance?: { effective: string; overriddenFrom?: string; inheritedFrom?: string } | null
  details?: Record<string, string | number | boolean | string[] | null>
}

export interface ContextSnapshotGroup {
  id: string
  order: number
  title: string
  description: string
  items: ContextSnapshotItem[]
  /**
   * Вклад группы в постоянную часть промпта. Ответ на «какая часть настроек
   * съедает место»: у пункта размер уже есть, но складывать их глазами — работа.
   */
  size?: { chars: number; approxTokens: number } | null
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
  /**
   * Роль смотрящего: админ видит закрытые тексты инструкций и правит любые
   * настройки, остальные — всё, что не про безопасность и других людей.
   * Решает сервер: UI не выводит права из роли самостоятельно.
   */
  viewerRole: UserRole
  /**
   * Владелец разговора. Совпадает со смотрящим в обычном случае; отличается,
   * когда админ открыл чужой чат — тогда это нужно показать прямо, иначе легко
   * решить, что правишь свой контекст.
   */
  owner: string
  /** Смотрящий — не владелец (админский просмотр чужого разговора). */
  foreign: boolean
  /** Что ушло в прошлый ход; null — ходов ещё не было. */
  lastTurn: ContextLastTurn | null
  /** Журнал изменений контекста этого разговора, новые сверху. */
  changes: ContextChangeEvent[]
  /**
   * Инструменты, которые уйдут в `--disallowedTools`: человек выключил их
   * тумблером, и модель не сможет их вызвать. Прямой ответ на «что она НЕ
   * сможет» — по списку доступных возможностей этого не увидеть.
   */
  disallowedTools: string[]
  /**
   * MCP-серверы профиля CLI, как их печатает сам движок. Каталог возможностей в
   * группах — это то, что подключает приложение; здесь — что видит CLI. Пусто —
   * список получить не удалось (движок не установлен или не ответил).
   */
  cliMcpServers: Array<{ name: string; detail: string; status: string }>
  /** Несогласованности конфигурации (порядок: problem раньше notice). */
  warnings: ContextWarning[]
  /**
   * Полный текст блоков, которые сервер добавит к следующему ходу, в порядке
   * сборки. Строится тем же билдером, что и сам ход (`contextBlocks.ts`),
   * иначе предпросмотр расходится с отправленным.
   */
  promptPreview: {
    /** Блоки, попадающие в промпт при текущих настройках. */
    blocks: ContextPromptBlock[]
    /** Склеенный текст блоков — то, что уйдёт поверх истории разговора. */
    text: string
    chars: number
    approxTokens: number
    /** Чего в предпросмотре принципиально нет (динамика хода, закрытые тексты CLI). */
    omitted: string[]
    /**
     * Оценка стоимости постоянной части в USD за один ход (только входные
     * токены). `null` — прайса для модели нет: досчитывать выдуманной ценой
     * нельзя, «—» честнее.
     */
    costUsd: number | null
    /**
     * Сколько уйдёт в следующий ход целиком: постоянная часть плюс история
     * разговора. Ответ на вопрос, которого предпросмотр сам по себе не даёт —
     * у длинного чата история весит больше всех настроек вместе взятых, и
     * «выключить пару источников» там ничего не меняет. При живой сессии
     * движка (`resumed`) история заново не передаётся, и итог равен постоянной
     * части плюс новое сообщение.
     */
    turnTotal: {
      chars: number
      approxTokens: number
      historyChars: number
      historyApproxTokens: number
      /** Ход продолжит сессию движка: историю движок помнит сам. */
      resumed: boolean
    }
    /**
     * Во что обошёлся бы тот же объём на других моделях того же движка. Пусто —
     * прайса нет ни для одной. Считается по той же таблице, что и `costUsd`:
     * своей цены UI не знает и знать не должен.
     */
    costByModel: Array<{ model: string; costUsd: number }>
  }
  /** Размеры промпта последних ходов, новые сверху: виден рост контекста. */
  turnSizes: ContextTurnSize[]
}

/**
 * Предпросмотр автоконтекста базы знаний по черновику сообщения. Отвечает на
 * вопрос, который снимок сам ответить не может: снимок описывает сохранённое
 * состояние, а подбор документов зависит от текста, который ещё не отправлен.
 */
export interface ContextKbPreview {
  /** Режим БЗ разговора на момент запроса; `off` — подбора не будет. */
  mode: KbContextMode
  /** Текст, который сервер допишет к промпту; пусто — инъекции не будет. */
  text: string
  chars: number
  approxTokens: number
  /** Уверенность подбора (её же считает ход модели); null — подбора не было. */
  confidence: 'high' | 'medium' | 'low' | null
  /** Разделы, попавшие в контекст: id документа, заголовок и размер блока. */
  sections: Array<{ documentId: string; title: string; anchor?: string; chars: number }>
  /** Почему инъекции нет: `off`, `empty-query`, причина от подборщика. */
  emptyReason: string | null
}

/**
 * Цепочка AGENTS.md рабочей директории, прочитанная с машины по явному запросу.
 * Снимок её не раскрывает: файл живёт на чужом хосте, и читать его без просьбы
 * человека сервер не должен. От общей к конкретной — тот же порядок, в каком её
 * применяет CLI.
 */
export interface AgentsChainFile {
  /** Абсолютный путь на машине. */
  path: string
  /** Содержимое файла; null — файл есть в цепочке, но прочитать не удалось. */
  text: string | null
  chars: number
  /** Почему не прочитан (нет файла, отказ политики, таймаут). */
  error?: string
}

export interface AgentsChainResult {
  /** Машина, на которой читали; null — доступной машины нет. */
  machineName: string | null
  workdir: string | null
  files: AgentsChainFile[]
  /** Общая причина, когда читать было негде (нет машины/директории). */
  unavailable?: string
}

/**
 * Факт последнего хода: что реально ушло модели. Снимок — прогноз на следующее
 * сообщение, а этот блок отвечает на другой вопрос: «а что было отправлено?».
 * Данные берутся из `meta.request` сохранённого ответа, ничего не досчитывается.
 */
export interface ContextLastTurn {
  /** Когда получен ответ (метка сообщения). */
  at: string
  provider: LlmProvider
  model: string
  /** Полный текст промпта того хода — то, что действительно ушло. */
  prompt: string
  chars: number
  approxTokens: number
  /** Ход продолжал сессию движка (история не пересобиралась). */
  resumed: boolean
  permissionMode?: string
  attachments: number
  /** Разделы БЗ, добавленные тем ходом (пусто — автоконтекста не было). */
  kbSections: string[]
  /** Имена приложенных файлов — «2 вложения» не отвечает на вопрос «какие». */
  attachmentNames: string[]
}

/** Размер промпта одного состоявшегося хода — для истории роста контекста. */
export interface ContextTurnSize {
  at: string
  model: string
  chars: number
  approxTokens: number
  /** Ход продолжал сессию движка: история в этом промпте не пересобиралась. */
  resumed: boolean
  /** Оценка стоимости входных токенов этого хода; null — прайса для модели нет. */
  costUsd: number | null
}

/**
 * Несогласованность конфигурации, которую заметил сервер. Не ошибка запроса:
 * настройки формально верны, но вместе дают не то, чего человек ждёт («чат
 * привязан к проекту, а проектный контекст выключен»).
 */
export interface ContextWarning {
  /** Пункт снимка, к которому относится (для перехода); null — общее. */
  itemId: string | null
  /** `notice` — стоит знать, `problem` — почти наверняка не то, что нужно. */
  level: 'notice' | 'problem'
  text: string
}

/**
 * Чем контекст двух разговоров отличается. Отвечает на вопрос «почему там
 * работает, а здесь нет» до того, как человек что-то перезапишет копированием.
 */
export interface ContextDiff {
  /** Разговор-образец: id и название. */
  otherId: string
  otherTitle: string
  /** Выключено там, включено здесь (id пунктов с заголовками). */
  onlyThere: Array<{ itemId: string; title: string }>
  /** Выключено здесь, включено там. */
  onlyHere: Array<{ itemId: string; title: string }>
  /** Настройки, которые различаются: движок, модель, режимы. */
  settings: Array<{ label: string; here: string; there: string }>
}

/** Именованный набор выключенных источников контекста. */
export interface ContextPreset {
  id: string
  name: string
  /** id выключенных пунктов; остальные считаются включёнными. */
  disabled: string[]
}

/** Запись журнала контекста: кто, когда и какой источник включил или выключил. */
export interface ContextChangeEvent {
  at: number
  /** Логин того, кто изменил (админ может править чужой разговор). */
  actor: string
  itemId: string
  enabled: boolean
  /**
   * Новое значение настройки разговора (режим доступа, база знаний, движок).
   * Есть только у событий-настроек; у тумблера состояние выражает `enabled`.
   */
  value?: string
}

/** Блок системного промпта: чем он добавлен и какой у него текст. */
export interface ContextPromptBlock {
  /**
   * id пунктов инспектора, за которыми стоит этот блок (`personalization`,
   * `instruction-…`). Их может быть несколько: стандартные «терминал» и
   * «проводник» склеиваются в одну подсказку модели.
   */
  itemIds: string[]
  title: string
  text: string
  chars: number
  approxTokens: number
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
  chatInstructions: DEFAULT_CHAT_INSTRUCTIONS.map((item) => ({ ...item })),
  loginNewDeviceEmails: true,
  contextPresets: [],
  defaultContextPresetId: null
}

/**
 * Приводит присланный патч настроек к контракту: неизвестные ключи выбрасывает,
 * значения не того типа и не из набора — тоже. Настройки сохраняются одной
 * JSON-записью и мержатся с прежними, поэтому один мусорный ключ («theme»:
 * «нечто») иначе оседал бы в записи навсегда и ломал экран при каждом чтении.
 * Общая для клиента и сервера: границу проверяет тот, кто пишет.
 */
export function sanitizeSettingsPatch(raw: unknown): Partial<Settings> {
  if (typeof raw !== 'object' || raw === null) return {}
  const input = raw as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  const bool = (key: keyof Settings): void => { if (typeof input[key] === 'boolean') patch[key] = input[key] }
  const oneOf = <T extends string>(key: keyof Settings, values: readonly T[]): void => {
    if (typeof input[key] === 'string' && (values as readonly string[]).includes(input[key] as string)) patch[key] = input[key]
  }
  const text = (key: keyof Settings): void => { if (typeof input[key] === 'string') patch[key] = input[key] }
  const nullableText = (key: keyof Settings): void => {
    if (input[key] === null || typeof input[key] === 'string') patch[key] = input[key]
  }

  if (typeof input.model === 'string') patch.model = normalizeClaudeModel(input.model)
  oneOf('whisperModel', WHISPER_MODELS)
  oneOf('theme', ['light', 'dark', 'green'] as const)
  oneOf('permissionMode', PERMISSION_MODES.map((mode) => mode.id))
  oneOf('llmProvider', ['claude', 'codex'] as const)
  oneOf('aiAssistProvider', ['claude', 'codex'] as const)
  for (const key of ['diarization', 'autoSpeak', 'showConsole', 'onboarded', 'bargeIn', 'handsFree', 'loginNewDeviceEmails'] as const) bool(key)
  for (const key of ['voice', 'codexModel', 'aiAssistModel'] as const) text(key)
  for (const key of ['micDeviceId', 'workdir', 'execTarget', 'llmEngineId', 'defaultAgentId', 'defaultContextPresetId'] as const) nullableText(key)
  if (Number.isInteger(input.generatedFilesTtlDays)) patch.generatedFilesTtlDays = input.generatedFilesTtlDays
  if (Array.isArray(input.aiAssistPrompts)) {
    patch.aiAssistPrompts = (input.aiAssistPrompts as unknown[])
      .filter((item): item is ModifierPrompt => typeof item === 'object' && item !== null && typeof (item as ModifierPrompt).id === 'string')
      .map((item) => ({ ...item, title: String(item.title ?? ''), text: String(item.text ?? ''), enabled: item.enabled !== false }))
  }
  if (input.chatInstructions !== undefined) patch.chatInstructions = normalizeChatInstructions(input.chatInstructions)
  // Пресеты контекста: имя и список id. Приводим к контракту здесь, иначе мусор
  // осядет в записи настроек навсегда (она мержится, а не заменяется).
  if (Array.isArray(input.contextPresets)) {
    patch.contextPresets = (input.contextPresets as unknown[])
      .filter((item): item is ContextPreset => typeof item === 'object' && item !== null && typeof (item as ContextPreset).id === 'string')
      .map((item) => ({
        id: item.id,
        name: String(item.name ?? '').trim().slice(0, 60) || 'Без названия',
        disabled: Array.isArray(item.disabled) ? item.disabled.filter((entry): entry is string => typeof entry === 'string') : []
      }))
      .slice(0, 20)
  }
  if (typeof input.personalization === 'object' && input.personalization !== null) patch.personalization = input.personalization
  return patch as Partial<Settings>
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

/**
 * Ответ команды раннера зависит от её вида: навигация и вкладки отдают
 * метаданные сессии, `selector` — результат чтения и поиска, `inspect` —
 * журналы страницы. Разбор нужен и панели, и мосту: до круга 11 сигнатура
 * обещала метаданные всегда, и вызывающие читали `incarnation` там, где его нет.
 */
export function isBrowserSessionMetadata(value: unknown): value is BrowserSessionMetadata {
  return typeof value === 'object' && value !== null && typeof (value as { incarnation?: unknown }).incarnation === 'string'
}
