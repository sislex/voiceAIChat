// Перевод SQL из диалекта SQLite (в котором написаны репозитории) в Postgres. Одно место для всех
// различий, которые можно закрыть текстом: параметры, `INSERT OR IGNORE`, `IFNULL`, скалярные
// `MAX/MIN` от нескольких аргументов, регистронезависимый `LIKE`, `IS ?`, `ulower()`. Что текстом не
// закрывается (JSON-функции, strftime), репозиторий пишет по-разному для двух движков сам через
// `this.sql.engine`. Строковые литералы и идентификаторы в кавычках не трогаем — маскируем.

export interface TranslatedSql { text: string; values: unknown[] }

/** Сегменты: код и литералы ('…', "…"), чтобы правила не лезли внутрь строк. */
function segments(sql: string): Array<{ code: boolean; text: string }> {
  const out: Array<{ code: boolean; text: string }> = []
  let i = 0, start = 0
  while (i < sql.length) {
    const ch = sql[i]!
    if (ch === "'" || ch === '"') {
      if (i > start) out.push({ code: true, text: sql.slice(start, i) })
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === ch) { if (sql[j + 1] === ch) { j += 2; continue } break }
        j++
      }
      out.push({ code: false, text: sql.slice(i, j + 1) })
      i = j + 1; start = i
      continue
    }
    if (ch === '-' && sql[i + 1] === '-') {
      if (i > start) out.push({ code: true, text: sql.slice(start, i) })
      let j = sql.indexOf('\n', i); if (j === -1) j = sql.length
      out.push({ code: false, text: sql.slice(i, j) })
      i = j; start = i
      continue
    }
    i++
  }
  if (start < sql.length) out.push({ code: true, text: sql.slice(start) })
  return out
}

/** Маска: литералы заменены пробелами той же длины — позиции совпадают с исходным текстом. */
function maskLiterals(sql: string): string {
  return segments(sql).map((seg) => (seg.code ? seg.text : seg.text[0] + ' '.repeat(Math.max(0, seg.text.length - 2)) + (seg.text.length > 1 ? seg.text[seg.text.length - 1] : ''))).join('')
}

/**
 * MAX(a, b) / MIN(a, b) — скалярные, у Postgres это GREATEST/LEAST; агрегатные MAX(x) не трогаем.
 * Скобки считаем по маске (аргументы могут содержать литералы с запятыми), правки вносим в текст.
 */
function rewriteScalarMaxMin(text: string): string {
  const masked = maskLiterals(text)
  const re = /\b(MAX|MIN)\s*\(/gi
  const edits: Array<{ start: number; end: number; name: string }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(masked))) {
    let depth = 1, commas = 0
    for (let j = re.lastIndex; j < masked.length && depth > 0; j++) {
      const c = masked[j]
      if (c === '(') depth++
      else if (c === ')') depth--
      else if (c === ',' && depth === 1) commas++
    }
    if (commas > 0) edits.push({ start: m.index, end: m.index + m[1]!.length, name: m[1]!.toUpperCase() === 'MAX' ? 'GREATEST' : 'LEAST' })
  }
  let out = text
  for (const e of edits.reverse()) out = out.slice(0, e.start) + e.name + out.slice(e.end)
  return out
}

/**
 * Postgres приводит некавыченные идентификаторы к нижнему регистру: `AS inputTokens` вернулось бы
 * как `inputtokens`, а `ORDER BY outputTokens` не нашёл бы алиас. Наши колонки — snake_case,
 * camelCase встречается только у алиасов, поэтому такие идентификаторы берём в кавычки.
 * Параметры к этому моменту уже `$n`, литералы — не код.
 */
