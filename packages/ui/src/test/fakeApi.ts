import { MAKE_SCAFFOLD, type MakeCheckIssue, type MakePublication, type MakeSnapshotDiffEntry, type MakeStoryShot, type MakeLibraryItem } from '@shared/make'
// In-memory фейк window.api (RendererApi) для тестов renderer/стора.
// Повторяет контракт IPC без Electron/SQLite: детерминированные id и время.

import type { RendererApi } from '@shared/ipc'
import type { Conversation, Message, Settings } from '@shared/types'
import type { UserLlmAccess } from '@shared/llmAccess'
import type { AdminLlmEngine, AdminLlmEngineHealth, AdminUserInfo, ModelPrice } from '@shared/admin'
import type { AgentInfo } from '@shared/agentProtocol'
import { DEFAULT_AGENT_POLICY } from '@shared/agentProtocol'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { Board, KanbanColumn, ProjectDetail, ProjectMachine, ProjectMember, ProjectSummary, Task, WorkItemDefaultSkills } from '@shared/projects'
import { compareTasksInColumn, issueKey, isCompletedHidden, DEFAULT_DONE_RETENTION_DAYS } from '@shared/projects'


export interface FakeApi extends RendererApi {
  /**
   * Часы фейкового бэкенда: «состарить» завершённую задачу, не дожидаясь суток.
   * Порог `0` теперь означает «убрать в конце дня», а не «в ту же секунду»
   * (`isCompletedHidden`), поэтому иначе скрытие с доски не проверить.
   */
  _advanceDays: (days: number) => void
  /** Прямой доступ к состоянию для ассертов в тестах. */
  _state: {
    conversations: Conversation[]
    messages: Message[]
    settings: Settings
  }
}

