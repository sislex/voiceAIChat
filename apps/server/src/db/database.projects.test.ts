import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { VoiceChatDb } from './database.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS } from '@voicechat/shared'

let db: VoiceChatDb

beforeEach(() => {
  let id = 0
  let clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  db.identity.createUser('alice', '', 'developer')
  db.identity.createUser('bob', '', 'developer')
  db.identity.createUser('carol', '', 'developer')
})

afterEach(() => db.close())

describe('projects: миграция имён связанных чатов', () => {
  it('старый чат задачи получает префикс «Задача », переименованный вручную — нет', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-taskchat-'))
    const file = join(dir, 'db.sqlite')
    const first = new VoiceChatDb(file)
    first.identity.createUser('alice', '', 'developer')
    const p = first.projects.createProject('alice', { name: 'P' })
    const col = first.tasks.getBoard('alice', p.id)!.columns[0]
    const t1 = first.tasks.createTask('alice', p.id, { columnId: col.id, title: 'Скролл' })!
    const t2 = first.tasks.createTask('alice', p.id, { columnId: col.id, title: 'Пагинация' })!
    const old1 = first.chat.openOrCreateTaskChat('alice', p.id, t1.id)!
    const old2 = first.chat.openOrCreateTaskChat('alice', p.id, t2.id)!
    // Имитируем чаты, созданные до префикса: имя = заголовок задачи.
    first.chat.renameConversation('alice', old1.id, 'Скролл')
    first.chat.renameConversation('alice', old2.id, 'Мои заметки по пагинации')
    first.close()

    const migrated = new VoiceChatDb(file)
    expect(migrated.chat.getConversation('alice', old1.id)!.title).toBe('Задача Скролл')
    // Пользовательское имя не трогаем.
    expect(migrated.chat.getConversation('alice', old2.id)!.title).toBe('Мои заметки по пагинации')
    migrated.close()

    // Повторный старт не наращивает префикс.
    const again = new VoiceChatDb(file)
    expect(again.chat.getConversation('alice', old1.id)!.title).toBe('Задача Скролл')
    again.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('projects: миграция владельцев', () => {
  it('добавляет created_by владельцем старого проекта и сохраняет остальных участников', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-project-owner-'))
    const file = join(dir, 'db.sqlite')
    const first = new VoiceChatDb(file)
    first.identity.createUser('alice', '', 'developer')
    first.identity.createUser('bob', '', 'developer')
    const project = first.projects.createProject('alice', { name: 'Legacy' })
    first.projects.addMember('alice', project.id, 'bob')
    first.close()

    const raw = new Database(file)
    raw.prepare(`DELETE FROM project_members WHERE project_id = ? AND username = 'alice'`).run(project.id)
    raw.close()

    const migrated = new VoiceChatDb(file)
    expect(migrated.projects.getProject('alice', project.id)!.members).toEqual([
      expect.objectContaining({ username: 'alice', role: 'owner' }),
      expect.objectContaining({ username: 'bob', role: 'member' })
    ])
    migrated.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('projects: миграция канонического workflow', () => {
  it('досоздаёт недостающие системные колонки на существующей БД (инцидент 2026-08-18)', () => {
    // Регрессия: миграция вызывала this.newId() до его присвоения в конструкторе
    // и роняла сервер при старте на любой БД, где проекту не хватало колонки.
    const dir = mkdtempSync(join(tmpdir(), 'vc-kanban-missing-col-'))
    const file = join(dir, 'db.sqlite')
    const first = new VoiceChatDb(file)
    first.identity.createUser('alice', '', 'developer')
    const project = first.projects.createProject('alice', { name: 'Старый проект' })
    first.close()

    const raw = new Database(file)
    raw.prepare(`DELETE FROM kanban_columns WHERE project_id=? AND semantic_type='decision_required'`).run(project.id)
    raw.close()

    const migrated = new VoiceChatDb(file)
    const board = migrated.tasks.getBoard('alice', project.id)!
    expect(board.columns.some((item) => item.semanticType === 'decision_required')).toBe(true)
    migrated.close()
  })

  it('назначает cancelled существующей колонке по семантике, а имя использует только без неё', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-kanban-cancelled-'))
    const file = join(dir, 'db.sqlite')
    const first = new VoiceChatDb(file)
    first.identity.createUser('alice', '', 'developer')
    const project = first.projects.createProject('alice', { name: 'Legacy cancelled' })
    const board = first.tasks.getBoard('alice', project.id)!
    const canonical = board.columns.find((item) => item.semanticType === 'cancelled')!
    const legacy = first.projects.createColumn('alice', project.id, 'Отменены')!
    const taskA = first.tasks.createTask('alice', project.id, { columnId: legacy.id, title: 'Первая' })!
    const taskB = first.tasks.createTask('alice', project.id, { columnId: legacy.id, title: 'Вторая' })!
    first.close()

    const raw = new Database(file)
    raw.prepare(`DELETE FROM kanban_columns WHERE id=?`).run(canonical.id)
    raw.close()

    const migrated = new VoiceChatDb(file)
    const migratedBoard = migrated.tasks.getBoard('alice', project.id)!
    const cancelled = migratedBoard.columns.find((item) => item.semanticType === 'cancelled')!
    expect(cancelled.id).toBe(legacy.id)
    expect(migratedBoard.tasks.filter((item) => item.columnId === legacy.id).map(({ id, position }) => ({ id, position })))
      .toEqual([{ id: taskA.id, position: taskA.position }, { id: taskB.id, position: taskB.position }])
    migrated.close()

    const again = new VoiceChatDb(file)
    expect(again.tasks.getBoard('alice', project.id)!.columns.filter((item) => item.semanticType === 'cancelled').map((item) => item.id))
      .toEqual([legacy.id])
    again.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('переупорядочивает старую доску, переносит legacy-карточки и повторно ничего не меняет', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-kanban-workflow-'))
    const file = join(dir, 'db.sqlite')
    const first = new VoiceChatDb(file)
    first.identity.createUser('alice', '', 'developer')
    const project = first.projects.createProject('alice', { name: 'Legacy workflow' })
    const initial = first.tasks.getBoard('alice', project.id)!
    const column = (semantic: string) => initial.columns.find((item) => item.semanticType === semantic)!
    const testing = first.projects.createColumn('alice', project.id, 'Старое тестирование')!
    const preparation = first.projects.createColumn('alice', project.id, 'Старые сценарии')!
    const readyDuplicate = first.projects.createColumn('alice', project.id, 'Дубликат Ready')!
    const custom = first.projects.createColumn('alice', project.id, 'Пользовательская')!
    first.projects.setColumnHidden('alice', project.id, custom.id, true)
    first.tasks.createTask('alice', project.id, { columnId: column('automated_qa').id, title: 'Уже Automated' })
    first.tasks.createTask('alice', project.id, { columnId: testing.id, title: 'Из Testing' })
    first.tasks.createTask('alice', project.id, { columnId: column('component_qa').id, title: 'Уже Component' })
    first.tasks.createTask('alice', project.id, { columnId: preparation.id, title: 'Из QA Preparation' })
    first.tasks.createTask('alice', project.id, { columnId: readyDuplicate.id, title: 'Из дубля Ready' })
    first.close()

    const raw = new Database(file)
    raw.prepare(`UPDATE kanban_columns SET semantic_type='testing' WHERE id=?`).run(testing.id)
    raw.prepare(`UPDATE kanban_columns SET semantic_type='qa_preparation' WHERE id=?`).run(preparation.id)
    raw.prepare(`UPDATE kanban_columns SET semantic_type='ready' WHERE id=?`).run(readyDuplicate.id)
    raw.prepare(`UPDATE kanban_columns SET position=-position WHERE project_id=?`).run(project.id)
    raw.prepare(`UPDATE kanban_columns SET name='Мой Ready', hidden=1, position=-999999 WHERE id=?`).run(column('ready').id)
    raw.close()

    const migrated = new VoiceChatDb(file)
    const board = migrated.tasks.getBoard('alice', project.id)!
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
    migrated.close()

    const again = new VoiceChatDb(file)
    const stable = again.tasks.getBoard('alice', project.id)!
    expect({
      columns: stable.columns.map(({ id, semanticType, position, hidden }) => ({ id, semanticType, position, hidden })),
      tasks: stable.tasks.map(({ id, columnId, position }) => ({ id, columnId, position }))
    }).toEqual(snapshot)
    again.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('projects: лёгкая доска и полная задача', () => {
  it('board гасит тяжёлые тексты, а getTaskDetail отдаёт их полностью', () => {
    const p = db.projects.createProject('alice', { name: 'Light board' })
    const col = db.tasks.getBoard('alice', p.id)!.columns[0]
    const task = db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'T' })!
    db.tasks.updateTask('alice', p.id, task.id, { description: 'Длинное описание задачи', acceptanceCriteria: 'Критерии приёмки' })
    const boardTask = db.tasks.getBoard('alice', p.id)!.tasks.find((t) => t.id === task.id)!
    // Лёгкая карточка: тяжёлые тексты пустые, но поля для превью на месте.
    expect(boardTask.description).toBe('')
    expect(boardTask.acceptanceCriteria).toBe('')
    // Лог подготовки доска не отдаёт вовсе — он живёт только в полной карточке.
    expect(boardTask.taskPreparationLog).toBeUndefined()
    expect(boardTask.title).toBe('T')
    // Полная задача — по id.
    const full = db.tasks.getTaskDetail('alice', p.id, task.id)!
    expect(full.description).toBe('Длинное описание задачи')
    expect(full.acceptanceCriteria).toBe('Критерии приёмки')
    // Изоляция: не участник проекта не получает задачу.
    expect(db.tasks.getTaskDetail('bob', p.id, task.id)).toBeNull()
  })
})

describe('projects: две фазы доски', () => {
  /** Проект с задачей и её чатом — на нём видно, что где отдаётся. */
  function withTask(): { pid: string; taskId: string; chatId: string } {
    const p = db.projects.createProject('alice', { name: 'Phases' })
    const column = db.tasks.getBoardSkeleton('alice', p.id)!.columns[0]!
    const task = db.tasks.createTask('alice', p.id, { columnId: column.id, title: 'Двухфазная' })!
    const chat = db.chat.openOrCreateTaskChat('alice', p.id, task.id)!
    return { pid: p.id, taskId: task.id, chatId: chat.id }
  }

  it('скелет отдаёт карточку без состояния процессов, статусы — только состояние', () => {
    const { pid, taskId, chatId } = withTask()
    const skeleton = db.tasks.getBoardSkeleton('alice', pid)!
    const card = skeleton.tasks.find((t) => t.id === taskId)!
    expect(card.title).toBe('Двухфазная')
    // Ради этого разделения всё и затевалось: первая фаза не ходит в раны и чаты.
    expect(card.chatId).toBeUndefined()
    expect(card.latestRunResult).toBeUndefined()
    expect(card.mergePermitted).toBeUndefined()
    expect(skeleton.ciRuns).toBeUndefined()

    const statuses = db.tasks.getBoardStatuses('alice', pid)!
    const status = statuses.tasks.find((t) => t.taskId === taskId)!
    expect(status.chatId).toBe(chatId)
    expect(status.latestRunResult).toBeNull()
    // Право на merge — свойство участника: у владельца проекта оно есть.
    expect(status.mergePermitted).toBe(true)
    expect(statuses.ciRuns).toEqual([])
  })

  it('getBoard склеивает обе фазы — прежний снапшот для MCP и автопрохода', () => {
    const { pid, taskId, chatId } = withTask()
    const board = db.tasks.getBoard('alice', pid)!
    const card = board.tasks.find((t) => t.id === taskId)!
    expect(card.title).toBe('Двухфазная')
    expect(card.chatId).toBe(chatId)
    expect(card.mergePermitted).toBe(true)
    expect(board.ciRuns).toEqual([])
  })

  it('обе фазы видят один и тот же набор задач, включая отсечку завершённых', () => {
    let clock = 1_700_000_000_000
    const d = new VoiceChatDb(':memory:', { now: () => clock })
    d.identity.createUser('alice', '', 'developer')
    const p = d.projects.createProject('alice', { name: 'Retention' })
    const cols = d.tasks.getBoardSkeleton('alice', p.id)!.columns
    const done = cols.find((c) => c.semanticType === 'done')!
    const task = d.tasks.createTask('alice', p.id, { columnId: cols[0]!.id, title: 'T' })!
    d.projects.updateProject('alice', p.id, { doneRetentionDays: 0 })
    d.tasks.moveTask('alice', p.id, task.id, { columnId: done.id })
    const skeletonIds = (opts?: { includeCompleted?: boolean }): string[] => d.tasks.getBoardSkeleton('alice', p.id, opts)!.tasks.map((t) => t.id)
    const statusIds = (opts?: { includeCompleted?: boolean }): string[] => d.tasks.getBoardStatuses('alice', p.id, opts)!.tasks.map((t) => t.taskId)

    // Порог 0 — «до конца дня завершения»: сегодня карточка ещё на доске.
    expect(skeletonIds()).toContain(task.id)
    expect(statusIds()).toContain(task.id)

    clock = new Date(clock).setHours(24, 0, 0, 0)
    // На следующий день карточка уходит — одинаково в обеих фазах, иначе статусы
    // приезжали бы для задач, которых на доске уже нет (или наоборот).
    expect(skeletonIds()).not.toContain(task.id)
    expect(statusIds()).not.toContain(task.id)
    expect(skeletonIds({ includeCompleted: true })).toContain(task.id)
    expect(statusIds({ includeCompleted: true })).toContain(task.id)
    d.close()
  })

  it('сводки CI приходят только по карточкам доски, а не по всей истории проекта', () => {
    let clock = 1_700_000_000_000
    const d = new VoiceChatDb(':memory:', { now: () => clock })
    d.identity.createUser('alice', '', 'developer')
    const p = d.projects.createProject('alice', { name: 'CI scope' })
    d.projects.updateProject('alice', p.id, { doneRetentionDays: 0 })
    const cols = d.tasks.getBoardSkeleton('alice', p.id)!.columns
    const dev = cols[0]!
    const done = cols.find((c) => c.semanticType === 'done')!
    const onBoard = d.tasks.createTask('alice', p.id, { columnId: dev.id, title: 'На доске' })!
    const archived = d.tasks.createTask('alice', p.id, { columnId: dev.id, title: 'Давно закрыта' })!
    const run = (taskId: string): void => {
      const created = d.ci.createCiRun({ projectId: p.id, taskId, agentId: null, triggeredBy: 'alice', prevColumnId: dev.id, runColumnId: dev.id, slotProgress: { done: 1, total: 1, phase: 'Готово' } })
      d.ci.updateCiRun(created.id, { status: 'success', durationMs: 100 })
    }
    run(onBoard.id)
    run(archived.id)
    d.tasks.moveTask('alice', p.id, archived.id, { columnId: done.id })
    clock = new Date(clock).setHours(24, 0, 0, 0)

    // Закрытая вчера карточка ушла с доски — её сводка не должна ехать с доской:
    // на боевом проекте так набегал мегабайт истории на 19 видимых задач.
    const statuses = d.tasks.getBoardStatuses('alice', p.id)!
    expect(statuses.tasks.map((t) => t.taskId)).toEqual([onBoard.id])
    expect(statuses.ciRuns.map((r) => r.taskId)).toEqual([onBoard.id])
    // С включённым «показывать завершённые» история доступна целиком.
    expect(d.tasks.getBoardStatuses('alice', p.id, { includeCompleted: true })!.ciRuns.map((r) => r.taskId).sort())
      .toEqual([onBoard.id, archived.id].sort())
    d.close()
  })

  it('не участник проекта не получает ни скелета, ни статусов', () => {
    const { pid } = withTask()
    expect(db.tasks.getBoardSkeleton('bob', pid)).toBeNull()
    expect(db.tasks.getBoardStatuses('bob', pid)).toBeNull()
  })
})

describe('projects: создание и членство', () => {
  it('createProject сеет владельца и дефолтные колонки', () => {
    const p = db.projects.createProject('alice', { name: 'P1', description: 'd', technologies: ['ts'], skills: ['db'] })
    expect(p.name).toBe('P1')
    expect(p.role).toBe('owner')
    expect(p.createdBy).toBe('alice')
    expect(p.technologies).toEqual(['ts'])
    expect(p.members.map((m) => m.username)).toEqual(['alice'])
    expect(p.members[0].role).toBe('owner')
    const board = db.tasks.getBoard('alice', p.id)!
    expect(board.columns.map((c) => c.name)).toEqual(['Бэклог', 'Подготовка к разработке', 'Ready for Development', 'Development', 'Component QA', 'Создание интеграционных автотестов', 'Automated QA', 'Ручное QA', 'Ожидает мержа', 'Мерж', 'Готово', 'Отменено', 'Требуется решение'])
    expect(board.tasks).toEqual([])
  })

  it('изоляция: не-участник не видит проект', () => {
    const p = db.projects.createProject('alice', { name: 'P1' })
    expect(db.projects.listProjects('alice').map((x) => x.id)).toContain(p.id)
    expect(db.projects.listProjects('bob')).toEqual([])
    expect(db.projects.getProject('bob', p.id)).toBeNull()
    expect(db.tasks.getBoard('bob', p.id)).toBeNull()
  })

  it('addMember открывает доступ; роль участника = member', () => {
    const p = db.projects.createProject('alice', { name: 'P1' })
    db.projects.addMember('alice', p.id, 'bob')
    const asBob = db.projects.getProject('bob', p.id)!
    expect(asBob.role).toBe('member')
    expect(db.projects.listProjects('bob').map((x) => x.id)).toContain(p.id)
  })

  it('addMember только владельцем и только существующего пользователя', () => {
    const p = db.projects.createProject('alice', { name: 'P1' })
    db.projects.addMember('alice', p.id, 'bob')
    expect(db.projects.addMember('bob', p.id, 'carol')).toBeNull() // bob не владелец
    expect(() => db.projects.addMember('alice', p.id, 'nobody')).toThrow()
  })

  it('updateProject/deleteProject — только владелец', () => {
    const p = db.projects.createProject('alice', { name: 'P1' })
    db.projects.addMember('alice', p.id, 'bob')
    expect(db.projects.updateProject('bob', p.id, { name: 'X' })).toBeNull()
    const upd = db.projects.updateProject('alice', p.id, { name: 'P1b', gitUrl: 'git@x' })!
    expect(upd.name).toBe('P1b')
    expect(upd.gitUrl).toBe('git@x')
    expect(db.projects.deleteProject('bob', p.id)).toBe(false)
    expect(db.projects.deleteProject('alice', p.id)).toBe(true)
    expect(db.projects.getProject('alice', p.id)).toBeNull()
  })

  it('removeMember снимает назначения и защищает последнего владельца', () => {
    const p = db.projects.createProject('alice', { name: 'P1' })
    db.projects.addMember('alice', p.id, 'bob')
    const col = db.tasks.getBoard('alice', p.id)!.columns[0]
    const task = db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'T', assignee: 'bob' })!
    expect(task.assignee).toBe('bob')
    db.projects.removeMember('alice', p.id, 'bob')
    expect(db.projects.getProject('bob', p.id)).toBeNull()
    expect(db.tasks.getBoard('alice', p.id)!.tasks[0].assignee).toBeNull()
    expect(() => db.projects.removeMember('alice', p.id, 'alice')).toThrow('последнего владельца')
  })

  it('поддерживает нескольких равноправных владельцев, выход и аудит ролей', () => {
    const p = db.projects.createProject('alice', { name: 'P1' })
    db.projects.addMember('alice', p.id, 'bob')
    db.projects.updateMemberRole('alice', p.id, 'bob', 'owner')
    expect(db.projects.getProject('bob', p.id)!.role).toBe('owner')
    expect(db.projects.updateProject('bob', p.id, { name: 'От Bob' })!.name).toBe('От Bob')

    db.projects.removeMember('bob', p.id, 'alice')
    expect(db.projects.getProject('alice', p.id)).toBeNull()
    expect(db.projects.getProject('bob', p.id)!.members).toEqual([
      expect.objectContaining({ username: 'bob', role: 'owner' })
    ])
    expect(db.projects.listProjectMemberRoleAudit(p.id)).toEqual([
      expect.objectContaining({ actor: 'alice', targetUser: 'bob', oldRole: null, newRole: 'member', action: 'add' }),
      expect.objectContaining({ actor: 'alice', targetUser: 'bob', oldRole: 'member', newRole: 'owner', action: 'role_change' }),
      expect.objectContaining({ actor: 'bob', targetUser: 'alice', oldRole: 'owner', newRole: null, action: 'remove' })
    ])
  })

  it('не назначает владельцем не-участника и не позволяет двум владельцам убрать последнего', () => {
    const p = db.projects.createProject('alice', { name: 'P1' })
    expect(() => db.projects.updateMemberRole('alice', p.id, 'bob', 'owner')).toThrow('Сначала добавьте')
    db.projects.addMember('alice', p.id, 'bob')
    db.projects.updateMemberRole('alice', p.id, 'bob', 'owner')
    db.projects.updateMemberRole('alice', p.id, 'bob', 'member')
    expect(() => db.projects.updateMemberRole('alice', p.id, 'alice', 'member')).toThrow('последнего владельца')
    expect(db.projects.getProject('alice', p.id)!.members.filter((m) => m.role === 'owner')).toHaveLength(1)
  })
})

describe('projects: машины', () => {
  it('linkMachine валидирует владение агентом; каскад при удалении агента', () => {
    const p = db.projects.createProject('alice', { name: 'P1' })
    const agent = db.machines.createAgent('alice', 'M1')
    const foreign = db.machines.createAgent('bob', 'M2')
    expect(() => db.machines.linkMachine('alice', p.id, foreign.id)).toThrow() // чужой агент
    const detail = db.machines.linkMachine('alice', p.id, agent.id)!
    expect(detail.machines.map((m) => m.agentId)).toEqual([agent.id])
    db.machines.deleteAgent('alice', agent.id) // CASCADE снимает связь
    expect(db.projects.getProject('alice', p.id)!.machines).toEqual([])
  })

  it('автоматически выбирает единственный storage и сохраняет managed defaults', () => {
    const p = db.projects.createProject('alice', { name: 'P1' })
    const agent = db.machines.createAgent('alice', 'M1')
    const storage = db.machines.saveMachineStorage('alice', agent.id, '/home/alice/ChatAI', 1)
    const machine = db.machines.linkMachine('alice', p.id, agent.id)!.machines[0]
    expect(machine.storageId).toBe(storage.id)
    expect(machine.path).toBe(`/home/alice/ChatAI/projects/${p.id}/worktree`)
    expect(machine.reposRoot).toBe(`/home/alice/ChatAI/projects/${p.id}/repositories`)
    expect(machine.directories?.production.override).toBe(false)
    expect(machine.readiness?.ready).toBe(true)
    expect(db.projects.getProject('alice', p.id)!.machines[0].directories).toEqual(machine.directories)
  })

  it('сохраняет overrides при смене storage и отклоняет чужой storage', () => {
    const p = db.projects.createProject('alice', { name: 'P1' })
    const agent = db.machines.createAgent('alice', 'M1')
    const other = db.machines.createAgent('bob', 'M2')
    const first = db.machines.saveMachineStorage('alice', agent.id, '/mnt/a', 1)
    const second = db.machines.saveMachineStorage('alice', agent.id, '/mnt/b', 1)
    const foreign = db.machines.saveMachineStorage('bob', other.id, '/mnt/foreign', 1)
    const initial = db.machines.linkMachine('alice', p.id, agent.id, first.id)!.machines[0]
    const directories = structuredClone(initial.directories!)
    directories.projectWorkdir = { path: '/legacy/project', override: true }
    const updated = db.machines.configureProjectMachineStorage('alice', p.id, agent.id, second.id, directories)!.machines[0]
    expect(updated.path).toBe('/legacy/project')
    expect(updated.recommendations?.projectWorkdir).toContain('/mnt/b/')
    const reset = db.machines.resetProjectMachineDirectory('alice', p.id, agent.id, 'projectWorkdir')!.machines[0]
    expect(reset.path).toBe(reset.recommendations?.projectWorkdir)
    expect(reset.directories?.projectWorkdir.override).toBe(false)
    expect(() => db.machines.setProjectMachinePath('alice', p.id, agent.id, '../escape')).toThrow()
    expect(() => db.machines.configureProjectMachineStorage('alice', p.id, agent.id, foreign.id)).toThrow(/не принадлежит/)
  })

  it('сохраняет legacy path и reposRoot как overrides при добровольном выборе storage', () => {
    const p = db.projects.createProject('alice', { name: 'Legacy' })
    const agent = db.machines.createAgent('alice', 'M1')
    db.machines.linkMachine('alice', p.id, agent.id)
    db.machines.setProjectMachinePath('alice', p.id, agent.id, '/legacy/project')
    db.machines.setProjectMachineReposRoot('alice', p.id, agent.id, '/legacy/repos')
    const storage = db.machines.saveMachineStorage('alice', agent.id, '/managed/root', 1)
    const machine = db.machines.configureProjectMachineStorage('alice', p.id, agent.id, storage.id)!.machines[0]
    expect(machine.path).toBe('/legacy/project')
    expect(machine.reposRoot).toBe('/legacy/repos')
    expect(machine.directories?.projectWorkdir.override).toBe(true)
    expect(machine.directories?.reposRoot.override).toBe(true)
    expect(machine.recommendations?.projectWorkdir).toContain('/managed/root/projects/')
  })
})

describe('board: колонки и порядок', () => {
  it('createColumn добавляет в конец; reorderColumns переставляет', () => {
    const p = db.projects.createProject('alice', { name: 'P1' })
    const c4 = db.projects.createColumn('alice', p.id, 'Review')!
    let cols = db.tasks.getBoard('alice', p.id)!.columns
    expect(cols.map((c) => c.name)).toEqual(['Бэклог', 'Подготовка к разработке', 'Ready for Development', 'Development', 'Component QA', 'Создание интеграционных автотестов', 'Automated QA', 'Ручное QA', 'Ожидает мержа', 'Мерж', 'Готово', 'Отменено', 'Требуется решение', 'Review'])
    const reversed = cols.map((c) => c.id).reverse()
    expect(db.projects.reorderColumns('alice', p.id, reversed)).toBe(true)
    cols = db.tasks.getBoard('alice', p.id)!.columns
    expect(cols.map((c) => c.id)).toEqual(reversed)
    // неполный/чужой набор — отказ
    expect(db.projects.reorderColumns('alice', p.id, [c4.id])).toBe(false)
  })

  it('setColumnHidden и deleteColumn (каскад задач)', () => {
    const p = db.projects.createProject('alice', { name: 'P1' })
    const col = db.projects.createColumn('alice', p.id, 'Custom')!
    db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'T' })
    expect(db.projects.setColumnHidden('alice', p.id, col.id, true)).toBe(true)
    expect(db.tasks.getBoard('alice', p.id)!.columns.find((c) => c.id === col.id)!.hidden).toBe(true)
    expect(db.projects.deleteColumn('alice', p.id, col.id)).toBe(true)
    const board = db.tasks.getBoard('alice', p.id)!
    expect(board.columns.find((c) => c.id === col.id)).toBeUndefined()
    expect(board.tasks).toEqual([]) // задача ушла по CASCADE
  })
})

describe('board: задачи, приоритеты, assignee, перемещение', () => {
  it('assignee должен быть участником', () => {
    const p = db.projects.createProject('alice', { name: 'P1' })
    const col = db.tasks.getBoard('alice', p.id)!.columns[0]
    expect(() => db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'T', assignee: 'bob' })).toThrow()
    db.projects.addMember('alice', p.id, 'bob')
    const t = db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'T', assignee: 'bob', priority: 'high' })!
    expect(t.assignee).toBe('bob')
    expect(t.priority).toBe('high')
    expect(db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'Без исполнителя', assignee: null })!.assignee).toBeNull()
    expect(() => db.tasks.updateTask('alice', p.id, t.id, { assignee: 'carol' })).toThrow()
    db.identity.setUserBlocked('bob', true)
    expect(db.projects.getProject('alice', p.id)!.members.find((member) => member.username === 'bob')?.active).toBe(false)
    expect(() => db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'Blocked', assignee: 'bob' })).toThrow()
  })

  it('машина задачи доступна лично или через проект, чужая отклоняется', () => {
    const p = db.projects.createProject('alice', { name: 'P1' })
    const col = db.tasks.getBoard('alice', p.id)!.columns[0]
    const personal = db.machines.createAgent('alice', 'Личная')
    const projectMachine = db.machines.createAgent('alice', 'Проектная')
    db.machines.linkMachine('alice', p.id, projectMachine.id)
    const foreign = db.machines.createAgent('bob', 'Чужая')

    const task = db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'T', agentId: personal.id })!
    expect(task.agentId).toBe(personal.id)
    expect(db.tasks.updateTask('alice', p.id, task.id, { agentId: projectMachine.id })!.agentId).toBe(projectMachine.id)
    expect(() => db.tasks.updateTask('alice', p.id, task.id, { agentId: foreign.id })).toThrow('Машина недоступна')
  })

  it('moveTask: в середину, вниз, вверх, в пустую колонку', () => {
    const p = db.projects.createProject('alice', { name: 'P1' })
    const [todo, doing] = db.tasks.getBoard('alice', p.id)!.columns
    const a = db.tasks.createTask('alice', p.id, { columnId: todo.id, title: 'A' })!
    const b = db.tasks.createTask('alice', p.id, { columnId: todo.id, title: 'B' })!
    const c = db.tasks.createTask('alice', p.id, { columnId: todo.id, title: 'C' })!
    // c → между a и b
    db.tasks.moveTask('alice', p.id, c.id, { columnId: todo.id, afterId: a.id, beforeId: b.id })
    let order = db
      .tasks.getBoard('alice', p.id)!
      .tasks.filter((t) => t.columnId === todo.id)
      .map((t) => t.title)
    expect(order).toEqual(['A', 'C', 'B'])
    // a → в пустую колонку doing
    db.tasks.moveTask('alice', p.id, a.id, { columnId: doing.id })
    const board = db.tasks.getBoard('alice', p.id)!
    expect(board.tasks.find((t) => t.id === a.id)!.columnId).toBe(doing.id)
    expect(board.tasks.filter((t) => t.columnId === todo.id).map((t) => t.title)).toEqual(['C', 'B'])
  })

  it('moveTask ренормализует при схлопывании ранга', () => {
    const p = db.projects.createProject('alice', { name: 'P1' })
    const col = db.tasks.getBoard('alice', p.id)!.columns[0]
    const a = db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'A' })!
    const b = db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'B' })!
    const x = db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'X' })!
    // Много раз вставляем X между A и B — ранги сближаются, срабатывает ренормализация.
    for (let i = 0; i < 60; i++) {
      db.tasks.moveTask('alice', p.id, x.id, { columnId: col.id, afterId: a.id, beforeId: b.id })
    }
    const order = db
      .tasks.getBoard('alice', p.id)!
      .tasks.filter((t) => t.columnId === col.id)
      .map((t) => t.title)
    expect(order).toEqual(['A', 'X', 'B'])
    // ранги строго возрастают и различимы
    const pos = db.tasks.getBoard('alice', p.id)!.tasks.filter((t) => t.columnId === col.id).map((t) => t.position)
    expect(pos[0]).toBeLessThan(pos[1])
    expect(pos[1]).toBeLessThan(pos[2])
  })
})

