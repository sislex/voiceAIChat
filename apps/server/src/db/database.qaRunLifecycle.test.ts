// Жизненный цикл ранов Component QA и Integration QA: методы, которых не вызывал
// ни один тест (найдены счётчиком вызовов функций в отчёте покрытия).
//
// Общая мысль всех проверок ниже — переходы статусов охраняются в SQL, а не в
// коде: `... WHERE id=? AND status='running'`. Такая охрана молчалива — вызов на
// ране в другом статусе просто ничего не делает и ошибки не даёт. Ровно поэтому
// на неё нужен тест: регрессия здесь выглядит как «лог иногда не пишется» или
// «отменённый ран продолжает копить вывод».

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VoiceChatDb } from './database.js'

let db: VoiceChatDb
let ids = 0

beforeEach(() => {
  ids = 0
  db = new VoiceChatDb(':memory:', { newId: () => `qa-${++ids}`, now: () => 1_000 + ids })
  db.createUser('owner', '', 'developer')
  db.createUser('stranger', '', 'developer')
})
afterEach(() => db.close())

type Raw = { prepare(sql: string): { run(...values: unknown[]): unknown; get(...values: unknown[]): unknown } }
const rawOf = (): Raw => (db as unknown as { db: Raw }).db

const SHA = 'a'.repeat(40)

/** Задача в колонке `component_qa` с готовым development-раном и pushed-workspace. */
let fixtureSeq = 0
function componentFixture(uiImpact: 'none' | 'existing_components' = 'existing_components') {
  const suffix = `-${++fixtureSeq}`
  const project = db.createProject('owner', { name: 'Component QA' + suffix })
  const column = db.getBoard('owner', project.id)!.columns.find((item) => item.semanticType === 'component_qa')!
  const task = db.createTask('owner', project.id, { columnId: column.id, title: 'Button' })!
  const raw = rawOf()
  const readiness = {
    functionalRequirements: 'Button works', acceptanceCriteria: 'Visible', acceptanceCriteriaConflict: false, uiImpact,
    testCases: uiImpact === 'none' ? [] : [{
      id: 'TC-COMP', title: 'Default', description: '', preconditions: 'Storybook', testData: 'fixture', steps: 'render',
      expectedResult: 'visible', required: true, testType: 'ui', automatable: true, automationLinks: [],
      notAutomatedReason: '', alternativeManualVerification: '', comments: ''
    }],
    affectedComponents: uiImpact === 'none' ? [] : [{
      id: 'button', name: 'Button', storybookStoryId: 'ui-button--default', reusable: true,
      coverage: { stories: true, states: true, fixtures: true, playFunctions: true, domTests: true, accessibility: true, visual: true },
      exclusionReason: '', alternativeVerification: ''
    }]
  }
  raw.prepare(`INSERT INTO task_preparation_runs (id,project_id,task_id,status,readiness_json,created_at,finished_at) VALUES (?,?,?,'success',?,?,?)`)
    .run('prep-component' + suffix, project.id, task.id, JSON.stringify(readiness), 1, 2)
  raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,npm_cache_dir,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run('ws-component' + suffix, project.id, task.id, 'agent-component', '/repos/component', '/repos/.npm-cache/component', 'CHAT-227', SHA, 1, 'released', 3)
  raw.prepare(`INSERT INTO ci_runs (id,project_id,task_id,status,workspace_id,triggered_by,mode,created_at) VALUES (?,?,?,'success',?,'owner','development',?)`)
    .run('dev-component' + suffix, project.id, task.id, 'ws-component' + suffix, 4)
  return { project, task, raw, suffix }
}

const logOf = (id: string): string =>
  (rawOf().prepare(`SELECT log FROM component_qa_runs WHERE id=?`).get(id) as { log: string }).log

