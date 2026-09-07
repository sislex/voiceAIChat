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

beforeEach(async () => {
  ids = 0
  db = new VoiceChatDb(':memory:', { newId: () => `qa-${++ids}`, now: () => 1_000 + ids })
  await db.identity.createUser('owner', '', 'developer')
  await db.identity.createUser('stranger', '', 'developer')
})
afterEach(() => db.close())

type Raw = { prepare(sql: string): { run(...values: unknown[]): unknown; get(...values: unknown[]): unknown } }
const rawOf = (): Raw => (db as unknown as { db: Raw }).db

const SHA = 'a'.repeat(40)

/** Задача в колонке `component_qa` с готовым development-раном и pushed-workspace. */
let fixtureSeq = 0
async function componentFixture(uiImpact: 'none' | 'existing_components' = 'existing_components') {
  const suffix = `-${++fixtureSeq}`
  const project = await db.projects.createProject('owner', { name: 'Component QA' + suffix })
  const column = (await db.tasks.getBoard('owner', project.id))!.columns.find((item) => item.semanticType === 'component_qa')!
  const task = (await db.tasks.createTask('owner', project.id, { columnId: column.id, title: 'Button' }))!
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
  it('очередной ран отдаёт машину, каталог и команды', async () => {
    const { project, task } = await componentFixture()
    const run = await db.ci.startComponentQaRun('owner', project.id, task.id)
    expect(await db.ci.componentQaExecutionContext(run.id)).toEqual({
      agentId: 'agent-component', workdir: '/repos/component', npmCacheDir: '/repos/.npm-cache/component', commands: ['npm run test:storybook'], ciBaseBranch: 'main'
    })
  })

  it('запущенный ран контекста уже не отдаёт — он выдаётся один раз, на старте', async () => {
    const { project, task } = await componentFixture()
    const run = await db.ci.startComponentQaRun('owner', project.id, task.id)
    await db.ci.markComponentQaRunning(run.id)
    expect(await db.ci.componentQaExecutionContext(run.id)).toBeNull()
  })

  it('несуществующий ран — null, а не исключение', async () => {
    expect(await db.ci.componentQaExecutionContext('нет-такого')).toBeNull()
  })

  // Component QA нужны компонентные проверки, а не полный гейт монорепо: своя
  // команда сужает стадию, пустая — наследует прежнюю настройку проекта.
  it('своя команда стадии перекрывает общую команду тестирования', async () => {
    const { project, task } = await componentFixture()
    await db.projects.updateProject('owner', project.id, { testCommand: 'npm run gate', componentQaCommand: 'npm run test:storybook' })
    const run = await db.ci.startComponentQaRun('owner', project.id, task.id)
    expect((await db.ci.componentQaExecutionContext(run.id))?.commands).toEqual(['npm run test:storybook'])
  })

  it('пустая команда стадии наследует команду тестирования проекта', async () => {
    const { project, task } = await componentFixture()
    await db.projects.updateProject('owner', project.id, { testCommand: 'npm run gate', componentQaCommand: '   ' })
    const run = await db.ci.startComponentQaRun('owner', project.id, task.id)
    expect((await db.ci.componentQaExecutionContext(run.id))?.commands).toEqual(['npm run gate'])
  })

  // Рабочие директории, созданные до появления колонки, кэша не знают: стадия
  // ставит зависимости кэшем npm по умолчанию, а не падает без контекста.
  it('у старой рабочей директории кэш пустой, но контекст выдаётся', async () => {
    const { project, task, raw, suffix } = await componentFixture()
    raw.prepare(`UPDATE ci_workspaces SET npm_cache_dir=NULL WHERE id=?`).run('ws-component' + suffix)
    const run = await db.ci.startComponentQaRun('owner', project.id, task.id)
    expect((await db.ci.componentQaExecutionContext(run.id))?.npmCacheDir).toBeNull()
  })

  it('контекст не выдаётся, если SHA workspace разошёлся с раном', async () => {
    // Иначе Component QA гонялся бы на коде, отличном от зафиксированного в ране.
    const { project, task, raw, suffix } = await componentFixture()
    const run = await db.ci.startComponentQaRun('owner', project.id, task.id)
    raw.prepare(`UPDATE ci_workspaces SET commit_sha=? WHERE id=?`).run('b'.repeat(40), 'ws-component' + suffix)
    expect(await db.ci.componentQaExecutionContext(run.id)).toBeNull()
  })
})

