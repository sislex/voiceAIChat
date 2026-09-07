import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { KANBAN_TOOLS, type WidgetAssistantContext } from '@voicechat/shared'
import { VoiceChatDb } from '../db/database.js'
import { registerKanbanMcp } from './kanbanMcp.js'
import { WidgetContextStore } from './widgetContext.js'
import { WidgetUiRelay } from './widgetUiRelay.js'
import { createOrchestrationManager, type OrchestrationManager } from '../orchestration/runManager.js'

const SECRET = 's'
const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }
const call = (name: string, args: Record<string, unknown> = {}): unknown => ({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } })
const LIST = { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }

function resultText(json: unknown): { text: string; isError: boolean } {
  const r = (json as { result?: { content?: { text?: string }[]; isError?: boolean } }).result
  return { text: r?.content?.map((c) => c.text ?? '').join('') ?? '', isError: Boolean(r?.isError) }
}
function resultJson<T>(json: unknown): T {
  return JSON.parse(resultText(json).text) as T
}

let app: FastifyInstance
let db: VoiceChatDb
let contexts: WidgetContextStore
let ui: WidgetUiRelay
let uiActions: Array<{ requestId: string; action: { kind: string; route?: string; commandId?: string } }>
let boardEvents: string[]
let orchestration: OrchestrationManager
let startedCi: string[]
/** Как клиент отвечает на действие в интерфейсе (подтверждение или отказ). */
let uiReply: (action: { kind: string }) => { ok: boolean; result?: { surface: null; confirmed?: boolean }; error?: string }
let projectId: string
let conv: string
let taskId: string
let columnId: string

beforeEach(async () => {
  let id = 0
  let clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  db.identity.createUser('ann', '', 'developer')
  const project = db.projects.createProject('ann', { name: 'Chat' })!
  projectId = project.id
  columnId = db.tasks.getBoard('ann', projectId)!.columns[0]!.id
  taskId = db.tasks.createTask('ann', projectId, { columnId, title: 'Починить логин' })!.id
  conv = db.chat.ensureKanbanAssistantConversation('ann', projectId)!.id
  contexts = new WidgetContextStore()
  ui = new WidgetUiRelay()
  uiActions = []
  boardEvents = []
  uiReply = () => ({ ok: true, result: { surface: null, confirmed: true } })
  // Единственный «клиент» пользователя: отвечает на widget.action так, как задал тест.
  ui.subscribe('ann', (message) => {
    if (message.t !== 'widget.action') return
    uiActions.push({ requestId: message.requestId, action: message.action })
    const reply = uiReply(message.action)
    setTimeout(() => ui.resolve('ann', message.requestId, reply, message.conversationId), 0)
  })
  startedCi = []
  const launchers = {
    startCi: (_userId: string, _projectId: string, taskIdArg: string) => {
      startedCi.push(taskIdArg)
      return { run: { id: `run-${startedCi.length}`, status: 'queued', agentId: null } }
    },
    cancelCi: () => true,
    startMerge: async () => ({ id: 'merge-1', status: 'queued' }),
    startQa: async () => ({ id: 'qa-1', status: 'queued' }),
    deployRelease: async (_userId: string, _projectId: string, branch: string) => ({ id: 'rel-1', status: 'queued', branch })
  }
  orchestration = createOrchestrationManager({ db, runs: () => launchers, tickMs: 60_000 })
  app = Fastify({ logger: false })
  registerKanbanMcp(app, { db, contexts, ui, boardChanged: (id) => boardEvents.push(id), runs: () => launchers, orchestration: () => orchestration }, SECRET)
  await app.ready()
})
afterEach(async () => {
  orchestration?.dispose()
  await app?.close()
  db?.close()
})

async function rpc(body: unknown, query = `?k=${SECRET}&conv=${conv}&turn=t1`): Promise<{ statusCode: number; json: () => unknown }> {
  const res = await app.inject({ method: 'POST', url: `/mcp/kanban${query}`, headers: MCP_HEADERS, payload: body as object })
  return { statusCode: res.statusCode, json: () => res.json() }
}

