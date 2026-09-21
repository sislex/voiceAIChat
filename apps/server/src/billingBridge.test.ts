import { afterEach, expect, it } from 'vitest'
import Fastify from 'fastify'
import { VoiceChatDb } from './db/database.js'
import { registerAuth } from './users/auth.js'
import { signToken } from './users/accounts.js'
import { registerBillingProxy, type BillingPublicTransport } from './billingBridge.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture(transport?: BillingPublicTransport) {
  const db = new VoiceChatDb(':memory:'); cleanup.push(() => db.close()); await db.ready
  await db.identity.createUser('alice', '', 'admin')
  const app = Fastify(); cleanup.push(() => app.close())
  await registerAuth(app, db, 'billing-bridge-secret')
  registerBillingProxy(app, transport)
  const token = signToken({ name: 'alice', role: 'admin' }, 'billing-bridge-secret')
  return { app, token }
}

it('authenticates and checks cookie CSRF before forwarding only user credentials', async () => {
  const requests: Request[] = []
  const { app, token } = await fixture({ url: 'http://billing.test', publicFetchImpl: async (input, init) => {
    const request = new Request(input, init); requests.push(request)
    return Response.json({ availableMicroUsd: 100 })
  } })
  expect((await app.inject('/api/billing/account')).statusCode).toBe(401)
  expect(requests).toHaveLength(0)
  const cookie = 'vc_session='+token+'; vc_csrf=proof'
  expect((await app.inject({ method: 'PUT', url: '/api/billing/policy', headers: { cookie }, payload: {} })).statusCode).toBe(403)
  expect(requests).toHaveLength(0)
  const response = await app.inject({ method: 'PUT', url: '/api/billing/policy', headers: { cookie, 'x-vc-csrf': 'proof' }, payload: { policy: {}, expectedRevision: 0 } })
  expect(response.statusCode).toBe(200)
  expect(requests).toHaveLength(1)
  expect(requests[0]!.headers.get('authorization')).toBe('Bearer '+token)
  expect(requests[0]!.headers.get('cookie')).toBeNull()
  expect(requests[0]!.headers.get('x-vc-csrf')).toBeNull()
  expect(requests[0]!.url).toBe('http://billing.test/api/billing/policy')
  expect(response.headers['cache-control']).toBe('no-store')
})

it('fails closed on absent dependencies, redirects or transport errors', async () => {
  const missing = await fixture()
  expect((await missing.app.inject({ url: '/api/billing/account', headers: { authorization: 'Bearer '+missing.token } })).statusCode).toBe(503)
  for (const result of ['redirect', 'unavailable'] as const) {
    const { app, token } = await fixture({ url: 'http://billing.test', publicFetchImpl: async () => {
      if (result === 'unavailable') throw Error('private dependency configuration detail')
      return new Response(null, { status: 302, headers: { location: 'http://foreign.test' } })
    } })
    const response = await app.inject({ url: '/api/billing/account', headers: { authorization: 'Bearer '+token } })
    expect(response.statusCode).toBe(503)
    expect(response.body).not.toContain('private')
    expect(response.headers.location).toBeUndefined()
  }
})
