import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { signToken } from '@sislexa/identity/server/users/accounts'
import { setupRestHarness } from './restHarness.js'

// Identity captures Date.now when constructing its limiters.
let clockTime: number
beforeEach(() => { clockTime = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => clockTime) })
const harness = setupRestHarness()
afterEach(() => vi.restoreAllMocks())

describe('public abuse admission through Core HTTP', () => {
  it('bounds login by normalized name and IP, and expires the window', async () => {
    const now = Date.now()
    const login = (name: string, remoteAddress: string) => harness.app.inject({
      method: 'POST', url: '/api/session/login', remoteAddress,
      payload: { name, password: 'invalid' }
    })
    for (let i = 0; i < 10; i++) expect((await login('missing', '192.0.2.' + (i + 1))).statusCode).toBe(401)
    const blocked = await login(' MISSING ', '192.0.2.50')
    expect(blocked.statusCode).toBe(429)
    expect(Number(blocked.headers['retry-after'])).toBe(600)
    for (let i = 0; i < 30; i++) expect((await login('missing-' + i, '192.0.2.60')).statusCode).toBe(401)
    expect((await login('another', '192.0.2.60')).statusCode).toBe(429)
    clockTime = now + 600_001
    expect((await login('missing', '192.0.2.60')).statusCode).toBe(401)
  })

  it('bounds invite registration attempts even with invalid invites', async () => {
    const register = () => harness.app.inject({
      method: 'POST', url: '/api/session/register',
      payload: { token: 'invalid', name: 'sample', password: 'unused-password' }
    })
    for (let i = 0; i < 5; i++) expect((await register()).statusCode).toBe(404)
    expect((await register()).statusCode).toBe(429)
  })

  it('bounds public signup attempts without sending mail and recovers after one hour', async () => {
    await harness.db.settings.setAppConfig('signup.enabled', '1')
    const signup = () => harness.app.inject({ method: 'POST', url: '/api/session/signup', payload: {} })
    for (let i = 0; i < 5; i++) expect((await signup()).statusCode).toBe(400)
    expect((await signup()).statusCode).toBe(429)
    expect(harness.sentMails).toEqual([])
    clockTime += 3_600_001
    expect((await signup()).statusCode).toBe(400)
  })

  it('caps total upload admission and expires rejected traffic without extending the window', async () => {
    const invalid = () => harness.inj({ method: 'POST', url: '/api/uploads', payload: {} })
    for (let i = 0; i < 300; i++) expect((await invalid()).statusCode).toBe(i < 20 ? 400 : 429)
    await harness.db.identity.createUser('fresh-upload', 'fresh-password-2026', 'developer')
    const token = signToken({ name: 'fresh-upload', role: 'developer' }, harness.SECRET)
    const fresh = () => harness.app.inject({ method: 'POST', url: '/api/uploads', payload: {},
      headers: { authorization: 'Bearer ' + token } })
    expect((await fresh()).statusCode).toBe(429)
    clockTime += 60_001
    expect((await fresh()).statusCode).toBe(400)
  })

  it('bounds upload attempts across sessions, preserves other users and recovers', async () => {
    const now = Date.now()
    const payload = { name: 'sample.txt', dataBase64: 'aGk=' }
    const upload = () => harness.inj({ method: 'POST', url: '/api/uploads', payload })
    expect((await upload()).statusCode).toBe(200)
    // Invalid attempts count too, before decoding or touching storage.
    for (let i = 1; i < 20; i++) {
      expect((await harness.inj({ method: 'POST', url: '/api/uploads', payload: {} })).statusCode).toBe(400)
    }
    const blocked = await upload()
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json()).toEqual({ error: 'upload_rate_limit', retryAfterSec: 60 })
    expect(blocked.headers['retry-after']).toBe('60')
    const secondSession = signToken({ name: harness.U, role: 'admin' }, harness.SECRET)
    expect((await harness.app.inject({ method: 'POST', url: '/api/uploads', payload,
      remoteAddress: '192.0.2.99', headers: { authorization: 'Bearer ' + secondSession } })).statusCode).toBe(429)
    await harness.db.identity.createUser('upload-other', 'other-password-2026', 'developer')
    const other = signToken({ name: 'upload-other', role: 'developer' }, harness.SECRET)
    expect((await harness.app.inject({ method: 'POST', url: '/api/uploads', payload,
      headers: { authorization: 'Bearer ' + other } })).statusCode).toBe(200)
    expect((await harness.app.inject({ method: 'POST', url: '/api/uploads', payload })).statusCode).toBe(401)
    clockTime = now + 60_001
    expect((await upload()).statusCode).toBe(200)
  })
})
