import { describe, it, expect } from 'vitest'
import { normalizeServerUrl, loadConfig } from './config'
import { encodeAgentConnection } from '@voicechat/shared'

describe('normalizeServerUrl', () => {
  it('http(s):// → ws(s)://', () => {
    expect(normalizeServerUrl('http://host:8787/agent')).toBe('ws://host:8787/agent')
    expect(normalizeServerUrl('https://host/agent')).toBe('wss://host/agent')
  })

  it('без схемы добавляет ws://', () => {
    expect(normalizeServerUrl('host:8787/agent')).toBe('ws://host:8787/agent')
  })

  it('без пути добавляет /agent', () => {
    expect(normalizeServerUrl('ws://host:8787')).toBe('ws://host:8787/agent')
  })
})

describe('loadConfig', () => {
  it('читает флаги --server/--token', () => {
    const cfg = loadConfig(['--server', 'ws://h:1/agent', '--token', 't1'], {})
    expect(cfg).toEqual({ serverUrl: 'ws://h:1/agent', token: 't1' })
  })

  it('флаги имеют приоритет над env', () => {
    const cfg = loadConfig(['--token', 'flag'], {
      VC_AGENT_SERVER: 'ws://h:1/agent',
      VC_AGENT_TOKEN: 'env'
    })
    expect(cfg.token).toBe('flag')
    expect(cfg.serverUrl).toBe('ws://h:1/agent')
  })

  it('строка подключения (--connection) даёт server+token', () => {
    const conn = encodeAgentConnection({ server: 'ws://h:8787/agent', token: 'tok42' })
    const cfg = loadConfig(['--connection', conn], {})
    expect(cfg).toEqual({ serverUrl: 'ws://h:8787/agent', token: 'tok42' })
  })

  it('строка подключения из env VC_AGENT_CONNECTION', () => {
    const conn = encodeAgentConnection({ server: 'wss://host/agent', token: 't' })
    const cfg = loadConfig([], { VC_AGENT_CONNECTION: conn })
    expect(cfg).toEqual({ serverUrl: 'wss://host/agent', token: 't' })
  })

  it('явный --token перекрывает токен из строки подключения', () => {
    const conn = encodeAgentConnection({ server: 'ws://h/agent', token: 'from-conn' })
    const cfg = loadConfig(['--connection', conn, '--token', 'explicit'], {})
    expect(cfg.token).toBe('explicit')
    expect(cfg.serverUrl).toBe('ws://h/agent')
  })
})
