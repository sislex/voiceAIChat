import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readConfig, writeConfig, configFromConnectionString } from './configStore'
import { encodeAgentConnection } from '@shared/agentProtocol'

describe('configStore', () => {
  it('write → read round-trip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-tray-'))
    try {
      expect(readConfig(dir)).toBeNull()
      writeConfig(dir, { serverUrl: 'ws://h:8787/agent', token: 't1' })
      expect(readConfig(dir)).toEqual({ serverUrl: 'ws://h:8787/agent', token: 't1' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('битый/неполный конфиг → null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-tray-'))
    try {
      writeConfig(dir, { serverUrl: '', token: '' } as never)
      expect(readConfig(dir)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('configFromConnectionString разбирает строку подключения', () => {
    const str = encodeAgentConnection({ server: 'ws://h:8787/agent', token: 'abc' })
    expect(configFromConnectionString(str)).toEqual({ serverUrl: 'ws://h:8787/agent', token: 'abc' })
    expect(configFromConnectionString('мусор')).toBeNull()
  })
})
