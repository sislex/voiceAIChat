import { expect, it } from 'vitest'
import { signToken } from '@sislexa/identity/server/users/accounts'
import { setupRestHarness } from './restHarness.js'

const harness = setupRestHarness({ now: Date.now, env: {
  AUTH_MODE: 'identity', AUTH_URL: 'https://identity.test', PUBLIC_URL: 'https://core.test',
} })

async function token(access: 'full' | 'read' = 'full') {
  const { sid } = await harness.db.identity.createApiToken(harness.U, { name: 'operator', ttlMs: 60000, access })
  return { sid, headers: { authorization: `Bearer ${signToken({ name: harness.U, role: 'admin' }, harness.SECRET, sid)}` } }
}

it('accepts Identity API tokens for sessions and REST mutations without CSRF', async () => {
  const { headers } = await token()
  for (const url of ['/api/session/me', '/api/me/profile']) {
    const response = await harness.app.inject({ url, headers })
    expect(response.statusCode, response.body).toBe(200)
  }
  const write = await harness.app.inject({ method: 'PUT', url: '/api/settings', headers, payload: { autoSpeak: false } })
  expect(write.statusCode, write.body).toBe(200)
})

it('retains read-only and tenant restrictions', async () => {
  const { headers } = await token('read')
  const denied = await harness.app.inject({ method: 'PUT', url: '/api/settings', headers, payload: { autoSpeak: false } })
  expect(denied.statusCode).toBe(403)
  expect(denied.json().error).toBe('read_only_token')
  const tenant = await harness.app.inject({ url: '/api/session/me', headers: { ...headers, 'x-sislexa-tenant-id': 'foreign' } })
  expect(tenant.statusCode).toBe(403)
})

it('rejects blocked users and revoked tokens on the next request', async () => {
  const { sid, headers } = await token()
  await harness.db.identity.setUserBlocked(harness.U, true)
  expect((await harness.app.inject({ url: '/api/session/me', headers })).statusCode).toBe(401)
  await harness.db.identity.setUserBlocked(harness.U, false)
  expect((await harness.app.inject({ url: '/api/session/me', headers })).statusCode).toBe(200)
  await harness.db.identity.revokeApiToken(harness.U, sid)
  expect((await harness.app.inject({ url: '/api/session/me', headers })).statusCode).toBe(401)
})
