// Список прокси канбана. Полноту по исходникам кластера проверять здесь больше нечем: роуты и MCP
// канбана живут в `sislexa-kanban`. Ядро держит только то, что своё под этими префиксами не теряется.
import { describe, expect, it } from 'vitest'
import { CI_COMMANDS_MCP_PATH, KANBAN_MCP_PATH, KANBAN_PROXY_PREFIXES } from './proxy.js'

function covered(path: string): boolean {
  return KANBAN_PROXY_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

describe('KANBAN_PROXY_PREFIXES', () => {
  it('покрывает оба MCP канбана и пути доски', () => {
    expect(covered(KANBAN_MCP_PATH)).toBe(true)
    expect(covered(CI_COMMANDS_MCP_PATH)).toBe(true)
    for (const path of ['/api/projects/p/tasks', '/api/ci/runs/r', '/api/qa/runs/r', '/api/task-preparation/t']) expect(covered(path)).toBe(true)
  })

  it('не забирает чужие пути ядра', () => {
    for (const path of ['/api/conversations', '/api/admin/users', '/mcp/remote-bash', '/api/projectsx']) expect(covered(path)).toBe(false)
  })
})
