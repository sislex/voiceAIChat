import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { VoiceChatDb } from './database.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, taskReworkContext } from '@voicechat/shared'
import { releaseCiTarget, releaseMachineCatalog } from '../releases/targets.js'
// Сырой драйвер SQLite и файловые базы: на Postgres (VC_TEST_DB_URL) этих тестов нет — там нет ни файла, ни драйвера.
const ON_POSTGRES = Boolean(process.env.VC_TEST_DB_URL)

let db: VoiceChatDb

beforeEach(async () => {
  let id = 0
  let clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  await db.identity.createUser('alice', '', 'developer')
  await db.identity.createUser('bob', '', 'developer')
  await db.identity.createUser('carol', '', 'developer')
})

afterEach(() => db.close())

describe('контекст повторной подготовки', () => {
  // @testCase TC-INT-1
  it('детерминированно содержит исходную постановку, все циклы, Make и missing-вложения', () => {
    const attachment = { id: 'a', taskId: 't', scope: 'source' as const, name: 'brief.pdf', size: 1, mimeType: 'application/pdf', checksum: 'x', status: 'ready' as const, createdBy: 'alice', createdAt: 1 }
    const text = taskReworkContext({ description: 'ORIGINAL', acceptanceCriteria: 'ORIGINAL-AC' }, [{
      id: 'c2', taskId: 't', sequence: 2, description: 'SECOND', criteria: ['SECOND-AC'], makeSources: [], attachments: [{ ...attachment, id: 'missing', name: 'gone.png', scope: 'rework_cycle', status: 'missing' }], createdBy: 'alice', createdAt: 3, preparationRunId: null, status: 'submitted'
    }, {
      id: 'c1', taskId: 't', sequence: 1, description: 'FIRST', criteria: ['FIRST-AC'], makeSources: [{ conversationId: 'make', title: 'Design', owner: 'alice', mode: 'files', paths: ['b.ts', 'a.ts'] }], attachments: [], createdBy: 'alice', createdAt: 2, preparationRunId: null, status: 'submitted'
    }], [attachment])
    expect(text.indexOf('ORIGINAL')).toBeLessThan(text.indexOf('FIRST'))
    expect(text.indexOf('FIRST')).toBeLessThan(text.indexOf('SECOND'))
    expect(text).toContain('a.ts, b.ts')
    expect(text).toContain('gone.png [missing]')
  })
})

