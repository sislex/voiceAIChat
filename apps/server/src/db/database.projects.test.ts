import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VoiceChatDb } from './database.js'

let db: VoiceChatDb

beforeEach(() => {
  let id = 0
  let clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  db.createUser('alice', '', 'user')
  db.createUser('bob', '', 'user')
  db.createUser('carol', '', 'user')
})

afterEach(() => db.close())

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
    expect(board.columns.map((c) => c.name)).toEqual(['To Do', 'In Progress', 'Done'])
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

  it('removeMember не трогает владельца, снимает назначения', () => {
    const p = db.createProject('alice', { name: 'P1' })
    db.addMember('alice', p.id, 'bob')
    const col = db.getBoard('alice', p.id)!.columns[0]
    const task = db.createTask('alice', p.id, { columnId: col.id, title: 'T', assignee: 'bob' })!
    expect(task.assignee).toBe('bob')
    db.removeMember('alice', p.id, 'bob')
    expect(db.getProject('bob', p.id)).toBeNull()
    expect(db.getBoard('alice', p.id)!.tasks[0].assignee).toBeNull()
    // владельца удалить нельзя
    db.removeMember('alice', p.id, 'alice')
    expect(db.getProject('alice', p.id)!.members.map((m) => m.username)).toContain('alice')
  })
})

describe('projects: машины', () => {
  it('linkMachine валидирует владение агентом; каскад при удалении агента', () => {
    const p = db.createProject('alice', { name: 'P1' })
    const agent = db.createAgent('alice', 'M1')
    const foreign = db.createAgent('bob', 'M2')
    expect(() => db.linkMachine('alice', p.id, foreign.id)).toThrow() // чужой агент
    const detail = db.linkMachine('alice', p.id, agent.id)!
    expect(detail.machineIds).toEqual([agent.id])
    db.deleteAgent('alice', agent.id) // CASCADE снимает связь
    expect(db.getProject('alice', p.id)!.machineIds).toEqual([])
  })
})

describe('board: колонки и порядок', () => {
  it('createColumn добавляет в конец; reorderColumns переставляет', () => {
    const p = db.createProject('alice', { name: 'P1' })
    const c4 = db.createColumn('alice', p.id, 'Review')!
    let cols = db.getBoard('alice', p.id)!.columns
    expect(cols.map((c) => c.name)).toEqual(['To Do', 'In Progress', 'Done', 'Review'])
    const reversed = cols.map((c) => c.id).reverse()
    expect(db.reorderColumns('alice', p.id, reversed)).toBe(true)
    cols = db.getBoard('alice', p.id)!.columns
    expect(cols.map((c) => c.id)).toEqual(reversed)
    // неполный/чужой набор — отказ
    expect(db.reorderColumns('alice', p.id, [c4.id])).toBe(false)
  })

  it('setColumnHidden и deleteColumn (каскад задач)', () => {
    const p = db.createProject('alice', { name: 'P1' })
    const col = db.getBoard('alice', p.id)!.columns[0]
    db.createTask('alice', p.id, { columnId: col.id, title: 'T' })
    expect(db.setColumnHidden('alice', p.id, col.id, true)).toBe(true)
    expect(db.getBoard('alice', p.id)!.columns[0].hidden).toBe(true)
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
    expect(() => db.updateTask('alice', p.id, t.id, { assignee: 'carol' })).toThrow()
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
