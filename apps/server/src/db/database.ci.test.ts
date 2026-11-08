import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { TASK_COMMIT_COMMAND_SCRIPT, VoiceChatDb } from './database.js'
import { CI_KB_UPDATE_COMMAND_ID, DEFAULT_CI_STAGE_MODELS, DEFAULT_TOOL_OUTPUT_SETTINGS } from '@voicechat/shared'
// Сырой драйвер SQLite и файловые базы: на Postgres (VC_TEST_DB_URL) этих тестов нет — там нет ни файла, ни драйвера.
const ON_POSTGRES = Boolean(process.env.VC_TEST_DB_URL)

let db: VoiceChatDb

beforeEach(async () => {
  let id = 0
  let clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  await db.identity.createUser('alice', '', 'developer')
  await db.identity.createUser('bob', '', 'developer')
})
afterEach(() => db.close())

type Row = Record<string, unknown>
/** Kanban owns the CI command catalogue and slot configuration; tests seed and read the shared tables directly. */
function insertCommand(raw: Database.Database, id: string, name: string, script: string, isTest = 0): void {
  raw.prepare(`INSERT INTO ci_commands (id, scope, name, script, is_test, created_by, created_at, updated_at) VALUES (?, 'global', ?, ?, ?, 'alice', 1000, 1000)`).run(id, name, script, isTest)
}
const commandRow = (raw: Database.Database, id: string): Row | undefined => raw.prepare('SELECT * FROM ci_commands WHERE id = ?').get(id) as Row | undefined
const afterModel = (raw: Database.Database, projectId: string): string[] =>
  (raw.prepare(`SELECT command_id FROM ci_slot_commands WHERE owner_type = 'project' AND owner_id = ? AND slot = 'after_model' ORDER BY position`).all(projectId) as Array<{ command_id: string }>).map((row) => row.command_id)

async function project() {
  const p = await db.projects.createProject('alice', { name: 'P1' })
  const board = (await db.tasks.getBoard('alice', p.id))!
  const col = board.columns[0]
  const task = (await db.tasks.createTask('alice', p.id, { title: 'T1', columnId: col.id }))!
  return { p, col, task }
}

