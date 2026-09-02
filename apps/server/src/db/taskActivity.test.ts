// Активность карточки (как в Jira): история изменений пишется сервером сама,
// комментарии и ворклог — CRUD с правами «автор, владелец проекта или админ».
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VoiceChatDb } from './database.js'

let db: VoiceChatDb
let projectId: string
let taskId: string
const OWNER = 'owner'
const DEV = 'dev'

beforeEach(() => {
  db = new VoiceChatDb(':memory:')
  db.createUser(OWNER, '', 'developer')
  db.createUser(DEV, '', 'developer')
  db.createUser('admin', '', 'admin')
  const project = db.createProject(OWNER, { name: 'P' })
  projectId = project.id
  db.addMember(OWNER, projectId, DEV)
  // Админ действует в проекте только как его участник: членство — граница
  // видимости проекта, роль — граница модерации внутри него.
  db.addMember(OWNER, projectId, 'admin')
  const board = db.getBoard(OWNER, projectId)!
  taskId = db.createTask(OWNER, projectId, { columnId: board.columns[0]!.id, title: 'Задача', priority: 'medium' })!.id
})
afterEach(() => db.close())

describe('история изменений', () => {
  it('updateTask пишет только реально изменившиеся видимые поля', () => {
    db.updateTask(DEV, projectId, taskId, { title: 'Новое имя', priority: 'medium', description: 'Появилось описание' })
    const history = db.taskActivity(DEV, projectId, taskId)!.history
    expect(history.map((event) => [event.field, event.from, event.to])).toEqual([
      ['description', null, 'Появилось описание'],
      ['title', 'Задача', 'Новое имя']
    ])
    expect(history.every((event) => event.actor === DEV)).toBe(true)
    // priority не изменился — строки нет.
    expect(history.some((event) => event.field === 'priority')).toBe(false)
  })

  it('перенос между колонками пишет имена колонок, перестановка внутри — нет', () => {
    const board = db.getBoard(OWNER, projectId)!
    const target = board.columns[1]!
    db.moveTask(DEV, projectId, taskId, { columnId: target.id })
    db.moveTask(DEV, projectId, taskId, { columnId: target.id }) // внутри колонки
    const moves = db.taskActivity(DEV, projectId, taskId)!.history.filter((event) => event.field === 'column')
    expect(moves).toHaveLength(1)
    expect(moves[0]!.to).toBe(target.name)
  })
})

describe('комментарии', () => {
  it('добавляются человеком и моделью, правятся автором, помечаются как изменённые', () => {
    const mine = db.addTaskComment(DEV, projectId, taskId, ' Первый ')!
    expect(mine.text).toBe('Первый')
    const byModel = db.addTaskComment(OWNER, projectId, taskId, 'Модель предлагает уточнить критерии', 'model')!
    expect(byModel.via).toBe('model')

    const edited = db.updateTaskComment(DEV, projectId, mine.id, 'Первый (уточнил)')!
    expect(edited.updatedAt).not.toBeNull()

    const activity = db.taskActivity(DEV, projectId, taskId)!
    expect(activity.comments.map((comment) => comment.via)).toEqual(['user', 'model'])
  })

  it('чужой комментарий не правится участником, но правится владельцем и админом', () => {
    const comment = db.addTaskComment(OWNER, projectId, taskId, 'От владельца')!
    expect(() => db.updateTaskComment(DEV, projectId, comment.id, 'взлом')).toThrow(/автор, владелец/)
    expect(db.updateTaskComment('admin', projectId, comment.id, 'поправил админ')).not.toBeNull()
    expect(db.deleteTaskComment(OWNER, projectId, comment.id)).toBe(true)
  })

  it('пустой комментарий не сохраняется', () => {
    expect(() => db.addTaskComment(DEV, projectId, taskId, '   ')).toThrow(/Пустой/)
  })
})

describe('ворклог', () => {
  it('складывает минуты в totalMinutes и правится автором', () => {
    db.addTaskWorklog(DEV, projectId, taskId, { minutes: 90, comment: 'вёрстка' })
    const entry = db.addTaskWorklog(OWNER, projectId, taskId, { minutes: 30 })!
    expect(db.taskActivity(DEV, projectId, taskId)!.totalMinutes).toBe(120)

    db.updateTaskWorklog(OWNER, projectId, entry.id, { minutes: 45 })
    expect(db.taskActivity(DEV, projectId, taskId)!.totalMinutes).toBe(135)
    expect(() => db.updateTaskWorklog(DEV, projectId, entry.id, { minutes: 5 })).toThrow(/автор, владелец/)
    expect(db.deleteTaskWorklog(OWNER, projectId, entry.id)).toBe(true)
    expect(db.taskActivity(DEV, projectId, taskId)!.totalMinutes).toBe(90)
  })

  it('нулевое и отрицательное время отклоняются', () => {
    expect(() => db.addTaskWorklog(DEV, projectId, taskId, { minutes: 0 })).toThrow(/от 1 минуты/)
    expect(() => db.addTaskWorklog(DEV, projectId, taskId, { minutes: -10 })).toThrow(/от 1 минуты/)
  })
})

describe('доступ', () => {
  it('не участнику проекта активность недоступна', () => {
    db.createUser('stranger', '', 'developer')
    expect(db.taskActivity('stranger', projectId, taskId)).toBeNull()
    expect(db.addTaskComment('stranger', projectId, taskId, 'привет')).toBeNull()
  })
})
