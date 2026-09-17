// Начало конвейера у автопрохода. Координатор раньше подхватывал задачу только
// с `component_qa`: старт подготовки и переход ready → development жили в
// drag&drop-роуте доски, поэтому карточка с включённым автопроходом стояла в
// TODO, пока человек не перетащит её руками. Здесь зафиксировано, что она
// уезжает сама и что сломанное окружение не превращается в бесконечный цикл.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildServer } from './server.js'
import { loadConfig } from './config.js'
import { VoiceChatDb } from './db/database.js'
import { signToken } from './users/accounts.js'
import { AgentRegistry } from './agents/registry.js'
import { MergeRunManager } from './merge/runManager.js'
import type { Board, LlmClient, LlmHandle, LlmRequest, ProjectDetail, Task, TaskPreparationRun } from '@voicechat/shared'

const SECRET = 'test-secret'

let db: VoiceChatDb
let app: FastifyInstance
let adminTok: string
/** Что ответит модель подготовки: ошибка, текст или «висит» (ран остаётся running). */
let answer: () => { text: string } | { error: string } | { hang: true }

/** CLI не запускается: координатору достаточно факта запущенной попытки. */
function fakeCli(): LlmClient {
  return {
    send(_req: LlmRequest, handlers): LlmHandle {
      const reply = answer()
      if ('hang' in reply) return { cancel: () => {} }
      const timer = setTimeout(async () => {
        if ('error' in reply) await handlers.onError(reply.error)
        else { await handlers.onDelta(reply.text); await handlers.onDone(reply.text) }
      }, 0)
      return { cancel: () => clearTimeout(timer) }
    }
  }
}

function inj(opts: { method: 'GET' | 'POST' | 'PATCH'; url: string; payload?: object }) {
  return app.inject({ ...opts, headers: { authorization: `Bearer ${adminTok}` } })
}

beforeEach(async () => {
  let id = 0
  let clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  answer = () => ({ error: 'CLI недоступен' })
  app = await buildServer({
    config: loadConfig({ PORT: '0', VC_DATA_DIR: join(tmpdir(), `vc-autopilot-${Date.now()}-${id}`) }),
    db,
    sessionSecret: SECRET,
    claude: fakeCli(),
    codex: fakeCli(),
    ciExecutor: { run: async () => ({ exitCode: 0, timedOut: false }) }
  })
  adminTok = signToken({ name: 'admin', role: 'admin' }, SECRET)
})

afterEach(async () => {
  await app.close()
  await db.close()
  vi.restoreAllMocks()
})

/** Проект с системным workflow и задача в TODO. */
async function taskInBacklog(): Promise<{ projectId: string; taskId: string; columns: Board['columns'] }> {
  const project = (await inj({ method: 'POST', url: '/api/projects', payload: { name: 'P' } })).json() as ProjectDetail
  const board = (await inj({ method: 'GET', url: `/api/projects/${project.id}/board` })).json() as Board
  const backlog = board.columns.find((column) => column.semanticType === 'backlog')!
  const task = (await inj({
    method: 'POST', url: `/api/projects/${project.id}/tasks`, payload: { columnId: backlog.id, title: 'Задача' }
  })).json() as Task
  return { projectId: project.id, taskId: task.id, columns: board.columns }
}

const enableAutoPilot = (projectId: string, taskId: string) =>
  inj({ method: 'PATCH', url: `/api/projects/${projectId}/tasks/${taskId}`, payload: { autoPilot: true } })

