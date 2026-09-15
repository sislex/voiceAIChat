// Автопроход: провал этапа заводит баг, возвращает задачу в разработку и считает
// круги доработки; при исчерпании лимита задача уходит в «Требуется решение».
// Логика пришла с PRJ-374 и до этих тестов не была покрыта ничем.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VoiceChatDb } from './database.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

let db: VoiceChatDb
beforeEach(async () => {
  let id = 0
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => 1000 })
  await db.identity.createUser('alice', '', 'developer')
})
afterEach(() => db.close())

/**
 * Задача доводится до QA-этапа по карте переходов: из `backlog` в `development`
 * напрямую нельзя, и обработчик провала на этом падал бы. В жизни этап валится,
 * когда задача уже в одной из QA-колонок.
 */
async function setup(autoPilot = true, stage: 'component_qa' | 'automated_qa' = 'automated_qa'): Promise<{ projectId: string; taskId: string }> {
  const project = await db.projects.createProject('alice', { name: 'P' })
  const board = (await db.tasks.getBoard('alice', project.id))!
  const column = (semantic: string): string => board.columns.find((c) => c.semanticType === semantic)!.id
  const task = (await db.tasks.createTask('alice', project.id, { columnId: column('backlog'), title: 'Фича' }))!
  for (const step of ['preparation', 'ready', 'development', 'component_qa', 'integration_tests', 'automated_qa'] as const) {
    await db.tasks.moveTask('alice', project.id, task.id, { columnId: column(step) })
    if (step === stage) break
  }
  if (autoPilot) await db.tasks.updateTask('alice', project.id, task.id, { autoPilot: true })
  return { projectId: project.id, taskId: task.id }
}

const columnOf = async (projectId: string, taskId: string): Promise<string> => {
  const board = (await db.tasks.getBoard('alice', projectId))!
  const task = board.tasks.find((t) => t.id === taskId)!
  return board.columns.find((c) => c.id === task.columnId)!.semanticType
}

describe('автопроход: провал этапа', () => {
  it('служебный баг не запускает второй конвейер при включённом автопроходе проекта', async () => {
    const { projectId, taskId } = await setup()
    await db.projects.updateProject('alice', projectId, { autoPilotDefault: true })
    const handled = await db.tasks.handleAutoPilotFailure('alice', projectId, taskId, 'automated_qa', 'run-1', 'тесты упали')
    const bug = (await db.tasks.getCiTask('alice', projectId, handled!.bugTaskId!))!
    expect(bug.autoPilot).toBe(false)
    expect((await db.tasks.autoPilotSnapshot(projectId)).map((item) => item.task.id)).toEqual([taskId])
  })
  it('без признака автопрохода ничего не происходит', async () => {
    const { projectId, taskId } = await setup(false)
    expect(await db.tasks.handleAutoPilotFailure('alice', projectId, taskId, 'automated_qa', 'run-1', 'тесты упали')).toBeNull()
  })

  it('заводит баг со ссылкой на исходную задачу и возвращает её в разработку', async () => {
    const { projectId, taskId } = await setup()
    const result = await db.tasks.handleAutoPilotFailure('alice', projectId, taskId, 'automated_qa', 'run-1', 'тесты упали')
    expect(result?.decisionRequired).toBe(false)
    expect(result?.bugTaskId).toBeTruthy()

    const board = (await db.tasks.getBoard('alice', projectId))!
    const bug = board.tasks.find((t) => t.id === result!.bugTaskId)!
    expect(bug.title).toContain('automated_qa')
    expect(bug.labels).toContain('bug')
    expect(bug.sourceTaskId).toBe(taskId)
    // Замечание должно быть читаемым: этап, причина и ссылка на ран. На доске
    // описания урезаны, поэтому берём задачу целиком.
    const full = (await db.tasks.getCiTask('alice', projectId, result!.bugTaskId!))!
    expect(full.description).toContain('тесты упали')
    expect(full.description).toContain('run-1')
    expect(await columnOf(projectId, taskId)).toBe('development')
  })

  it('считает круги доработки и при исчерпании лимита уводит в «Требуется решение»', async () => {
    const { projectId, taskId } = await setup()
    await db.projects.updateProject('alice', projectId, { autoPilotFixLimit: 2 })
    expect((await db.tasks.handleAutoPilotFailure('alice', projectId, taskId, 'component_qa', 'r1', 'раз'))?.decisionRequired).toBe(false)
    expect((await db.tasks.handleAutoPilotFailure('alice', projectId, taskId, 'component_qa', 'r2', 'два'))?.decisionRequired).toBe(false)
    // Третий провал — лимит исчерпан: автоматика дальше не крутит задачу по кругу.
    const third = await db.tasks.handleAutoPilotFailure('alice', projectId, taskId, 'component_qa', 'r3', 'три')
    expect(third?.decisionRequired).toBe(true)
    expect(third?.bugTaskId).toBeUndefined()
    expect(await columnOf(projectId, taskId)).toBe('decision_required')
  })

  it('каждый провал добавляет ровно один баг, а не дублирует прежние', async () => {
    const { projectId, taskId } = await setup()
    await db.tasks.handleAutoPilotFailure('alice', projectId, taskId, 'automated_qa', 'r1', 'раз')
    await db.tasks.handleAutoPilotFailure('alice', projectId, taskId, 'automated_qa', 'r2', 'два')
    const bugs = (await db.tasks.getBoard('alice', projectId))!.tasks.filter((t) => t.sourceTaskId === taskId)
    expect(bugs).toHaveLength(2)
  })
  it('задачу передвинули вручную во время рана — обработчик не роняет ран', async () => {
    const { projectId, taskId } = await setup()
    const board = (await db.tasks.getBoard('alice', projectId))!
    // Человек увёл задачу в ручное QA, пока шёл этап: из manual_qa путь в
    // development есть, поэтому автопроход обязан отработать штатно.
    await db.tasks.moveTask('alice', projectId, taskId, { columnId: board.columns.find((c) => c.semanticType === 'manual_qa')!.id })
    const result = await db.tasks.handleAutoPilotFailure('alice', projectId, taskId, 'automated_qa', 'r1', 'упало')
    expect(result?.decisionRequired).toBe(false)
    expect(await columnOf(projectId, taskId)).toBe('development')
  })

  it('задача уже в «Ожидает мержа» — провал этапа не должен ронять завершение рана', async () => {
    const { projectId, taskId } = await setup()
    const board = (await db.tasks.getBoard('alice', projectId))!
    for (const step of ['manual_qa', 'awaiting_merge'] as const) {
      await db.tasks.moveTask('alice', projectId, taskId, { columnId: board.columns.find((c) => c.semanticType === step)!.id })
    }
    // Из awaiting_merge пути в development нет. Раньше обработчик бросал
    // исключение прямо в колбэк завершения рана.
    await (async () => await db.tasks.handleAutoPilotFailure('alice', projectId, taskId, 'automated_qa', 'r1', 'упало'))()
  })
})

