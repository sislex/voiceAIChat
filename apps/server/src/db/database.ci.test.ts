import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { PROD_REBUILD_TASK_TITLE, TASK_COMMIT_COMMAND_SCRIPT, VoiceChatDb } from './database.js'
import { CI_KB_UPDATE_COMMAND_ID, ciToolOutputLimits, DEFAULT_CI_STAGE_MODELS, DEFAULT_TOOL_OUTPUT_SETTINGS } from '@voicechat/shared'

let db: VoiceChatDb

beforeEach(() => {
  let id = 0
  let clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  db.identity.createUser('alice', '', 'developer')
  db.identity.createUser('bob', '', 'developer')
})
afterEach(() => db.close())

function project() {
  const p = db.projects.createProject('alice', { name: 'P1' })
  const board = db.tasks.getBoard('alice', p.id)!
  const col = board.columns[0]
  const task = db.tasks.createTask('alice', p.id, { title: 'T1', columnId: col.id })!
  return { p, col, task }
}

describe('ci: справочник команд', () => {
  it('создаёт, читает, версионирует и мягко удаляет', () => {
    const { p } = project()
    const c = db.ci.createCiCommand('alice', { scope: 'project', projectId: p.id, name: 'clone', script: 'git clone' })
    expect(c.name).toBe('clone')
    expect(c.version).toBe(1)
    expect(c.availableToModel).toBe(true)
    // Правка скрипта поднимает версию.
    const u = db.ci.updateCiCommand('alice', c.id, { script: 'git clone --depth 1' })!
    expect(u.version).toBe(2)
    // Правка без изменения скрипта версию не трогает.
    const u2 = db.ci.updateCiCommand('alice', c.id, { description: 'x' })!
    expect(u2.version).toBe(2)
    // Soft-delete прячет из списка.
    expect(db.ci.listCiCommands('alice', p.id).map((x) => x.id)).toContain(c.id)
    expect(db.ci.softDeleteCiCommand('alice', c.id)).toBe(true)
    expect(db.ci.listCiCommands('alice', p.id).map((x) => x.id)).not.toContain(c.id)
    expect(db.ci.getCiCommand('alice', c.id)).toBeNull()
  })

  it('уникальность имени в области; изоляция проектной команды от не-участника', () => {
    const { p } = project()
    db.ci.createCiCommand('alice', { scope: 'project', projectId: p.id, name: 'clone', script: 'x' })
    expect(() => db.ci.createCiCommand('alice', { scope: 'project', projectId: p.id, name: 'clone', script: 'y' })).toThrow()
    // Страница справочника без projectId показывает команды всех доступных проектов.
    expect(db.ci.listCiCommands('alice').map((x) => x.name)).toContain('clone')
    // bob не участник — проектную команду не видит ни с фильтром, ни в общем
    // списке (глобальные команды справочника, включая встроенный шаг базы
    // знаний, видны всем — это не проектные данные).
    expect(db.ci.listCiCommands('bob', p.id).every((c) => c.scope === 'global')).toBe(true)
    expect(db.ci.listCiCommands('bob').map((x) => x.name)).not.toContain('clone')
  })

  it('гейт помечается is_test при создании, npm ci — нет', () => {
    const { p } = project()
    const gate = db.ci.createCiCommand('alice', { scope: 'project', projectId: p.id, name: 'Запустить тестирование (npm test)', script: 'npm test' })
    expect(gate.isTest).toBe(true)
    const install = db.ci.createCiCommand('alice', { scope: 'project', projectId: p.id, name: 'Установить зависимости', script: 'npm ci' })
    expect(install.isTest).toBe(false)
    // Флаг можно проставить руками — команде, которую по тексту не узнать.
    expect(db.ci.updateCiCommand('alice', install.id, { isTest: true })!.isTest).toBe(true)
  })

  it('база от прошлой версии: миграция помечает гейт и убирает его у модели', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-istest-'))
    const file = join(dir, 'db.sqlite')
    let n = 0
    const first = new VoiceChatDb(file, { newId: () => `t-${++n}`, now: () => 1000 })
    first.identity.createUser('alice', '', 'developer')
    const gate = first.ci.createCiCommand('alice', { scope: 'global', name: 'Тесты', script: 'npm run -w @voicechat/server test' })
    const install = first.ci.createCiCommand('alice', { scope: 'global', name: 'Установка', script: 'npm ci' })
    first.close()

    // Откатываем схему к состоянию до колонки: команда доступна модели, признака нет.
    const raw = new Database(file)
    raw.exec(`ALTER TABLE ci_commands DROP COLUMN is_test`)
    raw.exec(`UPDATE ci_commands SET available_to_model = 1`)
    raw.close()

    const second = new VoiceChatDb(file, { newId: () => `t2-${++n}`, now: () => 2000 })
    expect(second.ci.getCiCommand('alice', gate.id)).toMatchObject({ isTest: true, availableToModel: false })
    expect(second.ci.getCiCommand('alice', install.id)).toMatchObject({ isTest: false, availableToModel: true })
    second.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('миграция переводит штатный гейт на affected-check и сохраняет его проверочным', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-affected-gate-'))
    const file = join(dir, 'db.sqlite')
    let n = 0
    const first = new VoiceChatDb(file, { newId: () => `a-${++n}`, now: () => 1000 })
    first.identity.createUser('alice', '', 'developer')
    const gate = first.ci.createCiCommand('alice', {
      scope: 'global',
      name: 'Запустить проверки (typecheck + npm test)',
      script: 'npm run typecheck && npm test'
    })
    first.close()

    const second = new VoiceChatDb(file, { newId: () => `a-${++n}`, now: () => 2000 })
    expect(second.ci.getCiCommand('alice', gate.id)).toMatchObject({
      script: 'npm run affected-check',
      isTest: true,
      availableToModel: true,
      version: 2
    })
    second.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('глобальные команды видны всем', () => {
    const g = db.ci.createCiCommand('alice', { scope: 'global', name: 'npm ci', script: 'npm ci' })
    expect(db.ci.listCiCommands('bob').map((x) => x.id)).toContain(g.id)
  })
})

describe('ci: слот-конфиг и наследование', () => {
  it('задача наследует дефолты проекта, затем переопределяет', () => {
    const { p, task } = project()
    const a = db.ci.createCiCommand('alice', { scope: 'project', projectId: p.id, name: 'a', script: 'a' })
    const b = db.ci.createCiCommand('alice', { scope: 'project', projectId: p.id, name: 'b', script: 'b' })
    db.ci.setCiSlotCommands('project', p.id, 'before_model', [a.id, b.id])
    // Нет переопределения у задачи → берём дефолты проекта.
    expect(db.ci.resolveTaskSlots(p.id, task.id).beforeModel).toEqual([a.id, b.id])
    expect(db.ci.hasCiSlotConfig('task', task.id)).toBe(false)
    // Переопределяем на задаче (можно с повтором команды).
    db.ci.setCiSlotCommands('task', task.id, 'before_model', [b.id, b.id])
    expect(db.ci.hasCiSlotConfig('task', task.id)).toBe(true)
    expect(db.ci.resolveTaskSlots(p.id, task.id).beforeModel).toEqual([b.id, b.id])
  })
})

describe('ci: выбор этапов процесса', () => {
  it('по умолчанию включает всё и сохраняет выбранные этапы в каноническом порядке', () => {
    const { task } = project()
    expect(db.ci.getTaskProcessStages(task.id)).toEqual(['before_model', 'model_work', 'after_model', 'summary'])
    expect(db.ci.setTaskProcessStages(task.id, ['summary', 'before_model'])).toEqual(['before_model', 'summary'])
    expect(db.ci.getTaskProcessStages(task.id)).toEqual(['before_model', 'summary'])
  })
})

describe('ci: браузерная проверка задачи', () => {
  it('по умолчанию выключена, сохраняется и нормализуется при чтении', () => {
    const { task } = project()
    expect(db.ci.getTaskBrowserCheck(task.id)).toEqual({ mode: 'off', devServerPort: 5173, startPath: '/' })
    expect(db.ci.setTaskBrowserCheck(task.id, { mode: 'chromium', devServerPort: 8799, startPath: 'board' }))
      .toEqual({ mode: 'chromium', devServerPort: 8799, startPath: '/board' })
    expect(db.ci.getTaskBrowserCheck(task.id)).toEqual({ mode: 'chromium', devServerPort: 8799, startPath: '/board' })
  })

  it('битая строка в БД не мешает запустить ран', () => {
    const { task } = project()
    db.ci.setTaskBrowserCheck(task.id, { mode: 'chromium' })
    ;(db as unknown as { db: Database.Database }).db
      .prepare('UPDATE ci_task_browser_checks SET check_json = ? WHERE task_id = ?').run('{не json', task.id)
    expect(db.ci.getTaskBrowserCheck(task.id)).toEqual({ mode: 'off', devServerPort: 5173, startPath: '/' })
  })
})

describe('ci: движок и модель', () => {
  it('задача наследует настройку проекта и может переопределить её', () => {
    const { p, task } = project()
    expect(db.ci.resolveTaskLlmConfig(p.id, task.id)).toEqual({ provider: 'claude', model: 'opus', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    db.ci.setCiLlmConfig('project', p.id, { provider: 'codex', model: 'gpt-5.4', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    expect(db.ci.resolveTaskLlmConfig(p.id, task.id)).toEqual({ provider: 'codex', model: 'gpt-5.4', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    db.ci.setCiLlmConfig('task', task.id, { provider: 'claude', model: 'haiku', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    expect(db.ci.resolveTaskLlmConfig(p.id, task.id)).toEqual({ provider: 'claude', model: 'haiku', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
  })

  // Движок мог быть удалён админом уже после настройки CI. Ссылку мы намеренно
  // не стираем (её может «оживить» новый движок с тем же id при восстановлении
  // из бэкапа), но ран обязан пойти на доступном исполнителе, а не упасть.
  it('удалённый движок в конфигурации подменяется доступным, а не ломает ран', () => {
    const engine = db.llm.createLlmEngine({ name: 'Временный', kind: 'claude', baseUrl: 'http://runner:8790', token: '', enabled: true, allowedRoles: ['admin', 'developer'], isDefault: true })
    db.ci.setCiLlmConfig('project', 'p-engine-gone', { provider: 'claude', model: 'sonnet', mode: 'development', clarifyLevel: 'few', clarifyMax: 3, llmEngineId: engine.id })
    db.llm.deleteLlmEngine(engine.id)

    const resolved = db.llm.resolveLlmEngine(db.ci.getCiLlmConfig('project', 'p-engine-gone')?.llmEngineId ?? null, 'claude', 'admin')

    expect(resolved.engine?.id).not.toBe(engine.id)
    expect(resolved.substituted).toBe(true)
  })

  it('этап наследует поля задача → проект → модель проекта → fallback', () => {
    const { p, task } = project()
    db.ci.setCiLlmConfig('project', p.id, { llmEngineId: 'project-engine', provider: 'claude', model: 'opus', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    db.ci.setCiStageLlmConfig('project', p.id, 'code_review', { provider: 'codex' })
    db.ci.setCiStageLlmConfig('task', task.id, 'code_review', { model: 'gpt-5.4' })
    expect(db.ci.resolveTaskStageLlmConfig(p.id, task.id, 'code_review')).toEqual({
      llmEngineId: 'project-engine', provider: 'codex', model: 'gpt-5.4'
    })
    expect(db.ci.clearCiStageLlmConfig('task', task.id, 'code_review')).toBe(true)
    expect(db.ci.resolveTaskStageLlmConfig(p.id, task.id, 'code_review').model).toBe('opus')
  })

  it('снятие переопределения возвращает наследование от проекта', () => {
    const { p, task } = project()
    db.ci.setCiLlmConfig('project', p.id, { provider: 'codex', model: 'gpt-5.4', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    db.ci.setCiLlmConfig('task', task.id, { provider: 'claude', model: 'haiku', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    expect(db.ci.clearCiLlmConfig('task', task.id)).toBe(true)
    expect(db.ci.getCiLlmConfig('task', task.id)).toBeNull()
    expect(db.ci.resolveTaskLlmConfig(p.id, task.id)).toEqual({ provider: 'codex', model: 'gpt-5.4', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    // повторный сброс — идемпотентен, настройка проекта не задета
    expect(db.ci.clearCiLlmConfig('task', task.id)).toBe(false)
    expect(db.ci.getCiLlmConfig('project', p.id)).toEqual({ provider: 'codex', model: 'gpt-5.4', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
  })
})

describe('ci: глобальные настройки', () => {
  it('возвращает дефолты и обновляется', () => {
    expect(db.ci.getCiSettings()).toMatchObject({
      maxFixAttempts: 10,
      fixTimeLimitMs: 30 * 60 * 1000,
      fixTokenLimit: 600_000,
      defaultStepTimeoutSec: 1_800,
    })
    const s = db.ci.updateCiSettings({ maxFixAttempts: 5, maxConcurrentRuns: 4 })
    expect(s.maxFixAttempts).toBe(5)
    expect(s.maxConcurrentRuns).toBe(4)
    expect(db.ci.getCiSettings().maxFixAttempts).toBe(5)
  })

  it('модель по стадии: дефолт дешёвый, правка переживает перечитывание, мусор чистится', () => {
    expect(db.ci.getCiSettings().stageModels).toEqual(DEFAULT_CI_STAGE_MODELS)
    db.ci.updateCiSettings({ stageModels: { model_work: '', fix: '', kb_update: 'haiku', summary: '' } })
    expect(db.ci.getCiSettings().stageModels).toMatchObject({ model_work: '', fix: '', kb_update: 'haiku', summary: '' })
    db.ci.updateCiSettings({ maxFixAttempts: 2 })
    expect(db.ci.getCiSettings().stageModels.kb_update).toBe('haiku')
    db.ci.updateCiSettings({ stageModels: { kb_update: 'sonnet', чужое: 1 } as never })
    expect(db.ci.getCiSettings().stageModels).toMatchObject({ model_work: '', fix: '', kb_update: 'sonnet', summary: '' })
  })

  it('лимиты ответов инструментов хранятся и переживают перечитывание', () => {
    expect(db.ci.getCiSettings()).toMatchObject(DEFAULT_TOOL_OUTPUT_SETTINGS)
    db.ci.updateCiSettings({ bashOutputLimitChars: 8000, readWindowMaxLines: 120, grepMatchLimit: 40 })
    const saved = db.ci.getCiSettings()
    expect(saved.bashOutputLimitChars).toBe(8000)
    expect(saved.readWindowMaxLines).toBe(120)
    expect(saved.grepMatchLimit).toBe(40)
    expect(saved.readOutputLimitChars).toBe(DEFAULT_TOOL_OUTPUT_SETTINGS.readOutputLimitChars)
    db.ci.updateCiSettings({ bashOutputLimitChars: 0 })
    expect(ciToolOutputLimits(db.ci.getCiSettings()).bashChars).toBe(DEFAULT_TOOL_OUTPUT_SETTINGS.bashOutputLimitChars)
  })
})

describe('ci: раны, шаги, лог, метрики', () => {
  it('создаёт ран, шаги, пишет лог с монотонным seq и считает метрики', () => {
    const { p, col, task } = project()
    const cmd = db.ci.createCiCommand('alice', { scope: 'project', projectId: p.id, name: 'test', script: 'npm test' })
    const run = db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: col.id, slotProgress: { done: 0, total: 2, phase: 'Подготовка' } })
    expect(run.status).toBe('queued')
    const step = db.ci.addCiRunStep({ runId: run.id, slot: 'before_model', position: 0, kind: 'command', commandId: cmd.id, commandSnapshot: 'npm test', title: 'test', status: 'running' })
    db.ci.appendCiLog(run.id, step.id, 'stdout', 'line1\n')
    db.ci.appendCiLog(run.id, step.id, 'stderr', 'warn\n')
    const log = db.ci.getCiRunLog('alice', run.id)
    expect(log.map((l) => l.seq)).toEqual([1, 2])
    expect(log[1].stream).toBe('stderr')
    db.ci.updateCiRunStep(step.id, { status: 'success', exitCode: 0, durationMs: 500, finishedAt: 2000 })
    db.ci.updateCiRun(run.id, { status: 'success', durationMs: 700 })
    const detail = db.ci.getCiRun('alice', run.id)!
    expect(detail.steps[0].status).toBe('success')
    expect(detail.steps[0].exitCode).toBe(0)
    const metrics = db.ci.ciCommandMetrics('alice', p.id)
    expect(metrics.find((m) => m.commandId === cmd.id)?.samples).toBe(1)
    expect(metrics.find((m) => m.commandId === cmd.id)?.successRate).toBe(1)
    // Сводка ранов по задаче.
    const summaries = db.ci.latestCiRunSummaries(p.id)
    expect(summaries.find((s) => s.taskId === task.id)?.status).toBe('success')
    // Изоляция: bob не видит ран.
    expect(db.ci.getCiRun('bob', run.id)).toBeNull()
    expect(db.ci.getCiRunLog('bob', run.id)).toEqual([])
  })

  it('выдаёт базовый снимок до стадии и сохранённый LLM активной стадии после override', () => {
    const { p, col, task } = project()
    const run = db.ci.createCiRun({
      projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: col.id,
      llmProvider: 'codex', llmModel: 'gpt-5.6-luna', slotProgress: { done: 0, total: 1, phase: 'Подготовка' }
    })
    expect(db.ci.getCiRun('alice', run.id)!.executionLlm).toMatchObject({
      source: 'run', stage: null, provider: 'codex', model: 'gpt-5.6-luna'
    })
    const stage = db.ci.createCiStageRun({
      runId: run.id, taskId: task.id, stage: 'model_work',
      llm: { llmEngineId: null, provider: 'codex', model: 'gpt-5.6-sol' }
    })
    db.ci.updateCiStageRun(stage.id, { status: 'running', startedAt: 100 })
    expect(db.ci.getCiRun('alice', run.id)!.executionLlm).toEqual({
      source: 'stage', stage: 'model_work', llmEngineId: null, provider: 'codex', model: 'gpt-5.6-sol',
      base: { llmEngineId: null, provider: 'codex', model: 'gpt-5.6-luna' }
    })
    expect(db.ci.latestCiRunSummary(task.id)!.executionLlm).toMatchObject({ stage: 'model_work', model: 'gpt-5.6-sol' })
    db.ci.updateCiStageRun(stage.id, { status: 'success', finishedAt: 200, durationMs: 100 })
    db.ci.setCiStageLlmConfig('task', task.id, 'model_work', { model: 'другая-модель' })
    expect(db.ci.getCiRun('alice', run.id)!.stageRuns?.[0].llm.model).toBe('gpt-5.6-sol')
  })

  it('success → cancelled сохраняет успех основным результатом и отмену отдельной попыткой', () => {
    const { p, col, task } = project()
    const success = db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: col.id, runColumnId: col.id, slotProgress: { done: 1, total: 1, phase: 'Готово' } })
    db.ci.updateCiRun(success.id, { status: 'success', terminalColumnId: col.id })
    const cancelled = db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: col.id, runColumnId: col.id, slotProgress: { done: 0, total: 1, phase: 'Отменён' } })
    db.ci.updateCiRun(cancelled.id, { status: 'cancelled', terminalColumnId: col.id })

    const summary = db.ci.latestCiRunSummary(task.id)!
    expect(summary.id).toBe(success.id)
    expect(summary.status).toBe('success')
    expect(summary.latestAttempt).toMatchObject({ id: cancelled.id, status: 'cancelled' })
    expect(db.ci.listCiRunsForTask('alice', p.id, task.id).map((run) => run.id)).toContain(cancelled.id)
  })

  it('отмена перестаёт быть актуальной после ручного переноса на другой этап', () => {
    const { p, col, task } = project()
    const cancelled = db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: col.id, runColumnId: col.id, slotProgress: { done: 0, total: 1, phase: 'Отменён' } })
    db.ci.updateCiRun(cancelled.id, { status: 'cancelled', terminalColumnId: col.id })
    expect(db.ci.latestCiRunSummary(task.id)?.status).toBe('cancelled')
    const other = db.projects.createColumn('alice', p.id, 'Другой этап')!
    db.tasks.moveTask('alice', p.id, task.id, { columnId: other.id })
    expect(db.ci.latestCiRunSummary(task.id)).toBeNull()
  })

  it('fix-loop: попытки и метрика работы модели', () => {
    const { p, col, task } = project()
    const run = db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: col.id, slotProgress: { done: 0, total: 0, phase: '' } })
    const mw = db.ci.addCiRunStep({ runId: run.id, slot: null, position: 1, kind: 'model_work', title: 'Работа модели', status: 'running' })
    db.ci.updateCiRunStep(mw.id, { status: 'success', durationMs: 1200, finishedAt: 3000 })
    const step = db.ci.addCiRunStep({ runId: run.id, slot: 'after_model', position: 2, kind: 'command', title: 'build', status: 'failed' })
    db.ci.updateCiRun(run.id, { modelSessionId: 'session-1', fixContext: { stepId: step.id, logTail: 'FAIL x.test.ts', failures: [], updatedAt: 42 } })
    db.ci.addCiFixAttempt({
      runStepId: step.id, attemptNo: 1, diagnosis: 'нет зависимости', action: 'npm i', result: 'fixed',
      changedFiles: ['src/x.ts'], targetedTests: [{ command: 'npm test -- x.test.ts', exitCode: 0, timedOut: false, output: 'ok' }],
      fullRerun: { stepId: 'rerun-1', exitCode: 0, timedOut: false }, failures: [], durationMs: 400, tokensUsed: 100
    })
    const detail = db.ci.getCiRun('alice', run.id)!
    expect(detail.run).toMatchObject({ modelSessionId: 'session-1', fixContext: { stepId: step.id, logTail: 'FAIL x.test.ts' } })
    expect(detail.fixAttempts).toHaveLength(1)
    expect(detail.fixAttempts[0]).toMatchObject({ result: 'fixed', changedFiles: ['src/x.ts'], fullRerun: { exitCode: 0 } })
    expect(db.ci.ciModelWorkMetric('alice', p.id).avgMs).toBe(1200)
  })
})

describe('последний актуальный результат задачи', () => {
  it('не создаёт ложную ошибку без запусков и отдаёт признак в снапшоте доски', () => {
    const { p, task } = project()
    expect(db.tasks.latestTaskRunResult(task.id)).toBeNull()
    expect(db.tasks.getBoard('alice', p.id)!.tasks.find((item) => item.id === task.id)?.latestRunResult).toBeNull()
  })

  it('новый ран сразу вытесняет старую ошибку, а новый терминальный итог возвращает её при повторном падении', () => {
    const { p, col, task } = project()
    const failed = db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: col.id, runColumnId: col.id, slotProgress: { done: 1, total: 2, phase: 'Ошибка' } })
    db.ci.updateCiRun(failed.id, { status: 'failed', finishedAt: 2000 })
    expect(db.tasks.latestTaskRunResult(task.id)).toMatchObject({ id: failed.id, outcome: 'failure' })

    const retry = db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: col.id, runColumnId: col.id, slotProgress: { done: 0, total: 2, phase: 'Очередь' } })
    expect(db.tasks.latestTaskRunResult(task.id)).toMatchObject({ id: retry.id, outcome: 'active', status: 'queued' })
    db.ci.updateCiRun(retry.id, { status: 'success', finishedAt: 3000 })
    expect(db.tasks.latestTaskRunResult(task.id)).toMatchObject({ id: retry.id, outcome: 'success' })

    const failedAgain = db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: col.id, runColumnId: col.id, slotProgress: { done: 1, total: 2, phase: 'Ошибка' } })
    db.ci.updateCiRun(failedAgain.id, { status: 'timeout', finishedAt: 4000 })
    expect(db.tasks.latestTaskRunResult(task.id)).toMatchObject({ id: failedAgain.id, outcome: 'failure', status: 'timeout' })
  })

  it('cancelled не является ошибкой', () => {
    const { p, col, task } = project()
    const run = db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: col.id, runColumnId: col.id, slotProgress: { done: 0, total: 1, phase: 'Отменён' } })
    db.ci.updateCiRun(run.id, { status: 'cancelled', finishedAt: 2000 })
    expect(db.tasks.latestTaskRunResult(task.id)).toMatchObject({ outcome: 'cancelled' })
  })
})

describe('ci: рабочие директории и предложения', () => {
  it('workspace: активна → освобождена; отчёт помечает осиротевшие', () => {
    const { p, task } = project()
    const ws = db.ci.createCiWorkspace({ projectId: p.id, taskId: task.id, agentId: null, path: '/repos/p/1' })
    expect(db.ci.findActiveCiWorkspace(p.id, task.id)?.id).toBe(ws.id)
    const report = db.ci.listCiWorkspaceReport('alice', p.id)
    expect(report[0].orphaned).toBe(false) // задача в бэклоге, не done
    db.ci.releaseCiWorkspace(ws.id, null)
    expect(db.ci.findActiveCiWorkspace(p.id, task.id)).toBeNull()
  })

  it('предложения модели: группировка по причине, принятие поднимает версию', () => {
    const { p } = project()
    const cmd = db.ci.createCiCommand('alice', { scope: 'project', projectId: p.id, name: 'npm', script: 'npm ci' })
    db.ci.addCiSuggestion({ commandId: cmd.id, runStepId: null, reason: 'кэш', proposedScript: 'npm ci --cache' })
    db.ci.addCiSuggestion({ commandId: cmd.id, runStepId: null, reason: 'кэш', proposedScript: 'npm ci --cache2' })
    const list = db.ci.listCiSuggestions('alice', p.id)
    expect(list).toHaveLength(1)
    expect(list[0].occurrences).toBe(2)
    expect(db.ci.countNewCiSuggestions(cmd.id)).toBe(1)
    db.ci.resolveCiSuggestion('alice', list[0].id, true)
    expect(db.ci.getCiCommand('alice', cmd.id)!.version).toBe(2)
    expect(db.ci.getCiCommand('alice', cmd.id)!.script).toBe('npm ci --cache2')
    expect(db.ci.countNewCiSuggestions(cmd.id)).toBe(0)
  })
})

// В `:memory:` таблицы создаёт SCHEMA_SQL уже с новыми колонками, поэтому ветка
// ALTER TABLE в migrate() там не исполняется вовсе. Прод-БД идёт именно по ней —
// проверяем на файловой БД со «старой» схемой.
describe('VoiceChatDb — миграция существующей БД под режим запуска и паузы', () => {
  it('добавляет колонки режима/уточнений в ci_llm_configs, ci_runs и ci_settings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-ci-migrate-'))
    const file = join(dir, 'old.db')
    const raw = new Database(file)
    // Старая форма таблиц: без mode/clarify_*/conversation_id/interaction_wait_ms.
    raw.exec(`CREATE TABLE ci_llm_configs (
      owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
      PRIMARY KEY (owner_type, owner_id))`)
    raw.exec(`CREATE TABLE ci_runs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL, agent_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued', workspace_id TEXT, triggered_by TEXT NOT NULL,
      prev_column_id TEXT, llm_provider TEXT NOT NULL DEFAULT 'claude', llm_model TEXT NOT NULL DEFAULT 'sonnet',
      slot_progress_json TEXT NOT NULL DEFAULT '{}', started_at INTEGER, finished_at INTEGER,
      duration_ms INTEGER, created_at INTEGER NOT NULL)`)
    raw.exec(`CREATE TABLE ci_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1), max_fix_attempts INTEGER NOT NULL,
      fix_time_limit_ms INTEGER NOT NULL, fix_token_limit INTEGER NOT NULL,
      default_step_timeout_sec INTEGER NOT NULL, metrics_window INTEGER NOT NULL,
      max_concurrent_runs INTEGER NOT NULL, max_model_command_calls INTEGER NOT NULL)`)
    raw.prepare(`INSERT INTO ci_llm_configs (owner_type, owner_id, provider, model) VALUES (?,?,?,?)`)
      .run('project', 'p-old', 'codex', 'gpt-5.4')
    raw.prepare(`INSERT INTO ci_runs (id, project_id, task_id, triggered_by, created_at) VALUES (?,?,?,?,?)`)
      .run('run-old', 'p-old', 't-old', 'alice', 1)
    raw.prepare(`INSERT INTO ci_settings (id, max_fix_attempts, fix_time_limit_ms, fix_token_limit,
      default_step_timeout_sec, metrics_window, max_concurrent_runs, max_model_command_calls)
      VALUES (1,3,600000,200000,600,20,2,20)`).run()
    raw.close()

    const migrated = new VoiceChatDb(file)
    const cols = (name: string): string[] =>
      ((migrated as unknown as { db: Database.Database }).db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>)
        .map((c) => c.name)

    expect(cols('ci_llm_configs')).toEqual(expect.arrayContaining(['mode', 'clarify_level', 'clarify_max']))
    expect(cols('ci_runs')).toEqual(expect.arrayContaining(['mode', 'clarify_level', 'clarify_max', 'conversation_id']))
    expect(cols('ci_settings')).toContain('interaction_wait_ms')
    expect(cols('ci_settings')).toContain('stage_models')
    expect(cols('ci_settings')).toEqual(expect.arrayContaining([
      'bash_output_limit_chars', 'read_output_limit_chars', 'read_window_max_lines',
      'grep_match_limit', 'grep_output_limit_chars'
    ]))
    expect(migrated.ci.getCiSettings()).toMatchObject(DEFAULT_TOOL_OUTPUT_SETTINGS)
    // Таблица пауз появляется как новая (CREATE TABLE IF NOT EXISTS).
    expect(migrated.ci.listCiInteractions('run-old')).toEqual([])

    // Старые строки получают осмысленные значения по умолчанию, а не NULL.
    expect(migrated.ci.getCiLlmConfig('project', 'p-old')).toEqual({
      provider: 'codex', model: 'gpt-5.4', mode: 'development', clarifyLevel: 'few', clarifyMax: 3
    })
    const run = migrated.ci.getCiRunRaw('run-old')!
    expect(run.mode).toBe('development')
    expect(run.clarifyLevel).toBe('few')
    expect(run.clarifyMax).toBe(3)
    expect(run.conversationId).toBeNull()
    expect(migrated.ci.getCiSettings().interactionWaitMs).toBe(30 * 60 * 1000)
    // Настройки, заведённые до модели по стадии: колонка пуста и читается как
    // дефолт кода — обновление само переводит вспомогательные стадии на дешёвую
    // модель, иначе экономия включалась бы только руками.
    expect(migrated.ci.getCiSettings().stageModels).toEqual(DEFAULT_CI_STAGE_MODELS)

    migrated.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ci: reconciliation после рестарта сервера', () => {
  it('не сохраняет failed без человекочитаемой причины, даже если шагов ещё нет', () => {
    const { p, task } = project()
    const run = db.ci.createCiRun({
      projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice',
      prevColumnId: null, slotProgress: { done: 0, total: 0, phase: 'Старт' }
    })

    db.ci.updateCiRun(run.id, { status: 'failed' })

    const detail = db.ci.getCiRun('alice', run.id)!
    expect(detail.steps).toEqual([])
    expect(detail.run.error).toBe('Ран завершился с ошибкой до появления подробной диагностики.')
  })

  it('сохраняет незапущенный ран в очереди, а начатый помечает interrupted', () => {
    const { p, task } = project()
    const queued = db.ci.createCiRun({
      projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice',
      prevColumnId: null, slotProgress: { done: 0, total: 3, phase: 'В очереди' }
    })
    const activeTask = db.tasks.createTask('alice', p.id, { title: 'active', columnId: task.columnId })
    const run = db.ci.createCiRun({
      projectId: p.id, taskId: activeTask!.id, agentId: null, triggeredBy: 'alice',
      prevColumnId: null, slotProgress: { done: 0, total: 3, phase: 'Старт' }
    })
    db.ci.updateCiRun(run.id, { status: 'running', startedAt: 1000 })
    const done = db.ci.addCiRunStep({ runId: run.id, slot: 'before_model', position: 0, kind: 'command', title: 'клон', status: 'success' })
    const stuck = db.ci.addCiRunStep({ runId: run.id, slot: null, position: 1, kind: 'model_work', title: 'Работа модели', status: 'running' })
    const later = db.ci.addCiRunStep({ runId: run.id, slot: 'after_model', position: 2, kind: 'command', title: 'тесты', status: 'queued' })
    const it0 = db.ci.addCiInteraction({ runId: run.id, stepId: stuck.id, kind: 'clarify', questions: [{ q: 'а?', options: ['да'], multi: false }] })

    const result = db.ci.reconcileInterruptedCiRuns()
    expect(result.queued.map((item) => item.id)).toEqual([queued.id])
    expect(result.interrupted.map((item) => item.id)).toEqual([run.id])
    expect(db.ci.getCiRunRaw(queued.id)?.status).toBe('queued')
    expect(db.ci.getCiRunRaw(run.id)).toMatchObject({
      status: 'interrupted',
      error: 'Ран прерван перезапуском сервера.',
      slotProgress: { phase: 'Прерван перезапуском сервера' }
    })
    expect(db.ci.getCiRunRaw(run.id)?.finishedAt).not.toBeNull()

    const steps = db.ci.getCiRun('alice', run.id)!.steps
    const byId = (id: string) => steps.find((s) => s.id === id)!.status
    expect(byId(done.id)).toBe('success')
    expect(byId(stuck.id)).toBe('interrupted')
    expect(byId(later.id)).toBe('skipped')
    expect(db.ci.getCiInteraction(it0.id)?.status).toBe('cancelled')

    const again = db.ci.reconcileInterruptedCiRuns()
    expect(again.queued.map((item) => item.id)).toEqual([queued.id])
    expect(again.interrupted).toEqual([])
  })
})

describe('ci: метки чатов задач для списка бесед', () => {
  it('отдаёт ключ, тип и колонку; ран — только по запросу; чужие чаты не выдаёт', () => {
    const { p, col, task } = project()
    const chat = db.chat.openOrCreateTaskChat('alice', p.id, task.id)!
    // Обычный чат без задачи метки не получает.
    db.chat.createConversation('alice', 'Просто разговор')

    const before = db.tasks.taskChatBadges('alice')
    expect(before).toHaveLength(1)
    expect(before[0]).toMatchObject({ conversationId: chat.id, taskId: task.id, projectId: p.id, key: 'P1-1', type: 'task', columnSemantic: 'backlog' })
    // Сводка рана стоит пяти запросов на задачу и списку чатов не нужна —
    // по умолчанию поля нет вовсе.
    expect(before[0]).not.toHaveProperty('run')

    const run = db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: col.id, slotProgress: { done: 1, total: 3, phase: 'Модель работает' } })
    db.ci.updateCiRun(run.id, { status: 'awaiting_input' })
    expect(db.tasks.taskChatBadges('alice')[0]).not.toHaveProperty('run')

    // Кто просит состояние явно — получает ту же сводку, что подсвечивает карточку.
    const after = db.tasks.taskChatBadges('alice', { withRuns: true })[0]
    expect(after.run).toMatchObject({ id: run.id, taskId: task.id, status: 'awaiting_input', awaitingInput: true })
    expect(after.run?.slotProgress.phase).toBe('Модель работает')

    // Семантика колонки обновляется вместе с ручным завершением задачи.
    const done = db.tasks.getBoard('alice', p.id)!.columns.find((c) => c.semanticType === 'done')!
    db.tasks.moveTask('alice', p.id, task.id, { columnId: done.id })
    expect(db.tasks.taskChatBadges('alice')[0].columnSemantic).toBe('done')

    // Метки — свои: bob чужой чат задачи не видит.
    expect(db.tasks.taskChatBadges('bob')).toEqual([])
  })
})

describe('ci: автозадача «Пересборка прода»', () => {
  it('заводит одну открытую карточку в ready и копит строки без дублей', () => {
    const { p } = project()
    const ready = db.tasks.getBoard('alice', p.id)!.columns.find((c) => c.semanticType === 'ready')!

    const first = db.tasks.ensureProdRebuildTask('alice', p.id, '- P1-1: T1')!
    expect(first.created).toBe(true)
    expect(first.task.title).toBe(PROD_REBUILD_TASK_TITLE)
    expect(first.task.columnId).toBe(ready.id)
    expect(first.task.type).toBe('task')
    expect(first.task.assignee).toBe(null)

    // Вторая задача — та же карточка, новая строка.
    const second = db.tasks.ensureProdRebuildTask('alice', p.id, '- P1-2: T2')!
    expect(second.created).toBe(false)
    expect(second.appended).toBe(true)
    expect(second.task.id).toBe(first.task.id)

    // Та же строка второй раз — ничего не меняется.
    const again = db.tasks.ensureProdRebuildTask('alice', p.id, '- P1-2: T2')!
    expect(again.appended).toBe(false)
    expect(again.task.description.split('\n').filter((l) => l.startsWith('- '))).toEqual(['- P1-1: T1', '- P1-2: T2'])
    expect(db.tasks.getBoard('alice', p.id)!.tasks.filter((t) => t.title === PROD_REBUILD_TASK_TITLE).length).toBe(1)
  })

  it('карточка в done не переиспользуется — заводится новая', () => {
    const { p } = project()
    const done = db.tasks.getBoard('alice', p.id)!.columns.find((c) => c.semanticType === 'done')!
    const first = db.tasks.ensureProdRebuildTask('alice', p.id, '- P1-1: T1')!
    db.tasks.moveTask('alice', p.id, first.task.id, { columnId: done.id })

    const next = db.tasks.ensureProdRebuildTask('alice', p.id, '- P1-2: T2')!
    expect(next.created).toBe(true)
    expect(next.task.id).not.toBe(first.task.id)
    expect(next.task.description).not.toContain('T1')
    // Закрытую карточку не трогаем.
    expect(db.tasks.getBoard('alice', p.id)!.tasks.find((t) => t.id === first.task.id)!.description).not.toContain('T2')
  })

  it('нет колонки ready — карточку не заводим; чужой проект недоступен', () => {
    const { p } = project()
    const spy = vi.spyOn(db.projects, 'getColumnIdBySemantic').mockReturnValue(null)
    expect(db.tasks.ensureProdRebuildTask('alice', p.id, '- P1-1: T1')).toBe(null)
    spy.mockRestore()
    // Не участник проекта карточку не заводит.
    expect(db.tasks.ensureProdRebuildTask('bob', p.id, '- P1-1: T1')).toBe(null)
    expect(db.tasks.getBoard('alice', p.id)!.tasks.some((t) => t.title === PROD_REBUILD_TASK_TITLE)).toBe(false)
  })
})

describe('встроенный шаг «Актуализировать базу знаний»', () => {
  it('заводится в справочнике как серверный шаг, недоступный модели', () => {
    const cmd = db.ci.getCiCommand('alice', CI_KB_UPDATE_COMMAND_ID)!
    expect(cmd.builtin).toBe('kb_update')
    expect(cmd.scope).toBe('global')
    expect(cmd.availableToModel).toBe(false)
    expect(cmd.allowFailure).toBe(false)
    // Виден всем как глобальная команда справочника.
    expect(db.ci.listCiCommands('bob').some((c) => c.id === CI_KB_UPDATE_COMMAND_ID)).toBe(true)
  })

  it('остаётся в справочнике, но миграция удаляет интеграционные команды из after_model', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-kb-seed-'))
    const file = join(dir, 'db.sqlite')
    let n = 0
    const first = new VoiceChatDb(file, { newId: () => `s-${++n}`, now: () => 1000 })
    first.identity.createUser('alice', '', 'developer')
    const p = first.projects.createProject('alice', { name: 'P' })
    const test = first.ci.createCiCommand('alice', { scope: 'global', name: 'Запустить тестирование (npm test)', script: 'npm test' })
    const commit = first.ci.createCiCommand('alice', { scope: 'global', name: 'Закоммитить работу в ветку задачи', script: 'git add -A' })
    const merge = first.ci.createCiCommand('alice', { scope: 'global', name: 'Влить ветку задачи в прод-ветку', script: 'git merge --no-edit' })
    first.ci.setCiSlotCommands('project', p.id, 'after_model', [test.id, commit.id, merge.id])
    first.close()

    // Состояние «база от прошлой версии»: строки встроенного шага ещё нет.
    const raw = new Database(file)
    raw.exec(`DELETE FROM ci_slot_commands WHERE command_id = '${CI_KB_UPDATE_COMMAND_ID}'`)
    raw.exec(`DELETE FROM ci_commands WHERE id = '${CI_KB_UPDATE_COMMAND_ID}'`)
    raw.close()

    const second = new VoiceChatDb(file, { newId: () => `s2-${++n}`, now: () => 2000 })
    expect(second.ci.getCiSlotConfig('project', p.id).afterModel).toEqual([commit.id])
    expect(second.ci.getCiCommand('alice', commit.id)).toMatchObject({ script: TASK_COMMIT_COMMAND_SCRIPT, version: 2 })
    expect(second.ci.getCiCommand('alice', CI_KB_UPDATE_COMMAND_ID)).toBeTruthy()
    // Повторное открытие ничего не возвращает в development pipeline.
    second.ci.setCiSlotCommands('project', p.id, 'after_model', [test.id, commit.id])
    second.close()
    const third = new VoiceChatDb(file, { newId: () => `s3-${++n}`, now: () => 3000 })
    expect(third.ci.getCiSlotConfig('project', p.id).afterModel).toEqual([commit.id])
    expect(third.ci.getCiCommand('alice', commit.id)).toMatchObject({ script: TASK_COMMIT_COMMAND_SCRIPT, version: 2 })
    third.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('обязательный commit-step задачи', () => {
  it('создаёт ветку и коммит, а чистое дерево завершает без пустого коммита', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-task-commit-'))
    const repo = join(dir, 'репозиторий задачи')
    mkdirSync(repo)
    execFileSync('git', ['init', '-q', repo])
    writeFileSync(join(repo, 'work.txt'), 'готово\n')
    const env = {
      ...process.env,
      SLUG: 'репозиторий задачи',
      BRANCH: 'CHAT-401-ветка',
      TASK_KEY: 'CHAT-401'
    }

    execFileSync('bash', ['-c', TASK_COMMIT_COMMAND_SCRIPT], { cwd: dir, env })
    expect(execFileSync('git', ['branch', '--show-current'], { cwd: repo, encoding: 'utf8' }).trim()).toBe('CHAT-401-ветка')
    expect(execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: repo, encoding: 'utf8' }).trim()).toBe('CHAT-401: работа CI-рана')
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()

    const cleanOutput = execFileSync('bash', ['-c', TASK_COMMIT_COMMAND_SCRIPT], { cwd: dir, env, encoding: 'utf8' })
    expect(cleanOutput).toContain('Нет незакоммиченных изменений — коммит не нужен')
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()).toBe(head)
    rmSync(dir, { recursive: true, force: true })
  })
})

