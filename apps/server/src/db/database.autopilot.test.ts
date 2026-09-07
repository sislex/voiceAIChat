// Автопроход: провал этапа заводит баг, возвращает задачу в разработку и считает
// круги доработки; при исчерпании лимита задача уходит в «Требуется решение».
// Логика пришла с PRJ-374 и до этих тестов не была покрыта ничем.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VoiceChatDb } from './database.js'

let db: VoiceChatDb
beforeEach(() => {
  let id = 0
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => 1000 })
  db.identity.createUser('alice', '', 'developer')
})
afterEach(() => db.close())

/**
 * Задача доводится до QA-этапа по карте переходов: из `backlog` в `development`
 * напрямую нельзя, и обработчик провала на этом падал бы. В жизни этап валится,
 * когда задача уже в одной из QA-колонок.
 */
function setup(autoPilot = true, stage: 'component_qa' | 'automated_qa' = 'automated_qa'): { projectId: string; taskId: string } {
  const project = db.projects.createProject('alice', { name: 'P' })
  const board = db.tasks.getBoard('alice', project.id)!
  const column = (semantic: string): string => board.columns.find((c) => c.semanticType === semantic)!.id
  const task = db.tasks.createTask('alice', project.id, { columnId: column('backlog'), title: 'Фича' })!
  for (const step of ['preparation', 'ready', 'development', 'component_qa', 'integration_tests', 'automated_qa'] as const) {
    db.tasks.moveTask('alice', project.id, task.id, { columnId: column(step) })
    if (step === stage) break
  }
  if (autoPilot) db.tasks.updateTask('alice', project.id, task.id, { autoPilot: true })
  return { projectId: project.id, taskId: task.id }
}

const columnOf = (projectId: string, taskId: string): string => {
  const board = db.tasks.getBoard('alice', projectId)!
  const task = board.tasks.find((t) => t.id === taskId)!
  return board.columns.find((c) => c.id === task.columnId)!.semanticType
}

describe('автопроход: провал этапа', () => {
  it('без признака автопрохода ничего не происходит', () => {
    const { projectId, taskId } = setup(false)
    expect(db.tasks.handleAutoPilotFailure('alice', projectId, taskId, 'automated_qa', 'run-1', 'тесты упали')).toBeNull()
  })

  it('заводит баг со ссылкой на исходную задачу и возвращает её в разработку', () => {
    const { projectId, taskId } = setup()
    const result = db.tasks.handleAutoPilotFailure('alice', projectId, taskId, 'automated_qa', 'run-1', 'тесты упали')
    expect(result?.decisionRequired).toBe(false)
    expect(result?.bugTaskId).toBeTruthy()

    const board = db.tasks.getBoard('alice', projectId)!
    const bug = board.tasks.find((t) => t.id === result!.bugTaskId)!
    expect(bug.title).toContain('automated_qa')
    expect(bug.labels).toContain('bug')
    expect(bug.sourceTaskId).toBe(taskId)
    // Замечание должно быть читаемым: этап, причина и ссылка на ран. На доске
    // описания урезаны, поэтому берём задачу целиком.
    const full = db.tasks.getCiTask('alice', projectId, result!.bugTaskId!)!
    expect(full.description).toContain('тесты упали')
    expect(full.description).toContain('run-1')
    expect(columnOf(projectId, taskId)).toBe('development')
  })

  it('считает круги доработки и при исчерпании лимита уводит в «Требуется решение»', () => {
    const { projectId, taskId } = setup()
    db.projects.updateProject('alice', projectId, { autoPilotFixLimit: 2 })
    expect(db.tasks.handleAutoPilotFailure('alice', projectId, taskId, 'component_qa', 'r1', 'раз')?.decisionRequired).toBe(false)
    expect(db.tasks.handleAutoPilotFailure('alice', projectId, taskId, 'component_qa', 'r2', 'два')?.decisionRequired).toBe(false)
    // Третий провал — лимит исчерпан: автоматика дальше не крутит задачу по кругу.
    const third = db.tasks.handleAutoPilotFailure('alice', projectId, taskId, 'component_qa', 'r3', 'три')
    expect(third?.decisionRequired).toBe(true)
    expect(third?.bugTaskId).toBeUndefined()
    expect(columnOf(projectId, taskId)).toBe('decision_required')
  })

  it('каждый провал добавляет ровно один баг, а не дублирует прежние', () => {
    const { projectId, taskId } = setup()
    db.tasks.handleAutoPilotFailure('alice', projectId, taskId, 'automated_qa', 'r1', 'раз')
    db.tasks.handleAutoPilotFailure('alice', projectId, taskId, 'automated_qa', 'r2', 'два')
    const bugs = db.tasks.getBoard('alice', projectId)!.tasks.filter((t) => t.sourceTaskId === taskId)
    expect(bugs).toHaveLength(2)
  })
  it('задачу передвинули вручную во время рана — обработчик не роняет ран', () => {
    const { projectId, taskId } = setup()
    const board = db.tasks.getBoard('alice', projectId)!
    // Человек увёл задачу в ручное QA, пока шёл этап: из manual_qa путь в
    // development есть, поэтому автопроход обязан отработать штатно.
    db.tasks.moveTask('alice', projectId, taskId, { columnId: board.columns.find((c) => c.semanticType === 'manual_qa')!.id })
    const result = db.tasks.handleAutoPilotFailure('alice', projectId, taskId, 'automated_qa', 'r1', 'упало')
    expect(result?.decisionRequired).toBe(false)
    expect(columnOf(projectId, taskId)).toBe('development')
  })

  it('задача уже в «Ожидает мержа» — провал этапа не должен ронять завершение рана', () => {
    const { projectId, taskId } = setup()
    const board = db.tasks.getBoard('alice', projectId)!
    for (const step of ['manual_qa', 'awaiting_merge'] as const) {
      db.tasks.moveTask('alice', projectId, taskId, { columnId: board.columns.find((c) => c.semanticType === step)!.id })
    }
    // Из awaiting_merge пути в development нет. Раньше обработчик бросал
    // исключение прямо в колбэк завершения рана.
    expect(() => db.tasks.handleAutoPilotFailure('alice', projectId, taskId, 'automated_qa', 'r1', 'упало')).not.toThrow()
  })
})

