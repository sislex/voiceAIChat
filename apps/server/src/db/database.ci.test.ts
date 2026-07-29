import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VoiceChatDb } from './database.js'

let db: VoiceChatDb

beforeEach(() => {
  let id = 0
  let clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  db.createUser('alice', '', 'user')
  db.createUser('bob', '', 'user')
})
afterEach(() => db.close())

function project() {
  const p = db.createProject('alice', { name: 'P1' })
  const board = db.getBoard('alice', p.id)!
  const col = board.columns[0]
  const task = db.createTask('alice', p.id, { title: 'T1', columnId: col.id })!
  return { p, col, task }
}

describe('ci: справочник команд', () => {
  it('создаёт, читает, версионирует и мягко удаляет', () => {
    const { p } = project()
    const c = db.createCiCommand('alice', { scope: 'project', projectId: p.id, name: 'clone', script: 'git clone' })
    expect(c.name).toBe('clone')
    expect(c.version).toBe(1)
    expect(c.availableToModel).toBe(true)
    // Правка скрипта поднимает версию.
    const u = db.updateCiCommand('alice', c.id, { script: 'git clone --depth 1' })!
    expect(u.version).toBe(2)
    // Правка без изменения скрипта версию не трогает.
    const u2 = db.updateCiCommand('alice', c.id, { description: 'x' })!
    expect(u2.version).toBe(2)
    // Soft-delete прячет из списка.
    expect(db.listCiCommands('alice', p.id).map((x) => x.id)).toContain(c.id)
    expect(db.softDeleteCiCommand('alice', c.id)).toBe(true)
    expect(db.listCiCommands('alice', p.id).map((x) => x.id)).not.toContain(c.id)
    expect(db.getCiCommand('alice', c.id)).toBeNull()
  })

  it('уникальность имени в области; изоляция проектной команды от не-участника', () => {
    const { p } = project()
    db.createCiCommand('alice', { scope: 'project', projectId: p.id, name: 'clone', script: 'x' })
    expect(() => db.createCiCommand('alice', { scope: 'project', projectId: p.id, name: 'clone', script: 'y' })).toThrow()
    // bob не участник — проектную команду не видит.
    expect(db.listCiCommands('bob', p.id)).toEqual([])
  })

  it('глобальные команды видны всем', () => {
    const g = db.createCiCommand('alice', { scope: 'global', name: 'npm ci', script: 'npm ci' })
    expect(db.listCiCommands('bob').map((x) => x.id)).toContain(g.id)
  })
})

describe('ci: слот-конфиг и наследование', () => {
  it('задача наследует дефолты проекта, затем переопределяет', () => {
    const { p, task } = project()
    const a = db.createCiCommand('alice', { scope: 'project', projectId: p.id, name: 'a', script: 'a' })
    const b = db.createCiCommand('alice', { scope: 'project', projectId: p.id, name: 'b', script: 'b' })
    db.setCiSlotCommands('project', p.id, 'before_model', [a.id, b.id])
    // Нет переопределения у задачи → берём дефолты проекта.
    expect(db.resolveTaskSlots(p.id, task.id).beforeModel).toEqual([a.id, b.id])
    expect(db.hasCiSlotConfig('task', task.id)).toBe(false)
    // Переопределяем на задаче (можно с повтором команды).
    db.setCiSlotCommands('task', task.id, 'before_model', [b.id, b.id])
    expect(db.hasCiSlotConfig('task', task.id)).toBe(true)
    expect(db.resolveTaskSlots(p.id, task.id).beforeModel).toEqual([b.id, b.id])
  })
})

describe('ci: глобальные настройки', () => {
  it('возвращает дефолты и обновляется', () => {
    expect(db.getCiSettings().maxFixAttempts).toBe(3)
    const s = db.updateCiSettings({ maxFixAttempts: 5, maxConcurrentRuns: 4 })
    expect(s.maxFixAttempts).toBe(5)
    expect(s.maxConcurrentRuns).toBe(4)
    expect(db.getCiSettings().maxFixAttempts).toBe(5)
  })
})