describe.skipIf(ON_POSTGRES)('ci: справочник команд', () => {

  it.skipIf(ON_POSTGRES)('база от прошлой версии: миграция помечает гейт и убирает его у модели', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-istest-'))
    const file = join(dir, 'db.sqlite')
    let n = 0
    const first = new VoiceChatDb(file, { newId: () => `t-${++n}`, now: () => 1000 })
    await first.ready
    await first.close()
    // Откатываем схему к состоянию до колонки: команда доступна модели, признака нет.
    const raw = new Database(file)
    insertCommand(raw, 'gate', 'Тесты', 'npm run -w @voicechat/server test', 1)
    insertCommand(raw, 'install', 'Установка', 'npm ci')
    raw.exec(`ALTER TABLE ci_commands DROP COLUMN is_test`)
    raw.exec(`UPDATE ci_commands SET available_to_model = 1`)
    await raw.close()
    const second = new VoiceChatDb(file, { newId: () => `t2-${++n}`, now: () => 2000 })

    await second.ready
    await second.close()
    const check = new Database(file)
    expect(commandRow(check, 'gate')).toMatchObject({ is_test: 1, available_to_model: 0 })
    expect(commandRow(check, 'install')).toMatchObject({ is_test: 0, available_to_model: 1 })
    check.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it.skipIf(ON_POSTGRES)('миграция переводит штатный гейт на affected-check и сохраняет его проверочным', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-affected-gate-'))
    const file = join(dir, 'db.sqlite')
    let n = 0
    const first = new VoiceChatDb(file, { newId: () => `a-${++n}`, now: () => 1000 })
    await first.ready
    await first.close()
    const raw = new Database(file)
    insertCommand(raw, 'gate', 'Запустить проверки (typecheck + npm test)', 'npm run typecheck && npm test', 1)
    raw.close()
    const second = new VoiceChatDb(file, { newId: () => `a-${++n}`, now: () => 2000 })

    await second.ready
    await second.close()
    const check = new Database(file)
    expect(commandRow(check, 'gate')).toMatchObject({
      script: 'npm run affected-check',
      is_test: 1,
      available_to_model: 1,
      version: 2
    })
    check.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe.skipIf(ON_POSTGRES)('ci: браузерная проверка задачи', () => {
  it('по умолчанию выключена и нормализуется при чтении', async () => {
    const { task } = await project()
    expect(await db.ci.getTaskBrowserCheck(task.id)).toEqual({ mode: 'off', devServerPort: 5173, startPath: '/', failurePolicy: 'continue' })
    ;(db as unknown as { db: Database.Database }).db
      .prepare('INSERT INTO ci_task_browser_checks (task_id, check_json) VALUES (?, ?)').run(task.id, JSON.stringify({ mode: 'chromium', devServerPort: 8799, startPath: 'board' }))
    expect(await db.ci.getTaskBrowserCheck(task.id)).toEqual({ mode: 'chromium', devServerPort: 8799, startPath: '/board', failurePolicy: 'continue' })
  })

  it('битая строка в БД не мешает запустить ран', async () => {
    const { task } = await project()
    ;(db as unknown as { db: Database.Database }).db
      .prepare('INSERT INTO ci_task_browser_checks (task_id, check_json) VALUES (?, ?)').run(task.id, '{не json')
    expect(await db.ci.getTaskBrowserCheck(task.id)).toEqual({ mode: 'off', devServerPort: 5173, startPath: '/', failurePolicy: 'continue' })
  })
})

describe('ci: движок и модель', () => {

  // Движок мог быть удалён админом уже после настройки CI. Ссылку мы намеренно
  // не стираем (её может «оживить» новый движок с тем же id при восстановлении
  // из бэкапа), но ран обязан пойти на доступном исполнителе, а не упасть.
  it('удалённый движок в конфигурации подменяется доступным, а не ломает ран', async () => {
    const engine = await db.llm.createLlmEngine({ name: 'Временный', kind: 'claude', baseUrl: 'http://runner:8790', token: '', enabled: true, allowedRoles: ['admin', 'developer'], isDefault: true })
    await db.ci.setCiLlmConfig('project', 'p-engine-gone', { provider: 'claude', model: 'sonnet', mode: 'development', clarifyLevel: 'few', clarifyMax: 3, llmEngineId: engine.id })
    await db.llm.deleteLlmEngine(engine.id)

    const resolved = await db.llm.resolveLlmEngine((await db.ci.getCiLlmConfig('project', 'p-engine-gone'))?.llmEngineId ?? null, 'claude', 'admin')

    expect(resolved.engine?.id).not.toBe(engine.id)
    expect(resolved.substituted).toBe(true)
  })
})

describe('ci: глобальные настройки', () => {
  it('возвращает дефолты', async () => {
    expect(await db.ci.getCiSettings()).toMatchObject({
      maxFixAttempts: 10,
      fixTimeLimitMs: 30 * 60 * 1000,
      fixTokenLimit: 600_000,
      defaultStepTimeoutSec: 1_800,
    })
  })
})

describe('ci: раны, шаги, лог, метрики', () => {
  it('создаёт ран и отдаёт сводку только участнику', async () => {
    const { p, col, task } = await project()
    const run = await db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: col.id, slotProgress: { done: 0, total: 2, phase: 'Подготовка' } })
    expect(run.status).toBe('queued')
    await db.ci.updateCiRun(run.id, { status: 'success', durationMs: 700 })
    expect((await db.ci.getCiRun('alice', run.id))!.run.status).toBe('success')
    // Сводка ранов по задаче.
    const summaries = await db.ci.latestCiRunSummaries(p.id)
    expect(summaries.find((s) => s.taskId === task.id)?.status).toBe('success')
    // Изоляция: bob не видит ран.
    expect(await db.ci.getCiRun('bob', run.id)).toBeNull()
  })

  it('success → cancelled сохраняет успех основным результатом и отмену отдельной попыткой', async () => {
    const { p, col, task } = await project()
    const success = await db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: col.id, runColumnId: col.id, slotProgress: { done: 1, total: 1, phase: 'Готово' } })
    await db.ci.updateCiRun(success.id, { status: 'success', terminalColumnId: col.id })
    const cancelled = await db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: col.id, runColumnId: col.id, slotProgress: { done: 0, total: 1, phase: 'Отменён' } })
    await db.ci.updateCiRun(cancelled.id, { status: 'cancelled', terminalColumnId: col.id })

    const summary = (await db.ci.latestCiRunSummary(task.id))!
    expect(summary.id).toBe(success.id)
    expect(summary.status).toBe('success')
    expect(summary.latestAttempt).toMatchObject({ id: cancelled.id, status: 'cancelled' })
  })

  it('отмена перестаёт быть актуальной после ручного переноса на другой этап', async () => {
    const { p, col, task } = await project()
    const cancelled = await db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: col.id, runColumnId: col.id, slotProgress: { done: 0, total: 1, phase: 'Отменён' } })
    await db.ci.updateCiRun(cancelled.id, { status: 'cancelled', terminalColumnId: col.id })
    expect((await db.ci.latestCiRunSummary(task.id))?.status).toBe('cancelled')
    const other = (await db.projects.createColumn('alice', p.id, 'Другой этап'))!
    await db.tasks.moveTask('alice', p.id, task.id, { columnId: other.id })
    expect(await db.ci.latestCiRunSummary(task.id)).toBeNull()
  })
})