describe('автопроход: ручное QA и независимость карточек', () => {
  // @testCase TC-INT-01
  it('keeps one queued merge and task placement when reassignment overlaps an autopilot tick', async () => {
    const { projectId, columns } = await taskInBacklog()
    const task = (await db.tasks.createTask('admin', projectId, { title: 'Merge race', columnId: columns.find(column => column.semanticType === 'merge')!.id }))!
    const machines = []
    for (const name of ['A', 'B']) {
      const machine = await db.machines.createAgent('admin', name)
      await db.machines.linkMachine('admin', projectId, machine.id)
      await db.machines.setProjectMachineReposRoot('admin', projectId, machine.id, '/repos')
      machines.push(machine)
    }
    await db.ready
    const raw = (db as unknown as { db: { prepare(sql: string): { run(...values: unknown[]): unknown } } }).db
    raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,1,'released',3)`)
      .run('ws-merge-race', projectId, task.id, machines[0].id, '/repos/project/task', 'CHAT-475', 'a'.repeat(40))
    const run = await db.ci.startMergeRun('admin', projectId, task.id)
    vi.spyOn(AgentRegistry.prototype, 'isOnline').mockReturnValue(true)
    vi.spyOn(MergeRunManager.prototype, 'start').mockImplementation(() => {})
    let entered!: () => void, resume!: () => void
    const waiting = new Promise<void>(resolve => { entered = resolve })
    const barrier = new Promise<void>(resolve => { resume = resolve })
    vi.spyOn(MergeRunManager.prototype, 'checkReadiness').mockImplementation(async () => {
      entered(); await barrier
      return { ready: true, selectable: true, mode: 'legacy', code: 'ready', message: 'Ready' }
    })
    const changing = inj({ method: 'POST', url: `/api/merge/runs/${run.id}/machine`, payload: { agentId: machines[1].id, expectedAssignmentVersion: 0 } })
    const pending = changing.then(response => response)
    await waiting
    const snapshots = vi.spyOn(db.tasks, 'autoPilotSnapshot')
    await enableAutoPilot(projectId, task.id)
    await eventually(async () => snapshots.mock.calls.length, count => count > 0)
    const before = (await db.tasks.getTaskDetail('admin', projectId, task.id))!
    resume()
    expect((await pending).statusCode).toBe(200)
    const after = (await db.tasks.getTaskDetail('admin', projectId, task.id))!
    expect(after).toMatchObject({ columnId: before.columnId, position: before.position, autoPilot: true, autoPilotRequiresManualQa: false })
    expect(await db.ci.listMergeRuns('admin', projectId, task.id)).toMatchObject([{ id: run.id, agentId: machines[1].id, status: 'queued' }])
  })

  it('пропуски двух QA-этапов сразу приводят к Automated QA и очереди merge', async () => {
    const { projectId, taskId, columns } = await taskInBacklog()
    const machine = await db.machines.createAgent('admin', 'QA')
    await db.machines.linkMachine('admin', projectId, machine.id)
    vi.spyOn(AgentRegistry.prototype, 'isOnline').mockReturnValue(true)
    for (const semantic of ['preparation', 'ready', 'development', 'component_qa']) {
      await db.tasks.moveTask('admin', projectId, taskId, { columnId: columns.find((column) => column.semanticType === semantic)!.id })
    }
    await db.ready
    const raw = (db as unknown as { db: { prepare(sql: string): { run(...values: unknown[]): unknown } } }).db
    const readiness = { functionalRequirements: 'Серверная задача', acceptanceCriteria: 'Проверки проходят', acceptanceCriteriaConflict: false, uiImpact: 'none', testCases: [], affectedComponents: [] }
    raw.prepare(`INSERT INTO task_preparation_runs (id,project_id,task_id,status,readiness_json,created_at,finished_at) VALUES (?,?,?,'success',?,1,2)`).run('prep-qa', projectId, taskId, JSON.stringify(readiness))
    raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,1,'released',3)`).run('ws-qa', projectId, taskId, machine.id, '/qa', 'feature/qa', 'a'.repeat(40))
    raw.prepare(`INSERT INTO ci_runs (id,project_id,task_id,status,workspace_id,triggered_by,mode,created_at) VALUES (?,?,?,'success',?,'admin','development',4)`).run('dev-qa', projectId, taskId, 'ws-qa')
    const mergeStart = vi.spyOn(db.ci, 'startMergeRun').mockRejectedValue(new Error('Проверяем только постановку на merge'))
    await enableAutoPilot(projectId, taskId)
    await eventually(() => semanticOf(projectId, taskId), (stage) => stage === 'awaiting_merge')
    await eventually(async () => mergeStart.mock.calls.length, (count) => count >= 1)
    expect((await db.tasks.getComponentQaTaskState('admin', projectId, taskId))!.latestRun?.status).toBe('skipped')
    expect((await db.ci.getIntegrationTestTaskState('admin', projectId, taskId))!.latestRun?.status).toBe('skipped')
    expect((await db.qa.listQaStageRuns('admin', projectId, taskId, 'automated_qa'))[0].status).toBe('success')
  })

  it('сбой инфраструктуры QA не создаёт немедленный бесконечный повтор', async () => {
    const { projectId, taskId, columns } = await taskInBacklog()
    const machine = await db.machines.createAgent('admin', 'QA')
    await db.machines.linkMachine('admin', projectId, machine.id)
    vi.spyOn(AgentRegistry.prototype, 'isOnline').mockReturnValue(true)
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    for (const semantic of ['preparation', 'ready', 'development', 'component_qa', 'integration_tests', 'automated_qa']) {
      await db.tasks.moveTask('admin', projectId, taskId, { columnId: columns.find((column) => column.semanticType === semantic)!.id })
    }
    await enableAutoPilot(projectId, taskId)
    await eventually(() => db.qa.listQaStageRuns('admin', projectId, taskId, 'automated_qa'), (runs) => runs[0]?.status === 'failed')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await db.qa.listQaStageRuns('admin', projectId, taskId, 'automated_qa')).toHaveLength(1)
    expect((await db.tasks.getTaskDetail('admin', projectId, taskId))!.autoPilotFixCycles).toBe(0)
  })

  // Infrastructure failures never reach the fix-cycle counter, so the streak of
  // failed stage runs is the only thing that stops the autopilot. In production
  // three tasks each queued five 30-minute Automated QA runs in a row on
  // «Лимит времени Automated QA исчерпан» and nobody was ever told.
  it('останавливает этап после лимита подряд упавших ранов, а не запускает новый', async () => {
    const { projectId, taskId, columns } = await taskInBacklog()
    const machine = await db.machines.createAgent('admin', 'QA')
    await db.machines.linkMachine('admin', projectId, machine.id)
    vi.spyOn(AgentRegistry.prototype, 'isOnline').mockReturnValue(true)
    for (const semantic of ['preparation', 'ready', 'development', 'component_qa', 'integration_tests', 'automated_qa']) {
      await db.tasks.moveTask('admin', projectId, taskId, { columnId: columns.find((column) => column.semanticType === semantic)!.id })
    }
    await db.ready
    const raw = (db as unknown as { db: { prepare(sql: string): { run(...values: unknown[]): unknown } } }).db
    for (const attempt of [1, 2, 3]) {
      raw.prepare(`INSERT INTO qa_stage_runs (id,project_id,task_id,stage,status,attempt,triggered_by,current_step,error,created_at,started_at,finished_at) VALUES (?,?,?,'automated_qa','failed',?,'admin','blocked','Лимит времени Automated QA исчерпан',?,?,?)`)
        .run(`qa-${attempt}`, projectId, taskId, attempt, attempt, attempt, attempt + 1)
    }
    await enableAutoPilot(projectId, taskId)
    await eventually(() => semanticOf(projectId, taskId), (stage) => stage === 'decision_required')
    expect(await db.qa.listQaStageRuns('admin', projectId, taskId, 'automated_qa')).toHaveLength(3)
  })

  async function manualQaTask() {
    const fixture = await taskInBacklog()
    for (const semantic of ['preparation', 'ready', 'development', 'component_qa', 'integration_tests', 'automated_qa', 'manual_qa']) {
      await db.tasks.moveTask('admin', fixture.projectId, fixture.taskId, { columnId: fixture.columns.find((column) => column.semanticType === semantic)!.id })
    }
    return fixture
  }

  it('с выключенной остановкой ставит задачу в ожидание merge и сразу будит следующий тик', async () => {
    const { projectId, taskId } = await manualQaTask()
    const snapshots = vi.spyOn(db.tasks, 'autoPilotSnapshot')
    await enableAutoPilot(projectId, taskId)
    await eventually(() => semanticOf(projectId, taskId), (stage) => stage === 'awaiting_merge')
    await eventually(async () => snapshots.mock.calls.length, (count) => count >= 2)
  })

  it('ждёт ручное QA, а снятие флага немедленно продолжает автопроход', async () => {
    const { projectId, taskId } = await manualQaTask()
    const url = `/api/projects/${projectId}/tasks/${taskId}`
    expect((await inj({ method: 'PATCH', url, payload: { autoPilot: true, autoPilotRequiresManualQa: true } })).statusCode).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await semanticOf(projectId, taskId)).toBe('manual_qa')
    await inj({ method: 'PATCH', url, payload: { autoPilotRequiresManualQa: false } })
    await eventually(() => semanticOf(projectId, taskId), (stage) => stage === 'awaiting_merge')
  })

  it('не принимает строку вместо переключателя', async () => {
    const { projectId, taskId } = await taskInBacklog()
    const response = await inj({ method: 'PATCH', url: `/api/projects/${projectId}/tasks/${taskId}`, payload: { autoPilotRequiresManualQa: 'false' } })
    expect(response.statusCode).toBe(400)
  })

  it('ошибка первой карточки не мешает второй пройти ручное QA', async () => {
    const { projectId, taskId, columns } = await manualQaTask()
    const second = (await db.tasks.createTask('admin', projectId, { title: 'Вторая', columnId: columns.find((column) => column.semanticType === 'manual_qa')!.id }))!
    await db.tasks.updateTask('admin', projectId, second.id, { autoPilot: true })
    const snapshot = db.tasks.autoPilotSnapshot.bind(db.tasks)
    vi.spyOn(db.tasks, 'autoPilotSnapshot').mockImplementation(async (id) => (await snapshot(id)).sort((a, b) => Number(b.task.id === taskId) - Number(a.task.id === taskId)))
    const transition = db.tasks.transitionAutoPilotTask.bind(db.tasks)
    vi.spyOn(db.tasks, 'transitionAutoPilotTask').mockImplementation((id, tid, to, action) => {
      if (tid === taskId) return Promise.reject(new Error('Ошибка первой карточки'))
      return transition(id, tid, to, action)
    })
    await enableAutoPilot(projectId, taskId)
    await eventually(() => semanticOf(projectId, second.id), (stage) => stage === 'awaiting_merge')
    expect(await semanticOf(projectId, taskId)).toBe('manual_qa')
  })
})

