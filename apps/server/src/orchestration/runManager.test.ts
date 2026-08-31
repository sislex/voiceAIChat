import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Orchestration } from '@voicechat/shared'
import { VoiceChatDb } from '../db/database.js'
import type { KanbanRunLaunchers } from '../mcp/kanbanMcp.js'
import { createOrchestrationManager, type OrchestrationManager } from './runManager.js'

let db: VoiceChatDb
let manager: OrchestrationManager
let published: Orchestration[]
let projectId: string
let columnId: string
let ciRuns: Array<{ id: string; taskId: string; status: string }>
let launchers: KanbanRunLaunchers
let reports: string[]
let previewOps: string[]

beforeEach(() => {
  let id = 0
  let clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  db.createUser('ann', '', 'developer')
  projectId = db.createProject('ann', { name: 'Chat' })!.id
  columnId = db.getBoard('ann', projectId)!.columns[0]!.id
  published = []
  ciRuns = []
  reports = []
  previewOps = []
  launchers = {
    previewOperate: async (_userId, _projectId, _taskId, operation) => { previewOps.push(operation); return {} },
    startCi: (_userId, _projectId, taskId) => {
      const run = { id: `run-${ciRuns.length + 1}`, taskId, status: 'queued' }
      ciRuns.push(run)
      return { run: { id: run.id, status: run.status, agentId: null } }
    },
    cancelCi: () => true,
    startMerge: async () => ({ id: 'merge-1', status: 'queued' }),
    startQa: async () => ({ id: 'qa-1', status: 'queued' })
  }
  manager = createOrchestrationManager({
    db,
    runs: () => launchers,
    publish: (plan) => published.push(plan),
    report: (_plan, text) => reports.push(text),
    // Таймер в тестах не нужен: тик зовём руками, чтобы шаги были детерминированы.
    tickMs: 60_000
  })
  // Раны CI менеджер дочитывает из БД; в тесте подменяем чтение своим списком.
  vi.spyOn(db, 'listCiRunsForTask').mockImplementation((_userId, _projectId, taskId) =>
    ciRuns.filter((run) => run.taskId === taskId) as never)
})
afterEach(() => {
  manager.dispose()
  vi.restoreAllMocks()
  db.close()
})

function plan(items: Parameters<VoiceChatDb['createOrchestration']>[4]): Orchestration {
  return db.createOrchestration('ann', projectId, null, 'План', items)!
}

