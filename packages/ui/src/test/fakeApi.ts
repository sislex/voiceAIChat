// In-memory фейк window.api (RendererApi) для тестов renderer/стора.
// Повторяет контракт IPC без Electron/SQLite: детерминированные id и время.

import type { RendererApi } from '@shared/ipc'
import type { Conversation, Message, Settings } from '@shared/types'
import type { AgentInfo } from '@shared/agentProtocol'
import { DEFAULT_AGENT_POLICY } from '@shared/agentProtocol'
import { DEFAULT_SETTINGS } from '@shared/types'

export interface FakeApi extends RendererApi {
  /** Прямой доступ к состоянию для ассертов в тестах. */
  _state: {
    conversations: Conversation[]
    messages: Message[]
    settings: Settings
  }
}

export function createFakeApi(seedConversations: string[] = []): FakeApi {
  let idCounter = 0
  let clock = 1_700_000_000_000
  const nextId = (): string => `id-${++idCounter}`
  const tick = (): number => (clock += 1000)

  const conversations: Conversation[] = []
  const messages: Message[] = []
  const agents: AgentInfo[] = []
  let settings: Settings = { ...DEFAULT_SETTINGS }

  function makeConversation(title: string): Conversation {
    const ts = tick()
    return { id: nextId(), title, createdAt: ts, updatedAt: ts, messageCount: 0, claudeSessionId: null }
  }

  for (const title of seedConversations) conversations.push(makeConversation(title))

  function withCounts(c: Conversation): Conversation {
    return { ...c, messageCount: messages.filter((m) => m.conversationId === c.id).length }
  }

  const api: FakeApi = {
    'app:ping': async () => 'pong',
    'conversations:list': async () =>
      [...conversations].sort((a, b) => b.updatedAt - a.updatedAt).map(withCounts),
    'conversations:create': async ({ title } = {}) => {
      const conv = makeConversation(title ?? 'Новый разговор')
      conversations.push(conv)
      return conv
    },
    'conversations:get': async ({ id }) => {
      const conv = conversations.find((c) => c.id === id)
      if (!conv) return null
      return {
        conversation: withCounts(conv),
        messages: messages
          .filter((m) => m.conversationId === id)
          .sort((a, b) => a.createdAt - b.createdAt)
      }
    },
    'conversations:search': async ({ query }) => {
      const q = query.trim().toLowerCase()
      if (!q) return [...conversations].sort((a, b) => b.updatedAt - a.updatedAt).map(withCounts)
      return [...conversations]
        .filter(
          (c) =>
            c.title.toLowerCase().includes(q) ||
            messages.some((m) => m.conversationId === c.id && m.text.toLowerCase().includes(q))
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(withCounts)
    },
    'conversations:rename': async ({ id, title }) => {
      const conv = conversations.find((c) => c.id === id)
      if (conv) {
        conv.title = title
        conv.updatedAt = tick()
      }
    },
    'conversations:delete': async ({ id }) => {
      const idx = conversations.findIndex((c) => c.id === id)
      if (idx >= 0) conversations.splice(idx, 1)
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].conversationId === id) messages.splice(i, 1)
      }
    },
    'messages:add': async ({ conversationId, role, text, time, engine, meta }) => {
      const msg: Message = {
        id: nextId(),
        conversationId,
        role,
        text,
        time,
        createdAt: tick(),
        ...(engine ? { engine } : {}),
        ...(meta ? { meta } : {})
      }
      messages.push(msg)
      const conv = conversations.find((c) => c.id === conversationId)
      if (conv) conv.updatedAt = msg.createdAt
      return msg
    },
    'messages:delete': async ({ messageId }) => {
      const idx = messages.findIndex((m) => m.id === messageId)
      if (idx >= 0) messages.splice(idx, 1)
    },
    'uploads:add': async ({ name }) => ({ id: nextId(), name }),
    'settings:get': async () => ({ ...settings }),
    'settings:save': async (next) => {
      settings = { ...next }
    },
    'stt:status': async () => ({ present: true, model: settings.whisperModel }),
    'stt:models': async () => [
      { model: 'large-v3-turbo', present: true, sizeBytes: 1_624_555_275 },
      { model: 'medium', present: false, sizeBytes: 0 },
      { model: 'small', present: false, sizeBytes: 0 }
    ],
    'stt:deleteModel': async () => {},
    'tts:deleteVoice': async () => {},
    'mcp:list': async () => [],
    'auth:status': async () => ({
      claude: { provider: 'claude', loggedIn: true, detail: 'подписка team' },
      codex: { provider: 'codex', loggedIn: false, detail: 'вход не выполнен — выполните `codex login`' }
    }),
    'agents:list': async () => agents.map((a) => ({ ...a })),
    'agents:create': async ({ name }) => {
      const agent: AgentInfo = {
        id: nextId(),
        name,
        online: false,
        createdAt: tick(),
        lastSeen: null,
        policy: { ...DEFAULT_AGENT_POLICY }
      }
      agents.push(agent)
      return { id: agent.id, name, token: `token-${agent.id}` }
    },
    'agents:delete': async ({ id }) => {
      const idx = agents.findIndex((a) => a.id === id)
      if (idx >= 0) agents.splice(idx, 1)
    },
    'agents:setPolicy': async ({ id, policy }) => {
      const a = agents.find((x) => x.id === id)
      if (a) a.policy = policy
    },
    'agents:regenerateToken': async ({ id }) => ({ token: `token2-${id}` }),
    'downloads:url': async ({ kind }) => `http://localhost/api/download/${kind}`,
    'agents:connectionString': async ({ token }) => `vcagent:fake-${token}`,
    'cc:projects': async () => [],
    'cc:sessions': async () => [],
    'cc:transcript': async () => [],
    'cc:resume': async ({ id }) => {
      const conv = makeConversation(`Продолжение ${id}`)
      conversations.push(conv)
      return { conversation: withCounts(conv), messages: [] }
    },
    'cx:projects': async () => [],
    'cx:sessions': async () => [],
    'cx:transcript': async () => [],
    'cx:resume': async ({ id }) => {
      const conv = makeConversation(`Продолжение Codex ${id}`)
      conversations.push(conv)
      return { conversation: withCounts(conv), messages: [] }
    },
    'tts:voices': async () => [
      { id: 'ru_RU-irina-medium', label: 'Irina — русский (medium)' },
      { id: 'ru_RU-dmitri-medium', label: 'Dmitri — русский (medium)' }
    ],
    'tts:catalog': async () => ({
      downloadable: true,
      voices: [
        { id: 'ru_RU-irina-medium', label: 'Irina — русский (medium)', installed: true },
        { id: 'ru_RU-ruslan-medium', label: 'Ruslan — русский (medium)', installed: false }
      ]
    }),
    _state: {
      get conversations() {
        return conversations
      },
      get messages() {
        return messages
      },
      get settings() {
        return settings
      }
    }
  }

  return api
}