// Расход старых ранов: колонки семантики входа у них нет, и переписывать историю
// задним числом нельзя. Значит различать движки надо на чтении — иначе суммы
// «до/после» складывают вход codex вместе с кэшем и вход claude без него.
describe('ci: расход модели и семантика входных токенов', () => {
  /** Строка расхода в старой форме: колонки семантики входа у неё нет. */
  const legacy = (runId: string, provider: 'claude' | 'codex', over: Record<string, number> = {}): string => {
    const id = `legacy-${runId}-${provider}`
    const handle = (db as unknown as { db: Database.Database }).db
    handle.prepare(
      `INSERT INTO ci_run_usage (id, run_id, step_id, kind, provider, model, input_tokens, output_tokens,
        cache_read_tokens, cache_creation_tokens, cost_usd, duration_ms, num_turns, input_semantics, at)
       VALUES (?, ?, NULL, 'model_work', ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, NULL, 1)`
    ).run(id, runId, provider, provider === 'codex' ? 'gpt-5.4' : 'opus',
      over.input ?? 1_000_000, over.output ?? 1000, over.cacheRead ?? 800_000)
    return id
  }

  function run() {
    const { p, task } = project()
    return db.ci.createCiRun({
      projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: null,
      llmProvider: 'codex', llmModel: 'gpt-5.4', slotProgress: { done: 0, total: 1, phase: '' }
    })
  }

  it('новая строка помечена приведённой, старая строка codex — «вход с кэшем»', () => {
    const r = run()
    const fresh = db.ci.addCiRunUsage({ runId: r.id, stepId: null, kind: 'model_work', provider: 'codex', model: 'gpt-5.4', inputTokens: 200_000, cacheReadTokens: 800_000 })
    const oldId = legacy(r.id, 'codex')
    // Ищем по id, а не по позиции: у подложенной старой строки своё `at`.
    const rows = db.ci.listCiRunUsage(r.id)
    expect(rows.find((x) => x.id === fresh.id)!.inputSemantics).toBe('no_cache')
    expect(rows.find((x) => x.id === oldId)!.inputSemantics).toBe('with_cache')
  })

  it('старая строка claude остаётся «без кэша»: у него вход и раньше был чистым', () => {
    const r = run()
    legacy(r.id, 'claude')
    expect(db.ci.listCiRunUsage(r.id)[0].inputSemantics).toBe('no_cache')
  })

  it('отчёт по рану приводит старые строки к одной семантике и говорит об этом', () => {
    const r = run()
    legacy(r.id, 'codex')
    const report = db.ci.ciRunReport('alice', r.id)!
    expect(report.totals.inputTokens).toBe(200_000) // 1M пришедших минус 800k кэша
    expect(report.totals.inputNormalized).toBe(true)
    expect(report.toolCalls).toBeNull()
  })

  it('счётчик вызовов инструментов копится по видам и не путает раны', () => {
    const a = run()
    const b = run()
    db.ci.addCiRunToolCalls(a.id, { read: 3, bash: 1 })
    db.ci.addCiRunToolCalls(a.id, { read: 2, edit: 4, kb: 1 })
    db.ci.addCiRunToolCalls(b.id, { grep: 2, denied: 3 })
    expect(db.ci.ciRunToolCalls(a.id)).toEqual({ bash: 1, read: 5, grep: 0, edit: 4, kb: 1, other: 0, denied: 0 })
    // Отказы — такой же вид в таблице ключ-значение, отдельной колонки не нужно.
    expect(db.ci.ciRunToolCalls(b.id)).toEqual({ bash: 0, read: 0, grep: 2, edit: 0, kb: 0, other: 0, denied: 3 })
    // Нулевые виды не пишутся вовсе: «нет строки» = «счётчика у рана нет».
    expect(db.ci.ciRunToolCalls('нет-такого-рана')).toBeNull()
  })
})

