// Полнота списка прокси машин: каждый путь роутов машин и переноса хранилищ (буквальный или через `REST.*`)
// должен попадать под один из `MACHINES_PROXY_PREFIXES` — иначе в режиме `remote` запрос у ядра получит 404.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MACHINES_PROXY_PREFIXES } from './proxy.js'

const srcDir = join(__dirname, '..')
const FILES = ['routes/agents.ts', 'storageMigration/routes.ts']

function restPaths(): Map<string, string> {
  const proto = readFileSync(join(srcDir, '..', '..', '..', 'packages', 'shared', 'src', 'protocol.ts'), 'utf8')
  const block = /export const REST = \{([\s\S]*?)\n\}/.exec(proto)![1]!
  const out = new Map<string, string>()
  for (const m of block.matchAll(/^\s+(\w+):\s*(?:\([^)]*\)\s*=>\s*)?\n?\s*[`'"](\/[^`'"$]*)/gm)) out.set(m[1]!, m[2]!)
  return out
}

/** Префикс с параметром (`/api/conversations/:id/storage`) сравнивается по сегментам. */
function covered(path: string): boolean {
  const segs = path.split('/')
  return MACHINES_PROXY_PREFIXES.some((prefix) => {
    const p = prefix.split('/')
    return p.length <= segs.length && p.every((seg, i) => seg.startsWith(':') || seg === segs[i])
  })
}

describe('MACHINES_PROXY_PREFIXES', () => {
  it('покрывает каждый роут машин и переноса хранилищ', () => {
    const rest = restPaths()
    const missing: string[] = []
    for (const file of FILES) {
      const text = readFileSync(join(srcDir, file), 'utf8')
      for (const m of text.matchAll(/\.(?:get|post|put|delete|patch|all)(?:<[^(]*?>)?\(\s*(?:[`'"](\/[^`'"$]*)|REST\.(\w+))/g)) {
        const path = m[1] ?? rest.get(m[2]!)
        if (!path) { missing.push(`${file}: REST.${m[2]} не найден в protocol.ts`); continue }
        if (!path.startsWith('/api/')) continue
        if (!covered(path)) missing.push(`${file}: ${path}`)
      }
    }
    expect(missing).toEqual([])
  })
})