describe('последний актуальный результат задачи', () => {
  it('не создаёт ложную ошибку без запусков и отдаёт признак в снапшоте доски', async () => {
    const { p, task } = await project()
    expect(await db.tasks.latestTaskRunResult(task.id)).toBeNull()
    expect((await db.tasks.getBoard('alice', p.id))!.tasks.find((item) => item.id === task.id)?.latestRunResult).toBeNull()
  })

  it('новый ран сразу вытесняет старую ошибку, а новый терминальный итог возвращает её при повторном падении', async () => {
    const { p, col, task } = await project()
    const failed = await db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: col.id, runColumnId: col.id, slotProgress: { done: 1, total: 2, phase: 'Ошибка' } })
    await db.ci.updateCiRun(failed.id, { status: 'failed', finishedAt: 2000 })
    expect(await db.tasks.latestTaskRunResult(task.id)).toMatchObject({ id: failed.id, outcome: 'failure' })

    const retry = await db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: col.id, runColumnId: col.id, slotProgress: { done: 0, total: 2, phase: 'Очередь' } })
    expect(await db.tasks.latestTaskRunResult(task.id)).toMatchObject({ id: retry.id, outcome: 'active', status: 'queued' })
    await db.ci.updateCiRun(retry.id, { status: 'success', finishedAt: 3000 })
    expect(await db.tasks.latestTaskRunResult(task.id)).toMatchObject({ id: retry.id, outcome: 'success' })

    const failedAgain = await db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: col.id, runColumnId: col.id, slotProgress: { done: 1, total: 2, phase: 'Ошибка' } })
    await db.ci.updateCiRun(failedAgain.id, { status: 'timeout', finishedAt: 4000 })
    expect(await db.tasks.latestTaskRunResult(task.id)).toMatchObject({ id: failedAgain.id, outcome: 'failure', status: 'timeout' })
  })

  it('cancelled не является ошибкой', async () => {
    const { p, col, task } = await project()
    const run = await db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: col.id, runColumnId: col.id, slotProgress: { done: 0, total: 1, phase: 'Отменён' } })
    await db.ci.updateCiRun(run.id, { status: 'cancelled', finishedAt: 2000 })
    expect(await db.tasks.latestTaskRunResult(task.id)).toMatchObject({ outcome: 'cancelled' })
  })
})

describe('ci: рабочие директории', () => {
  it('workspace: активна; отчёт помечает осиротевшие', async () => {
    const { p, task } = await project()
    const ws = await db.ci.createCiWorkspace({ projectId: p.id, taskId: task.id, agentId: null, path: '/repos/p/1' })
    expect((await db.ci.findActiveCiWorkspace(p.id, task.id))?.id).toBe(ws.id)
    const report = await db.ci.listCiWorkspaceReport('alice', p.id)
    expect(report[0].orphaned).toBe(false) // задача в бэклоге, не done
  })
})

