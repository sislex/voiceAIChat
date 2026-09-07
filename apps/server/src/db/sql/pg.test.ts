// Адаптер Postgres — против настоящего сервера (VC_TEST_DB_URL; локально — docker postgres:16).
// Без переменной тесты пропускаются: у гейта нет Postgres, у разработчика — есть контейнер.
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPgSql, type PgSql } from './pg.js'

const URL = process.env.VC_TEST_DB_URL
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(!URL)('адаптер Sql над node-postgres', () => {
  const schema = `t_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  let sql: PgSql
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: URL })
    await admin.connect(); await admin.query(`CREATE SCHEMA ${schema}`); await admin.end()
    sql = createPgSql({ connectionString: URL!, schema })
    await sql.exec('CREATE TABLE t (id BIGSERIAL PRIMARY KEY, name TEXT, flag BIGINT, note TEXT, big BIGINT)')
  })
  afterAll(async () => {
    await sql?.close()
    const admin = new pg.Client({ connectionString: URL })
    await admin.connect(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end()
  })

  it('get/all/run/prepare в диалекте SQLite; int8 приходит числом; boolean → 0/1, undefined → NULL', async () => {
    const ins = sql.prepare('INSERT INTO t (name, flag, note, big) VALUES (?, ?, ?, ?)')
    expect((await ins.run('a', true, undefined, 1_700_000_000_000)).changes).toBe(1)
    await ins.run('b', false, 'x', 2)
    expect(await sql.get('SELECT flag, note, big FROM t WHERE name = ?', ['a'])).toEqual({ flag: 1, note: null, big: 1_700_000_000_000 })
    expect(typeof (await sql.get<{ big: unknown }>('SELECT big FROM t WHERE name = ?', ['a']))!.big).toBe('number')
    expect((await sql.all('SELECT name FROM t ORDER BY id')).map((r) => r.name)).toEqual(['a', 'b'])
    expect((await sql.run('UPDATE t SET flag = 1 WHERE name IS NOT ?', [null])).changes).toBe(2)
    expect(await sql.get('SELECT 1 WHERE false')).toBeUndefined()
    // INSERT OR IGNORE — ON CONFLICT DO NOTHING.
    expect((await sql.run('INSERT OR IGNORE INTO t (id, name) VALUES (?, ?)', [1, 'dup'])).changes).toBe(0)
    // Именованные параметры объектом.
    expect((await sql.all('SELECT name FROM t WHERE name = @n OR big = @b ORDER BY name', [{ n: 'b', b: 1_700_000_000_000 }])).map((r) => r.name)).toEqual(['a', 'b'])
  })

  it('транзакции: откат по ошибке, вложенный SAVEPOINT, параллельный запрос не видит незафиксированное', async () => {
    await expect(sql.transaction(async () => { await sql.run('INSERT INTO t (name) VALUES (?)', ['tx']); throw new Error('нет') })).rejects.toThrow('нет')
    expect(await sql.all('SELECT 1 FROM t WHERE name = ?', ['tx'])).toEqual([])
    const outside: string[] = []
    await sql.transaction(async () => {
      expect(sql.inTransaction()).toBe(true)
      await sql.run('INSERT INTO t (name) VALUES (?)', ['tx1'])
      await sql.transaction(async () => { await sql.run('INSERT INTO t (name) VALUES (?)', ['tx2']) })
      await sql.transaction(async () => { await sql.run('INSERT INTO t (name) VALUES (?)', ['tx3']); throw new Error('внутренняя') }).catch(() => {})
      // Соседнее соединение пула: транзакция ещё открыта — строк не видно.
      await tick()
      outside.push(...(await Promise.resolve().then(() => sql.pool.query(`SELECT name FROM t WHERE name ILIKE 'tx%'`)).then((r) => r.rows.map((x: { name: string }) => x.name))))
    })
    expect(outside).toEqual([])
    expect((await sql.all('SELECT name FROM t WHERE name LIKE ? ORDER BY name', ['TX%'])).map((r) => r.name)).toEqual(['tx1', 'tx2'])
    expect(sql.inTransaction()).toBe(false)
  })

  it('ошибка запроса несёт текст SQL', async () => {
    await expect(sql.get('SELECT nope FROM t')).rejects.toThrow(/SQL: SELECT nope FROM t/)
  })
})
