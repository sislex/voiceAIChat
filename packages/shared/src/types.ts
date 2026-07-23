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
export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  /** session-id Claude CLI, привязанный к разговору (null до первого ответа). */
  claudeSessionId: string | null
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

/** Метаданные завершённого хода Claude (из result-события stream-json). */
export interface TurnMeta {
  /** Длительность хода, мс. */
  durationMs?: number
  /** Число ходов агента (num_turns). */
  numTurns?: number
  /** Стоимость хода в USD (total_cost_usd), если доступна. */
  costUsd?: number
  /** Токены ввода. */
  inputTokens?: number
  /** Токены вывода. */
  outputTokens?: number
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
  codexModel: ''
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
