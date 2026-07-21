import { describe, it, expect } from 'vitest'
import { encodeAgentConnection, decodeAgentConnection } from './agentProtocol'

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