describe('ci: раны, шаги, лог, метрики', () => {
  it('создаёт ран, шаги, пишет лог с монотонным seq и считает метрики', () => {
    const { p, col, task } = project()
    const cmd = db.createCiCommand('alice', { scope: 'project', projectId: p.id, name: 'test', script: 'npm test' })
    const run = db.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: col.id, slotProgress: { done: 0, total: 2, phase: 'Подготовка' } })
    expect(run.status).toBe('queued')
    const step = db.addCiRunStep({ runId: run.id, slot: 'before_model', position: 0, kind: 'command', commandId: cmd.id, commandSnapshot: 'npm test', title: 'test', status: 'running' })
    db.appendCiLog(run.id, step.id, 'stdout', 'line1\n')
    db.appendCiLog(run.id, step.id, 'stderr', 'warn\n')
    const log = db.getCiRunLog('alice', run.id)
    expect(log.map((l) => l.seq)).toEqual([1, 2])
    expect(log[1].stream).toBe('stderr')
    db.updateCiRunStep(step.id, { status: 'success', exitCode: 0, durationMs: 500, finishedAt: 2000 })
    db.updateCiRun(run.id, { status: 'success', durationMs: 700 })
    const detail = db.getCiRun('alice', run.id)!
    expect(detail.steps[0].status).toBe('success')
    expect(detail.steps[0].exitCode).toBe(0)
    const metrics = db.ciCommandMetrics('alice', p.id)
    expect(metrics.find((m) => m.commandId === cmd.id)?.samples).toBe(1)
    expect(metrics.find((m) => m.commandId === cmd.id)?.successRate).toBe(1)
    // Сводка ранов по задаче.
    const summaries = db.latestCiRunSummaries(p.id)
    expect(summaries.find((s) => s.taskId === task.id)?.status).toBe('success')
    // Изоляция: bob не видит ран.
    expect(db.getCiRun('bob', run.id)).toBeNull()
    expect(db.getCiRunLog('bob', run.id)).toEqual([])
  })

  it('fix-loop: попытки и метрика работы модели', () => {
    const { p, col, task } = project()
    const run = db.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: col.id, slotProgress: { done: 0, total: 0, phase: '' } })
    const mw = db.addCiRunStep({ runId: run.id, slot: null, position: 1, kind: 'model_work', title: 'Работа модели', status: 'running' })
    db.updateCiRunStep(mw.id, { status: 'success', durationMs: 1200, finishedAt: 3000 })
    const step = db.addCiRunStep({ runId: run.id, slot: 'after_model', position: 2, kind: 'command', title: 'build', status: 'failed' })
    db.addCiFixAttempt({ runStepId: step.id, attemptNo: 1, diagnosis: 'нет зависимости', action: 'npm i', result: 'fixed', durationMs: 400, tokensUsed: 100 })
    const detail = db.getCiRun('alice', run.id)!
    expect(detail.fixAttempts).toHaveLength(1)
    expect(detail.fixAttempts[0].result).toBe('fixed')
    expect(db.ciModelWorkMetric('alice', p.id).avgMs).toBe(1200)
  })
})

describe('ci: рабочие директории и предложения', () => {
  it('workspace: активна → освобождена; отчёт помечает осиротевшие', () => {
    const { p, task } = project()
    const ws = db.createCiWorkspace({ projectId: p.id, taskId: task.id, agentId: null, path: '/repos/p/1' })
    expect(db.findActiveCiWorkspace(p.id, task.id)?.id).toBe(ws.id)
    const report = db.listCiWorkspaceReport('alice', p.id)
    expect(report[0].orphaned).toBe(false) // задача в бэклоге, не done
    db.releaseCiWorkspace(ws.id, null)
    expect(db.findActiveCiWorkspace(p.id, task.id)).toBeNull()
  })

  it('предложения модели: группировка по причине, принятие поднимает версию', () => {
    const { p } = project()
    const cmd = db.createCiCommand('alice', { scope: 'project', projectId: p.id, name: 'npm', script: 'npm ci' })
    db.addCiSuggestion({ commandId: cmd.id, runStepId: null, reason: 'кэш', proposedScript: 'npm ci --cache' })
    db.addCiSuggestion({ commandId: cmd.id, runStepId: null, reason: 'кэш', proposedScript: 'npm ci --cache2' })
    const list = db.listCiSuggestions('alice', p.id)
    expect(list).toHaveLength(1)
    expect(list[0].occurrences).toBe(2)
    expect(db.countNewCiSuggestions(cmd.id)).toBe(1)
    db.resolveCiSuggestion('alice', list[0].id, true)
    expect(db.getCiCommand('alice', cmd.id)!.version).toBe(2)
    expect(db.getCiCommand('alice', cmd.id)!.script).toBe('npm ci --cache2')
    expect(db.countNewCiSuggestions(cmd.id)).toBe(0)
  })
})
