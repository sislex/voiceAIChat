import { describe, expect, it } from 'vitest'
import { translateToPostgres } from './dialect.js'

const t = (sql: string, params?: unknown[]) => translateToPostgres(sql, params)

describe('перевод SQLite → Postgres', () => {
  it('позиционные ? → $n, undefined → NULL, boolean → 0/1; литералы не трогаем', () => {
    expect(t(`SELECT * FROM t WHERE a = ? AND b = ? AND c = '?' AND d = ?`, ['x', undefined, true]))
      .toEqual({ text: `SELECT * FROM t WHERE a = $1 AND b = $2 AND c = '?' AND d = $3::bigint`, values: ['x', null, 1] })
    // Числа получают явный тип: целые — bigint, дробные — double precision.
    expect(t(`UPDATE t SET at = CASE WHEN ? = 'x' THEN ? ELSE NULL END, ratio = ?`, ['x', 1_700_000_000_000, 0.5]).text)
      .toBe(`UPDATE t SET at = CASE WHEN $1 = 'x' THEN $2::bigint ELSE NULL END, ratio = $3::double precision`)
  })

  it('именованные @name из объекта: один параметр на имя, повтор — тот же $n', () => {
    expect(t(`SELECT * FROM t WHERE p = @projectId AND (q = @projectId OR r = @other)`, [{ projectId: 'p1', other: 2 }]))
      .toEqual({ text: `SELECT * FROM t WHERE p = $1 AND (q = $1 OR r = $2::bigint)`, values: ['p1', 2] })
  })

  it('INSERT OR IGNORE → ON CONFLICT DO NOTHING, в том числе перед RETURNING', () => {
    expect(t(`INSERT OR IGNORE INTO t (a) VALUES (?)`, ['v']).text).toBe(`INSERT INTO t (a) VALUES ($1) ON CONFLICT DO NOTHING`)
    expect(t(`INSERT OR IGNORE INTO t (a) VALUES (?) RETURNING id`, ['v']).text).toBe(`INSERT INTO t (a) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id`)
  })

  it('IFNULL → COALESCE, ulower → lower, LIKE → ILIKE, IS ? → IS NOT DISTINCT FROM', () => {
    expect(t(`SELECT IFNULL(a, 0) FROM t WHERE ulower(name) LIKE ? ESCAPE '\\' AND x IS ? AND y IS NOT ?`, ['%a%', null, 1]).text)
      .toBe(`SELECT COALESCE(a, 0) FROM t WHERE lower(name) ILIKE $1 ESCAPE '\\' AND x IS NOT DISTINCT FROM $2 AND y IS DISTINCT FROM $3::bigint`)
  })

  it('скалярные MAX/MIN от нескольких аргументов → GREATEST/LEAST, агрегатные — как были', () => {
    expect(t(`SELECT MAX(a), MIN(b), MAX(c, ?, 0) AS m, MIN(d, COALESCE(e, 1)) FROM t`, [5]).text)
      .toBe(`SELECT MAX(a), MIN(b), GREATEST(c, $1::bigint, 0) AS m, LEAST(d, COALESCE(e, 1)) FROM t`)
    // Литерал со запятой внутри MAX не считается аргументом.
    expect(t(`SELECT MAX(a) FROM t WHERE s = 'x, y'`).text).toBe(`SELECT MAX(a) FROM t WHERE s = 'x, y'`)
  })

  it('`? IS NULL` сворачивается в литерал по значению, LIMIT с отрицательным числом → LIMIT ALL', () => {
    expect(t(`SELECT * FROM t WHERE (? IS NULL OR a >= ?) AND (? IS NOT NULL) LIMIT ?`, [null, null, 'x', -1]))
      .toEqual({ text: `SELECT * FROM t WHERE (TRUE OR a >= $1) AND (TRUE) LIMIT ALL`, values: [null] })
    expect(t(`SELECT * FROM t WHERE (@since IS NULL OR a >= @since) LIMIT @limit`, [{ since: 5, limit: 10 }]))
      .toEqual({ text: `SELECT * FROM t WHERE (FALSE OR a >= $1::bigint) LIMIT $2::bigint`, values: [5, 10] })
  })

  it('camelCase-алиасы в кавычках, snake_case и функции — как были', () => {
    expect(t(`SELECT COALESCE(SUM(a),0) AS inputTokens, c.user_id, to_char(x, 'YYYY') AS bucket FROM t c ORDER BY inputTokens DESC, bucket`).text)
      .toBe(`SELECT COALESCE(SUM(a),0) AS "inputTokens", c.user_id, to_char(x, 'YYYY') AS bucket FROM t c ORDER BY "inputTokens" DESC, bucket`)
  })

  it('в DO UPDATE SET голые колонки таблицы квалифицируются именем таблицы', () => {
    expect(t(`INSERT INTO ci_run_tool_calls (run_id, tool, calls, chars) VALUES (?, ?, ?, ?) ON CONFLICT(run_id, tool) DO UPDATE SET calls = calls + excluded.calls, chars = CASE WHEN length(excluded.chars) > length(chars) THEN excluded.chars ELSE chars END`, ['r', 't', 1, 2]).text)
      .toBe(`INSERT INTO ci_run_tool_calls (run_id, tool, calls, chars) VALUES ($1, $2, $3::bigint, $4::bigint) ON CONFLICT(run_id, tool) DO UPDATE SET calls = ci_run_tool_calls.calls + excluded.calls, chars = CASE WHEN length(excluded.chars) > length(ci_run_tool_calls.chars) THEN excluded.chars ELSE ci_run_tool_calls.chars END`)
  })

  it('CASE WHEN с числовым параметром получает сравнение, substr с отрицательным началом → right', () => {
    expect(t(`UPDATE u SET blocked = CASE WHEN ? THEN 1 ELSE blocked END, log = substr(log || ?, -500000)`, [1, 'x']).text)
      .toBe(`UPDATE u SET blocked = CASE WHEN $1::bigint <> 0 THEN 1 ELSE blocked END, log = right(log || $2, 500000)`)
  })

  it('комментарии -- не переписываются', () => {
    expect(t(`SELECT a -- LIKE ? тут не параметр\n FROM t WHERE b = ?`, ['v']).text).toBe(`SELECT a -- LIKE ? тут не параметр\n FROM t WHERE b = $1`)
  })
})
