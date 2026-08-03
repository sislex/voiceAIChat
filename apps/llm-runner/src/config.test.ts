import { describe, expect, it } from 'vitest'
import { loadRunnerConfig } from './config.js'

describe('loadRunnerConfig', () => {
  it('читает окружение исполнителя', () => {
    const config = loadRunnerConfig({
      PORT: '9001',
      HOST: '127.0.0.1',
      VC_RUNNER_TOKEN: 'токен',
      VC_DATA_DIR: '/data',
      HOME: '/home/node',
      VC_CLAUDE_BIN: '/usr/local/bin/claude',
      VC_CODEX_BIN: '/usr/local/bin/codex',
      VC_RUNNER_ORPHAN_MS: '5000'
    })

    expect(config).toEqual({
      port: 9001,
      host: '127.0.0.1',
      token: 'токен',
      dataDir: '/data',
      home: '/home/node',
      claudeBin: '/usr/local/bin/claude',
      codexBin: '/usr/local/bin/codex',
      orphanMs: 5000,
      sharedCodexAuth: false,
      sharedCodexAuthUser: ''
    })
  })

  it('без env: слушает все интерфейсы, токена нет (процесс не стартует)', () => {
    const config = loadRunnerConfig({ HOME: '/home/node' })

    expect(config.host).toBe('0.0.0.0')
    expect(config.port).toBe(8790)
    expect(config.token).toBe('')
    expect(config.claudeBin).toBe('claude')
    expect(config.orphanMs).toBe(30_000)
  })
})
