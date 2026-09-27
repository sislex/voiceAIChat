import { afterEach, expect, it } from 'vitest'
import Fastify from 'fastify'
import { createHash } from 'node:crypto'
import { VoiceChatDb } from './db/database.js'
import { buildIdentityServer } from '@sislexa/identity/server/server'
import { registerRemoteIdentity } from '@sislexa/identity/client/server'
import { signToken } from '@sislexa/identity/server/users/accounts'

const open: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of open.splice(0).reverse()) await close() })

it('serves an external public client through Core without an application component grant', async () => {
  const db = new VoiceChatDb(':memory:')
  open.push(() => db.close())
  await db.ready
  await db.identity.createUser('browser-test-user', '', 'developer')
  const sid = 'browser-test-session'
  await db.identity.createSession(sid, 'browser-test-user', { ip: '127.0.0.1', userAgent: 'integration-test', ttlMs: 600_000 })
  const account = await db.identity.getAccountAccess('browser-test-user')
  expect(account).not.toBeNull()
  const tenantId = account!.tenant.id
  const secret = 'disposable-browser-test-secret'
  const { app: identity } = await buildIdentityServer({ database: db, secret,
    authorize: header => header === 'Bearer internal-core-only' ? { ok: true } : { ok: false, status: 401 },
    authorizeDelegationAudience: (_, audience) => audience === 'core' })
  open.push(() => identity.close())
  const identityUrl = await identity.listen({ host: '127.0.0.1', port: 0 })
  const core = Fastify()
  open.push(() => core.close())
  await registerRemoteIdentity(core, db, { url: identityUrl, token: 'internal-core-only' }, secret)
  const coreUrl = await core.listen({ host: '127.0.0.1', port: 0 })
  const appOrigin = 'https://external-app.example'
  const redirectUri = `${appOrigin}/callback`
  const cookie = `vc_session=${signToken({ name: 'browser-test-user', role: 'developer' }, secret, sid)}; vc_csrf=synthetic-csrf`
  const request = (path: string, init: RequestInit = {}) => fetch(new URL(path, coreUrl), { redirect: 'manual', ...init })
  const sessionHeaders = { cookie, 'x-vc-csrf': 'synthetic-csrf', 'content-type': 'application/json' }

  const create = await request('/api/session/applications', { method: 'POST', headers: sessionHeaders, body: JSON.stringify({ name: 'External test app' }) })
  expect(create.status, await create.clone().text()).toBe(201)
  const application = await create.json() as { id: string }
  const grants = await request(`/api/session/applications/${application.id}/grants`, { headers: { cookie } })
  expect(grants.status).toBe(200)
  expect(await grants.json()).toEqual([])
  const enroll = await request(`/api/session/applications/${application.id}/redirect-uris`, { method: 'POST', headers: sessionHeaders, body: JSON.stringify({ uri: redirectUri }) })
  expect(enroll.status, await enroll.clone().text()).toBe(201)

  const preflight = await request('/api/session/oauth/token', { method: 'OPTIONS', headers: { origin: appOrigin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } })
  expect(preflight.status).toBe(204)
  expect(preflight.headers.get('access-control-allow-origin')).toBe(appOrigin)
  expect(preflight.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS')
  expect(preflight.headers.get('access-control-allow-headers')).toBe('content-type')
  expect(preflight.headers.get('vary')).toContain('Origin')
  expect(preflight.headers.get('access-control-allow-credentials')).toBeNull()
  expect(preflight.headers.get('cache-control')).toBe('no-store')
  const invalidPreflight = await request('/api/session/oauth/token', { method: 'OPTIONS', headers: { origin: 'http://external-app.example' } })
  expect(invalidPreflight.status).toBe(403)
  expect(invalidPreflight.headers.get('access-control-allow-origin')).toBeNull()

  const verifier = 'a'.repeat(43)
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const permissions = [{ resource: { tenantId, type: 'project', id: 'synthetic-project' }, scopes: ['read'] }]
  const consent = { client_id: application.id, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', audience: 'core', permissions, state: 'synthetic-state-123', decision: 'approve' }
  const query = new URLSearchParams({ ...consent, permissions: JSON.stringify(permissions) } as Record<string, string>)
  query.delete('decision')
  const page = await request(`/api/session/oauth/authorize?${query}`, { headers: { cookie } })
  expect(page.status, await page.clone().text()).toBe(200)
  expect(page.headers.get('content-security-policy')).toContain("default-src 'none'")
  expect(page.headers.get('referrer-policy')).toBe('no-referrer')
  expect(page.headers.get('x-content-type-options')).toBe('nosniff')
  expect(page.headers.get('cache-control')).toBe('no-store')
  expect(await page.text()).toContain('External test app')
  const script = await request('/api/session/oauth/consent.js')
  expect(script.status).toBe(200)
  expect(script.headers.get('x-content-type-options')).toBe('nosniff')
  expect(await script.text()).not.toContain('internal-core-only')
  const noCsrf = await request('/api/session/oauth/authorize', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ ...consent, decision: 'approve' }) })
  expect(noCsrf.status).toBe(403)
  const approval = await request('/api/session/oauth/authorize', { method: 'POST', headers: sessionHeaders, body: JSON.stringify({ ...consent, decision: 'approve' }) })
  expect(approval.status, await approval.clone().text()).toBe(200)
  const callback = new URL((await approval.json() as { redirect_uri: string }).redirect_uri)
  expect(callback.origin).toBe(appOrigin)
  expect(callback.searchParams.get('state')).toBe('synthetic-state-123')
  const code = callback.searchParams.get('code')!
  const token = (body: unknown, origin = appOrigin) => request('/api/session/oauth/token', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const exchange = { grant_type: 'authorization_code', code, client_id: application.id, redirect_uri: redirectUri, code_verifier: verifier }
  const wrongOrigin = await token(exchange, 'https://other-app.example')
  expect(wrongOrigin.status).toBe(403)
  expect(wrongOrigin.headers.get('access-control-allow-origin')).toBeNull()
  const issued = await token(exchange)
  expect(issued.status, await issued.clone().text()).toBe(200)
  expect(issued.headers.get('access-control-allow-origin')).toBe(appOrigin)
  expect(issued.headers.get('access-control-allow-credentials')).toBeNull()
  expect(issued.headers.get('cache-control')).toBe('no-store')
  expect(await issued.clone().text()).not.toContain('internal-core-only')
  const first = await issued.json() as { access_token: string; refresh_token: string; token_type: string; expires_in: number }
  expect(first).toMatchObject({ token_type: 'Bearer', expires_in: 300 })
  expect(await db.identity.introspectPublicAccess(first.access_token, 'core')).toMatchObject({ applicationId: application.id, userId: 'browser-test-user', permissions })
  expect((await token(exchange)).status).toBe(400)
  const rotated = await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: application.id })
  expect(rotated.status, await rotated.clone().text()).toBe(200)
  const second = await rotated.json() as typeof first
  expect(second.refresh_token).not.toBe(first.refresh_token)
  expect(await db.identity.introspectPublicAccess(second.access_token, 'core')).not.toBeNull()
  const replay = await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: application.id })
  expect(replay.status).toBe(400)
  expect((await replay.json() as { error: string }).error).toBe('invalid_grant')
  expect(await db.identity.introspectPublicAccess(second.access_token, 'core')).toBeNull()
  expect((await token({ grant_type: 'refresh_token', refresh_token: second.refresh_token, client_id: application.id })).status).toBe(400)
  const finalGrants = await request(`/api/session/applications/${application.id}/grants`, { headers: { cookie } })
  expect(await finalGrants.json()).toEqual([])
})
