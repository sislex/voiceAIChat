// DDL Postgres, выведенный из SQLite-схемы (`schema.ts`). Схема одна — в диалекте SQLite; здесь она
// переводится программно, поэтому новая таблица или колонка появляется на обоих движках из одной
// правки. Правила перевода: INTEGER → BIGINT (метки времени в мс не влезают в int4), REAL → DOUBLE
// PRECISION, `INTEGER PRIMARY KEY AUTOINCREMENT` → BIGSERIAL; у каждой таблицы явный `rowid`
// (у SQLite он есть неявно, и код на него опирается: порядок вставки, курсоры поиска), у таблиц с
// BIGSERIAL-ключом это вычисляемый алиас id — как и в SQLite. Внешние ключи выносятся в ALTER TABLE
// после всех таблиц: SQLite терпит ссылку на ещё не созданную таблицу, Postgres — нет.
// FTS5 сообщений не переводится: у Postgres свой полнотекстовый индекс (см. PG_EXTRA_SQL).

import { SCHEMA_SQL } from './schema.js'
import { translateToPostgres } from './sql/dialect.js'

function maskLiterals(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, (m) => "'" + ' '.repeat(m.length - 2) + "'")
}

/** Разбивает по запятым верхнего уровня (скобки и литералы учитываются). */
function splitTopLevel(body: string, sep = ','): string[] {
  const masked = maskLiterals(body)
  const out: string[] = []
  let depth = 0, start = 0
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === sep && depth === 0) { out.push(body.slice(start, i)); start = i + 1 }
  }
  out.push(body.slice(start))
  return out.map((s) => s.trim()).filter(Boolean)
}

interface ForeignKey { table: string; columns: string; refTable: string; refColumns: string; onDelete: string | null }

export interface PostgresColumn {
  table: string
  name: string
  definition: string
}

function mapType(def: string): string {
  return def
    .replace(/\bINTEGER PRIMARY KEY AUTOINCREMENT\b/i, 'BIGSERIAL PRIMARY KEY')
    .replace(/\bINTEGER\b/i, 'BIGINT')
    .replace(/\bREAL\b/i, 'DOUBLE PRECISION')
    .replace(/\bBLOB\b/i, 'BYTEA')
}

function translateTable(name: string, body: string, fks: ForeignKey[], schemaColumns: PostgresColumn[]): string {
  const items = splitTopLevel(body)
  const columns: string[] = []
  let hasSerialId = false
  for (const item of items) {
    const upper = item.toUpperCase()
    if (upper.startsWith('FOREIGN KEY')) {
      const m = /FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+(\w+)\s*\(([^)]+)\)(?:\s*ON DELETE\s+(CASCADE|RESTRICT|SET NULL|SET DEFAULT|NO ACTION))?/i.exec(item)
      if (!m) throw new Error(`не разобран FOREIGN KEY в ${name}: ${item}`)
      fks.push({ table: name, columns: m[1]!.trim(), refTable: m[2]!, refColumns: m[3]!.trim(), onDelete: m[4] ?? null })
      continue
    }
    if (upper.startsWith('UNIQUE') || upper.startsWith('PRIMARY KEY') || upper.startsWith('CHECK')) { columns.push(item); continue }
    // Колонка: имя, тип, ограничения. Встроенный REFERENCES выносим в ALTER.
    let col = item.replace(/\s+/g, ' ')
    const ref = /\s+REFERENCES\s+(\w+)\s*\(([^)]+)\)(?:\s+ON DELETE\s+(CASCADE|RESTRICT|SET NULL|SET DEFAULT|NO ACTION))?/i.exec(col)
    if (ref) {
      const colName = col.split(' ')[0]!
      fks.push({ table: name, columns: colName, refTable: ref[1]!, refColumns: ref[2]!.trim(), onDelete: ref[3] ?? null })
      col = col.slice(0, ref.index) + col.slice(ref.index + ref[0].length)
    }
    if (/\bINTEGER PRIMARY KEY AUTOINCREMENT\b/i.test(col)) hasSerialId = true
    const definition = mapType(col)
    const columnName = /^(\w+)\s+/.exec(definition)?.[1]
    if (!columnName) throw new Error(`column name was not parsed in ${name}: ${definition}`)
    columns.push(definition)
    schemaColumns.push({ table: name, name: columnName, definition })
  }
  if (columns.some((c) => /^rowid\b/i.test(c))) throw new Error(`у таблицы ${name} уже есть колонка rowid`)
  const rowid = hasSerialId ? 'rowid BIGINT GENERATED ALWAYS AS (id) STORED' : 'rowid BIGSERIAL'
  columns.push(rowid)
  schemaColumns.push({ table: name, name: 'rowid', definition: rowid })
  return `CREATE TABLE IF NOT EXISTS ${name} (\n  ${columns.join(',\n  ')}\n);`
}