describe('остановка на ручном QA для отдельной задачи', () => {
  it('миграция сохраняет прежнюю остановку и не перезаписывает выбор при следующем открытии', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vc-autopilot-migration-'))
    const path = join(directory, 'db.sqlite')
    let migrated = new VoiceChatDb(path)
    try {
      await migrated.identity.createUser('alice', '', 'developer')
      const project = await migrated.projects.createProject('alice', { name: 'P' })
      await migrated.projects.updateProject('alice', project.id, { autoPilotRequiresManualQa: true })
      const board = (await migrated.tasks.getBoard('alice', project.id))!
      const task = (await migrated.tasks.createTask('alice', project.id, { title: 'Legacy', columnId: board.columns[0].id }))!
      await migrated.close()
      const legacy = new Database(path)
      legacy.exec('ALTER TABLE tasks DROP COLUMN auto_pilot_requires_manual_qa')
      legacy.close()
      migrated = new VoiceChatDb(path)
      await migrated.ready
      expect((await migrated.tasks.getTaskDetail('alice', project.id, task.id))!.autoPilotRequiresManualQa).toBe(true)
      await migrated.tasks.updateTask('alice', project.id, task.id, { autoPilotRequiresManualQa: false })
      await migrated.close()
      migrated = new VoiceChatDb(path)
      await migrated.ready
      expect((await migrated.tasks.getTaskDetail('alice', project.id, task.id))!.autoPilotRequiresManualQa).toBe(false)
    } finally {
      await migrated.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('наследуется при создании, затем сохраняется независимо от проекта', async () => {
    const project = await db.projects.createProject('alice', { name: 'P' })
    await db.projects.updateProject('alice', project.id, { autoPilotDefault: true, autoPilotRequiresManualQa: true })
    const board = (await db.tasks.getBoard('alice', project.id))!
    const task = (await db.tasks.createTask('alice', project.id, { title: 'QA', columnId: board.columns[0].id }))!
    expect(task.autoPilotRequiresManualQa).toBe(true)
    await db.projects.updateProject('alice', project.id, { autoPilotRequiresManualQa: false })
    expect((await db.tasks.autoPilotSnapshot(project.id))[0].requiresManualQa).toBe(true)
    await db.tasks.updateTask('alice', project.id, task.id, { autoPilotRequiresManualQa: false })
    expect((await db.tasks.autoPilotSnapshot(project.id))[0].requiresManualQa).toBe(false)
    expect((await db.tasks.getBoard('alice', project.id))!.tasks[0].autoPilotRequiresManualQa).toBe(false)
    await db.tasks.updateTask('alice', project.id, task.id, { autoPilotRequiresManualQa: true })
    expect((await db.tasks.getTaskDetail('alice', project.id, task.id))!.autoPilotRequiresManualQa).toBe(true)
  })
})

describe('замечания этапа в задаче на доработку', () => {
  it('хвост вывода попадает в описание баг-задачи', async () => {
    const { projectId, taskId } = await setup()
    const remarks = 'Команда: npm test\nКод выхода: 1\nFAIL src/components/TaskCard.dom.test.tsx'
    const handled = await db.tasks.handleAutoPilotFailure('alice', projectId, taskId, 'automated_qa', 'run-1', 'Команда автотестов завершилась с кодом 1', remarks)
    const bug = (await db.tasks.getCiTask('alice', projectId, handled!.bugTaskId!))!
    expect(bug.description).toContain('## Замечания этапа')
    expect(bug.description).toContain('FAIL src/components/TaskCard.dom.test.tsx')
  })

  it('без замечаний блок не добавляется', async () => {
    const { projectId, taskId } = await setup()
    const handled = await db.tasks.handleAutoPilotFailure('alice', projectId, taskId, 'automated_qa', 'run-1', 'упало')
    expect((await db.tasks.getCiTask('alice', projectId, handled!.bugTaskId!))!.description).not.toContain('Замечания этапа')
  })
})

describe('этап Automated QA: шаг рана и настройки', () => {
  it('markAutomatedQaRunning переводит шаг из starting в tests', async () => {
    // Условие `status='queued'` было мёртвым: startQaStageRun вставляет ран
    // сразу как running, и панель весь прогон показывала «starting».
    const { projectId, taskId } = await setup(false)
    const run = await db.qa.startQaStageRun('alice', projectId, taskId, 'automated_qa')
    expect(run.currentStep).toBe('starting')
    await db.qa.markAutomatedQaRunning(run.id)
    expect((await db.qa.getQaStageRun('alice', run.id))!.currentStep).toBe('tests')
  })

  it('режим и сценарий этапа сохраняются и переживают чтение проекта', async () => {
    const project = await db.projects.createProject('alice', { name: 'P' })
    await db.projects.updateProject('alice', project.id, {
      automatedQaMode: 'playwright',
      automatedQaScenarios: [{ startUrl: 'http://localhost:5173', steps: [{ id: 's1', title: 'Кнопка', action: { kind: 'click', selector: '#create' } }] }]
    })
    const detail = (await db.projects.getProject('alice', project.id))!
    expect(detail.automatedQaMode).toBe('playwright')
    expect(detail.automatedQaScenarios?.[0]?.steps).toHaveLength(1)
  })

  it('шаг с неизвестным действием отбрасывается, а не роняет прогон', async () => {
    const project = await db.projects.createProject('alice', { name: 'P' })
    await db.projects.updateProject('alice', project.id, {
      automatedQaScenarios: [{
        startUrl: 'http://localhost:5173',
        steps: [
          { id: 's1', title: 'Кнопка', action: { kind: 'click', selector: '#create' } },
          { id: 's2', title: 'Мусор', action: { kind: 'teleport' } as never }
        ]
      }]
    })
    expect((await db.projects.getProject('alice', project.id))!.automatedQaScenarios?.[0]?.steps.map((step) => step.id)).toEqual(['s1'])
  })
})

describe('снимок сценария в ране', () => {
  async function playwrightProject(): Promise<{ projectId: string; taskId: string }> {
    const setupResult = await setup(false)
    await db.projects.updateProject('alice', setupResult.projectId, {
      automatedQaMode: 'playwright',
      automatedQaScenarios: [{ name: 'Вход', startUrl: 'http://localhost:5173', steps: [{ id: 's1', title: 'Первый', action: { kind: 'click', selector: '#a' } }] }]
    })
    return setupResult
  }

  it('запуск фиксирует сценарий проекта, и правка настройки его не меняет', async () => {
    const { projectId, taskId } = await playwrightProject()
    const run = await db.qa.startQaStageRun('alice', projectId, taskId, 'automated_qa')
    expect(run.scenarios?.[0]?.steps.map((step) => step.title)).toEqual(['Первый'])
    await db.projects.updateProject('alice', projectId, { automatedQaScenarios: [{ startUrl: 'http://other', steps: [] }] })
    expect((await db.qa.getQaStageRun('alice', run.id))!.scenarios?.[0]?.steps).toHaveLength(1)
  })

  it('повтор воспроизводит снимок, а не текущую настройку', async () => {
    const { projectId, taskId } = await playwrightProject()
    const first = await db.qa.startQaStageRun('alice', projectId, taskId, 'automated_qa')
    await db.qa.updateQaStageRun(first.id, { status: 'failed', error: 'упало' })
    await db.projects.updateProject('alice', projectId, { automatedQaScenarios: [{ startUrl: 'http://other', steps: [{ id: 's2', title: 'Другой', action: { kind: 'click', selector: '#b' } }] }] })
    const retried = (await db.qa.retryQaStageRun('alice', first.id))!
    expect(retried.scenarios?.[0]?.steps.map((step) => step.title)).toEqual(['Первый'])
  })

  it('в режиме команды снимок не заводится', async () => {
    const { projectId, taskId } = await setup(false)
    expect((await db.qa.startQaStageRun('alice', projectId, taskId, 'automated_qa')).scenarios).toBeNull()
  })
})
