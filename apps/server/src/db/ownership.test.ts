// Гейт владения таблицами: см. ownership.ts. Тест читает исходники репозиториев как текст —
// нам нужны не типы, а сам SQL: кто во что пишет и что читает.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CROSS_READ_BUDGET, KNOWN_CROSS_WRITES, TABLE_OWNER, type RepoDomain } from './ownership.js'

const dbDir = __dirname
const reposDir = join(dbDir, 'repos')
const domains = Object.keys(TABLE_OWNER) as RepoDomain[]
const ownerOf = new Map<string, RepoDomain>()
for (const d of domains) for (const t of TABLE_OWNER[d]) ownerOf.set(t, d)
const tableAlt = [...ownerOf.keys()].join('|')
const writeRe = new RegExp(`\\b(?:INSERT(?:\\s+OR\\s+\\w+)?\\s+INTO|UPDATE|DELETE\\s+FROM|REPLACE\\s+INTO)\\s+(${tableAlt})\\b`, 'gi')
const readRe = new RegExp(`\\b(?:FROM|JOIN)\\s+(${tableAlt})\\b`, 'gi')
const repoSource = (d: RepoDomain) => readFileSync(join(reposDir, `${d}.ts`), 'utf8')

function tablesFromSchema(): Set<string> {
  const sql = readFileSync(join(dbDir, 'schema.ts'), 'utf8') + readFileSync(join(dbDir, 'database.ts'), 'utf8')
  return new Set([...sql.matchAll(/CREATE (?:VIRTUAL )?TABLE IF NOT EXISTS ([a-z_]+)/g)].map((m) => m[1]))
}

describe('владение таблицами (db/ownership.ts)', () => {
  it('у каждой таблицы схемы ровно один владелец, и в манифесте нет мёртвых таблиц', () => {
    const schema = tablesFromSchema()
    const seen = new Map<string, RepoDomain[]>()
    for (const d of domains) for (const t of TABLE_OWNER[d]) seen.set(t, [...(seen.get(t) ?? []), d])
    expect([...seen].filter(([, ds]) => ds.length > 1)).toEqual([])
    expect([...schema].filter((t) => !seen.has(t)).sort()).toEqual([])
    expect([...seen.keys()].filter((t) => !schema.has(t)).sort()).toEqual([])
  })

  it('у каждого домена есть файл репозитория, и репозитории не импортируют друг друга', () => {
    const files = readdirSync(reposDir).filter((f) => f.endsWith('.ts'))
    for (const d of domains) expect(files, `нет repos/${d}.ts`).toContain(`${d}.ts`)
    // base.ts — единственное место, которому положено знать все репозитории (тип Repos).
    for (const f of files.filter((f) => f !== 'base.ts')) {
      const src = readFileSync(join(reposDir, f), 'utf8')
      const imports = [...src.matchAll(/from '\.\/([a-z]+)\.js'/g)].map((m) => m[1])
      const own = f.replace(/\.ts$/, '')
      // Соседи достижимы только через this.repos: так кросс-доменная связь видна в коде и в этом тесте.
      const foreign = imports.filter((i) => domains.includes(i as RepoDomain) && i !== own)
      expect(foreign, `${f} импортирует соседний репозиторий`).toEqual([])
    }
  })

  it('пишет в чужие таблицы только то, что записано в KNOWN_CROSS_WRITES — и ровно то', () => {
    for (const d of domains) {
      const actual = new Set<string>()
      for (const m of repoSource(d).matchAll(writeRe)) {
        const t = m[1].toLowerCase()
        if (ownerOf.get(t) !== d) actual.add(t)
      }
      expect([...actual].sort(), `repos/${d}.ts: чужие записи`).toEqual([...(KNOWN_CROSS_WRITES[d] ?? [])].sort())
    }
  })

  it('чужие таблицы читает не шире бюджета CROSS_READ_BUDGET', () => {
    for (const d of domains) {
      const actual = new Set<string>()
      for (const m of repoSource(d).matchAll(readRe)) {
        const t = m[1].toLowerCase()
        if (ownerOf.get(t) !== d) actual.add(t)
      }
      expect(actual.size, `repos/${d}.ts читает чужие таблицы: ${[...actual].sort().join(', ')}`).toBeLessThanOrEqual(CROSS_READ_BUDGET[d])
    }
  })

  it('better-sqlite3 подключается только внутри src/db', () => {
    const srcDir = join(dbDir, '..')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name)
        if (entry.isDirectory()) { if (entry.name !== 'db') walk(p); continue }
        if (!entry.name.endsWith('.ts')) continue
        if (/from 'better-sqlite3'/.test(readFileSync(p, 'utf8'))) offenders.push(p.slice(srcDir.length + 1))
      }
    }
    walk(srcDir)
    expect(offenders).toEqual([])
  })
})
