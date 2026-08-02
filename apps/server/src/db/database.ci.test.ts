import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROD_REBUILD_TASK_TITLE, VoiceChatDb } from './database.js'
import { CI_KB_UPDATE_COMMAND_ID } from '@voicechat/shared'

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
    // Страница справочника без projectId показывает команды всех доступных проектов.
    expect(db.listCiCommands('alice').map((x) => x.name)).toContain('clone')
    // bob не участник — проектную команду не видит ни с фильтром, ни в общем
    // списке (глобальные команды справочника, включая встроенный шаг базы
    // знаний, видны всем — это не проектные данные).
    expect(db.listCiCommands('bob', p.id).every((c) => c.scope === 'global')).toBe(true)
    expect(db.listCiCommands('bob').map((x) => x.name)).not.toContain('clone')
  })

  it('гейт помечается is_test при создании, npm ci — нет', () => {
    const { p } = project()
    const gate = db.createCiCommand('alice', { scope: 'project', projectId: p.id, name: 'Запустить тестирование (npm test)', script: 'npm test' })
    expect(gate.isTest).toBe(true)
    const install = db.createCiCommand('alice', { scope: 'project', projectId: p.id, name: 'Установить зависимости', script: 'npm ci' })
    expect(install.isTest).toBe(false)
    // Флаг можно проставить руками — команде, которую по тексту не узнать.
    expect(db.updateCiCommand('alice', install.id, { isTest: true })!.isTest).toBe(true)
  })

  it('база от прошлой версии: миграция помечает гейт и убирает его у модели', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-istest-'))
    const file = join(dir, 'db.sqlite')
    let n = 0
    const first = new VoiceChatDb(file, { newId: () => `t-${++n}`, now: () => 1000 })
    first.createUser('alice', '', 'user')
    const gate = first.createCiCommand('alice', { scope: 'global', name: 'Тесты', script: 'npm run -w @voicechat/server test' })
    const install = first.createCiCommand('alice', { scope: 'global', name: 'Установка', script: 'npm ci' })
    first.close()

    // Откатываем схему к состоянию до колонки: команда доступна модели, признака нет.
    const raw = new Database(file)
    raw.exec(`ALTER TABLE ci_commands DROP COLUMN is_test`)
    raw.exec(`UPDATE ci_commands SET available_to_model = 1`)
    raw.close()

    const second = new VoiceChatDb(file, { newId: () => `t2-${++n}`, now: () => 2000 })
    expect(second.getCiCommand('alice', gate.id)).toMatchObject({ isTest: true, availableToModel: false })
    expect(second.getCiCommand('alice', install.id)).toMatchObject({ isTest: false, availableToModel: true })
    second.close()
    rmSync(dir, { recursive: true, force: true })
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

describe('ci: движок и модель', () => {
  it('задача наследует настройку проекта и может переопределить её', () => {
    const { p, task } = project()
    expect(db.resolveTaskLlmConfig(p.id, task.id)).toEqual({ provider: 'claude', model: 'opus', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    db.setCiLlmConfig('project', p.id, { provider: 'codex', model: 'gpt-5.4', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    expect(db.resolveTaskLlmConfig(p.id, task.id)).toEqual({ provider: 'codex', model: 'gpt-5.4', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    db.setCiLlmConfig('task', task.id, { provider: 'claude', model: 'haiku', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    expect(db.resolveTaskLlmConfig(p.id, task.id)).toEqual({ provider: 'claude', model: 'haiku', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
  })

  it('снятие переопределения возвращает наследование от проекта', () => {
    const { p, task } = project()
    db.setCiLlmConfig('project', p.id, { provider: 'codex', model: 'gpt-5.4', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    db.setCiLlmConfig('task', task.id, { provider: 'claude', model: 'haiku', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    expect(db.clearCiLlmConfig('task', task.id)).toBe(true)
    expect(db.getCiLlmConfig('task', task.id)).toBeNull()
    expect(db.resolveTaskLlmConfig(p.id, task.id)).toEqual({ provider: 'codex', model: 'gpt-5.4', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
    // повторный сброс — идемпотентен, настройка проекта не задета
    expect(db.clearCiLlmConfig('task', task.id)).toBe(false)
    expect(db.getCiLlmConfig('project', p.id)).toEqual({ provider: 'codex', model: 'gpt-5.4', mode: 'development', clarifyLevel: 'few', clarifyMax: 3 })
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
    // Таблица пауз появляется как новая (CREATE TABLE IF NOT EXISTS).
    expect(migrated.listCiInteractions('run-old')).toEqual([])

    // Старые строки получают осмысленные значения по умолчанию, а не NULL.
    expect(migrated.getCiLlmConfig('project', 'p-old')).toEqual({
      provider: 'codex', model: 'gpt-5.4', mode: 'development', clarifyLevel: 'few', clarifyMax: 3
    })
    const run = migrated.getCiRunRaw('run-old')!
    expect(run.mode).toBe('development')
    expect(run.clarifyLevel).toBe('few')
    expect(run.clarifyMax).toBe(3)
    expect(run.conversationId).toBeNull()
    expect(migrated.getCiSettings().interactionWaitMs).toBe(30 * 60 * 1000)

    migrated.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ci: раны, прерванные рестартом сервера', () => {
  it('закрывает активные раны и их шаги, снимает ожидание ответа', () => {
    const { p, task } = project()
    const run = db.createCiRun({
      projectId: p.id,
      taskId: task.id,
      agentId: null,
      triggeredBy: 'alice',
      prevColumnId: null,
      slotProgress: { done: 0, total: 3, phase: 'Старт' }
    })
    db.updateCiRun(run.id, { status: 'running', startedAt: 1000 })
    const done = db.addCiRunStep({ runId: run.id, slot: 'before_model', position: 0, kind: 'command', title: 'клон', status: 'success' })
    const stuck = db.addCiRunStep({ runId: run.id, slot: null, position: 1, kind: 'model_work', title: 'Работа модели', status: 'running' })
    const later = db.addCiRunStep({ runId: run.id, slot: 'after_model', position: 2, kind: 'command', title: 'тесты', status: 'queued' })
    const it0 = db.addCiInteraction({ runId: run.id, stepId: stuck.id, kind: 'clarify', questions: [{ q: 'а?', options: ['да'], multi: false }] })

    const closed = db.failInterruptedCiRuns()
    expect(closed.map((r) => r.id)).toEqual([run.id])
    expect(db.getCiRunRaw(run.id)?.status).toBe('failed')
    expect(db.getCiRunRaw(run.id)?.finishedAt).not.toBeNull()

    const steps = db.getCiRun('alice', run.id)!.steps
    const byId = (id: string) => steps.find((s) => s.id === id)!.status
    expect(byId(done.id)).toBe('success')
    expect(byId(stuck.id)).toBe('failed')
    expect(byId(later.id)).toBe('skipped')
    expect(db.getCiInteraction(it0.id)?.status).toBe('cancelled')

    // Повторный вызов ничего не находит: закрытые раны уже терминальны.
    expect(db.failInterruptedCiRuns()).toHaveLength(0)
  })
})

describe('ci: метки чатов задач для списка бесед', () => {
  it('отдаёт ключ, тип и последний ран по чату задачи; чужие чаты не выдаёт', () => {
    const { p, col, task } = project()
    const chat = db.openOrCreateTaskChat('alice', p.id, task.id)!
    // Обычный чат без задачи метки не получает.
    db.createConversation('alice', 'Просто разговор')

    const before = db.taskChatBadges('alice')
    expect(before).toHaveLength(1)
    expect(before[0]).toMatchObject({ conversationId: chat.id, taskId: task.id, projectId: p.id, key: 'P1-1', type: 'task', run: null })

    // Появился ран — в метке живёт та же сводка, что подсвечивает карточку.
    const run = db.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: col.id, slotProgress: { done: 1, total: 3, phase: 'Модель работает' } })
    db.updateCiRun(run.id, { status: 'awaiting_input' })
    const after = db.taskChatBadges('alice')[0]
    expect(after.run).toMatchObject({ id: run.id, taskId: task.id, status: 'awaiting_input', awaitingInput: true })
    expect(after.run?.slotProgress.phase).toBe('Модель работает')

    // Метки — свои: bob чужой чат задачи не видит.
    expect(db.taskChatBadges('bob')).toEqual([])
  })
})

describe('ci: автозадача «Пересборка прода»', () => {
  it('заводит одну открытую карточку в ready и копит строки без дублей', () => {
    const { p } = project()
    const ready = db.getBoard('alice', p.id)!.columns.find((c) => c.semanticType === 'ready')!

    const first = db.ensureProdRebuildTask('alice', p.id, '- P1-1: T1')!
    expect(first.created).toBe(true)
    expect(first.task.title).toBe(PROD_REBUILD_TASK_TITLE)
    expect(first.task.columnId).toBe(ready.id)
    expect(first.task.type).toBe('task')
    expect(first.task.assignee).toBe(null)

    // Вторая задача — та же карточка, новая строка.
    const second = db.ensureProdRebuildTask('alice', p.id, '- P1-2: T2')!
    expect(second.created).toBe(false)
    expect(second.appended).toBe(true)
    expect(second.task.id).toBe(first.task.id)

    // Та же строка второй раз — ничего не меняется.
    const again = db.ensureProdRebuildTask('alice', p.id, '- P1-2: T2')!
    expect(again.appended).toBe(false)
    expect(again.task.description.split('\n').filter((l) => l.startsWith('- '))).toEqual(['- P1-1: T1', '- P1-2: T2'])
    expect(db.getBoard('alice', p.id)!.tasks.filter((t) => t.title === PROD_REBUILD_TASK_TITLE).length).toBe(1)
  })

  it('карточка в done не переиспользуется — заводится новая', () => {
    const { p } = project()
    const done = db.getBoard('alice', p.id)!.columns.find((c) => c.semanticType === 'done')!
    const first = db.ensureProdRebuildTask('alice', p.id, '- P1-1: T1')!
    db.moveTask('alice', p.id, first.task.id, { columnId: done.id })

    const next = db.ensureProdRebuildTask('alice', p.id, '- P1-2: T2')!
    expect(next.created).toBe(true)
    expect(next.task.id).not.toBe(first.task.id)
    expect(next.task.description).not.toContain('T1')
    // Закрытую карточку не трогаем.
    expect(db.getBoard('alice', p.id)!.tasks.find((t) => t.id === first.task.id)!.description).not.toContain('T2')
  })

  it('нет колонки ready — карточку не заводим; чужой проект недоступен', () => {
    const { p } = project()
    const spy = vi.spyOn(db, 'getColumnIdBySemantic').mockReturnValue(null)
    expect(db.ensureProdRebuildTask('alice', p.id, '- P1-1: T1')).toBe(null)
    spy.mockRestore()
    // Не участник проекта карточку не заводит.
    expect(db.ensureProdRebuildTask('bob', p.id, '- P1-1: T1')).toBe(null)
    expect(db.getBoard('alice', p.id)!.tasks.some((t) => t.title === PROD_REBUILD_TASK_TITLE)).toBe(false)
  })
})

describe('встроенный шаг «Актуализировать базу знаний»', () => {
  it('заводится в справочнике как серверный шаг, недоступный модели', () => {
    const cmd = db.getCiCommand('alice', CI_KB_UPDATE_COMMAND_ID)!
    expect(cmd.builtin).toBe('kb_update')
    expect(cmd.scope).toBe('global')
    expect(cmd.availableToModel).toBe(false)
    // Виден всем как глобальная команда справочника.
    expect(db.listCiCommands('bob').some((c) => c.id === CI_KB_UPDATE_COMMAND_ID)).toBe(true)
  })

  it('при первом появлении встаёт в слот «после модели» проектов — перед шагом коммита', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-kb-seed-'))
    const file = join(dir, 'db.sqlite')
    let n = 0
    const first = new VoiceChatDb(file, { newId: () => `s-${++n}`, now: () => 1000 })
    first.createUser('alice', '', 'user')
    const p = first.createProject('alice', { name: 'P' })
    const test = first.createCiCommand('alice', { scope: 'global', name: 'Запустить тестирование (npm test)', script: 'npm test' })
    const commit = first.createCiCommand('alice', { scope: 'global', name: 'Закоммитить работу в ветку задачи', script: 'git add -A' })
    const merge = first.createCiCommand('alice', { scope: 'global', name: 'Влить ветку задачи в прод-ветку', script: 'git merge --no-edit' })
    first.setCiSlotCommands('project', p.id, 'after_model', [test.id, commit.id, merge.id])
    first.close()

    // Состояние «база от прошлой версии»: строки встроенного шага ещё нет.
    const raw = new Database(file)
    raw.exec(`DELETE FROM ci_slot_commands WHERE command_id = '${CI_KB_UPDATE_COMMAND_ID}'`)
    raw.exec(`DELETE FROM ci_commands WHERE id = '${CI_KB_UPDATE_COMMAND_ID}'`)
    raw.close()

    const second = new VoiceChatDb(file, { newId: () => `s2-${++n}`, now: () => 2000 })
    expect(second.getCiSlotConfig('project', p.id).afterModel).toEqual([test.id, CI_KB_UPDATE_COMMAND_ID, commit.id, merge.id])
    // Повторное открытие ничего не дублирует и убранный руками шаг не возвращает.
    second.setCiSlotCommands('project', p.id, 'after_model', [test.id, commit.id])
    second.close()
    const third = new VoiceChatDb(file, { newId: () => `s3-${++n}`, now: () => 3000 })
    expect(third.getCiSlotConfig('project', p.id).afterModel).toEqual([test.id, commit.id])
    third.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