describe('Component QA: контекст исполнения', () => {
  it('очередной ран отдаёт машину, каталог и команды', () => {
    const { project, task } = componentFixture()
    const run = db.startComponentQaRun('owner', project.id, task.id)
    expect(db.componentQaExecutionContext(run.id)).toEqual({
      agentId: 'agent-component', workdir: '/repos/component', npmCacheDir: '/repos/.npm-cache/component', commands: ['npm run test:storybook']
    })
  })

  it('запущенный ран контекста уже не отдаёт — он выдаётся один раз, на старте', () => {
    const { project, task } = componentFixture()
    const run = db.startComponentQaRun('owner', project.id, task.id)
    db.markComponentQaRunning(run.id)
    expect(db.componentQaExecutionContext(run.id)).toBeNull()
  })

  it('несуществующий ран — null, а не исключение', () => {
    expect(db.componentQaExecutionContext('нет-такого')).toBeNull()
  })

  // Component QA нужны компонентные проверки, а не полный гейт монорепо: своя
  // команда сужает стадию, пустая — наследует прежнюю настройку проекта.
  it('своя команда стадии перекрывает общую команду тестирования', () => {
    const { project, task } = componentFixture()
    db.updateProject('owner', project.id, { testCommand: 'npm run gate', componentQaCommand: 'npm run test:storybook' })
    const run = db.startComponentQaRun('owner', project.id, task.id)
    expect(db.componentQaExecutionContext(run.id)?.commands).toEqual(['npm run test:storybook'])
  })

  it('пустая команда стадии наследует команду тестирования проекта', () => {
    const { project, task } = componentFixture()
    db.updateProject('owner', project.id, { testCommand: 'npm run gate', componentQaCommand: '   ' })
    const run = db.startComponentQaRun('owner', project.id, task.id)
    expect(db.componentQaExecutionContext(run.id)?.commands).toEqual(['npm run gate'])
  })

  // Рабочие директории, созданные до появления колонки, кэша не знают: стадия
  // ставит зависимости кэшем npm по умолчанию, а не падает без контекста.
  it('у старой рабочей директории кэш пустой, но контекст выдаётся', () => {
    const { project, task, raw, suffix } = componentFixture()
    raw.prepare(`UPDATE ci_workspaces SET npm_cache_dir=NULL WHERE id=?`).run('ws-component' + suffix)
    const run = db.startComponentQaRun('owner', project.id, task.id)
    expect(db.componentQaExecutionContext(run.id)?.npmCacheDir).toBeNull()
  })

  it('контекст не выдаётся, если SHA workspace разошёлся с раном', () => {
    // Иначе Component QA гонялся бы на коде, отличном от зафиксированного в ране.
    const { project, task, raw, suffix } = componentFixture()
    const run = db.startComponentQaRun('owner', project.id, task.id)
    raw.prepare(`UPDATE ci_workspaces SET commit_sha=? WHERE id=?`).run('b'.repeat(40), 'ws-component' + suffix)
    expect(db.componentQaExecutionContext(run.id)).toBeNull()
  })
})

describe('Component QA: журнал рана', () => {
  it('вывод копится только у запущенного рана', () => {
    const { project, task } = componentFixture()
    const run = db.startComponentQaRun('owner', project.id, task.id)
    // Ран ещё в очереди — писать некуда.
    db.appendComponentQaLog(run.id, 'stdout', 'до запуска')
    expect(logOf(run.id)).toBe('')
    db.markComponentQaRunning(run.id)
    db.appendComponentQaLog(run.id, 'stdout', 'раз')
    db.appendComponentQaLog(run.id, 'stdout', 'два')
    expect(logOf(run.id)).toBe('раздва')
  })

  it('поток stderr помечается префиксом — иначе причина падения теряется в общем выводе', () => {
    const { project, task } = componentFixture()
    const run = db.startComponentQaRun('owner', project.id, task.id)
    db.markComponentQaRunning(run.id)
    db.appendComponentQaLog(run.id, 'stderr', 'ошибка')
    expect(logOf(run.id)).toBe('[stderr] ошибка')
  })

  it('завершённый ран журнал больше не принимает', () => {
    const { project, task } = componentFixture()
    const run = db.startComponentQaRun('owner', project.id, task.id)
    db.markComponentQaRunning(run.id)
    db.appendComponentQaLog(run.id, 'stdout', 'до финиша')
    db.finishComponentQaRun('owner', run.id, { status: 'passed', scenarios: [], commands: [], summary: 'ок' })
    db.appendComponentQaLog(run.id, 'stdout', 'после финиша')
    expect(logOf(run.id)).toBe('до финиша')
  })
})