describe('ci: создание задачи из предложения улучшения', () => {
  function improvement() {
    const { p, col, task } = project()
    const item = db.tasks.upsertTaskImprovement({
      projectId: p.id, taskId: task.id, runId: null, stepId: null, source: 'development',
      title: 'Улучшить ретраи', description: 'Подробности', fingerprint: 'retry',
      evidence: ['Ошибка видима пользователю'], suggestedAction: 'create_chatai_task'
    })
    return { p, col, task, item }
  }

  it('атомарно создаёт связанную задачу и повторно возвращает её', () => {
    const { p, col, task, item } = improvement()
    const input = { columnId: col.id, title: 'Новая задача', description: 'Описание', acceptanceCriteria: 'Критерий' }
    const first = db.tasks.createTaskFromImprovement('alice', item.id, input)!
    const second = db.tasks.createTaskFromImprovement('alice', item.id, { ...input, title: 'Дубликат' })!
    expect(first.created).toBe(true)
    expect(second).toMatchObject({ created: false, task: { id: first.task.id, sourceTaskId: task.id }, improvement: { status: 'implemented', createdTaskId: first.task.id } })
    expect(db.tasks.getBoard('alice', p.id)!.tasks.filter((candidate) => candidate.sourceTaskId === task.id)).toHaveLength(1)
    expect(db.tasks.listProjectImprovementTaskIds('alice', p.id)).toEqual([])
  })

  it('очередь проекта отдаёт каждое предложение с исходной задачей, файлами и критериями', () => {
    const { p, col, task } = project()
    const first = db.tasks.upsertTaskImprovement({
      projectId: p.id, taskId: task.id, runId: null, stepId: null, source: 'development',
      title: 'Стабилизировать: npm test', description: 'Подробности', fingerprint: 'npm-test',
      evidence: ['Статус шага: failed'], files: ['apps/server/src/turns.ts', ' apps/server/src/turns.ts '],
      acceptanceCriteria: 'Шаг проходит с первой попытки.', suggestedAction: 'create_chatai_task'
    })
    expect(first).toMatchObject({ files: ['apps/server/src/turns.ts'], acceptanceCriteria: 'Шаг проходит с первой попытки.' })
    // Повтор того же наблюдения объединяет файлы и не создаёт дубликат.
    const again = db.tasks.upsertTaskImprovement({
      projectId: p.id, taskId: task.id, runId: null, stepId: null, source: 'development',
      title: 'Стабилизировать: npm test', description: 'Подробности', fingerprint: 'npm-test',
      evidence: ['Статус шага: timeout'], files: ['packages/ui/src/App.tsx'], suggestedAction: 'create_chatai_task'
    })
    expect(again).toMatchObject({ id: first.id, occurrences: 2, files: ['apps/server/src/turns.ts', 'packages/ui/src/App.tsx'] })
    const queue = db.tasks.listProjectImprovements('alice', p.id)
    expect(queue).toEqual([expect.objectContaining({ id: first.id, taskTitle: 'T1', taskSeq: task.seq, taskColumnId: col.id })])
    expect(db.tasks.listProjectImprovements('bob', p.id)).toEqual([])
  })

  it('без columnId задача создаётся в единственной колонке backlog с текстом предложения', () => {
    const { p, col, item } = improvement()
    expect(col.semanticType).toBe('backlog')
    const result = db.tasks.createTaskFromImprovement('alice', item.id, {})!
    expect(result.created).toBe(true)
    expect(result.task).toMatchObject({ columnId: col.id, title: 'Улучшить ретраи', description: 'Подробности', acceptanceCriteria: 'Ошибка видима пользователю' })
    expect(db.tasks.listProjectImprovements('alice', p.id)).toEqual([])
  })

  it('удаление убирает предложение из очереди; чужой пользователь удалить не может', () => {
    const { p, item } = improvement()
    expect(db.tasks.deleteTaskImprovement('bob', item.id)).toBe(false)
    expect(db.tasks.improvementProjectId(item.id)).toBe(p.id)
    expect(db.tasks.deleteTaskImprovement('alice', item.id)).toBe(true)
    expect(db.tasks.deleteTaskImprovement('alice', item.id)).toBe(false)
    expect(db.tasks.listProjectImprovements('alice', p.id)).toEqual([])
    expect(db.tasks.improvementProjectId(item.id)).toBeNull()
  })

  it('проверяет матрицу переходов и откатывает недопустимое создание', () => {
    const { p, task, item } = improvement()
    expect(db.tasks.updateTaskImprovementStatus('alice', item.id, 'accepted')!.status).toBe('accepted')
    expect(() => db.tasks.updateTaskImprovementStatus('alice', item.id, 'rejected')).toThrow('недопустим')
    expect(() => db.tasks.createTaskFromImprovement('alice', item.id, { columnId: 'missing', title: 'X', description: '', acceptanceCriteria: '' })).toThrow('колонка')
    expect(db.tasks.listTaskImprovements('alice', p.id, task.id)[0]).toMatchObject({ status: 'accepted', createdTaskId: null })
    expect(db.tasks.getBoard('alice', p.id)!.tasks).toHaveLength(1)
  })
})

