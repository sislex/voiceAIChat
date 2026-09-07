import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { createSqliteSql } from './sqlite.js'

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))
let sql: ReturnType<typeof createSqliteSql>
const open = () => { sql = createSqliteSql(new Database(':memory:')); return sql }
afterEach(async () => { await sql?.close() })

describe('адаптер Sql над better-sqlite3', () => {
  it('get/all/run и prepare; undefined → NULL, boolean → 0/1; run отдаёт changes и rowid', async () => {
    open()
    await sql.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, flag INTEGER, note TEXT)')
    const ins = sql.prepare('INSERT INTO t (name, flag, note) VALUES (?, ?, ?)')
    expect(await ins.run('a', true, undefined)).toEqual({ changes: 1, lastInsertRowid: 1 })
    await ins.run('b', false, 'x')
    expect(await sql.get('SELECT flag, note FROM t WHERE name = ?', ['a'])).toEqual({ flag: 1, note: null })
    expect((await sql.all('SELECT name FROM t ORDER BY id')).map((r) => r.name)).toEqual(['a', 'b'])
    expect((await sql.run('UPDATE t SET flag = 1')).changes).toBe(2)
    expect(await sql.get('SELECT 1 WHERE 0')).toBeUndefined()
  })

  it('транзакция: ошибка откатывает всё, успех фиксирует; вложенная — только свой SAVEPOINT', async () => {
    open()
    await sql.exec('CREATE TABLE t (v TEXT)')
    await expect(sql.transaction(async () => {
      await sql.run('INSERT INTO t VALUES (?)', ['a'])
      throw new Error('нет')
    })).rejects.toThrow('нет')
    expect(await sql.all('SELECT v FROM t')).toEqual([])
    await sql.transaction(async () => {
      expect(sql.inTransaction()).toBe(true)
      await sql.run('INSERT INTO t VALUES (?)', ['a'])
      await sql.transaction(async () => { await sql.run('INSERT INTO t VALUES (?)', ['b']) })
      await sql.transaction(async () => { await sql.run('INSERT INTO t VALUES (?)', ['c']); throw new Error('внутренняя') }).catch(() => {})
      await sql.run('INSERT INTO t VALUES (?)', ['d'])
    })
    expect(sql.inTransaction()).toBe(false)
    expect((await sql.all('SELECT v FROM t ORDER BY rowid')).map((r) => r.v)).toEqual(['a', 'b', 'd'])
  })

  it('чужие запросы и транзакции ждут конца открытой транзакции, свои — идут сразу', async () => {
    open()
    await sql.exec('CREATE TABLE t (v TEXT)')
    const order: string[] = []
    const tx = sql.transaction(async () => {
      await sql.run('INSERT INTO t VALUES (?)', ['in-tx'])
      await tick(20) // тело ждёт (в реальном коде так не делают, но чужой запрос за это время не должен попасть внутрь)
      order.push('tx-body-end')
      expect((await sql.all('SELECT v FROM t')).map((r) => r.v)).toEqual(['in-tx'])
    })
    await tick(1)
    const outsideRead = sql.all<{ v: string }>('SELECT v FROM t').then((rows) => { order.push(`outside:${rows.map((r) => r.v).join(',')}`) })
    const secondTx = sql.transaction(async () => { order.push('second-tx'); await sql.run('INSERT INTO t VALUES (?)', ['second']) })
    await Promise.all([tx, outsideRead, secondTx])
    // Тело транзакции завершилось раньше всех ожидавших; чужое чтение не увидело незафиксированную
    // строку (и могло увидеть уже вторую транзакцию — порядок двух ожидавших не гарантируется).
    expect(order[0]).toBe('tx-body-end')
    expect(order.slice(1).sort()).toEqual(expect.arrayContaining(['second-tx']))
    expect(order.find((o) => o.startsWith('outside:'))).toMatch(/^outside:in-tx(,second)?$/)
    expect((await sql.all('SELECT v FROM t ORDER BY rowid')).map((r) => r.v)).toEqual(['in-tx', 'second'])
  })
})

describe('синхронный порядок вне транзакций', () => {
  it('первый запрос метода выполняется до возврата промиса — порядок вызовов равен порядку выполнения', async () => {
    const s = createSqliteSql(new Database(':memory:'))
    void s.exec('CREATE TABLE t (v TEXT)')
    void s.run('INSERT INTO t VALUES (?)', ['a'])
    // Без единого await таблица уже создана и строка вставлена.
    expect(s.raw.prepare('SELECT v FROM t').all()).toEqual([{ v: 'a' }])
    await s.close()
  })
})
