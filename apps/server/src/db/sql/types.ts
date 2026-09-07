// Адаптер базы для репозиториев: одна и та же поверхность над better-sqlite3 и node-postgres.
// Узкая нарочно: `get/all/run/exec` и транзакция — ровно то, чем пользуются репозитории, и ни
// одной детали драйвера. SQL пишется в диалекте SQLite с `?`-параметрами; реализация Postgres
// переводит его сама (`dialect.ts`), поэтому у репозитория один код на оба движка.

/**
 * Параметр запроса. Формально `unknown`: значения приходят из строк `Record<string, unknown>` и
 * JSON без узких типов, и better-sqlite3 их тоже принимал как `any`. Адаптер приводит
 * undefined → NULL и boolean → 0/1; всё остальное — ответственность запроса.
 */
export type SqlParam = unknown

export interface RunResult {
  /** Число затронутых строк (UPDATE/DELETE/INSERT). */
  changes: number
  /** rowid вставленной строки — только для INSERT в таблицу с rowid; иначе 0. */
  lastInsertRowid: number
}

/** Подготовленный запрос: тот же SQL много раз с разными параметрами (циклы вставок). */
export interface Statement {
  get<T = Record<string, unknown>>(...params: SqlParam[]): Promise<T | undefined>
  all<T = Record<string, unknown>>(...params: SqlParam[]): Promise<T[]>
  run(...params: SqlParam[]): Promise<RunResult>
}

export interface Sql {
  readonly engine: 'sqlite' | 'postgres'
  get<T = Record<string, unknown>>(sql: string, params?: readonly SqlParam[]): Promise<T | undefined>
  all<T = Record<string, unknown>>(sql: string, params?: readonly SqlParam[]): Promise<T[]>
  run(sql: string, params?: readonly SqlParam[]): Promise<RunResult>
  /** DDL и пакеты команд без параметров. */
  exec(sql: string): Promise<void>
  prepare(sql: string): Statement
  /**
   * Транзакция вокруг асинхронного тела. Всё, что выполняется внутри (включая соседние
   * репозитории через this.repos), идёт по соединению транзакции — контекст передаётся через
   * AsyncLocalStorage, параметры не нужны. Вложенный вызов — SAVEPOINT, ошибка внутри откатывает
   * только его. Тело не должно ждать внешних событий: у SQLite на время транзакции остальные
   * запросы процесса стоят в очереди.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>
  /** Внутри ли транзакции текущий асинхронный контекст. */
  inTransaction(): boolean
  close(): Promise<void>
}