describe('projects: миграция имён связанных чатов', () => {
  it.skipIf(ON_POSTGRES)('старый чат задачи получает префикс «Задача », переименованный вручную — нет', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-taskchat-'))
    const file = join(dir, 'db.sqlite')
    const first = new VoiceChatDb(file)
    await first.ready
    await first.identity.createUser('alice', '', 'developer')
    const p = await first.projects.createProject('alice', { name: 'P' })
    const col = (await first.tasks.getBoard('alice', p.id))!.columns[0]
    const t1 = (await first.tasks.createTask('alice', p.id, { columnId: col.id, title: 'Скролл' }))!
    const t2 = (await first.tasks.createTask('alice', p.id, { columnId: col.id, title: 'Пагинация' }))!
    const old1 = (await first.chat.openOrCreateTaskChat('alice', p.id, t1.id))!
    const old2 = (await first.chat.openOrCreateTaskChat('alice', p.id, t2.id))!
    // Имитируем чаты, созданные до префикса: имя = заголовок задачи.
    await first.chat.renameConversation('alice', old1.id, 'Скролл')
    await first.chat.renameConversation('alice', old2.id, 'Мои заметки по пагинации')
    await first.close()
    const migrated = new VoiceChatDb(file)

    await migrated.ready
    expect((await migrated.chat.getConversation('alice', old1.id))!.title).toBe('Задача Скролл')
    // Пользовательское имя не трогаем.
    expect((await migrated.chat.getConversation('alice', old2.id))!.title).toBe('Мои заметки по пагинации')
    await migrated.close()
    // Повторный старт не наращивает префикс.
    const again = new VoiceChatDb(file)
    await again.ready
    expect((await again.chat.getConversation('alice', old1.id))!.title).toBe('Задача Скролл')
    await again.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('projects: миграция владельцев', () => {
  it.skipIf(ON_POSTGRES)('добавляет created_by владельцем старого проекта и сохраняет остальных участников', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-project-owner-'))
    const file = join(dir, 'db.sqlite')
    const first = new VoiceChatDb(file)
    await first.ready
    await first.identity.createUser('alice', '', 'developer')
    await first.identity.createUser('bob', '', 'developer')
    const project = await first.projects.createProject('alice', { name: 'Legacy' })
    await first.projects.addMember('alice', project.id, 'bob')
    await first.close()
    const raw = new Database(file)
    raw.prepare(`DELETE FROM project_members WHERE project_id = ? AND username = 'alice'`).run(project.id)
    await raw.close()
    const migrated = new VoiceChatDb(file)

    await migrated.ready
    expect((await migrated.projects.getProject('alice', project.id))!.members).toEqual([
      expect.objectContaining({ username: 'alice', role: 'owner' }),
      expect.objectContaining({ username: 'bob', role: 'member' })
    ])
    await migrated.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('projects: миграция канонического workflow', () => {
  it.skipIf(ON_POSTGRES)('досоздаёт недостающие системные колонки на существующей БД (инцидент 2026-08-18)', async () => {
    // Регрессия: миграция вызывала this.newId() до его присвоения в конструкторе
    // и роняла сервер при старте на любой БД, где проекту не хватало колонки.
    const dir = mkdtempSync(join(tmpdir(), 'vc-kanban-missing-col-'))
    const file = join(dir, 'db.sqlite')
    const first = new VoiceChatDb(file)
    await first.ready
    await first.identity.createUser('alice', '', 'developer')
    const project = await first.projects.createProject('alice', { name: 'Старый проект' })
    await first.close()
    const raw = new Database(file)
    raw.prepare(`DELETE FROM kanban_columns WHERE project_id=? AND semantic_type='decision_required'`).run(project.id)
    await raw.close()
    const migrated = new VoiceChatDb(file)

    await migrated.ready
    const board = (await migrated.tasks.getBoard('alice', project.id))!
    expect(board.columns.some((item) => item.semanticType === 'decision_required')).toBe(true)
    await migrated.close()
  })

  it.skipIf(ON_POSTGRES)('назначает cancelled существующей колонке по семантике, а имя использует только без неё', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-kanban-cancelled-'))
    const file = join(dir, 'db.sqlite')
    const first = new VoiceChatDb(file)
    await first.ready
    await first.identity.createUser('alice', '', 'developer')
    const project = await first.projects.createProject('alice', { name: 'Legacy cancelled' })
    const board = (await first.tasks.getBoard('alice', project.id))!
    const canonical = board.columns.find((item) => item.semanticType === 'cancelled')!
    const legacy = (await first.projects.createColumn('alice', project.id, 'Отменены'))!
    const taskA = (await first.tasks.createTask('alice', project.id, { columnId: legacy.id, title: 'Первая' }))!
    const taskB = (await first.tasks.createTask('alice', project.id, { columnId: legacy.id, title: 'Вторая' }))!
    await first.close()
    const raw = new Database(file)
    raw.prepare(`DELETE FROM kanban_columns WHERE id=?`).run(canonical.id)
    await raw.close()
    const migrated = new VoiceChatDb(file)

    await migrated.ready
    const migratedBoard = (await migrated.tasks.getBoard('alice', project.id))!
    const cancelled = migratedBoard.columns.find((item) => item.semanticType === 'cancelled')!
    expect(cancelled.id).toBe(legacy.id)
    expect(migratedBoard.tasks.filter((item) => item.columnId === legacy.id).map(({ id, position }) => ({ id, position })))
      .toEqual([{ id: taskA.id, position: taskA.position }, { id: taskB.id, position: taskB.position }])
    await migrated.close()
    const again = new VoiceChatDb(file)

    await again.ready
    expect((await again.tasks.getBoard('alice', project.id))!.columns.filter((item) => item.semanticType === 'cancelled').map((item) => item.id))
      .toEqual([legacy.id])
    await again.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it.skipIf(ON_POSTGRES)('переупорядочивает старую доску, переносит legacy-карточки и повторно ничего не меняет', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-kanban-workflow-'))
    const file = join(dir, 'db.sqlite')
    const first = new VoiceChatDb(file)
    await first.ready
    await first.identity.createUser('alice', '', 'developer')
    const project = await first.projects.createProject('alice', { name: 'Legacy workflow' })
    const initial = (await first.tasks.getBoard('alice', project.id))!
    const column = (semantic: string) => initial.columns.find((item) => item.semanticType === semantic)!
    const testing = (await first.projects.createColumn('alice', project.id, 'Старое тестирование'))!
    const preparation = (await first.projects.createColumn('alice', project.id, 'Старые сценарии'))!
    const readyDuplicate = (await first.projects.createColumn('alice', project.id, 'Дубликат Ready'))!
    const custom = (await first.projects.createColumn('alice', project.id, 'Пользовательская'))!
    await first.projects.setColumnHidden('alice', project.id, custom.id, true)
    await first.tasks.createTask('alice', project.id, { columnId: column('automated_qa').id, title: 'Уже Automated' })
    await first.tasks.createTask('alice', project.id, { columnId: testing.id, title: 'Из Testing' })
    await first.tasks.createTask('alice', project.id, { columnId: column('component_qa').id, title: 'Уже Component' })
    await first.tasks.createTask('alice', project.id, { columnId: preparation.id, title: 'Из QA Preparation' })
    await first.tasks.createTask('alice', project.id, { columnId: readyDuplicate.id, title: 'Из дубля Ready' })
    await first.close()
    const raw = new Database(file)
    raw.prepare(`UPDATE kanban_columns SET semantic_type='testing' WHERE id=?`).run(testing.id)
    raw.prepare(`UPDATE kanban_columns SET semantic_type='qa_preparation' WHERE id=?`).run(preparation.id)
    raw.prepare(`UPDATE kanban_columns SET semantic_type='ready' WHERE id=?`).run(readyDuplicate.id)
    raw.prepare(`UPDATE kanban_columns SET position=-position WHERE project_id=?`).run(project.id)
    raw.prepare(`UPDATE kanban_columns SET name='Мой Ready', hidden=1, position=-999999 WHERE id=?`).run(column('ready').id)
    await raw.close()
    const migrated = new VoiceChatDb(file)

    await migrated.ready
    const board = (await migrated.tasks.getBoard('alice', project.id))!
    expect(board.columns.map((item) => item.semanticType)).toEqual([
      'backlog', 'preparation', 'ready', 'development', 'component_qa',
      'integration_tests', 'automated_qa', 'manual_qa', 'awaiting_merge',
      'merge', 'done', 'cancelled', 'decision_required', 'custom'
    ])
    // Имя и скрытие — пользовательские настройки, канонизация правит только порядок
    // и семантику. Раньше системной колонке сбрасывался hidden, а своей — нет; эта
    // асимметрия возвращала скрытую колонку на доску при каждом старте сервера.
    expect(board.columns.find((item) => item.id === column('ready').id)).toMatchObject({ name: 'Мой Ready', hidden: true })
    expect(board.columns.find((item) => item.id === custom.id)).toMatchObject({ hidden: true })
    expect(board.columns.some((item) => item.id === readyDuplicate.id)).toBe(false)
    expect(board.columns.some((item) => item.semanticType === 'testing' || item.semanticType === 'qa_preparation')).toBe(false)
    const titles = (semantic: string) => {
      const id = board.columns.find((item) => item.semanticType === semantic)!.id
      return board.tasks.filter((item) => item.columnId === id).map((item) => item.title)
    }
    expect(titles('automated_qa')).toEqual(['Уже Automated', 'Из Testing'])
    expect(titles('component_qa')).toEqual(['Уже Component', 'Из QA Preparation'])
    expect(titles('ready')).toEqual(['Из дубля Ready'])
    const snapshot = {
      columns: board.columns.map(({ id, semanticType, position, hidden }) => ({ id, semanticType, position, hidden })),
      tasks: board.tasks.map(({ id, columnId, position }) => ({ id, columnId, position }))
    }
    await migrated.close()
    const again = new VoiceChatDb(file)

    await again.ready
    const stable = (await again.tasks.getBoard('alice', project.id))!
    expect({
      columns: stable.columns.map(({ id, semanticType, position, hidden }) => ({ id, semanticType, position, hidden })),
      tasks: stable.tasks.map(({ id, columnId, position }) => ({ id, columnId, position }))
    }).toEqual(snapshot)
    await again.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('projects: лёгкая доска и полная задача', () => {
  it('board гасит тяжёлые тексты, а getTaskDetail отдаёт их полностью', async () => {
    const p = await db.projects.createProject('alice', { name: 'Light board' })
    const col = (await db.tasks.getBoard('alice', p.id))!.columns[0]
    const task = (await db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'T' }))!
    await db.tasks.updateTask('alice', p.id, task.id, { description: 'Длинное описание задачи', acceptanceCriteria: 'Критерии приёмки' })
    const boardTask = (await db.tasks.getBoard('alice', p.id))!.tasks.find((t) => t.id === task.id)!
    // Лёгкая карточка: тяжёлые тексты пустые, но поля для превью на месте.
    expect(boardTask.description).toBe('')
    expect(boardTask.acceptanceCriteria).toBe('')
    // Лог подготовки доска не отдаёт вовсе — он живёт только в полной карточке.
    expect(boardTask.taskPreparationLog).toBeUndefined()
    expect(boardTask.title).toBe('T')
    // Полная задача — по id.
    const full = (await db.tasks.getTaskDetail('alice', p.id, task.id))!
    expect(full.description).toBe('Длинное описание задачи')
    expect(full.acceptanceCriteria).toBe('Критерии приёмки')
    // Изоляция: не участник проекта не получает задачу.
    expect(await db.tasks.getTaskDetail('bob', p.id, task.id)).toBeNull()
  })
})

describe('projects: две фазы доски', () => {
  /** Проект с задачей и её чатом — на нём видно, что где отдаётся. */
  async function withTask(): Promise<{ pid: string; taskId: string; chatId: string }> {
    const p = await db.projects.createProject('alice', { name: 'Phases' })
    const column = (await db.tasks.getBoardSkeleton('alice', p.id))!.columns[0]!
    const task = (await db.tasks.createTask('alice', p.id, { columnId: column.id, title: 'Двухфазная' }))!
    const chat = (await db.chat.openOrCreateTaskChat('alice', p.id, task.id))!
    return { pid: p.id, taskId: task.id, chatId: chat.id }
  }

  it('скелет отдаёт карточку без состояния процессов, статусы — только состояние', async () => {
    const { pid, taskId, chatId } = await withTask()
    const skeleton = (await db.tasks.getBoardSkeleton('alice', pid))!
    const card = skeleton.tasks.find((t) => t.id === taskId)!
    expect(card.title).toBe('Двухфазная')
    // Ради этого разделения всё и затевалось: первая фаза не ходит в раны и чаты.
    expect(card.chatId).toBeUndefined()
    expect(card.latestRunResult).toBeUndefined()
    expect(card.mergePermitted).toBeUndefined()
    expect(skeleton.ciRuns).toBeUndefined()

    const statuses = (await db.tasks.getBoardStatuses('alice', pid))!
    const status = statuses.tasks.find((t) => t.taskId === taskId)!
    expect(status.chatId).toBe(chatId)
    expect(status.latestRunResult).toBeNull()
    // Право на merge — свойство участника: у владельца проекта оно есть.
    expect(status.mergePermitted).toBe(true)
    expect(statuses.ciRuns).toEqual([])
  })

  it('getBoard склеивает обе фазы — прежний снапшот для MCP и автопрохода', async () => {
    const { pid, taskId, chatId } = await withTask()
    const board = (await db.tasks.getBoard('alice', pid))!
    const card = board.tasks.find((t) => t.id === taskId)!
    expect(card.title).toBe('Двухфазная')
    expect(card.chatId).toBe(chatId)
    expect(card.mergePermitted).toBe(true)
    expect(board.ciRuns).toEqual([])
  })

  it('обе фазы видят один и тот же набор задач, включая отсечку завершённых', async () => {
    let clock = 1_700_000_000_000
    const d = new VoiceChatDb(':memory:', { now: () => clock })
    await d.identity.createUser('alice', '', 'developer')
    const p = await d.projects.createProject('alice', { name: 'Retention' })
    const cols = (await d.tasks.getBoardSkeleton('alice', p.id))!.columns
    const done = cols.find((c) => c.semanticType === 'done')!
    const task = (await d.tasks.createTask('alice', p.id, { columnId: cols[0]!.id, title: 'T' }))!
    await d.projects.updateProject('alice', p.id, { doneRetentionDays: 0 })
    await d.tasks.moveTask('alice', p.id, task.id, { columnId: done.id })
    const skeletonIds = async (opts?: { includeCompleted?: boolean }): Promise<string[]> => (await d.tasks.getBoardSkeleton('alice', p.id, opts))!.tasks.map((t) => t.id)
    const statusIds = async (opts?: { includeCompleted?: boolean }): Promise<string[]> => (await d.tasks.getBoardStatuses('alice', p.id, opts))!.tasks.map((t) => t.taskId)

    // Порог 0 — «до конца дня завершения»: сегодня карточка ещё на доске.
    expect(await skeletonIds()).toContain(task.id)
    expect(await statusIds()).toContain(task.id)

    clock = new Date(clock).setHours(24, 0, 0, 0)
    // На следующий день карточка уходит — одинаково в обеих фазах, иначе статусы
    // приезжали бы для задач, которых на доске уже нет (или наоборот).
    expect(await skeletonIds()).not.toContain(task.id)
    expect(await statusIds()).not.toContain(task.id)
    expect(await skeletonIds({ includeCompleted: true })).toContain(task.id)
    expect(await statusIds({ includeCompleted: true })).toContain(task.id)
    await d.close()
  })

  it('сводки CI приходят только по карточкам доски, а не по всей истории проекта', async () => {
    let clock = 1_700_000_000_000
    const d = new VoiceChatDb(':memory:', { now: () => clock })
    await d.identity.createUser('alice', '', 'developer')
    const p = await d.projects.createProject('alice', { name: 'CI scope' })
    await d.projects.updateProject('alice', p.id, { doneRetentionDays: 0 })
    const cols = (await d.tasks.getBoardSkeleton('alice', p.id))!.columns
    const dev = cols[0]!
    const done = cols.find((c) => c.semanticType === 'done')!
    const onBoard = (await d.tasks.createTask('alice', p.id, { columnId: dev.id, title: 'На доске' }))!
    const archived = (await d.tasks.createTask('alice', p.id, { columnId: dev.id, title: 'Давно закрыта' }))!
    const run = async (taskId: string): Promise<void> => {
      const created = await d.ci.createCiRun({ projectId: p.id, taskId, agentId: null, triggeredBy: 'alice', prevColumnId: dev.id, runColumnId: dev.id, slotProgress: { done: 1, total: 1, phase: 'Готово' } })
      await d.ci.updateCiRun(created.id, { status: 'success', durationMs: 100 })
    }
    await run(onBoard.id)
    await run(archived.id)
    await d.tasks.moveTask('alice', p.id, archived.id, { columnId: done.id })
    clock = new Date(clock).setHours(24, 0, 0, 0)

    // Закрытая вчера карточка ушла с доски — её сводка не должна ехать с доской:
    // на боевом проекте так набегал мегабайт истории на 19 видимых задач.
    const statuses = (await d.tasks.getBoardStatuses('alice', p.id))!
    expect(statuses.tasks.map((t) => t.taskId)).toEqual([onBoard.id])
    expect(statuses.ciRuns.map((r) => r.taskId)).toEqual([onBoard.id])
    // С включённым «показывать завершённые» история доступна целиком.
    expect((await d.tasks.getBoardStatuses('alice', p.id, { includeCompleted: true }))!.ciRuns.map((r) => r.taskId).sort())
      .toEqual([onBoard.id, archived.id].sort())
    await d.close()
  })

  it('не участник проекта не получает ни скелета, ни статусов', async () => {
    const { pid } = await withTask()
    expect(await db.tasks.getBoardSkeleton('bob', pid)).toBeNull()
    expect(await db.tasks.getBoardStatuses('bob', pid)).toBeNull()
  })
})

describe('projects: создание и членство', () => {
  it('createProject сеет владельца и дефолтные колонки', async () => {
    const p = await db.projects.createProject('alice', { name: 'P1', description: 'd', technologies: ['ts'], skills: ['db'] })
    expect(p.name).toBe('P1')
    expect(p.role).toBe('owner')
    expect(p.createdBy).toBe('alice')
    expect(p.technologies).toEqual(['ts'])
    expect(p.members.map((m) => m.username)).toEqual(['alice'])
    expect(p.members[0].role).toBe('owner')
    const board = (await db.tasks.getBoard('alice', p.id))!
    expect(board.columns.map((c) => c.name)).toEqual(['Бэклог', 'Подготовка к разработке', 'Ready for Development', 'Development', 'Component QA', 'Создание интеграционных автотестов', 'Automated QA', 'Ручное QA', 'Ожидает мержа', 'Мерж', 'Готово', 'Отменено', 'Требуется решение'])
    expect(board.tasks).toEqual([])
  })

  it('изоляция: не-участник не видит проект', async () => {
    const p = await db.projects.createProject('alice', { name: 'P1' })
    expect((await db.projects.listProjects('alice')).map((x) => x.id)).toContain(p.id)
    expect(await db.projects.listProjects('bob')).toEqual([])
    expect(await db.projects.getProject('bob', p.id)).toBeNull()
    expect(await db.tasks.getBoard('bob', p.id)).toBeNull()
  })

  it('addMember открывает доступ; роль участника = member', async () => {
    const p = await db.projects.createProject('alice', { name: 'P1' })
    await db.projects.addMember('alice', p.id, 'bob')
    const asBob = (await db.projects.getProject('bob', p.id))!
    expect(asBob.role).toBe('member')
    expect((await db.projects.listProjects('bob')).map((x) => x.id)).toContain(p.id)
  })

  it('addMember только владельцем и только существующего пользователя', async () => {
    const p = await db.projects.createProject('alice', { name: 'P1' })
    await db.projects.addMember('alice', p.id, 'bob')
    expect(await db.projects.addMember('bob', p.id, 'carol')).toBeNull() // bob не владелец
    await expect(async () => await db.projects.addMember('alice', p.id, 'nobody')).rejects.toThrow()
  })

  it('updateProject/deleteProject — только владелец', async () => {
    const p = await db.projects.createProject('alice', { name: 'P1' })
    await db.projects.addMember('alice', p.id, 'bob')
    expect(await db.projects.updateProject('bob', p.id, { name: 'X' })).toBeNull()
    const upd = (await db.projects.updateProject('alice', p.id, { name: 'P1b', gitUrl: 'git@x' }))!
    expect(upd.name).toBe('P1b')
    expect(upd.gitUrl).toBe('git@x')
    expect(await db.projects.deleteProject('bob', p.id)).toBe(false)
    expect(await db.projects.deleteProject('alice', p.id)).toBe(true)
    expect(await db.projects.getProject('alice', p.id)).toBeNull()
  })

  it('removeMember снимает назначения и защищает последнего владельца', async () => {
    const p = await db.projects.createProject('alice', { name: 'P1' })
    await db.projects.addMember('alice', p.id, 'bob')
    const col = (await db.tasks.getBoard('alice', p.id))!.columns[0]
    const task = (await db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'T', assignee: 'bob' }))!
    expect(task.assignee).toBe('bob')
    await db.projects.removeMember('alice', p.id, 'bob')
    expect(await db.projects.getProject('bob', p.id)).toBeNull()
    expect((await db.tasks.getBoard('alice', p.id))!.tasks[0].assignee).toBeNull()
    await expect(async () => await db.projects.removeMember('alice', p.id, 'alice')).rejects.toThrow('последнего владельца')
  })

  it('поддерживает нескольких равноправных владельцев, выход и аудит ролей', async () => {
    const p = await db.projects.createProject('alice', { name: 'P1' })
    await db.projects.addMember('alice', p.id, 'bob')
    await db.projects.updateMemberRole('alice', p.id, 'bob', 'owner')
    expect((await db.projects.getProject('bob', p.id))!.role).toBe('owner')
    expect((await db.projects.updateProject('bob', p.id, { name: 'От Bob' }))!.name).toBe('От Bob')

    await db.projects.removeMember('bob', p.id, 'alice')
    expect(await db.projects.getProject('alice', p.id)).toBeNull()
    expect((await db.projects.getProject('bob', p.id))!.members).toEqual([
      expect.objectContaining({ username: 'bob', role: 'owner' })
    ])
    expect(await db.projects.listProjectMemberRoleAudit(p.id)).toEqual([
      expect.objectContaining({ actor: 'alice', targetUser: 'bob', oldRole: null, newRole: 'member', action: 'add' }),
      expect.objectContaining({ actor: 'alice', targetUser: 'bob', oldRole: 'member', newRole: 'owner', action: 'role_change' }),
      expect.objectContaining({ actor: 'bob', targetUser: 'alice', oldRole: 'owner', newRole: null, action: 'remove' })
    ])
  })

  it('не назначает владельцем не-участника и не позволяет двум владельцам убрать последнего', async () => {
    const p = await db.projects.createProject('alice', { name: 'P1' })
    await expect(async () => await db.projects.updateMemberRole('alice', p.id, 'bob', 'owner')).rejects.toThrow('Сначала добавьте')
    await db.projects.addMember('alice', p.id, 'bob')
    await db.projects.updateMemberRole('alice', p.id, 'bob', 'owner')
    await db.projects.updateMemberRole('alice', p.id, 'bob', 'member')
    await expect(async () => await db.projects.updateMemberRole('alice', p.id, 'alice', 'member')).rejects.toThrow('последнего владельца')
    expect((await db.projects.getProject('alice', p.id))!.members.filter((m) => m.role === 'owner')).toHaveLength(1)
  })
})

describe('projects: машины', () => {
  it('linkMachine валидирует владение агентом; каскад при удалении агента', async () => {
    const p = await db.projects.createProject('alice', { name: 'P1' })
    const agent = await db.machines.createAgent('alice', 'M1')
    const foreign = await db.machines.createAgent('bob', 'M2')
    await expect(async () => await db.machines.linkMachine('alice', p.id, foreign.id)).rejects.toThrow() // чужой агент
    const detail = (await db.machines.linkMachine('alice', p.id, agent.id))!
    expect(detail.machines.map((m) => m.agentId)).toEqual([agent.id])
    await db.machines.deleteAgent('alice', agent.id) // CASCADE снимает связь
    expect((await db.projects.getProject('alice', p.id))!.machines).toEqual([])
  })

  it('автоматически выбирает единственный storage и сохраняет managed defaults', async () => {
    const p = await db.projects.createProject('alice', { name: 'P1' })
    const agent = await db.machines.createAgent('alice', 'M1')
    const storage = await db.machines.saveMachineStorage('alice', agent.id, '/home/alice/ChatAI', 1)
    const machine = (await db.machines.linkMachine('alice', p.id, agent.id))!.machines[0]
    expect(machine.storageId).toBe(storage.id)
    expect(machine.path).toBe(`/home/alice/ChatAI/projects/${p.id}/worktree`)
    expect(machine.reposRoot).toBe(`/home/alice/ChatAI/projects/${p.id}/repositories`)
    expect(machine.directories?.production.override).toBe(false)
    expect(machine.readiness?.ready).toBe(true)
    expect((await db.projects.getProject('alice', p.id))!.machines[0].directories).toEqual(machine.directories)
  })

  it('сохраняет overrides при смене storage и отклоняет чужой storage', async () => {
    const p = await db.projects.createProject('alice', { name: 'P1' })
    const agent = await db.machines.createAgent('alice', 'M1')
    const other = await db.machines.createAgent('bob', 'M2')
    const first = await db.machines.saveMachineStorage('alice', agent.id, '/mnt/a', 1)
    const second = await db.machines.saveMachineStorage('alice', agent.id, '/mnt/b', 1)
    const foreign = await db.machines.saveMachineStorage('bob', other.id, '/mnt/foreign', 1)
    const initial = (await db.machines.linkMachine('alice', p.id, agent.id, first.id))!.machines[0]
    const directories = structuredClone(initial.directories!)
    directories.projectWorkdir = { path: '/legacy/project', override: true }
    const updated = (await db.machines.configureProjectMachineStorage('alice', p.id, agent.id, second.id, directories))!.machines[0]
    expect(updated.path).toBe('/legacy/project')
    expect(updated.recommendations?.projectWorkdir).toContain('/mnt/b/')
    const reset = (await db.machines.resetProjectMachineDirectory('alice', p.id, agent.id, 'projectWorkdir'))!.machines[0]
    expect(reset.path).toBe(reset.recommendations?.projectWorkdir)
    expect(reset.directories?.projectWorkdir.override).toBe(false)
    await expect(async () => await db.machines.setProjectMachinePath('alice', p.id, agent.id, '../escape')).rejects.toThrow()
    await expect(async () => await db.machines.configureProjectMachineStorage('alice', p.id, agent.id, foreign.id)).rejects.toThrow(/не принадлежит/)
  })

  it('сохраняет legacy path и reposRoot как overrides при добровольном выборе storage', async () => {
    const p = await db.projects.createProject('alice', { name: 'Legacy' })
    const agent = await db.machines.createAgent('alice', 'M1')
    await db.machines.linkMachine('alice', p.id, agent.id)
    await db.machines.setProjectMachinePath('alice', p.id, agent.id, '/legacy/project')
    await db.machines.setProjectMachineReposRoot('alice', p.id, agent.id, '/legacy/repos')
    const storage = await db.machines.saveMachineStorage('alice', agent.id, '/managed/root', 1)
    const machine = (await db.machines.configureProjectMachineStorage('alice', p.id, agent.id, storage.id))!.machines[0]
    expect(machine.path).toBe('/legacy/project')
    expect(machine.reposRoot).toBe('/legacy/repos')
    expect(machine.directories?.projectWorkdir.override).toBe(true)
    expect(machine.directories?.reposRoot.override).toBe(true)
    expect(machine.recommendations?.projectWorkdir).toContain('/managed/root/projects/')
  })

  async function releaseFixture(access: 'full'|'read'='full') {
    const project=await db.projects.createProject('alice',{name:'Release',gitUrl:'git@example/repo.git'})
    await db.projects.addMember('alice',project.id,'bob')
    const personal=await db.machines.createAgent('alice','Alice Mac')
    const shared=await db.machines.createAgent('bob','Bob Mac')
    const foreign=await db.machines.createAgent('bob','Foreign Mac')
    await db.machines.linkMachine('alice',project.id,personal.id)
    await db.machines.setProjectMachinePath('alice',project.id,personal.id,'/alice/project')
    await db.machines.linkMachine('bob',project.id,shared.id)
    await db.machines.setProjectMachinePath('bob',project.id,shared.id,'/bob/project')
    await db.machines.setMachineSharedWithProject('bob',project.id,shared.id,true,access)
    return {project,personal,shared,foreign}
  }

  // @testCase TC-API-1
  it('release-каталог использует listUsableAgents без дубликатов и чужих машин',async()=>{
    const {project,personal,shared,foreign}=await releaseFixture()
    await db.machines.setMachineSharedWithProject('alice',project.id,personal.id,true,'full')
    const catalog=await releaseMachineCatalog(db,{isOnline:()=>true},'alice',project.id)
    expect(catalog.machines.map(machine=>machine.agentId)).toEqual([personal.id,shared.id])
    expect(catalog.machines.filter(machine=>machine.agentId===personal.id)).toHaveLength(1)
    expect(catalog.machines.some(machine=>machine.agentId===foreign.id)).toBe(false)
  })

  // @testCase TC-API-2
  it('release target отклоняет чужой и read-only agentId',async()=>{
    const {project,shared,foreign}=await releaseFixture('read')
    await expect(releaseCiTarget(db,{isOnline:()=>true},'alice',project.id,foreign.id)).rejects.toThrow(/недоступна/)
    await expect(releaseCiTarget(db,{isOnline:()=>true},'alice',project.id,shared.id)).rejects.toThrow(/Только чтение/)
  })

  // @testCase TC-INT-1
  it('release preference изолирована по пользователю и проекту',async()=>{
    const {project,personal,shared}=await releaseFixture()
    await db.machines.setUserProjectReleaseMachine('alice',project.id,personal.id)
    await db.machines.setUserProjectReleaseMachine('bob',project.id,shared.id)
    expect(await db.machines.getUserProjectReleaseMachine('alice',project.id)).toBe(personal.id)
    expect(await db.machines.getUserProjectReleaseMachine('bob',project.id)).toBe(shared.id)
  })

  // @testCase TC-INT-2
  it('разрешение и отклонение target не меняет release preference',async()=>{
    const {project,personal,foreign}=await releaseFixture()
    await db.machines.setUserProjectReleaseMachine('alice',project.id,personal.id)
    await releaseCiTarget(db,{isOnline:()=>true},'alice',project.id,personal.id)
    await expect(releaseCiTarget(db,{isOnline:()=>true},'alice',project.id,foreign.id)).rejects.toThrow()
    expect(await db.machines.getUserProjectReleaseMachine('alice',project.id)).toBe(personal.id)
  })

  // @testCase TC-REG-2
  it('release preference не меняет CHAT-177 default и каталог',async()=>{
    const {project,personal,shared}=await releaseFixture()
    await db.machines.setUserProjectDefaultMachine('alice',project.id,personal.id)
    await db.machines.setUserProjectReleaseMachine('alice',project.id,shared.id)
    expect(await db.machines.getUserProjectDefaultMachine('alice',project.id)).toBe(personal.id)
    expect((await db.machines.listUsableAgents('alice',project.id)).map(agent=>agent.id)).toEqual([personal.id,shared.id])
  })
})

describe('board: колонки и порядок', () => {
  it('createColumn добавляет в конец; reorderColumns переставляет', async () => {
    const p = await db.projects.createProject('alice', { name: 'P1' })
    const c4 = (await db.projects.createColumn('alice', p.id, 'Review'))!
    let cols = (await db.tasks.getBoard('alice', p.id))!.columns
    expect(cols.map((c) => c.name)).toEqual(['Бэклог', 'Подготовка к разработке', 'Ready for Development', 'Development', 'Component QA', 'Создание интеграционных автотестов', 'Automated QA', 'Ручное QA', 'Ожидает мержа', 'Мерж', 'Готово', 'Отменено', 'Требуется решение', 'Review'])
    const reversed = cols.map((c) => c.id).reverse()
    expect(await db.projects.reorderColumns('alice', p.id, reversed)).toBe(true)
    cols = (await db.tasks.getBoard('alice', p.id))!.columns
    expect(cols.map((c) => c.id)).toEqual(reversed)
    // неполный/чужой набор — отказ
    expect(await db.projects.reorderColumns('alice', p.id, [c4.id])).toBe(false)
  })

  it('setColumnHidden и deleteColumn (каскад задач)', async () => {
    const p = await db.projects.createProject('alice', { name: 'P1' })
    const col = (await db.projects.createColumn('alice', p.id, 'Custom'))!
    await db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'T' })
    expect(await db.projects.setColumnHidden('alice', p.id, col.id, true)).toBe(true)
    expect((await db.tasks.getBoard('alice', p.id))!.columns.find((c) => c.id === col.id)!.hidden).toBe(true)
    expect(await db.projects.deleteColumn('alice', p.id, col.id)).toBe(true)
    const board = (await db.tasks.getBoard('alice', p.id))!
    expect(board.columns.find((c) => c.id === col.id)).toBeUndefined()
    expect(board.tasks).toEqual([]) // задача ушла по CASCADE
  })
})

describe('board: задачи, приоритеты, assignee, перемещение', () => {
  it('assignee должен быть участником', async () => {
    const p = await db.projects.createProject('alice', { name: 'P1' })
    const col = (await db.tasks.getBoard('alice', p.id))!.columns[0]
    await expect(async () => await db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'T', assignee: 'bob' })).rejects.toThrow()
    await db.projects.addMember('alice', p.id, 'bob')
    const t = (await db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'T', assignee: 'bob', priority: 'high' }))!
    expect(t.assignee).toBe('bob')
    expect(t.priority).toBe('high')
    expect((await db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'Без исполнителя', assignee: null }))!.assignee).toBeNull()
    await expect(async () => await db.tasks.updateTask('alice', p.id, t.id, { assignee: 'carol' })).rejects.toThrow()
    await db.identity.setUserBlocked('bob', true)
    expect((await db.projects.getProject('alice', p.id))!.members.find((member) => member.username === 'bob')?.active).toBe(false)
    await expect(async () => await db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'Blocked', assignee: 'bob' })).rejects.toThrow()
  })

  it('машина задачи доступна лично или через проект, чужая отклоняется', async () => {
    const p = await db.projects.createProject('alice', { name: 'P1' })
    const col = (await db.tasks.getBoard('alice', p.id))!.columns[0]
    const personal = await db.machines.createAgent('alice', 'Личная')
    const projectMachine = await db.machines.createAgent('alice', 'Проектная')
    await db.machines.linkMachine('alice', p.id, projectMachine.id)
    const foreign = await db.machines.createAgent('bob', 'Чужая')

    const task = (await db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'T', agentId: personal.id }))!
    expect(task.agentId).toBe(personal.id)
    expect((await db.tasks.updateTask('alice', p.id, task.id, { agentId: projectMachine.id }))!.agentId).toBe(projectMachine.id)
    await expect(async () => await db.tasks.updateTask('alice', p.id, task.id, { agentId: foreign.id })).rejects.toThrow('Машина недоступна')
  })

  it('moveTask: в середину, вниз, вверх, в пустую колонку', async () => {
    const p = await db.projects.createProject('alice', { name: 'P1' })
    const [todo, doing] = (await db.tasks.getBoard('alice', p.id))!.columns
    const a = (await db.tasks.createTask('alice', p.id, { columnId: todo.id, title: 'A' }))!
    const b = (await db.tasks.createTask('alice', p.id, { columnId: todo.id, title: 'B' }))!
    const c = (await db.tasks.createTask('alice', p.id, { columnId: todo.id, title: 'C' }))!
    // c → между a и b
    await db.tasks.moveTask('alice', p.id, c.id, { columnId: todo.id, afterId: a.id, beforeId: b.id })
    let order = (await db
      .tasks.getBoard('alice', p.id))!
      .tasks.filter((t) => t.columnId === todo.id)
      .map((t) => t.title)
    expect(order).toEqual(['A', 'C', 'B'])
    // a → в пустую колонку doing
    await db.tasks.moveTask('alice', p.id, a.id, { columnId: doing.id })
    const board = (await db.tasks.getBoard('alice', p.id))!
    expect(board.tasks.find((t) => t.id === a.id)!.columnId).toBe(doing.id)
    expect(board.tasks.filter((t) => t.columnId === todo.id).map((t) => t.title)).toEqual(['C', 'B'])
  })

  it('moveTask ренормализует при схлопывании ранга', async () => {
    const p = await db.projects.createProject('alice', { name: 'P1' })
    const col = (await db.tasks.getBoard('alice', p.id))!.columns[0]
    const a = (await db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'A' }))!
    const b = (await db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'B' }))!
    const x = (await db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'X' }))!
    // Много раз вставляем X между A и B — ранги сближаются, срабатывает ренормализация.
    for (let i = 0; i < 60; i++) {
      await db.tasks.moveTask('alice', p.id, x.id, { columnId: col.id, afterId: a.id, beforeId: b.id })
    }
    const order = (await db
      .tasks.getBoard('alice', p.id))!
      .tasks.filter((t) => t.columnId === col.id)
      .map((t) => t.title)
    expect(order).toEqual(['A', 'X', 'B'])
    // ранги строго возрастают и различимы
    const pos = (await db.tasks.getBoard('alice', p.id))!.tasks.filter((t) => t.columnId === col.id).map((t) => t.position)
    expect(pos[0]).toBeLessThan(pos[1])
    expect(pos[1]).toBeLessThan(pos[2])
  })
})

