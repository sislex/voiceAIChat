import Fastify from 'fastify'
import { afterEach, expect, it, vi } from 'vitest'
import { registerAnalyticsProxy } from './analyticsBridge.js'
import { REST } from '@voicechat/shared'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

it('forwards bearer identity, query and activity without exposing a component credential', async () => {
  const app = Fastify(), request = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200 }))
  registerAnalyticsProxy(app, { url: 'https://analytics.test', publicFetchImpl: request as unknown as typeof fetch }); cleanup.push(() => app.close())
  expect((await app.inject({ url: REST.analyticsAccount + '?from=1&to=2' })).statusCode).toBe(401)
  expect((await app.inject({ url: REST.analyticsAccount + '?from=1&to=2', headers: { authorization: 'Bearer user' } })).statusCode).toBe(200)
  expect(String(request.mock.calls[0]![0])).toBe('https://analytics.test/api/analytics/account?from=1&to=2')
  expect(request.mock.calls[0]![1]?.headers).toMatchObject({ authorization: 'Bearer user', 'x-request-id': expect.any(String) })
  const payload = { intervals: [{ version: 1 }] }
  expect((await app.inject({ method: 'POST', url: REST.analyticsActivity, headers: { authorization: 'Bearer user' }, payload })).statusCode).toBe(200)
  expect(request.mock.calls[1]![1]).toMatchObject({ method: 'POST', body: JSON.stringify(payload) })
})

it('fails closed when Analytics is absent, redirects, or unreachable', async () => {
  const absent = Fastify(); registerAnalyticsProxy(absent, undefined); cleanup.push(() => absent.close())
  expect((await absent.inject({ url: REST.analyticsAccount, headers: { authorization: 'Bearer user' } })).statusCode).toBe(503)
  for (const response of [async () => new Response('', { status: 302 }), async () => { throw Error('offline') }]) {
    const app = Fastify(); registerAnalyticsProxy(app, { url: 'https://analytics.test', publicFetchImpl: response as typeof fetch }); cleanup.push(() => app.close())
    expect((await app.inject({ url: REST.analyticsAccount, headers: { authorization: 'Bearer user' } })).statusCode).toBe(503)
  }
})
