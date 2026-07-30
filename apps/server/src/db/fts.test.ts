import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { toFtsMatchQuery } from './fts.js'

describe('toFtsMatchQuery', () => {
  it('слова уходят фразами, последнее слово — префиксом', () => {
    expect(toFtsMatchQuery('миграция канбана')).toBe('"миграция" AND "канбана"*')
    // После разделителя слово считаем законченным — префикс не навешиваем.
    expect(toFtsMatchQuery('миграция канбана ')).toBe('"миграция" AND "канбана"')
    // Одна буква префиксом не ищется: совпадёт полбазы.
    expect(toFtsMatchQuery('миграция к')).toBe('"миграция" AND "к"')
  })

  it('пустой и бессловесный ввод → пустой запрос', () => {
    expect(toFtsMatchQuery('')).toBe('')
    expect(toFtsMatchQuery('   ')).toBe('')
    expect(toFtsMatchQuery('*** -- ""')).toBe('')
  })

  it('спецсинтаксис FTS становится обычным текстом', () => {
    expect(toFtsMatchQuery('NEAR(a b)')).toBe('"NEAR" AND "a" AND "b"')
    expect(toFtsMatchQuery('-канбан')).toBe('"канбан"*')
    expect(toFtsMatchQuery('"кавычки"')).toBe('"кавычки"')
    expect(toFtsMatchQuery('col:значение')).toBe('"col" AND "значение"*')
  })

  it('ограничивает число и длину слов', () => {
    const many = toFtsMatchQuery(Array.from({ length: 40 }, (_, i) => `сл${i}`).join(' '))
    expect(many.split(' AND ')).toHaveLength(16)
    expect(toFtsMatchQuery('я'.repeat(200))).toBe(`"${'я'.repeat(64)}"*`)
  })
})

// Fuzz: «плохие» строки не должны валить сам MATCH. Проверяем на настоящем
// FTS5 — только так видно, что экранирование синтаксически валидно.
describe('toFtsMatchQuery — fuzz на живом FTS5', () => {
  const db = new Database(':memory:')
  db.exec(`CREATE VIRTUAL TABLE t USING fts5(text, tokenize='unicode61 remove_diacritics 2')`)
  db.exec(`INSERT INTO t (text) VALUES ('миграция канбана прошла'), ('NEAR и звёздочка *')`)
  const run = (raw: string): unknown[] => {
    const match = toFtsMatchQuery(raw)
    if (!match) return []
    return db.prepare(`SELECT rowid FROM t WHERE t MATCH ? ORDER BY rank`).all(match)
  }

  const BAD = [
    '"', '""', '"незакрытая', '*', '**', 'a*', '*a', '-', '- -', '^', '(', ')', '()', '(a', 'a)',
    'NEAR', 'NEAR(', 'NEAR(a b', 'a NEAR b', 'OR', 'AND', 'NOT', 'a OR', 'AND AND',
    ':', 'text:a', '{a}', '[a]', 'a\\b', "it's", 'a"b"c', ' ', '\n\t', 'ё Ё',
    'миграция AND канбан', '"a" NEAR "b"', 'a--b', '+++', '%', '_', '#a', '@a', '~a', '/a/', '|a|'
  ]

  for (const bad of BAD) {
    it(`не падает на ${JSON.stringify(bad)}`, () => {
      expect(() => run(bad)).not.toThrow()
    })
  }

  it('случайные строки из спецсимволов тоже безопасны', () => {
    const alphabet = '"*-^():{}[]\\/|+~#@!%_ .,абвAND ORNEAR'
    // Детерминированный ГПСЧ: тест не должен «иногда» падать.
    let seed = 42
    const next = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    for (let i = 0; i < 400; i++) {
      const len = 1 + Math.floor(next() * 12)
      let s = ''
      for (let j = 0; j < len; j++) s += alphabet[Math.floor(next() * alphabet.length)]
      expect(() => run(s), `ввод: ${JSON.stringify(s)}`).not.toThrow()
    }
  })
})