describe('projects: deleteUserData', () => {
  it('снимает членства, удаляет осиротевшие проекты, чистит назначения', async () => {
    const solo = await db.projects.createProject('alice', { name: 'Solo' })
    const shared = await db.projects.createProject('alice', { name: 'Shared' })
    await db.projects.addMember('alice', shared.id, 'bob')
    const col = (await db.tasks.getBoard('alice', shared.id))!.columns[0]
    await db.tasks.createTask('alice', shared.id, { columnId: col.id, title: 'T', assignee: 'bob' })
    await db.identity.deleteUserData('bob')
    // shared остаётся (владелец alice), назначение снято
    expect((await db.projects.getProject('alice', shared.id))!.members.map((m) => m.username)).toEqual(['alice'])
    expect((await db.tasks.getBoard('alice', shared.id))!.tasks[0].assignee).toBeNull()
    // solo остаётся у alice
    expect(await db.projects.getProject('alice', solo.id)).not.toBeNull()
    // теперь удалим владельца — оба проекта осиротеют и удалятся
    await db.identity.deleteUserData('alice')
    expect(await db.projects.listProjects('alice')).toEqual([])
  })
})

describe('projects: папка машины, дефолт, привязка чата', () => {
  it('setProjectMachinePath и setProjectDefaultMachine; unlink сбрасывает дефолт', async () => {
    const p = await db.projects.createProject('alice', { name: 'P1' })
    const a1 = await db.machines.createAgent('alice', 'M1')
    const a2 = await db.machines.createAgent('alice', 'M2')
    await db.machines.linkMachine('alice', p.id, a1.id)
    await db.machines.linkMachine('alice', p.id, a2.id)
    // папка на машине
    let d = (await db.machines.setProjectMachinePath('alice', p.id, a1.id, '/srv/proj'))!
    expect(d.machines.find((m) => m.agentId === a1.id)!.path).toBe('/srv/proj')
    // дефолт
    d = (await db.projects.setProjectDefaultMachine('alice', p.id, a1.id))!
    expect(d.defaultAgentId).toBe(a1.id)
    // дефолтом нельзя назначить машину не из проекта
    const foreign = await db.machines.createAgent('alice', 'X')
    await expect(async () => await db.projects.setProjectDefaultMachine('alice', p.id, foreign.id)).rejects.toThrow()
    // не-владелец не может
    await db.projects.addMember('alice', p.id, 'bob')
    expect(await db.machines.setProjectMachinePath('bob', p.id, a1.id, '/x')).toBeNull()
    // снятие дефолтной машины сбрасывает дефолт
    await db.projects.unlinkMachine('alice', p.id, a1.id)
    expect((await db.projects.getProject('alice', p.id))!.defaultAgentId).toBeNull()
  })

  it('сохраняет конфигурацию собственной машины без предоставления проекту', async () => {
    const p = await db.projects.createProject('alice', { name: 'Private machine config' })
    const machine = await db.machines.createAgent('alice', 'Private Mac')
    await db.projects.addMember('alice', p.id, 'bob')

    await db.machines.setProjectMachinePath('alice', p.id, machine.id, '/work/project')
    await db.machines.setProjectMachineReposRoot('alice', p.id, machine.id, '/work/repos')
    await db.machines.setProjectMachineSsh('alice', p.id, machine.id, 'mac.local', 'alice')

    expect(await db.machines.isMachineSharedWithProject(p.id, machine.id)).toBe(false)
    expect((await db.projects.getProject('alice', p.id))!.machines.find((item) => item.agentId === machine.id)).toMatchObject({
      path: '/work/project', reposRoot: '/work/repos', sshHost: 'mac.local', sshUser: 'alice', sharedWithProject: false
    })
    expect((await db.projects.getProject('bob', p.id))!.machines.some((item) => item.agentId === machine.id)).toBe(false)
  })

  it('listProjectMachines отдаёт машины проекта с именами и папками (для MCP-моста)', async () => {
    const p = await db.projects.createProject('alice', { name: 'P1' })
    const other = await db.projects.createProject('alice', { name: 'P2' })
    const a1 = await db.machines.createAgent('alice', 'M1')
    const a2 = await db.machines.createAgent('alice', 'M2')
    const foreign = await db.machines.createAgent('alice', 'X')
    await db.machines.linkMachine('alice', p.id, a1.id)
    await db.machines.linkMachine('alice', p.id, a2.id)
    await db.machines.linkMachine('alice', other.id, foreign.id)
    await db.machines.setProjectMachinePath('alice', p.id, a2.id, '/srv/proj')
    expect(await db.machines.listProjectMachines(p.id)).toEqual([
      { agentId: a1.id, name: 'M1', path: '' },
      { agentId: a2.id, name: 'M2', path: '/srv/proj' }
    ])
    // машина другого проекта не попадает в список
    expect(await db.machines.listProjectMachines(other.id)).toEqual([{ agentId: foreign.id, name: 'X', path: '' }])
    expect(await db.machines.listProjectMachines('нет-такого')).toEqual([])
  })

  it('canUseAgent даёт проектный доступ только участнику в явном контексте и отзывает его сразу', async () => {
    const p = await db.projects.createProject('alice', { name: 'Shared' })
    const machine = await db.machines.createAgent('alice', 'Mac')
    const unsharedMachine = await db.machines.createAgent('alice', 'Personal Mac')
    await db.machines.linkMachine('alice', p.id, machine.id)
    await db.projects.addMember('alice', p.id, 'bob')

    expect(await db.machines.isMachineSharedWithProject(p.id, unsharedMachine.id)).toBe(false)
    expect(await db.machines.canUseAgent('alice', unsharedMachine.id, p.id)).toBe(true)
    expect(await db.machines.canUseAgent('bob', unsharedMachine.id, p.id)).toBe(false)
    expect(await db.machines.canUseAgent('alice', machine.id)).toBe(true)
    expect(await db.machines.canUseAgent('bob', machine.id)).toBe(false)
    expect(await db.machines.canUseAgent('bob', machine.id, p.id)).toBe(true)
    expect(await db.machines.canUseAgent('charlie', machine.id, p.id)).toBe(false)

    await db.projects.removeMember('alice', p.id, 'bob')
    expect(await db.machines.canUseAgent('bob', machine.id, p.id)).toBe(false)
    await db.projects.addMember('alice', p.id, 'bob')
    await db.projects.unlinkMachine('alice', p.id, machine.id)
    expect(await db.machines.canUseAgent('bob', machine.id, p.id)).toBe(false)
  })

  it('setConversationProject сохраняет наследование машины, обновляет навыки/projectId; null отвязывает', async () => {
    const p = await db.projects.createProject('alice', { name: 'P1', skills: ['ts', 'sql'] })
    const a1 = await db.machines.createAgent('alice', 'M1')
    await db.machines.linkMachine('alice', p.id, a1.id)
    await db.machines.setProjectMachinePath('alice', p.id, a1.id, '/srv/proj')
    await db.projects.setProjectDefaultMachine('alice', p.id, a1.id)
    const conv = await db.chat.createConversation('alice', 'Чат')
    const linked = (await db.chat.setConversationProject('alice', conv.id, p.id))!
    expect(linked.projectId).toBe(p.id)
    expect(linked.execTarget).toBeNull()
    expect(linked.workdir).toBeNull()
    expect(linked.skillNames).toEqual(['ts', 'sql'])
    // не-участник проекта не может привязать
    const conv2 = await db.chat.createConversation('bob', 'Чат bob')
    expect(await db.chat.setConversationProject('bob', conv2.id, p.id)).toBeNull()
    // отвязка
    const unl = (await db.chat.setConversationProject('alice', conv.id, null))!
    expect(unl.projectId).toBeNull()
  })

  it('изолирует персональные defaults и аудит предоставления по проектам', async () => {
    const p1 = await db.projects.createProject('alice', { name: 'P1' })
    const p2 = await db.projects.createProject('alice', { name: 'P2' })
    await db.projects.addMember('alice', p1.id, 'bob')
    await db.projects.addMember('alice', p2.id, 'bob')
    const machine = await db.machines.createAgent('alice', 'Mac')
    await db.machines.linkMachine('alice', p1.id, machine.id)
    await db.machines.setProjectMachinePath('alice', p1.id, machine.id, '/work/project')
    await db.machines.setProjectMachineReposRoot('alice', p1.id, machine.id, '/work/VoiceAIChatRepos')
    await db.machines.setProjectMachineSsh('alice', p1.id, machine.id, 'mac.local', 'alice')
    expect(await db.machines.canUseAgent('bob', machine.id, p1.id)).toBe(true)
    expect(await db.machines.canUseAgent('bob', machine.id, p2.id)).toBe(false)
    expect((await db.projects.getProject('bob', p1.id))!.machines[0]).toMatchObject({
      path: '/work/project', reposRoot: '/work/VoiceAIChatRepos', sshHost: 'mac.local', sshUser: 'alice'
    })
    await (async () => await db.machines.setProjectMachinePath('bob', p1.id, machine.id, '/stolen'))()
    expect(await db.machines.setProjectMachinePath('bob', p1.id, machine.id, '/stolen')).toBeNull()

    await db.machines.setUserProjectDefaultMachine('bob', p1.id, machine.id)
    expect(await db.machines.getUserProjectDefaultMachine('bob', p1.id)).toBe(machine.id)
    expect(await db.machines.getUserProjectDefaultMachine('alice', p1.id)).toBeNull()
    expect(await db.machines.getUserProjectDefaultMachine('bob', p2.id)).toBeNull()

    await db.machines.setMachineSharedWithProject('alice', p1.id, machine.id, false)
    expect(await db.machines.getUserProjectDefaultMachine('bob', p1.id)).toBeNull()
    expect(await db.machines.listMachineShareAudit(p1.id)).toMatchObject([
      { actor: 'alice', agentId: machine.id, oldValue: false, newValue: true },
      { actor: 'alice', agentId: machine.id, oldValue: true, newValue: false }
    ])
    await expect(async () => await db.machines.setMachineSharedWithProject('bob', p1.id, machine.id, true)).rejects.toThrow('Только владелец')
  })
})


