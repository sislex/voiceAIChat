// window.api поверх REST сервера (удалённый режим web/desktop). Каналы 1:1
// соответствуют Electron invoke-каналам. httpBase — базовый HTTP-URL сервера
// ('' = same-origin), agentWsUrl — ws-адрес /agent для строки подключения.

import { REST } from '@shared/protocol'
import { encodeAgentConnection } from '@shared/agentProtocol'
import type { RendererApi } from '@shared/ipc'

export function createHttpApi(httpBase: string, agentWsUrl: string): RendererApi {
  async function req<T>(path: string, init?: RequestInit): Promise<T> {
    // Content-Type ставим только при наличии тела: иначе Fastify пытается распарсить
    // пустое JSON-тело у DELETE и отвечает 400.
    const headers = init?.body != null ? { 'content-type': 'application/json' } : undefined
    const res = await fetch(httpBase + path, { ...init, headers })
    if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}`)
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  return {
    'app:ping': async () => {
      const h = await req<{ version: string }>(REST.health)
      return h.version
    },
    'conversations:list': () => req(REST.conversations),
    'conversations:create': ({ title }) =>
      req(REST.conversations, { method: 'POST', body: JSON.stringify({ title }) }),
    'conversations:get': async ({ id }) => {
      const res = await fetch(httpBase + REST.conversation(id))
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`GET ${REST.conversation(id)} → ${res.status}`)
      return res.json()
    },
    'conversations:search': ({ query }) =>
      req(`${REST.conversationsSearch}?q=${encodeURIComponent(query)}`),
    'conversations:rename': async ({ id, title }) => {
      await req(REST.conversation(id), { method: 'PATCH', body: JSON.stringify({ title }) })
    },
    'conversations:delete': async ({ id }) => {
      await req(REST.conversation(id), { method: 'DELETE' })
    },
    'messages:add': ({ conversationId, role, text, time }) =>
      req(REST.messages(conversationId), {
        method: 'POST',
        body: JSON.stringify({ role, text, time })
      }),
    'messages:delete': async ({ conversationId, messageId }) => {
      await req(REST.message(conversationId, messageId), { method: 'DELETE' })
    },
    'uploads:add': ({ name, dataBase64 }) =>
      req(REST.uploads, { method: 'POST', body: JSON.stringify({ name, dataBase64 }) }),
    'settings:get': () => req(REST.settings),
    'settings:save': async (settings) => {
      await req(REST.settings, { method: 'PUT', body: JSON.stringify(settings) })
    },
    'stt:status': () => req(REST.sttStatus),
    'stt:models': () => req(REST.sttModels),
    'stt:deleteModel': async ({ model }) => {
      await req(REST.sttModel(model), { method: 'DELETE' })
    },
    'tts:voices': () => req(REST.ttsVoices),
    'tts:catalog': () => req(REST.ttsCatalog),
    'tts:deleteVoice': async ({ id }) => {
      await req(REST.ttsVoice(id), { method: 'DELETE' })
    },
    'mcp:list': () => req(REST.mcpServers),
    'agents:list': () => req(REST.agents),
    'agents:create': ({ name }) =>
      req(REST.agents, { method: 'POST', body: JSON.stringify({ name }) }),
    'agents:delete': async ({ id }) => {
      await req(REST.agent(id), { method: 'DELETE' })
    },
    'agents:setPolicy': async ({ id, policy }) => {
      await req(REST.agentPolicy(id), { method: 'POST', body: JSON.stringify({ policy }) })
    },
    'agents:regenerateToken': ({ id }) => req(REST.agentToken(id), { method: 'POST' }),
    'downloads:url': async ({ kind }) => {
      const path =
        kind === 'desktop'
          ? REST.desktopApp
          : kind === 'agent-app'
            ? REST.agentApp
            : REST.agentScript
      return httpBase + path
    },
    'agents:connectionString': async ({ token }) => encodeAgentConnection({ server: agentWsUrl, token }),
    'cc:projects': () => req(REST.ccProjects),
    'cc:sessions': ({ slug }) => req(REST.ccSessions(slug)),
    'cc:transcript': ({ slug, id, limit }) =>
      req(REST.ccTranscript(slug, id) + (limit ? `?limit=${limit}` : '')),
    'cc:resume': ({ slug, id }) =>
      req(REST.ccResume, { method: 'POST', body: JSON.stringify({ slug, id }) })
  }
}
