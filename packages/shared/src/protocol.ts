// Контракт клиент↔сервер (Ф1). HTTP REST — запрос/ответ; WebSocket — стриминг.
// Семантика соответствует прежним Electron-IPC каналам (1:1), но транспорт-нейтральна.

import type {
  ClaudeLogEntry,
  Conversation,
  Message,
  MessageRole,
  SttSegment,
  TurnMeta,
  WhisperModel
} from './types'
import type { CcItem } from './cc'

// --- Общие ---------------------------------------------------------------

/** Сегмент для передачи по сети (совпадает с SttSegment). */
export type SttSegmentWire = SttSegment

/** Обновление распознавания (частичное/финальное). */
export interface SttUpdate {
  segments: SttSegmentWire[]
  text: string
}

/** Статус локальной модели Whisper. */
export interface SttStatus {
  present: boolean
  model: WhisperModel
}

// --- HTTP REST -----------------------------------------------------------
//
// GET    /api/health                         -> { ok, version }
// GET    /api/conversations                  -> Conversation[]
// POST   /api/conversations {title?}         -> Conversation
// GET    /api/conversations/:id              -> ConversationWithMessages | 404
// PATCH  /api/conversations/:id {title}      -> Conversation
// DELETE /api/conversations/:id              -> { ok }
// POST   /api/conversations/:id/messages AddMessageArgs -> Message
// GET    /api/settings                       -> Settings
// PUT    /api/settings  Settings             -> Settings
// GET    /api/stt/status                     -> SttStatus
// GET    /api/tts/voices                     -> TtsVoiceInfo[]
// GET    /api/tts/catalog                    -> TtsVoiceCatalog

export interface ConversationWithMessages {
  conversation: Conversation
  messages: Message[]
}

export interface AddMessageArgs {
  role: MessageRole
  text: string
  time: string
}

export interface HealthResponse {
  ok: true
  version: string
}

/** Пути REST (единый источник для сервера и клиентов). */
export const REST = {
  health: '/api/health',
  conversations: '/api/conversations',
  conversationsSearch: '/api/conversations/search',
  conversation: (id: string) => `/api/conversations/${id}`,
  messages: (id: string) => `/api/conversations/${id}/messages`,
  message: (id: string, messageId: string) => `/api/conversations/${id}/messages/${messageId}`,
  uploads: '/api/uploads',
  settings: '/api/settings',
  sttStatus: '/api/stt/status',
  sttModels: '/api/stt/models',
  sttModel: (model: string) => `/api/stt/models/${model}`,
  ttsVoices: '/api/tts/voices',
  ttsCatalog: '/api/tts/catalog',
  ttsVoice: (id: string) => `/api/tts/voices/${id}`,
  ttsVoiceDownload: (id: string) => `/api/tts/voices/${id}/download`,
  sttDownload: '/api/stt/download',
  mcpServers: '/api/mcp/servers',
  agents: '/api/agents',
  agentScript: '/api/agents/script',
  agent: (id: string) => `/api/agents/${encodeURIComponent(id)}`,
  ccProjects: '/api/cc/projects',
  ccSessions: (slug: string) => `/api/cc/projects/${encodeURIComponent(slug)}/sessions`,
  ccTranscript: (slug: string, id: string) =>
    `/api/cc/projects/${encodeURIComponent(slug)}/sessions/${encodeURIComponent(id)}`,
  ccResume: '/api/cc/resume'
} as const

// --- WebSocket -----------------------------------------------------------
//
// Аудио-чанки (Int16 PCM) шлются бинарными кадрами. Остальное — JSON-кадры {t,...}.
// Синтезированное аудио TTS сервер шлёт бинарными кадрами с префиксом-заголовком
// (см. кодирование ниже) либо base64 в JSON `tts.audio` (реализация выберёт).

/** Метаданные загруженного вложения (ответ POST /api/uploads). */
export interface UploadInfo {
  /** id загруженного файла на сервере (для передачи в claude.send). */
  id: string
  /** Имя файла (для отображения). */
  name: string
}

/** client → server. */
export type ClientMessage =
  | { t: 'audio.start'; sampleRate: number }
  | { t: 'audio.stop' }
  | {
      t: 'claude.send'
      conversationId: string
      segments: SttSegmentWire[]
      /** id вложений (из POST /api/uploads), которые Claude должен учесть. */
      attachments?: string[]
      /** Режим консоли: слать активность агента (claude.log). */
      verbose?: boolean
    }
  | { t: 'claude.cancel' }
  | { t: 'tts.speak'; text: string; voice: string }
  | { t: 'tts.cancel' }
  | { t: 'tts.downloadVoice'; id: string }
  | { t: 'stt.download' }
  | { t: 'cc.tail.start'; slug: string; id: string }
  | { t: 'cc.tail.stop' }

/** server → client. */
export type ServerMessage =
  | { t: 'stt.partial'; update: SttUpdate }
  | { t: 'stt.final'; update: SttUpdate }
  | { t: 'stt.error'; message: string }
  | { t: 'claude.token'; conversationId: string; delta: string }
  | { t: 'claude.done'; conversationId: string; text: string; meta?: TurnMeta }
  | { t: 'claude.error'; conversationId: string; message: string }
  | { t: 'claude.log'; conversationId: string; entry: ClaudeLogEntry }
  | { t: 'tts.audio'; audio: string } // base64 WAV (или бинарный кадр — см. реализацию)
  | { t: 'tts.error'; message: string }
  | { t: 'tts.voiceProgress'; id: string; percent: number }
  | { t: 'tts.voiceDone'; id: string }
  | { t: 'tts.voiceError'; id: string; message: string }
  | { t: 'stt.downloadProgress'; percent: number }
  | { t: 'stt.downloadDone' }
  | { t: 'stt.downloadError'; message: string }
  | { t: 'cc.tail'; slug: string; id: string; items: CcItem[] }

export type ClientMessageType = ClientMessage['t']
export type ServerMessageType = ServerMessage['t']

/** Полный список типов сообщений — для проверок контракта в тестах. */
export const CLIENT_MESSAGE_TYPES: ClientMessageType[] = [
  'audio.start',
  'audio.stop',
  'claude.send',
  'claude.cancel',
  'tts.speak',
  'tts.cancel',
  'tts.downloadVoice',
  'stt.download',
  'cc.tail.start',
  'cc.tail.stop'
]

export const SERVER_MESSAGE_TYPES: ServerMessageType[] = [
  'stt.partial',
  'stt.final',
  'stt.error',
  'claude.token',
  'claude.done',
  'claude.error',
  'claude.log',
  'tts.audio',
  'tts.error',
  'tts.voiceProgress',
  'tts.voiceDone',
  'tts.voiceError',
  'stt.downloadProgress',
  'stt.downloadDone',
  'stt.downloadError',
  'cc.tail'
]
