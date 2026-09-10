// Гейт границы Playwright Reader ↔ ядро со стороны Playwright Reader (docs/kb/features/playwright-reader.md). Playwright Reader —
// самостоятельный сервис: он не знает ни слой данных, ни авторизацию, ни
// реестр машин ядра. Всё, что ему нужно от ядра, — порт `PlaywrightReaderCore`. Тест читает импорты как текст.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = __dirname
const FORBIDDEN = ['@voicechat/server', 'better-sqlite3', '@electric-sql/pglite', '@voicechat/llm-runner', 'pg', 'playwright']

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full)); else if (name.endsWith('.ts')) out.push(full)
  }
  return out
}
const files = walk(srcDir).filter((f) => !/\.test\.ts$/.test(f)).map((f) => relative(srcDir, f))

describe('граница Playwright Reader ↔ ядро (сторона Playwright Reader)', () => {
  it('Playwright Reader не импортирует ядро, слой данных и исполнителей — только shared, публичный HTTP-клиент browser-runner и свои файлы', () => {
    const offenders: string[] = []
    for (const rel of files) {
      const src = readFileSync(join(srcDir, rel), 'utf8')
      for (const m of src.matchAll(/from '([^']+)'/g)) {
        const spec = m[1]!
        // Относительный импорт обязан оставаться внутри пакета: `../` из подкаталога — можно, из корня src — нет.
        const escapes = spec.startsWith('.') && !resolve(dirname(join(srcDir, rel)), spec).startsWith(srcDir + '/')
        const importsBrowserRuntime = spec.startsWith('@voicechat/browser-runner') && spec !== '@voicechat/browser-contracts/client'
        if (escapes || importsBrowserRuntime || FORBIDDEN.some((f) => spec === f || spec.startsWith(`${f}/`))) offenders.push(`${rel} → ${spec}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
