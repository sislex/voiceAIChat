// Единый контракт IPC между main и renderer.
// И preload, и main строятся от этих типов — рассинхрон ловится компилятором.

import type {
  ClaudeLogEntry,
  Conversation,
  LlmProvider,
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
import type { CcProject, CcSession, CcItem } from './cc'
import type { CxProject, CxSession, CxItem } from './codexSessions'
import type { AgentCreated, AgentInfo, AgentPolicy } from './agentProtocol'

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
  /** Движок ответа (для роли 'ai'); запекается в сообщение. */
  engine?: LlmProvider
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
  /** Список подключённых MCP-серверов (read-only, из `claude mcp list`). */
  'mcp:list': { arg: void; result: McpServer[] }
  /** Машины-агенты для удалённого выполнения команд (только web-режим). */
  'agents:list': { arg: void; result: AgentInfo[] }
  /** Создать машину-агента; токен возвращается один раз. */
  'agents:create': { arg: { name: string }; result: AgentCreated }
  /** Удалить машину-агента (отзывает токен, рвёт соединение). */
  'agents:delete': { arg: { id: string }; result: void }
  /** Задать политику возможностей машины. */
  'agents:setPolicy': { arg: { id: string; policy: AgentPolicy }; result: void }
  /** Перевыпустить токен (старый перестаёт работать); токен возвращается один раз. */
  'agents:regenerateToken': { arg: { id: string }; result: { token: string } }
  /** Абсолютный URL артефакта для скачивания (десктоп/агент-приложение/скрипт). */
  'downloads:url': { arg: { kind: 'desktop' | 'agent-app' | 'agent-script' }; result: string }
  /** Строка подключения (адрес+токен) для настройки агента (приложение и скрипт). */
  'agents:connectionString': { arg: { token: string }; result: string }
  /** Проекты Claude Code (~/.claude/projects). */
  'cc:projects': { arg: void; result: CcProject[] }
  /** Сессии проекта Claude Code. */
  'cc:sessions': { arg: { slug: string }; result: CcSession[] }
  /** Транскрипт сессии (последние `limit` записей). */
  'cc:transcript': { arg: { slug: string; id: string; limit?: number }; result: CcItem[] }
  /**
   * Продолжить сессию Claude Code: создаёт разговор с импортом истории и
   * привязкой к session-id (следующий ход — через `claude --resume`).
   */
  'cc:resume': { arg: { slug: string; id: string }; result: ConversationWithMessages }
  /** «Проекты» Codex (cwd-группы сессий ~/.codex/sessions). */
  'cx:projects': { arg: void; result: CxProject[] }
  /** Сессии Codex с указанным cwd. */
  'cx:sessions': { arg: { cwd: string }; result: CxSession[] }
  /** Транскрипт сессии Codex по id (последние `limit` записей). */
  'cx:transcript': { arg: { id: string; limit?: number }; result: CxItem[] }
  /**
   * Продолжить сессию Codex: создаёт разговор с импортом истории и привязкой
   * к session-id (следующий ход — через `codex exec resume <id>`).
   */
  'cx:resume': { arg: { id: string }; result: ConversationWithMessages }
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
  /** Начать live-слежение за сессией Claude Code. */
  'cc:tailStart': { slug: string; id: string }
  /** Остановить live-слежение. */
  'cc:tailStop': void
  /** Начать live-слежение за сессией Codex. */
  'cx:tailStart': { id: string }
  /** Остановить live-слежение Codex. */
  'cx:tailStop': void
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
  'tts:downloadVoice',
  'cc:tailStart',
  'cc:tailStop',
  'cx:tailStart',
  'cx:tailStop'
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
  /** Ответ Claude завершён (полный текст + метаданные хода + движок ответа). */
  'claude:done': { conversationId: string; text: string; meta?: TurnMeta; engine?: LlmProvider }
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
  /** Новые записи транскрипта отслеживаемой сессии Claude Code (live-tail). */
  'cc:tail': { slug: string; id: string; items: CcItem[] }
  /** Новые записи транскрипта отслеживаемой сессии Codex (live-tail). */
  'cx:tail': { id: string; items: CxItem[] }
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
  'tts:voiceError',
  'cc:tail',
  'cx:tail'
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
 * Мост живого списка машин-агентов, доступный как `window.agents`: подписка на
 * обновления статуса/списка по WebSocket (web-режим). В desktop отсутствует.
 */
export interface RendererAgentsBridge {
  onChange(cb: (agents: AgentInfo[]) => void): () => void
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
 * Мост Проводника Claude Code, доступный в renderer как `window.cc`:
 * live-tail активной сессии (invoke-часть — через `window.api`).
 */
export interface RendererCcBridge {
  /** Начать слежение за сессией. */
  tailStart(payload: IpcSendPayload<'cc:tailStart'>): void
  /** Остановить слежение. */
  tailStop(): void
  /** Подписка на новые записи транскрипта. */
  onTail(cb: (msg: IpcEventPayload<'cc:tail'>) => void): () => void
}

/**
 * Мост Проводника Codex, доступный в renderer как `window.codex`:
 * live-tail активной сессии (invoke-часть — через `window.api`).
 */
export interface RendererCodexBridge {
  /** Начать слежение за сессией Codex. */
  tailStart(payload: IpcSendPayload<'cx:tailStart'>): void
  /** Остановить слежение. */
  tailStop(): void
  /** Подписка на новые записи транскрипта. */
  onTail(cb: (msg: IpcEventPayload<'cx:tail'>) => void): () => void
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
  'tts:deleteVoice',
  'mcp:list',
  'agents:list',
  'agents:create',
  'agents:delete',
  'agents:setPolicy',
  'agents:regenerateToken',
  'downloads:url',
  'agents:connectionString',
  'cc:projects',
  'cc:sessions',
  'cc:transcript',
  'cc:resume',
  'cx:projects',
  'cx:sessions',
  'cx:transcript',
  'cx:resume'
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
