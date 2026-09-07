// Адаптер `Sql` над node-postgres. Репозитории пишут SQL в диалекте SQLite — перевод делает
// `dialect.ts` на каждом запросе (дёшево: регулярки по строке; пул подготовленных выражений
// держит сам сервер Postgres). Транзакция — выделенный клиент пула, привязанный к асинхронному
// контексту через AsyncLocalStorage: всё, что выполняется внутри `transaction(fn)`, идёт по нему,
// вложенные — SAVEPOINT. Вне транзакций запросы идут через пул параллельно — здесь, в отличие от
// SQLite, параллелизм и есть цель.

import { AsyncLocalStorage } from 'node:async_hooks'
import pg from 'pg'
import { translateToPostgres } from './dialect.js'
import type { RunResult, Sql, SqlParam, Statement } from './types.js'

// int8 и numeric приходят строками — для нас это метки времени в мс и счётчики, JSON их не переживёт.
pg.types.setTypeParser(20, (v) => Number(v))
pg.types.setTypeParser(1700, (v) => Number(v))

interface TxStore { client: pg.PoolClient; id: number; depth: number }
const TRACE = process.env.VC_SQL_TRACE === '1'

export interface PgSqlOptions {
  connectionString: string
  /** Схема (search_path) — тесты изолируют друг друга отдельными схемами. */
  schema?: string
  max?: number
}

export interface PgSql extends Sql {
  readonly engine: 'postgres'
  readonly pool: pg.Pool
  /** Имя схемы, если задана. */
  readonly schema: string | null
}

export function createPgSql(opts: PgSqlOptions): PgSql {
  const pool = new pg.Pool({
    connectionString: opts.connectionString,
    max: opts.max ?? 10,
    ...(opts.schema ? { options: `-c search_path=${opts.schema}` } : {})
  })
  const als = new AsyncLocalStorage<TxStore>()
  let txSeq = 0
  const conn = (): pg.Pool | pg.PoolClient => als.getStore()?.client ?? pool
  const query = async (text: string, params: readonly SqlParam[] | undefined): Promise<pg.QueryResult> => {
    const { text: translated, values } = translateToPostgres(text, params)
    // VC_SQL_TRACE=1 — каждый запрос с длительностью в stderr: искать зависания и медленные места.
    const started = TRACE ? performance.now() : 0
    try {
      const res = await conn().query(translated, values)
      if (TRACE) console.error(`[sql ${(performance.now() - started).toFixed(1)}ms${als.getStore() ? ' tx' : ''}] ${translated.replace(/\s+/g, ' ').slice(0, 160)}`)
      return res
    } catch (error) {
      if (TRACE) console.error(`[sql FAIL${als.getStore() ? ' tx' : ''}] ${translated.replace(/\s+/g, ' ').slice(0, 160)} — ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
      // В тексте ошибки нужен сам запрос: иначе «syntax error at or near» не найти среди 900 запросов.
      if (error instanceof Error) error.message = `${error.message}\n  SQL: ${translated.replace(/\s+/g, ' ').slice(0, 700)}`
      throw error
    }
  }
  const toRun = (res: pg.QueryResult): RunResult => ({ changes: res.rowCount ?? 0, lastInsertRowid: Number((res.rows[0] as { rowid?: unknown } | undefined)?.rowid ?? 0) })

  const sql: PgSql = {
    engine: 'postgres',
    pool,
    schema: opts.schema ?? null,
    async get<T>(text: string, params?: readonly SqlParam[]) { return (await query(text, params)).rows[0] as T | undefined },
    async all<T>(text: string, params?: readonly SqlParam[]) { return (await query(text, params)).rows as T[] },
    async run(text, params) { return toRun(await query(text, params)) },
    async exec(text) { await conn().query(text) },
    prepare(text): Statement {
      return {
        get: <T>(...params: SqlParam[]) => sql.get<T>(text, params),
        all: <T>(...params: SqlParam[]) => sql.all<T>(text, params),
        run: (...params: SqlParam[]) => sql.run(text, params)
      }
    },
    inTransaction: () => als.getStore() !== undefined,
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      const store = als.getStore()
      if (store) {
        const name = `sp_${store.id}_${++store.depth}`
        await store.client.query(`SAVEPOINT ${name}`)
        try {
          const result = await fn()
          await store.client.query(`RELEASE SAVEPOINT ${name}`)
          return result
        } catch (error) {
          await store.client.query(`ROLLBACK TO SAVEPOINT ${name}`)
          await store.client.query(`RELEASE SAVEPOINT ${name}`)
          throw error
        } finally { store.depth-- }
      }
      const client = await pool.connect()
      try {
        return await als.run({ client, id: ++txSeq, depth: 0 }, async () => {
          await client.query('BEGIN')
          try {
            const result = await fn()
            await client.query('COMMIT')
            return result
          } catch (error) {
            await client.query('ROLLBACK').catch(() => {})
            throw error
          }
        })
      } finally { client.release() }
    },
    async close() { await pool.end() }
  }
  return sql
}
