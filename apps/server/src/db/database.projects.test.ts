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
    expect(board.columns.map((c) => c.name)).toEqual(['Бэклог', 'Готово к разработке', 'В разработке', 'Тестирование', 'Ожидает мержа', 'Готово'])
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
    expect(cols.map((c) => c.name)).toEqual(['Бэклог', 'Готово к разработке', 'В разработке', 'Тестирование', 'Ожидает мержа', 'Готово', 'Review'])
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


describe('work items + feature runs', () => {
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

  it('хранит историю Feature Run и синхронизирует системные колонки', () => {
    const p = db.createProject('alice', { name: 'P' })
    const agent = db.createAgent('alice', 'M')
    db.linkMachine('alice', p.id, agent.id)
    db.setProjectMachineFeatureReposRoot('alice', p.id, agent.id, '/repos')
    db.setProjectDefaultMachine('alice', p.id, agent.id)
    const ready = db.getBoard('alice', p.id)!.columns.find((c) => c.semanticType === 'ready')!
    const task = db.createTask('alice', p.id, { columnId: ready.id, title: 'Feature task' })!
    let feature = db.createFeatureFromTask('alice', p.id, task.id, { autoMerge: true })!
    expect(feature.attempt).toBe(1)
    expect(db.getBoard('alice', p.id)!.tasks.find((t) => t.id === task.id)!.columnId).not.toBe(ready.id)
    feature = db.transitionFeature('alice', feature.id, 'planning')!
    feature = db.transitionFeature('alice', feature.id, 'awaiting_plan_approval')!
    feature = db.transitionFeature('alice', feature.id, 'development')!
    feature = db.transitionFeature('alice', feature.id, 'testing')!
    expect(db.getBoard('alice', p.id)!.columns.find((c) => c.id === db.getBoard('alice', p.id)!.tasks.find((t) => t.id === task.id)!.columnId)!.semanticType).toBe('testing')
    feature = db.transitionFeature('alice', feature.id, 'cancelled')!
    expect(db.getBoard('alice', p.id)!.columns.find((c) => c.id === db.getBoard('alice', p.id)!.tasks.find((t) => t.id === task.id)!.columnId)!.semanticType).toBe('ready')
    const retry = db.createFeatureFromTask('alice', p.id, task.id, {})!
    expect(retry.attempt).toBe(2)
    expect(retry.previousFeatureId).toBe(feature.id)
  })

  it('deleteTask удаляет задачу вместе с её Feature Run и освобождает рабочую копию', () => {
    const p = db.createProject('alice', { name: 'P' })
    const agent = db.createAgent('alice', 'M')
    db.linkMachine('alice', p.id, agent.id)
    db.setProjectMachineFeatureReposRoot('alice', p.id, agent.id, '/repos')
    db.setProjectDefaultMachine('alice', p.id, agent.id)
    const ready = db.getBoard('alice', p.id)!.columns.find((c) => c.semanticType === 'ready')!
    const task = db.createTask('alice', p.id, { columnId: ready.id, title: 'Feature task' })!
    const feature = db.createFeatureFromTask('alice', p.id, task.id, {})!
    const slot = db.reserveRepositorySlot('alice', feature.id)!
    // Задача с фичей раньше не удалялась: FK features.source_task_id RESTRICT.
    expect(db.deleteTask('alice', p.id, task.id)).toBe(true)
    expect(db.getBoard('alice', p.id)!.tasks.find((t) => t.id === task.id)).toBeUndefined()
    expect(db.listFeatures('alice', p.id)!.find((f) => f.id === feature.id)).toBeUndefined()
    // Рабочая копия освобождена и снова доступна к резервированию.
    const t2 = db.createTask('alice', p.id, { columnId: ready.id, title: 'Next' })!
    const f2 = db.createFeatureFromTask('alice', p.id, t2.id, {})!
    const reused = db.reserveRepositorySlot('alice', f2.id)!
    expect(reused.id).toBe(slot.id)
  })

  it('атомарно резервирует разные repository slots для параллельных фич', () => {
    const p = db.createProject('alice', { name: 'P' })
    const agent = db.createAgent('alice', 'M')
    db.linkMachine('alice', p.id, agent.id)
    db.setProjectMachineFeatureReposRoot('alice', p.id, agent.id, '/repos')
    db.setProjectDefaultMachine('alice', p.id, agent.id)
    const ready = db.getBoard('alice', p.id)!.columns.find((c) => c.semanticType === 'ready')!
    const t1 = db.createTask('alice', p.id, { columnId: ready.id, title: 'A' })!
    const t2 = db.createTask('alice', p.id, { columnId: ready.id, title: 'B' })!
    const f1 = db.createFeatureFromTask('alice', p.id, t1.id, {})!
    const f2 = db.createFeatureFromTask('alice', p.id, t2.id, {})!
    const s1 = db.reserveRepositorySlot('alice', f1.id)!
    const s2 = db.reserveRepositorySlot('alice', f2.id)!
    expect(s1.id).not.toBe(s2.id)
    expect(s1.path).not.toBe(s2.path)
  })
})
