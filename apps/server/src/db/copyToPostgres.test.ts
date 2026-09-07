// Перенос SQLite → Postgres: заводим данные в SQLite-файле через обычные репозитории, копируем,
// открываем Postgres-базу тем же VoiceChatDb и читаем то же самое через порты.
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { VoiceChatDb } from './database.js'
import { copySqliteToPostgres } from './copyToPostgres.js'

const URL = process.env.VC_TEST_DB_URL
const schema = `c_${randomUUID().replace(/-/g, '').slice(0, 12)}`
const dir = mkdtempSync(join(tmpdir(), 'vc-copy-'))

afterAll(async () => {
  rmSync(dir, { recursive: true, force: true })
  if (!URL) return
  const admin = new pg.Client({ connectionString: URL })
  await admin.connect(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end()
})

describe.skipIf(!URL)('перенос базы в Postgres', () => {
  it('строки, rowid и последовательности переезжают; повтор идемпотентен', async () => {
    const file = join(dir, 'source.db')
    const src = new VoiceChatDb(file)
    await src.identity.createUser('ann', 'pw', 'developer')
    const project = await src.projects.createProject('ann', { name: 'Перенос' })
    const conv = await src.chat.createConversation('ann', 'Разговор', null, project.id)
    for (let i = 0; i < 7; i++) await src.chat.addMessage('ann', conv.id, i % 2 ? 'ai' : 'u1', `сообщение ${i}`, '10:0' + i)
    const board = (await src.tasks.getBoard('ann', project.id))!
    const task = (await src.tasks.createTask('ann', project.id, { columnId: board.columns[0]!.id, title: 'Задача' }))!
    await src.tasks.addTaskComment('ann', project.id, task.id, 'комментарий')
    await src.close()

    const lines: string[] = []
    const report = await copySqliteToPostgres({ sqlitePath: file, postgres: { url: URL!, schema }, batch: 3, log: (l) => lines.push(l) })
    expect(report.tables.messages).toEqual({ sqlite: 7, postgres: 7, skipped: 0 })
    expect(report.tables.users?.postgres).toBe(1)
    expect(Object.values(report.tables).every((t) => t.sqlite === t.postgres)).toBe(true)

    const dst = new VoiceChatDb(':memory:', { postgres: { url: URL!, schema } })
    await dst.ready
    expect((await dst.chat.listMessages('ann', conv.id)).map((m) => m.text)).toEqual(Array.from({ length: 7 }, (_, i) => `сообщение ${i}`))
    expect((await dst.tasks.getBoard('ann', project.id))!.tasks.map((t) => t.title)).toEqual(['Задача'])
    // Последовательности выровнены: новая строка не бьётся о занятый rowid.
    await dst.chat.addMessage('ann', conv.id, 'u1', 'после переноса', '11:00')
    expect((await dst.chat.listMessages('ann', conv.id))).toHaveLength(8)
    await dst.close()

    // Повтор поверх заполненной схемы ничего не дублирует.
    const again = await copySqliteToPostgres({ sqlitePath: file, postgres: { url: URL!, schema } })
    expect(again.tables.messages).toEqual({ sqlite: 7, postgres: 8, skipped: 7 })
  }, 120_000)
})
