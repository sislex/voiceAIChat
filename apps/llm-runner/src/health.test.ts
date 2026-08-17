import { describe, expect, it } from 'vitest'
import { runnerHealth } from './health.js'

describe('runnerHealth', () => {
  it('версии бинарей, Claude CLI probe и Codex из профиля', async () => {
    const files: Record<string, string> = {
      '/home/node/.claude/.credentials.json': JSON.stringify({
        claudeAiOauth: { accessToken: 'a', refreshToken: 'r', subscriptionType: 'team' }
      })
    }
    const res = await runnerHealth({
      home: '/home/node',
      claudeBin: 'claude',
      codexBin: 'codex',
      version: async (bin) => (bin === 'claude' ? '1.2.3 (Claude Code)' : null),
      claudeProbe: async () => ({ code: 0, stdout: JSON.stringify({ loggedIn: true }), stderr: '' }),
      read: async (path) => files[path] ?? null,
      env: {},
      now: 0,
      runs: () => 2
    })

    expect(res.ok).toBe(true)
    expect(res.bins).toEqual({
      claude: { present: true, version: '1.2.3 (Claude Code)' },
      codex: { present: false, version: null }
    })
    expect(res.login.claude.loggedIn).toBe(true)
    expect(res.login.codex.loggedIn).toBe(false)
    expect(res.runs).toBe(2)
  })

  it('ни одного бинаря → ok=false (сервер выберет другого исполнителя)', async () => {
    const res = await runnerHealth({
      home: '/home/node',
      claudeBin: 'claude',
      codexBin: 'codex',
      version: async () => null,
      claudeProbe: async () => ({ code: null, stdout: '', stderr: '' }),
      read: async () => null,
      env: {},
      now: 0
    })
    expect(res.ok).toBe(false)
    expect(res.runs).toBe(0)
  })
})