export function createFakeApi(seedConversations: string[] = []): FakeApi {
  const makeStore = new Map<string, Map<string, string>>()
  const makeSnapStore = new Map<string, Array<{ id: string; createdAt: number; label: string; files: number }>>()
  /** Содержимое файлов на момент снимка — для diff и восстановления одного файла. */
  const makeSnapContents = new Map<string, Map<string, string>>()
  const makeShots = new Map<string, MakeStoryShot[]>()
  const library = new Map<string, MakeLibraryItem>()
  const libraryFiles = new Map<string, Map<string, string>>()
  const makeRev = new Map<string, number>()
  const makePub = new Map<string, MakePublication>()
  const makeFiles = (id: string): Map<string, string> => {
    let files = makeStore.get(id)
    if (!files) { files = new Map(Object.entries(MAKE_SCAFFOLD)); makeStore.set(id, files) }
    return files
  }
  const makeSnaps = (id: string): Array<{ id: string; createdAt: number; label: string; files: number }> => {
    let snaps = makeSnapStore.get(id)
    if (!snaps) { snaps = []; makeSnapStore.set(id, snaps) }
    return snaps
  }
  const makeState = (id: string) => ({
    conversationId: id,
    files: [...makeFiles(id).entries()].map(([path, content]) => ({ path, size: new TextEncoder().encode(content).length, updatedAt: 1 })).sort((x, y) => x.path.localeCompare(y.path)),
    snapshots: [...makeSnaps(id)],
    rev: makeRev.get(id) ?? 0,
    published: makePub.get(id) ?? null
  })

  let idCounter = 0
  let clock = 1_700_000_000_000
  /** «Сейчас» фейкового бэкенда — двигается только `_advanceDays`. */
  let nowMs = Date.now()
  const nextId = (): string => `id-${++idCounter}`
  const tick = (): number => (clock += 1000)

  const conversations: Conversation[] = []
  const messages: Message[] = []
  const draftRequests = new Map<string, string>()
  const agents: AgentInfo[] = []
  const adminUsers: AdminUserInfo[] = [
    { name: 'admin', role: 'admin', blocked: false, createdAt: 1, conversationCount: 0, agents: [] }
  ]
  const userLlmAccess = new Map<string, UserLlmAccess[]>()
  const llmEngines: AdminLlmEngine[] = [
    {
      id: 'eng-claude',
      name: 'runner-work claude',
      kind: 'claude',
      baseUrl: 'http://runner-work:8080',
      token: 'secret',
      enabled: true,
      allowedRoles: ['admin', 'developer', 'tester', 'observer'],
      isDefault: true,
      createdAt: 2
    }
  ]
  const modelPrices: ModelPrice[] = []
  const llmHealth: Record<string, AdminLlmEngineHealth> = {
    'eng-claude': {
      engineId: 'eng-claude',
      kind: 'claude',
      checkedAt: 3,
      available: true,
      detail: 'claude: доступен',
      status: null
    }
  }
  let settings: Settings = { ...DEFAULT_SETTINGS }

  // --- Проекты + канбан (in-memory) ---
  const ME = 'admin'
  interface FProject {
    id: string
    name: string
    description: string
    gitUrl: string | null
    previewUrl: string | null
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
    previewUrl: p.previewUrl,
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
        .filter((t) => t.projectId === pid && !isCompletedHidden(t.doneAt, retention, nowMs))
        .sort((a, b) => {
          if (a.columnId !== b.columnId) return a.columnId.localeCompare(b.columnId)
          return compareTasksInColumn(a, b, columns.find((c) => c.id === a.columnId)?.semanticType ?? 'custom')
        })
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
  const taskChatSemantic = (c: Conversation): KanbanColumn['semanticType'] | null => {
    const task = c.taskId ? tasks.find((t) => t.id === c.taskId) : undefined
    return task ? columns.find((k) => k.id === task.columnId)?.semanticType ?? null : null
  }

  const visibleInConversationList = (c: Conversation, includeCompleted: boolean): boolean => {
    const semantic = taskChatSemantic(c)
    return semantic !== 'cancelled' && (includeCompleted || semantic !== 'done')
  }

  function withCounts(c: Conversation): Conversation {
    const own = messages.filter((m) => m.conversationId === c.id)
    return {
      ...c,
      projectPreviewUrl: c.projectId ? projects.find((p) => p.id === c.projectId)?.previewUrl ?? null : null,
      messageCount: own.length,
      lastExecTarget: own[own.length - 1]?.execTarget ?? null
    }
  }

  const api: FakeApi = {
    'app:ping': async () => ({ ok: true, version: '0.1.0', releasedAt: '2026-08-03T00:00:00.000Z', commit: '7492fde', task: 'chat-149' }),
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
    'kanbanAssistant:get': async ({ projectId, conversationId }) => {
      let conversation = conversations.find((item) => item.id === conversationId && item.projectId === projectId && (item.assistantKind === undefined || item.assistantKind === 'kanban'))
        ?? conversations.find((item) => item.projectId === projectId && item.assistantKind === 'kanban')
      if (!conversation) {
        conversation = { ...makeConversation(`Ассистент · ${projectId}`), projectId, assistantKind: 'kanban', execTarget: 'none' }
        conversations.push(conversation)
      }
      return { conversation: withCounts(conversation), messages: messages.filter((item) => item.conversationId === conversation!.id), effectiveLlm: { llmEngineId: null, provider: 'claude', model: 'opus', inherited: true } }
    },
    'widget:describe': async () => ({ version: 1, widgetKind: 'kanban', capabilities: [{ operation: 'query', name: 'kanban.items.query', confirmation: 'never' }, { operation: 'get', name: 'kanban.item.get', confirmation: 'never' }, { operation: 'action', name: 'kanban.task.update', confirmation: 'required' }] }),
    'widget:query': async ({ ui, text, kinds, limit }) => {
      const { queryWidgetItems } = await import('@shared/widgetAssistant')
      return { source: ui?.items.length ? 'ui' : 'api', revision: ui?.revision ?? '0', items: queryWidgetItems(ui?.items ?? [], text, kinds, limit) }
    },
    'widget:get': async ({ itemId }) => { throw new Error(`fake widget item not found: ${itemId}`) },
    'widget:action': async () => ({ applied: true, replayed: false, revision: String(Date.now()) }),
    'conversations:list': async ({ includeCompleted } = {}) =>
      [...conversations]
        .filter((c) => visibleInConversationList(c, Boolean(includeCompleted)))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(withCounts),
    // Make: файлы проекта в памяти — панель тестируется без сервера.
    'make:state': async ({ conversationId }) => makeState(conversationId),
    'make:read': async ({ conversationId, path }) => {
      const content = makeFiles(conversationId).get(path)
      if (content === undefined) throw new Error(`Файл «${path}» не найден`)
      return { path, size: new TextEncoder().encode(content).length, updatedAt: 1, content }
    },
    'make:search': async ({ conversationId, query }) => {
      const needle = query.trim().toLocaleLowerCase()
      const matches: { path: string; line: number; text: string }[] = []
      for (const [path, content] of makeFiles(conversationId)) content.split('\n').forEach((text, i) => { if (needle && text.toLocaleLowerCase().includes(needle)) matches.push({ path, line: i + 1, text: text.trim() }) })
      return { matches }
    },
    'make:replace': async ({ conversationId, query, replacement, matchCase }) => {
      const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi')
      let files = 0, replacements = 0
      for (const [path, content] of makeFiles(conversationId)) {
        const n = (content.match(re) ?? []).length
        if (n === 0) continue
        files += 1; replacements += n
        makeFiles(conversationId).set(path, content.replace(re, () => replacement))
      }
      if (files > 0) makeRev.set(conversationId, (makeRev.get(conversationId) ?? 0) + 1)
      return { files, replacements, state: makeState(conversationId) }
    },
    'make:stories': async ({ conversationId }) => ({
      files: [...makeFiles(conversationId)].filter(([path]) => /\.stories\.(jsx|tsx)$/.test(path)).map(([path, content]) => ({
        path,
        title: content.match(/title\s*:\s*['"]([^'"]+)['"]/)?.[1] ?? path,
        stories: [...content.matchAll(/^export\s+const\s+(\w+)/gm)].map((m) => m[1]!),
        withPlay: [...content.matchAll(/^export\s+const\s+(\w+)\s*=\s*\{[^\n]*play/gm)].map((m) => m[1]!)
      }))
    }),
    'make:snapshotDiff': async ({ conversationId, snapshotId }) => {
      const snap = makeSnapContents.get(snapshotId)
      const now = makeFiles(conversationId)
      const files: MakeSnapshotDiffEntry[] = []
      for (const [path, content] of now) {
        const old = snap?.get(path)
        files.push(old === undefined ? { path, status: 'added', before: null, after: content.length } : { path, status: old === content ? 'same' : 'changed', before: old.length, after: content.length })
      }
      for (const [path, old] of snap ?? []) if (!now.has(path)) files.push({ path, status: 'removed', before: old.length, after: null })
      return { snapshotId, files: files.sort((a, b) => a.path.localeCompare(b.path)) }
    },
    'make:library': async () => ({ items: [...library.values()] }),
    'make:libraryExport': async ({ conversationId, name, paths }) => { const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-'); const item = { slug, name, files: paths, bytes: 0, sourceConversationId: conversationId, updatedAt: Date.now() }; library.set(slug, item); libraryFiles.set(slug, new Map(paths.map((p) => [p, makeFiles(conversationId).get(p) ?? '']))); return { item } },
    'make:libraryInsert': async ({ conversationId, slug }) => { for (const [p, c] of libraryFiles.get(slug) ?? []) makeFiles(conversationId).set(p, c); makeRev.set(conversationId, (makeRev.get(conversationId) ?? 0) + 1); return makeState(conversationId) },
    'make:libraryRemove': async ({ slug }) => { library.delete(slug); return { items: [...library.values()] } },
    'make:shots': async ({ conversationId }) => ({ shots: makeShots.get(conversationId) ?? [] }),
    'make:shot': async ({ conversationId, file, story }) => { const list = [{ id: `sh${(makeShots.get(conversationId) ?? []).length + 1}`, file, story, at: Date.now(), rev: makeRev.get(conversationId) ?? 0 }, ...(makeShots.get(conversationId) ?? [])]; makeShots.set(conversationId, list); return { shots: list } },
    'make:snapshotFile': async ({ snapshotId, path }) => {
      const old = makeSnapContents.get(snapshotId)?.get(path)
      if (old === undefined) throw new Error('В снимке нет файла')
      return { path, size: old.length, updatedAt: 1, content: old }
    },
    'make:restoreFile': async ({ conversationId, snapshotId, path }) => {
      const old = makeSnapContents.get(snapshotId)?.get(path)
      if (old === undefined) throw new Error('В снимке нет файла')
      makeFiles(conversationId).set(path, old)
      makeRev.set(conversationId, (makeRev.get(conversationId) ?? 0) + 1)
      return makeState(conversationId)
    },
    'make:import': async ({ conversationId, dataBase64, mode }) => {
      // Фейк не разбирает ZIP: base64 содержит JSON {path: content}.
      const files = JSON.parse(atob(dataBase64)) as Record<string, string>
      if (mode === 'replace') makeFiles(conversationId).clear()
      for (const [path, content] of Object.entries(files)) makeFiles(conversationId).set(path, content)
      makeRev.set(conversationId, (makeRev.get(conversationId) ?? 0) + 1)
      return makeState(conversationId)
    },
    'make:importUrl': async ({ conversationId, url, mode }) => {
      if (mode === 'replace') makeFiles(conversationId).clear()
      makeFiles(conversationId).set('index.html', `<!-- импортировано из ${url} --><h1>imported</h1>`)
      makeRev.set(conversationId, (makeRev.get(conversationId) ?? 0) + 1)
      return makeState(conversationId)
    },
    'make:upload': async ({ conversationId, path, dataBase64 }) => { makeFiles(conversationId).set(path, `<binary ${dataBase64.length}>`); makeRev.set(conversationId, (makeRev.get(conversationId) ?? 0) + 1); return makeState(conversationId) },
    'make:write': async ({ conversationId, path, content }) => { makeFiles(conversationId).set(path, content); makeRev.set(conversationId, (makeRev.get(conversationId) ?? 0) + 1); return makeState(conversationId) },
    'make:delete': async ({ conversationId, path }) => { makeFiles(conversationId).delete(path); return makeState(conversationId) },
    'make:rename': async ({ conversationId, from, to }) => { const files = makeFiles(conversationId); const c = files.get(from) ?? ''; files.delete(from); files.set(to, c); return makeState(conversationId) },
    'make:snapshot': async ({ conversationId, label }) => { const id = `s${Date.now()}-${makeSnaps(conversationId).length}`; makeSnapContents.set(id, new Map(makeFiles(conversationId))); makeSnaps(conversationId).unshift({ id, createdAt: Date.now(), label: label ?? 'Снимок', files: makeFiles(conversationId).size }); return makeState(conversationId) },
    'make:restore': async ({ conversationId }) => makeState(conversationId),
    'make:publish': async ({ conversationId, snapshotId }) => { const snap = snapshotId ? makeSnaps(conversationId).find((s) => s.id === snapshotId) : null; makePub.set(conversationId, { token: 'tok123', publishedAt: 1, url: '/p/tok123/', snapshotId: snap?.id ?? null, snapshotLabel: snap?.label ?? null }); return makeState(conversationId) },
    'make:unpublish': async ({ conversationId }) => { makePub.delete(conversationId); return makeState(conversationId) },
    'make:check': async ({ conversationId }) => {
      const issues: MakeCheckIssue[] = makeFiles(conversationId).has('index.html') ? [] : [{ path: 'index.html', kind: 'no-index', message: 'Нет index.html' }]
      // Имитация esbuild: маркер «SYNTAX_ERROR» в jsx/tsx — ошибка компиляции на строке вхождения.
      for (const [path, content] of makeFiles(conversationId)) {
        if (!/\.(jsx|tsx|ts)$/.test(path)) continue
        const idx = content.split('\n').findIndex((l) => l.includes('SYNTAX_ERROR'))
        if (idx >= 0) issues.push({ path, kind: 'compile-error', message: `Ошибка компиляции (строка ${idx + 1}): Unexpected token`, line: idx + 1, column: 1 })
      }
      return { issues }
    },
    'make:template': async ({ conversationId, templateId }) => { const files = makeFiles(conversationId); files.clear(); files.set('index.html', `<h1>${templateId}</h1>`); return makeState(conversationId) },
    'make:reset': async ({ conversationId }) => { const files = makeFiles(conversationId); files.clear(); for (const [k, v] of Object.entries(MAKE_SCAFFOLD)) files.set(k, v); return makeState(conversationId) },
    'conversations:create': async ({ title, assistantKind } = {}) => {
      const conv = { ...makeConversation(title ?? 'Новый разговор'), ...(assistantKind ? { assistantKind } : {}) }
      conversations.push(conv)
      return conv
    },
    'conversations:createDraft': async ({ idempotencyKey, title, projectId, message }) => {
      const replayId = draftRequests.get(idempotencyKey)
      if (replayId) {
        const replay = conversations.find((item) => item.id === replayId)!
        return { conversation: withCounts(replay), messages: messages.filter((item) => item.conversationId === replayId) }
      }
      const conv = makeConversation(title)
      conversations.push(conv)
      if (projectId) {
        conv.projectId = projectId
        const project = projects.find((item) => item.id === projectId)
        if (!project) throw new Error('project not found')
        conv.execTarget = project.defaultAgentId
        const machine = project.defaultAgentId ? project.machines.find((item) => item.agentId === project.defaultAgentId) : null
        conv.workdir = machine?.path || null
        conv.skillNames = [...project.skills]
      }
      const persisted: Message = {
        id: nextId(),
        conversationId: conv.id,
        role: message.role,
        text: message.text,
        time: message.time,
        createdAt: tick(),
        ...(message.engine ? { engine: message.engine } : {}),
        ...(message.meta ? { meta: message.meta } : {}),
        execTarget: conv.execTarget,
        ...(message.attachments?.length ? { attachments: message.attachments } : {})
      }
      messages.push(persisted)
      conv.updatedAt = persisted.createdAt
      draftRequests.set(idempotencyKey, conv.id)
      return { conversation: withCounts(conv), messages: [persisted] }
    },
    'conversations:contextSnapshot': async ({ id }) => ({ schemaVersion: 1, conversationId: id, generatedAt: new Date(0).toISOString(), freshnessWarning: 'Тестовый снимок.', summary: { provider: 'claude', model: 'default', permissionMode: { value: 'plan', displayName: 'Только планирование', explanation: 'Тест' }, kbMode: { value: 'auto', displayName: 'Автоматически', explanation: 'Тест' } }, groups: [] }),
    'conversations:setContextItem': async ({ id }) => ({ schemaVersion: 1, conversationId: id, generatedAt: new Date(0).toISOString(), freshnessWarning: 'Тестовый снимок.', summary: { provider: 'claude', model: 'default', permissionMode: { value: 'plan', displayName: 'Только планирование', explanation: 'Тест' }, kbMode: { value: 'auto', displayName: 'Автоматически', explanation: 'Тест' } }, groups: [] }),
    'conversations:listMachines': async () => agents.map((a) => ({ ...a })),
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
      const visible = [...conversations].filter((c) => visibleInConversationList(c, Boolean(includeCompleted)))
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
    // Контекст задачи для виджета чата: как на сервере — только у чата,
    // привязанного к задаче, и всегда со своим `conversationId`.
    'conversations:taskContext': async ({ id }) => {
      const conv = conversations.find((c) => c.id === id)
      const task = conv?.taskId ? tasks.find((t) => t.id === conv.taskId) : undefined
      const project = projects.find((p) => p.id === task?.projectId)
      if (!conv || !task || !project) return null
      const crumb = (t: Task) => ({ id: t.id, title: t.title, key: issueKey(project.name, t) })
      const parent = task.parentId ? tasks.find((t) => t.id === task.parentId) : undefined
      const column = columns.find((k) => k.id === task.columnId)
      return {
        conversationId: conv.id,
        projectId: project.id,
        projectName: project.name,
        epic: parent?.type === 'epic' ? crumb(parent) : null,
        story: parent?.type === 'story' ? crumb(parent) : null,
        task: { ...crumb(task), type: task.type },
        columnName: column?.name ?? '',
        columnSemantic: column?.semanticType ?? null,
        agentId: conv.execTarget ?? null,
        agentName: agents.find((a) => a.id === conv.execTarget)?.name ?? null,
        workdir: conv.workdir,
        run: null
      }
    },
    // Метки чатов задач: ключ считаем той же shared-функцией, что сервер, а ран
    // фейк не хранит — состояние подсветки тесты досылают кадрами `ci.*`.
    'conversations:taskChats': async () =>
      conversations
        .filter((c) => c.taskId)
        .flatMap((c) => {
          const task = tasks.find((t) => t.id === c.taskId)
          const project = projects.find((p) => p.id === task?.projectId)
          if (!task || !project) return []
          const column = columns.find((col) => col.id === task.columnId)
          return [{ conversationId: c.id, projectId: project.id, taskId: task.id, key: issueKey(project.name, task), type: task.type, columnSemantic: column?.semanticType ?? null, run: null }]
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
    'conversations:setPreviewUrl': async ({ id, previewUrl }) => {
      const conv = conversations.find((c) => c.id === id)!
      conv.previewUrl = previewUrl
      return withCounts(conv)
    },
    'conversations:setStatus': async ({ id, status }) => {
      const conv = conversations.find((c) => c.id === id)
      if (conv) {
        conv.status = status
        return withCounts(conv)
      }
      // Поздний кадр может прийти уже после удаления/смены чата. Сервер в этом
      // случае отвечает контрактным объектом, а фейк не должен ронять тестовый лог.
      return {
        id,
        title: '',
        createdAt: 0,
        updatedAt: 0,
        messageCount: 0,
        claudeSessionId: null,
        execTarget: null,
        workdir: null,
        skillNames: [],
        llmProvider: null,
        llmModel: null,
        permissionMode: null,
        lastExecTarget: null,
        status
      }
    },
    'conversations:getStorage': async () => null,
    'conversations:setStorage': async ({ id, machineId, storageId, relativePath }) => ({ conversationId: id, machineId, storageId, relativePath: relativePath ?? `chats/${id}` }),
    'conversations:setExecTarget': async ({ id, execTarget, workdir, skillNames, llmEngineId, llmProvider, llmModel, permissionMode }) => {
      const conv = conversations.find((c) => c.id === id)
      if (!conv) throw new Error('not found')
      conv.execTarget = execTarget
      if (workdir !== undefined) conv.workdir = workdir
      if (skillNames !== undefined) conv.skillNames = skillNames
      if (llmEngineId !== undefined) conv.llmEngineId = llmEngineId
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
    'messages:updateMeta': async ({ messageId, meta }) => {
      const idx = messages.findIndex((m) => m.id === messageId)
      if (idx < 0) throw new Error('message not found')
      messages[idx] = { ...messages[idx], meta }
      return { ...messages[idx] }
    },
    'messages:delete': async ({ messageId }) => {
      const idx = messages.findIndex((m) => m.id === messageId)
      if (idx >= 0) messages.splice(idx, 1)
    },
    'uploads:add': async ({ name, mimeType }) => ({ id: nextId(), name, path: `/uploads/${name}`, mimeType: mimeType ?? 'application/octet-stream', size: 0 }),
    'images:retouch': async ({ conversationId, source, selection, prompt, references }) => {
      const image = { ...source, path: `/generated/retouch-${nextId()}.png`, name: 'retouch.png', mimeType: 'image/png', retouch: { source, selection, prompt, ...(references?.length ? { references } : {}) } }
      const message = { id: nextId(), conversationId, role: 'ai' as const, text: '', time: '12:00', createdAt: Date.now(), attachments: [image] }
      messages.push(message)
      return { message, image }
    },
    'llm:engines': async () => llmEngines.filter((e) => e.enabled).map(({ id, name, kind, isDefault }) => ({ id, name, kind, isDefault })),
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
    'agents:listStorages': async () => [],
    'agents:registerStorage': async ({ id, rootPath }) => ({
      id: `storage-${id}`, machineId: id, rootPath, status: 'ready', formatVersion: 1
    }),
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
    'admin:usageSummary': async () => adminUsers.map((u) => ({ name: u.name, totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, messages: 0 }, byModel: [] })),
    'llm:access': async () => [...(userLlmAccess.get(ME) ?? [])],
    'admin:llmAccess': async ({ name }) => [...(userLlmAccess.get(name) ?? [])],
    'admin:saveLlmAccess': async ({ name, access }) => { userLlmAccess.set(name, [...access]); return [...access] },
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
    'admin:updateUserRole': async ({ name, role }) => {
      const user = adminUsers.find((item) => item.name === name)
      if (!user) throw new Error('not found')
      user.role = role
      return { ...user }
    },
    'admin:setBlocked': async ({ name, blocked }) => {
      const u = adminUsers.find((x) => x.name === name)
      if (u) u.blocked = blocked
    },
    'admin:deleteUser': async ({ name }) => {
      const idx = adminUsers.findIndex((x) => x.name === name)
      if (idx >= 0) adminUsers.splice(idx, 1)
    },
    'admin:usage': async ({ unit, conversationId }) => ({
      unit,
      conversationId: conversationId ?? null,
      totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, messages: 0 },
      byBucket: [],
      byModel: [],
      byConversation: []
    }),
    'usage:report': async ({ unit, conversationId }) => ({
      unit,
      conversationId: conversationId ?? null,
      totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, messages: 0 },
      byBucket: [],
      byModel: [],
      byConversation: []
    }),
    'admin:conversations': async () => [],
    'admin:messages': async () => [],
    'admin:modelPrices': async () => modelPrices.map((price) => ({ ...price })),
    'admin:saveModelPrice': async (input) => {
      const saved: ModelPrice = { ...input, updatedAt: tick() }
      const i = modelPrices.findIndex((price) => price.provider === input.provider && price.model === input.model)
      if (i >= 0) modelPrices[i] = saved
      else modelPrices.push(saved)
      return { ...saved }
    },
    'admin:deleteModelPrice': async ({ provider, model }) => {
      const i = modelPrices.findIndex((price) => price.provider === provider && price.model === model)
      if (i >= 0) modelPrices.splice(i, 1)
    },
    'admin:llmEngines': async () => llmEngines.map((e) => ({ ...e, allowedRoles: [...e.allowedRoles] })),
    'admin:createLlmEngine': async (input) => {
      const created: AdminLlmEngine = { ...input, id: nextId(), createdAt: tick(), allowedRoles: [...input.allowedRoles] }
      if (created.isDefault) for (const item of llmEngines) if (item.kind === created.kind) item.isDefault = false
      llmEngines.push(created)
      llmHealth[created.id] = { engineId: created.id, kind: created.kind, checkedAt: tick(), available: created.enabled, detail: created.enabled ? `${created.kind}: доступен` : 'выключен', status: null }
      return { ...created, allowedRoles: [...created.allowedRoles] }
    },
    'admin:updateLlmEngine': async ({ id, patch }) => {
      const found = llmEngines.find((e) => e.id === id)
      if (!found) throw new Error('not found')
      if (patch.isDefault) for (const item of llmEngines) if (item.kind === patch.kind) item.isDefault = false
      Object.assign(found, { ...patch, allowedRoles: [...patch.allowedRoles] })
      return { ...found, allowedRoles: [...found.allowedRoles] }
    },
    'admin:deleteLlmEngine': async ({ id }) => {
      const idx = llmEngines.findIndex((e) => e.id === id)
      if (idx >= 0) llmEngines.splice(idx, 1)
      delete llmHealth[id]
    },
    'admin:checkLlmEngineHealth': async ({ id }) => ({ ...(llmHealth[id] ?? { engineId: id, kind: 'claude', checkedAt: tick(), available: false, detail: 'offline', status: null }) }),
    'releases:branches': async () => [],
    'releases:createBranch': async ({ projectId, branch }) => ({ id: 'prepare-1', projectId, branch, version: branch.slice('release/'.length), sha: 'a'.repeat(40), status: 'preparing', triggeredBy: 'admin', attempt: 1, previousReleaseId: null, createdAt: Date.now(), releasedAt: null, steps: [] }),
    'releases:managedPreflight': async () => ({ ok: true, environment: 'production', paths: { root: '/storage/projects/p1/environments/production', app: '/storage/projects/p1/environments/production/app', config: '/storage/projects/p1/environments/production/config', logs: '/storage/projects/p1/environments/production/logs', artifacts: '/storage/projects/p1/environments/production/artifacts', temporary: '/storage/projects/p1/environments/production/temporary', repository: '/storage/projects/p1/environments/production/temporary/repository', manifest: '/storage/projects/p1/environments/production/environment.json' }, checks: Object.fromEntries(['marker','manifest','origin','branch','write','freeSpace','deployCommand','healthCheckCommand'].map(name => [name, { ok: true, message: 'Проверка пройдена' }])) as never, confirmationToken: 'managed-token' }),
    'releases:managedConfirm': async ({ projectId }) => ({ id: projectId, name: 'Project', description: '', gitUrl: null, technologies: [], skills: [], defaultSkills: { epic: [], story: [], task: [] }, createdBy: 'admin', createdAt: 1, updatedAt: 1, role: 'owner', commitPolicy: 'agent_commits', mergeTransport: 'local', agentPlanApprovalMode: 'manual', members: [], machines: [], defaultAgentId: null, productionEnvironmentMode: 'managed' }),
    'projects:bootstrapProduction': async () => ({ ok: true, mode: 'managed' as const, defaultMachineSet: true, preflight: { ok: true, environment: 'production' as const, paths: { root: '/s/p1/environments/production', app: '/s/p1/environments/production/app', config: '/s/p1/environments/production/config', logs: '/s/p1/environments/production/logs', artifacts: '/s/p1/environments/production/artifacts', temporary: '/s/p1/environments/production/temporary', repository: '/s/p1/environments/production/temporary/repository', manifest: '/s/p1/environments/production/environment.json' }, checks: Object.fromEntries(['marker','manifest','origin','branch','write','freeSpace','deployCommand','healthCheckCommand'].map(name => [name, { ok: true, message: 'Проверка пройдена' }])) as never }, cliLoginHint: 'Войдите в CLI на машине.' }),
    'releases:list': async () => [],
    'releases:get': async () => null,
    'releases:delete': async () => ({ deleted: true as const }),
    'releases:deploy': async ({ projectId, branch }) => ({ id: 'release-1', projectId, branch, version: branch.slice('release/'.length), sha: 'a'.repeat(40), status: 'queued', triggeredBy: 'admin', attempt: 1, previousReleaseId: null, createdAt: Date.now(), releasedAt: null, steps: [] }),
    'projects:list': async () => projects.map(summary),
    'projects:create': async (b) => {
      const ts = tick()
      const id = nextId()
      const p: FProject = {
        id,
        name: b.name,
        description: b.description ?? '',
        gitUrl: b.gitUrl ?? null,
        previewUrl: null,
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
        ['Бэклог', 'backlog'], ['Подготовка к разработке', 'preparation'],
        ['Ready for Development', 'ready'], ['Development', 'development'],
        ['Component QA', 'component_qa'], ['Создание интеграционных автотестов', 'integration_tests'],
        ['Automated QA', 'automated_qa'], ['Ручное QA', 'manual_qa'],
        ['Ожидает мержа', 'awaiting_merge'], ['Мерж', 'merge'], ['Готово', 'done'],
        ['Отменено', 'cancelled'], ['Требуется решение', 'decision_required']
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
      if (f.previewUrl !== undefined) p.previewUrl = f.previewUrl
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
    'projects:updateMemberRole': async ({ id, username, role }) => {
      const p = projects.find((x) => x.id === id)!
      const member = p.members.find((m) => m.username === username)
      if (member) member.role = role
      return detail(p)
    },
    'projects:removeMember': async ({ id, username }) => {
      const p = projects.find((x) => x.id === id)!
      p.members = p.members.filter((m) => m.username !== username)
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
    'projects:configureMachineStorage': async ({ id, agentId, storageId, directories }) => {
      const p = projects.find((x) => x.id === id)!
      const m = p.machines.find((x) => x.agentId === agentId)
      if (m) Object.assign(m, { storageId, directories, path: directories?.projectWorkdir.path ?? m.path, reposRoot: directories?.reposRoot.path ?? m.reposRoot })
      return detail(p)
    },
    'projects:resetMachineDirectory': async ({ id, agentId, kind }) => {
      const p = projects.find((x) => x.id === id)!
      const m = p.machines.find((x) => x.agentId === agentId) as ProjectMachine | undefined
      if (m?.directories && m.recommendations) m.directories[kind] = { path: m.recommendations[kind], override: false }
      return detail(p)
    },
    'projects:setMachinePath': async ({ id, agentId, path }) => {
      const p = projects.find((x) => x.id === id)!
      const m = p.machines.find((x) => x.agentId === agentId)
      if (m) m.path = path
      return detail(p)
    },
    'projects:gitAccessStatus': async ({ repositoryUrl }) => ({ ok: true, status: { configured: false, repositoryUrl, readAccess: 'unknown', writeAccess: 'unknown', warnings: [] } }),
    'projects:configureGitAccess': async ({ repositoryUrl }) => ({ ok: true, status: { configured: true, repositoryUrl, account: 'octocat', readAccess: 'unknown', writeAccess: 'unknown', warnings: [] } }),
    'projects:verifyGitAccess': async ({ repositoryUrl }) => ({ ok: true, status: { configured: true, repositoryUrl, account: 'octocat', checkedAt: Date.now(), readAccess: 'ok', writeAccess: 'ok', warnings: [] } }),
    'projects:deleteGitAccess': async ({ repositoryUrl }) => ({ ok: true, status: { configured: false, repositoryUrl, readAccess: 'unknown', writeAccess: 'unknown', warnings: [] } }),
    'projects:gitAccessDiagnostics': async ({ repositoryUrl }) => ({ ok: true, status: { configured: false, repositoryUrl, readAccess: 'unknown', writeAccess: 'unknown', warnings: [] }, diagnostics: { originalUrl: repositoryUrl, effectiveUrl: repositoryUrl, matchingRules: [], warnings: [] } }),
    'projects:setReposRoot': async ({ id, agentId, reposRoot }) => { const p = projects.find((x) => x.id === id)!; const m = p.machines.find((x) => x.agentId === agentId); if (m) m.reposRoot = reposRoot; return detail(p) },
    'projects:setMachineSsh': async ({ id, agentId, sshHost, sshUser }) => { const p = projects.find((x) => x.id === id)!; const m = p.machines.find((x) => x.agentId === agentId); if (m) Object.assign(m, { sshHost, sshUser }); return detail(p) },
    'projects:setDefaultMachine': async ({ id, agentId }) => {
      const p = projects.find((x) => x.id === id)!
      if (p.machines.some((m) => m.agentId === agentId)) p.defaultAgentId = agentId
      return detail(p)
    },
    'projects:setUserDefaultMachine': async ({ id, agentId }) => {
      const result = detail(projects.find((x) => x.id === id)!)
      result.machines = result.machines.map((machine) => ({ ...machine, isMyDefault: machine.agentId === agentId }))
      return result
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
    'tasks:createFromProposalInPreparation': async ({ proposalId }) => ({ type: 'preparation', status: 'success', taskId: `task-${proposalId}`, runId: `prep-${proposalId}` }),
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
        assignee: assignee ?? ME,
        createdBy: ME,
        createdByName: ME,
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
      const ts = tick()
      if (done && t.doneAt == null) nowMs += 1
      t.doneAt = done ? t.doneAt ?? nowMs : null
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
      t.updatedAt = ts
      return { ...t }
    },
    'tasks:listPreparationRuns': async () => [],
    'tasks:getPreparationRun': async () => null,
    'tasks:get': async () => null,
    'tasks:cancelPreparationRun': async ({ runId }) => ({ id: runId, projectId: '', taskId: '', status: 'cancelled', attempt: 1, maxAttempts: 1, log: '', error: 'Подготовка отменена пользователем', readiness: null, gateReasons: [], createdAt: nowMs, finishedAt: nowMs, canRetry: true, canCancel: false }),
    'tasks:startPreparationRun': async ({ projectId, taskId, selection }) => ({ id: `preparation-${taskId}`, projectId, taskId, status: 'running', attempt: 1, maxAttempts: 1, provider: selection?.provider, model: selection?.model, llmEngineId: selection?.llmEngineId, log: '', error: null, readiness: null, gateReasons: [], createdAt: nowMs, finishedAt: null, canRetry: false, canCancel: true }),
    'tasks:retryPreparationRun': async ({ runId, selection }) => ({ id: `${runId}-retry`, projectId: '', taskId: '', status: 'running', attempt: 1, maxAttempts: 1, provider: selection?.provider, model: selection?.model, llmEngineId: selection?.llmEngineId, log: '', error: null, readiness: null, gateReasons: [], createdAt: nowMs, finishedAt: null, canRetry: false, canCancel: true }),
    'tasks:answerPreparationQuestion': async ({ questionId, answer }) => ({ accepted: true, alreadyAnswered: false, question: { questionId, attemptId: '', text: '', material: true, status: 'answered', answer, askedAt: nowMs, answeredAt: nowMs, answeredBy: 'test' } }),
    'tasks:listPreparationNotifications': async () => [],
    'tasks:dismissPreparationNotification': async () => ({ dismissed: true }),
    'tasks:exportPreparationRun': async () => {},
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

    _advanceDays: (days) => { nowMs += days * 24 * 60 * 60 * 1000 },

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
  CiQueueRemovalResult,
  CiRunDetail,
  CiInteraction,
  CiLlmConfig,
  CiRunStep,
  CiRunReport,
  CiTaskReport,
  CiLogLine
} from '@shared/ci'
import { DEFAULT_CI_GLOBAL_SETTINGS, DEFAULT_CI_LLM_CONFIG, EMPTY_CI_USAGE_TOTALS, ciTaskTotals } from '@shared/ci'

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
  let taskProcessStages: import('@shared/ci').CiProcessStage[] = ['before_model', 'model_work', 'after_model', 'summary']
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

  /** Отчёт по рану из фейковой ленты: шаги и длительности есть, расход пуст. */
  const runReport = (rid: string): CiRunReport => {
    const d = runs.get(rid)
    const run = d?.run ?? mkRun('p', 't')
    return {
      runId: run.id, projectId: run.projectId, taskId: run.taskId, status: run.status, mode: run.mode,
      provider: run.llmProvider, model: run.llmModel, startedAt: run.startedAt, finishedAt: run.finishedAt,
      durationMs: run.durationMs, createdAt: run.createdAt, fixAttempts: d?.fixAttempts.length ?? 0, kbHit: null,
      // Ходов модели фейк не делает — значит и вызовов инструментов у него нет
      // (null, а не нули: так же выглядит ран, сделанный до появления счётчика).
      toolCalls: null,
      toolChars: null,
      toolResponses: [],
      totals: { ...EMPTY_CI_USAGE_TOTALS },
      // Стадий тоже нет: они считаются по строкам расхода, а ходов модели у
      // фейка не бывает.
      stages: [],
      steps: (d?.steps ?? []).map((s) => ({
        id: s.id, parentStepId: s.parentStepId, title: s.title, slot: s.slot, kind: s.kind,
        initiatedBy: s.initiatedBy, status: s.status, attempt: s.attempt, fixedByModel: s.fixedByModel,
        exitCode: s.exitCode, durationMs: s.durationMs, usage: null
      }))
    }
  }

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
    getProjectCiLlm: async () => ({ config: { ...projectLlm }, inherited: { ...DEFAULT_CI_LLM_CONFIG }, overridden: true }),
    putProjectCiLlm: async (_pid, config) => { projectLlm = { ...config }; return { config: { ...projectLlm }, inherited: { ...DEFAULT_CI_LLM_CONFIG }, overridden: true } },
    resetProjectCiLlm: async () => { projectLlm = { ...DEFAULT_CI_LLM_CONFIG }; return { config: { ...projectLlm }, inherited: { ...DEFAULT_CI_LLM_CONFIG }, overridden: false } },
    getTaskCiLlm: async () => ({ config: { ...(taskLlm ?? projectLlm) }, overridden: taskLlm !== null, projectDefault: { ...projectLlm } }),
    getTaskPreparationLlm: async () => ({ llmEngineId: (taskLlm ?? projectLlm).llmEngineId ?? null, provider: (taskLlm ?? projectLlm).provider, model: (taskLlm ?? projectLlm).model }),
    putTaskCiLlm: async (_pid, _tid, config) => { taskLlm = { ...config }; return { ...config } },
    resetTaskCiLlm: async () => { taskLlm = null; return { config: { ...projectLlm }, overridden: false, projectDefault: { ...projectLlm } } },
    getTaskCi: async () => ({ config: { beforeModel: [], afterModel: [] }, overridden: false, projectDefault: { beforeModel: [], afterModel: [] }, enabledStages: [...taskProcessStages] }),
    getTaskMachines: async () => ({ machines: [], selectedAgentId: null, unavailableSelection: null }),
    putTaskCi: async (_pid, _tid, config) => {
      if (config.enabledStages) taskProcessStages = [...config.enabledStages]
      return { beforeModel: config.beforeModel ?? [], afterModel: config.afterModel ?? [], enabledStages: [...taskProcessStages] }
    },
    startRun: async (projectId, taskId, options) => { const run = { ...mkRun(projectId, taskId), mode: options?.mode ?? projectLlm.mode }; runs.set(run.id, { run, steps: [], fixAttempts: [], interactions: [] }); logs.set(run.id, []); return { ...run } },
    getMergeMachines: async () => ({ machines: [], defaultAgentId: null }),
    startMerge: async (projectId, taskId) => ({ id: `merge-${taskId}`, projectId, taskId, status: 'queued', triggeredBy: 'admin', sourceBranch: `feature/${taskId}`, targetBranch: 'main', sourceSha: null, targetSha: null, mergeSha: null, revertSha: null, agentId: 'a1', llmEngineId: null, llmProvider: 'claude', llmModel: '', stage: 'queued', stages: [], conflicts: [], conflictDetails: [], checks: [], deployId: null, deployVersion: null, productionStatus: null, error: null, recommendedAction: null, log: '', canCancel: true, canRetry: false, pushStartedAt: null, startedAt: now(), finishedAt: null, createdAt: now() }),
    getMerge: async () => { throw new Error('merge run not found') },
    getTaskRepositories: async () => [],
    listMergeRuns: async () => [],
    deployMergeRun: async () => { throw new Error('merge run not found') },
    cancelMerge: async () => { throw new Error('merge run not found') },
    retryMerge: async () => { throw new Error('merge run not found') },
    forceStartRun: async (projectId, taskId, agentId) => { const run = { ...mkRun(projectId, taskId), agentId }; runs.set(run.id, { run, steps: [], fixAttempts: [], interactions: [] }); logs.set(run.id, []); return { ...run } },
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
    // Расхода у фейка тоже нет — ходов модели он не делает; шаги и время берём
    // из его же ленты, чтобы отчёт было на чём открыть.
    getRunReport: async (rid) => runReport(rid),
    getTaskReport: async (projectId, taskId) => {
      const list = [...runs.values()].filter((d) => d.run.taskId === taskId).map((d) => runReport(d.run.id))
      return { projectId, taskId, runs: list, ...ciTaskTotals(list) } as CiTaskReport
    },
    getTaskTimeline: async (_projectId, taskId) => {
      const at = new Date(now()).toISOString()
      return { version: 1 as const, taskId, generatedAt: at, summary: { createdAt: at, firstStartedAt: null, finishedAt: null, calendarDuration: null, activeDuration: 0, queueDuration: 0, awaitingInputDuration: 0, lastChangedAt: at }, stages: [] }
    },
    listTaskImprovements: async () => [],
    listProjectImprovementTasks: async () => [],
    updateImprovementStatus: async () => { throw new Error('improvement not found') },
    createTaskFromImprovement: async () => { throw new Error('improvement not found') },
    cancelRun: async () => ({ ok: true }),
    dequeueRun: async (rid): Promise<CiQueueRemovalResult> => {
      const d = runs.get(rid)
      if (!d) return { status: 'not_found' }
      if (d.run.status === 'queued' || d.run.status === 'cancelled') {
        d.run = { ...d.run, status: 'cancelled', finishedAt: now() }
        emit('ci.done', { runId: rid, run: d.run })
        return { status: 'removed', run: { ...d.run } }
      }
      return { status: d.run.status === 'running' || d.run.status === 'awaiting_input' ? 'running' : 'not_queued', run: { ...d.run } }
    },
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
    onMerge: (cb) => on('merge.snapshot', cb as L),
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
