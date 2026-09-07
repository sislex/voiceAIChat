// Перенос данных из SQLite-файла в Postgres: схема — из `schemaPg.ts`, строки — таблица за
// таблицей, с сохранением `rowid` (у Postgres он явная колонка; код опирается на порядок
// вставки и курсоры). Внешние ключи на время копирования выключаются на каждой таблице
// (`DISABLE TRIGGER ALL` — владельцу таблиц можно), поэтому порядок таблиц не важен, а
// самоссылки (`tasks.parent_id`) не требуют сортировки. В конце — счётчики строк с обеих сторон
// и выравнивание последовательностей: иначе первая же новая строка получила бы занятый id.

import Database from 'better-sqlite3'
import { PG_SCHEMA } from './schemaPg.js'
import { createPgSql, type PgSql } from './sql/pg.js'

export interface CopyOptions {
  sqlitePath: string
  postgres: { url: string; schema?: string }
  /** Строк на один INSERT; лимит параметров Postgres — 65 535. */
  batch?: number
  log?: (line: string) => void
}

export interface CopyReport {
  /** Таблица → { sqlite, postgres, skipped } — числа строк и сколько строк не легли (с причиной в логе). */
  tables: Record<string, { sqlite: number; postgres: number; skipped: number }>
}

/** Таблицы Postgres-схемы и их колонки (без rowid — его добавляем сами). */
function pgTables(): Map<string, { columns: string[]; rowidGenerated: boolean }> {
  const out = new Map<string, { columns: string[]; rowidGenerated: boolean }>()
  for (const ddl of PG_SCHEMA.tables) {
    const m = /CREATE TABLE IF NOT EXISTS (\w+) \(\n([\s\S]*)\n\);/.exec(ddl)!
    const cols = m[2]!.split('\n').map((l) => l.trim().replace(/,$/, '')).filter((l) => l && !/^(UNIQUE|PRIMARY KEY|CHECK)\s*\(/i.test(l)).map((l) => l.split(/\s+/)[0]!)
    out.set(m[1]!, { columns: cols.filter((c) => c !== 'rowid'), rowidGenerated: /rowid BIGINT GENERATED/.test(ddl) })
  }
  return out
}

/** Postgres не хранит NUL в TEXT (SQLite — хранит; встречается в журналах ранов). Байт убираем — текст остаётся читаемым. */
function clean(value: unknown): unknown {
  if (value === undefined) return null
  return typeof value === 'string' && value.includes('\0') ? value.replace(/\0/g, '') : value
}

export async function copySqliteToPostgres(opts: CopyOptions): Promise<CopyReport> {
  const log = opts.log ?? (() => {})
  const source = new Database(opts.sqlitePath, { readonly: true })
  const sql: PgSql = createPgSql({ connectionString: opts.postgres.url, ...(opts.postgres.schema ? { schema: opts.postgres.schema } : {}), max: 2 })
  const report: CopyReport = { tables: {} }
  try {
    if (opts.postgres.schema) await sql.exec(`CREATE SCHEMA IF NOT EXISTS ${opts.postgres.schema}`)
    await sql.exec(PG_SCHEMA.sql)
    const sourceTables = new Set((source.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map((r) => r.name))
    for (const [table, meta] of pgTables()) {
      if (!sourceTables.has(table)) { log(`${table}: в SQLite нет — пропуск`); continue }
      const sourceColumns = new Set((source.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((r) => r.name))
      const columns = meta.columns.filter((c) => sourceColumns.has(c))
      const missing = meta.columns.filter((c) => !sourceColumns.has(c))
      if (missing.length) log(`${table}: в SQLite нет колонок ${missing.join(', ')} — лягут значениями по умолчанию`)
      const withRowid = meta.rowidGenerated ? columns : ['rowid', ...columns]
      const total = (source.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
      const batch = Math.max(1, Math.min(opts.batch ?? 500, Math.floor(60_000 / Math.max(1, withRowid.length))))
      let inserted = 0, skipped = 0
      await sql.exec(`ALTER TABLE ${table} DISABLE TRIGGER ALL`)
      try {
        const select = source.prepare(`SELECT ${meta.rowidGenerated ? '' : 'rowid AS rowid, '}${columns.map((c) => `"${c}"`).join(', ')} FROM ${table} ORDER BY rowid`)
        let rows: Record<string, unknown>[] = []
        const flush = async (): Promise<void> => {
          if (!rows.length) return
          const values: unknown[] = []
          const tuples = rows.map((row) => `(${withRowid.map((c) => { values.push(clean(row[c])); return `$${values.length}` }).join(', ')})`)
          try {
            const res = await sql.pool.query(`INSERT INTO ${table} (${withRowid.join(', ')}) VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING`, values)
            inserted += res.rowCount ?? 0
            skipped += rows.length - (res.rowCount ?? 0)
          } catch (error) {
            // Пакет не лёг — ищем виноватую строку по одной, остальные сохраняем.
            for (const row of rows) {
              try {
                const one = await sql.pool.query(`INSERT INTO ${table} (${withRowid.join(', ')}) VALUES (${withRowid.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT DO NOTHING`, withRowid.map((c) => clean(row[c])))
                inserted += one.rowCount ?? 0
                skipped += 1 - (one.rowCount ?? 0)
              } catch (rowError) {
                skipped++
                log(`${table}: строка rowid=${String(row.rowid ?? '?')} не легла: ${rowError instanceof Error ? rowError.message.split('\n')[0] : String(rowError)}`)
              }
            }
            void error
          }
          rows = []
        }
        for (const row of select.iterate() as IterableIterator<Record<string, unknown>>) {
          rows.push(row)
          if (rows.length >= batch) await flush()
        }
        await flush()
      } finally {
        await sql.exec(`ALTER TABLE ${table} ENABLE TRIGGER ALL`)
      }
      // Последовательности: id у BIGSERIAL-таблиц и rowid у остальных.
      for (const col of meta.rowidGenerated ? ['id'] : ['rowid']) {
        await sql.exec(`SELECT setval(pg_get_serial_sequence('${table}', '${col}'), COALESCE((SELECT MAX(${col}) FROM ${table}), 0) + 1, false)`)
      }
      const postgres = ((await sql.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!).n
      report.tables[table] = { sqlite: total, postgres, skipped }
      log(`${table}: ${total} → ${postgres}${skipped ? ` (пропущено ${skipped})` : ''}`)
      void inserted
    }
  } finally {
    source.close()
    await sql.close()
  }
  return report
}
