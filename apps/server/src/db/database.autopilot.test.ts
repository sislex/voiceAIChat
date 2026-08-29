// Автопроход: провал этапа заводит баг, возвращает задачу в разработку и считает
// круги доработки; при исчерпании лимита задача уходит в «Требуется решение».
// Логика пришла с PRJ-374 и до этих тестов не была покрыта ничем.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VoiceChatDb } from './database.js'

let db: VoiceChatDb
beforeEach(() => {
  let id = 0
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => 1000 })
  db.createUser('alice', '', 'developer')
})
afterEach(() => db.close())

/**
 * Задача доводится до QA-этапа по карте переходов: из `backlog` в `development`
 * напрямую нельзя, и обработчик провала на этом падал бы. В жизни этап валится,
 * когда задача уже в одной из QA-колонок.
 */
function setup(autoPilot = true, stage: 'component_qa' | 'automated_qa' = 'automated_qa'): { projectId: string; taskId: string } {
  const project = db.createProject('alice', { name: 'P' })
  const board = db.getBoard('alice', project.id)!
  const column = (semantic: string): string => board.columns.find((c) => c.semanticType === semantic)!.id
  const task = db.createTask('alice', project.id, { columnId: column('backlog'), title: 'Фича' })!
  for (const step of ['preparation', 'ready', 'development', 'component_qa', 'integration_tests', 'automated_qa'] as const) {
    db.moveTask('alice', project.id, task.id, { columnId: column(step) })
    if (step === stage) break
  }
  if (autoPilot) db.updateTask('alice', project.id, task.id, { autoPilot: true })
  return { projectId: project.id, taskId: task.id }
}

const columnOf = (projectId: string, taskId: string): string => {
  const board = db.getBoard('alice', projectId)!
  const task = board.tasks.find((t) => t.id === taskId)!
  return board.columns.find((c) => c.id === task.columnId)!.semanticType
}

describe('автопроход: провал этапа', () => {
  it('без признака автопрохода ничего не происходит', () => {
    const { projectId, taskId } = setup(false)
    expect(db.handleAutoPilotFailure('alice', projectId, taskId, 'automated_qa', 'run-1', 'тесты упали')).toBeNull()
  })

  it('заводит баг со ссылкой на исходную задачу и возвращает её в разработку', () => {
    const { projectId, taskId } = setup()
    const result = db.handleAutoPilotFailure('alice', projectId, taskId, 'automated_qa', 'run-1', 'тесты упали')
    expect(result?.decisionRequired).toBe(false)
    expect(result?.bugTaskId).toBeTruthy()

    const board = db.getBoard('alice', projectId)!
    const bug = board.tasks.find((t) => t.id === result!.bugTaskId)!
    expect(bug.title).toContain('automated_qa')
    expect(bug.labels).toContain('bug')
    expect(bug.sourceTaskId).toBe(taskId)
    // Замечание должно быть читаемым: этап, причина и ссылка на ран. На доске
    // описания урезаны, поэтому берём задачу целиком.
    const full = db.getCiTask('alice', projectId, result!.bugTaskId!)!
    expect(full.description).toContain('тесты упали')
    expect(full.description).toContain('run-1')
    expect(columnOf(projectId, taskId)).toBe('development')
  })

  it('считает круги доработки и при исчерпании лимита уводит в «Требуется решение»', () => {
    const { projectId, taskId } = setup()
    db.updateProject('alice', projectId, { autoPilotFixLimit: 2 })
    expect(db.handleAutoPilotFailure('alice', projectId, taskId, 'component_qa', 'r1', 'раз')?.decisionRequired).toBe(false)
    expect(db.handleAutoPilotFailure('alice', projectId, taskId, 'component_qa', 'r2', 'два')?.decisionRequired).toBe(false)
    // Третий провал — лимит исчерпан: автоматика дальше не крутит задачу по кругу.
    const third = db.handleAutoPilotFailure('alice', projectId, taskId, 'component_qa', 'r3', 'три')
    expect(third?.decisionRequired).toBe(true)
    expect(third?.bugTaskId).toBeUndefined()
    expect(columnOf(projectId, taskId)).toBe('decision_required')
  })

  it('каждый провал добавляет ровно один баг, а не дублирует прежние', () => {
    const { projectId, taskId } = setup()
    db.handleAutoPilotFailure('alice', projectId, taskId, 'automated_qa', 'r1', 'раз')
    db.handleAutoPilotFailure('alice', projectId, taskId, 'automated_qa', 'r2', 'два')
    const bugs = db.getBoard('alice', projectId)!.tasks.filter((t) => t.sourceTaskId === taskId)
    expect(bugs).toHaveLength(2)
  })
  it('задачу передвинули вручную во время рана — обработчик не роняет ран', () => {
    const { projectId, taskId } = setup()
    const board = db.getBoard('alice', projectId)!
    // Человек увёл задачу в ручное QA, пока шёл этап: из manual_qa путь в
    // development есть, поэтому автопроход обязан отработать штатно.
    db.moveTask('alice', projectId, taskId, { columnId: board.columns.find((c) => c.semanticType === 'manual_qa')!.id })
    const result = db.handleAutoPilotFailure('alice', projectId, taskId, 'automated_qa', 'r1', 'упало')
    expect(result?.decisionRequired).toBe(false)
    expect(columnOf(projectId, taskId)).toBe('development')
  })

  it('задача уже в «Ожидает мержа» — провал этапа не должен ронять завершение рана', () => {
    const { projectId, taskId } = setup()
    const board = db.getBoard('alice', projectId)!
    for (const step of ['manual_qa', 'awaiting_merge'] as const) {
      db.moveTask('alice', projectId, taskId, { columnId: board.columns.find((c) => c.semanticType === step)!.id })
    }
    // Из awaiting_merge пути в development нет. Раньше обработчик бросал
    // исключение прямо в колбэк завершения рана.
    expect(() => db.handleAutoPilotFailure('alice', projectId, taskId, 'automated_qa', 'r1', 'упало')).not.toThrow()
  })
})
