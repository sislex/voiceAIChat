// Общие типы, разделяемые между main, preload и renderer.

/** Состояния голосового пайплайна. */
export type VoiceState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

/** Роль автора сообщения. `u1`/`u2`/… — спикеры пользователя, `ai` — Claude. */
export type MessageRole = `u${number}` | 'ai'

/** Сообщение в ленте чата. */
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
  /** Имена навыков выбранной машины, включённых для этого разговора. */
  skillNames: string[]
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
  /** Проект, к которому привязан чат (null/undefined — не привязан). */
  projectId?: string | null
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
 */
export type ClaudeModel = 'opus' | 'sonnet' | 'fable' | 'haiku'

/** Модель Claude для меню настроек. */
export interface ClaudeModelInfo {
  id: ClaudeModel
  /** Подпись в меню (текущая актуальная версия для алиаса). */
  label: string
}

/**
 * Актуальные модели Claude (порядок = порядок в меню). Подписи отражают версию,
 * которую CLI сейчас резолвит для алиаса; при обновлении CLI меняется только
 * резолв — правим подпись здесь.
 */
export const CLAUDE_MODELS: ClaudeModelInfo[] = [
  { id: 'opus', label: 'Claude Opus 4.8' },
  { id: 'sonnet', label: 'Claude Sonnet 5' },
  { id: 'fable', label: 'Claude Fable 5' },
  { id: 'haiku', label: 'Claude Haiku 4.5' }
]

/**
 * Приводит значение модели из настроек/БД к валидному алиасу. Терпит старые
 * значения (`sonnet-4.5`, `opus-4.5`) — берёт алиас по префиксу; неизвестное → opus.
 */
export function normalizeClaudeModel(raw: string): ClaudeModel {
  const hit = CLAUDE_MODELS.find((m) => raw.startsWith(m.id))
  return hit ? hit.id : 'opus'
}

/** Роль пользователя приложения (многопользовательский режим web-версии). */
export type UserRole = 'admin' | 'user'

/** Аутентифицированный пользователь сессии. */
export interface SessionUser {
  /** Логин (он же идентификатор владельца данных). */
  name: string
  role: UserRole
}

/**
 * Модели Claude, недоступные роли `user`. У `admin` доступны все. Ограничение
 * дублируется на сервере (кламп модели хода), клиент лишь прячет их в списке.
 */
const RESTRICTED_FOR_USER: ClaudeModel[] = ['opus', 'fable']

/** Доступна ли модель роли (admin — все; user — без opus/fable). */
export function isModelAllowed(model: ClaudeModel, role: UserRole): boolean {
  return role === 'admin' || !RESTRICTED_FOR_USER.includes(model)
}

/** Список моделей, доступных роли (для селектора в настройках). */
export function modelsForRole(role: UserRole): ClaudeModelInfo[] {
  return CLAUDE_MODELS.filter((m) => isModelAllowed(m.id, role))
}

/** Разрешённая модель для роли: исходная, если можно, иначе безопасный fallback. */
export function clampModelForRole(model: ClaudeModel, role: UserRole): ClaudeModel {
  return isModelAllowed(model, role) ? model : 'sonnet'
}

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

/** Пункты выпадающего списка статуса на карточке чата (подписи-существительные). */
export const CONVERSATION_STATUSES: Array<{ id: ConversationStatus; label: string }> = [
  { id: 'planned', label: 'планируется' },
  { id: 'developing', label: 'разрабатывается' },
  { id: 'planning_done', label: 'планирование закончено' },
  { id: 'development_done', label: 'разработка закончена' },
  { id: 'done', label: 'закончено' }
]

/** Подпись пульсирующего индикатора активного хода по режиму прав. */
export function activeStatusLabel(mode: PermissionMode | null | undefined): string {
  return mode === 'plan' ? 'планирую' : 'разрабатываю'
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

/** Пользовательские настройки приложения. */
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
  theme: 'light' | 'dark'
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
}

/** Поддерживаемые LLM-движки (CLI). */
export type LlmProvider = 'claude' | 'codex'

/** Модель Codex для меню (id → в `codex exec -m`). */
export interface CodexModelInfo {
  id: string
  label: string
}

/**
 * Пресеты моделей Codex. Пустой id — модель по умолчанию из ~/.codex/config.toml.
 * Список фиксированный (у codex нет CLI для перечисления); если в настройках
 * сохранена модель не из списка, UI добавит её отдельным пунктом.
 */
export const CODEX_MODELS: CodexModelInfo[] = [
  { id: '', label: 'По умолчанию (из codex)' },
  { id: 'gpt-5-codex', label: 'gpt-5-codex' },
  { id: 'gpt-5', label: 'gpt-5' },
  { id: 'o3', label: 'o3' },
  { id: 'o4-mini', label: 'o4-mini' }
]

export const DEFAULT_SETTINGS: Settings = {
  model: 'opus',
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
  llmProvider: 'claude',
  codexModel: '',
  defaultAgentId: null,
  aiAssistProvider: 'claude',
  aiAssistModel: 'haiku',
  aiAssistPrompts: DEFAULT_AI_ASSIST_PROMPTS

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