describe('projects: deleteUserData', () => {
  it('снимает членства, удаляет осиротевшие проекты, чистит назначения', () => {
    const solo = db.projects.createProject('alice', { name: 'Solo' })
    const shared = db.projects.createProject('alice', { name: 'Shared' })
    db.projects.addMember('alice', shared.id, 'bob')
    const col = db.tasks.getBoard('alice', shared.id)!.columns[0]
    db.tasks.createTask('alice', shared.id, { columnId: col.id, title: 'T', assignee: 'bob' })
    db.identity.deleteUserData('bob')
    // shared остаётся (владелец alice), назначение снято
    expect(db.projects.getProject('alice', shared.id)!.members.map((m) => m.username)).toEqual(['alice'])
    expect(db.tasks.getBoard('alice', shared.id)!.tasks[0].assignee).toBeNull()
    // solo остаётся у alice
    expect(db.projects.getProject('alice', solo.id)).not.toBeNull()
    // теперь удалим владельца — оба проекта осиротеют и удалятся
    db.identity.deleteUserData('alice')
    expect(db.projects.listProjects('alice')).toEqual([])
  })
})

describe('projects: папка машины, дефолт, привязка чата', () => {
  it('setProjectMachinePath и setProjectDefaultMachine; unlink сбрасывает дефолт', () => {
    const p = db.projects.createProject('alice', { name: 'P1' })
    const a1 = db.machines.createAgent('alice', 'M1')
    const a2 = db.machines.createAgent('alice', 'M2')
    db.machines.linkMachine('alice', p.id, a1.id)
    db.machines.linkMachine('alice', p.id, a2.id)
    // папка на машине
    let d = db.machines.setProjectMachinePath('alice', p.id, a1.id, '/srv/proj')!
    expect(d.machines.find((m) => m.agentId === a1.id)!.path).toBe('/srv/proj')
    // дефолт
    d = db.projects.setProjectDefaultMachine('alice', p.id, a1.id)!
    expect(d.defaultAgentId).toBe(a1.id)
    // дефолтом нельзя назначить машину не из проекта
    const foreign = db.machines.createAgent('alice', 'X')
    expect(() => db.projects.setProjectDefaultMachine('alice', p.id, foreign.id)).toThrow()
    // не-владелец не может
    db.projects.addMember('alice', p.id, 'bob')
    expect(db.machines.setProjectMachinePath('bob', p.id, a1.id, '/x')).toBeNull()
    // снятие дефолтной машины сбрасывает дефолт
    db.projects.unlinkMachine('alice', p.id, a1.id)
    expect(db.projects.getProject('alice', p.id)!.defaultAgentId).toBeNull()
  })

  it('сохраняет конфигурацию собственной машины без предоставления проекту', () => {
    const p = db.projects.createProject('alice', { name: 'Private machine config' })
    const machine = db.machines.createAgent('alice', 'Private Mac')
    db.projects.addMember('alice', p.id, 'bob')

    db.machines.setProjectMachinePath('alice', p.id, machine.id, '/work/project')
    db.machines.setProjectMachineReposRoot('alice', p.id, machine.id, '/work/repos')
    db.machines.setProjectMachineSsh('alice', p.id, machine.id, 'mac.local', 'alice')

    expect(db.machines.isMachineSharedWithProject(p.id, machine.id)).toBe(false)
    expect(db.projects.getProject('alice', p.id)!.machines.find((item) => item.agentId === machine.id)).toMatchObject({
      path: '/work/project', reposRoot: '/work/repos', sshHost: 'mac.local', sshUser: 'alice', sharedWithProject: false
    })
    expect(db.projects.getProject('bob', p.id)!.machines.some((item) => item.agentId === machine.id)).toBe(false)
  })

  it('listProjectMachines отдаёт машины проекта с именами и папками (для MCP-моста)', () => {
    const p = db.projects.createProject('alice', { name: 'P1' })
    const other = db.projects.createProject('alice', { name: 'P2' })
    const a1 = db.machines.createAgent('alice', 'M1')
    const a2 = db.machines.createAgent('alice', 'M2')
    const foreign = db.machines.createAgent('alice', 'X')
    db.machines.linkMachine('alice', p.id, a1.id)
    db.machines.linkMachine('alice', p.id, a2.id)
    db.machines.linkMachine('alice', other.id, foreign.id)
    db.machines.setProjectMachinePath('alice', p.id, a2.id, '/srv/proj')
    expect(db.machines.listProjectMachines(p.id)).toEqual([
      { agentId: a1.id, name: 'M1', path: '' },
      { agentId: a2.id, name: 'M2', path: '/srv/proj' }
    ])
    // машина другого проекта не попадает в список
    expect(db.machines.listProjectMachines(other.id)).toEqual([{ agentId: foreign.id, name: 'X', path: '' }])
    expect(db.machines.listProjectMachines('нет-такого')).toEqual([])
  })

  it('canUseAgent даёт проектный доступ только участнику в явном контексте и отзывает его сразу', () => {
    const p = db.projects.createProject('alice', { name: 'Shared' })
    const machine = db.machines.createAgent('alice', 'Mac')
    const unsharedMachine = db.machines.createAgent('alice', 'Personal Mac')
    db.machines.linkMachine('alice', p.id, machine.id)
    db.projects.addMember('alice', p.id, 'bob')

    expect(db.machines.isMachineSharedWithProject(p.id, unsharedMachine.id)).toBe(false)
    expect(db.machines.canUseAgent('alice', unsharedMachine.id, p.id)).toBe(true)
    expect(db.machines.canUseAgent('bob', unsharedMachine.id, p.id)).toBe(false)
    expect(db.machines.canUseAgent('alice', machine.id)).toBe(true)
    expect(db.machines.canUseAgent('bob', machine.id)).toBe(false)
    expect(db.machines.canUseAgent('bob', machine.id, p.id)).toBe(true)
    expect(db.machines.canUseAgent('charlie', machine.id, p.id)).toBe(false)

    db.projects.removeMember('alice', p.id, 'bob')
    expect(db.machines.canUseAgent('bob', machine.id, p.id)).toBe(false)
    db.projects.addMember('alice', p.id, 'bob')
    db.projects.unlinkMachine('alice', p.id, machine.id)
    expect(db.machines.canUseAgent('bob', machine.id, p.id)).toBe(false)
  })

  it('setConversationProject сохраняет наследование машины, обновляет навыки/projectId; null отвязывает', () => {
    const p = db.projects.createProject('alice', { name: 'P1', skills: ['ts', 'sql'] })
    const a1 = db.machines.createAgent('alice', 'M1')
    db.machines.linkMachine('alice', p.id, a1.id)
    db.machines.setProjectMachinePath('alice', p.id, a1.id, '/srv/proj')
    db.projects.setProjectDefaultMachine('alice', p.id, a1.id)
    const conv = db.chat.createConversation('alice', 'Чат')
    const linked = db.chat.setConversationProject('alice', conv.id, p.id)!
    expect(linked.projectId).toBe(p.id)
    expect(linked.execTarget).toBeNull()
    expect(linked.workdir).toBeNull()
    expect(linked.skillNames).toEqual(['ts', 'sql'])
    // не-участник проекта не может привязать
    const conv2 = db.chat.createConversation('bob', 'Чат bob')
    expect(db.chat.setConversationProject('bob', conv2.id, p.id)).toBeNull()
    // отвязка
    const unl = db.chat.setConversationProject('alice', conv.id, null)!
    expect(unl.projectId).toBeNull()
  })

  it('изолирует персональные defaults и аудит предоставления по проектам', () => {
    const p1 = db.projects.createProject('alice', { name: 'P1' })
    const p2 = db.projects.createProject('alice', { name: 'P2' })
    db.projects.addMember('alice', p1.id, 'bob')
    db.projects.addMember('alice', p2.id, 'bob')
    const machine = db.machines.createAgent('alice', 'Mac')
    db.machines.linkMachine('alice', p1.id, machine.id)
    db.machines.setProjectMachinePath('alice', p1.id, machine.id, '/work/project')
    db.machines.setProjectMachineReposRoot('alice', p1.id, machine.id, '/work/VoiceAIChatRepos')
    db.machines.setProjectMachineSsh('alice', p1.id, machine.id, 'mac.local', 'alice')
    expect(db.machines.canUseAgent('bob', machine.id, p1.id)).toBe(true)
    expect(db.machines.canUseAgent('bob', machine.id, p2.id)).toBe(false)
    expect(db.projects.getProject('bob', p1.id)!.machines[0]).toMatchObject({
      path: '/work/project', reposRoot: '/work/VoiceAIChatRepos', sshHost: 'mac.local', sshUser: 'alice'
    })
    expect(() => db.machines.setProjectMachinePath('bob', p1.id, machine.id, '/stolen')).not.toThrow()
    expect(db.machines.setProjectMachinePath('bob', p1.id, machine.id, '/stolen')).toBeNull()

    db.machines.setUserProjectDefaultMachine('bob', p1.id, machine.id)
    expect(db.machines.getUserProjectDefaultMachine('bob', p1.id)).toBe(machine.id)
    expect(db.machines.getUserProjectDefaultMachine('alice', p1.id)).toBeNull()
    expect(db.machines.getUserProjectDefaultMachine('bob', p2.id)).toBeNull()

    db.machines.setMachineSharedWithProject('alice', p1.id, machine.id, false)
    expect(db.machines.getUserProjectDefaultMachine('bob', p1.id)).toBeNull()
    expect(db.machines.listMachineShareAudit(p1.id)).toMatchObject([
      { actor: 'alice', agentId: machine.id, oldValue: false, newValue: true },
      { actor: 'alice', agentId: machine.id, oldValue: true, newValue: false }
    ])
    expect(() => db.machines.setMachineSharedWithProject('bob', p1.id, machine.id, true)).toThrow('Только владелец')
  })
})