describe('ci: временная шкала задачи', () => {
  it('разделяет очередь, активную работу и awaiting_input и не считает паузу активной', () => {
    const { p, task } = project()
    const run = db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: null, slotProgress: { done: 0, total: 1, phase: 'development' } })
    db.ci.updateCiRun(run.id, { status: 'running', startedAt: run.createdAt })
    const interaction = db.ci.addCiInteraction({ runId: run.id, stepId: 'model', kind: 'clarify' })
    const answered = db.ci.answerCiInteraction(interaction.id, { userId: 'alice', text: 'ok' })!
    db.ci.updateCiRun(run.id, { status: 'success', finishedAt: answered.answeredAt! + 100 })
    const timeline = db.tasks.taskTimeline('alice', p.id, task.id)!
    const attempt = timeline.stages.find((stage) => stage.type === 'development')!.attempts[0]
    expect(attempt.awaitingInputDuration).toBe(answered.answeredAt! - interaction.createdAt)
    expect(attempt.queueDuration).toBe(0)
    expect(attempt.activeDuration).toBe((answered.answeredAt! + 100 - run.createdAt) - attempt.awaitingInputDuration!)
    expect(timeline.summary.activeDuration).toBe(attempt.activeDuration)
    expect(timeline.summary.lastChangedAt).toBe(new Date(answered.answeredAt! + 100).toISOString())
  })

  it('не выдумывает активное время для legacy preparation без started_at', () => {
    const { p, task } = project()
    const run = db.tasks.startTaskPreparationRun('alice', p.id, task.id)
    const timeline = db.tasks.taskTimeline('alice', p.id, task.id)!
    const attempt = timeline.stages.find((stage) => stage.type === 'task_preparation')!.attempts.find((item) => item.runs[0].id === run.id)!
    expect(attempt.startedAt).toBeNull()
    expect(attempt.activeDuration).toBeNull()
    expect(timeline.summary.firstStartedAt).toBeNull()
  })

  it('считает события рана по типу: на этом держится лимит возобновлений', () => {
    const { p, task } = project()
    const run = db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: null, slotProgress: { done: 0, total: 1, phase: 'development' } })
    const other = db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: null, slotProgress: { done: 0, total: 1, phase: 'development' } })
    db.ci.addCiEvent({ projectId: p.id, runId: run.id, type: 'run.infra_error', actorType: 'system', payload: { kind: 'agent_offline' } })
    db.ci.addCiEvent({ projectId: p.id, runId: run.id, type: 'run.autopilot_infra_resume', actorType: 'system' })
    db.ci.addCiEvent({ projectId: p.id, runId: run.id, type: 'run.autopilot_infra_resume', actorType: 'system' })
    // Счётчик привязан к рану: соседний ран той же задачи в него не попадает.
    db.ci.addCiEvent({ projectId: p.id, runId: other.id, type: 'run.autopilot_infra_resume', actorType: 'system' })

    expect(db.ci.countCiEvents(run.id, 'run.infra_error')).toBe(1)
    expect(db.ci.countCiEvents(run.id, 'run.autopilot_infra_resume')).toBe(2)
    expect(db.ci.countCiEvents(other.id, 'run.autopilot_infra_resume')).toBe(1)
    expect(db.ci.countCiEvents(run.id, 'run.started')).toBe(0)
  })

  it('лог рана отдаётся хвостом: полный лог длинного рана валил процесс', () => {
    const { p, task } = project()
    const run = db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: null, slotProgress: { done: 0, total: 1, phase: 'development' } })
    const step = db.ci.addCiRunStep({ runId: run.id, slot: null, position: 1, kind: 'command', initiatedBy: 'system', title: 'Шаг', status: 'running' })
    for (let i = 0; i < 30; i++) db.ci.appendCiLog(run.id, step.id, 'stdout', `строка-${i}\n`)

    // Хвост, а не начало: последние строки — то, ради чего лог и открывают.
    const tail = db.ci.getCiRunLog('alice', run.id, 10)
    expect(tail).toHaveLength(10)
    expect(tail[0]!.chunk).toBe('строка-20\n')
    expect(tail.at(-1)!.chunk).toBe('строка-29\n')
    // Порядок остаётся хронологическим, а не перевёрнутым.
    expect(tail.map((line) => line.seq)).toEqual([...tail.map((line) => line.seq)].sort((a, b) => a - b))
    // Мусорный лимит не отключает защиту.
    expect(db.ci.getCiRunLog('alice', run.id, 0).length).toBeGreaterThan(0)
    expect(db.ci.getCiRunLog('alice', run.id, -5).length).toBeGreaterThan(0)
  })

  it('считает подряд упавшие раны задачи и останавливается на первом успехе', () => {
    const { p, task } = project()
    const mk = (status: 'failed' | 'success' | 'timeout' | 'cancelled') => {
      const run = db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: null, slotProgress: { done: 0, total: 1, phase: 'development' } })
      db.ci.updateCiRun(run.id, { status })
      return run
    }
    expect(db.ci.countTrailingFailedCiRuns(task.id)).toBe(0)
    mk('failed')
    mk('failed')
    expect(db.ci.countTrailingFailedCiRuns(task.id)).toBe(2)
    // Успех обнуляет счётчик: считаем только хвост, а не всю историю.
    mk('success')
    expect(db.ci.countTrailingFailedCiRuns(task.id)).toBe(0)
    mk('timeout')
    expect(db.ci.countTrailingFailedCiRuns(task.id)).toBe(1)
  })

  it('объединяет пересекающиеся активные интервалы параллельных ранов', () => {
    const { p, task } = project()
    const first = db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: null, slotProgress: { done: 0, total: 1, phase: 'development' } })
    const second = db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: null, slotProgress: { done: 0, total: 1, phase: 'development' } })
    db.ci.updateCiRun(first.id, { status: 'success', startedAt: 100, finishedAt: 300 })
    db.ci.updateCiRun(second.id, { status: 'success', startedAt: 200, finishedAt: 400 })
    expect(db.tasks.taskTimeline('alice', p.id, task.id)!.summary.activeDuration).toBe(300)
  })
})
