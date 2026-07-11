import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC_CHANNELS,
  type IpcEventPayload,
  type RendererApi,
  type RendererAudioBridge,
  type RendererClaudeBridge,
  type RendererSttBridge,
  type RendererTtsBridge,
  type SttUpdate
} from '@shared/ipc'

// Строим мост из списка каналов: каждый канал → метод, дергающий ipcRenderer.invoke.
const api = Object.fromEntries(
  IPC_CHANNELS.map((channel) => [channel, (arg?: unknown) => ipcRenderer.invoke(channel, arg)])
) as unknown as RendererApi

// Отдельный мост для потока аудио (односторонний send, без ответа).
const audio: RendererAudioBridge = {
  audioStart: (payload) => ipcRenderer.send('audio:start', payload),
  audioChunk: (payload) => ipcRenderer.send('audio:chunk', payload),
  audioStop: () => ipcRenderer.send('audio:stop')
}

/** Подписка на событие main→renderer с возвратом функции отписки. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// Мост событий распознавания речи (main → renderer).
const stt: RendererSttBridge = {
  onPartial: (cb) => subscribe<SttUpdate>('stt:partial', cb),
  onFinal: (cb) => subscribe<SttUpdate>('stt:final', cb),
  onError: (cb) => subscribe<{ message: string }>('stt:error', cb),
  download: () => ipcRenderer.send('stt:download'),
  onDownloadProgress: (cb) => subscribe<{ percent: number }>('stt:downloadProgress', cb),
  onDownloadDone: (cb) => subscribe<void>('stt:downloadDone', () => cb()),
  onDownloadError: (cb) => subscribe<{ message: string }>('stt:downloadError', cb)
}

// Мост Claude: отправка/отмена (renderer → main) + поток ответа (main → renderer).
const claude: RendererClaudeBridge = {
  send: (payload) => ipcRenderer.send('claude:send', payload),
  cancel: () => ipcRenderer.send('claude:cancel'),
  onToken: (cb) => subscribe<IpcEventPayload<'claude:token'>>('claude:token', cb),
  onDone: (cb) => subscribe<IpcEventPayload<'claude:done'>>('claude:done', cb),
  onError: (cb) => subscribe<IpcEventPayload<'claude:error'>>('claude:error', cb),
  onLog: (cb) => subscribe<IpcEventPayload<'claude:log'>>('claude:log', cb)
}

// Мост TTS: озвучка/отмена (renderer → main) + завершение (main → renderer).
const tts: RendererTtsBridge = {
  speak: (payload) => ipcRenderer.send('tts:speak', payload),
  cancel: () => ipcRenderer.send('tts:cancel'),
  onAudio: (cb) => subscribe<IpcEventPayload<'tts:audio'>>('tts:audio', cb),
  onError: (cb) => subscribe<{ message: string }>('tts:error', cb),
  downloadVoice: (payload) => ipcRenderer.send('tts:downloadVoice', payload),
  onVoiceProgress: (cb) => subscribe<IpcEventPayload<'tts:voiceProgress'>>('tts:voiceProgress', cb),
  onVoiceDone: (cb) => subscribe<IpcEventPayload<'tts:voiceDone'>>('tts:voiceDone', cb),
  onVoiceError: (cb) => subscribe<IpcEventPayload<'tts:voiceError'>>('tts:voiceError', cb)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('audio', audio)
    contextBridge.exposeInMainWorld('stt', stt)
    contextBridge.exposeInMainWorld('claude', claude)
    contextBridge.exposeInMainWorld('tts', tts)
  } catch (error) {
    console.error('[preload] exposeInMainWorld failed', error)
  }
} else {
  const g = globalThis as unknown as {
    api: RendererApi
    audio: RendererAudioBridge
    stt: RendererSttBridge
    claude: RendererClaudeBridge
    tts: RendererTtsBridge
  }
  g.api = api
  g.audio = audio
  g.stt = stt
  g.claude = claude
  g.tts = tts
}