describe('work items', () => {
  it('строит иерархию Epic → Story → Task и запрещает неверного родителя', () => {
    const p = db.projects.createProject('alice', { name: 'P' })
    const backlog = db.tasks.getBoard('alice', p.id)!.columns.find((c) => c.semanticType === 'backlog')!
    const epic = db.tasks.createTask('alice', p.id, { columnId: backlog.id, title: 'E', type: 'epic' })!
    const story = db.tasks.createTask('alice', p.id, { columnId: backlog.id, title: 'S', type: 'story', parentId: epic.id })!
    const task = db.tasks.createTask('alice', p.id, { columnId: backlog.id, title: 'T', type: 'task', parentId: story.id, acceptanceCriteria: 'ok' })!
    expect(task.parentId).toBe(story.id)
    expect(task.acceptanceCriteria).toBe('ok')
    expect(() => db.tasks.createTask('alice', p.id, { columnId: backlog.id, title: 'bad', type: 'epic', parentId: story.id })).toThrow()
    expect(() => db.tasks.updateTask('alice', p.id, epic.id, { parentId: task.id })).toThrow()
  })

  it('deleteTask убирает задачу с доски', () => {
    const p = db.projects.createProject('alice', { name: 'P' })
    const ready = db.tasks.getBoard('alice', p.id)!.columns.find((c) => c.semanticType === 'ready')!
    const task = db.tasks.createTask('alice', p.id, { columnId: ready.id, title: 'T' })!
    expect(db.tasks.deleteTask('alice', p.id, task.id)).toBe(true)
    expect(db.tasks.getBoard('alice', p.id)!.tasks.find((t) => t.id === task.id)).toBeUndefined()
  })
})

