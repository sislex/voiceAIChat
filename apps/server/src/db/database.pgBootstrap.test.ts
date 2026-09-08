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
})
