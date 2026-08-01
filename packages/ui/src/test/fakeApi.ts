// In-memory фейк window.api (RendererApi) для тестов renderer/стора.
// Повторяет контракт IPC без Electron/SQLite: детерминированные id и время.

import type { RendererApi } from '@shared/ipc'
import type { Conversation, Message, Settings } from '@shared/types'
import type { AdminUserInfo } from '@shared/admin'
import type { AgentInfo } from '@shared/agentProtocol'
import { DEFAULT_AGENT_POLICY } from '@shared/agentProtocol'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { Board, KanbanColumn, ProjectDetail, ProjectMember, ProjectSummary, Task, WorkItemDefaultSkills } from '@shared/projects'
import { issueKey, isCompletedHidden, DEFAULT_DONE_RETENTION_DAYS } from '@shared/projects'


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
  const adminUsers: AdminUserInfo[] = [
    { name: 'admin', role: 'admin', blocked: false, createdAt: 1, conversationCount: 0, agents: [] }
  ]
  let settings: Settings = { ...DEFAULT_SETTINGS }

  // --- Проекты + канбан (in-memory) ---
  const ME = 'admin'
  interface FProject {
    id: string
    name: string
    description: string
    gitUrl: string | null
    technologies: string[]
    skills: string[]
    defaultSkills: WorkItemDefaultSkills
    createdBy: string

    createdAt: number
    updatedAt: number
    members: ProjectMember[]
    machines: Array<{ agentId: string; path: string; reposRoot: string }>
    defaultAgentId: string | null
    commitPolicy: ProjectSummary['commitPolicy']
    mergeTransport: ProjectSummary['mergeTransport']
    agentPlanApprovalMode: ProjectSummary['agentPlanApprovalMode']
    doneRetentionDays: number | null
  }
  const projects: FProject[] = []
  const columns: KanbanColumn[] = []
  const tasks: Task[] = []
  const summary = (p: FProject): ProjectSummary => ({
    id: p.id,
    name: p.name,
    description: p.description,
    gitUrl: p.gitUrl,
    technologies: p.technologies,
    skills: p.skills,
    defaultSkills: p.defaultSkills,
    createdBy: p.createdBy,

    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    role: p.members.find((m) => m.username === ME)?.role ?? 'owner',
    commitPolicy: p.commitPolicy,
    mergeTransport: p.mergeTransport,
    agentPlanApprovalMode: p.agentPlanApprovalMode,
    doneRetentionDays: p.doneRetentionDays
  })
  const detail = (p: FProject): ProjectDetail => ({
    ...summary(p),
    members: p.members.map((m) => ({ ...m })),
    machines: p.machines.map((m) => ({ ...m })),
    defaultAgentId: p.defaultAgentId
  })
  const boardOf = (pid: string, includeCompleted?: boolean): Board => {
    // Как на сервере: давно завершённые задачи в снапшот не попадают.
    const retention = includeCompleted ? null : projects.find((p) => p.id === pid)?.doneRetentionDays ?? null
    return {
      columns: columns.filter((c) => c.projectId === pid).sort((a, b) => a.position - b.position).map((c) => ({ ...c })),
      tasks: tasks
        .filter((t) => t.projectId === pid && !isCompletedHidden(t.doneAt, retention, Date.now()))
        .sort((a, b) => a.position - b.position)
        .map((t) => ({ ...t }))
    }
  }

  function makeConversation(title: string): Conversation {
    const ts = tick()
    return { id: nextId(), title, createdAt: ts, updatedAt: ts, messageCount: 0, claudeSessionId: null, execTarget: null, workdir: null, skillNames: [], llmProvider: null, llmModel: null, permissionMode: null, kbContextMode: 'auto', projectId: null, status: 'developing', lastExecTarget: null }
  }

  for (const title of seedConversations) conversations.push(makeConversation(title))

  /**
   * Как на сервере: чат задачи, лежащей в колонке с семантикой `done`, из
   * списка/поиска бесед убран, пока не попросили `includeCompleted`.
   */
  const doneTaskChat = (c: Conversation): boolean => {
    const task = c.taskId ? tasks.find((t) => t.id === c.taskId) : undefined
    return !!task && columns.find((k) => k.id === task.columnId)?.semanticType === 'done'
  }

  function withCounts(c: Conversation): Conversation {
    const own = messages.filter((m) => m.conversationId === c.id)
    return {
      ...c,
      messageCount: own.length,
      lastExecTarget: own[own.length - 1]?.execTarget ?? null
    }
  }

  const api: FakeApi = {
    'app:ping': async () => 'pong',
    'kb:status': async () => ({ available: true, mode: 'source', searchMode: 'lexical', version: 'test', createdAt: new Date(0).toISOString(), documents: 0, chunks: 0, staleDocuments: 0 }),
    'kb:topics': async () => [],
    'kb:search': async () => [],
    'prompt:suggest': async ({ prompt }) => ({ variants: [{ id: 'suggestion-1', text: `${prompt} — уточнённый вариант` }] }),
    'kb:document': async () => null,
    'kb:saveDocument': async (draft) => ({
      id: draft.id ?? 'kb-doc-1', title: draft.title, kind: draft.kind ?? 'subsystem', scope: draft.scope,
      projectId: draft.projectId ?? null, editable: true, tags: draft.tags ?? [], packages: [], freshness: 'unknown',
      sourcePath: 'мои знания/kb-doc-1', body: draft.body, symbols: [], protocols: [], areas: draft.areas ?? [],
      related: [], headings: []
    }),
    'kb:deleteDocument': async () => {},
    'kb:research': async ({ projectId }) => ({ projectId, state: 'running', startedBy: 'admin', startedAt: 0, finishedAt: null, documents: [], note: '', error: null }),
    'kb:researchStatus': async () => null,
    'kb:context': async ({ query }) => ({ query, confidence: 'low', autoInjectAllowed: false, sections: [], relatedFiles: [], relatedDocuments: [], staleWarnings: [], estimatedTokens: 0 }),
    'conversations:list': async ({ includeCompleted } = {}) =>
      [...conversations]
        .filter((c) => includeCompleted || !doneTaskChat(c))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(withCounts),
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
    'conversations:search': async ({ query, includeCompleted }) => {
      const q = query.trim().toLowerCase()
      const visible = [...conversations].filter((c) => includeCompleted || !doneTaskChat(c))
      if (!q) return visible.sort((a, b) => b.updatedAt - a.updatedAt).map(withCounts)
      return visible
        .filter(
          (c) =>
            c.title.toLowerCase().includes(q) ||
            messages.some((m) => m.conversationId === c.id && m.text.toLowerCase().includes(q))
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(withCounts)
    },
    /**
     * Поиск по сообщениям: подстрокой вместо FTS5, но с той же формой ответа —
     * сниппет с `<mark>`, курсор постранично, порядок «свежее выше».
     */
    'messages:search': async ({ query, projectId, conversationId, limit, cursor }) => {
      const q = query.trim().toLowerCase()
      if (!q) return { hits: [], nextCursor: null, match: '' }
      const size = limit ?? 20
      const from = cursor ? Number(cursor) : 0
      const found = messages
        .filter((m) => m.text.toLowerCase().includes(q))
        .filter((m) => !conversationId || m.conversationId === conversationId)
        .filter((m) => {
          if (projectId === undefined) return true
          const conv = conversations.find((c) => c.id === m.conversationId)
          return (conv?.projectId ?? null) === projectId
        })
        .sort((a, b) => b.createdAt - a.createdAt)
      const page = found.slice(from, from + size)
      return {
        hits: page.map((m) => {
          const at = m.text.toLowerCase().indexOf(q)
          const conv = conversations.find((c) => c.id === m.conversationId)
          return {
            messageId: m.id,
            conversationId: m.conversationId,
            conversationTitle: conv?.title ?? '',
            projectId: conv?.projectId ?? null,
            role: m.role,
            createdAt: m.createdAt,
            time: m.time,
            snippet: `${m.text.slice(0, at)}<mark>${m.text.slice(at, at + q.length)}</mark>${m.text.slice(at + q.length)}`,
            score: -1 - at / 100
          }
        }),
        nextCursor: from + size < found.length ? String(from + size) : null,
        match: `"${q}"*`
      }
    },
    'conversations:rename': async ({ id, title }) => {
      const conv = conversations.find((c) => c.id === id)
      if (conv) {
        conv.title = title
        conv.updatedAt = tick()
      }
    },
    'conversations:taskContext': async () => null,
    // Метки чатов задач: ключ считаем той же shared-функцией, что сервер, а ран
    // фейк не хранит — состояние подсветки тесты досылают кадрами `ci.*`.
    'conversations:taskChats': async () =>
      conversations
        .filter((c) => c.taskId)
        .flatMap((c) => {
          const task = tasks.find((t) => t.id === c.taskId)
          const project = projects.find((p) => p.id === task?.projectId)
          if (!task || !project) return []
          return [{ conversationId: c.id, projectId: project.id, taskId: task.id, key: issueKey(project.name, task), type: task.type, run: null }]
        }),
    'conversations:setProject': async ({ id, projectId }) => {
      const conv = conversations.find((c) => c.id === id)!
      conv.projectId = projectId
      if (projectId) {
        const p = projects.find((x) => x.id === projectId)
        if (p) {
          conv.execTarget = p.defaultAgentId
          const dm = p.defaultAgentId ? p.machines.find((m) => m.agentId === p.defaultAgentId) : null
          conv.workdir = dm && dm.path ? dm.path : null
          conv.skillNames = [...p.skills]
        }
      }
      return withCounts(conv)
    },
    'conversations:setStatus': async ({ id, status }) => {
      const conv = conversations.find((c) => c.id === id)!
      conv.status = status
      return withCounts(conv)
    },
    'conversations:setExecTarget': async ({ id, execTarget, workdir, skillNames, llmProvider, llmModel, permissionMode }) => {
      const conv = conversations.find((c) => c.id === id)
      if (!conv) throw new Error('not found')
      conv.execTarget = execTarget
      if (workdir !== undefined) conv.workdir = workdir
      if (skillNames !== undefined) conv.skillNames = skillNames
      if (llmProvider !== undefined) conv.llmProvider = llmProvider
      if (llmModel !== undefined) conv.llmModel = llmModel
      if (permissionMode !== undefined) conv.permissionMode = permissionMode
      return { ...conv }
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
    'system:capabilities': async () => ({
      stt: { available: true, reason: '' },
      tts: { available: true, reason: '' },
      memoryLimitBytes: 8 * 1024 * 1024 * 1024,
      cpuCount: 4
    }),
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
    'agents:update': async () => ({ ok: true as const, os: 'linux' }),
    'downloads:url': async ({ kind }) => `http://localhost/api/download/${kind}`,
    'agents:connectionString': async ({ token }) => `vcagent:fake-${token}`,
    'cc:projects': async () => [],
    'cc:sessions': async () => [],
    'cc:transcript': async () => ({ items: [], usage: {} }),
    'cc:resume': async ({ id }) => {
      const conv = makeConversation(`Продолжение ${id}`)
      conversations.push(conv)
      return { conversation: withCounts(conv), messages: [] }
    },
    'cx:projects': async () => [],
    'cx:sessions': async () => [],
    'cx:transcript': async () => ({ items: [], usage: {} }),
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
    'admin:users': async () => adminUsers.map((u) => ({ ...u })),
    'admin:createUser': async ({ name, role }) => {
      const u: AdminUserInfo = {
        name,
        role,
        blocked: false,
        createdAt: tick(),
        conversationCount: 0,
        agents: []
      }
      adminUsers.push(u)
      return { ...u }
    },
    'admin:setBlocked': async ({ name, blocked }) => {
      const u = adminUsers.find((x) => x.name === name)
      if (u) u.blocked = blocked
    },
    'admin:deleteUser': async ({ name }) => {
      const idx = adminUsers.findIndex((x) => x.name === name)
      if (idx >= 0) adminUsers.splice(idx, 1)
    },
    'admin:usage': async ({ unit }) => ({
      unit,
      totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, messages: 0 },
      byBucket: [],
      byModel: []
    }),
    'admin:conversations': async () => [],
    'admin:messages': async () => [],
    'projects:list': async () => projects.map(summary),
    'projects:create': async (b) => {
      const ts = tick()
      const id = nextId()
      const p: FProject = {
        id,
        name: b.name,
        description: b.description ?? '',
        gitUrl: b.gitUrl ?? null,
        technologies: b.technologies ?? [],
        skills: b.skills ?? [],
        defaultSkills: {
          epic: b.defaultSkills?.epic ?? [],
          story: b.defaultSkills?.story ?? [],
          task: b.defaultSkills?.task ?? []
        },
        createdBy: ME,

        createdAt: ts,
        updatedAt: ts,
        members: [{ username: ME, role: 'owner', addedAt: ts }],
        machines: [],
        defaultAgentId: null,
        commitPolicy: b.commitPolicy ?? 'agent_commits',
        mergeTransport: b.mergeTransport ?? 'local',
        agentPlanApprovalMode: b.agentPlanApprovalMode ?? 'manual',
        doneRetentionDays: DEFAULT_DONE_RETENTION_DAYS
      }
      projects.push(p)
      ;[
        ['Бэклог', 'backlog'], ['Готово к разработке', 'ready'], ['В разработке', 'development'],
        ['Тестирование', 'testing'], ['Ожидает мержа', 'awaiting_merge'], ['Готово', 'done']
      ].forEach(([name, semanticType], i) =>
        columns.push({ id: nextId(), projectId: id, name, semanticType: semanticType as KanbanColumn['semanticType'], position: (i + 1) * 1024, hidden: false, wipLimit: null, createdAt: ts })
      )
      return detail(p)
    },
    'projects:get': async ({ id }) => {
      const p = projects.find((x) => x.id === id)
      return p ? detail(p) : null
    },
    'projects:update': async ({ id, ...f }) => {
      const p = projects.find((x) => x.id === id)!
      if (f.name !== undefined) p.name = f.name
      if (f.description !== undefined) p.description = f.description
      if (f.gitUrl !== undefined) p.gitUrl = f.gitUrl
      if (f.technologies !== undefined) p.technologies = f.technologies
      if (f.skills !== undefined) p.skills = f.skills
      if (f.defaultSkills !== undefined) p.defaultSkills = { ...p.defaultSkills, ...f.defaultSkills }
      if (f.commitPolicy !== undefined) p.commitPolicy = f.commitPolicy

      if (f.mergeTransport !== undefined) p.mergeTransport = f.mergeTransport
      if (f.agentPlanApprovalMode !== undefined) p.agentPlanApprovalMode = f.agentPlanApprovalMode
      if (f.doneRetentionDays !== undefined) p.doneRetentionDays = f.doneRetentionDays
      p.updatedAt = tick()
      return detail(p)
    },
    'projects:delete': async ({ id }) => {
      const i = projects.findIndex((x) => x.id === id)
      if (i >= 0) projects.splice(i, 1)
      for (let j = columns.length - 1; j >= 0; j--) if (columns[j].projectId === id) columns.splice(j, 1)
      for (let j = tasks.length - 1; j >= 0; j--) if (tasks[j].projectId === id) tasks.splice(j, 1)
    },
    'projects:addMember': async ({ id, username }) => {
      const p = projects.find((x) => x.id === id)!
      if (!p.members.some((m) => m.username === username)) p.members.push({ username, role: 'member', addedAt: tick() })
      return detail(p)
    },
    'projects:removeMember': async ({ id, username }) => {
      const p = projects.find((x) => x.id === id)!
      p.members = p.members.filter((m) => !(m.username === username && m.role !== 'owner'))
      tasks.forEach((t) => {
        if (t.projectId === id && t.assignee === username) t.assignee = null
      })
      return detail(p)
    },
    'projects:linkMachine': async ({ id, agentId }) => {
      const p = projects.find((x) => x.id === id)!
      if (!p.machines.some((m) => m.agentId === agentId)) p.machines.push({ agentId, path: '', reposRoot: '' })
      return detail(p)
    },
    'projects:unlinkMachine': async ({ id, agentId }) => {
      const p = projects.find((x) => x.id === id)!
      p.machines = p.machines.filter((m) => m.agentId !== agentId)
      if (p.defaultAgentId === agentId) p.defaultAgentId = null
      return detail(p)
    },
    'projects:setMachinePath': async ({ id, agentId, path }) => {
      const p = projects.find((x) => x.id === id)!
      const m = p.machines.find((x) => x.agentId === agentId)
      if (m) m.path = path
      return detail(p)
    },
    'projects:setReposRoot': async ({ id, agentId, reposRoot }) => { const p = projects.find((x) => x.id === id)!; const m = p.machines.find((x) => x.agentId === agentId); if (m) m.reposRoot = reposRoot; return detail(p) },
    'projects:setDefaultMachine': async ({ id, agentId }) => {
      const p = projects.find((x) => x.id === id)!
      if (p.machines.some((m) => m.agentId === agentId)) p.defaultAgentId = agentId
      return detail(p)
    },
    'board:get': async ({ id, includeCompleted }) => boardOf(id, includeCompleted),
    'columns:create': async ({ projectId, name }) => {
      const ts = tick()
      const max = Math.max(0, ...columns.filter((c) => c.projectId === projectId).map((c) => c.position))
      const col: KanbanColumn = { id: nextId(), projectId, name, semanticType: 'custom', position: max + 1024, hidden: false, wipLimit: null, createdAt: ts }
      columns.push(col)
      return col
    },
    'columns:rename': async ({ columnId, name, wipLimit }) => {
      const c = columns.find((x) => x.id === columnId)
      if (!c) return
      if (name !== undefined) c.name = name
      if (wipLimit !== undefined) c.wipLimit = wipLimit
    },
    'columns:setHidden': async ({ columnId, hidden }) => {
      const c = columns.find((x) => x.id === columnId)
      if (c) c.hidden = hidden
    },
    'columns:reorder': async ({ order }) => {
      order.forEach((cid, i) => {
        const c = columns.find((x) => x.id === cid)
        if (c) c.position = (i + 1) * 1024
      })
    },
    'columns:delete': async ({ columnId }) => {
      const i = columns.findIndex((x) => x.id === columnId)
      if (i >= 0) columns.splice(i, 1)
      for (let j = tasks.length - 1; j >= 0; j--) if (tasks[j].columnId === columnId) tasks.splice(j, 1)
    },
    'tasks:create': async ({ projectId, columnId, title, description, acceptanceCriteria, type, parentId, priority, assignee, skills }) => {
      const ts = tick()
      const max = Math.max(0, ...tasks.filter((t) => t.columnId === columnId).map((t) => t.position))
      const itemType = type ?? 'task'
      const proj = projects.find((p) => p.id === projectId)
      const seededSkills = skills ?? (proj ? proj.defaultSkills[itemType] : [])
      const task: Task = {
        id: nextId(),
        projectId,
        columnId,
        type: itemType,
        parentId: parentId ?? null,
        title,
        description: description ?? '',
        acceptanceCriteria: acceptanceCriteria ?? '',
        priority: priority ?? 'medium',
        assignee: assignee ?? null,
        labels: [],
        skills: [...seededSkills],
        storyPoints: null,

        dueDate: null,
        flagged: false,
        seq: tasks.length + 1,
        position: max + 1024,
        createdAt: ts,
        updatedAt: ts
      }
      tasks.push(task)
      return task
    },
    'tasks:update': async ({ taskId, ...f }) => {
      const t = tasks.find((x) => x.id === taskId)!
      if (f.title !== undefined) t.title = f.title
      if (f.description !== undefined) t.description = f.description
      if (f.acceptanceCriteria !== undefined) t.acceptanceCriteria = f.acceptanceCriteria
      if (f.type !== undefined) t.type = f.type
      if (f.parentId !== undefined) t.parentId = f.parentId
      if (f.priority !== undefined) t.priority = f.priority
      if (f.assignee !== undefined) t.assignee = f.assignee
      if (f.labels !== undefined) t.labels = f.labels
      if (f.skills !== undefined) t.skills = f.skills
      if (f.storyPoints !== undefined) t.storyPoints = f.storyPoints

      if (f.dueDate !== undefined) t.dueDate = f.dueDate
      if (f.flagged !== undefined) t.flagged = f.flagged
      t.updatedAt = tick()
      return { ...t }
    },
    'tasks:move': async ({ taskId, columnId, afterId, beforeId }) => {
      const t = tasks.find((x) => x.id === taskId)!
      t.columnId = columnId
      // Как на сервере: попадание в «Готово» запускает отсчёт скрытия.
      const done = columns.find((c) => c.id === columnId)?.semanticType === 'done'
      t.doneAt = done ? t.doneAt ?? Date.now() : null
      const after = afterId ? tasks.find((x) => x.id === afterId) : null
      const before = beforeId ? tasks.find((x) => x.id === beforeId) : null
      t.position =
        after && before
          ? (after.position + before.position) / 2
          : after
            ? after.position + 1024
            : before
              ? before.position - 1024
              : Math.max(0, ...tasks.filter((x) => x.columnId === columnId && x.id !== taskId).map((x) => x.position)) + 1024
      t.updatedAt = tick()
      return { ...t }
    },
    'tasks:delete': async ({ taskId }) => {
      const i = tasks.findIndex((x) => x.id === taskId)
      if (i >= 0) tasks.splice(i, 1)
    },
    'tasks:openChat': async ({ projectId, taskId }) => {
      const task = tasks.find((x) => x.id === taskId)!
      const existing = conversations.find((c) => c.taskId === taskId)
      if (existing) return withCounts(existing)
      const conv = makeConversation(task.title ? `Задача ${task.title}` : 'Задача') // как на сервере
      conv.projectId = projectId
      conv.taskId = taskId
      conv.skillNames = [...task.skills]
      conversations.push(conv)
      task.chatId = conv.id
      return withCounts(conv)
    },

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


// --- Фейк window.ci (RendererCiBridge) для тестов CI-раннера ------------
import type { RendererCiBridge } from '../remote/ciBridge'
import type {
  CiCommand,
  CiCommandInput,
  CiGlobalSettings,
  CiRun,
  CiRunDetail,
  CiInteraction,
  CiLlmConfig,
  CiRunStep,
  CiLogLine
} from '@shared/ci'
import { DEFAULT_CI_GLOBAL_SETTINGS, DEFAULT_CI_LLM_CONFIG } from '@shared/ci'

export interface FakeCi extends RendererCiBridge {
  /** Тест-хелперы: прямой прогон realtime-событий. */
  _emitRun(run: CiRun): void
  _emitStep(runId: string, step: CiRunStep): void
  _emitLog(runId: string, line: CiLogLine): void
  _emitDone(run: CiRun): void
  _emitInteraction(runId: string, interaction: CiInteraction): void
  /** Сервер дописал сообщение в чат (резюме рана). */
  _emitChatMessage(conversationId: string, message: Message): void
  _commands: CiCommand[]
}

export function createFakeCi(): FakeCi {
  let n = 0
  const id = (pfx: string): string => `${pfx}-${++n}`
  const now = (): number => 1_700_000_000_000 + n * 1000
  const commands: CiCommand[] = []
  let settings: CiGlobalSettings = { ...DEFAULT_CI_GLOBAL_SETTINGS }
  const runs = new Map<string, CiRunDetail>()
  /** Пустые итоги БЗ: фейк ходов модели не делает, значит и обращений нет. */
  const EMPTY_KB_TOTALS = {
    queries: 0, delivered: 0, empty: 0, errors: 0, toolQueries: 0, sections: 0, documents: 0,
    chars: 0, estimatedTokens: 0, promptChars: 0, lastAt: null
  }
  const logs = new Map<string, CiLogLine[]>()
  let projectLlm: CiLlmConfig = { ...DEFAULT_CI_LLM_CONFIG }
  let taskLlm: CiLlmConfig | null = null
  /** Паузы ранов, чтобы Storybook/dom-тесты умели показывать вопрос модели. */
  const interactions = new Map<string, CiInteraction[]>()
  type L = (...args: never[]) => void
  const listeners: Record<string, Set<L>> = {}
  const on = (t: string, cb: L): (() => void) => {
    ;(listeners[t] ??= new Set()).add(cb)
    return () => listeners[t]?.delete(cb)
  }
  const emit = (t: string, m: unknown): void => { for (const cb of listeners[t] ?? []) (cb as (x: unknown) => void)(m) }

  const mkCommand = (input: CiCommandInput): CiCommand => ({
    id: id('cmd'),
    scope: input.scope ?? 'global',
    projectId: input.projectId ?? null,
    name: input.name ?? '',
    script: input.script ?? '',
    description: input.description ?? '',
    workdir: input.workdir ?? '',
    timeoutSec: input.timeoutSec ?? null,
    env: input.env ?? {},
    allowFailure: input.allowFailure ?? false,
    isCleanup: input.isCleanup ?? false,
    availableToModel: input.availableToModel ?? false,
    isTest: input.isTest ?? false,
    version: 1,
    createdBy: 'admin',
    createdAt: now(),
    updatedAt: now(),
    deletedAt: null
  })

  const mkRun = (projectId: string, taskId: string): CiRun => ({
    id: id('run'),
    projectId,
    taskId,
    agentId: null,
    status: 'queued',
    workspaceId: null,
    triggeredBy: 'admin',
    prevColumnId: null,
    llmProvider: 'claude',
    llmModel: 'opus',
    mode: 'development',
    kbContextMode: 'auto',
    clarifyLevel: 'few',
    clarifyMax: 3,
    conversationId: null,
    slotProgress: { done: 0, total: 4, phase: 'подготовка' },
    startedAt: now(),
    finishedAt: null,
    durationMs: null,
    createdAt: now()
  })

  const bridge: FakeCi = {
    listCommands: async () => commands.map((c) => ({ ...c })),
    getCommand: async (cid) => ({ ...commands.find((c) => c.id === cid)! }),
    createCommand: async (input) => { const c = mkCommand(input); commands.push(c); return { ...c } },
    updateCommand: async (cid, input) => { const c = commands.find((x) => x.id === cid)!; Object.assign(c, input, { updatedAt: now(), version: c.version + 1 }); return { ...c } },
    deleteCommand: async (cid) => { const i = commands.findIndex((x) => x.id === cid); if (i >= 0) commands.splice(i, 1); return { ok: true } },
    commandUsage: async () => ({ projects: [], tasks: [] }),
    getSettings: async () => ({ ...settings }),
    putSettings: async (next) => { settings = { ...settings, ...next }; return { ...settings } },
    listSuggestions: async () => [],
    resolveSuggestion: async (sid) => ({ id: sid, commandId: '', runStepId: null, reason: '', proposedScript: '', status: 'accepted', occurrences: 1, createdAt: now(), resolvedBy: 'admin', resolvedAt: now() }),
    listWorkspaces: async () => [],
    getProjectCi: async () => ({ beforeModel: [], afterModel: [] }),
    putProjectCi: async (_pid, config) => config,
    getProjectCiLlm: async () => ({ ...projectLlm }),
    putProjectCiLlm: async (_pid, config) => { projectLlm = { ...config }; return { ...config } },
    getTaskCiLlm: async () => ({ config: { ...(taskLlm ?? projectLlm) }, overridden: taskLlm !== null, projectDefault: { ...projectLlm } }),
    putTaskCiLlm: async (_pid, _tid, config) => { taskLlm = { ...config }; return { ...config } },
    resetTaskCiLlm: async () => { taskLlm = null; return { config: { ...projectLlm }, overridden: false, projectDefault: { ...projectLlm } } },
    getTaskCi: async () => ({ config: { beforeModel: [], afterModel: [] }, overridden: false, projectDefault: { beforeModel: [], afterModel: [] } }),
    putTaskCi: async (_pid, _tid, config) => config,
    startRun: async (projectId, taskId, mode) => { const run = { ...mkRun(projectId, taskId), mode: mode ?? projectLlm.mode }; runs.set(run.id, { run, steps: [], fixAttempts: [], interactions: [] }); logs.set(run.id, []); return { ...run } },
    getRun: async (rid) => runs.get(rid) ?? { run: mkRun('p', 't'), steps: [], fixAttempts: [], interactions: [] },
    getRunLog: async (rid) => logs.get(rid) ?? [],
    // Телеметрия БЗ в фейке пустая: её наполняют только реальные ходы модели.
    getRunKbUsage: async (rid) => ({
      runId: rid,
      projectId: runs.get(rid)?.run.projectId ?? 'p1',
      taskId: runs.get(rid)?.run.taskId ?? 't1',
      kbContextMode: 'auto' as const,
      conversationId: null,
      totals: EMPTY_KB_TOTALS,
      sections: [],
      recent: []
    }),
    getTaskKbUsage: async (projectId, taskId) => ({
      projectId,
      taskId,
      runs: 0,
      totals: EMPTY_KB_TOTALS,
      sections: [],
      recent: []
    }),
    cancelRun: async () => ({ ok: true }),
    retryRun: async (rid) => { const d = runs.get(rid)!; return await bridge.startRun(d.run.projectId, d.run.taskId) },
    retryRunFromStep: async (runId: string) => ({ id: runId } as unknown as CiRun),
    discardChangesAndRetry: async (runId: string) => ({ id: runId } as unknown as CiRun),
    getMetrics: async () => ({ commands: [], modelWork: { projectId: 'p', avgMs: null, samples: 0 } }),
    consoleExec: async () => ({ output: '', exitCode: 0, rejected: false, message: '' }),
    answerInteraction: async (runId, interactionId, answer) => {
      const list = interactions.get(runId) ?? []
      const it = list.find((x) => x.id === interactionId)!
      const next: CiInteraction = { ...it, status: 'answered', answerText: answer.text ?? null, decision: answer.decision ?? null, answeredAt: now(), answeredBy: 'admin' }
      interactions.set(runId, list.map((x) => (x.id === interactionId ? next : x)))
      const d = runs.get(runId)
      if (d) d.interactions = interactions.get(runId) ?? []
      emit('ci.interaction', { runId, interaction: next })
      return next
    },
    subscribe: (runId) => { const d = runs.get(runId); if (d) emit('ci.snapshot', { runId, detail: d, log: logs.get(runId) ?? [] }) },
    unsubscribe: () => {},
    onSnapshot: (cb) => on('ci.snapshot', cb as L),
    onRun: (cb) => on('ci.run', cb as L),
    onStep: (cb) => on('ci.step', cb as L),
    onLog: (cb) => on('ci.log', cb as L),
    onFix: (cb) => on('ci.fix', cb as L),
    onDone: (cb) => on('ci.done', cb as L),
    onSummary: (cb) => on('ci.summary', cb as L),
    onInteraction: (cb) => on('ci.interaction', cb as L),
    onChatMessage: (cb) => on('chat.message', cb as L),
    _emitRun: (run) => { runs.set(run.id, runs.get(run.id) ?? { run, steps: [], fixAttempts: [], interactions: [] }); emit('ci.run', { runId: run.id, run }) },
    _emitStep: (runId, step) => { const d = runs.get(runId); if (d) d.steps.push(step); emit('ci.step', { runId, step }) },
    _emitLog: (runId, line) => { const l = logs.get(runId) ?? []; l.push(line); logs.set(runId, l); emit('ci.log', { runId, line }) },
    _emitDone: (run) => emit('ci.done', { runId: run.id, run }),
    _emitInteraction: (runId, interaction) => {
      const list = interactions.get(runId) ?? []
      list.push(interaction)
      interactions.set(runId, list)
      const d = runs.get(runId)
      if (d) d.interactions = list
      emit('ci.interaction', { runId, interaction })
    },
    _emitChatMessage: (conversationId, message) => emit('chat.message', { conversationId, message }),
    _commands: commands
  }
  return bridge
}