describe('Component QA: журнал рана', () => {
  it('вывод копится только у запущенного рана', async () => {
    const { project, task } = await componentFixture()
    const run = await db.ci.startComponentQaRun('owner', project.id, task.id)
    // Ран ещё в очереди — писать некуда.
    await db.ci.appendComponentQaLog(run.id, 'stdout', 'до запуска')
    expect(logOf(run.id)).toBe('')
    await db.ci.markComponentQaRunning(run.id)
    await db.ci.appendComponentQaLog(run.id, 'stdout', 'раз')
    await db.ci.appendComponentQaLog(run.id, 'stdout', 'два')
    expect(logOf(run.id)).toBe('раздва')
  })

  it('поток stderr помечается префиксом — иначе причина падения теряется в общем выводе', async () => {
    const { project, task } = await componentFixture()
    const run = await db.ci.startComponentQaRun('owner', project.id, task.id)
    await db.ci.markComponentQaRunning(run.id)
    await db.ci.appendComponentQaLog(run.id, 'stderr', 'ошибка')
    expect(logOf(run.id)).toBe('[stderr] ошибка')
  })

  it('завершённый ран журнал больше не принимает', async () => {
    const { project, task } = await componentFixture()
    const run = await db.ci.startComponentQaRun('owner', project.id, task.id)
    await db.ci.markComponentQaRunning(run.id)
    await db.ci.appendComponentQaLog(run.id, 'stdout', 'до финиша')
    await db.ci.finishComponentQaRun('owner', run.id, { status: 'passed', scenarios: [], commands: [], summary: 'ок' })
    await db.ci.appendComponentQaLog(run.id, 'stdout', 'после финиша')
    expect(logOf(run.id)).toBe('до финиша')
  })
})