describe('work items', () => {
  it('строит иерархию Epic → Story → Task и запрещает неверного родителя', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    const backlog = (await db.tasks.getBoard('alice', p.id))!.columns.find((c) => c.semanticType === 'backlog')!
    const epic = (await db.tasks.createTask('alice', p.id, { columnId: backlog.id, title: 'E', type: 'epic' }))!
    const story = (await db.tasks.createTask('alice', p.id, { columnId: backlog.id, title: 'S', type: 'story', parentId: epic.id }))!
    const task = (await db.tasks.createTask('alice', p.id, { columnId: backlog.id, title: 'T', type: 'task', parentId: story.id, acceptanceCriteria: 'ok' }))!
    expect(task.parentId).toBe(story.id)
    expect(task.acceptanceCriteria).toBe('ok')
    await expect(async () => await db.tasks.createTask('alice', p.id, { columnId: backlog.id, title: 'bad', type: 'epic', parentId: story.id })).rejects.toThrow()
    await expect(async () => await db.tasks.updateTask('alice', p.id, epic.id, { parentId: task.id })).rejects.toThrow()
  })

  it('deleteTask убирает задачу с доски', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    const ready = (await db.tasks.getBoard('alice', p.id))!.columns.find((c) => c.semanticType === 'ready')!
    const task = (await db.tasks.createTask('alice', p.id, { columnId: ready.id, title: 'T' }))!
    expect(await db.tasks.deleteTask('alice', p.id, task.id)).toBe(true)
    expect((await db.tasks.getBoard('alice', p.id))!.tasks.find((t) => t.id === task.id)).toBeUndefined()
  })
})

