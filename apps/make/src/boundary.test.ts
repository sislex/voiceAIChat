// Make-side boundary check for Make and core (docs/plans/make-standalone.md). Make is already a
// separate package and can run as a service: it has no knowledge of core's data layer,
// authentication, or machine registry. It accesses core only through MakeCore. This test inspects
// imports as text.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = __dirname
const FORBIDDEN = ['@voicechat/server', 'better-sqlite3', '@electric-sql/pglite', '@voicechat/llm-runner']

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full)); else if (name.endsWith('.ts')) out.push(full)
  }
  return out
}
const files = walk(srcDir).filter((f) => !/\.test\.ts$/.test(f)).map((f) => relative(srcDir, f))

describe('граница Make ↔ ядро (сторона Make)', () => {
  it('Make не импортирует ядро, слой данных и исполнителей — только shared и свои файлы', () => {
    const offenders: string[] = []
    for (const rel of files) {
      const src = readFileSync(join(srcDir, rel), 'utf8')
      for (const m of src.matchAll(/from '([^']+)'/g)) {
        const spec = m[1]!
        // Relative imports must stay inside the package: ../ from a subdirectory is allowed, but
        // escaping src is not.
        const escapes = spec.startsWith('.') && !resolve(dirname(join(srcDir, rel)), spec).startsWith(srcDir + '/')
        if (escapes || FORBIDDEN.some((f) => spec === f || spec.startsWith(`${f}/`))) offenders.push(`${rel} → ${spec}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('порт MakeCore остаётся узким: не больше пятнадцати методов', () => {
    const src = readFileSync(join(srcDir, '../../../packages/make-contracts/src/core.ts'), 'utf8')
    const body = src.slice(src.indexOf('export interface MakeCore {'))
    expect([...body.matchAll(/^  (\w+)\(/gm)].length).toBeLessThanOrEqual(15)
  })
})