describe('projects: навыки по умолчанию и связанный чат', () => {
  it('createProject/updateProject хранят навыки по умолчанию по типам', () => {
    const p = db.projects.createProject('alice', { name: 'P', defaultSkills: { epic: ['arch'], story: ['ux'], task: ['ts'] } })
    expect(p.defaultSkills).toEqual({ epic: ['arch'], story: ['ux'], task: ['ts'] })
    const upd = db.projects.updateProject('alice', p.id, { defaultSkills: { task: ['ts', 'sql'] } })!
    expect(upd.defaultSkills).toEqual({ epic: ['arch'], story: ['ux'], task: ['ts', 'sql'] })
  })

  it('createTask копирует навыки по умолчанию для своего типа; явные — перекрывают', () => {
    const p = db.projects.createProject('alice', { name: 'P', defaultSkills: { epic: ['arch'], story: ['ux'], task: ['ts'] } })
    const col = db.tasks.getBoard('alice', p.id)!.columns[0]
    const epic = db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'E', type: 'epic' })!
    expect(epic.skills).toEqual(['arch'])
    const story = db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'S', type: 'story', parentId: epic.id })!
    expect(story.skills).toEqual(['ux'])
    const task = db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'T', type: 'task' })!
    expect(task.skills).toEqual(['ts'])
    const custom = db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'C', type: 'task', skills: ['redis'] })!
    expect(custom.skills).toEqual(['redis'])
  })

  it('updateTask правит навыки карточки (удаление авто-добавленных + свои)', () => {
    const p = db.projects.createProject('alice', { name: 'P', defaultSkills: { epic: [], story: [], task: ['ts', 'sql'] } })
    const col = db.tasks.getBoard('alice', p.id)!.columns[0]
    const t = db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'T' })!
    expect(t.skills).toEqual(['ts', 'sql'])
    const upd = db.tasks.updateTask('alice', p.id, t.id, { skills: ['ts', 'redis'] })!
    expect(upd.skills).toEqual(['ts', 'redis'])
  })

  it('openOrCreateTaskChat: наследует LLM-настройки пользователя, привязывает задачу/проект/навыки и виден в board.chatId', () => {
    const engine = db.llm.createLlmEngine({ name: 'Codex', kind: 'codex', baseUrl: 'http://codex', token: '', enabled: true, allowedRoles: ['developer'], isDefault: false })
    db.settings.saveSettings('alice', { ...DEFAULT_SETTINGS, llmEngineId: engine.id, llmProvider: 'codex', codexModel: 'gpt-5.6-luna' })
    const p = db.projects.createProject('alice', { name: 'P', defaultSkills: { epic: [], story: [], task: ['ts'] } })
    const col = db.tasks.getBoard('alice', p.id)!.columns[0]
    const t = db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'Скролл в модалке' })!
    const chat = db.chat.openOrCreateTaskChat('alice', p.id, t.id)!
    expect(chat.taskId).toBe(t.id)
    expect(chat.projectId).toBe(p.id)
    // Имя по умолчанию — «Задача <заголовок>»: чат задачи виден в общем списке.
    expect(chat.title).toBe('Задача Скролл в модалке')
    expect(chat.skillNames).toEqual(['ts'])
    // Собственных значений нет: чат динамически наследует проект, затем пользователя.
    expect(chat).toMatchObject({ llmEngineId: null, llmProvider: null, llmModel: null })
    expect(db.ci.getCiLlmConfig('project', p.id) ?? db.ci.ciLlmDefaultsForUser('alice')).toMatchObject({ provider: 'codex', model: 'gpt-5.6-luna' })
    db.settings.saveSettings('alice', { ...DEFAULT_SETTINGS, llmEngineId: engine.id, llmProvider: 'codex', codexModel: 'gpt-5.6-sol' })
    expect(db.chat.getConversation('alice', chat.id)).toMatchObject({ llmEngineId: null, llmProvider: null, llmModel: null })
    expect(db.ci.getCiLlmConfig('project', p.id) ?? db.ci.ciLlmDefaultsForUser('alice')).toMatchObject({ provider: 'codex', model: 'gpt-5.6-sol' })
    const again = db.chat.openOrCreateTaskChat('alice', p.id, t.id)!
    expect(again.id).toBe(chat.id) // не плодит второй чат
    expect(again).toMatchObject({ llmEngineId: null, llmProvider: null, llmModel: null })
    expect(db.tasks.getBoard('alice', p.id)!.tasks.find((x) => x.id === t.id)!.chatId).toBe(chat.id)
  })

  it('создаёт один скрытый канбан-чат на пользователя и проект и сохраняет его историю', () => {
    const p = db.projects.createProject('alice', { name: 'P' })
    const first = db.chat.ensureKanbanAssistantConversation('alice', p.id)!
    db.chat.addMessage('alice', first.id, 'u0', 'Помоги', '10:00')
    const again = db.chat.ensureKanbanAssistantConversation('alice', p.id)!
    expect(again.id).toBe(first.id)
    expect(again).toMatchObject({ assistantKind: 'kanban', projectId: p.id, llmEngineId: null, llmProvider: null, llmModel: null })
    expect(db.chat.listMessages('alice', first.id)).toHaveLength(1)
    expect(db.chat.listConversations('alice').some((chat) => chat.id === first.id)).toBe(false)
    expect(db.chat.ensureKanbanAssistantConversation('bob', p.id)).toBeNull()
  })

  it('openOrCreateTaskChat изолирован по пользователю и требует членства', () => {
    const p = db.projects.createProject('alice', { name: 'P' })
    const col = db.tasks.getBoard('alice', p.id)!.columns[0]
    const t = db.tasks.createTask('alice', p.id, { columnId: col.id, title: 'T' })!
    expect(db.chat.openOrCreateTaskChat('bob', p.id, t.id)).toBeNull() // не участник
    db.projects.addMember('alice', p.id, 'bob')
    const chatA = db.chat.openOrCreateTaskChat('alice', p.id, t.id)!
    const chatB = db.chat.openOrCreateTaskChat('bob', p.id, t.id)!
    expect(chatB.id).not.toBe(chatA.id) // у каждого свой связанный чат
    expect(db.tasks.getBoard('bob', p.id)!.tasks.find((x) => x.id === t.id)!.chatId).toBe(chatB.id)
    expect(db.tasks.getBoard('alice', p.id)!.tasks.find((x) => x.id === t.id)!.chatId).toBe(chatA.id)
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

  it('moveTask ставит doneAt в «Готово» и сбрасывает при возврате в работу', () => {
    const { db: d, set } = withClock()
    const p = d.projects.createProject('alice', { name: 'P' })
    const cols = d.tasks.getBoard('alice', p.id)!.columns
    const done = cols.find((c) => c.semanticType === 'done')!
    const dev = cols.find((c) => c.semanticType === 'development')!
    const task = d.tasks.createTask('alice', p.id, { columnId: dev.id, title: 'T' })!
    expect(task.doneAt).toBeNull()
    set(1_700_000_100_000)
    expect(d.tasks.moveTask('alice', p.id, task.id, { columnId: done.id })!.doneAt).toBe(1_700_000_100_000)
    // Повторный переезд внутри «Готово» отсчёт не сбрасывает.
    set(1_700_000_200_000)
    expect(d.tasks.moveTask('alice', p.id, task.id, { columnId: done.id })!.doneAt).toBe(1_700_000_100_000)
    expect(d.tasks.moveTask('alice', p.id, task.id, { columnId: dev.id })!.doneAt).toBeNull()
    d.close()
  })

  it('createTask сразу в «Готово» начинает отсчёт', () => {
    const { db: d } = withClock()
    const p = d.projects.createProject('alice', { name: 'P' })
    const done = d.tasks.getBoard('alice', p.id)!.columns.find((c) => c.semanticType === 'done')!
    expect(d.tasks.createTask('alice', p.id, { columnId: done.id, title: 'T' })!.doneAt).toBe(1_700_000_000_000)
    d.close()
  })

  it('порог 0 — карточка держится до конца дня завершения', () => {
    const { db: d, set } = withClock()
    const p = d.projects.createProject('alice', { name: 'P' })
    d.projects.updateProject('alice', p.id, { doneRetentionDays: 0 })
    const cols = d.tasks.getBoard('alice', p.id)!.columns
    const done = cols.find((c) => c.semanticType === 'done')!
    const dev = cols.find((c) => c.semanticType === 'development')!
    const task = d.tasks.createTask('alice', p.id, { columnId: dev.id, title: 'T' })!
    d.tasks.moveTask('alice', p.id, task.id, { columnId: done.id })
    // Автоперенос CI-рана не имеет права смахнуть карточку с доски в ту же секунду.
    expect(d.tasks.getBoard('alice', p.id)!.tasks.map((t) => t.id)).toContain(task.id)
    const endOfDay = new Date(1_700_000_000_000).setHours(24, 0, 0, 0)
    set(endOfDay - 1)
    expect(d.tasks.getBoard('alice', p.id)!.tasks.map((t) => t.id)).toContain(task.id)
    set(endOfDay)
    expect(d.tasks.getBoard('alice', p.id)!.tasks.map((t) => t.id)).not.toContain(task.id)
    expect(d.tasks.getBoard('alice', p.id, { includeCompleted: true })!.tasks.map((t) => t.id)).toContain(task.id)
    d.close()
  })

  it('старше порога — нет на доске, includeCompleted возвращает', () => {
    const { db: d, set } = withClock()
    const p = d.projects.createProject('alice', { name: 'P' })
    const cols = d.tasks.getBoard('alice', p.id)!.columns
    const done = cols.find((c) => c.semanticType === 'done')!
    const dev = cols.find((c) => c.semanticType === 'development')!
    const old = d.tasks.createTask('alice', p.id, { columnId: dev.id, title: 'Старая' })!
    const fresh = d.tasks.createTask('alice', p.id, { columnId: dev.id, title: 'Свежая' })!
    d.tasks.moveTask('alice', p.id, old.id, { columnId: done.id })
    set(1_700_000_000_000 + 13 * DAY)
    d.tasks.moveTask('alice', p.id, fresh.id, { columnId: done.id })
    // Дефолт проекта — 14 дней: старая уже за порогом, свежая (1 день) нет.
    set(1_700_000_000_000 + 14 * DAY)
    const ids = d.tasks.getBoard('alice', p.id)!.tasks.map((t) => t.id)
    expect(ids).not.toContain(old.id)
    expect(ids).toContain(fresh.id)
    const all = d.tasks.getBoard('alice', p.id, { includeCompleted: true })!.tasks.map((t) => t.id)
    expect(all).toContain(old.id)
    expect(all).toContain(fresh.id)
    // Возврат в работу возвращает карточку на доску.
    d.tasks.moveTask('alice', p.id, old.id, { columnId: dev.id })
    expect(d.tasks.getBoard('alice', p.id)!.tasks.map((t) => t.id)).toContain(old.id)
    d.close()
  })

  it('порог 0 скрывает за полночью, пустой порог не скрывает никогда', () => {
    const { db: d, set } = withClock()
    const p = d.projects.createProject('alice', { name: 'P' })
    const done = d.tasks.getBoard('alice', p.id)!.columns.find((c) => c.semanticType === 'done')!
    const t = d.tasks.createTask('alice', p.id, { columnId: done.id, title: 'T' })!
    expect(d.projects.updateProject('alice', p.id, { doneRetentionDays: 0 })!.doneRetentionDays).toBe(0)
    // День завершения карточка досиживает: перенос в «Готово» делает и CI-ран.
    expect(d.tasks.getBoard('alice', p.id)!.tasks.map((x) => x.id)).toContain(t.id)
    set(new Date(1_700_000_000_000).setHours(24, 0, 0, 0))
    expect(d.tasks.getBoard('alice', p.id)!.tasks.map((x) => x.id)).not.toContain(t.id)
    expect(d.projects.updateProject('alice', p.id, { doneRetentionDays: null })!.doneRetentionDays).toBeNull()
    set(1_700_000_000_000 + 999 * DAY)
    expect(d.tasks.getBoard('alice', p.id)!.tasks.map((x) => x.id)).toContain(t.id)
    d.close()
  })

  it('по умолчанию проект держит завершённые 14 дней', () => {
    const { db: d } = withClock()
    expect(d.projects.createProject('alice', { name: 'P' }).doneRetentionDays).toBe(14)
    d.close()
  })

  it('сортирует «Готово» по последнему входу, а не по updatedAt', () => {
    const { db: d, set } = withClock()
    const p = d.projects.createProject('alice', { name: 'P' })
    d.projects.updateProject('alice', p.id, { doneRetentionDays: null })
    const columns = d.tasks.getBoard('alice', p.id)!.columns
    const done = columns.find((column) => column.semanticType === 'done')!
    const dev = columns.find((column) => column.semanticType === 'development')!
    const first = d.tasks.createTask('alice', p.id, { columnId: dev.id, title: 'Первая' })!
    const second = d.tasks.createTask('alice', p.id, { columnId: dev.id, title: 'Вторая' })!

    set(1_700_000_100_000)
    d.tasks.moveTask('alice', p.id, first.id, { columnId: done.id })
    set(1_700_000_200_000)
    d.tasks.moveTask('alice', p.id, second.id, { columnId: done.id })
    set(1_700_000_300_000)
    d.tasks.updateTask('alice', p.id, second.id, { title: 'Вторая (исправлена)' })
    expect(d.tasks.getBoard('alice', p.id)!.tasks.filter((task) => task.columnId === done.id).map((task) => task.id))
      .toEqual([second.id, first.id])

    set(1_700_000_400_000)
    d.tasks.moveTask('alice', p.id, first.id, { columnId: dev.id })
    set(1_700_000_500_000)
    d.tasks.moveTask('alice', p.id, first.id, { columnId: done.id })
    expect(d.tasks.getBoard('alice', p.id)!.tasks.filter((task) => task.columnId === done.id).map((task) => task.id))
      .toEqual([first.id, second.id])
    d.close()
  })

  it('порядок «Готово» переживает перезапуск БД', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-done-order-'))
    const file = join(dir, 'db.sqlite')
    let clock = 1_700_000_000_000
    const firstDb = new VoiceChatDb(file, { newId: (() => { let id = 0; return () => `task-${++id}` })(), now: () => clock })
    firstDb.identity.createUser('alice', '', 'developer')
    const p = firstDb.projects.createProject('alice', { name: 'P' })
    firstDb.projects.updateProject('alice', p.id, { doneRetentionDays: null })
    const columns = firstDb.tasks.getBoard('alice', p.id)!.columns
    const dev = columns.find((column) => column.semanticType === 'development')!
    const done = columns.find((column) => column.semanticType === 'done')!
    const older = firstDb.tasks.createTask('alice', p.id, { columnId: dev.id, title: 'Старая' })!
    const newer = firstDb.tasks.createTask('alice', p.id, { columnId: dev.id, title: 'Новая' })!
    clock += 1
    firstDb.tasks.moveTask('alice', p.id, older.id, { columnId: done.id })
    clock += 1
    firstDb.tasks.moveTask('alice', p.id, newer.id, { columnId: done.id })
    firstDb.close()

    const restarted = new VoiceChatDb(file, { now: () => clock })
    expect(restarted.tasks.getBoard('alice', p.id)!.tasks.filter((task) => task.columnId === done.id).map((task) => task.id))
      .toEqual([newer.id, older.id])
    restarted.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('миграция: у лежащих в «Готово» задач появляется doneAt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-doneat-'))
    const file = join(dir, 'db.sqlite')
    const first = new VoiceChatDb(file, { now: () => 1_700_000_000_000 })
    first.identity.createUser('alice', '', 'developer')
    const p = first.projects.createProject('alice', { name: 'P' })
    const done = first.tasks.getBoard('alice', p.id)!.columns.find((c) => c.semanticType === 'done')!
    const t = first.tasks.createTask('alice', p.id, { columnId: done.id, title: 'T' })!
    // Имитируем БД до миграции: колонки done_at ещё нет.
    first.close()
    const raw = new Database(file)
    raw.exec(`ALTER TABLE tasks DROP COLUMN done_at`)
    raw.close()

    const migrated = new VoiceChatDb(file, { now: () => 1_700_000_000_000 + 100 * 24 * 60 * 60 * 1000 })
    // doneAt взят из updated_at, порог 14 дней уже вышел — карточки на доске нет.
    expect(migrated.tasks.getBoard('alice', p.id)!.tasks.map((x) => x.id)).not.toContain(t.id)
    expect(migrated.tasks.getBoard('alice', p.id, { includeCompleted: true })!.tasks.find((x) => x.id === t.id)!.doneAt)
      .toBe(1_700_000_000_000)
    migrated.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('projects: чаты завершённых задач в списке бесед', () => {
  /** Проект с задачей в работе, её чатом и колонкой «Готово». */
  function withTaskChat(): { pid: string; taskId: string; chatId: string; dev: string; done: string } {
    const p = db.projects.createProject('alice', { name: 'P' })
    const board = db.tasks.getBoard('alice', p.id)!
    const dev = board.columns[0]!
    const done = board.columns.find((c) => c.semanticType === 'done')!
    const task = db.tasks.createTask('alice', p.id, { columnId: dev.id, title: 'Скролл' })!
    const chat = db.chat.openOrCreateTaskChat('alice', p.id, task.id)!
    return { pid: p.id, taskId: task.id, chatId: chat.id, dev: dev.id, done: done.id }
  }

  it('задача в «Готово» убирает свой чат из списка, возврат в работу — возвращает', () => {
    const { pid, taskId, chatId, dev, done } = withTaskChat()
    expect(db.chat.listConversations('alice', { scope: 'kanban', projectId: pid }).map((c) => c.id)).toContain(chatId)

    db.tasks.moveTask('alice', pid, taskId, { columnId: done })
    expect(db.chat.listConversations('alice', { scope: 'kanban', projectId: pid }).map((c) => c.id)).not.toContain(chatId)
    // Скрытие — только про список: сам чат открывается по id как раньше.
    expect(db.chat.getConversation('alice', chatId)!.id).toBe(chatId)
    expect(db.chat.listConversations('alice', { scope: 'kanban', projectId: pid, includeCompleted: true }).map((c) => c.id)).toContain(chatId)

    db.tasks.moveTask('alice', pid, taskId, { columnId: dev })
    expect(db.chat.listConversations('alice', { scope: 'kanban', projectId: pid }).map((c) => c.id)).toContain(chatId)
  })

  it('cancelled скрывает чат всегда, а возврат восстанавливает историю', () => {
    const { pid, taskId, chatId, dev } = withTaskChat()
    const cancelled = db.tasks.getBoard('alice', pid)!.columns.find((c) => c.semanticType === 'cancelled')!
    db.chat.addMessage('alice', chatId, 'u0', 'сохранить историю', '10:00')

    db.tasks.moveTask('alice', pid, taskId, { columnId: cancelled.id })
    expect(db.chat.listConversations('alice', { scope: 'kanban', projectId: pid }).map((c) => c.id)).not.toContain(chatId)
    expect(db.chat.listConversations('alice', { scope: 'kanban', projectId: pid, includeCompleted: true }).map((c) => c.id)).not.toContain(chatId)
    expect(db.chat.searchConversations('alice', 'Скролл', { scope: 'kanban', projectId: pid, includeCompleted: true }).map((c) => c.id)).not.toContain(chatId)
    expect(db.chat.getConversation('alice', chatId)!.taskId).toBe(taskId)
    expect(db.chat.listMessages('alice', chatId).map((m) => m.text)).toEqual(['сохранить историю'])

    db.tasks.moveTask('alice', pid, taskId, { columnId: dev })
    expect(db.chat.listConversations('alice', { scope: 'kanban', projectId: pid }).map((c) => c.id)).toContain(chatId)
    expect(db.chat.listMessages('alice', chatId).map((m) => m.text)).toEqual(['сохранить историю'])
  })

  it('отмена определяется семантикой, а не именем или порядком колонки', () => {
    const { pid, taskId, chatId } = withTaskChat()
    const board = db.tasks.getBoard('alice', pid)!
    const cancelled = board.columns.find((c) => c.semanticType === 'cancelled')!
    expect(db.projects.updateColumn('alice', pid, cancelled.id, { name: 'Никогда не делать' })).toBe(true)
    expect(db.projects.reorderColumns('alice', pid, [cancelled.id, ...board.columns.filter((c) => c.id !== cancelled.id).map((c) => c.id)])).toBe(true)
    db.tasks.moveTask('alice', pid, taskId, { columnId: cancelled.id })
    expect(db.chat.listConversations('alice', { scope: 'kanban', projectId: pid }).map((c) => c.id)).not.toContain(chatId)
  })

  it('скрытие не зависит от порога дней: done — и чата в списке нет', () => {
    const { pid, taskId, chatId, done } = withTaskChat()
    // Порог «не скрывать никогда» держит карточку на доске, но не чат в списке.
    db.projects.updateProject('alice', pid, { doneRetentionDays: null })
    db.tasks.moveTask('alice', pid, taskId, { columnId: done })
    expect(db.tasks.getBoard('alice', pid)!.tasks.map((t) => t.id)).toContain(taskId)
    expect(db.chat.listConversations('alice', { scope: 'kanban', projectId: pid }).map((c) => c.id)).not.toContain(chatId)
  })

  it('поиск по беседам скрывает те же чаты', () => {
    const { pid, taskId, chatId, done } = withTaskChat()
    expect(db.chat.searchConversations('alice', 'Скролл', { scope: 'kanban', projectId: pid }).map((c) => c.id)).toContain(chatId)
    db.tasks.moveTask('alice', pid, taskId, { columnId: done })
    expect(db.chat.searchConversations('alice', 'Скролл', { scope: 'kanban', projectId: pid }).map((c) => c.id)).not.toContain(chatId)
    expect(db.chat.searchConversations('alice', 'Скролл', { scope: 'kanban', projectId: pid, includeCompleted: true }).map((c) => c.id)).toContain(chatId)
  })

  it('отмена отдельного CI-рана не скрывает чат активной задачи', () => {
    const { pid, taskId, chatId, dev } = withTaskChat()
    const run = db.ci.createCiRun({
      projectId: pid,
      taskId,
      agentId: null,
      triggeredBy: 'alice',
      prevColumnId: dev,
      runColumnId: dev,
      slotProgress: { done: 0, total: 1, phase: 'Отменён' }
    })
    db.ci.updateCiRun(run.id, { status: 'cancelled', terminalColumnId: dev })

    expect(db.chat.listConversations('alice', { scope: 'kanban', projectId: pid }).map((c) => c.id)).toContain(chatId)
    expect(db.tasks.getBoard('alice', pid)!.tasks.find((task) => task.id === taskId)!.columnId).toBe(dev)
  })

  it('обычные чаты (без задачи) в списке остаются', () => {
    const { pid, taskId, done } = withTaskChat()
    const plain = db.chat.createConversation('alice', 'Просто чат')
    db.tasks.moveTask('alice', pid, taskId, { columnId: done })
    expect(db.chat.listConversations('alice', { scope: 'chat' }).map((c) => c.id)).toContain(plain.id)
  })
})

describe('projects: пред-разработческая подготовка', () => {
  it('атомарно создаёт отдельный ран и переводит TODO в preparation', () => {
    const project = db.projects.createProject('alice', { name: 'Preparation' })
    const board = db.tasks.getBoard('alice', project.id)!
    const backlog = board.columns.find((column) => column.semanticType === 'backlog')!
    const preparation = board.columns.find((column) => column.semanticType === 'preparation')!
    const task = db.tasks.createTask('alice', project.id, { columnId: backlog.id, title: 'Уточнить workflow' })!
    const run = db.tasks.startTaskPreparationRun('alice', project.id, task.id)
    expect(run.status).toBe('running')
    expect(db.tasks.getBoard('alice', project.id)!.tasks.find((item) => item.id === task.id)!.columnId).toBe(preparation.id)
    expect(db.tasks.startTaskPreparationRun('alice', project.id, task.id).id).toBe(run.id)
  })

  it('ошибка оставляет карточку в preparation и разрешает повтор', () => {
    const project = db.projects.createProject('alice', { name: 'Preparation failure' })
    const board = db.tasks.getBoard('alice', project.id)!
    const backlog = board.columns.find((column) => column.semanticType === 'backlog')!
    const preparation = board.columns.find((column) => column.semanticType === 'preparation')!
    const task = db.tasks.createTask('alice', project.id, { columnId: backlog.id, title: 'Неполные требования' })!
    const run = db.tasks.startTaskPreparationRun('alice', project.id, task.id)
    db.tasks.failTaskPreparationRun(run.id, 'Гейт не пройден', ['missing_acceptance_criteria'])
    expect(db.tasks.getTaskPreparationRun('alice', run.id)).toMatchObject({ status: 'failed', canRetry: true, gateReasons: ['missing_acceptance_criteria'] })
    expect(db.tasks.getBoard('alice', project.id)!.tasks.find((item) => item.id === task.id)!.columnId).toBe(preparation.id)
    const retry = db.tasks.startTaskPreparationRun('alice', project.id, task.id)
    expect(retry).toMatchObject({ status: 'running', attempt: 2 })
    expect(db.tasks.listTaskPreparationRuns('alice', project.id, task.id).map((item) => item.id)).toEqual([retry.id, run.id])
  })
})
