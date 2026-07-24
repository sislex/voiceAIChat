// Установка мостов window.* поверх REST+WS сервера — удалённый режим.
// Используется веб-клиентом (same-origin/VITE_SERVER_URL) и десктопом в роли
// тонкого клиента (URL сервера задаётся пользователем). Формы совпадают с
// @shared/ipc, поэтому UI/стор работают без изменений.

import type {
  RendererAgentsBridge,
  RendererAudioBridge,
  RendererCcBridge,
  RendererClaudeBridge,
  RendererCodexBridge,
  RendererSessionBridge,
  RendererSttBridge,
  RendererTtsBridge
} from '@shared/ipc'
import { REST } from '@shared/protocol'
import type { SessionUser } from '@shared/types'
import { WsClient } from './wsClient'
import { createHttpApi } from './httpApi'
import { getToken, setToken } from './session'
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
    send: ({ conversationId, segments, attachments, verbose }) =>
      ws.send({ t: 'claude.send', conversationId, segments, attachments, verbose }),
    cancel: (payload) =>
      ws.send({
        t: 'claude.cancel',
        ...(payload?.conversationId ? { conversationId: payload.conversationId } : {})
      }),
    onToken: (cb) =>
      ws.on('claude.token', (m) => cb({ conversationId: m.conversationId, delta: m.delta })),
    onDone: (cb) =>
      ws.on('claude.done', (m) =>
        cb({
          conversationId: m.conversationId,
          text: m.text,
          meta: m.meta,
          engine: m.engine,
          message: m.message
        })
      ),
    onError: (cb) =>
      ws.on('claude.error', (m) => cb({ conversationId: m.conversationId, message: m.message })),
    onLog: (cb) =>
      ws.on('claude.log', (m) => cb({ conversationId: m.conversationId, entry: m.entry })),
    onActive: (cb) => ws.on('claude.active', (m) => cb({ turns: m.turns }))
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

function makeCcBridge(ws: WsClient): RendererCcBridge {
  return {
    tailStart: ({ slug, id }) => ws.send({ t: 'cc.tail.start', slug, id }),
    tailStop: () => ws.send({ t: 'cc.tail.stop' }),
    onTail: (cb) => ws.on('cc.tail', (m) => cb({ slug: m.slug, id: m.id, items: m.items }))
  }
}

function makeCodexBridge(ws: WsClient): RendererCodexBridge {
  return {
    tailStart: ({ id }) => ws.send({ t: 'cx.tail.start', id }),
    tailStop: () => ws.send({ t: 'cx.tail.stop' }),
    onTail: (cb) => ws.on('cx.tail', (m) => cb({ id: m.id, items: m.items }))
  }
}

function makeAgentsBridge(ws: WsClient): RendererAgentsBridge {
  return { onChange: (cb) => ws.on('agents', (m) => cb(m.agents)) }
}

/** Мост сессии поверх REST: логин сохраняет токен и перезапускает WS с ним. */
function makeSessionBridge(httpBase: string, ws: WsClient): RendererSessionBridge {
  const authHeaders = (): Record<string, string> => {
    const t = getToken()
    return t ? { authorization: `Bearer ${t}` } : {}
  }
  return {
    login: async ({ name, password }) => {
      const res = await fetch(httpBase + REST.sessionLogin, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, password })
      })
      if (!res.ok) return null
      const { token, user } = (await res.json()) as { token: string; user: SessionUser }
      setToken(token)
      ws.reconnect() // теперь есть токен — поднимаем WS-соединение
      return user
    },
    me: async () => {
      if (!getToken()) return null
      const res = await fetch(httpBase + REST.sessionMe, { headers: authHeaders() })
      if (!res.ok) return null
      const { user } = (await res.json()) as { user: SessionUser | null }
      return user ?? null
    },
    logout: async () => {
      setToken(null)
      ws.reconnect() // рвём авторизованное соединение
    }
  }
}

/** http→ws, same-origin если base пустой. */
function toWsBase(httpBase: string): string {
  if (httpBase) return httpBase.replace(/^http/, 'ws')
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}`
}

let ws: WsClient | null = null

/**
 * Ставит window.api/audio/stt/claude/tts/cc/agents поверх сервера по адресу
 * serverHttp ('' = same-origin). Идемпотентно на один процесс.
 */
export function installRemoteBridges(serverHttp: string): void {
  if (ws) return
  const httpBase = serverHttp.replace(/\/$/, '')
  const wsBase = toWsBase(httpBase)
  // WS дозванивается только при наличии токена сессии (getToken) — до логина ждём.
  ws = new WsClient(`${wsBase}/ws`, getToken)
  window.api = createHttpApi(httpBase, `${wsBase}/agent`)
  window.audio = makeAudioBridge(ws)
  window.stt = makeSttBridge(ws)
  window.claude = makeClaudeBridge(ws)
  window.tts = makeTtsBridge(ws)
  window.cc = makeCcBridge(ws)
  window.codex = makeCodexBridge(ws)
  window.agents = makeAgentsBridge(ws)
  window.session = makeSessionBridge(httpBase, ws)
}