describe('Component QA: завершение и отмена', () => {
  it('финиш возможен только из running', () => {
    const { project, task } = componentFixture()
    const run = db.startComponentQaRun('owner', project.id, task.id)
    expect(() => db.finishComponentQaRun('owner', run.id, { status: 'passed', scenarios: [], commands: [], summary: 'ок' }))
      .toThrow(/not running/)
  })

  it('финиш сохраняет итог, сводку и адрес витрины', () => {
    const { project, task } = componentFixture()
    const run = db.startComponentQaRun('owner', project.id, task.id)
    db.markComponentQaRunning(run.id)
    const finished = db.finishComponentQaRun('owner', run.id, {
      status: 'failed', scenarios: [], commands: [], summary: 'сториз упала',
      storybookUrl: 'https://storybook.test', failureClassification: 'implementation_defect'
    })
    expect(finished).toMatchObject({ status: 'failed', summary: 'сториз упала', storybookUrl: 'https://storybook.test', failureClassification: 'implementation_defect' })
  })

  it('отмена работает из очереди и из запуска, но не переписывает завершённый ран', () => {
    const { project, task } = componentFixture()
    const queued = db.startComponentQaRun('owner', project.id, task.id)
    expect(db.cancelComponentQaRun('owner', queued.id).status).toBe('cancelled')

    const { project: p2, task: t2 } = componentFixture()
    const running = db.startComponentQaRun('owner', p2.id, t2.id)
    db.markComponentQaRunning(running.id)
    db.finishComponentQaRun('owner', running.id, { status: 'passed', scenarios: [], commands: [], summary: 'ок' })
    expect(db.cancelComponentQaRun('owner', running.id).status).toBe('passed')
  })

  it('чужому ран не виден: отмена падает как «не найден», а не как «нет прав»', () => {
    // Формулировка не косметика: «нет прав» подтвердила бы существование рана
    // в чужом проекте. Чужой не должен узнать даже этого.
    const { project, task } = componentFixture()
    const run = db.startComponentQaRun('owner', project.id, task.id)
    expect(() => db.cancelComponentQaRun('stranger', run.id)).toThrow(/not found/)
    expect(db.getComponentQaRun('owner', run.id)!.status).toBe('queued')
  })

  it('привязка fix-рана переводит ран в failed и помечает дефектом реализации', () => {
    const { project, task } = componentFixture()
    const run = db.startComponentQaRun('owner', project.id, task.id)
    const linked = db.linkComponentQaFixRun('owner', run.id, 'fix-1')
    expect(linked).toMatchObject({ status: 'failed', failureClassification: 'implementation_defect', linkedFixRunId: 'fix-1' })
  })

  it('привязка fix-рана не сдвигает уже проставленное время завершения', () => {
    const { project, task } = componentFixture()
    const run = db.startComponentQaRun('owner', project.id, task.id)
    db.markComponentQaRunning(run.id)
    const finished = db.finishComponentQaRun('owner', run.id, { status: 'failed', scenarios: [], commands: [], summary: 'упало' })
    const linked = db.linkComponentQaFixRun('owner', run.id, 'fix-1')
    expect(linked.finishedAt).toBe(finished.finishedAt)
  })
})

