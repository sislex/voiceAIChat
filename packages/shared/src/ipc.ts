// Единый контракт IPC между main и renderer.
// И preload, и main строятся от этих типов — рассинхрон ловится компилятором.

import type {
  ClaudeLogEntry,
  Conversation,
  Message,
  MessageRole,
  Settings,
  TtsVoiceCatalog,
  TtsVoiceInfo,
  TurnMeta,
  WhisperModel,
  WhisperModelInfo
} from './types'
import type { McpServer } from './mcp'

/** Статус локальной модели Whisper. */
export interface SttStatus {
  /** Файл модели на месте и пригоден. */
  present: boolean
  /** Текущая модель из настроек. */
  model: WhisperModel
}

/** Разговор вместе с его сообщениями (ответ на conversations:get). */
export interface ConversationWithMessages {
  conversation: Conversation
  messages: Message[]
}

export interface AddMessageArgs {
  conversationId: string
  role: MessageRole
  text: string
  time: string
}

/** Метаданные загруженного вложения. */
export interface UploadInfo {
  id: string
  name: string
}

/**
 * Карта invoke-каналов: имя → { arg; result }.
 * `arg: void` означает вызов без аргументов.
 */
export interface IpcInvokeMap {
  'app:ping': { arg: void; result: string }
  'conversations:list': { arg: void; result: Conversation[] }
  'conversations:create': { arg: { title?: string }; result: Conversation }
  'conversations:get': { arg: { id: string }; result: ConversationWithMessages | null }
  /** Поиск разговоров по названию и содержимому сообщений (регистронезависимо). */
  'conversations:search': { arg: { query: string }; result: Conversation[] }
  'conversations:rename': { arg: { id: string; title: string }; result: void }
  'conversations:delete': { arg: { id: string }; result: void }
  'messages:add': { arg: AddMessageArgs; result: Message }
  'messages:delete': { arg: { conversationId: string; messageId: string }; result: void }
  'uploads:add': { arg: { name: string; dataBase64: string }; result: UploadInfo }
  'settings:get': { arg: void; result: Settings }
  'settings:save': { arg: Settings; result: void }
  'stt:status': { arg: void; result: SttStatus }
  /** Список всех моделей Whisper с наличием и размером (управление местом). */
  'stt:models': { arg: void; result: WhisperModelInfo[] }
  /** Удалить файл модели Whisper (освободить место). */
  'stt:deleteModel': { arg: { model: WhisperModel }; result: void }
  'tts:voices': { arg: void; result: TtsVoiceInfo[] }
  'tts:catalog': { arg: void; result: TtsVoiceCatalog }
  /** Удалить установленный голос Piper (освободить место). */
  'tts:deleteVoice': { arg: { id: string }; result: void }
}

export type IpcChannel = keyof IpcInvokeMap
export type IpcArg<C extends IpcChannel> = IpcInvokeMap[C]['arg']
export type IpcResult<C extends IpcChannel> = IpcInvokeMap[C]['result']

/** Один чанк захваченного аудио: Int16 PCM mono (ArrayBuffer — дружелюбен к structured-clone). */
export interface AudioChunkMessage {
  /** Порядковый номер чанка в текущей сессии записи (с 0). */
  seq: number
  /** Частота дискретизации чанка (обычно 16000). */
  sampleRate: number
  /** Сэмплы Int16 mono как ArrayBuffer. */
  pcm: ArrayBuffer
}

/**
 * Односторонние сообщения renderer → main (ipcRenderer.send). Используются для
 * потока аудио: invoke-модель «запрос/ответ» здесь не подходит (высокая частота,
 * без ответа).
 */
export interface IpcSendMap {
  'audio:start': { conversationId: string | null; sampleRate: number }
  'audio:chunk': AudioChunkMessage
  'audio:stop': void
  /** Запрос ответа Claude на реплику (сегменты хода + вложения + режим консоли). */
  'claude:send': {
    conversationId: string
    segments: SttSegmentWire[]
    attachments?: string[]
    verbose?: boolean
  }
  /** Прервать текущий запрос к Claude. */
  'claude:cancel': void
  /** Запустить скачивание текущей модели Whisper. */
  'stt:download': void
  /** Озвучить текст (TTS). */
  'tts:speak': { text: string; voice: string }
  /** Прервать озвучку. */
  'tts:cancel': void
  /** Скачать голос Piper по id. */
  'tts:downloadVoice': { id: string }
}

export type IpcSendChannel = keyof IpcSendMap
export type IpcSendPayload<C extends IpcSendChannel> = IpcSendMap[C]

export const IPC_SEND_CHANNELS: IpcSendChannel[] = [
  'audio:start',
  'audio:chunk',
  'audio:stop',
  'claude:send',
  'claude:cancel',
  'stt:download',
  'tts:speak',
  'tts:cancel',
  'tts:downloadVoice'
]

/**
 * Мост потокового аудио, доступный в renderer как `window.audio`.
 * Отдельно от `window.api` (invoke), т.к. это односторонний поток без ответа.
 */
export interface RendererAudioBridge {
  audioStart(payload: IpcSendPayload<'audio:start'>): void
  audioChunk(payload: AudioChunkMessage): void
  audioStop(): void
}

/** Сегмент распознавания для передачи в renderer (совпадает по форме с main SttSegment). */
export interface SttSegmentWire {
  speakerId: number
  text: string
  start?: number
  end?: number
}