describe('Component QA: завершение и отмена', () => {
  it('финиш возможен только из running', async () => {
    const { project, task } = await componentFixture()
    const run = await db.ci.startComponentQaRun('owner', project.id, task.id)
    await expect(async () => await db.ci.finishComponentQaRun('owner', run.id, { status: 'passed', scenarios: [], commands: [], summary: 'ок' })).rejects
      .toThrow(/not running/)
  })

  it('финиш сохраняет итог, сводку и адрес витрины', async () => {
    const { project, task } = await componentFixture()
    const run = await db.ci.startComponentQaRun('owner', project.id, task.id)
    await db.ci.markComponentQaRunning(run.id)
    const finished = await db.ci.finishComponentQaRun('owner', run.id, {
      status: 'failed', scenarios: [], commands: [], summary: 'сториз упала',
      storybookUrl: 'https://storybook.test', failureClassification: 'implementation_defect'
    })
    expect(finished).toMatchObject({ status: 'failed', summary: 'сториз упала', storybookUrl: 'https://storybook.test', failureClassification: 'implementation_defect' })
  })

  it('отмена работает из очереди и из запуска, но не переписывает завершённый ран', async () => {
    const { project, task } = await componentFixture()
    const queued = await db.ci.startComponentQaRun('owner', project.id, task.id)
    expect((await db.ci.cancelComponentQaRun('owner', queued.id)).status).toBe('cancelled')

    const { project: p2, task: t2 } = await componentFixture()
    const running = await db.ci.startComponentQaRun('owner', p2.id, t2.id)
    await db.ci.markComponentQaRunning(running.id)
    await db.ci.finishComponentQaRun('owner', running.id, { status: 'passed', scenarios: [], commands: [], summary: 'ок' })
    expect((await db.ci.cancelComponentQaRun('owner', running.id)).status).toBe('passed')
  })

  it('чужому ран не виден: отмена падает как «не найден», а не как «нет прав»', async () => {
    // Формулировка не косметика: «нет прав» подтвердила бы существование рана
    // в чужом проекте. Чужой не должен узнать даже этого.
    const { project, task } = await componentFixture()
    const run = await db.ci.startComponentQaRun('owner', project.id, task.id)
    await expect(async () => await db.ci.cancelComponentQaRun('stranger', run.id)).rejects.toThrow(/not found/)
    expect((await db.ci.getComponentQaRun('owner', run.id))!.status).toBe('queued')
  })

  it('привязка fix-рана переводит ран в failed и помечает дефектом реализации', async () => {
    const { project, task } = await componentFixture()
    const run = await db.ci.startComponentQaRun('owner', project.id, task.id)
    const linked = await db.ci.linkComponentQaFixRun('owner', run.id, 'fix-1')
    expect(linked).toMatchObject({ status: 'failed', failureClassification: 'implementation_defect', linkedFixRunId: 'fix-1' })
  })

  it('привязка fix-рана не сдвигает уже проставленное время завершения', async () => {
    const { project, task } = await componentFixture()
    const run = await db.ci.startComponentQaRun('owner', project.id, task.id)
    await db.ci.markComponentQaRunning(run.id)
    const finished = await db.ci.finishComponentQaRun('owner', run.id, { status: 'failed', scenarios: [], commands: [], summary: 'упало' })
    const linked = await db.ci.linkComponentQaFixRun('owner', run.id, 'fix-1')
    expect(linked.finishedAt).toBe(finished.finishedAt)
  })
})

