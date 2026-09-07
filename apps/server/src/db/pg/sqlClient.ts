// Минимальный асинхронный SQL-клиент для реализаций доменов на другом движке.
// Позиционные параметры — Postgres-стиль ($1, $2, …). Интерфейс нарочно узкий:
// ровно то, что нужно репозиторию, и ничего от конкретного драйвера — за ним может
// стоять встроенный pglite (сегодня) или node-postgres к настоящему серверу (когда
// домен уедет в отдельный процесс).

export interface SqlClient {
  /** SELECT/INSERT … RETURNING — строки результата. */
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>
  /** DDL и пакеты команд без параметров. */
  exec(sql: string): Promise<void>
  /** Транзакция: внутри работаем только через переданный клиент. */
  transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>
  close(): Promise<void>
}

/** OID типа int8 в Postgres: метки времени в мс не влезают в int4, а BigInt ломает JSON. */
const INT8_OID = 20

/**
 * Встроенный Postgres (`@electric-sql/pglite`, wasm) — файл на диске или память.
 * Импорт ленивый: сервер с движком по умолчанию (SQLite) не должен грузить wasm.
 */
export async function createPgliteClient(dataDir: string | ':memory:'): Promise<SqlClient> {
  const { PGlite } = await import('@electric-sql/pglite')
  const options = { parsers: { [INT8_OID]: (value: string) => Number(value) } }
  const pg = dataDir === ':memory:' ? new PGlite(options) : new PGlite(dataDir, options)
  type Conn = Pick<typeof pg, 'query' | 'exec'>
  const wrap = (conn: Conn): Omit<SqlClient, 'transaction' | 'close'> => ({
    async query<T>(sql: string, params?: readonly unknown[]): Promise<T[]> {
      return (await conn.query<T>(sql, params ? [...params] : undefined)).rows
    },
    async exec(sql: string): Promise<void> {
      await conn.exec(sql)
    }
  })
  const root = wrap(pg)
  const client: SqlClient = {
    ...root,
    transaction: (fn) => pg.transaction((tx) => fn({ ...wrap(tx), transaction: async (inner) => inner(client), close: async () => {} })),
    close: () => pg.close()
  }
  return client
}
