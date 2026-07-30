// window.api поверх REST сервера (удалённый режим web/desktop). Каналы 1:1
// соответствуют Electron invoke-каналам. httpBase — базовый HTTP-URL сервера
// ('' = same-origin), agentWsUrl — ws-адрес /agent для строки подключения.

import { REST } from '@shared/protocol'
import type {
  RendererCiRest,
  CiCommandUsage,
  CiTaskConfig,
  CiTaskLlmConfig,
  CiMetrics
} from './ciBridge'
import type {
  CiCommand,
  CiGlobalSettings,
  CiCommandSuggestion,
  CiWorkspaceReportItem,
  CiSlotConfig,
  CiLlmConfig,
  CiInteraction,
  CiRun,
  CiRunDetail,
  CiLogLine,
  CiConsoleExecResult
} from '@shared/ci'
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
    'prompt:suggest': ({ prompt, modifiers }) => req(REST.promptSuggest, { method: 'POST', body: JSON.stringify({ prompt, modifiers }) }),
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
    'conversations:taskContext': ({ id }) => req(REST.conversationTaskContext(id)),
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
    'projects:setReposRoot': ({ id, agentId, reposRoot }) =>
      req(REST.projectMachine(id, agentId), { method: 'PATCH', body: JSON.stringify({ reposRoot }) }),
    'projects:setDefaultMachine': ({ id, agentId }) =>
      req(REST.projectDefaultMachine(id), { method: 'POST', body: JSON.stringify({ agentId }) }),
    'board:get': ({ id }) => req(REST.projectBoard(id)),
    'columns:create': ({ projectId, name }) =>
      req(REST.projectColumns(projectId), { method: 'POST', body: JSON.stringify({ name }) }),
    'columns:rename': async ({ projectId, columnId, name, wipLimit }) => {
      await req(REST.projectColumn(projectId, columnId), { method: 'PATCH', body: JSON.stringify({ name, wipLimit }) })
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
    'tasks:openChat': ({ projectId, taskId }) =>
      req(REST.projectTaskChat(projectId, taskId), { method: 'POST' }),
    'tasks:delete': async ({ projectId, taskId }) => {
      await req(REST.projectTask(projectId, taskId), { method: 'DELETE' })
    }
  }
}


/**
 * REST-часть моста window.ci. WS-часть добавляется в remote/index.ts.
 * Повторяет схему createHttpApi (Bearer-токен, JSON-тело только при наличии).
 */
export function createCiRest(httpBase: string): RendererCiRest {
  async function req<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {}
    if (init?.body != null) headers['content-type'] = 'application/json'
    const token = getToken()
    if (token) headers['authorization'] = `Bearer ${token}`
    const res = await fetch(httpBase + path, { ...init, headers })
    if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}`)
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }
  const qs = (projectId?: string): string => (projectId ? `?projectId=${encodeURIComponent(projectId)}` : '')
  return {
    listCommands: (projectId) => req<CiCommand[]>(REST.ciCommands + qs(projectId)),
    getCommand: (id) => req<CiCommand>(REST.ciCommand(id)),
    createCommand: (input) => req<CiCommand>(REST.ciCommands, { method: 'POST', body: JSON.stringify(input) }),
    updateCommand: (id, input) => req<CiCommand>(REST.ciCommand(id), { method: 'PATCH', body: JSON.stringify(input) }),
    deleteCommand: (id) => req<{ ok: boolean }>(REST.ciCommand(id), { method: 'DELETE' }),
    commandUsage: (id) => req<CiCommandUsage>(REST.ciCommandUsage(id)),
    getSettings: () => req<CiGlobalSettings>(REST.ciSettings),
    putSettings: (settings) => req<CiGlobalSettings>(REST.ciSettings, { method: 'PUT', body: JSON.stringify(settings) }),
    listSuggestions: (projectId) => req<CiCommandSuggestion[]>(REST.ciSuggestions + qs(projectId)),
    resolveSuggestion: (id, accept) => req<CiCommandSuggestion>(REST.ciSuggestion(id), { method: 'POST', body: JSON.stringify({ accept }) }),
    listWorkspaces: (projectId) => req<CiWorkspaceReportItem[]>(REST.ciWorkspaces + qs(projectId)),
    getProjectCi: (projectId) => req<CiSlotConfig>(REST.projectCi(projectId)),
    putProjectCi: (projectId, config) => req<CiSlotConfig>(REST.projectCi(projectId), { method: 'PUT', body: JSON.stringify(config) }),
    getProjectCiLlm: (projectId) => req<CiLlmConfig>(REST.projectCiLlm(projectId)),
    putProjectCiLlm: (projectId, config) => req<CiLlmConfig>(REST.projectCiLlm(projectId), { method: 'PUT', body: JSON.stringify(config) }),
    getTaskCiLlm: (projectId, taskId) => req<CiTaskLlmConfig>(REST.taskCiLlm(projectId, taskId)),
    putTaskCiLlm: (projectId, taskId, config) => req<CiLlmConfig>(REST.taskCiLlm(projectId, taskId), { method: 'PUT', body: JSON.stringify(config) }),
    resetTaskCiLlm: (projectId, taskId) => req<CiTaskLlmConfig>(REST.taskCiLlm(projectId, taskId), { method: 'DELETE' }),
    getTaskCi: (projectId, taskId) => req<CiTaskConfig>(REST.taskCi(projectId, taskId)),
    putTaskCi: (projectId, taskId, config) => req<CiSlotConfig>(REST.taskCi(projectId, taskId), { method: 'PUT', body: JSON.stringify(config) }),
    startRun: (projectId, taskId, mode) => req<CiRun>(REST.ciRunStart(projectId, taskId), { method: 'POST', body: JSON.stringify(mode ? { mode } : {}) }),
    getRun: (runId) => req<CiRunDetail>(REST.ciRun(runId)),
    getRunLog: (runId) => req<CiLogLine[]>(REST.ciRunLog(runId)),
    cancelRun: (runId) => req<{ ok: boolean }>(REST.ciRunCancel(runId), { method: 'POST' }),
    retryRun: (runId) => req<CiRun>(REST.ciRunRetry(runId), { method: 'POST' }),
    retryRunFromStep: (runId, selection) => req<CiRun>(REST.ciRunRetryFromStep(runId), { method: 'POST', body: JSON.stringify(selection ?? {}) }),
    discardChangesAndRetry: (runId) => req<CiRun>(REST.ciRunDiscardAndRetry(runId), { method: 'POST' }),
    getMetrics: (projectId) => req<CiMetrics>(REST.ciMetrics(projectId)),
    consoleExec: (runId, command, editMode) => req<CiConsoleExecResult>(REST.ciConsoleExec(runId), { method: 'POST', body: JSON.stringify({ command, editMode }) }),
    answerInteraction: (runId, interactionId, answer) =>
      req<CiInteraction>(REST.ciRunInteraction(runId, interactionId), { method: 'POST', body: JSON.stringify(answer) })
  }
}
