// Гейт границы Web Reader ↔ ядро со стороны Web Reader (docs/kb/server-internals.md). Web Reader —
// самостоятельный сервис: он не знает ни слой данных, ни авторизацию, ни
// реестр машин ядра. Всё, что ему нужно от ядра, — порт `ReaderCore`. Тест читает импорты как текст.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

const srcDir = __dirname
const FORBIDDEN = ['@voicechat/server', 'better-sqlite3', '@electric-sql/pglite', '@voicechat/llm-runner', 'pg', 'playwright', '@voicechat/playwright-reader']

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full)); else if (name.endsWith('.ts')) out.push(full)
  }
  return out
}
const files = walk(srcDir).filter((f) => !/\.test\.ts$/.test(f)).map((f) => relative(srcDir, f))

describe('граница Web Reader ↔ ядро (сторона Web Reader)', () => {
  it('Web Reader не импортирует ядро, слой данных и исполнителей — только shared, публичные контракты Reader/Chromium и свои файлы', () => {
    const offenders: string[] = []
    for (const rel of files) {
      const src = readFileSync(join(srcDir, rel), 'utf8')
      for (const m of src.matchAll(/from '([^']+)'/g)) {
        const spec = m[1]!
        // Относительный импорт обязан оставаться внутри пакета: `../` из подкаталога — можно, из корня src — нет.
        const escapes = spec.startsWith('.') && !resolve(dirname(join(srcDir, rel)), spec).startsWith(srcDir + '/')
        const importsBrowserRuntime = spec.startsWith('@voicechat/browser-runner') && spec !== '@voicechat/browser-contracts/security'
        if (escapes || importsBrowserRuntime || FORBIDDEN.some((f) => spec === f || spec.startsWith(`${f}/`))) offenders.push(`${rel} → ${spec}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

it('каждый production-импорт объявлен в своём package.json, без случайного hoisting ядра', () => {
  const manifest = JSON.parse(readFileSync(join(srcDir, '../package.json'), 'utf8'))
  const missing: string[] = []
  for (const rel of files) {
    const source = ts.createSourceFile(rel, readFileSync(join(srcDir, rel), 'utf8'), ts.ScriptTarget.Latest)
    for (const statement of source.statements) {
      if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      const spec = statement.moduleSpecifier.text
      if (spec.startsWith('.') || spec.startsWith('node:')) continue
      const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!
      if (!manifest.dependencies[name]) missing.push(`${rel}: ${name}`)
    }
  }
  expect(missing).toEqual([])
})
