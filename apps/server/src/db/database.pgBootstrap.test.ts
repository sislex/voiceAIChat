// Одновременный старт нескольких процессов на одной базе Postgres (ядро + канбан + машины + ридер в compose):
// каждый открывает `VoiceChatDb` и ставит схему `CREATE TABLE IF NOT EXISTS …`. Без сериализации две сессии
// берут замки на связанные таблицы в разном порядке и Postgres валит одну из них deadlock-ом (40P01) — так
// упало ядро на прогоне этапа 4. Только на Postgres (`VC_TEST_DB_URL`): в SQLite один файл — один процесс.
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { VoiceChatDb } from './database.js'

const URL = process.env.VC_TEST_DB_URL
const schema = `b_${randomUUID().replace(/-/g, '').slice(0, 12)}`

afterAll(async () => {
  if (!URL) return
  const admin = new pg.Client({ connectionString: URL })
  await admin.connect(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end()
})

describe.skipIf(!URL)('старт нескольких процессов на одной базе Postgres', () => {
  it('четыре экземпляра ставят схему одновременно без deadlock и видят одни и те же данные', async () => {
    const dbs = Array.from({ length: 4 }, () => new VoiceChatDb(':memory:', { postgres: { url: URL!, schema } }))
    try {
      await Promise.all(dbs.map((db) => db.ready))
      await dbs[0]!.identity.createUser('ann', 'pw', 'developer')
      expect((await dbs[3]!.identity.getUser('ann'))?.role).toBe('developer')
    } finally {
      await Promise.all(dbs.map((db) => db.close()))
    }
  }, 120_000)

  it('adds columns to an existing schema and backfills their task-level value', async () => {
    const upgradeSchema = `u_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const first = new VoiceChatDb(':memory:', { postgres: { url: URL!, schema: upgradeSchema } })
    let projectId = ''
    let taskId = ''
    try {
      await first.ready
      await first.identity.createUser('upgrade-owner', 'pw', 'admin')
      const project = await first.projects.createProject('upgrade-owner', { name: 'Upgrade' })
      projectId = project.id
      await first.projects.updateProject('upgrade-owner', projectId, { autoPilotRequiresManualQa: true })
      const board = (await first.tasks.getBoard('upgrade-owner', projectId))!
      const backlog = board.columns.find((column) => column.semanticType === 'backlog')!
      const task = await first.tasks.createTask('upgrade-owner', projectId, { columnId: backlog.id, title: 'Existing task' })
      taskId = task!.id
    } finally {
      await first.close()
    }

    const admin = new pg.Client({ connectionString: URL! })
    await admin.connect()
    await admin.query(`SET search_path TO ${upgradeSchema}`)
    await admin.query(`ALTER TABLE tasks DROP COLUMN auto_pilot_requires_manual_qa`)
    await admin.end()

    const upgraded = new VoiceChatDb(':memory:', { postgres: { url: URL!, schema: upgradeSchema } })
    try {
      await upgraded.ready
      expect((await upgraded.tasks.getTaskDetail('upgrade-owner', projectId, taskId))?.autoPilotRequiresManualQa).toBe(true)
    } finally {
      await upgraded.close()
      const cleanup = new pg.Client({ connectionString: URL! })
      await cleanup.connect()
      await cleanup.query(`DROP SCHEMA IF EXISTS ${upgradeSchema} CASCADE`)
      await cleanup.end()
    }
  }, 120_000)
})
