// Гейт границы Playwright Reader ↔ ядро со стороны ядра (docs/kb/features/playwright-reader.md). Playwright Reader живёт в
// отдельном пакете `@sislexa/playwright-reader`; ядро знает его только через порты `PlaywrightReaderCore`/`PlaywrightReaderService`
// (типы) и сборку `createPlaywrightReaderModule`. Единственные места, где ядро зовёт Playwright Reader по-настоящему, —
// композиция процесса (`server.ts`) и адаптеры портов (`playwrightReaderBridge/`). Тест читает импорты как текст.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = join(__dirname, '..')
/** Композиция процессов (ядра и отдельного Web Reader) и внутренний API для соседних сервисов — им положено знать обе стороны. */
const COMPOSITION = new Set(['server.ts', 'routes/internal.ts'])

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full)); else if (name.endsWith('.ts')) out.push(full)
  }
  return out
}
const isTest = (file: string): boolean => /\.test\.tsx?$/.test(file)
const coreFiles = walk(srcDir).filter((f) => !isTest(f)).map((f) => relative(srcDir, f))
  .filter((rel) => !COMPOSITION.has(rel) && !rel.startsWith('playwrightReaderBridge/'))

describe('граница Playwright Reader ↔ ядро (сторона ядра)', () => {
  it('ядро импортирует из @sislexa/playwright-reader только типы — реализацию подключают server.ts и playwrightReaderBridge/', () => {
    const offenders: string[] = []
    for (const rel of coreFiles) {
      const src = readFileSync(join(srcDir, rel), 'utf8')
      for (const m of src.matchAll(/^import\s+(type\s+)?\{[^}]*\}\s*from '@sislexa\/playwright-reader(?!\/browser-runner)(?:\/[^']*)?'/gm)) {
        if (!m[1]) offenders.push(`${rel}: ${m[0].slice(0, 80)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('REST Chromium и его модельные команды принадлежат приложению', () => {
    expect(coreFiles).not.toContain('routes/browser.ts')
  })
})