/**
 * Постгресовские дополнения: полнотекстовый индекс сообщений вместо FTS5 и триггеры кэша стоимости
 * беседы — те же, что `migrate()` создаёт в SQLite: любое изменение сообщений помечает беседу
 * `cost_dirty`, иначе список показывал бы устаревшую цену.
 */
export const PG_EXTRA_SQL = `
ALTER TABLE messages ADD COLUMN IF NOT EXISTS text_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED;
CREATE INDEX IF NOT EXISTS idx_messages_text_tsv ON messages USING GIN (text_tsv);
CREATE OR REPLACE FUNCTION messages_cost_dirty() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE conversations SET cost_dirty = 1 WHERE id = OLD.conversation_id;
  ELSE
    UPDATE conversations SET cost_dirty = 1 WHERE id = NEW.conversation_id;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_messages_cost_dirty ON messages;
CREATE TRIGGER trg_messages_cost_dirty AFTER INSERT OR UPDATE OR DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION messages_cost_dirty();
`

export interface PostgresSchema {
  tables: string[]
  columns: PostgresColumn[]
  indexes: string[]
  seeds: string[]
  foreignKeys: string[]
  afterColumnsSql: string
  sql: string
}

/**
 * Builds the additive part of a PostgreSQL schema upgrade. `CREATE TABLE IF NOT
 * EXISTS` leaves old tables untouched, so every missing column must be added
 * before indexes, seeds, or foreign keys can refer to it.
 */
export function postgresColumnUpgradePlan(
  columns: readonly PostgresColumn[],
  existing: readonly { table_name: string; column_name: string }[]
): { keys: Set<string>; sql: string } {
  const known = new Set(existing.map((column) => `${column.table_name}.${column.column_name}`))
  const missing = columns.filter((column) => !known.has(`${column.table}.${column.name}`))
  return {
    keys: new Set(missing.map((column) => `${column.table}.${column.name}`)),
    sql: missing.map((column) => `ALTER TABLE ${column.table} ADD COLUMN IF NOT EXISTS ${column.definition};`).join('\n')
  }
}

export function postgresSchemaFrom(sqliteSchema: string): PostgresSchema {
  // Комментарии `--` снимаем до разбора: в DDL литералов с `--` нет, а комментарий может стоять и после `;`.
  const statements = splitTopLevel(sqliteSchema.replace(/--[^\n]*/g, ''), ';').map((s) => s.trim()).filter(Boolean)
  const tables: string[] = [], columns: PostgresColumn[] = [], indexes: string[] = [], seeds: string[] = [], fks: ForeignKey[] = []
  for (const st of statements) {
    const table = /^CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*)\)\s*$/i.exec(st)
    if (table) { tables.push(translateTable(table[1]!, table[2]!, fks, columns)); continue }
    if (/^CREATE (UNIQUE )?INDEX/i.test(st)) { indexes.push(mapType(st) + ';'); continue }
    // PRAGMA — настройки соединения SQLite, у Postgres их нет.
    if (/^PRAGMA\b/i.test(st)) continue
    // Сиды справочников (`INSERT OR IGNORE`) — через транслятор диалекта, как обычные запросы.
    if (/^INSERT\b/i.test(st)) { seeds.push(translateToPostgres(st, undefined).text + ';'); continue }
    throw new Error(`неизвестная инструкция схемы: ${st.slice(0, 80)}`)
  }
  // Имена ограничений детерминированы: повторное применение схемы их не дублирует.
  const foreignKeys = fks.map((fk) => {
    const cname = `fk_${fk.table}_${fk.columns.replace(/[^\w]+/g, '_')}`.slice(0, 63)
    return `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${cname}' AND conrelid = '${fk.table}'::regclass) THEN
  ALTER TABLE ${fk.table} ADD CONSTRAINT ${cname} FOREIGN KEY (${fk.columns}) REFERENCES ${fk.refTable} (${fk.refColumns})${fk.onDelete ? ` ON DELETE ${fk.onDelete}` : ''};
END IF; END $$;`
  })
  const afterColumnsSql = [...indexes, ...seeds, ...foreignKeys, PG_EXTRA_SQL].join('\n')
  return { tables, columns, indexes, seeds, foreignKeys, afterColumnsSql, sql: [...tables, afterColumnsSql].join('\n') }
}

/** Готовая схема Postgres для текущей SQLite-схемы. */
export const PG_SCHEMA = postgresSchemaFrom(SCHEMA_SQL)