/** Обновление распознавания (частичное или финальное). */
export interface SttUpdate {
  segments: SttSegmentWire[]
  text: string
}

/**
 * События main → renderer (webContents.send). Поток результатов STT.
 */
export interface IpcEventMap {
  'stt:partial': SttUpdate
  'stt:final': SttUpdate
  'stt:error': { message: string }
  /** Очередной фрагмент ответа Claude. */
  'claude:token': { conversationId: string; delta: string }
  /** Ответ Claude завершён (полный текст + метаданные хода). */
  'claude:done': { conversationId: string; text: string; meta?: TurnMeta }
  /** Ошибка при запросе к Claude. */
  'claude:error': { conversationId: string; message: string }
  /** Запись активности агента (режим консоли). */
  'claude:log': { conversationId: string; entry: ClaudeLogEntry }
  /** Прогресс скачивания модели Whisper (0–100). */
  'stt:downloadProgress': { percent: number }
  /** Скачивание модели завершено. */
  'stt:downloadDone': void
  /** Ошибка скачивания модели. */
  'stt:downloadError': { message: string }
  /** Синтезированное аудио ответа (байты WAV) для воспроизведения в renderer. */
  'tts:audio': { audio: ArrayBuffer }
  /** Ошибка озвучки (синтеза). */
  'tts:error': { message: string }
  /** Прогресс скачивания голоса (0–100). */
  'tts:voiceProgress': { id: string; percent: number }
  /** Голос скачан. */
  'tts:voiceDone': { id: string }
  /** Ошибка скачивания голоса. */
  'tts:voiceError': { id: string; message: string }
}

export type IpcEventChannel = keyof IpcEventMap
export type IpcEventPayload<C extends IpcEventChannel> = IpcEventMap[C]

export const IPC_EVENT_CHANNELS: IpcEventChannel[] = [
  'stt:partial',
  'stt:final',
  'stt:error',
  'claude:token',
  'claude:done',
  'claude:error',
  'claude:log',
  'stt:downloadProgress',
  'stt:downloadDone',
  'stt:downloadError',
  'tts:audio',
  'tts:error',
  'tts:voiceProgress',
  'tts:voiceDone',
  'tts:voiceError'
]

/**
 * Мост событий STT, доступный в renderer как `window.stt`. Каждый метод
 * подписывается на событие и возвращает функцию отписки.
 */
export interface RendererSttBridge {
  onPartial(cb: (update: SttUpdate) => void): () => void
  onFinal(cb: (update: SttUpdate) => void): () => void
  onError(cb: (err: { message: string }) => void): () => void
  /** Запустить скачивание модели (renderer → main). */
  download(): void
  onDownloadProgress(cb: (p: { percent: number }) => void): () => void
  onDownloadDone(cb: () => void): () => void
  onDownloadError(cb: (err: { message: string }) => void): () => void
}

/**
 * Мост Claude, доступный в renderer как `window.claude`: отправка реплики,
 * отмена и подписка на поток ответа (main → renderer).
 */
export interface RendererClaudeBridge {
  send(payload: IpcSendPayload<'claude:send'>): void
  cancel(): void
  onToken(cb: (msg: IpcEventPayload<'claude:token'>) => void): () => void
  onDone(cb: (msg: IpcEventPayload<'claude:done'>) => void): () => void
  onError(cb: (msg: IpcEventPayload<'claude:error'>) => void): () => void
  /** Подписка на активность агента (режим консоли). */
  onLog(cb: (msg: IpcEventPayload<'claude:log'>) => void): () => void
}

/**
 * Мост TTS, доступный в renderer как `window.tts`: озвучка, отмена и подписка
 * на завершение/ошибку.
 */
export interface RendererTtsBridge {
  speak(payload: IpcSendPayload<'tts:speak'>): void
  cancel(): void
  onAudio(cb: (msg: IpcEventPayload<'tts:audio'>) => void): () => void
  onError(cb: (err: { message: string }) => void): () => void
  /** Скачать голос Piper по id. */
  downloadVoice(payload: IpcSendPayload<'tts:downloadVoice'>): void
  onVoiceProgress(cb: (msg: IpcEventPayload<'tts:voiceProgress'>) => void): () => void
  onVoiceDone(cb: (msg: IpcEventPayload<'tts:voiceDone'>) => void): () => void
  onVoiceError(cb: (msg: IpcEventPayload<'tts:voiceError'>) => void): () => void
}

export const IPC_CHANNELS: IpcChannel[] = [
  'app:ping',
  'conversations:list',
  'conversations:create',
  'conversations:get',
  'conversations:search',
  'conversations:rename',
  'conversations:delete',
  'messages:add',
  'messages:delete',
  'uploads:add',
  'settings:get',
  'settings:save',
  'stt:status',
  'stt:models',
  'stt:deleteModel',
  'tts:voices',
  'tts:catalog',
  'tts:deleteVoice'
]

/**
 * Форма моста, доступного в renderer как `window.api`.
 * Каждый канал становится методом с типизированным аргументом и Promise-результатом.
 */
export type RendererApi = {
  [C in IpcChannel]: IpcArg<C> extends void
    ? () => Promise<IpcResult<C>>
    : (arg: IpcArg<C>) => Promise<IpcResult<C>>
}