describe('kanbanMcp', () => {
  it('без секрета — 403, для чужого или непроектного разговора — 404', async () => {
    expect((await rpc(INIT, `?k=wrong&conv=${conv}`)).statusCode).toBe(403)
    expect((await rpc(INIT, `?k=${SECRET}&conv=missing`)).statusCode).toBe(404)
    // Разговор без проекта: канбану нечего показывать.
    const loose = db.chat.createConversation('ann', 'Просто чат')
    expect((await rpc(INIT, `?k=${SECRET}&conv=${loose.id}`)).statusCode).toBe(404)
    // Чужая специализированная поверхность не получает инструменты канбана.
    const make = db.chat.createConversation('ann', 'Make', 'make')
    db.chat.setConversationProject('ann', make.id, projectId)
    expect((await rpc(INIT, `?k=${SECRET}&conv=${make.id}`)).statusCode).toBe(404)
  })

  it('регистрирует ровно объявленный в контракте набор инструментов', async () => {
    await rpc(INIT)
    const tools = (await rpc(LIST)).json() as { result: { tools: { name: string }[] } }
    expect(tools.result.tools.map((tool) => tool.name).sort()).toEqual([...KANBAN_TOOLS].sort())
  })

  it('kanban_context отдаёт снимок экрана хода вместе с проектом', async () => {
    await rpc(INIT)
    const empty = resultJson<{ surface: unknown; project: { name: string } }>((await rpc(call('kanban_context'))).json())
    expect(empty.surface).toBeNull()
    expect(empty.project.name).toBe('Chat')

    const context: WidgetAssistantContext = {
      version: 1,
      widget: { kind: 'kanban', instanceId: projectId, title: 'Chat' },
      project: null,
      selection: null,
      surface: { route: `/projects/${projectId}/settings`, section: 'settings', openTaskId: null, openTaskTab: null, boardView: null, commands: [{ id: 'task.create', title: 'Создать задачу', section: 'action' }] },
      recentActions: []
    }
    contexts.remember(conv, 't1', context)
    const filled = resultJson<{ surface: { section: string; commands: { id: string }[] } }>((await rpc(call('kanban_context'))).json())
    expect(filled.surface.section).toBe('settings')
    expect(filled.surface.commands[0]!.id).toBe('task.create')
  })

  it('kanban_board отдаёт колонки с семантикой и компактные карточки', async () => {
    await rpc(INIT)
    const board = resultJson<{ columns: { semanticType: string; tasks: number }[]; tasks: { key: string; title: string }[] }>((await rpc(call('kanban_board'))).json())
    expect(board.columns.length).toBeGreaterThan(0)
    expect(board.tasks).toHaveLength(1)
    expect(board.tasks[0]!.title).toBe('Починить логин')
    // Ключ задачи, а не внутренний id: по нему пользователь узнаёт карточку.
    expect(board.tasks[0]!.key).toMatch(/-1$/)
  })

  it('kanban_task_get отдаёт карточку со сводкой процессов, чужая — ошибка', async () => {
    await rpc(INIT)
    const found = resultJson<{ task: { title: string }; ci: unknown[]; merge: unknown[] }>((await rpc(call('kanban_task_get', { taskId }))).json())
    expect(found.task.title).toBe('Починить логин')
    expect(found.ci).toEqual([])
    expect(found.merge).toEqual([])
    const missing = resultText((await rpc(call('kanban_task_get', { taskId: 'nope' }))).json())
    expect(missing.isError).toBe(true)
  })

  it('kanban_search_tasks находит по тексту', async () => {
    await rpc(INIT)
    const hit = resultJson<{ found: number }>((await rpc(call('kanban_search_tasks', { text: 'логин' }))).json())
    expect(hit.found).toBe(1)
    const miss = resultJson<{ found: number }>((await rpc(call('kanban_search_tasks', { text: 'корзина' }))).json())
    expect(miss.found).toBe(0)
  })

  it('project_info показывает участников и машины с загрузкой', async () => {
    await rpc(INIT)
    const info = resultJson<{ name: string; members: { username: string }[]; machines: unknown[] }>((await rpc(call('project_info'))).json())
    expect(info.name).toBe('Chat')
    expect(info.members.map((member) => member.username)).toContain('ann')
    expect(Array.isArray(info.machines)).toBe(true)
  })

  it('project_api_get читает по ключу и требует taskId для task_*', async () => {
    await rpc(INIT)
    const columns = resultJson<{ id: string }[]>((await rpc(call('project_api_get', { key: 'columns' }))).json())
    expect(columns.some((column) => column.id === columnId)).toBe(true)
    const needsTask = resultText((await rpc(call('project_api_get', { key: 'task_ci_runs' }))).json())
    expect(needsTask.isError).toBe(true)
    expect(needsTask.text).toContain('taskId')
    const runs = resultJson<unknown[]>((await rpc(call('project_api_get', { key: 'task_ci_runs', taskId }))).json())
    expect(runs).toEqual([])
  })

  it('в режиме автономии карточка создаётся без вопросов и рассылает доску', async () => {
    await rpc(INIT)
    const created = resultJson<{ created: { title: string; column: string } }>((await rpc(call('kanban_task_create', { title: 'Корзина' }))).json())
    expect(created.created.title).toBe('Корзина')
    expect(uiActions).toHaveLength(0)
    expect(boardEvents).toEqual([projectId])
    expect(db.tasks.getBoard('ann', projectId)!.tasks.map((task) => task.title)).toContain('Корзина')
  })

  it('в режиме подтверждений изменение уходит пользователю и отказ его отменяет', async () => {
    db.chat.setConversationAutonomy('ann', conv, 'confirm')
    await rpc(INIT)
    uiReply = () => ({ ok: true, result: { surface: null, confirmed: false } })
    const declined = resultText((await rpc(call('kanban_task_update', { taskId, title: 'Другое имя' }))).json())
    expect(declined.isError).toBe(true)
    expect(declined.text).toContain('отклонил')
    expect(uiActions[0]!.action.kind).toBe('confirm')
    expect(db.tasks.getTaskDetail('ann', projectId, taskId)!.title).toBe('Починить логин')

    uiReply = () => ({ ok: true, result: { surface: null, confirmed: true } })
    const accepted = resultJson<{ updated: { title: string } }>((await rpc(call('kanban_task_update', { taskId, title: 'Другое имя' }))).json())
    expect(accepted.updated.title).toBe('Другое имя')
  })

  it('комментарии карточки: модель добавляет, правит и удаляет с подтверждением', async () => {
    await rpc(INIT)
    const board = db.tasks.getBoard('ann', projectId)!
    const taskId = db.tasks.createTask('ann', projectId, { columnId: board.columns[0]!.id, title: 'С комментами' })!.id

    // Добавление и правка — обычные мутации (в автономии идут без вопросов).
    const added = resultJson<{ comment: { id: string; via: string; author: string } }>((await rpc(call('task_comment_add', { taskId, text: 'Предлагаю уточнить критерии' }))).json())
    expect(added.comment.via).toBe('model')
    expect(added.comment.author).toBe('ann')

    const updated = resultJson<{ comment: { text: string } }>((await rpc(call('task_comment_update', { taskId, commentId: added.comment.id, text: 'Уточнил сам' }))).json())
    expect(updated.comment.text).toBe('Уточнил сам')

    // Чтение активности отдаёт комментарий с пометкой модели.
    const activity = resultJson<{ comments: Array<{ via: string }> }>((await rpc(call('task_comments', { taskId }))).json())
    expect(activity.comments.map((comment) => comment.via)).toEqual(['model'])

    // Удаление необратимо: подтверждение спрашивается даже в полной автономии.
    uiActions.length = 0
    const deleted = resultJson<{ deleted: string }>((await rpc(call('task_comment_delete', { taskId, commentId: added.comment.id }))).json())
    expect(deleted.deleted).toBe(added.comment.id)
    expect(uiActions.map((entry) => entry.action.kind)).toEqual(['confirm'])
    expect(db.tasks.taskActivity('ann', projectId, taskId)!.comments).toEqual([])

    // Ворклог от модели.
    const entry = resultJson<{ entry: { minutes: number } }>((await rpc(call('task_worklog_add', { taskId, minutes: 45, comment: 'ревью' }))).json())
    expect(entry.entry.minutes).toBe(45)
  })

  it('настройки проекта спрашивают подтверждение даже в режиме автономии', async () => {
    await rpc(INIT)
    const result = resultJson<{ updated: { name: string } }>((await rpc(call('project_settings_update', { name: 'Chat 2' }))).json())
    expect(uiActions.map((entry) => entry.action.kind)).toEqual(['confirm'])
    expect(result.updated.name).toBe('Chat 2')
  })

  it('в режиме «План» изменения запрещены', async () => {
    await rpc(INIT, `?k=${SECRET}&conv=${conv}&turn=t1&ro=1`)
    const blocked = resultText((await rpc(call('kanban_task_create', { title: 'Не должно появиться' }), `?k=${SECRET}&conv=${conv}&turn=t1&ro=1`)).json())
    expect(blocked.isError).toBe(true)
    expect(blocked.text).toContain('План')
    expect(db.tasks.getBoard('ann', projectId)!.tasks).toHaveLength(1)
  })

  it('перенос уважает карту переходов workflow', async () => {
    const board = db.tasks.getBoard('ann', projectId)!
    const development = board.columns.find((column) => column.semanticType === 'development')
    const done = board.columns.find((column) => column.semanticType === 'done')
    if (!development || !done) return
    db.tasks.moveTask('ann', projectId, taskId, { columnId: development.id })
    await rpc(INIT)
    const blocked = resultText((await rpc(call('kanban_task_move', { taskId, columnId: done.id }))).json())
    expect(blocked.isError).toBe(true)
    expect(blocked.text).toContain('запрещён')
  })

  it('ui_navigate уводит только внутри проекта, ui_run_command доходит до клиента', async () => {
    await rpc(INIT)
    const alien = resultText((await rpc(call('ui_navigate', { route: '/admin' }))).json())
    expect(alien.isError).toBe(true)
    expect(uiActions).toHaveLength(0)

    const own = resultText((await rpc(call('ui_navigate', { route: `/projects/${projectId}/settings` }))).json())
    expect(own.isError).toBe(false)
    expect(uiActions[0]!.action).toMatchObject({ kind: 'navigate', route: `/projects/${projectId}/settings` })

    await rpc(call('ui_run_command', { commandId: 'task.create' }))
    expect(uiActions[1]!.action).toMatchObject({ kind: 'run-command', commandId: 'task.create' })
    expect(ui.pendingCount()).toBe(0)
  })

  it('создание задачи-дубликата блокируется, пока модель не подтвердит разницу', async () => {
    const board = db.tasks.getBoard('ann', projectId)!
    const development = board.columns.find((column) => column.semanticType === 'development')
    if (development) db.tasks.moveTask('ann', projectId, taskId, { columnId: development.id })
    await rpc(INIT)

    const blocked = resultJson<{ created: null; blockedBySimilar: Array<{ key: string; state: string; blocking: boolean }> }>(
      (await rpc(call('kanban_task_create', { title: 'Починить логин на телефоне' }))).json()
    )
    expect(blocked.created).toBeNull()
    expect(blocked.blockedBySimilar[0]!.state).toBe('in_progress')
    expect(db.tasks.getBoard('ann', projectId)!.tasks).toHaveLength(1)

    const forced = resultJson<{ created: { title: string } }>(
      (await rpc(call('kanban_task_create', { title: 'Починить логин на телефоне', acknowledgeSimilar: true }))).json()
    )
    expect(forced.created.title).toBe('Починить логин на телефоне')
  })

  it('kanban_find_similar отличает «сделано и вмержено» от «сделано, но не вмержено»', async () => {
    const board = db.tasks.getBoard('ann', projectId)!
    const done = board.columns.find((column) => column.semanticType === 'done')
    if (!done) return
    db.tasks.moveTask('ann', projectId, taskId, { columnId: done.id })
    await rpc(INIT)
    const hits = resultJson<{ hits: Array<{ state: string; blocking: boolean }>; advice: string }>(
      (await rpc(call('kanban_find_similar', { title: 'Починить логин' }))).json()
    )
    expect(hits.hits[0]!.state).toBe('done_not_merged')
    expect(hits.hits[0]!.blocking).toBe(true)
    expect(hits.advice).toContain('merge')
  })

  it('пароли тестовых учёток проекту не отдаются', async () => {
    db.projects.updateProject('ann', projectId, { testUsers: [{ role: 'admin', name: 'qa', password: 'secret' }] })
    await rpc(INIT)
    const detail = resultJson<{ testUsers: Array<Record<string, unknown>> }>((await rpc(call('project_api_get', { key: 'project' }))).json())
    expect(detail.testUsers[0]).toMatchObject({ name: 'qa' })
    expect(detail.testUsers[0]!.password).toBeUndefined()
  })

  it('machines_load объясняет, куда запускать работу', async () => {
    await rpc(INIT)
    const load = resultJson<{ machines: unknown[]; recommended: string | null; reason: string }>((await rpc(call('machines_load'))).json())
    expect(load.machines).toEqual([])
    expect(load.recommended).toBeNull()
    expect(load.reason).toContain('нет')
  })

  it('orchestration_plan отбраковывает план без задачи и принимает связный', async () => {
    await rpc(INIT)
    const broken = resultText((await rpc(call('orchestration_plan', {
      title: 'Серия',
      items: [{ kind: 'run_ci', title: 'Разработка' }]
    }))).json())
    expect(broken.isError).toBe(true)
    expect(broken.text).toContain('нужна задача')

    const valid = resultJson<{ valid: boolean; steps: number }>((await rpc(call('orchestration_plan', {
      title: 'Серия',
      items: [
        { kind: 'create_task', title: 'Корзина', payload: { title: 'Корзина' } },
        { kind: 'run_ci', title: 'Разработка', dependsOn: [0] }
      ]
    }))).json())
    expect(valid).toMatchObject({ valid: true, steps: 2 })
  })

  it('orchestration_start спрашивает подтверждение и начинает вести план', async () => {
    await rpc(INIT)
    const started = resultJson<{ started: { id: string; status: string; items: Array<{ status: string }> } }>((await rpc(call('orchestration_start', {
      title: 'Серия задач',
      items: [
        { kind: 'create_task', title: 'Корзина', payload: { title: 'Корзина' } },
        { kind: 'run_ci', title: 'Разработка', dependsOn: [0] }
      ]
    }))).json())
    // План — необратимое действие: подтверждение спрашивается и в автономии.
    expect(uiActions.map((entry) => entry.action.kind)).toEqual(['confirm'])
    expect(started.started.items[0]!.status).toBe('done')
    expect(started.started.items[1]!.status).toBe('running')
    expect(startedCi).toHaveLength(1)

    const status = resultJson<{ plans: Array<{ id: string; status: string }> }>((await rpc(call('orchestration_status'))).json())
    expect(status.plans[0]!.id).toBe(started.started.id)

    const cancelled = resultJson<{ cancelled: { status: string } }>((await rpc(call('orchestration_cancel', { planId: started.started.id }))).json())
    expect(cancelled.cancelled.status).toBe('cancelled')
  })

  it('повтор того же вызова в ходе не создаёт вторую карточку', async () => {
    await rpc(INIT)
    const first = resultJson<{ created: { id: string } }>((await rpc(call('kanban_task_create', { title: 'Корзина' }))).json())
    const second = resultText((await rpc(call('kanban_task_create', { title: 'Корзина' }))).json())
    expect(second.text).toContain('Повтор того же вызова')
    expect(second.text).toContain(first.created.id)
    expect(db.tasks.getBoard('ann', projectId)!.tasks.filter((task) => task.title === 'Корзина')).toHaveLength(1)

    // Другой ход — другой ключ: там это уже осознанное повторное действие.
    const other = resultJson<{ created: { id: string } }>((await rpc(call('kanban_task_create', { title: 'Корзина' }), `?k=${SECRET}&conv=${conv}&turn=t2`)).json())
    expect(other.created.id).not.toBe(first.created.id)
  })

  it('отказ не запоминается: после «нет» пользователь может согласиться', async () => {
    db.chat.setConversationAutonomy('ann', conv, 'confirm')
    await rpc(INIT)
    uiReply = () => ({ ok: true, result: { surface: null, confirmed: false } })
    expect(resultText((await rpc(call('kanban_task_update', { taskId, title: 'Новое' }))).json()).isError).toBe(true)
    uiReply = () => ({ ok: true, result: { surface: null, confirmed: true } })
    const accepted = resultJson<{ updated: { title: string } }>((await rpc(call('kanban_task_update', { taskId, title: 'Новое' }))).json())
    expect(accepted.updated.title).toBe('Новое')
  })

  it('ui_run_command не нажимает кнопки, обходящие подтверждения', async () => {
    await rpc(INIT)
    const forbidden = resultText((await rpc(call('ui_run_command', { commandId: 'app.logout' }))).json())
    expect(forbidden.isError).toBe(true)
    expect(uiActions).toHaveLength(0)
  })

  it('релизные инструменты закрыты для не-владельца и спрашивают подтверждение у владельца', async () => {
    db.identity.createUser('bob', '', 'developer')
    db.projects.addMember('ann', projectId, 'bob')
    const memberConv = db.chat.ensureKanbanAssistantConversation('bob', projectId)!.id
    await rpc(INIT, `?k=${SECRET}&conv=${memberConv}&turn=t1`)
    const forbidden = resultText((await rpc(call('release_deploy', { branch: 'release/1.0.0' }), `?k=${SECRET}&conv=${memberConv}&turn=t1`)).json())
    expect(forbidden.isError).toBe(true)
    expect(forbidden.text).toContain('владелец')

    await rpc(INIT)
    const asOwner = resultJson<{ deploy: { id: string } }>((await rpc(call('release_deploy', { branch: 'release/1.0.0' }))).json())
    expect(asOwner.deploy.id).toBe('rel-1')
    // Выкладка наружу спрашивается даже в режиме автопилота.
    expect(uiActions.map((entry) => entry.action.kind)).toContain('confirm')
  })
})