describe('createOrchestrationManager', () => {
  it('создаёт задачу и запускает разработку по зависимости', async () => {
    const created = plan([
      { kind: 'create_task', title: 'Корзина', payload: { columnId, title: 'Корзина' } },
      { kind: 'run_ci', title: 'Разработка', dependsOn: [0] }
    ])
    await manager.tick(created.id)
    const afterFirst = db.getOrchestrationById(created.id)!
    expect(afterFirst.items[0]!.status).toBe('done')
    expect(afterFirst.items[0]!.taskId).toBeTruthy()
    // Разработка стартовала в том же проходе: её зависимость уже выполнена.
    expect(afterFirst.items[1]!.status).toBe('running')
    expect(ciRuns).toHaveLength(1)

    ciRuns[0]!.status = 'success'
    await manager.tick(created.id)
    const done = db.getOrchestrationById(created.id)!
    expect(done.items[1]!.status).toBe('done')
    expect(done.status).toBe('done')
  })

  it('упавший ран останавливает план и сохраняет причину', async () => {
    const taskId = db.createTask('ann', projectId, { columnId, title: 'A' })!.id
    const created = plan([
      { kind: 'run_ci', title: 'Разработка', taskId },
      { kind: 'run_qa', title: 'Проверка', taskId, dependsOn: [0], payload: { stage: 'automated_qa' } }
    ])
    await manager.tick(created.id)
    ciRuns[0]!.status = 'failed'
    await manager.tick(created.id)
    const failed = db.getOrchestrationById(created.id)!
    expect(failed.status).toBe('failed')
    expect(failed.items[0]!.status).toBe('failed')
    // Зависимый шаг не стартует после падения — иначе QA гоняли бы по сломанной ветке.
    expect(failed.items[1]!.status).toBe('pending')
  })

  it('wait_merge держит следующую задачу, пока ветка не влита', async () => {
    const first = db.createTask('ann', projectId, { columnId, title: 'Первая' })!.id
    const second = db.createTask('ann', projectId, { columnId, title: 'Вторая' })!.id
    const merges: Array<{ id: string; status: string }> = []
    vi.spyOn(db, 'listMergeRuns').mockImplementation(() => merges as never)
    const created = plan([
      { kind: 'wait_merge', title: 'Дождаться merge первой', taskId: first },
      { kind: 'run_ci', title: 'Разработка второй', taskId: second, dependsOn: [0] }
    ])
    await manager.tick(created.id)
    expect(db.getOrchestrationById(created.id)!.items[0]!.status).toBe('pending')
    expect(ciRuns).toHaveLength(0)

    merges.push({ id: 'merge-1', status: 'success' })
    await manager.tick(created.id)
    const afterMerge = db.getOrchestrationById(created.id)!
    expect(afterMerge.items[0]!.status).toBe('done')
    expect(afterMerge.items[1]!.status).toBe('running')
  })

  it('отмена останавливает незавершённые шаги и публикует состояние', async () => {
    const taskId = db.createTask('ann', projectId, { columnId, title: 'A' })!.id
    const created = plan([
      { kind: 'run_ci', title: 'Разработка', taskId },
      { kind: 'run_qa', title: 'Проверка', taskId, dependsOn: [0] }
    ])
    await manager.tick(created.id)
    const cancelled = manager.cancel('ann', created.id)!
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.items.map((item) => item.status)).toEqual(['cancelled', 'cancelled'])
    expect(published.at(-1)!.status).toBe('cancelled')
    // Отменённый план больше не двигается даже при новом тике.
    await manager.tick(created.id)
    expect(db.getOrchestrationById(created.id)!.status).toBe('cancelled')
  })

  it('restore подхватывает незавершённые планы после рестарта', async () => {
    const taskId = db.createTask('ann', projectId, { columnId, title: 'A' })!.id
    const created = plan([{ kind: 'run_ci', title: 'Разработка', taskId }])
    // Новый менеджер = процесс после рестарта: план он видит только через БД.
    const revived = createOrchestrationManager({ db, runs: () => launchers, tickMs: 60_000 })
    revived.restore()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(db.getOrchestrationById(created.id)!.items[0]!.status).toBe('running')
    revived.dispose()
  })

  it('шаг с retries перезапускается, а исчерпав попытки — валит план', async () => {
    const taskId = db.createTask('ann', projectId, { columnId, title: 'A' })!.id
    const created = plan([{ kind: 'run_ci', title: 'Разработка', taskId, payload: { retries: 1 } }])
    await manager.tick(created.id)
    ciRuns[0]!.status = 'failed'
    await manager.tick(created.id)

    // Первая неудача — не приговор: шаг ушёл на второй заход.
    const retried = db.getOrchestrationById(created.id)!
    expect(retried.status).toBe('running')
    expect(retried.items[0]!.status).toBe('running')
    expect(retried.items[0]!.attempts).toBe(1)
    expect(ciRuns).toHaveLength(2)

    ciRuns[1]!.status = 'failed'
    await manager.tick(created.id)
    const failed = db.getOrchestrationById(created.id)!
    expect(failed.status).toBe('failed')
    expect(reports.at(-1)).toContain('не прошёл')
  })

  it('успешный план отчитывается в чат', async () => {
    const created = plan([{ kind: 'create_task', title: 'Корзина', payload: { columnId, title: 'Корзина' } }])
    await manager.tick(created.id)
    expect(db.getOrchestrationById(created.id)!.status).toBe('done')
    expect(reports.at(-1)).toContain('выполнен')
  })

  it('шаг run_preview поднимает тестовое окружение и сразу завершается', async () => {
    const taskId = db.createTask('ann', projectId, { columnId, title: 'A' })!.id
    const created = plan([{ kind: 'run_preview', title: 'Окружение', taskId, payload: { operation: 'start' } }])
    await manager.tick(created.id)
    expect(previewOps).toEqual(['start'])
    expect(db.getOrchestrationById(created.id)!.status).toBe('done')
  })

  it('notify продвигает все ведомые планы', async () => {
    const taskId = db.createTask('ann', projectId, { columnId, title: 'A' })!.id
    const created = plan([{ kind: 'run_ci', title: 'Разработка', taskId }])
    await manager.track(created.id)
    ciRuns[0]!.status = 'success'
    manager.notify()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(db.getOrchestrationById(created.id)!.status).toBe('done')
  })
})