describe('замечания этапа в задаче на доработку', () => {
  it('хвост вывода попадает в описание баг-задачи', () => {
    const { projectId, taskId } = setup()
    const remarks = 'Команда: npm test\nКод выхода: 1\nFAIL src/components/TaskCard.dom.test.tsx'
    const handled = db.tasks.handleAutoPilotFailure('alice', projectId, taskId, 'automated_qa', 'run-1', 'Команда автотестов завершилась с кодом 1', remarks)
    const bug = db.tasks.getCiTask('alice', projectId, handled!.bugTaskId!)!
    expect(bug.description).toContain('## Замечания этапа')
    expect(bug.description).toContain('FAIL src/components/TaskCard.dom.test.tsx')
  })

  it('без замечаний блок не добавляется', () => {
    const { projectId, taskId } = setup()
    const handled = db.tasks.handleAutoPilotFailure('alice', projectId, taskId, 'automated_qa', 'run-1', 'упало')
    expect(db.tasks.getCiTask('alice', projectId, handled!.bugTaskId!)!.description).not.toContain('Замечания этапа')
  })
})

describe('этап Automated QA: шаг рана и настройки', () => {
  it('markAutomatedQaRunning переводит шаг из starting в tests', () => {
    // Условие `status='queued'` было мёртвым: startQaStageRun вставляет ран
    // сразу как running, и панель весь прогон показывала «starting».
    const { projectId, taskId } = setup(false)
    const run = db.qa.startQaStageRun('alice', projectId, taskId, 'automated_qa')
    expect(run.currentStep).toBe('starting')
    db.qa.markAutomatedQaRunning(run.id)
    expect(db.qa.getQaStageRun('alice', run.id)!.currentStep).toBe('tests')
  })

  it('режим и сценарий этапа сохраняются и переживают чтение проекта', () => {
    const project = db.projects.createProject('alice', { name: 'P' })
    db.projects.updateProject('alice', project.id, {
      automatedQaMode: 'playwright',
      automatedQaScenarios: [{ startUrl: 'http://localhost:5173', steps: [{ id: 's1', title: 'Кнопка', action: { kind: 'click', selector: '#create' } }] }]
    })
    const detail = db.projects.getProject('alice', project.id)!
    expect(detail.automatedQaMode).toBe('playwright')
    expect(detail.automatedQaScenarios?.[0]?.steps).toHaveLength(1)
  })

  it('шаг с неизвестным действием отбрасывается, а не роняет прогон', () => {
    const project = db.projects.createProject('alice', { name: 'P' })
    db.projects.updateProject('alice', project.id, {
      automatedQaScenarios: [{
        startUrl: 'http://localhost:5173',
        steps: [
          { id: 's1', title: 'Кнопка', action: { kind: 'click', selector: '#create' } },
          { id: 's2', title: 'Мусор', action: { kind: 'teleport' } as never }
        ]
      }]
    })
    expect(db.projects.getProject('alice', project.id)!.automatedQaScenarios?.[0]?.steps.map((step) => step.id)).toEqual(['s1'])
  })
})

describe('снимок сценария в ране', () => {
  function playwrightProject(): { projectId: string; taskId: string } {
    const setupResult = setup(false)
    db.projects.updateProject('alice', setupResult.projectId, {
      automatedQaMode: 'playwright',
      automatedQaScenarios: [{ name: 'Вход', startUrl: 'http://localhost:5173', steps: [{ id: 's1', title: 'Первый', action: { kind: 'click', selector: '#a' } }] }]
    })
    return setupResult
  }

  it('запуск фиксирует сценарий проекта, и правка настройки его не меняет', () => {
    const { projectId, taskId } = playwrightProject()
    const run = db.qa.startQaStageRun('alice', projectId, taskId, 'automated_qa')
    expect(run.scenarios?.[0]?.steps.map((step) => step.title)).toEqual(['Первый'])
    db.projects.updateProject('alice', projectId, { automatedQaScenarios: [{ startUrl: 'http://other', steps: [] }] })
    expect(db.qa.getQaStageRun('alice', run.id)!.scenarios?.[0]?.steps).toHaveLength(1)
  })

  it('повтор воспроизводит снимок, а не текущую настройку', () => {
    const { projectId, taskId } = playwrightProject()
    const first = db.qa.startQaStageRun('alice', projectId, taskId, 'automated_qa')
    db.qa.updateQaStageRun(first.id, { status: 'failed', error: 'упало' })
    db.projects.updateProject('alice', projectId, { automatedQaScenarios: [{ startUrl: 'http://other', steps: [{ id: 's2', title: 'Другой', action: { kind: 'click', selector: '#b' } }] }] })
    const retried = db.qa.retryQaStageRun('alice', first.id)!
    expect(retried.scenarios?.[0]?.steps.map((step) => step.title)).toEqual(['Первый'])
  })

  it('в режиме команды снимок не заводится', () => {
    const { projectId, taskId } = setup(false)
    expect(db.qa.startQaStageRun('alice', projectId, taskId, 'automated_qa').scenarios).toBeNull()
  })
})
