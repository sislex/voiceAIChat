// Гейт границы Make ↔ ядро (docs/plans/make-standalone.md). Make — кандидат на отдельный
// сервис, поэтому его код не должен знать ни слой данных, ни авторизацию, ни реестр машин:
// всё, что ему нужно от ядра, — через порт `MakeCore`. И наоборот: ядро зовёт Make только
// через `MakeService`, а не через мастерские напрямую. Тест читает импорты как текст.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = join(__dirname, '..')

/** Файлы Make: сам каталог, его роуты и MCP. Тесты не считаем — им можно поднимать что угодно. */
const MAKE_FILES = ['make', 'routes/make.ts', 'mcp/makeMcp.ts']
/** Что ядру разрешено импортировать из Make: только порты и сборка модуля. */
const MAKE_PUBLIC = new Set(['make/core.js', 'make/service.js', 'make/module.js', 'make/taskScope.js'])
/** Композиция процесса и адаптер портов — им положено знать обе стороны. */
const COMPOSITION = new Set(['server.ts', 'makeBridge/localCore.ts'])

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { if (name !== 'node_modules') out.push(...walk(full)) } else if (name.endsWith('.ts')) out.push(full)
  }
  return out
}
const isTest = (file: string): boolean => /\.(test|dom\.test)\.tsx?$/.test(file)
const allFiles = walk(srcDir).filter((f) => !isTest(f)).map((f) => relative(srcDir, f))
const isMakeFile = (rel: string): boolean => MAKE_FILES.some((m) => rel === m || rel.startsWith(`${m}/`))
/** Относительные импорты файла, приведённые к пути от src (`db/database.js`). */
function importsOf(rel: string): string[] {
  const src = readFileSync(join(srcDir, rel), 'utf8')
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
  return [...src.matchAll(/from '(\.\.?\/[^']+)'/g)].map((m) => {
    const parts = [...(dir ? dir.split('/') : []), ...m[1]!.split('/')]
    const out: string[] = []
    for (const part of parts) { if (part === '.') continue; if (part === '..') out.pop(); else out.push(part) }
    return out.join('/')
  })
}

describe('граница Make ↔ ядро', () => {
  it('код Make не импортирует слой данных, авторизацию, реестр машин и остальное ядро', () => {
    const offenders: string[] = []
    for (const rel of allFiles.filter(isMakeFile)) {
      for (const imp of importsOf(rel)) {
        const ok = isMakeFile(imp.replace(/\.js$/, '.ts')) || imp.startsWith('util/')
        if (!ok) offenders.push(`${rel} → ${imp}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('ядро зовёт Make только через порты (core/service/module), а не мастерские напрямую', () => {
    const offenders: string[] = []
    for (const rel of allFiles.filter((f) => !isMakeFile(f) && !COMPOSITION.has(f))) {
      for (const imp of importsOf(rel)) {
        if (isMakeFile(imp.replace(/\.js$/, '.ts')) && !MAKE_PUBLIC.has(imp)) offenders.push(`${rel} → ${imp}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('порт MakeCore остаётся узким: не больше пятнадцати методов', () => {
    const src = readFileSync(join(srcDir, 'make/core.ts'), 'utf8')
    const body = src.slice(src.indexOf('export interface MakeCore {'))
    const methods = [...body.matchAll(/^  (\w+)\(/gm)].map((m) => m[1])
    expect(methods.length).toBeLessThanOrEqual(15)
  })
})