describe('Integration QA: контекст и журнал', () => {
  /** Задача, доведённая до колонки integration_tests, с очередным раном. */
  async function integrationFixture() {
    // uiImpact 'existing_components' оставляет в снимке обязательный
    // автоматизируемый тест-кейс: без него ран сразу уходит в `skipped`.
    const { project, task, raw } = await componentFixture('existing_components')
    const integration = (await db.tasks.getBoard('owner', project.id))!.columns.find((item) => item.semanticType === 'integration_tests')!
    raw.prepare(`UPDATE tasks SET column_id=? WHERE id=?`).run(integration.id, task.id)
    return { project, task, raw }
  }

  it('очередной ран отдаёт свои команды проверки', async () => {
    const { project, task, raw } = await integrationFixture()
    raw.prepare(`UPDATE projects SET ci_base_branch='develop' WHERE id=?`).run(project.id)
    const run = await db.ci.startIntegrationTestRun('owner', project.id, task.id)
    expect(await db.ci.integrationTestExecutionContext(run.id)).toEqual({
      agentId: 'agent-component', workdir: '/repos/component', npmCacheDir: '/repos/.npm-cache/component', commands: ['npm run affected-check'], ciBaseBranch: 'develop'
    })
  })

  it('запущенный ран контекста не отдаёт', async () => {
    const { project, task } = await integrationFixture()
    const run = await db.ci.startIntegrationTestRun('owner', project.id, task.id)
    await db.ci.markIntegrationTestRunning(run.id)
    expect(await db.ci.integrationTestExecutionContext(run.id)).toBeNull()
  })

  it('своя команда этапа перекрывает общую, пустая — наследует', async () => {
    const { project, task } = await integrationFixture()
    await db.projects.updateProject('owner', project.id, { testCommand: 'npm run gate', integrationTestCommand: 'npm run test:integration' })
    const run = await db.ci.startIntegrationTestRun('owner', project.id, task.id)
    expect((await db.ci.integrationTestExecutionContext(run.id))?.commands).toEqual(['npm run test:integration'])
    await db.projects.updateProject('owner', project.id, { integrationTestCommand: '' })
    expect((await db.ci.integrationTestExecutionContext(run.id))?.commands).toEqual(['npm run gate'])
  })

  it('кэш гейта отдаёт только точную пару коммит + набор команд', async () => {
    const { project, task } = await integrationFixture()
    await db.ci.recordPassedGateResult({ projectId: project.id, taskId: task.id, commitSha: SHA, signature: 'sig-1', commands: ['npm run gate'], runKind: 'component_qa', runId: 'run-1' })
    expect(await db.ci.findPassedGateResult(SHA, 'sig-1')).toMatchObject({ runKind: 'component_qa', runId: 'run-1' })
    expect(await db.ci.findPassedGateResult(SHA, 'sig-2')).toBeNull()
    expect(await db.ci.findPassedGateResult('b'.repeat(40), 'sig-1')).toBeNull()
    expect(await db.ci.findPassedGateResult('', 'sig-1')).toBeNull()
    // Повторная запись того же ключа не ломает уникальный индекс.
    await db.ci.recordPassedGateResult({ projectId: project.id, taskId: task.id, commitSha: SHA, signature: 'sig-1', commands: ['npm run gate'], runKind: 'integration_tests', runId: 'run-2' })
    expect((await db.ci.findPassedGateResult(SHA, 'sig-1'))?.runId).toBe('run-1')
  })

  it('вывод копится только у запущенного рана', async () => {
    const { project, task, raw } = await integrationFixture()
    const run = await db.ci.startIntegrationTestRun('owner', project.id, task.id)
    const log = (): string => (raw.prepare(`SELECT log FROM integration_test_runs WHERE id=?`).get(run.id) as { log: string }).log
    await db.ci.appendIntegrationTestLog(run.id, 'до запуска')
    expect(log()).toBe('')
    await db.ci.markIntegrationTestRunning(run.id)
    await db.ci.appendIntegrationTestLog(run.id, 'проверка')
    expect(log()).toBe('проверка')
  })

  it('финиш возможен только из running и сохраняет причину отказа', async () => {
    const { project, task } = await integrationFixture()
    const run = await db.ci.startIntegrationTestRun('owner', project.id, task.id)
    await expect(async () => await db.ci.finishIntegrationTestRun('owner', run.id, { status: 'failed', commands: [], summary: 'x' })).rejects.toThrow(/not running/)
    await db.ci.markIntegrationTestRunning(run.id)
    const finished = await db.ci.finishIntegrationTestRun('owner', run.id, {
      status: 'failed', commands: [], summary: 'affected-check упал', failureReason: 'exit 1', failureClassification: 'implementation_defect'
    })
    expect(finished).toMatchObject({ status: 'failed', summary: 'affected-check упал', failureReason: 'exit 1' })
  })

  it('отмена работает из очереди, чужому пользователю запрещена', async () => {
    const { project, task } = await integrationFixture()
    const run = await db.ci.startIntegrationTestRun('owner', project.id, task.id)
    await expect(async () => await db.ci.cancelIntegrationTestRun('stranger', run.id)).rejects.toThrow(/QA permission required/)
    expect((await db.ci.cancelIntegrationTestRun('owner', run.id)).status).toBe('cancelled')
  })

  it('fix-ран привязывается один раз — повторная привязка не перетирает первую', async () => {
    // `WHERE linked_fix_run_id IS NULL`: первая ссылка на исправление остаётся.
    const { project, task } = await integrationFixture()
    const run = await db.ci.startIntegrationTestRun('owner', project.id, task.id)
    expect((await db.ci.linkIntegrationTestFixRun('owner', run.id, 'fix-1')).linkedFixRunId).toBe('fix-1')
    expect((await db.ci.linkIntegrationTestFixRun('owner', run.id, 'fix-2')).linkedFixRunId).toBe('fix-1')
  })
})
