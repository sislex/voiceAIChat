// Табличный редактор коллекций моков (roadmap-4 п.29): чистые преобразования между JSON файла
// `{ "$collection": true, "$body": [ … ] }` (или `{ "$body": [ … ] }`, или голым массивом) и таблицей строк/колонок.
// Значения в ячейках — строки; при записи обратно числа/булевы/null/JSON-объекты восстанавливаются.

export interface MockTable {
  /** Порядок колонок: `id` первой, дальше — по первому появлению в элементах. */
  columns: string[]
  rows: Array<Record<string, string>>
  /** Остальные поля файла ($status, $delay, $collection…) — сохраняются как есть. */
  envelope: Record<string, unknown>
  /** Файл был голым массивом — писать обратно тоже массивом. */
  bare: boolean
}

export function isMockTableJson(json: unknown): boolean {
  if (Array.isArray(json)) return json.every((x) => x && typeof x === 'object' && !Array.isArray(x))
  if (!json || typeof json !== 'object') return false
  const body = (json as { $body?: unknown }).$body
  return Array.isArray(body) && body.every((x) => x && typeof x === 'object' && !Array.isArray(x))
}

export function cellToString(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

/** Обратное преобразование: JSON-литералы (числа, true/false/null, объекты) восстанавливаются, остальное — строка. */
export function stringToCell(s: string): unknown {
  const t = s.trim()
  if (t === '') return ''
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  if (t === 'true') return true
  if (t === 'false') return false
  if (t === 'null') return null
  if (/^[[{"]/.test(t)) { try { return JSON.parse(t) } catch { return s } }
  return s
}

export function mockJsonToTable(json: unknown): MockTable | null {
  if (!isMockTableJson(json)) return null
  const bare = Array.isArray(json)
  const items = (bare ? json : (json as { $body: unknown[] }).$body) as Array<Record<string, unknown>>
  const envelope: Record<string, unknown> = bare ? {} : Object.fromEntries(Object.entries(json as Record<string, unknown>).filter(([k]) => k !== '$body'))
  const columns: string[] = []
  for (const it of items) for (const k of Object.keys(it)) if (!columns.includes(k)) columns.push(k)
  if (columns.includes('id')) columns.splice(columns.indexOf('id'), 1), columns.unshift('id')
  const rows = items.map((it) => Object.fromEntries(columns.map((c) => [c, cellToString(it[c])])))
  return { columns, rows, envelope, bare }
}

export function tableToMockJson(table: MockTable): unknown {
  const items = table.rows.map((r) => {
    const out: Record<string, unknown> = {}
    for (const c of table.columns) { const raw = r[c]; if (raw !== undefined && raw !== '') out[c] = stringToCell(raw) }
    return out
  })
  return table.bare ? items : { ...table.envelope, $body: items }
}

/** Новая строка: пустые ячейки, id — следующий за максимальным числовым. */
export function newMockRow(table: MockTable): Record<string, string> {
  const row = Object.fromEntries(table.columns.map((c) => [c, '']))
  if (table.columns.includes('id')) {
    const max = table.rows.reduce((m, r) => { const n = Number(r.id); return Number.isFinite(n) && n > m ? n : m }, 0)
    row.id = String(max + 1)
  }
  return row
}

export function serializeMockJson(json: unknown): string {
  return JSON.stringify(json, null, 2) + '\n'
}
