// Task history (as in Jira) is written by the server itself on task mutations;
// Kanban reads it from the shared table and owns comments and worklog.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Sql } from '@sislexa/identity/storage-sql/types'
import { VoiceChatDb } from './database.js'
import * as dbSeed from '../test/seed.js'

let db: VoiceChatDb
let projectId: string
let taskId: string
const OWNER = 'owner'
const DEV = 'dev'

beforeEach(async () => {
  db = new VoiceChatDb(':memory:')
  await db.identity.createUser(OWNER, '', 'developer')
  await db.identity.createUser(DEV, '', 'developer')
  const project = await db.projects.createProject(OWNER, { name: 'P' })
  projectId = project.id
  await dbSeed.addMember(db, OWNER, projectId, DEV)
  const board = (await db.tasks.getBoard(OWNER, projectId))!
  taskId = (await db.tasks.createTask(OWNER, projectId, { columnId: board.columns[0]!.id, title: 'Задача', priority: 'medium' }))!.id
})
afterEach(() => db.close())

const history = async () => (db as unknown as { sql: Sql }).sql.all<{ actor: string; field: string; from_value: string | null; to_value: string | null }>(
  'SELECT actor, field, from_value, to_value FROM task_history WHERE task_id = ? ORDER BY at, field', [taskId])

describe('история изменений', () => {
  it('перенос между колонками пишет имена колонок, перестановка внутри — нет', async () => {
    const board = (await db.tasks.getBoard(OWNER, projectId))!
    const target = board.columns[1]!
    await db.tasks.moveTask(DEV, projectId, taskId, { columnId: target.id })
    await db.tasks.moveTask(DEV, projectId, taskId, { columnId: target.id }) // внутри колонки
    const moves = (await history()).filter((event) => event.field === 'column')
    expect(moves).toHaveLength(1)
    expect(moves[0]!.to_value).toBe(target.name)
  })
})