describe('projects: навыки по умолчанию и связанный чат', () => {
  it('createProject/updateProject хранят навыки по умолчанию по типам', async () => {
    const p = await db.projects.createProject('alice', { name: 'P', defaultSkills: { epic: ['arch'], story: ['ux'], task: ['ts'] } })
    expect(p.defaultSkills).toEqual({ epic: ['arch'], story: ['ux'], task: ['ts'] })
    const upd = (await db.projects.updateProject('alice', p.id, { defaultSkills: { task: ['ts', 'sql'] } }))!
    expect(upd.defaultSkills).toEqual({ epic: ['arch'], story: ['ux'], task: ['ts', 'sql'] })
  })

  it('createTask копирует навыки по умолчанию для своего типа; явные — перекрывают', async () => {
    const p = await db.projects.createProject('alice', { name: 'P', defaultSkills: { epic: ['arch'], story: ['ux'], task: ['ts'] } })
    const col = (await db.tasks.getBoard('alice', p.id))!.columns[0]
    const epic = (await db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'E', type: 'epic' }))!
    expect(epic.skills).toEqual(['arch'])
    const story = (await db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'S', type: 'story', parentId: epic.id }))!
    expect(story.skills).toEqual(['ux'])
    const task = (await db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'T', type: 'task' }))!
    expect(task.skills).toEqual(['ts'])
    const custom = (await db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'C', type: 'task', skills: ['redis'] }))!
    expect(custom.skills).toEqual(['redis'])
  })

  it('updateTask правит навыки карточки (удаление авто-добавленных + свои)', async () => {
    const p = await db.projects.createProject('alice', { name: 'P', defaultSkills: { epic: [], story: [], task: ['ts', 'sql'] } })
    const col = (await db.tasks.getBoard('alice', p.id))!.columns[0]
    const t = (await db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'T' }))!
    expect(t.skills).toEqual(['ts', 'sql'])
    const upd = (await db.tasks.updateTask('alice', p.id, t.id, { skills: ['ts', 'redis'] }))!
    expect(upd.skills).toEqual(['ts', 'redis'])
  })

  it('createTask сразу создаёт чат автору только для пользовательского таска', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    const col = (await db.tasks.getBoard('alice', p.id))!.columns[0]
    const task = (await db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'Пользовательская', source: 'rest' }))!
    const chatId = (await db.tasks.getBoard('alice', p.id))!.tasks.find((item) => item.id === task.id)!.chatId
    expect(chatId).toBeTruthy()
    expect(await db.chat.getConversation('alice', chatId!)).toMatchObject({
      title: 'Задача Пользовательская',
      projectId: p.id,
      taskId: task.id,
      scope: 'kanban'
    })

    const replay = (await db.tasks.createTask('alice', p.id, {
      columnId: col.id, title: 'Повтор', source: 'rest', idempotencyKey: 'create-1'
    }))!
    const replayed = (await db.tasks.createTask('alice', p.id, {
      columnId: col.id, title: 'Повтор', source: 'rest', idempotencyKey: 'create-1'
    }))!
    expect(replayed.id).toBe(replay.id)
    expect((await db.tasks.getBoard('alice', p.id))!.tasks.find((item) => item.id === replay.id)!.chatId).toBeTruthy()

    const epic = (await db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'Эпик', type: 'epic', source: 'rest' }))!
    const system = (await db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'Системная' }))!
    expect((await db.tasks.getBoard('alice', p.id))!.tasks.find((item) => item.id === epic.id)!.chatId).toBeNull()
    expect((await db.tasks.getBoard('alice', p.id))!.tasks.find((item) => item.id === system.id)!.chatId).toBeNull()
  })

  it('openOrCreateTaskChat: наследует LLM-настройки пользователя, привязывает задачу/проект/навыки и виден в board.chatId', async () => {
    const engine = await db.llm.createLlmEngine({ name: 'Codex', kind: 'codex', baseUrl: 'http://codex', token: '', enabled: true, allowedRoles: ['developer'], isDefault: false })
    await db.settings.saveSettings('alice', { ...DEFAULT_SETTINGS, llmEngineId: engine.id, llmProvider: 'codex', codexModel: 'gpt-5.6-luna' })
    const p = await db.projects.createProject('alice', { name: 'P', defaultSkills: { epic: [], story: [], task: ['ts'] } })
    const col = (await db.tasks.getBoard('alice', p.id))!.columns[0]
    const t = (await db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'Скролл в модалке' }))!
    const chat = (await db.chat.openOrCreateTaskChat('alice', p.id, t.id))!
    expect(chat.taskId).toBe(t.id)
    expect(chat.projectId).toBe(p.id)
    // Имя по умолчанию — «Задача <заголовок>»: чат задачи виден в общем списке.
    expect(chat.title).toBe('Задача Скролл в модалке')
    expect(chat.skillNames).toEqual(['ts'])
    // Собственных значений нет: чат динамически наследует проект, затем пользователя.
    expect(chat).toMatchObject({ llmEngineId: null, llmProvider: null, llmModel: null })
    expect(await db.ci.getCiLlmConfig('project', p.id) ?? await db.ci.ciLlmDefaultsForUser('alice')).toMatchObject({ provider: 'codex', model: 'gpt-5.6-luna' })
    await db.settings.saveSettings('alice', { ...DEFAULT_SETTINGS, llmEngineId: engine.id, llmProvider: 'codex', codexModel: 'gpt-5.6-sol' })
    expect(await db.chat.getConversation('alice', chat.id)).toMatchObject({ llmEngineId: null, llmProvider: null, llmModel: null })
    expect(await db.ci.getCiLlmConfig('project', p.id) ?? await db.ci.ciLlmDefaultsForUser('alice')).toMatchObject({ provider: 'codex', model: 'gpt-5.6-sol' })
    const again = (await db.chat.openOrCreateTaskChat('alice', p.id, t.id))!
    expect(again.id).toBe(chat.id) // не плодит второй чат
    expect(again).toMatchObject({ llmEngineId: null, llmProvider: null, llmModel: null })
    expect((await db.tasks.getBoard('alice', p.id))!.tasks.find((x) => x.id === t.id)!.chatId).toBe(chat.id)
  })

  it('создаёт один скрытый канбан-чат на пользователя и проект и сохраняет его историю', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    const first = (await db.chat.ensureKanbanAssistantConversation('alice', p.id))!
    await db.chat.addMessage('alice', first.id, 'u0', 'Помоги', '10:00')
    const again = (await db.chat.ensureKanbanAssistantConversation('alice', p.id))!
    expect(again.id).toBe(first.id)
    expect(again).toMatchObject({ assistantKind: 'kanban', projectId: p.id, llmEngineId: null, llmProvider: null, llmModel: null })
    expect(await db.chat.listMessages('alice', first.id)).toHaveLength(1)
    expect((await db.chat.listConversations('alice')).some((chat) => chat.id === first.id)).toBe(false)
    expect(await db.chat.ensureKanbanAssistantConversation('bob', p.id)).toBeNull()
  })

  it('openOrCreateTaskChat изолирован по пользователю и требует членства', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    const col = (await db.tasks.getBoard('alice', p.id))!.columns[0]
    const t = (await db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'T' }))!
    expect(await db.chat.openOrCreateTaskChat('bob', p.id, t.id)).toBeNull() // не участник
    await db.projects.addMember('alice', p.id, 'bob')
    const chatA = (await db.chat.openOrCreateTaskChat('alice', p.id, t.id))!
    const chatB = (await db.chat.openOrCreateTaskChat('bob', p.id, t.id))!
    expect(chatB.id).not.toBe(chatA.id) // у каждого свой связанный чат
    expect((await db.tasks.getBoard('bob', p.id))!.tasks.find((x) => x.id === t.id)!.chatId).toBe(chatB.id)
    expect((await db.tasks.getBoard('alice', p.id))!.tasks.find((x) => x.id === t.id)!.chatId).toBe(chatA.id)
  })
})

