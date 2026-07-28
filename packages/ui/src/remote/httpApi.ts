// window.api поверх REST сервера (удалённый режим web/desktop). Каналы 1:1
// соответствуют Electron invoke-каналам. httpBase — базовый HTTP-URL сервера
// ('' = same-origin), agentWsUrl — ws-адрес /agent для строки подключения.

import { REST } from '@shared/protocol'
import { encodeAgentConnection } from '@shared/agentProtocol'
import type { RendererApi } from '@shared/ipc'
import { getToken } from './session'

export function createHttpApi(httpBase: string, agentWsUrl: string): RendererApi {
  async function req<T>(path: string, init?: RequestInit): Promise<T> {
    // Content-Type ставим только при наличии тела: иначе Fastify пытается распарсить
    // пустое JSON-тело у DELETE и отвечает 400. Токен сессии — в Authorization.
    const headers: Record<string, string> = {}
    if (init?.body != null) headers['content-type'] = 'application/json'
    const token = getToken()
    if (token) headers['authorization'] = `Bearer ${token}`
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
    'kb:status': () => req(REST.kbStatus),
    'kb:topics': () => req(REST.kbTopics),
    'kb:search': ({ query, kinds, tags, limit }) => {
      const q = new URLSearchParams({ q: query })
      if (kinds?.length) q.set('kind', kinds.join(','))
      if (tags?.length) q.set('tags', tags.join(','))
      if (limit) q.set('limit', String(limit))
      return req(`${REST.kbSearch}?${q.toString()}`)
    },
    'kb:document': async ({ id }) => {
      try { return await req(REST.kbDocument(id)) } catch { return null }
    },
    'kb:context': ({ query, budget }) => req(`${REST.kbContext}?q=${encodeURIComponent(query)}${budget ? `&budget=${budget}` : ''}`),
    'prompt:suggest': ({ text }) => req(REST.promptSuggest, { method: 'POST', body: JSON.stringify({ text }) }),
    'conversations:list': () => req(REST.conversations),
    'conversations:create': ({ title }) =>
      req(REST.conversations, { method: 'POST', body: JSON.stringify({ title }) }),
    'conversations:get': async ({ id }) => {
      const token = getToken()
      const res = await fetch(httpBase + REST.conversation(id), {
        headers: token ? { authorization: `Bearer ${token}` } : undefined
      })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`GET ${REST.conversation(id)} → ${res.status}`)
      return res.json()
    },
    'conversations:search': ({ query }) =>
      req(`${REST.conversationsSearch}?q=${encodeURIComponent(query)}`),
    'conversations:rename': async ({ id, title }) => {
      await req(REST.conversation(id), { method: 'PATCH', body: JSON.stringify({ title }) })
    },
    'conversations:setProject': ({ id, projectId }) =>
      req(REST.conversationProject(id), { method: 'POST', body: JSON.stringify({ projectId }) }),
    'conversations:setStatus': ({ id, status }) =>
      req(REST.conversationStatus(id), { method: 'POST', body: JSON.stringify({ status }) }),
    'conversations:setExecTarget': ({ id, execTarget, workdir, skillNames, llmProvider, llmModel, permissionMode, kbContextMode }) =>
      req(REST.conversation(id), {
        method: 'PATCH',
        body: JSON.stringify({
          execTarget,
          ...(workdir !== undefined ? { workdir } : {}),
          ...(skillNames !== undefined ? { skillNames } : {}),
          ...(llmProvider !== undefined ? { llmProvider } : {}),
          ...(llmModel !== undefined ? { llmModel } : {}),
          ...(permissionMode !== undefined ? { permissionMode } : {}),
          ...(kbContextMode !== undefined ? { kbContextMode } : {})
        })
      }),
    'conversations:delete': async ({ id }) => {
      await req(REST.conversation(id), { method: 'DELETE' })
    },
    'messages:add': ({ conversationId, role, text, time, engine, meta, execTarget }) =>
      req(REST.messages(conversationId), {
        method: 'POST',
        body: JSON.stringify({ role, text, time, ...(engine ? { engine } : {}), ...(meta ? { meta } : {}), ...(execTarget !== undefined ? { execTarget } : {}) })
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
    'system:capabilities': () => req(REST.systemCapabilities),
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
    'auth:status': () => req(REST.authStatus),
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
    'agents:update': ({ id }) => req(REST.agentUpdate(id), { method: 'POST' }),
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
      req(REST.ccResume, { method: 'POST', body: JSON.stringify({ slug, id }) }),
    'cx:projects': () => req(REST.cxProjects),
    'cx:sessions': ({ cwd }) => req(`${REST.cxSessions}?cwd=${encodeURIComponent(cwd)}`),
    'cx:transcript': ({ id, limit }) =>
      req(`${REST.cxTranscript}?id=${encodeURIComponent(id)}${limit ? `&limit=${limit}` : ''}`),
    'cx:resume': ({ id }) => req(REST.cxResume, { method: 'POST', body: JSON.stringify({ id }) }),
    'admin:users': () => req(REST.adminUsers),
    'admin:createUser': (b) =>
      req(REST.adminUsers, { method: 'POST', body: JSON.stringify(b) }),
    'admin:setBlocked': async ({ name, blocked }) => {
      await req(REST.adminUserBlock(name), { method: 'POST', body: JSON.stringify({ blocked }) })
    },
    'admin:deleteUser': async ({ name }) => {
      await req(REST.adminUser(name), { method: 'DELETE' })
    },
    'admin:usage': ({ name, unit, from, to }) => {
      const q = new URLSearchParams({ unit })
      if (from) q.set('from', String(from))
      if (to) q.set('to', String(to))
      return req(`${REST.adminUserUsage(name)}?${q.toString()}`)
    },
    'admin:conversations': ({ name }) => req(REST.adminUserConversations(name)),
    'admin:messages': ({ name, conversationId }) =>
      req(`${REST.adminUserMessages(name)}?conversationId=${encodeURIComponent(conversationId)}`),
    // --- Проекты + канбан ---
    'projects:list': () => req(REST.projects),
    'projects:create': (b) => req(REST.projects, { method: 'POST', body: JSON.stringify(b) }),
    'projects:get': async ({ id }) => {
      const token = getToken()
      const res = await fetch(httpBase + REST.project(id), {
        headers: token ? { authorization: `Bearer ${token}` } : undefined
      })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`GET ${REST.project(id)} → ${res.status}`)
      return res.json()
    },
    'projects:update': ({ id, ...fields }) =>
      req(REST.project(id), { method: 'PATCH', body: JSON.stringify(fields) }),
    'projects:delete': async ({ id }) => {
      await req(REST.project(id), { method: 'DELETE' })
    },
    'projects:addMember': ({ id, username }) =>
      req(REST.projectMembers(id), { method: 'POST', body: JSON.stringify({ username }) }),
    'projects:removeMember': ({ id, username }) =>
      req(REST.projectMember(id, username), { method: 'DELETE' }),
    'projects:linkMachine': ({ id, agentId }) =>
      req(REST.projectMachines(id), { method: 'POST', body: JSON.stringify({ agentId }) }),
    'projects:unlinkMachine': ({ id, agentId }) =>
      req(REST.projectMachine(id, agentId), { method: 'DELETE' }),
    'projects:setMachinePath': ({ id, agentId, path }) =>
      req(REST.projectMachine(id, agentId), { method: 'PATCH', body: JSON.stringify({ path }) }),
    'projects:setFeatureReposRoot': ({ id, agentId, featureReposRoot }) =>
      req(REST.projectMachine(id, agentId), { method: 'PATCH', body: JSON.stringify({ featureReposRoot }) }),
    'projects:setDefaultMachine': ({ id, agentId }) =>
      req(REST.projectDefaultMachine(id), { method: 'POST', body: JSON.stringify({ agentId }) }),
    'board:get': ({ id }) => req(REST.projectBoard(id)),
    'columns:create': ({ projectId, name }) =>
      req(REST.projectColumns(projectId), { method: 'POST', body: JSON.stringify({ name }) }),
    'columns:rename': async ({ projectId, columnId, name }) => {
      await req(REST.projectColumn(projectId, columnId), { method: 'PATCH', body: JSON.stringify({ name }) })
    },
    'columns:setHidden': async ({ projectId, columnId, hidden }) => {
      await req(REST.projectColumnHidden(projectId, columnId), { method: 'POST', body: JSON.stringify({ hidden }) })
    },
    'columns:reorder': async ({ projectId, order }) => {
      await req(REST.projectColumnsReorder(projectId), { method: 'POST', body: JSON.stringify({ order }) })
    },
    'columns:delete': async ({ projectId, columnId }) => {
      await req(REST.projectColumn(projectId, columnId), { method: 'DELETE' })
    },
    'tasks:create': ({ projectId, ...b }) =>
      req(REST.projectTasks(projectId), { method: 'POST', body: JSON.stringify(b) }),
    'tasks:update': ({ projectId, taskId, ...b }) =>
      req(REST.projectTask(projectId, taskId), { method: 'PATCH', body: JSON.stringify(b) }),
    'tasks:move': ({ projectId, taskId, ...b }) =>
      req(REST.projectTaskMove(projectId, taskId), { method: 'POST', body: JSON.stringify(b) }),
    'tasks:delete': async ({ projectId, taskId }) => {
      await req(REST.projectTask(projectId, taskId), { method: 'DELETE' })
    },
    'features:list': ({ projectId }) => req(REST.projectFeatures(projectId)),
    'features:createFromTask': ({ projectId, taskId, ...body }) => req(REST.taskFeature(projectId, taskId), { method: 'POST', body: JSON.stringify(body) }),
    'features:createFromStory': ({ projectId, storyId, ...body }) => req(REST.storyFeature(projectId, storyId), { method: 'POST', body: JSON.stringify(body) }),
    'features:get': async ({ id }) => {
      try { return await req(REST.feature(id)) } catch { return null }
    },
    'features:setAutomation': ({ id, ...body }) => req(REST.featureAutomation(id), { method: 'PATCH', body: JSON.stringify(body) }),
    'features:transition': ({ id, status, expectedVersion }) => req(REST.featureTransition(id), { method: 'POST', body: JSON.stringify({ status, expectedVersion }) }),
    'features:deploy': ({ id }) => req(REST.featureDeploy(id), { method: 'POST' }),
    'features:deployments': ({ id }) => req(REST.featureDeployments(id)),
    'agentTasks:list': ({ featureId }) => req(REST.featureAgentTasks(featureId)),
    'agentTasks:create': ({ featureId, ...body }) => req(REST.featureAgentTasks(featureId), { method: 'POST', body: JSON.stringify(body) })
  }
}
