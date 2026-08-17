import { describe, expect, it, vi } from 'vitest'
import { getLoginStatus } from './loginStatus.js'

describe('getLoginStatus', () => {
  it('доверяет состоянию Claude CLI, а не существующему профилю', async () => {
    const status = await getLoginStatus({
      home: '/profile',
      read: async (path) => path.endsWith('auth.json') ? JSON.stringify({ tokens: { access_token: 'codex-token' } }) : '{"claudeAiOauth":{"accessToken":"stale"}}',
      claudeProbe: vi.fn(async () => ({ code: 1, stdout: JSON.stringify({ loggedIn: false }), stderr: 'Authentication required: secret omitted' }))
    })
    expect(status.claude).toEqual({ provider: 'claude', loggedIn: false, detail: 'требуется повторный вход — выполните `claude login`' })
    expect(status.codex.loggedIn).toBe(true)
    expect(status.claude.detail).not.toContain('secret')
  })

  it('принимает только подтверждённый loggedIn от Claude CLI', async () => {
    const status = await getLoginStatus({
      read: async () => null,
      claudeProbe: async () => ({ code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }), stderr: '' })
    })
    expect(status.claude).toEqual({ provider: 'claude', loggedIn: true, detail: 'вход подтверждён Claude CLI' })
    expect(status.codex.loggedIn).toBe(false)
  })
})