describe('доска: завершённые задачи уходят с доски по порогу проекта', () => {
  const DAY = 24 * 60 * 60 * 1000
  /** БД с управляемыми часами: порог считается в днях, шаг по 10 мс не годится. */
  function withClock(): { db: VoiceChatDb; set: (t: number) => void } {
    let id = 0
    let clock = 1_700_000_000_000
    const fresh = new VoiceChatDb(':memory:', { newId: () => `c-${++id}`, now: () => clock })
    fresh.identity.createUser('alice', '', 'developer')
    return { db: fresh, set: (t) => { clock = t } }
  }

  it('moveTask ставит doneAt в «Готово» и сбрасывает при возврате в работу', async () => {
    const { db: d, set } = withClock()
    const p = await d.projects.createProject('alice', { name: 'P' })
    const cols = (await d.tasks.getBoard('alice', p.id))!.columns
    const done = cols.find((c) => c.semanticType === 'done')!
    const dev = cols.find((c) => c.semanticType === 'development')!
    const task = (await d.tasks.createTask('alice', p.id, { columnId: dev.id, title: 'T' }))!
    expect(task.doneAt).toBeNull()
    set(1_700_000_100_000)
    expect((await d.tasks.moveTask('alice', p.id, task.id, { columnId: done.id }))!.doneAt).toBe(1_700_000_100_000)
    // Повторный переезд внутри «Готово» отсчёт не сбрасывает.
    set(1_700_000_200_000)
    expect((await d.tasks.moveTask('alice', p.id, task.id, { columnId: done.id }))!.doneAt).toBe(1_700_000_100_000)
    expect((await d.tasks.moveTask('alice', p.id, task.id, { columnId: dev.id }))!.doneAt).toBeNull()
    await d.close()
  })

  it('createTask сразу в «Готово» начинает отсчёт', async () => {
    const { db: d } = withClock()
    const p = await d.projects.createProject('alice', { name: 'P' })
    const done = (await d.tasks.getBoard('alice', p.id))!.columns.find((c) => c.semanticType === 'done')!
    expect((await d.tasks.createTask('alice', p.id, { columnId: done.id, title: 'T' }))!.doneAt).toBe(1_700_000_000_000)
    await d.close()
  })

  it('порог 0 — карточка держится до конца дня завершения', async () => {
    const { db: d, set } = withClock()
    const p = await d.projects.createProject('alice', { name: 'P' })
    await d.projects.updateProject('alice', p.id, { doneRetentionDays: 0 })
    const cols = (await d.tasks.getBoard('alice', p.id))!.columns
    const done = cols.find((c) => c.semanticType === 'done')!
    const dev = cols.find((c) => c.semanticType === 'development')!
    const task = (await d.tasks.createTask('alice', p.id, { columnId: dev.id, title: 'T' }))!
    await d.tasks.moveTask('alice', p.id, task.id, { columnId: done.id })
    // Автоперенос CI-рана не имеет права смахнуть карточку с доски в ту же секунду.
    expect((await d.tasks.getBoard('alice', p.id))!.tasks.map((t) => t.id)).toContain(task.id)
    const endOfDay = new Date(1_700_000_000_000).setHours(24, 0, 0, 0)
    set(endOfDay - 1)
    expect((await d.tasks.getBoard('alice', p.id))!.tasks.map((t) => t.id)).toContain(task.id)
    set(endOfDay)
    expect((await d.tasks.getBoard('alice', p.id))!.tasks.map((t) => t.id)).not.toContain(task.id)
    expect((await d.tasks.getBoard('alice', p.id, { includeCompleted: true }))!.tasks.map((t) => t.id)).toContain(task.id)
    await d.close()
  })

  it('старше порога — нет на доске, includeCompleted возвращает', async () => {
    const { db: d, set } = withClock()
    const p = await d.projects.createProject('alice', { name: 'P' })
    const cols = (await d.tasks.getBoard('alice', p.id))!.columns
    const done = cols.find((c) => c.semanticType === 'done')!
    const dev = cols.find((c) => c.semanticType === 'development')!
    const old = (await d.tasks.createTask('alice', p.id, { columnId: dev.id, title: 'Старая' }))!
    const fresh = (await d.tasks.createTask('alice', p.id, { columnId: dev.id, title: 'Свежая' }))!
    await d.tasks.moveTask('alice', p.id, old.id, { columnId: done.id })
    set(1_700_000_000_000 + 13 * DAY)
    await d.tasks.moveTask('alice', p.id, fresh.id, { columnId: done.id })
    // Дефолт проекта — 14 дней: старая уже за порогом, свежая (1 день) нет.
    set(1_700_000_000_000 + 14 * DAY)
    const ids = (await d.tasks.getBoard('alice', p.id))!.tasks.map((t) => t.id)
    expect(ids).not.toContain(old.id)
    expect(ids).toContain(fresh.id)
    const all = (await d.tasks.getBoard('alice', p.id, { includeCompleted: true }))!.tasks.map((t) => t.id)
    expect(all).toContain(old.id)
    expect(all).toContain(fresh.id)
    // Возврат в работу возвращает карточку на доску.
    await d.tasks.moveTask('alice', p.id, old.id, { columnId: dev.id })
    expect((await d.tasks.getBoard('alice', p.id))!.tasks.map((t) => t.id)).toContain(old.id)
    await d.close()
  })

  it('порог 0 скрывает за полночью, пустой порог не скрывает никогда', async () => {
    const { db: d, set } = withClock()
    const p = await d.projects.createProject('alice', { name: 'P' })
    const done = (await d.tasks.getBoard('alice', p.id))!.columns.find((c) => c.semanticType === 'done')!
    const t = (await d.tasks.createTask('alice', p.id, { columnId: done.id, title: 'T' }))!
    expect((await d.projects.updateProject('alice', p.id, { doneRetentionDays: 0 }))!.doneRetentionDays).toBe(0)
    // День завершения карточка досиживает: перенос в «Готово» делает и CI-ран.
    expect((await d.tasks.getBoard('alice', p.id))!.tasks.map((x) => x.id)).toContain(t.id)
    set(new Date(1_700_000_000_000).setHours(24, 0, 0, 0))
    expect((await d.tasks.getBoard('alice', p.id))!.tasks.map((x) => x.id)).not.toContain(t.id)
    expect((await d.projects.updateProject('alice', p.id, { doneRetentionDays: null }))!.doneRetentionDays).toBeNull()
    set(1_700_000_000_000 + 999 * DAY)
    expect((await d.tasks.getBoard('alice', p.id))!.tasks.map((x) => x.id)).toContain(t.id)
    await d.close()
  })

  it('по умолчанию проект держит завершённые 14 дней', async () => {
    const { db: d } = withClock()
    expect((await d.projects.createProject('alice', { name: 'P' })).doneRetentionDays).toBe(14)
    await d.close()
  })

  it('сортирует «Готово» по последнему входу, а не по updatedAt', async () => {
    const { db: d, set } = withClock()
    const p = await d.projects.createProject('alice', { name: 'P' })
    await d.projects.updateProject('alice', p.id, { doneRetentionDays: null })
    const columns = (await d.tasks.getBoard('alice', p.id))!.columns
    const done = columns.find((column) => column.semanticType === 'done')!
    const dev = columns.find((column) => column.semanticType === 'development')!
    const first = (await d.tasks.createTask('alice', p.id, { columnId: dev.id, title: 'Первая' }))!
    const second = (await d.tasks.createTask('alice', p.id, { columnId: dev.id, title: 'Вторая' }))!

    set(1_700_000_100_000)
    await d.tasks.moveTask('alice', p.id, first.id, { columnId: done.id })
    set(1_700_000_200_000)
    await d.tasks.moveTask('alice', p.id, second.id, { columnId: done.id })
    set(1_700_000_300_000)
    await d.tasks.updateTask('alice', p.id, second.id, { title: 'Вторая (исправлена)' })
    expect((await d.tasks.getBoard('alice', p.id))!.tasks.filter((task) => task.columnId === done.id).map((task) => task.id))
      .toEqual([second.id, first.id])

    set(1_700_000_400_000)
    await d.tasks.moveTask('alice', p.id, first.id, { columnId: dev.id })
    set(1_700_000_500_000)
    await d.tasks.moveTask('alice', p.id, first.id, { columnId: done.id })
    expect((await d.tasks.getBoard('alice', p.id))!.tasks.filter((task) => task.columnId === done.id).map((task) => task.id))
      .toEqual([first.id, second.id])
    await d.close()
  })

  it.skipIf(ON_POSTGRES)('порядок «Готово» переживает перезапуск БД', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-done-order-'))
    const file = join(dir, 'db.sqlite')
    let clock = 1_700_000_000_000
    const firstDb = new VoiceChatDb(file, { newId: (() => { let id = 0; return () => `task-${++id}` })(), now: () => clock })
    await firstDb.ready
    await firstDb.identity.createUser('alice', '', 'developer')
    const p = await firstDb.projects.createProject('alice', { name: 'P' })
    await firstDb.projects.updateProject('alice', p.id, { doneRetentionDays: null })
    const columns = (await firstDb.tasks.getBoard('alice', p.id))!.columns
    const dev = columns.find((column) => column.semanticType === 'development')!
    const done = columns.find((column) => column.semanticType === 'done')!
    const older = (await firstDb.tasks.createTask('alice', p.id, { columnId: dev.id, title: 'Старая' }))!
    const newer = (await firstDb.tasks.createTask('alice', p.id, { columnId: dev.id, title: 'Новая' }))!
    clock += 1
    await firstDb.tasks.moveTask('alice', p.id, older.id, { columnId: done.id })
    clock += 1
    await firstDb.tasks.moveTask('alice', p.id, newer.id, { columnId: done.id })
    await firstDb.close()
    const restarted = new VoiceChatDb(file, { now: () => clock })

    await restarted.ready
    expect((await restarted.tasks.getBoard('alice', p.id))!.tasks.filter((task) => task.columnId === done.id).map((task) => task.id))
      .toEqual([newer.id, older.id])
    await restarted.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it.skipIf(ON_POSTGRES)('миграция: у лежащих в «Готово» задач появляется doneAt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-doneat-'))
    const file = join(dir, 'db.sqlite')
    const first = new VoiceChatDb(file, { now: () => 1_700_000_000_000 })
    await first.ready
    await first.identity.createUser('alice', '', 'developer')
    const p = await first.projects.createProject('alice', { name: 'P' })
    const done = (await first.tasks.getBoard('alice', p.id))!.columns.find((c) => c.semanticType === 'done')!
    const t = (await first.tasks.createTask('alice', p.id, { columnId: done.id, title: 'T' }))!
    // Имитируем БД до миграции: колонки done_at ещё нет.
    await first.close()
    const raw = new Database(file)
    raw.exec(`ALTER TABLE tasks DROP COLUMN done_at`)
    await raw.close()
    const migrated = new VoiceChatDb(file, { now: () => 1_700_000_000_000 + 100 * 24 * 60 * 60 * 1000 })

    await migrated.ready
    // doneAt взят из updated_at, порог 14 дней уже вышел — карточки на доске нет.
    expect((await migrated.tasks.getBoard('alice', p.id))!.tasks.map((x) => x.id)).not.toContain(t.id)
    expect((await migrated.tasks.getBoard('alice', p.id, { includeCompleted: true }))!.tasks.find((x) => x.id === t.id)!.doneAt)
      .toBe(1_700_000_000_000)
    await migrated.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('projects: чаты завершённых задач в списке бесед', () => {
  /** Проект с задачей в работе, её чатом и колонкой «Готово». */
  async function withTaskChat(): Promise<{ pid: string; taskId: string; chatId: string; dev: string; done: string }> {
    const p = await db.projects.createProject('alice', { name: 'P' })
    const board = (await db.tasks.getBoard('alice', p.id))!
    const dev = board.columns[0]!
    const done = board.columns.find((c) => c.semanticType === 'done')!
    const task = (await db.tasks.createTask('alice', p.id, { columnId: dev.id, title: 'Скролл' }))!
    const chat = (await db.chat.openOrCreateTaskChat('alice', p.id, task.id))!
    return { pid: p.id, taskId: task.id, chatId: chat.id, dev: dev.id, done: done.id }
  }

  it('задача в «Готово» убирает свой чат из списка, возврат в работу — возвращает', async () => {
    const { pid, taskId, chatId, dev, done } = await withTaskChat()
    expect((await db.chat.listConversations('alice', { scope: 'kanban', projectId: pid })).map((c) => c.id)).toContain(chatId)

    await db.tasks.moveTask('alice', pid, taskId, { columnId: done })
    expect((await db.chat.listConversations('alice', { scope: 'kanban', projectId: pid })).map((c) => c.id)).not.toContain(chatId)
    // Скрытие — только про список: сам чат открывается по id как раньше.
    expect((await db.chat.getConversation('alice', chatId))!.id).toBe(chatId)
    expect((await db.chat.listConversations('alice', { scope: 'kanban', projectId: pid, includeCompleted: true })).map((c) => c.id)).toContain(chatId)

    await db.tasks.moveTask('alice', pid, taskId, { columnId: dev })
    expect((await db.chat.listConversations('alice', { scope: 'kanban', projectId: pid })).map((c) => c.id)).toContain(chatId)
  })

  it('cancelled скрывает чат всегда, а возврат восстанавливает историю', async () => {
    const { pid, taskId, chatId, dev } = await withTaskChat()
    const cancelled = (await db.tasks.getBoard('alice', pid))!.columns.find((c) => c.semanticType === 'cancelled')!
    await db.chat.addMessage('alice', chatId, 'u0', 'сохранить историю', '10:00')

    await db.tasks.moveTask('alice', pid, taskId, { columnId: cancelled.id })
    expect((await db.chat.listConversations('alice', { scope: 'kanban', projectId: pid })).map((c) => c.id)).not.toContain(chatId)
    expect((await db.chat.listConversations('alice', { scope: 'kanban', projectId: pid, includeCompleted: true })).map((c) => c.id)).not.toContain(chatId)
    expect((await db.chat.searchConversations('alice', 'Скролл', { scope: 'kanban', projectId: pid, includeCompleted: true })).map((c) => c.id)).not.toContain(chatId)
    expect((await db.chat.getConversation('alice', chatId))!.taskId).toBe(taskId)
    expect((await db.chat.listMessages('alice', chatId)).map((m) => m.text)).toEqual(['сохранить историю'])

    await db.tasks.moveTask('alice', pid, taskId, { columnId: dev })
    expect((await db.chat.listConversations('alice', { scope: 'kanban', projectId: pid })).map((c) => c.id)).toContain(chatId)
    expect((await db.chat.listMessages('alice', chatId)).map((m) => m.text)).toEqual(['сохранить историю'])
  })

  it('отмена определяется семантикой, а не именем или порядком колонки', async () => {
    const { pid, taskId, chatId } = await withTaskChat()
    const board = (await db.tasks.getBoard('alice', pid))!
    const cancelled = board.columns.find((c) => c.semanticType === 'cancelled')!
    expect(await db.projects.updateColumn('alice', pid, cancelled.id, { name: 'Никогда не делать' })).toBe(true)
    expect(await db.projects.reorderColumns('alice', pid, [cancelled.id, ...board.columns.filter((c) => c.id !== cancelled.id).map((c) => c.id)])).toBe(true)
    await db.tasks.moveTask('alice', pid, taskId, { columnId: cancelled.id })
    expect((await db.chat.listConversations('alice', { scope: 'kanban', projectId: pid })).map((c) => c.id)).not.toContain(chatId)
  })

  it('скрытие не зависит от порога дней: done — и чата в списке нет', async () => {
    const { pid, taskId, chatId, done } = await withTaskChat()
    // Порог «не скрывать никогда» держит карточку на доске, но не чат в списке.
    await db.projects.updateProject('alice', pid, { doneRetentionDays: null })
    await db.tasks.moveTask('alice', pid, taskId, { columnId: done })
    expect((await db.tasks.getBoard('alice', pid))!.tasks.map((t) => t.id)).toContain(taskId)
    expect((await db.chat.listConversations('alice', { scope: 'kanban', projectId: pid })).map((c) => c.id)).not.toContain(chatId)
  })

  it('поиск по беседам скрывает те же чаты', async () => {
    const { pid, taskId, chatId, done } = await withTaskChat()
    expect((await db.chat.searchConversations('alice', 'Скролл', { scope: 'kanban', projectId: pid })).map((c) => c.id)).toContain(chatId)
    await db.tasks.moveTask('alice', pid, taskId, { columnId: done })
    expect((await db.chat.searchConversations('alice', 'Скролл', { scope: 'kanban', projectId: pid })).map((c) => c.id)).not.toContain(chatId)
    expect((await db.chat.searchConversations('alice', 'Скролл', { scope: 'kanban', projectId: pid, includeCompleted: true })).map((c) => c.id)).toContain(chatId)
  })

  it('отмена отдельного CI-рана не скрывает чат активной задачи', async () => {
    const { pid, taskId, chatId, dev } = await withTaskChat()
    const run = await db.ci.createCiRun({
      projectId: pid,
      taskId,
      agentId: null,
      triggeredBy: 'alice',
      prevColumnId: dev,
      runColumnId: dev,
      slotProgress: { done: 0, total: 1, phase: 'Отменён' }
    })
    await db.ci.updateCiRun(run.id, { status: 'cancelled', terminalColumnId: dev })

    expect((await db.chat.listConversations('alice', { scope: 'kanban', projectId: pid })).map((c) => c.id)).toContain(chatId)
    expect((await db.tasks.getBoard('alice', pid))!.tasks.find((task) => task.id === taskId)!.columnId).toBe(dev)
  })

  it('обычные чаты (без задачи) в списке остаются', async () => {
    const { pid, taskId, done } = await withTaskChat()
    const plain = await db.chat.createConversation('alice', 'Просто чат')
    await db.tasks.moveTask('alice', pid, taskId, { columnId: done })
    expect((await db.chat.listConversations('alice', { scope: 'chat' })).map((c) => c.id)).toContain(plain.id)
  })
})

describe('projects: пред-разработческая подготовка', () => {
  it('атомарно создаёт отдельный ран и переводит TODO в preparation', async () => {
    const project = await db.projects.createProject('alice', { name: 'Preparation' })
    const board = (await db.tasks.getBoard('alice', project.id))!
    const backlog = board.columns.find((column) => column.semanticType === 'backlog')!
    const preparation = board.columns.find((column) => column.semanticType === 'preparation')!
    const task = (await db.tasks.createTask('alice', project.id, { columnId: backlog.id, title: 'Уточнить workflow' }))!
    const run = await db.tasks.startTaskPreparationRun('alice', project.id, task.id)
    expect(run.status).toBe('running')
    expect((await db.tasks.getBoard('alice', project.id))!.tasks.find((item) => item.id === task.id)!.columnId).toBe(preparation.id)
    expect((await db.tasks.startTaskPreparationRun('alice', project.id, task.id)).id).toBe(run.id)
  })

  it('ошибка оставляет карточку в preparation и разрешает повтор', async () => {
    const project = await db.projects.createProject('alice', { name: 'Preparation failure' })
    const board = (await db.tasks.getBoard('alice', project.id))!
    const backlog = board.columns.find((column) => column.semanticType === 'backlog')!
    const preparation = board.columns.find((column) => column.semanticType === 'preparation')!
    const task = (await db.tasks.createTask('alice', project.id, { columnId: backlog.id, title: 'Неполные требования' }))!
    const run = await db.tasks.startTaskPreparationRun('alice', project.id, task.id)
    await db.tasks.failTaskPreparationRun(run.id, 'Гейт не пройден', ['missing_acceptance_criteria'])
    expect(await db.tasks.getTaskPreparationRun('alice', run.id)).toMatchObject({ status: 'failed', canRetry: true, gateReasons: ['missing_acceptance_criteria'] })
    expect((await db.tasks.getBoard('alice', project.id))!.tasks.find((item) => item.id === task.id)!.columnId).toBe(preparation.id)
    const retry = await db.tasks.startTaskPreparationRun('alice', project.id, task.id)
    expect(retry).toMatchObject({ status: 'running', attempt: 2 })
    expect((await db.tasks.listTaskPreparationRuns('alice', project.id, task.id)).map((item) => item.id)).toEqual([retry.id, run.id])
  })
})
