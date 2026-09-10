// Полнота списка прокси канбана: каждый путь, который регистрируют файлы кластера (буквально или
// через константы `REST.*`), и оба его MCP должны попадать под один из `KANBAN_PROXY_PREFIXES` —
// иначе в режиме `remote` этот запрос у ядра получит 404 (так однажды выпал `/api/task-preparation/*`).
// Тест читает исходники как текст: полный список роутов из живого Fastify без хуков не достать.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CI_COMMANDS_MCP_PATH } from '../ci/ciCommandsMcp.js'
import { KANBAN_MCP_PATH } from '../mcp/kanbanMcp.js'
import { KANBAN_PROXY_PREFIXES } from './proxy.js'

const srcDir = join(__dirname, '..')
const CLUSTER_DIRS = ['ci', 'merge', 'orchestration', 'releases', 'preview', 'projects', 'kanban']
const CLUSTER_FILES = ['routes/projects.ts', 'routes/ci.ts', 'routes/qa.ts', 'routes/releases.ts', 'routes/applicationReleases.ts', 'routes/featurePreview.ts', 'routes/projectTypes.ts', 'routes/invitations.ts', 'mcp/kanbanMcp.ts']

function listTs(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...listTs(full))
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

/** `REST.имя` → статический префикс пути (у функций-строителей — начало шаблонной строки). */
function restPaths(): Map<string, string> {
  const proto = readFileSync(join(srcDir, '..', '..', '..', 'packages', 'shared', 'src', 'protocol.ts'), 'utf8')
  const block = /export const REST = \{([\s\S]*?)\n\}/.exec(proto)![1]!
  const out = new Map<string, string>()
  for (const m of block.matchAll(/^\s+(\w+):\s*(?:\([^)]*\)\s*=>\s*)?\n?\s*[`'"](\/[^`'"$]*)/gm)) out.set(m[1]!, m[2]!)
  return out
}

function covered(path: string): boolean {
  return KANBAN_PROXY_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

describe('KANBAN_PROXY_PREFIXES', () => {
  it('покрывает каждый роут кластера и оба его MCP', () => {
    const rest = restPaths()
    const files = [...CLUSTER_DIRS.flatMap((dir) => listTs(join(srcDir, dir))), ...CLUSTER_FILES.map((f) => join(srcDir, f))]
      .filter((f) => !relative(srcDir, f).startsWith('kanban/standalone/'))
    const missing: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/\.(?:get|post|put|delete|patch|all)(?:<[^(]*?>)?\(\s*(?:[`'"](\/[^`'"$]*)|REST\.(\w+))/g)) {
        const path = m[1] ?? rest.get(m[2]!)
        if (!path) { missing.push(`${relative(srcDir, file)}: REST.${m[2]} не найден в protocol.ts`); continue }
        if (!path.startsWith('/api/') && !path.startsWith('/mcp/')) continue
        if (!covered(path)) missing.push(`${relative(srcDir, file)}: ${path}`)
      }
    }
    expect(missing).toEqual([])
    expect(covered(KANBAN_MCP_PATH)).toBe(true)
    expect(covered(CI_COMMANDS_MCP_PATH)).toBe(true)
  })
})