function quoteCamelCaseIdentifiers(text: string): string {
  return segments(text).map((seg) => (seg.code ? seg.text.replace(/(?<![\w$@."'])([a-z][a-z0-9]*[A-Z][A-Za-z0-9]*)\b(?!\s*\()/g, '"$1"') : seg.text)).join('')
}

/**
 * `INSERT … ON CONFLICT (…) DO UPDATE SET col = expr`: у SQLite голое имя колонки в expr — строка
 * таблицы, у Postgres оно неоднозначно между таблицей и `excluded`. Квалифицируем именами таблицы
 * те идентификаторы, что перечислены в списке колонок INSERT и не помечены `excluded.`.
 */
function qualifyUpsertColumns(text: string): string {
  const masked = segments(text).map((seg) => (seg.code ? seg.text : ' '.repeat(seg.text.length))).join('')
  const head = /\bINSERT\s+INTO\s+(\w+)\s*\(([^)]*)\)/i.exec(masked)
  const upd = /\bDO\s+UPDATE\s+SET\b/i.exec(masked)
  if (!head || !upd) return text
  const table = head[1]!
  const columns = new Set(head[2]!.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean))
  const start = upd.index + upd[0].length
  // Конец SET-клаузы — WHERE/RETURNING верхнего уровня или конец запроса.
  const tailMatch = /\b(WHERE|RETURNING)\b/i.exec(masked.slice(start))
  const end = tailMatch ? start + tailMatch.index : masked.length
  const clause = text.slice(start, end)
  const clauseMasked = masked.slice(start, end)
  let out = ''
  let i = 0
  const re = /(?<![\w$@."'])([A-Za-z_]\w*)\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(clauseMasked))) {
    const word = m[1]!
    const before = clauseMasked.slice(0, m.index)
    const after = clauseMasked.slice(m.index + word.length)
    // Левая часть присваивания (`col =`) остаётся голой — так требует сам синтаксис SET.
    const isAssignTarget = /^\s*=(?!=)/.test(after) && /(^|,)\s*$/.test(before)
    const isCall = /^\s*\(/.test(after)
    if (columns.has(word.toLowerCase()) && !isAssignTarget && !isCall) {
      out += clause.slice(i, m.index) + `${table}.${word}`
      i = m.index + word.length
    }
  }
  out += clause.slice(i)
  return text.slice(0, start) + out + text.slice(end)
}

/**
 * `substr(x, -N)` у SQLite — последние N символов; у Postgres отрицательное начало означает совсем
 * другое (счёт с позиции -N без длины — почти вся строка). Переписываем в `right(x, N)`.
 */
function rewriteSubstrTail(text: string): string {
  const masked = maskLiterals(text)
  const re = /\bsubstr\s*\(/gi
  const edits: Array<{ start: number; end: number; repl: string }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(masked))) {
    let depth = 1, lastComma = -1, commas = 0, j = re.lastIndex
    for (; j < masked.length && depth > 0; j++) {
      const c = masked[j]
      if (c === '(') depth++
      else if (c === ')') depth--
      else if (c === ',' && depth === 1) { commas++; lastComma = j }
    }
    if (commas !== 1) continue
    const tail = masked.slice(lastComma + 1, j - 1).trim()
    const neg = /^-(\d+)$/.exec(tail)
    if (!neg) continue
    edits.push({ start: m.index, end: j, repl: `right(${text.slice(re.lastIndex, lastComma).trim()}, ${neg[1]})` })
  }
  let out = text
  for (const e of edits.reverse()) out = out.slice(0, e.start) + e.repl + out.slice(e.end)
  return out
}

/**
 * Числовой параметр получает явный тип: без него Postgres в `CASE … THEN $n`, `COALESCE(col, $n)`
 * и `SELECT $n` считает параметр текстом и падает на присваивании в BIGINT. У SQLite типов
 * параметров нет, поэтому код о них не думает — думает транслятор. Строки и NULL не трогаем:
 * текст — и есть тип по умолчанию, а в TEXT-колонку целое ляжет через приведение присваивания.
 */
function numericCast(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  return Number.isInteger(value) ? '::bigint' : '::double precision'
}

/**
 * Перевод одного запроса с параметрами. `?` → `$n`; именованные `@name` (better-sqlite3 принимал
 * объект) → позиционные из объекта. Возвращает текст для Postgres и массив значений.
 */
export function translateToPostgres(sql: string, params: readonly unknown[] | undefined): TranslatedSql {
  const named = params?.length === 1 && params[0] !== null && typeof params[0] === 'object' && !Array.isArray(params[0]) && !(params[0] instanceof Uint8Array)
    ? (params[0] as Record<string, unknown>) : null
  const values: unknown[] = []
  const namedIndex = new Map<string, number>()
  let positional = 0
  let onConflictNothing = false
  const parts = segments(sql).map((seg) => {
    if (!seg.code) return seg.text
    let t = seg.text
    if (/\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(t)) { t = t.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO'); onConflictNothing = true }
    t = t.replace(/\bIFNULL\s*\(/gi, 'COALESCE(')
    t = t.replace(/\bulower\s*\(/gi, 'lower(')
    t = t.replace(/\bIS\s+NOT\s+(\?|@\w+)/gi, 'IS DISTINCT FROM $1').replace(/\bIS\s+(\?|@\w+)/gi, 'IS NOT DISTINCT FROM $1')
    // SQLite LIKE регистронезависим (для ASCII); паритет — ILIKE.
    t = t.replace(/\bLIKE\b/gi, 'ILIKE')
    // Параметры по порядку. Значения известны уже здесь, поэтому две конструкции SQLite, на которых
    // Postgres спотыкается, сворачиваются в литералы: `? IS [NOT] NULL` (тип параметра не выводится)
    // → TRUE/FALSE, и `LIMIT ?` с отрицательным числом (у SQLite «без предела») → LIMIT ALL.
    t = t.replace(/(\bLIMIT\s+)?(\?|@(\w+))(\s+IS\s+(NOT\s+)?NULL\b)?/gi, (_all, limitKw: string | undefined, _ph: string, name: string | undefined, isNull: string | undefined, not: string | undefined) => {
      let value: unknown
      let placeholder: string
      if (name !== undefined) {
        if (!named) throw new Error(`именованный параметр @${name} без объекта параметров`)
        value = named[name] === undefined ? null : named[name]
        if (isNull) return not ? String(value !== null).toUpperCase() : String(value === null).toUpperCase()
        if (limitKw && typeof value === 'number' && value < 0) return `${limitKw}ALL`
        let idx = namedIndex.get(name)
        if (idx === undefined) { values.push(value); idx = values.length; namedIndex.set(name, idx) }
        placeholder = `$${idx}${numericCast(value)}`
      } else {
        const v = params?.[positional++]
        value = v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v
        if (isNull) return not ? String(value !== null).toUpperCase() : String(value === null).toUpperCase()
        if (limitKw && typeof value === 'number' && value < 0) return `${limitKw}ALL`
        values.push(value)
        placeholder = `$${values.length}${numericCast(value)}`
      }
      return `${limitKw ?? ''}${placeholder}`
    })
    return t
  })
  let text = rewriteScalarMaxMin(parts.join(''))
  text = quoteCamelCaseIdentifiers(text)
  text = qualifyUpsertColumns(text)
  text = rewriteSubstrTail(text)
  // `CASE WHEN ? THEN …` с числом 0/1: у SQLite целое — булево, у Postgres нет.
  text = text.replace(/\bWHEN\s+(\$\d+::bigint)\s+THEN\b/gi, 'WHEN $1 <> 0 THEN')
  if (onConflictNothing) {
    const m = /\bRETURNING\b/i.exec(text)
    const trimmed = text.replace(/;\s*$/, '')
    text = m ? `${trimmed.slice(0, m.index)}ON CONFLICT DO NOTHING ${trimmed.slice(m.index)}` : `${trimmed} ON CONFLICT DO NOTHING`
  }
  return { text, values }
}
