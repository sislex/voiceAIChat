import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { describe, expect, it } from 'vitest'
import { TABLE_OWNER } from './ownership.js'
import { PG_SCHEMA, postgresColumnUpgradePlan, postgresSchemaFrom } from './schemaPg.js'

const URL = process.env.VC_TEST_DB_URL

describe('схема Postgres из SQLite-схемы', () => {
  it('переводит каждую таблицу манифеста владения, выносит внешние ключи, добавляет rowid', () => {
    const owned = new Set(Object.values(TABLE_OWNER).flat())
    const names = PG_SCHEMA.tables.map((t) => /CREATE TABLE IF NOT EXISTS (\w+)/.exec(t)![1]!)
    // messages_fts — виртуальная таблица FTS5, у Postgres её нет.
    expect(names.sort()).toEqual([...owned].filter((t) => t !== 'messages_fts').sort())
    expect(PG_SCHEMA.tables.every((t) => /rowid (BIGSERIAL|BIGINT GENERATED ALWAYS AS \(id\) STORED)/.test(t))).toBe(true)
    expect(PG_SCHEMA.tables.some((t) => /REFERENCES/i.test(t))).toBe(false)
    expect(PG_SCHEMA.foreignKeys.length).toBeGreaterThan(100)
    expect(PG_SCHEMA.sql).not.toMatch(/\bINTEGER\b|\bREAL\b|AUTOINCREMENT/)
  })

  it('перевод конкретных конструкций', () => {
    const out = postgresSchemaFrom(`CREATE TABLE IF NOT EXISTS a (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  b_id TEXT NOT NULL REFERENCES b(id) ON DELETE CASCADE,
  score REAL,
  kind TEXT NOT NULL DEFAULT 'x' CHECK (kind IN ('x','y')),
  FOREIGN KEY (b_id) REFERENCES b(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_a ON a(b_id) WHERE score > 0;`)
    expect(out.tables[0]).toBe(`CREATE TABLE IF NOT EXISTS a (
  id BIGSERIAL PRIMARY KEY,
  b_id TEXT NOT NULL,
  score DOUBLE PRECISION,
  kind TEXT NOT NULL DEFAULT 'x' CHECK (kind IN ('x','y')),
  rowid BIGINT GENERATED ALWAYS AS (id) STORED
);`)
    expect(out.indexes).toEqual([`CREATE UNIQUE INDEX IF NOT EXISTS idx_a ON a(b_id) WHERE score > 0;`])
    expect(out.foreignKeys).toHaveLength(2)
    expect(out.foreignKeys[0]).toContain('ALTER TABLE a ADD CONSTRAINT fk_a_b_id FOREIGN KEY (b_id) REFERENCES b (id) ON DELETE CASCADE')
  })

  it('plans missing columns before schema objects that can reference them', () => {
    const out = postgresSchemaFrom(`CREATE TABLE IF NOT EXISTS a (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_a_enabled ON a(enabled);`)
    const plan = postgresColumnUpgradePlan(out.columns, [
      { table_name: 'a', column_name: 'id' },
      { table_name: 'a', column_name: 'rowid' }
    ])
    expect([...plan.keys]).toEqual(['a.enabled'])
    expect(plan.sql).toBe('ALTER TABLE a ADD COLUMN IF NOT EXISTS enabled BIGINT NOT NULL DEFAULT 0;')
    expect(out.afterColumnsSql).toContain('CREATE INDEX IF NOT EXISTS idx_a_enabled ON a(enabled)')
  })

  it('includes the task manual-QA flag in additive PostgreSQL upgrades', () => {
    const existing = PG_SCHEMA.columns
      .filter((column) => !(column.table === 'tasks' && column.name === 'auto_pilot_requires_manual_qa'))
      .map((column) => ({ table_name: column.table, column_name: column.name }))
    const plan = postgresColumnUpgradePlan(PG_SCHEMA.columns, existing)
    expect([...plan.keys]).toEqual(['tasks.auto_pilot_requires_manual_qa'])
    expect(plan.sql).toContain('auto_pilot_requires_manual_qa BIGINT NOT NULL DEFAULT 0')
  })

  it.skipIf(!URL)('применяется к настоящему Postgres дважды без ошибок', async () => {
    const schema = `s_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const client = new pg.Client({ connectionString: URL })
    await client.connect()
    try {
      await client.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}`)
      await client.query(PG_SCHEMA.sql)
      await client.query(PG_SCHEMA.sql)
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1`, [schema])
      expect(rows[0].n).toBe(PG_SCHEMA.tables.length)
    } finally {
      await client.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {})
      await client.end()
    }
  }, 60_000)
})

describe('schema.ts — полная схема, а не только таблицы первого дня', () => {
  it('каждая колонка, которую migrate() добавляет через ALTER TABLE, объявлена и в CREATE TABLE', async () => {
    // На Postgres миграций SQLite нет — база создаётся из schema.ts целиком. Колонка только в ALTER
    // означала бы таблицу без неё на Postgres и падение первого же запроса.
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const migrate = readFileSync(join(__dirname, 'database.ts'), 'utf8')
    const { SCHEMA_SQL } = await import('./schema.js')
    const missing: string[] = []
    for (const m of migrate.matchAll(/ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)/g)) {
      const [, table, column] = m
      const ddl = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`).exec(SCHEMA_SQL)
      if (!ddl) { missing.push(`${table}.${column} (таблицы нет)`); continue }
      if (!new RegExp(`(^|[\\s,(])${column}\\s+(TEXT|INTEGER|REAL|BLOB)\\b`, 'm').test(ddl[1]!)) missing.push(`${table}.${column}`)
    }
    expect(missing).toEqual([])
  })
})
