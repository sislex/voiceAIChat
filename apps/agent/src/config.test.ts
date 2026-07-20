import { describe, it, expect } from 'vitest'
import { normalizeServerUrl, loadConfig } from './config'

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
})