// В `:memory:` таблицы создаёт SCHEMA_SQL уже с новыми колонками, поэтому ветка
// ALTER TABLE в migrate() там не исполняется вовсе. Прод-БД идёт именно по ней —
// проверяем на файловой БД со «старой» схемой.
describe.skipIf(ON_POSTGRES)('VoiceChatDb — миграция существующей БД под режим запуска и паузы', () => {
  it.skipIf(ON_POSTGRES)('добавляет колонки режима/уточнений в ci_llm_configs, ci_runs и ci_settings', async () => {
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
    await raw.close()
    const migrated = new VoiceChatDb(file)

    await migrated.ready
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
    expect(await migrated.ci.getCiSettings()).toMatchObject(DEFAULT_TOOL_OUTPUT_SETTINGS)
    // Таблица пауз появляется как новая (CREATE TABLE IF NOT EXISTS).
    expect(await migrated.ci.listCiInteractions('run-old')).toEqual([])

    // Старые строки получают осмысленные значения по умолчанию, а не NULL.
    expect(await migrated.ci.getCiLlmConfig('project', 'p-old')).toEqual({
      provider: 'codex', model: 'gpt-5.4', mode: 'development', clarifyLevel: 'few', clarifyMax: 3
    })
    const run = (await migrated.ci.getCiRunRaw('run-old'))!
    expect(run.mode).toBe('development')
    expect(run.clarifyLevel).toBe('few')
    expect(run.clarifyMax).toBe(3)
    expect(run.conversationId).toBeNull()
    expect((await migrated.ci.getCiSettings()).interactionWaitMs).toBe(30 * 60 * 1000)
    // Настройки, заведённые до модели по стадии: колонка пуста и читается как
    // дефолт кода — обновление само переводит вспомогательные стадии на дешёвую
    // модель, иначе экономия включалась бы только руками.
    expect((await migrated.ci.getCiSettings()).stageModels).toEqual(DEFAULT_CI_STAGE_MODELS)

    await migrated.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ci: метки чатов задач для списка бесед', () => {
  it('отдаёт ключ, тип и колонку; ран — только по запросу; чужие чаты не выдаёт', async () => {
    const { p, col, task } = await project()
    const chat = (await db.chat.openOrCreateTaskChat('alice', p.id, task.id))!
    // Обычный чат без задачи метки не получает.
    await db.chat.createConversation('alice', 'Просто разговор')

    const before = await db.tasks.taskChatBadges('alice')
    expect(before).toHaveLength(1)
    expect(before[0]).toMatchObject({ conversationId: chat.id, taskId: task.id, projectId: p.id, key: 'P1-1', type: 'task', columnSemantic: 'backlog' })
    // Сводка рана стоит пяти запросов на задачу и списку чатов не нужна —
    // по умолчанию поля нет вовсе.
    expect(before[0]).not.toHaveProperty('run')

    const run = await db.ci.createCiRun({ projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: col.id, slotProgress: { done: 1, total: 3, phase: 'Модель работает' } })
    await db.ci.updateCiRun(run.id, { status: 'awaiting_input' })
    expect((await db.tasks.taskChatBadges('alice'))[0]).not.toHaveProperty('run')

    // Кто просит состояние явно — получает ту же сводку, что подсвечивает карточку.
    const after = (await db.tasks.taskChatBadges('alice', { withRuns: true }))[0]
    expect(after.run).toMatchObject({ id: run.id, taskId: task.id, status: 'awaiting_input', awaitingInput: true })
    expect(after.run?.slotProgress.phase).toBe('Модель работает')

    // Семантика колонки обновляется вместе с ручным завершением задачи.
    const done = (await db.tasks.getBoard('alice', p.id))!.columns.find((c) => c.semanticType === 'done')!
    await db.tasks.moveTask('alice', p.id, task.id, { columnId: done.id })
    expect((await db.tasks.taskChatBadges('alice'))[0].columnSemantic).toBe('done')

    // Метки — свои: bob чужой чат задачи не видит.
    expect(await db.tasks.taskChatBadges('bob')).toEqual([])
  })
})

describe.skipIf(ON_POSTGRES)('встроенный шаг «Актуализировать базу знаний»', () => {
  it('заводится в справочнике как серверный шаг, недоступный модели', async () => {
    const cmd = commandRow((db as unknown as { db: Database.Database }).db, CI_KB_UPDATE_COMMAND_ID)!
    expect(cmd).toMatchObject({ builtin: 'kb_update', scope: 'global', available_to_model: 0, allow_failure: 0 })
  })

  it.skipIf(ON_POSTGRES)('остаётся в справочнике, но миграция удаляет интеграционные команды из after_model', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-kb-seed-'))
    const file = join(dir, 'db.sqlite')
    let n = 0
    const first = new VoiceChatDb(file, { newId: () => `s-${++n}`, now: () => 1000 })
    await first.ready
    await first.identity.createUser('alice', '', 'developer')
    const p = await first.projects.createProject('alice', { name: 'P' })
    await first.close()
    // Состояние «база от прошлой версии»: строки встроенного шага ещё нет.
    const raw = new Database(file)
    insertCommand(raw, 'test', 'Запустить тестирование (npm test)', 'npm test', 1)
    insertCommand(raw, 'commit', 'Закоммитить работу в ветку задачи', 'git add -A')
    insertCommand(raw, 'merge', 'Влить ветку задачи в прод-ветку', 'git merge --no-edit')
    const slot = raw.prepare(`INSERT INTO ci_slot_commands (id, owner_type, owner_id, slot, command_id, position) VALUES (?, 'project', ?, 'after_model', ?, ?)`)
    ;['test', 'commit', 'merge'].forEach((id, position) => slot.run(`slot-${id}`, p.id, id, position))
    raw.exec(`DELETE FROM ci_slot_commands WHERE command_id = '${CI_KB_UPDATE_COMMAND_ID}'`)
    raw.exec(`DELETE FROM ci_commands WHERE id = '${CI_KB_UPDATE_COMMAND_ID}'`)
    await raw.close()
    const second = new VoiceChatDb(file, { newId: () => `s2-${++n}`, now: () => 2000 })

    await second.ready
    await second.close()
    const check = new Database(file)
    expect(afterModel(check, p.id)).toEqual(['commit'])
    expect(commandRow(check, 'commit')).toMatchObject({ script: TASK_COMMIT_COMMAND_SCRIPT, version: 2 })
    expect(commandRow(check, CI_KB_UPDATE_COMMAND_ID)).toBeTruthy()
    // Повторное открытие ничего не возвращает в development pipeline.
    check.prepare(`INSERT INTO ci_slot_commands (id, owner_type, owner_id, slot, command_id, position) VALUES ('slot-test-2', 'project', ?, 'after_model', 'test', 0)`).run(p.id)
    check.close()
    const third = new VoiceChatDb(file, { newId: () => `s3-${++n}`, now: () => 3000 })
    await third.ready
    await third.close()
    const again = new Database(file)
    expect(afterModel(again, p.id)).toEqual(['commit'])
    expect(commandRow(again, 'commit')).toMatchObject({ script: TASK_COMMIT_COMMAND_SCRIPT, version: 2 })
    again.close()
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
describe.skipIf(ON_POSTGRES)('ci: расход модели и семантика входных токенов', () => {
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

  async function run() {
    const { p, task } = await project()
    return await db.ci.createCiRun({
      projectId: p.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: null,
      llmProvider: 'codex', llmModel: 'gpt-5.4', slotProgress: { done: 0, total: 1, phase: '' }
    })
  }

  it('новая строка помечена приведённой, старая строка codex — «вход с кэшем»', async () => {
    const r = await run()
    ;(db as unknown as { db: Database.Database }).db.prepare(
      `INSERT INTO ci_run_usage (id, run_id, step_id, kind, provider, model, input_tokens, cache_read_tokens, input_semantics, at) VALUES ('fresh', ?, NULL, 'model_work', 'codex', 'gpt-5.4', 200000, 800000, 'no_cache', 2)`
    ).run(r.id)
    const fresh = { id: 'fresh' }
    const oldId = legacy(r.id, 'codex')
    // Ищем по id, а не по позиции: у подложенной старой строки своё `at`.
    const rows = await db.ci.listCiRunUsage(r.id)
    expect(rows.find((x) => x.id === fresh.id)!.inputSemantics).toBe('no_cache')
    expect(rows.find((x) => x.id === oldId)!.inputSemantics).toBe('with_cache')
  })

  it('старая строка claude остаётся «без кэша»: у него вход и раньше был чистым', async () => {
    const r = await run()
    legacy(r.id, 'claude')
    expect((await db.ci.listCiRunUsage(r.id))[0].inputSemantics).toBe('no_cache')
  })
})
