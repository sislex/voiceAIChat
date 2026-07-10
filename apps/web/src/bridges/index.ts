// Инициализация мостов window.* для веб-клиента: один WsClient + HTTP-api.
// Формы совпадают с @shared/ipc, поэтому стор/компоненты renderer не меняются.

import type {
  RendererAudioBridge,
  RendererClaudeBridge,
  RendererSttBridge,
  RendererTtsBridge
} from '@shared/ipc'
import { WsClient } from './wsClient'
import { createHttpApi } from './httpApi'
import { serverWsUrl } from './config'
import { base64ToArrayBuffer } from './decode'

function makeAudioBridge(ws: WsClient): RendererAudioBridge {
  return {
    audioStart: ({ sampleRate }) => ws.send({ t: 'audio.start', sampleRate }),
    audioChunk: ({ pcm }) => ws.sendBinary(pcm),
    audioStop: () => ws.send({ t: 'audio.stop' })
  }
}

function makeSttBridge(ws: WsClient): RendererSttBridge {
  return {
    onPartial: (cb) => ws.on('stt.partial', (m) => cb(m.update)),
    onFinal: (cb) => ws.on('stt.final', (m) => cb(m.update)),
    onError: (cb) => ws.on('stt.error', (m) => cb({ message: m.message })),
    download: () => ws.send({ t: 'stt.download' }),
    onDownloadProgress: (cb) => ws.on('stt.downloadProgress', (m) => cb({ percent: m.percent })),
    onDownloadDone: (cb) => ws.on('stt.downloadDone', () => cb()),
    onDownloadError: (cb) => ws.on('stt.downloadError', (m) => cb({ message: m.message }))
  }
}

function makeClaudeBridge(ws: WsClient): RendererClaudeBridge {
  return {
    send: ({ conversationId, segments, attachments }) =>
      ws.send({ t: 'claude.send', conversationId, segments, attachments }),
    cancel: () => ws.send({ t: 'claude.cancel' }),
    onToken: (cb) =>
      ws.on('claude.token', (m) => cb({ conversationId: m.conversationId, delta: m.delta })),
    onDone: (cb) => ws.on('claude.done', (m) => cb({ conversationId: m.conversationId, text: m.text })),
    onError: (cb) =>
      ws.on('claude.error', (m) => cb({ conversationId: m.conversationId, message: m.message }))
  }
}

function makeTtsBridge(ws: WsClient): RendererTtsBridge {
  return {
    speak: ({ text, voice }) => ws.send({ t: 'tts.speak', text, voice }),
    cancel: () => ws.send({ t: 'tts.cancel' }),
    onAudio: (cb) => ws.on('tts.audio', (m) => cb({ audio: base64ToArrayBuffer(m.audio) })),
    onError: (cb) => ws.on('tts.error', (m) => cb({ message: m.message })),
    downloadVoice: ({ id }) => ws.send({ t: 'tts.downloadVoice', id }),
    onVoiceProgress: (cb) => ws.on('tts.voiceProgress', (m) => cb({ id: m.id, percent: m.percent })),
    onVoiceDone: (cb) => ws.on('tts.voiceDone', (m) => cb({ id: m.id })),
    onVoiceError: (cb) => ws.on('tts.voiceError', (m) => cb({ id: m.id, message: m.message }))
  }
}

let installed = false

/** Устанавливает window.api/audio/stt/claude/tts. Идемпотентно. */
export function installBridges(): void {
  if (installed) return
  installed = true
  const ws = new WsClient(serverWsUrl())
  window.api = createHttpApi()
  window.audio = makeAudioBridge(ws)
  window.stt = makeSttBridge(ws)
  window.claude = makeClaudeBridge(ws)
  window.tts = makeTtsBridge(ws)
}
