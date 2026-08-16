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
  db.createUser('alice', '', 'developer')
  db.createUser('bob', '', 'developer')
  db.createUser('carol', '', 'developer')
})

afterEach(() => db.close())

describe('projects: миграция имён связанных чатов', () => {
  it('старый чат задачи получает префикс «Задача », переименованный вручную — нет', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-taskchat-'))
    const file = join(dir, 'db.sqlite')
    const first = new VoiceChatDb(file)
    first.createUser('alice', '', 'developer')
    const p = first.createProject('alice', { name: 'P' })
    const col = first.getBoard('alice', p.id)!.columns[0]
    const t1 = first.createTask('alice', p.id, { columnId: col.id, title: 'Скролл' })!
    const t2 = first.createTask('alice', p.id, { columnId: col.id, title: 'Пагинация' })!
    const old1 = first.openOrCreateTaskChat('alice', p.id, t1.id)!
    const old2 = first.openOrCreateTaskChat('alice', p.id, t2.id)!
    // Имитируем чаты, созданные до префикса: имя = заголовок задачи.
    first.renameConversation('alice', old1.id, 'Скролл')
    first.renameConversation('alice', old2.id, 'Мои заметки по пагинации')
    first.close()

    const migrated = new VoiceChatDb(file)
    expect(migrated.getConversation('alice', old1.id)!.title).toBe('Задача Скролл')
    // Пользовательское имя не трогаем.
    expect(migrated.getConversation('alice', old2.id)!.title).toBe('Мои заметки по пагинации')
    migrated.close()

    // Повторный старт не наращивает префикс.
    const again = new VoiceChatDb(file)
    expect(again.getConversation('alice', old1.id)!.title).toBe('Задача Скролл')
    again.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('projects: миграция владельцев', () => {
  it('добавляет created_by владельцем старого проекта и сохраняет остальных участников', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-project-owner-'))
    const file = join(dir, 'db.sqlite')
    const first = new VoiceChatDb(file)
    first.createUser('alice', '', 'developer')
    first.createUser('bob', '', 'developer')
    const project = first.createProject('alice', { name: 'Legacy' })
    first.addMember('alice', project.id, 'bob')
    first.close()

    const raw = new Database(file)
    raw.prepare(`DELETE FROM project_members WHERE project_id = ? AND username = 'alice'`).run(project.id)
    raw.close()

    const migrated = new VoiceChatDb(file)
    expect(migrated.getProject('alice', project.id)!.members).toEqual([
      expect.objectContaining({ username: 'alice', role: 'owner' }),
      expect.objectContaining({ username: 'bob', role: 'member' })
    ])
    migrated.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('projects: миграция канонического workflow', () => {
  it('переупорядочивает старую доску, переносит legacy-карточки и повторно ничего не меняет', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-kanban-workflow-'))
    const file = join(dir, 'db.sqlite')
    const first = new VoiceChatDb(file)
    first.createUser('alice', '', 'developer')
    const project = first.createProject('alice', { name: 'Legacy workflow' })
    const initial = first.getBoard('alice', project.id)!
    const column = (semantic: string) => initial.columns.find((item) => item.semanticType === semantic)!
    const testing = first.createColumn('alice', project.id, 'Старое тестирование')!
    const preparation = first.createColumn('alice', project.id, 'Старые сценарии')!
    const readyDuplicate = first.createColumn('alice', project.id, 'Дубликат Ready')!
    const custom = first.createColumn('alice', project.id, 'Пользовательская')!
    first.setColumnHidden('alice', project.id, custom.id, true)
    first.createTask('alice', project.id, { columnId: column('automated_qa').id, title: 'Уже Automated' })
    first.createTask('alice', project.id, { columnId: testing.id, title: 'Из Testing' })
    first.createTask('alice', project.id, { columnId: column('component_qa').id, title: 'Уже Component' })
    first.createTask('alice', project.id, { columnId: preparation.id, title: 'Из QA Preparation' })
    first.createTask('alice', project.id, { columnId: readyDuplicate.id, title: 'Из дубля Ready' })
    first.close()

    const raw = new Database(file)
    raw.prepare(`UPDATE kanban_columns SET semantic_type='testing' WHERE id=?`).run(testing.id)
    raw.prepare(`UPDATE kanban_columns SET semantic_type='qa_preparation' WHERE id=?`).run(preparation.id)
    raw.prepare(`UPDATE kanban_columns SET semantic_type='ready' WHERE id=?`).run(readyDuplicate.id)
    raw.prepare(`UPDATE kanban_columns SET position=-position WHERE project_id=?`).run(project.id)
    raw.prepare(`UPDATE kanban_columns SET name='Мой Ready', hidden=1, position=-999999 WHERE id=?`).run(column('ready').id)
    raw.close()

    const migrated = new VoiceChatDb(file)
    const board = migrated.getBoard('alice', project.id)!
    expect(board.columns.map((item) => item.semanticType)).toEqual([
      'backlog', 'preparation', 'ready', 'development', 'component_qa',
      'integration_tests', 'automated_qa', 'manual_qa', 'awaiting_merge',
      'merge', 'done', 'decision_required', 'custom'
    ])
    expect(board.columns.find((item) => item.id === column('ready').id)).toMatchObject({ name: 'Мой Ready', hidden: false })
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
    const stable = again.getBoard('alice', project.id)!
    expect({
      columns: stable.columns.map(({ id, semanticType, position, hidden }) => ({ id, semanticType, position, hidden })),
      tasks: stable.tasks.map(({ id, columnId, position }) => ({ id, columnId, position }))
    }).toEqual(snapshot)
    again.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('projects: создание и членство', () => {
  it('createProject сеет владельца и дефолтные колонки', () => {
    const p = db.createProject('alice', { name: 'P1', description: 'd', technologies: ['ts'], skills: ['db'] })
    expect(p.name).toBe('P1')
    expect(p.role).toBe('owner')
    expect(p.createdBy).toBe('alice')
    expect(p.technologies).toEqual(['ts'])
    expect(p.members.map((m) => m.username)).toEqual(['alice'])
    expect(p.members[0].role).toBe('owner')
    const board = db.getBoard('alice', p.id)!
    expect(board.columns.map((c) => c.name)).toEqual(['Бэклог', 'Подготовка к разработке', 'Ready for Development', 'Development', 'Component QA', 'Создание интеграционных автотестов', 'Automated QA', 'Ручное QA', 'Ожидает мержа', 'Мерж', 'Готово', 'Требуется решение'])
    expect(board.tasks).toEqual([])
  })

  it('изоляция: не-участник не видит проект', () => {
    const p = db.createProject('alice', { name: 'P1' })
    expect(db.listProjects('alice').map((x) => x.id)).toContain(p.id)
    expect(db.listProjects('bob')).toEqual([])
    expect(db.getProject('bob', p.id)).toBeNull()
    expect(db.getBoard('bob', p.id)).toBeNull()
  })

  it('addMember открывает доступ; роль участника = member', () => {
    const p = db.createProject('alice', { name: 'P1' })
    db.addMember('alice', p.id, 'bob')
    const asBob = db.getProject('bob', p.id)!
    expect(asBob.role).toBe('member')
    expect(db.listProjects('bob').map((x) => x.id)).toContain(p.id)
  })

  it('addMember только владельцем и только существующего пользователя', () => {
    const p = db.createProject('alice', { name: 'P1' })
    db.addMember('alice', p.id, 'bob')
    expect(db.addMember('bob', p.id, 'carol')).toBeNull() // bob не владелец
    expect(() => db.addMember('alice', p.id, 'nobody')).toThrow()
  })

  it('updateProject/deleteProject — только владелец', () => {
    const p = db.createProject('alice', { name: 'P1' })
    db.addMember('alice', p.id, 'bob')
    expect(db.updateProject('bob', p.id, { name: 'X' })).toBeNull()
    const upd = db.updateProject('alice', p.id, { name: 'P1b', gitUrl: 'git@x' })!
    expect(upd.name).toBe('P1b')
    expect(upd.gitUrl).toBe('git@x')
    expect(db.deleteProject('bob', p.id)).toBe(false)
    expect(db.deleteProject('alice', p.id)).toBe(true)
    expect(db.getProject('alice', p.id)).toBeNull()
  })

  it('removeMember снимает назначения и защищает последнего владельца', () => {
    const p = db.createProject('alice', { name: 'P1' })
    db.addMember('alice', p.id, 'bob')
    const col = db.getBoard('alice', p.id)!.columns[0]
    const task = db.createTask('alice', p.id, { columnId: col.id, title: 'T', assignee: 'bob' })!
    expect(task.assignee).toBe('bob')
    db.removeMember('alice', p.id, 'bob')
    expect(db.getProject('bob', p.id)).toBeNull()
    expect(db.getBoard('alice', p.id)!.tasks[0].assignee).toBeNull()
    expect(() => db.removeMember('alice', p.id, 'alice')).toThrow('последнего владельца')
  })

  it('поддерживает нескольких равноправных владельцев, выход и аудит ролей', () => {
    const p = db.createProject('alice', { name: 'P1' })
    db.addMember('alice', p.id, 'bob')
    db.updateMemberRole('alice', p.id, 'bob', 'owner')
    expect(db.getProject('bob', p.id)!.role).toBe('owner')
    expect(db.updateProject('bob', p.id, { name: 'От Bob' })!.name).toBe('От Bob')

    db.removeMember('bob', p.id, 'alice')
    expect(db.getProject('alice', p.id)).toBeNull()
    expect(db.getProject('bob', p.id)!.members).toEqual([
      expect.objectContaining({ username: 'bob', role: 'owner' })
    ])
    expect(db.listProjectMemberRoleAudit(p.id)).toEqual([
      expect.objectContaining({ actor: 'alice', targetUser: 'bob', oldRole: null, newRole: 'member', action: 'add' }),
      expect.objectContaining({ actor: 'alice', targetUser: 'bob', oldRole: 'member', newRole: 'owner', action: 'role_change' }),
      expect.objectContaining({ actor: 'bob', targetUser: 'alice', oldRole: 'owner', newRole: null, action: 'remove' })
    ])
  })

  it('не назначает владельцем не-участника и не позволяет двум владельцам убрать последнего', () => {
    const p = db.createProject('alice', { name: 'P1' })
    expect(() => db.updateMemberRole('alice', p.id, 'bob', 'owner')).toThrow('Сначала добавьте')
    db.addMember('alice', p.id, 'bob')
    db.updateMemberRole('alice', p.id, 'bob', 'owner')
    db.updateMemberRole('alice', p.id, 'bob', 'member')
    expect(() => db.updateMemberRole('alice', p.id, 'alice', 'member')).toThrow('последнего владельца')
    expect(db.getProject('alice', p.id)!.members.filter((m) => m.role === 'owner')).toHaveLength(1)
  })
})

describe('projects: машины', () => {
  it('linkMachine валидирует владение агентом; каскад при удалении агента', () => {
    const p = db.createProject('alice', { name: 'P1' })
    const agent = db.createAgent('alice', 'M1')
    const foreign = db.createAgent('bob', 'M2')
    expect(() => db.linkMachine('alice', p.id, foreign.id)).toThrow() // чужой агент
    const detail = db.linkMachine('alice', p.id, agent.id)!
    expect(detail.machines.map((m) => m.agentId)).toEqual([agent.id])
    db.deleteAgent('alice', agent.id) // CASCADE снимает связь
    expect(db.getProject('alice', p.id)!.machines).toEqual([])
  })
})

describe('board: колонки и порядок', () => {
  it('createColumn добавляет в конец; reorderColumns переставляет', () => {
    const p = db.createProject('alice', { name: 'P1' })
    const c4 = db.createColumn('alice', p.id, 'Review')!
    let cols = db.getBoard('alice', p.id)!.columns
    expect(cols.map((c) => c.name)).toEqual(['Бэклог', 'Подготовка к разработке', 'Ready for Development', 'Development', 'Component QA', 'Создание интеграционных автотестов', 'Automated QA', 'Ручное QA', 'Ожидает мержа', 'Мерж', 'Готово', 'Требуется решение', 'Review'])
    const reversed = cols.map((c) => c.id).reverse()
    expect(db.reorderColumns('alice', p.id, reversed)).toBe(true)
    cols = db.getBoard('alice', p.id)!.columns
    expect(cols.map((c) => c.id)).toEqual(reversed)
    // неполный/чужой набор — отказ
    expect(db.reorderColumns('alice', p.id, [c4.id])).toBe(false)
  })

  it('setColumnHidden и deleteColumn (каскад задач)', () => {
    const p = db.createProject('alice', { name: 'P1' })
    const col = db.createColumn('alice', p.id, 'Custom')!
    db.createTask('alice', p.id, { columnId: col.id, title: 'T' })
    expect(db.setColumnHidden('alice', p.id, col.id, true)).toBe(true)
    expect(db.getBoard('alice', p.id)!.columns.find((c) => c.id === col.id)!.hidden).toBe(true)
    expect(db.deleteColumn('alice', p.id, col.id)).toBe(true)
    const board = db.getBoard('alice', p.id)!
    expect(board.columns.find((c) => c.id === col.id)).toBeUndefined()
    expect(board.tasks).toEqual([]) // задача ушла по CASCADE
  })
})

describe('board: задачи, приоритеты, assignee, перемещение', () => {
  it('assignee должен быть участником', () => {
    const p = db.createProject('alice', { name: 'P1' })
    const col = db.getBoard('alice', p.id)!.columns[0]
    expect(() => db.createTask('alice', p.id, { columnId: col.id, title: 'T', assignee: 'bob' })).toThrow()
    db.addMember('alice', p.id, 'bob')
    const t = db.createTask('alice', p.id, { columnId: col.id, title: 'T', assignee: 'bob', priority: 'high' })!
    expect(t.assignee).toBe('bob')
    expect(t.priority).toBe('high')
    expect(db.createTask('alice', p.id, { columnId: col.id, title: 'Без исполнителя', assignee: null })!.assignee).toBeNull()
    expect(() => db.updateTask('alice', p.id, t.id, { assignee: 'carol' })).toThrow()
    db.setUserBlocked('bob', true)
    expect(db.getProject('alice', p.id)!.members.find((member) => member.username === 'bob')?.active).toBe(false)
    expect(() => db.createTask('alice', p.id, { columnId: col.id, title: 'Blocked', assignee: 'bob' })).toThrow()
  })

  it('машина задачи доступна лично или через проект, чужая отклоняется', () => {
    const p = db.createProject('alice', { name: 'P1' })
    const col = db.getBoard('alice', p.id)!.columns[0]
    const personal = db.createAgent('alice', 'Личная')
    const projectMachine = db.createAgent('alice', 'Проектная')
    db.linkMachine('alice', p.id, projectMachine.id)
    const foreign = db.createAgent('bob', 'Чужая')

    const task = db.createTask('alice', p.id, { columnId: col.id, title: 'T', agentId: personal.id })!
    expect(task.agentId).toBe(personal.id)
    expect(db.updateTask('alice', p.id, task.id, { agentId: projectMachine.id })!.agentId).toBe(projectMachine.id)
    expect(() => db.updateTask('alice', p.id, task.id, { agentId: foreign.id })).toThrow('Машина недоступна')
  })

  it('moveTask: в середину, вниз, вверх, в пустую колонку', () => {
    const p = db.createProject('alice', { name: 'P1' })
    const [todo, doing] = db.getBoard('alice', p.id)!.columns
    const a = db.createTask('alice', p.id, { columnId: todo.id, title: 'A' })!
    const b = db.createTask('alice', p.id, { columnId: todo.id, title: 'B' })!
    const c = db.createTask('alice', p.id, { columnId: todo.id, title: 'C' })!
    // c → между a и b
    db.moveTask('alice', p.id, c.id, { columnId: todo.id, afterId: a.id, beforeId: b.id })
    let order = db
      .getBoard('alice', p.id)!
      .tasks.filter((t) => t.columnId === todo.id)
      .map((t) => t.title)
    expect(order).toEqual(['A', 'C', 'B'])
    // a → в пустую колонку doing
    db.moveTask('alice', p.id, a.id, { columnId: doing.id })
    const board = db.getBoard('alice', p.id)!
    expect(board.tasks.find((t) => t.id === a.id)!.columnId).toBe(doing.id)
    expect(board.tasks.filter((t) => t.columnId === todo.id).map((t) => t.title)).toEqual(['C', 'B'])
  })

  it('moveTask ренормализует при схлопывании ранга', () => {
    const p = db.createProject('alice', { name: 'P1' })
    const col = db.getBoard('alice', p.id)!.columns[0]
    const a = db.createTask('alice', p.id, { columnId: col.id, title: 'A' })!
    const b = db.createTask('alice', p.id, { columnId: col.id, title: 'B' })!
    const x = db.createTask('alice', p.id, { columnId: col.id, title: 'X' })!
    // Много раз вставляем X между A и B — ранги сближаются, срабатывает ренормализация.
    for (let i = 0; i < 60; i++) {
      db.moveTask('alice', p.id, x.id, { columnId: col.id, afterId: a.id, beforeId: b.id })
    }
    const order = db
      .getBoard('alice', p.id)!
      .tasks.filter((t) => t.columnId === col.id)
      .map((t) => t.title)
    expect(order).toEqual(['A', 'X', 'B'])
    // ранги строго возрастают и различимы
    const pos = db.getBoard('alice', p.id)!.tasks.filter((t) => t.columnId === col.id).map((t) => t.position)
    expect(pos[0]).toBeLessThan(pos[1])
    expect(pos[1]).toBeLessThan(pos[2])
  })
})

describe('projects: deleteUserData', () => {
  it('снимает членства, удаляет осиротевшие проекты, чистит назначения', () => {
    const solo = db.createProject('alice', { name: 'Solo' })
    const shared = db.createProject('alice', { name: 'Shared' })
    db.addMember('alice', shared.id, 'bob')
    const col = db.getBoard('alice', shared.id)!.columns[0]
    db.createTask('alice', shared.id, { columnId: col.id, title: 'T', assignee: 'bob' })
    db.deleteUserData('bob')
    // shared остаётся (владелец alice), назначение снято
    expect(db.getProject('alice', shared.id)!.members.map((m) => m.username)).toEqual(['alice'])
    expect(db.getBoard('alice', shared.id)!.tasks[0].assignee).toBeNull()
    // solo остаётся у alice
    expect(db.getProject('alice', solo.id)).not.toBeNull()
    // теперь удалим владельца — оба проекта осиротеют и удалятся
    db.deleteUserData('alice')
    expect(db.listProjects('alice')).toEqual([])
  })
})

describe('projects: папка машины, дефолт, привязка чата', () => {
  it('setProjectMachinePath и setProjectDefaultMachine; unlink сбрасывает дефолт', () => {
    const p = db.createProject('alice', { name: 'P1' })
    const a1 = db.createAgent('alice', 'M1')
    const a2 = db.createAgent('alice', 'M2')
    db.linkMachine('alice', p.id, a1.id)
    db.linkMachine('alice', p.id, a2.id)
    // папка на машине
    let d = db.setProjectMachinePath('alice', p.id, a1.id, '/srv/proj')!
    expect(d.machines.find((m) => m.agentId === a1.id)!.path).toBe('/srv/proj')
    // дефолт
    d = db.setProjectDefaultMachine('alice', p.id, a1.id)!
    expect(d.defaultAgentId).toBe(a1.id)
    // дефолтом нельзя назначить машину не из проекта
    const foreign = db.createAgent('alice', 'X')
    expect(() => db.setProjectDefaultMachine('alice', p.id, foreign.id)).toThrow()
    // не-владелец не может
    db.addMember('alice', p.id, 'bob')
    expect(db.setProjectMachinePath('bob', p.id, a1.id, '/x')).toBeNull()
    // снятие дефолтной машины сбрасывает дефолт
    db.unlinkMachine('alice', p.id, a1.id)
    expect(db.getProject('alice', p.id)!.defaultAgentId).toBeNull()
  })

  it('listProjectMachines отдаёт машины проекта с именами и папками (для MCP-моста)', () => {
    const p = db.createProject('alice', { name: 'P1' })
    const other = db.createProject('alice', { name: 'P2' })
    const a1 = db.createAgent('alice', 'M1')
    const a2 = db.createAgent('alice', 'M2')
    const foreign = db.createAgent('alice', 'X')
    db.linkMachine('alice', p.id, a1.id)
    db.linkMachine('alice', p.id, a2.id)
    db.linkMachine('alice', other.id, foreign.id)
    db.setProjectMachinePath('alice', p.id, a2.id, '/srv/proj')
    expect(db.listProjectMachines(p.id)).toEqual([
      { agentId: a1.id, name: 'M1', path: '' },
      { agentId: a2.id, name: 'M2', path: '/srv/proj' }
    ])
    // машина другого проекта не попадает в список
    expect(db.listProjectMachines(other.id)).toEqual([{ agentId: foreign.id, name: 'X', path: '' }])
    expect(db.listProjectMachines('нет-такого')).toEqual([])
  })

  it('canUseAgent даёт проектный доступ только участнику в явном контексте и отзывает его сразу', () => {
    const p = db.createProject('alice', { name: 'Shared' })
    const machine = db.createAgent('alice', 'Mac')
    db.linkMachine('alice', p.id, machine.id)
    db.addMember('alice', p.id, 'bob')

    expect(db.canUseAgent('alice', machine.id)).toBe(true)
    expect(db.canUseAgent('bob', machine.id)).toBe(false)
    expect(db.canUseAgent('bob', machine.id, p.id)).toBe(true)
    expect(db.canUseAgent('charlie', machine.id, p.id)).toBe(false)

    db.removeMember('alice', p.id, 'bob')
    expect(db.canUseAgent('bob', machine.id, p.id)).toBe(false)
    db.addMember('alice', p.id, 'bob')
    db.unlinkMachine('alice', p.id, machine.id)
    expect(db.canUseAgent('bob', machine.id, p.id)).toBe(false)
  })

  it('setConversationProject перезаписывает машину/папку/навыки и projectId; null отвязывает', () => {
    const p = db.createProject('alice', { name: 'P1', skills: ['ts', 'sql'] })
    const a1 = db.createAgent('alice', 'M1')
    db.linkMachine('alice', p.id, a1.id)
    db.setProjectMachinePath('alice', p.id, a1.id, '/srv/proj')
    db.setProjectDefaultMachine('alice', p.id, a1.id)
    const conv = db.createConversation('alice', 'Чат')
    const linked = db.setConversationProject('alice', conv.id, p.id)!
    expect(linked.projectId).toBe(p.id)
    expect(linked.execTarget).toBe(a1.id)
    expect(linked.workdir).toBe('/srv/proj')
    expect(linked.skillNames).toEqual(['ts', 'sql'])
    // не-участник проекта не может привязать
    const conv2 = db.createConversation('bob', 'Чат bob')
    expect(db.setConversationProject('bob', conv2.id, p.id)).toBeNull()
    // отвязка
    const unl = db.setConversationProject('alice', conv.id, null)!
    expect(unl.projectId).toBeNull()
  })
})


describe('work items', () => {
  it('строит иерархию Epic → Story → Task и запрещает неверного родителя', () => {
    const p = db.createProject('alice', { name: 'P' })
    const backlog = db.getBoard('alice', p.id)!.columns.find((c) => c.semanticType === 'backlog')!
    const epic = db.createTask('alice', p.id, { columnId: backlog.id, title: 'E', type: 'epic' })!
    const story = db.createTask('alice', p.id, { columnId: backlog.id, title: 'S', type: 'story', parentId: epic.id })!
    const task = db.createTask('alice', p.id, { columnId: backlog.id, title: 'T', type: 'task', parentId: story.id, acceptanceCriteria: 'ok' })!
    expect(task.parentId).toBe(story.id)
    expect(task.acceptanceCriteria).toBe('ok')
    expect(() => db.createTask('alice', p.id, { columnId: backlog.id, title: 'bad', type: 'epic', parentId: story.id })).toThrow()
    expect(() => db.updateTask('alice', p.id, epic.id, { parentId: task.id })).toThrow()
  })

  it('deleteTask убирает задачу с доски', () => {
    const p = db.createProject('alice', { name: 'P' })
    const ready = db.getBoard('alice', p.id)!.columns.find((c) => c.semanticType === 'ready')!
    const task = db.createTask('alice', p.id, { columnId: ready.id, title: 'T' })!
    expect(db.deleteTask('alice', p.id, task.id)).toBe(true)
    expect(db.getBoard('alice', p.id)!.tasks.find((t) => t.id === task.id)).toBeUndefined()
  })
})

describe('projects: навыки по умолчанию и связанный чат', () => {
  it('createProject/updateProject хранят навыки по умолчанию по типам', () => {
    const p = db.createProject('alice', { name: 'P', defaultSkills: { epic: ['arch'], story: ['ux'], task: ['ts'] } })
    expect(p.defaultSkills).toEqual({ epic: ['arch'], story: ['ux'], task: ['ts'] })
    const upd = db.updateProject('alice', p.id, { defaultSkills: { task: ['ts', 'sql'] } })!
    expect(upd.defaultSkills).toEqual({ epic: ['arch'], story: ['ux'], task: ['ts', 'sql'] })
  })

  it('createTask копирует навыки по умолчанию для своего типа; явные — перекрывают', () => {
    const p = db.createProject('alice', { name: 'P', defaultSkills: { epic: ['arch'], story: ['ux'], task: ['ts'] } })
    const col = db.getBoard('alice', p.id)!.columns[0]
    const epic = db.createTask('alice', p.id, { columnId: col.id, title: 'E', type: 'epic' })!
    expect(epic.skills).toEqual(['arch'])
    const story = db.createTask('alice', p.id, { columnId: col.id, title: 'S', type: 'story', parentId: epic.id })!
    expect(story.skills).toEqual(['ux'])
    const task = db.createTask('alice', p.id, { columnId: col.id, title: 'T', type: 'task' })!
    expect(task.skills).toEqual(['ts'])
    const custom = db.createTask('alice', p.id, { columnId: col.id, title: 'C', type: 'task', skills: ['redis'] })!
    expect(custom.skills).toEqual(['redis'])
  })

  it('updateTask правит навыки карточки (удаление авто-добавленных + свои)', () => {
    const p = db.createProject('alice', { name: 'P', defaultSkills: { epic: [], story: [], task: ['ts', 'sql'] } })
    const col = db.getBoard('alice', p.id)!.columns[0]
    const t = db.createTask('alice', p.id, { columnId: col.id, title: 'T' })!
    expect(t.skills).toEqual(['ts', 'sql'])
    const upd = db.updateTask('alice', p.id, t.id, { skills: ['ts', 'redis'] })!
    expect(upd.skills).toEqual(['ts', 'redis'])
  })

  it('openOrCreateTaskChat: наследует LLM-настройки пользователя, привязывает задачу/проект/навыки и виден в board.chatId', () => {
    const engine = db.createLlmEngine({ name: 'Codex', kind: 'codex', baseUrl: 'http://codex', token: '', enabled: true, allowedRoles: ['developer'], isDefault: false })
    db.saveSettings('alice', { ...DEFAULT_SETTINGS, llmEngineId: engine.id, llmProvider: 'codex', codexModel: 'gpt-5.6-luna' })
    const p = db.createProject('alice', { name: 'P', defaultSkills: { epic: [], story: [], task: ['ts'] } })
    const col = db.getBoard('alice', p.id)!.columns[0]
    const t = db.createTask('alice', p.id, { columnId: col.id, title: 'Скролл в модалке' })!
    const chat = db.openOrCreateTaskChat('alice', p.id, t.id)!
    expect(chat.taskId).toBe(t.id)
    expect(chat.projectId).toBe(p.id)
    // Имя по умолчанию — «Задача <заголовок>»: чат задачи виден в общем списке.
    expect(chat.title).toBe('Задача Скролл в модалке')
    expect(chat.skillNames).toEqual(['ts'])
    // Собственных значений нет: чат динамически наследует проект, затем пользователя.
    expect(chat).toMatchObject({ llmEngineId: null, llmProvider: null, llmModel: null })
    expect(db.getCiLlmConfig('project', p.id) ?? db.ciLlmDefaultsForUser('alice')).toMatchObject({ provider: 'codex', model: 'gpt-5.6-luna' })
    db.saveSettings('alice', { ...DEFAULT_SETTINGS, llmEngineId: engine.id, llmProvider: 'codex', codexModel: 'gpt-5.6-sol' })
    expect(db.getConversation('alice', chat.id)).toMatchObject({ llmEngineId: null, llmProvider: null, llmModel: null })
    expect(db.getCiLlmConfig('project', p.id) ?? db.ciLlmDefaultsForUser('alice')).toMatchObject({ provider: 'codex', model: 'gpt-5.6-sol' })
    const again = db.openOrCreateTaskChat('alice', p.id, t.id)!
    expect(again.id).toBe(chat.id) // не плодит второй чат
    expect(again).toMatchObject({ llmEngineId: null, llmProvider: null, llmModel: null })
    expect(db.getBoard('alice', p.id)!.tasks.find((x) => x.id === t.id)!.chatId).toBe(chat.id)
  })

  it('создаёт один скрытый канбан-чат на пользователя и проект и сохраняет его историю', () => {
    const p = db.createProject('alice', { name: 'P' })
    const first = db.ensureKanbanAssistantConversation('alice', p.id)!
    db.addMessage('alice', first.id, 'u0', 'Помоги', '10:00')
    const again = db.ensureKanbanAssistantConversation('alice', p.id)!
    expect(again.id).toBe(first.id)
    expect(again).toMatchObject({ assistantKind: 'kanban', projectId: p.id, llmEngineId: null, llmProvider: null, llmModel: null })
    expect(db.listMessages('alice', first.id)).toHaveLength(1)
    expect(db.listConversations('alice').some((chat) => chat.id === first.id)).toBe(false)
    expect(db.ensureKanbanAssistantConversation('bob', p.id)).toBeNull()
  })

  it('openOrCreateTaskChat изолирован по пользователю и требует членства', () => {
    const p = db.createProject('alice', { name: 'P' })
    const col = db.getBoard('alice', p.id)!.columns[0]
    const t = db.createTask('alice', p.id, { columnId: col.id, title: 'T' })!
    expect(db.openOrCreateTaskChat('bob', p.id, t.id)).toBeNull() // не участник
    db.addMember('alice', p.id, 'bob')
    const chatA = db.openOrCreateTaskChat('alice', p.id, t.id)!
    const chatB = db.openOrCreateTaskChat('bob', p.id, t.id)!
    expect(chatB.id).not.toBe(chatA.id) // у каждого свой связанный чат
    expect(db.getBoard('bob', p.id)!.tasks.find((x) => x.id === t.id)!.chatId).toBe(chatB.id)
    expect(db.getBoard('alice', p.id)!.tasks.find((x) => x.id === t.id)!.chatId).toBe(chatA.id)
  })
})

describe('доска: завершённые задачи уходят с доски по порогу проекта', () => {
  const DAY = 24 * 60 * 60 * 1000
  /** БД с управляемыми часами: порог считается в днях, шаг по 10 мс не годится. */
  function withClock(): { db: VoiceChatDb; set: (t: number) => void } {
    let id = 0
    let clock = 1_700_000_000_000
    const fresh = new VoiceChatDb(':memory:', { newId: () => `c-${++id}`, now: () => clock })
    fresh.createUser('alice', '', 'developer')
    return { db: fresh, set: (t) => { clock = t } }
  }

  it('moveTask ставит doneAt в «Готово» и сбрасывает при возврате в работу', () => {
    const { db: d, set } = withClock()
    const p = d.createProject('alice', { name: 'P' })
    const cols = d.getBoard('alice', p.id)!.columns
    const done = cols.find((c) => c.semanticType === 'done')!
    const dev = cols.find((c) => c.semanticType === 'development')!
    const task = d.createTask('alice', p.id, { columnId: dev.id, title: 'T' })!
    expect(task.doneAt).toBeNull()
    set(1_700_000_100_000)
    expect(d.moveTask('alice', p.id, task.id, { columnId: done.id })!.doneAt).toBe(1_700_000_100_000)
    // Повторный переезд внутри «Готово» отсчёт не сбрасывает.
    set(1_700_000_200_000)
    expect(d.moveTask('alice', p.id, task.id, { columnId: done.id })!.doneAt).toBe(1_700_000_100_000)
    expect(d.moveTask('alice', p.id, task.id, { columnId: dev.id })!.doneAt).toBeNull()
    d.close()
  })

  it('createTask сразу в «Готово» начинает отсчёт', () => {
    const { db: d } = withClock()
    const p = d.createProject('alice', { name: 'P' })
    const done = d.getBoard('alice', p.id)!.columns.find((c) => c.semanticType === 'done')!
    expect(d.createTask('alice', p.id, { columnId: done.id, title: 'T' })!.doneAt).toBe(1_700_000_000_000)
    d.close()
  })

  it('порог 0 — карточка держится до конца дня завершения', () => {
    const { db: d, set } = withClock()
    const p = d.createProject('alice', { name: 'P' })
    d.updateProject('alice', p.id, { doneRetentionDays: 0 })
    const cols = d.getBoard('alice', p.id)!.columns
    const done = cols.find((c) => c.semanticType === 'done')!
    const dev = cols.find((c) => c.semanticType === 'development')!
    const task = d.createTask('alice', p.id, { columnId: dev.id, title: 'T' })!
    d.moveTask('alice', p.id, task.id, { columnId: done.id })
    // Автоперенос CI-рана не имеет права смахнуть карточку с доски в ту же секунду.
    expect(d.getBoard('alice', p.id)!.tasks.map((t) => t.id)).toContain(task.id)
    const endOfDay = new Date(1_700_000_000_000).setHours(24, 0, 0, 0)
    set(endOfDay - 1)
    expect(d.getBoard('alice', p.id)!.tasks.map((t) => t.id)).toContain(task.id)
    set(endOfDay)
    expect(d.getBoard('alice', p.id)!.tasks.map((t) => t.id)).not.toContain(task.id)
    expect(d.getBoard('alice', p.id, { includeCompleted: true })!.tasks.map((t) => t.id)).toContain(task.id)
    d.close()
  })

  it('старше порога — нет на доске, includeCompleted возвращает', () => {
    const { db: d, set } = withClock()
    const p = d.createProject('alice', { name: 'P' })
    const cols = d.getBoard('alice', p.id)!.columns
    const done = cols.find((c) => c.semanticType === 'done')!
    const dev = cols.find((c) => c.semanticType === 'development')!
    const old = d.createTask('alice', p.id, { columnId: dev.id, title: 'Старая' })!
    const fresh = d.createTask('alice', p.id, { columnId: dev.id, title: 'Свежая' })!
    d.moveTask('alice', p.id, old.id, { columnId: done.id })
    set(1_700_000_000_000 + 13 * DAY)
    d.moveTask('alice', p.id, fresh.id, { columnId: done.id })
    // Дефолт проекта — 14 дней: старая уже за порогом, свежая (1 день) нет.
    set(1_700_000_000_000 + 14 * DAY)
    const ids = d.getBoard('alice', p.id)!.tasks.map((t) => t.id)
    expect(ids).not.toContain(old.id)
    expect(ids).toContain(fresh.id)
    const all = d.getBoard('alice', p.id, { includeCompleted: true })!.tasks.map((t) => t.id)
    expect(all).toContain(old.id)
    expect(all).toContain(fresh.id)
    // Возврат в работу возвращает карточку на доску.
    d.moveTask('alice', p.id, old.id, { columnId: dev.id })
    expect(d.getBoard('alice', p.id)!.tasks.map((t) => t.id)).toContain(old.id)
    d.close()
  })

  it('порог 0 скрывает за полночью, пустой порог не скрывает никогда', () => {
    const { db: d, set } = withClock()
    const p = d.createProject('alice', { name: 'P' })
    const done = d.getBoard('alice', p.id)!.columns.find((c) => c.semanticType === 'done')!
    const t = d.createTask('alice', p.id, { columnId: done.id, title: 'T' })!
    expect(d.updateProject('alice', p.id, { doneRetentionDays: 0 })!.doneRetentionDays).toBe(0)
    // День завершения карточка досиживает: перенос в «Готово» делает и CI-ран.
    expect(d.getBoard('alice', p.id)!.tasks.map((x) => x.id)).toContain(t.id)
    set(new Date(1_700_000_000_000).setHours(24, 0, 0, 0))
    expect(d.getBoard('alice', p.id)!.tasks.map((x) => x.id)).not.toContain(t.id)
    expect(d.updateProject('alice', p.id, { doneRetentionDays: null })!.doneRetentionDays).toBeNull()
    set(1_700_000_000_000 + 999 * DAY)
    expect(d.getBoard('alice', p.id)!.tasks.map((x) => x.id)).toContain(t.id)
    d.close()
  })

  it('по умолчанию проект держит завершённые 14 дней', () => {
    const { db: d } = withClock()
    expect(d.createProject('alice', { name: 'P' }).doneRetentionDays).toBe(14)
    d.close()
  })

  it('сортирует «Готово» по последнему входу, а не по updatedAt', () => {
    const { db: d, set } = withClock()
    const p = d.createProject('alice', { name: 'P' })
    d.updateProject('alice', p.id, { doneRetentionDays: null })
    const columns = d.getBoard('alice', p.id)!.columns
    const done = columns.find((column) => column.semanticType === 'done')!
    const dev = columns.find((column) => column.semanticType === 'development')!
    const first = d.createTask('alice', p.id, { columnId: dev.id, title: 'Первая' })!
    const second = d.createTask('alice', p.id, { columnId: dev.id, title: 'Вторая' })!

    set(1_700_000_100_000)
    d.moveTask('alice', p.id, first.id, { columnId: done.id })
    set(1_700_000_200_000)
    d.moveTask('alice', p.id, second.id, { columnId: done.id })
    set(1_700_000_300_000)
    d.updateTask('alice', p.id, second.id, { title: 'Вторая (исправлена)' })
    expect(d.getBoard('alice', p.id)!.tasks.filter((task) => task.columnId === done.id).map((task) => task.id))
      .toEqual([second.id, first.id])

    set(1_700_000_400_000)
    d.moveTask('alice', p.id, first.id, { columnId: dev.id })
    set(1_700_000_500_000)
    d.moveTask('alice', p.id, first.id, { columnId: done.id })
    expect(d.getBoard('alice', p.id)!.tasks.filter((task) => task.columnId === done.id).map((task) => task.id))
      .toEqual([first.id, second.id])
    d.close()
  })

  it('порядок «Готово» переживает перезапуск БД', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-done-order-'))
    const file = join(dir, 'db.sqlite')
    let clock = 1_700_000_000_000
    const firstDb = new VoiceChatDb(file, { newId: (() => { let id = 0; return () => `task-${++id}` })(), now: () => clock })
    firstDb.createUser('alice', '', 'developer')
    const p = firstDb.createProject('alice', { name: 'P' })
    firstDb.updateProject('alice', p.id, { doneRetentionDays: null })
    const columns = firstDb.getBoard('alice', p.id)!.columns
    const dev = columns.find((column) => column.semanticType === 'development')!
    const done = columns.find((column) => column.semanticType === 'done')!
    const older = firstDb.createTask('alice', p.id, { columnId: dev.id, title: 'Старая' })!
    const newer = firstDb.createTask('alice', p.id, { columnId: dev.id, title: 'Новая' })!
    clock += 1
    firstDb.moveTask('alice', p.id, older.id, { columnId: done.id })
    clock += 1
    firstDb.moveTask('alice', p.id, newer.id, { columnId: done.id })
    firstDb.close()

    const restarted = new VoiceChatDb(file, { now: () => clock })
    expect(restarted.getBoard('alice', p.id)!.tasks.filter((task) => task.columnId === done.id).map((task) => task.id))
      .toEqual([newer.id, older.id])
    restarted.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('миграция: у лежащих в «Готово» задач появляется doneAt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-doneat-'))
    const file = join(dir, 'db.sqlite')
    const first = new VoiceChatDb(file, { now: () => 1_700_000_000_000 })
    first.createUser('alice', '', 'developer')
    const p = first.createProject('alice', { name: 'P' })
    const done = first.getBoard('alice', p.id)!.columns.find((c) => c.semanticType === 'done')!
    const t = first.createTask('alice', p.id, { columnId: done.id, title: 'T' })!
    // Имитируем БД до миграции: колонки done_at ещё нет.
    first.close()
    const raw = new Database(file)
    raw.exec(`ALTER TABLE tasks DROP COLUMN done_at`)
    raw.close()

    const migrated = new VoiceChatDb(file, { now: () => 1_700_000_000_000 + 100 * 24 * 60 * 60 * 1000 })
    // doneAt взят из updated_at, порог 14 дней уже вышел — карточки на доске нет.
    expect(migrated.getBoard('alice', p.id)!.tasks.map((x) => x.id)).not.toContain(t.id)
    expect(migrated.getBoard('alice', p.id, { includeCompleted: true })!.tasks.find((x) => x.id === t.id)!.doneAt)
      .toBe(1_700_000_000_000)
    migrated.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('projects: чаты завершённых задач в списке бесед', () => {
  /** Проект с задачей в работе, её чатом и колонкой «Готово». */
  function withTaskChat(): { pid: string; taskId: string; chatId: string; dev: string; done: string } {
    const p = db.createProject('alice', { name: 'P' })
    const board = db.getBoard('alice', p.id)!
    const dev = board.columns[0]!
    const done = board.columns.find((c) => c.semanticType === 'done')!
    const task = db.createTask('alice', p.id, { columnId: dev.id, title: 'Скролл' })!
    const chat = db.openOrCreateTaskChat('alice', p.id, task.id)!
    return { pid: p.id, taskId: task.id, chatId: chat.id, dev: dev.id, done: done.id }
  }

  it('задача в «Готово» убирает свой чат из списка, возврат в работу — возвращает', () => {
    const { pid, taskId, chatId, dev, done } = withTaskChat()
    expect(db.listConversations('alice').map((c) => c.id)).toContain(chatId)

    db.moveTask('alice', pid, taskId, { columnId: done })
    expect(db.listConversations('alice').map((c) => c.id)).not.toContain(chatId)
    // Скрытие — только про список: сам чат открывается по id как раньше.
    expect(db.getConversation('alice', chatId)!.id).toBe(chatId)
    expect(db.listConversations('alice', { includeCompleted: true }).map((c) => c.id)).toContain(chatId)

    db.moveTask('alice', pid, taskId, { columnId: dev })
    expect(db.listConversations('alice').map((c) => c.id)).toContain(chatId)
  })

  it('скрытие не зависит от порога дней: done — и чата в списке нет', () => {
    const { pid, taskId, chatId, done } = withTaskChat()
    // Порог «не скрывать никогда» держит карточку на доске, но не чат в списке.
    db.updateProject('alice', pid, { doneRetentionDays: null })
    db.moveTask('alice', pid, taskId, { columnId: done })
    expect(db.getBoard('alice', pid)!.tasks.map((t) => t.id)).toContain(taskId)
    expect(db.listConversations('alice').map((c) => c.id)).not.toContain(chatId)
  })

  it('поиск по беседам скрывает те же чаты', () => {
    const { pid, taskId, chatId, done } = withTaskChat()
    expect(db.searchConversations('alice', 'Скролл').map((c) => c.id)).toContain(chatId)
    db.moveTask('alice', pid, taskId, { columnId: done })
    expect(db.searchConversations('alice', 'Скролл').map((c) => c.id)).not.toContain(chatId)
    expect(db.searchConversations('alice', 'Скролл', { includeCompleted: true }).map((c) => c.id)).toContain(chatId)
  })

  it('отмена отдельного CI-рана не скрывает чат активной задачи', () => {
    const { pid, taskId, chatId, dev } = withTaskChat()
    const run = db.createCiRun({
      projectId: pid,
      taskId,
      agentId: null,
      triggeredBy: 'alice',
      prevColumnId: dev,
      runColumnId: dev,
      slotProgress: { done: 0, total: 1, phase: 'Отменён' }
    })
    db.updateCiRun(run.id, { status: 'cancelled', terminalColumnId: dev })

    expect(db.listConversations('alice').map((c) => c.id)).toContain(chatId)
    expect(db.getBoard('alice', pid)!.tasks.find((task) => task.id === taskId)!.columnId).toBe(dev)
  })

  it('обычные чаты (без задачи) в списке остаются', () => {
    const { pid, taskId, done } = withTaskChat()
    const plain = db.createConversation('alice', 'Просто чат')
    db.moveTask('alice', pid, taskId, { columnId: done })
    expect(db.listConversations('alice').map((c) => c.id)).toContain(plain.id)
  })
})

describe('projects: пред-разработческая подготовка', () => {
  it('атомарно создаёт отдельный ран и переводит TODO в preparation', () => {
    const project = db.createProject('alice', { name: 'Preparation' })
    const board = db.getBoard('alice', project.id)!
    const backlog = board.columns.find((column) => column.semanticType === 'backlog')!
    const preparation = board.columns.find((column) => column.semanticType === 'preparation')!
    const task = db.createTask('alice', project.id, { columnId: backlog.id, title: 'Уточнить workflow' })!
    const run = db.startTaskPreparationRun('alice', project.id, task.id)
    expect(run.status).toBe('running')
    expect(db.getBoard('alice', project.id)!.tasks.find((item) => item.id === task.id)!.columnId).toBe(preparation.id)
    expect(db.startTaskPreparationRun('alice', project.id, task.id).id).toBe(run.id)
  })

  it('ошибка оставляет карточку в preparation и разрешает повтор', () => {
    const project = db.createProject('alice', { name: 'Preparation failure' })
    const board = db.getBoard('alice', project.id)!
    const backlog = board.columns.find((column) => column.semanticType === 'backlog')!
    const preparation = board.columns.find((column) => column.semanticType === 'preparation')!
    const task = db.createTask('alice', project.id, { columnId: backlog.id, title: 'Неполные требования' })!
    const run = db.startTaskPreparationRun('alice', project.id, task.id)
    db.failTaskPreparationRun(run.id, 'Гейт не пройден', ['missing_acceptance_criteria'])
    expect(db.getTaskPreparationRun('alice', run.id)).toMatchObject({ status: 'failed', canRetry: true, gateReasons: ['missing_acceptance_criteria'] })
    expect(db.getBoard('alice', project.id)!.tasks.find((item) => item.id === task.id)!.columnId).toBe(preparation.id)
    const retry = db.startTaskPreparationRun('alice', project.id, task.id)
    expect(retry).toMatchObject({ status: 'running', attempt: 2 })
    expect(db.listTaskPreparationRuns('alice', project.id, task.id).map((item) => item.id)).toEqual([retry.id, run.id])
  })
})
