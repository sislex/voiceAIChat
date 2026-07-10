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

export type ClaudeModel = 'sonnet-4.5' | 'opus-4.5'
export type WhisperModel = 'large-v3-turbo' | 'medium' | 'small'

/** Все поддерживаемые модели Whisper (для списков/управления). */
export const WHISPER_MODELS: WhisperModel[] = ['large-v3-turbo', 'medium', 'small']

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
}

export const DEFAULT_SETTINGS: Settings = {
  model: 'sonnet-4.5',
  whisperModel: 'large-v3-turbo',
  diarization: true,
  voice: 'ru_RU-ruslan-medium',
  micDeviceId: null,
  autoSpeak: false
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
