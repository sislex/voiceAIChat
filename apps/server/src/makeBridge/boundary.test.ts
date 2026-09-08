// Гейт границы Make ↔ ядро со стороны ядра (docs/plans/make-standalone.md). Make живёт в
// отдельном пакете `@voicechat/make`; ядро знает его только через порты `MakeCore`/`MakeService`
// (типы) и сборку `createMakeModule`. Единственные места, где ядро зовёт Make по-настоящему, —
// композиция процесса (`server.ts`) и адаптеры портов (`makeBridge/`). Тест читает импорты как текст.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = join(__dirname, '..')
/** Композиция процессов (ядра и отдельного канбана) и внутренний API для соседних сервисов — им положено знать обе стороны. */
const COMPOSITION = new Set(['server.ts', 'routes/internal.ts', 'kanban/standalone/server.ts'])

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
  .filter((rel) => !COMPOSITION.has(rel) && !rel.startsWith('makeBridge/'))

describe('граница Make ↔ ядро (сторона ядра)', () => {
  it('ядро импортирует из @voicechat/make только типы — реализацию подключают server.ts и makeBridge/', () => {
    const offenders: string[] = []
    for (const rel of coreFiles) {
      const src = readFileSync(join(srcDir, rel), 'utf8')
      for (const m of src.matchAll(/^import\s+(type\s+)?\{[^}]*\}\s*from '@voicechat\/make[^']*'/gm)) {
        if (!m[1]) offenders.push(`${rel}: ${m[0].slice(0, 80)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('в ядре не осталось внутренностей Make — ни каталога make/, ни роутов, ни MCP', () => {
    expect(coreFiles.filter((rel) => rel.startsWith('make/') || rel === 'routes/make.ts' || rel === 'mcp/makeMcp.ts')).toEqual([])
  })
})
