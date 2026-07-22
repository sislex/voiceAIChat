import { describe, it, expect } from 'vitest'
import { buildAgentScript } from './agentScript'

describe('buildAgentScript', () => {
  it('собирает самодостаточный CJS-бандл с вшитым ws', async () => {
    const script = await buildAgentScript()
    // Shebang для прямого запуска.
    expect(script.startsWith('#!')).toBe(true)
    // ws вшит в бандл (не остаётся внешним import/require 'ws').
    expect(script).not.toMatch(/require\(["']ws["']\)/)
    expect(script).toContain('WebSocket')
    // Читает конфиг из env/флагов.
    expect(script).toContain('VC_AGENT_SERVER')
    expect(script).toContain('VC_AGENT_TOKEN')
  }, 30_000)

  it('кеширует результат (второй вызов — тот же объект)', async () => {
    const a = await buildAgentScript()
    const b = await buildAgentScript()
    expect(a).toBe(b)
  })
})
