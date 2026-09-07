// Активность карточки (как в Jira): история изменений пишется сервером сама,
// комментарии и ворклог — CRUD с правами «автор, владелец проекта или админ».
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VoiceChatDb } from './database.js'

let db: VoiceChatDb
let projectId: string
let taskId: string
const OWNER = 'owner'
const DEV = 'dev'

beforeEach(async () => {
  db = new VoiceChatDb(':memory:')
  await db.identity.createUser(OWNER, '', 'developer')
  await db.identity.createUser(DEV, '', 'developer')
  await db.identity.createUser('admin', '', 'admin')
  const project = await db.projects.createProject(OWNER, { name: 'P' })
  projectId = project.id
  await db.projects.addMember(OWNER, projectId, DEV)
  // Админ действует в проекте только как его участник: членство — граница
  // видимости проекта, роль — граница модерации внутри него.
  await db.projects.addMember(OWNER, projectId, 'admin')
  const board = (await db.tasks.getBoard(OWNER, projectId))!
  taskId = (await db.tasks.createTask(OWNER, projectId, { columnId: board.columns[0]!.id, title: 'Задача', priority: 'medium' }))!.id
})
afterEach(() => db.close())

describe('история изменений', () => {
  it('updateTask пишет только реально изменившиеся видимые поля', async () => {
    await db.tasks.updateTask(DEV, projectId, taskId, { title: 'Новое имя', priority: 'medium', description: 'Появилось описание' })
    const history = (await db.tasks.taskActivity(DEV, projectId, taskId))!.history
    expect(history.map((event) => [event.field, event.from, event.to])).toEqual([
      ['description', null, 'Появилось описание'],
      ['title', 'Задача', 'Новое имя']
    ])
    expect(history.every((event) => event.actor === DEV)).toBe(true)
    // priority не изменился — строки нет.
    expect(history.some((event) => event.field === 'priority')).toBe(false)
  })

  it('перенос между колонками пишет имена колонок, перестановка внутри — нет', async () => {
    const board = (await db.tasks.getBoard(OWNER, projectId))!
    const target = board.columns[1]!
    await db.tasks.moveTask(DEV, projectId, taskId, { columnId: target.id })
    await db.tasks.moveTask(DEV, projectId, taskId, { columnId: target.id }) // внутри колонки
    const moves = (await db.tasks.taskActivity(DEV, projectId, taskId))!.history.filter((event) => event.field === 'column')
    expect(moves).toHaveLength(1)
    expect(moves[0]!.to).toBe(target.name)
  })
})

describe('комментарии', () => {
  it('добавляются человеком и моделью, правятся автором, помечаются как изменённые', async () => {
    const mine = (await db.tasks.addTaskComment(DEV, projectId, taskId, ' Первый '))!
    expect(mine.text).toBe('Первый')
    const byModel = (await db.tasks.addTaskComment(OWNER, projectId, taskId, 'Модель предлагает уточнить критерии', 'model'))!
    expect(byModel.via).toBe('model')

    const edited = (await db.tasks.updateTaskComment(DEV, projectId, mine.id, 'Первый (уточнил)'))!
    expect(edited.updatedAt).not.toBeNull()

    const activity = (await db.tasks.taskActivity(DEV, projectId, taskId))!
    expect(activity.comments.map((comment) => comment.via)).toEqual(['user', 'model'])
  })

  it('чужой комментарий не правится участником, но правится владельцем и админом', async () => {
    const comment = (await db.tasks.addTaskComment(OWNER, projectId, taskId, 'От владельца'))!
    await expect(async () => await db.tasks.updateTaskComment(DEV, projectId, comment.id, 'взлом')).rejects.toThrow(/автор, владелец/)
    expect(await db.tasks.updateTaskComment('admin', projectId, comment.id, 'поправил админ')).not.toBeNull()
    expect(await db.tasks.deleteTaskComment(OWNER, projectId, comment.id)).toBe(true)
  })

  it('пустой комментарий не сохраняется', async () => {
    await expect(async () => await db.tasks.addTaskComment(DEV, projectId, taskId, '   ')).rejects.toThrow(/Пустой/)
  })
})

describe('ворклог', () => {
  it('складывает минуты в totalMinutes и правится автором', async () => {
    await db.tasks.addTaskWorklog(DEV, projectId, taskId, { minutes: 90, comment: 'вёрстка' })
    const entry = (await db.tasks.addTaskWorklog(OWNER, projectId, taskId, { minutes: 30 }))!
    expect((await db.tasks.taskActivity(DEV, projectId, taskId))!.totalMinutes).toBe(120)

    await db.tasks.updateTaskWorklog(OWNER, projectId, entry.id, { minutes: 45 })
    expect((await db.tasks.taskActivity(DEV, projectId, taskId))!.totalMinutes).toBe(135)
    await expect(async () => await db.tasks.updateTaskWorklog(DEV, projectId, entry.id, { minutes: 5 })).rejects.toThrow(/автор, владелец/)
    expect(await db.tasks.deleteTaskWorklog(OWNER, projectId, entry.id)).toBe(true)
    expect((await db.tasks.taskActivity(DEV, projectId, taskId))!.totalMinutes).toBe(90)
  })

  it('нулевое и отрицательное время отклоняются', async () => {
    await expect(async () => await db.tasks.addTaskWorklog(DEV, projectId, taskId, { minutes: 0 })).rejects.toThrow(/от 1 минуты/)
    await expect(async () => await db.tasks.addTaskWorklog(DEV, projectId, taskId, { minutes: -10 })).rejects.toThrow(/от 1 минуты/)
  })
})

describe('доступ', () => {
  it('не участнику проекта активность недоступна', async () => {
    await db.identity.createUser('stranger', '', 'developer')
    expect(await db.tasks.taskActivity('stranger', projectId, taskId)).toBeNull()
    expect(await db.tasks.addTaskComment('stranger', projectId, taskId, 'привет')).toBeNull()
  })
})