async function runs(projectId: string, taskId: string): Promise<TaskPreparationRun[]> {
  const res = await inj({ method: 'GET', url: `/api/projects/${projectId}/tasks/${taskId}/preparation/runs` })
  return res.json() as TaskPreparationRun[]
}

/** Координатор работает на микротасках board-события, поэтому ждём условие. */
async function eventually<T>(read: () => Promise<T>, ok: (value: T) => boolean, limit = 200): Promise<T> {
  for (let i = 0; i < limit; i++) {
    const value = await read()
    if (ok(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('условие не выполнилось')
}

async function semanticOf(projectId: string, taskId: string): Promise<string> {
  const board = (await inj({ method: 'GET', url: `/api/projects/${projectId}/board` })).json() as Board
  const task = board.tasks.find((item) => item.id === taskId)!
  return board.columns.find((column) => column.id === task.columnId)!.semanticType
}

describe('автопроход у новых задач', () => {
  it('наследуется от настройки проекта и только задачами', async () => {
    const project = (await inj({ method: 'POST', url: '/api/projects', payload: { name: 'P' } })).json() as ProjectDetail
    await inj({ method: 'PATCH', url: `/api/projects/${project.id}`, payload: { autoPilotDefault: true } })
    const board = (await inj({ method: 'GET', url: `/api/projects/${project.id}/board` })).json() as Board
    const backlog = board.columns.find((column) => column.semanticType === 'backlog')!

    const task = (await inj({ method: 'POST', url: `/api/projects/${project.id}/tasks`, payload: { columnId: backlog.id, title: 'Задача' } })).json() as Task
    // Эпик и история этапы конвейера не проходят, флаг им не нужен.
    const epic = (await inj({ method: 'POST', url: `/api/projects/${project.id}/tasks`, payload: { columnId: backlog.id, title: 'Эпик', type: 'epic' } })).json() as Task
    expect(task.autoPilot).toBe(true)
    expect(epic.autoPilot).toBe(false)
  })

  it('выключенная настройка оставляет новые задачи без автопрохода', async () => {
    const { projectId, taskId } = await taskInBacklog()
    const task = (await inj({ method: 'GET', url: `/api/projects/${projectId}/tasks/${taskId}` })).json() as Task
    expect(task.autoPilot).toBe(false)
  })
})

describe('автопроход: начало конвейера', () => {
  it('нулевой лимит повторов разрешает первую попытку подготовки', async () => {
    const { projectId, taskId } = await taskInBacklog()
    await inj({ method: 'PATCH', url: `/api/projects/${projectId}`, payload: { autoPilotFixLimit: 0 } })
    await enableAutoPilot(projectId, taskId)
    await eventually(() => runs(projectId, taskId), (list) => list.length === 1 && list[0].status === 'failed')
    await eventually(() => semanticOf(projectId, taskId), (stage) => stage === 'decision_required')
    expect(await runs(projectId, taskId)).toHaveLength(1)
  })
  it('включённый автопроход сам уводит задачу из TODO в подготовку и запускает попытку', async () => {
    const { projectId, taskId } = await taskInBacklog()
    // Попытка не завершается: проверяется сам факт автозапуска, а не её исход.
    answer = () => ({ hang: true })
    expect(await runs(projectId, taskId)).toHaveLength(0)

    await enableAutoPilot(projectId, taskId)

    const list = await eventually(() => runs(projectId, taskId), (value) => value.length > 0)
    expect(list.some((run) => run.attempt === 1)).toBe(true)
    expect(await semanticOf(projectId, taskId)).toBe('preparation')
  })

  it('без автопрохода карточка остаётся в TODO и подготовка не стартует', async () => {
    const { projectId, taskId } = await taskInBacklog()
    await inj({ method: 'PATCH', url: `/api/projects/${projectId}/tasks/${taskId}`, payload: { title: 'Другое имя' } })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await runs(projectId, taskId)).toHaveLength(0)
    expect(await semanticOf(projectId, taskId)).toBe('backlog')
  })

  it('у Git-проекта с offline-машиной подготовка не стартует и попытки не жжёт', async () => {
    const { projectId, taskId } = await taskInBacklog()
    // Git-проекту нужна копия на машине: без online-машины запускать нечего, и
    // прежний перезапуск «на автомате» только сжигал круги за чужой сбой.
    const agent = await db.machines.createAgent('admin', 'Спящий ноутбук')
    await db.machines.linkMachine('admin', projectId, agent.id)
    await db.machines.setProjectMachinePath('admin', projectId, agent.id, '/srv/app')
    await db.projects.updateProject('admin', projectId, { gitUrl: 'git@github.com:x/y.git' })

    await enableAutoPilot(projectId, taskId)
    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(await runs(projectId, taskId)).toHaveLength(0)
    expect(await semanticOf(projectId, taskId)).toBe('backlog')
  })

  it('упавшая попытка повторяется автоматически, а после лимита автопроход останавливается', async () => {
    const { projectId, taskId } = await taskInBacklog()
    // Лимит доработок общий для автопрохода: он же ограничивает повторы подготовки.
    await inj({ method: 'PATCH', url: `/api/projects/${projectId}`, payload: { autoPilotFixLimit: 2 } })
    await enableAutoPilot(projectId, taskId)

    const list = await eventually(
      () => runs(projectId, taskId),
      (value) => value.length >= 2 && value.every((run) => run.status === 'failed' || run.status === 'blocked')
    )
    expect(list.length).toBe(2)
    // Третьей попытки нет: лимит исчерпан, и карточка ждёт человека.
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect((await runs(projectId, taskId)).length).toBe(2)
    expect(await semanticOf(projectId, taskId)).toBe('decision_required')
  })
})

describe('автопроход: общий development-предохранитель', () => {
  async function failedDevelopmentInReady(error: string, status: 'failed' | 'timeout' = 'failed') {
    const { projectId, taskId, columns } = await taskInBacklog()
    const machine = await db.machines.createAgent('admin', 'Online dev')
    await db.machines.linkMachine('admin', projectId, machine.id)
    await db.machines.setProjectMachineReposRoot('admin', projectId, machine.id, '/repos')
    await db.machines.setProjectMachinePath('admin', projectId, machine.id, '/repo')
    vi.spyOn(AgentRegistry.prototype, 'isOnline').mockReturnValue(true)
    for (const semantic of ['preparation', 'ready']) {
      await db.tasks.moveTask('admin', projectId, taskId, { columnId: columns.find(column => column.semanticType === semantic)!.id })
    }
    await db.ready
    const raw = (db as unknown as { db: { prepare(sql: string): { run(...values: unknown[]): unknown; get(...values: unknown[]): unknown; all(...values: unknown[]): unknown[] } } }).db
    raw.prepare(`INSERT INTO ci_runs (id,project_id,task_id,status,triggered_by,mode,error,terminal_column_id,created_at,finished_at) VALUES (?,?,?,?,'admin','development',?,?,1,2)`)
      .run('dirty-run', projectId, taskId, status, error, columns.find(column => column.semanticType === 'ready')!.id)
    // Dirty workspace must win even when the same run is also classified as an
    // infrastructure failure eligible for retryFromFailed.
    await db.ci.addCiEvent({ projectId, runId: 'dirty-run', type: 'run.infra_error', actorType: 'system', payload: { kind: 'agent_offline' } })
    return { projectId, taskId, raw }
  }

  // @testCase TC-1
  // @testCase TC-2
  // @testCase TC-5
  it.each(['failed', 'timeout'] as const)('blocks the full dirty-workspace rollback cycle in ready (%s)', async (status) => {
    const fixture = await failedDevelopmentInReady('Рабочая копия содержит локальные изменения: /repo/CHAT-477', status)
    await enableAutoPilot(fixture.projectId, fixture.taskId)
    await eventually(async () => fixture.raw.prepare(`SELECT * FROM qa_audit WHERE task_id=? AND action='autopilot.stopped'`).all(fixture.taskId).length, count => count === 1)
    await new Promise(resolve => setTimeout(resolve, 30))
    const persistedRuns = fixture.raw.prepare('SELECT status FROM ci_runs WHERE task_id=?').all(fixture.taskId) as Array<{ status: string }>
    expect(persistedRuns).toEqual([{ status }])
    expect(await semanticOf(fixture.projectId, fixture.taskId)).toBe('ready')
    const audit = fixture.raw.prepare(`SELECT payload_json FROM qa_audit WHERE task_id=? AND action='autopilot.stopped'`).get(fixture.taskId) as { payload_json: string }
    expect(JSON.parse(audit.payload_json)).toMatchObject({ runId: 'dirty-run', blockedBy: 'dirty_workspace' })
  })

  // @testCase TC-3
  // @testCase TC-5-DEDUP
  it('deduplicates concurrent and pending board updates for the persisted dirty blocker', async () => {
    const fixture = await failedDevelopmentInReady('Рабочая копия содержит локальные изменения')
    await Promise.all(Array.from({ length: 8 }, (_, index) =>
      inj({ method: 'PATCH', url: `/api/projects/${fixture.projectId}/tasks/${fixture.taskId}`, payload: { autoPilot: true, title: `Dirty ${index}` } })
    ))
    await eventually(async () => fixture.raw.prepare(`SELECT * FROM qa_audit WHERE task_id=? AND action='autopilot.stopped'`).all(fixture.taskId).length, count => count === 1)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(fixture.raw.prepare(`SELECT * FROM qa_audit WHERE task_id=? AND action='autopilot.stopped'`).all(fixture.taskId)).toHaveLength(1)
    expect(fixture.raw.prepare('SELECT * FROM ci_runs WHERE task_id=?').all(fixture.taskId)).toHaveLength(1)
  })
})
