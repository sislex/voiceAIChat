import { describe, expect, it, vi } from 'vitest'
import { REST } from '@voicechat/shared'
import { setupRestHarness } from './restHarness.js'

// Identity checks API expiration against wall time; keep the database clock aligned.
const harness = setupRestHarness({ now: () => Date.now() })

async function createToken(access: 'full' | 'read' = 'full') {
  const response = await harness.inj({
    method: 'POST', url: REST.sessionApiTokens,
    payload: { name: 'Core integration test', ttlDays: 1, access }
  })
  expect(response.statusCode).toBe(200)
  const result = response.json<{ token: string; item: { sid: string; user: string; access: string } }>()
  expect(result.token).toEqual(expect.any(String))
  expect(result.item).toMatchObject({ user: harness.U, access, sid: expect.any(String) })
  return result
}

// API callers use app.inject directly: no harness session, cookie or CSRF header.
const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

describe('Core API token integration with Identity', () => {
  it('reads profile and admin users using only an API bearer token', async () => {
    const { token } = await createToken()
    for (const url of ['/api/me/profile', '/api/admin/users']) {
      const response = await harness.app.inject({ method: 'GET', url, headers: bearer(token) })
      expect(response.statusCode).toBe(200)
    }
  })

  it('persists settings without CSRF and rejects the same mutation for read-only tokens', async () => {
    const full = await createToken()
    const read = await createToken('read')
    const payload = { autoSpeak: false }
    const write = await harness.app.inject({ method: 'PUT', url: REST.settings, headers: bearer(full.token), payload })
    expect(write.statusCode).toBe(200)
    const settings = await harness.app.inject({ method: 'GET', url: REST.settings, headers: bearer(read.token) })
    expect(settings.statusCode).toBe(200)
    expect(settings.json()).toMatchObject(payload)
    const denied = await harness.app.inject({ method: 'PUT', url: REST.settings, headers: bearer(read.token), payload })
    expect(denied.statusCode).toBe(403)
  })

  it('forbids API tokens from creating more tokens', async () => {
    const { token } = await createToken()
    const response = await harness.app.inject({
      method: 'POST', url: REST.sessionApiTokens, headers: bearer(token),
      payload: { name: 'Nested token' }
    })
    expect(response.statusCode).toBe(403)
  })

  it('rejects a revoked token on the next request', async () => {
    const { token, item } = await createToken()
    const request = { method: 'GET' as const, url: '/api/me/profile', headers: bearer(token) }
    expect((await harness.app.inject(request)).statusCode).toBe(200)
    expect((await harness.inj({ method: 'DELETE', url: REST.sessionApiToken(item.sid) })).statusCode).toBe(200)
    expect((await harness.app.inject(request)).statusCode).toBe(401)
  })

  it('upgrades /ws with the API token query parameter and receives the initial feed', async () => {
    const { token } = await createToken()
    const frames: Array<{ t: string }> = []
    await harness.app.ready()
    // Same injectWS helper and initial-feed handshake as server.agentsFeed.test.ts.
    const socket = await harness.app.injectWS(`/ws?token=${encodeURIComponent(token)}`, {}, {
      onInit: ws => ws.on('message', data => frames.push(JSON.parse(String(data))))
    })
    try {
      await vi.waitFor(() => expect(frames.some(frame => frame.t === 'agents')).toBe(true))
    } finally {
      socket.terminate()
    }
  })
})