describe('Integration QA: контекст и журнал', () => {
  /** Задача, доведённая до колонки integration_tests, с очередным раном. */
  function integrationFixture() {
    // uiImpact 'existing_components' оставляет в снимке обязательный
    // автоматизируемый тест-кейс: без него ран сразу уходит в `skipped`.
    const { project, task, raw } = componentFixture('existing_components')
    const integration = db.getBoard('owner', project.id)!.columns.find((item) => item.semanticType === 'integration_tests')!
    raw.prepare(`UPDATE tasks SET column_id=? WHERE id=?`).run(integration.id, task.id)
    return { project, task, raw }
  }

  it('очередной ран отдаёт свои команды проверки', () => {
    const { project, task } = integrationFixture()
    const run = db.startIntegrationTestRun('owner', project.id, task.id)
    expect(db.integrationTestExecutionContext(run.id)).toEqual({
      agentId: 'agent-component', workdir: '/repos/component', npmCacheDir: '/repos/.npm-cache/component', commands: ['npm run affected-check']
    })
  })

  it('запущенный ран контекста не отдаёт', () => {
    const { project, task } = integrationFixture()
    const run = db.startIntegrationTestRun('owner', project.id, task.id)
    db.markIntegrationTestRunning(run.id)
    expect(db.integrationTestExecutionContext(run.id)).toBeNull()
  })

  it('своя команда этапа перекрывает общую, пустая — наследует', () => {
    const { project, task } = integrationFixture()
    db.updateProject('owner', project.id, { testCommand: 'npm run gate', integrationTestCommand: 'npm run test:integration' })
    const run = db.startIntegrationTestRun('owner', project.id, task.id)
    expect(db.integrationTestExecutionContext(run.id)?.commands).toEqual(['npm run test:integration'])
    db.updateProject('owner', project.id, { integrationTestCommand: '' })
    expect(db.integrationTestExecutionContext(run.id)?.commands).toEqual(['npm run gate'])
  })

  it('кэш гейта отдаёт только точную пару коммит + набор команд', () => {
    const { project, task } = integrationFixture()
    db.recordPassedGateResult({ projectId: project.id, taskId: task.id, commitSha: SHA, signature: 'sig-1', commands: ['npm run gate'], runKind: 'component_qa', runId: 'run-1' })
    expect(db.findPassedGateResult(SHA, 'sig-1')).toMatchObject({ runKind: 'component_qa', runId: 'run-1' })
    expect(db.findPassedGateResult(SHA, 'sig-2')).toBeNull()
    expect(db.findPassedGateResult('b'.repeat(40), 'sig-1')).toBeNull()
    expect(db.findPassedGateResult('', 'sig-1')).toBeNull()
    // Повторная запись того же ключа не ломает уникальный индекс.
    db.recordPassedGateResult({ projectId: project.id, taskId: task.id, commitSha: SHA, signature: 'sig-1', commands: ['npm run gate'], runKind: 'integration_tests', runId: 'run-2' })
    expect(db.findPassedGateResult(SHA, 'sig-1')?.runId).toBe('run-1')
  })

  it('вывод копится только у запущенного рана', () => {
    const { project, task, raw } = integrationFixture()
    const run = db.startIntegrationTestRun('owner', project.id, task.id)
    const log = (): string => (raw.prepare(`SELECT log FROM integration_test_runs WHERE id=?`).get(run.id) as { log: string }).log
    db.appendIntegrationTestLog(run.id, 'до запуска')
    expect(log()).toBe('')
    db.markIntegrationTestRunning(run.id)
    db.appendIntegrationTestLog(run.id, 'проверка')
    expect(log()).toBe('проверка')
  })

  it('финиш возможен только из running и сохраняет причину отказа', () => {
    const { project, task } = integrationFixture()
    const run = db.startIntegrationTestRun('owner', project.id, task.id)
    expect(() => db.finishIntegrationTestRun('owner', run.id, { status: 'failed', commands: [], summary: 'x' })).toThrow(/not running/)
    db.markIntegrationTestRunning(run.id)
    const finished = db.finishIntegrationTestRun('owner', run.id, {
      status: 'failed', commands: [], summary: 'affected-check упал', failureReason: 'exit 1', failureClassification: 'implementation_defect'
    })
    expect(finished).toMatchObject({ status: 'failed', summary: 'affected-check упал', failureReason: 'exit 1' })
  })

  it('отмена работает из очереди, чужому пользователю запрещена', () => {
    const { project, task } = integrationFixture()
    const run = db.startIntegrationTestRun('owner', project.id, task.id)
    expect(() => db.cancelIntegrationTestRun('stranger', run.id)).toThrow(/QA permission required/)
    expect(db.cancelIntegrationTestRun('owner', run.id).status).toBe('cancelled')
  })

  it('fix-ран привязывается один раз — повторная привязка не перетирает первую', () => {
    // `WHERE linked_fix_run_id IS NULL`: первая ссылка на исправление остаётся.
    const { project, task } = integrationFixture()
    const run = db.startIntegrationTestRun('owner', project.id, task.id)
    expect(db.linkIntegrationTestFixRun('owner', run.id, 'fix-1').linkedFixRunId).toBe('fix-1')
    expect(db.linkIntegrationTestFixRun('owner', run.id, 'fix-2').linkedFixRunId).toBe('fix-1')
  })
})
