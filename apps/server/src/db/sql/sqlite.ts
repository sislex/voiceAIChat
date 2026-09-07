// Адаптер `Sql` над better-sqlite3. Драйвер синхронный, поэтому каждый запрос выполняется
// сразу, а промис лишь откладывает продолжение вызывающего — как и раньше делали async-порты.
//
// Транзакции — единственное нетривиальное место. better-sqlite3 умеет `db.transaction(fn)` только
// для синхронного fn, а тела репозиториев теперь асинхронные (общий код с Postgres). Поэтому
// транзакция — явные BEGIN/COMMIT вокруг асинхронного тела, а «своё ли это соединение» решает
// AsyncLocalStorage: запросы из контекста транзакции идут сразу, все остальные ждут её конца,
// иначе чужой запрос оказался бы внутри чужой транзакции на единственном соединении SQLite.
// Вложенная транзакция — SAVEPOINT, как это делает сам better-sqlite3.

import { AsyncLocalStorage } from 'node:async_hooks'
import type Database from 'better-sqlite3'
import type { RunResult, Sql, SqlParam, Statement } from './types.js'

interface TxStore { readonly id: number; depth: number }

/** better-sqlite3 не принимает undefined и boolean: первое — null, второе — 0/1, как SQLite их и хранит. */
function bind(params: readonly SqlParam[] | undefined): unknown[] {
  if (!params) return []
  return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p))
}

export interface SqliteSql extends Sql {
  readonly engine: 'sqlite'
  /** Сырой драйвер — только ядру (PRAGMA, VACUUM INTO, пользовательские функции). */
  readonly raw: Database.Database
}

export function createSqliteSql(db: Database.Database): SqliteSql {
  const als = new AsyncLocalStorage<TxStore>()
  let active: { store: TxStore; done: Promise<void> } | null = null
  let txSeq = 0
  const cache = new Map<string, Database.Statement>()

  const stmt = (sql: string): Database.Statement => {
    let s = cache.get(sql)
    if (!s) {
      s = db.prepare(sql)
      // Кэш ограничен: динамически собранные запросы (фильтры, IN-списки) не должны копиться бесконечно.
      if (cache.size >= 512) cache.delete(cache.keys().next().value!)
      cache.set(sql, s)
    }
    return s
  }
  /**
   * Запрос вне активной транзакции ждёт её конца; внутри — идёт сразу. Без транзакции возвращает
   * undefined, и вызывающий не делает `await` вовсе: первый запрос метода выполняется синхронно,
   * в порядке вызова — на это полагаются схема при открытии базы и тесты, зовущие реализацию напрямую.
   */
  const gate = (): Promise<void> | undefined => {
    if (!active || als.getStore() === active.store) return undefined
    return (async () => { while (active && als.getStore() !== active.store) await active.done })()
  }
  const wait = async (): Promise<void> => { const g = gate(); if (g) await g }
  const toRun = (info: Database.RunResult): RunResult => ({ changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) })

  const sql: SqliteSql = {
    engine: 'sqlite',
    raw: db,
    async get<T>(text: string, params?: readonly SqlParam[]) { const g = gate(); if (g) await g; return stmt(text).get(...(bind(params) as never[])) as T | undefined },
    async all<T>(text: string, params?: readonly SqlParam[]) { const g = gate(); if (g) await g; return stmt(text).all(...(bind(params) as never[])) as T[] },
    async run(text, params) { const g = gate(); if (g) await g; return toRun(stmt(text).run(...(bind(params) as never[]))) },
    async exec(text) { const g = gate(); if (g) await g; db.exec(text) },
    prepare(text): Statement {
      return {
        get: async <T>(...params: SqlParam[]) => { await wait(); return stmt(text).get(...(bind(params) as never[])) as T | undefined },
        all: async <T>(...params: SqlParam[]) => { await wait(); return stmt(text).all(...(bind(params) as never[])) as T[] },
        run: async (...params: SqlParam[]) => { await wait(); return toRun(stmt(text).run(...(bind(params) as never[]))) }
      }
    },
    inTransaction: () => als.getStore() !== undefined,
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      const store = als.getStore()
      if (store) {
        // Вложенная: SAVEPOINT в том же контексте — ошибка откатывает только её.
        const name = `sp_${store.id}_${++store.depth}`
        db.exec(`SAVEPOINT ${name}`)
        try {
          const result = await fn()
          db.exec(`RELEASE SAVEPOINT ${name}`)
          return result
        } catch (error) {
          db.exec(`ROLLBACK TO SAVEPOINT ${name}`)
          db.exec(`RELEASE SAVEPOINT ${name}`)
          throw error
        } finally { store.depth-- }
      }
      // Внешняя: дожидаемся чужой транзакции, занимаем соединение.
      while (active) await active.done
      let release!: () => void
      const own: TxStore = { id: ++txSeq, depth: 0 }
      active = { store: own, done: new Promise<void>((resolve) => { release = resolve }) }
      try {
        return await als.run(own, async () => {
          db.exec('BEGIN')
          try {
            const result = await fn()
            db.exec('COMMIT')
            return result
          } catch (error) {
            if (db.inTransaction) db.exec('ROLLBACK')
            throw error
          }
        })
      } finally {
        active = null
        release()
      }
    },
    async close() { cache.clear(); db.close() }
  }
  return sql
}
