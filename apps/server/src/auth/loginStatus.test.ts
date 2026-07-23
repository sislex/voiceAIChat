import { describe, it, expect } from 'vitest'
import { getLoginStatus, type ReadTextFn } from './loginStatus'

const NOW = 1_700_000_000_000

/** Фейковое чтение файлов из карты путь→содержимое (нет ключа → null). */
function fakeRead(files: Record<string, string>): ReadTextFn {
  return async (path) => {
    const hit = Object.entries(files).find(([suffix]) => path.endsWith(suffix))
    return hit ? hit[1] : null
  }
}

describe('getLoginStatus', () => {
  it('оба файла на месте → оба залогинены', async () => {
    const read = fakeRead({
      '.claude/.credentials.json': JSON.stringify({
        claudeAiOauth: { accessToken: 'a', subscriptionType: 'team' }
      }),
      '.codex/auth.json': JSON.stringify({ tokens: { access_token: 'b' } })
    })
    const status = await getLoginStatus({ read, home: '/home/node', env: {}, now: NOW })
    expect(status.claude.loggedIn).toBe(true)
    expect(status.claude.detail).toContain('team')
    expect(status.codex.loggedIn).toBe(true)
  })

  it('файлов нет и нет API-ключей → оба не залогинены', async () => {
    const status = await getLoginStatus({ read: fakeRead({}), home: '/home/node', env: {}, now: NOW })
    expect(status.claude.loggedIn).toBe(false)
    expect(status.codex.loggedIn).toBe(false)
  })

  it('API-ключи в окружении → залогинены без файлов', async () => {
    const status = await getLoginStatus({
      read: fakeRead({}),
      home: '/home/node',
      env: { ANTHROPIC_API_KEY: 'x', OPENAI_API_KEY: 'y' },
      now: NOW
    })
    expect(status.claude.loggedIn).toBe(true)
    expect(status.codex.loggedIn).toBe(true)
  })
})
