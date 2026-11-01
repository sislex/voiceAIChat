import { afterEach, expect, it, vi } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import Fastify from 'fastify'
import { coreOAuthConfig, registerCoreOAuth } from './oauth.js'
import { createRemoteStorageRuntime } from '../fileStorage/remote.js'
import { fileStorageConfig } from '../fileStorage/config.js'
import type { VoiceChatDb } from '../db/database.js'

afterEach(() => vi.unstubAllGlobals())
it('keeps legacy configurable and validates Identity and Storage origins', () => {
  expect(coreOAuthConfig({})).toBeUndefined()
  expect(coreOAuthConfig({ AUTH_MODE: 'legacy', AUTH_URL: 'https://identity' })).toBeUndefined()
  expect(() => coreOAuthConfig({ AUTH_URL: 'https://identity' })).toThrow()
  expect(() => coreOAuthConfig({ AUTH_URL: 'https://identity', PUBLIC_URL: 'https://core', AUTH_CLIENT_ID: 'other' })).toThrow()
  expect(fileStorageConfig({ STORAGE_URL: 'https://storage' })).toMatchObject({ mode: 'remote', url: 'https://storage' })
  expect(() => fileStorageConfig({ STORAGE_URL: 'https://storage/private' })).toThrow()
})

it('uses the pinned client for PKCE, cookie CSRF, bearer validation, exchange and logout', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwt = (sub: string, aud = 'core') => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ iss: 'https://identity', sub, aud, sid: sub,
      tenant: 'tenant', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
    const data = `${header}.${payload}`
    return `${data}.${sign('sha256', Buffer.from(data), privateKey).toString('base64url')}`
  }
  const tokens = new Map(['alice', 'bob'].map(user => [jwt(user), user]))
  const forms: URLSearchParams[] = []
  const upstream: Headers[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/.well-known/openid-configuration')) return Response.json({ issuer: 'https://identity',
      authorization_endpoint: 'https://identity/oauth/authorize', token_endpoint: 'https://identity/oauth/token',
      jwks_uri: 'https://identity/oauth/jwks', end_session_endpoint: 'https://identity/oauth/logout' })
    if (url.endsWith('/oauth/jwks')) return Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test' }] })
    if (url.endsWith('/oauth/token')) {
      const form = new URLSearchParams(init?.body as URLSearchParams); forms.push(form)
      const exchange = form.get('audience') === 'storage'
      const sub = exchange ? tokens.get(form.get('subject_token')!)! : 'alice'
      return Response.json({ access_token: jwt(sub, exchange ? 'storage' : 'core'), token_type: 'Bearer', expires_in: 3600, refresh_token: 'refresh' })
    }
    if (url.endsWith('/oauth/revoke')) { forms.push(new URLSearchParams(init?.body as URLSearchParams)); return new Response(null, { status: 200 }) }
    if (url.startsWith('https://storage/')) { upstream.push(new Headers(init?.headers)); return Response.json({ spaces: [] }) }
    throw new Error('Unexpected upstream')
  }))
  const db = { identity: {
    getUser: async (name: string) => ({ name, blocked: false }),
    getAccountAccess: async () => ({ systemRole: 'developer', tenant: { id: 'tenant', kind: 'personal' }, tariff: { id: 'test', revision: 1 }, capabilities: [] }),
  } } as unknown as VoiceChatDb
  const app = Fastify()
  try {
    const oauth = await registerCoreOAuth(app, db, { authUrl: 'https://identity', publicUrl: 'https://core' })
    const storage = await createRemoteStorageRuntime(fileStorageConfig({ STORAGE_URL: 'https://storage' }), oauth.storageToken)
    app.route({ method: ['GET', 'POST'], url: '/probe', handler: async (req, reply) => {
      const verdict = await oauth.authenticate(req)
      if (!verdict.ok) return reply.code(verdict.status).send({ error: verdict.error })
      await storage.service.listSpaces(verdict.user.name)
      return { name: verdict.user.name }
    } })
    const login = await app.inject('/auth/login?returnTo=/probe')
    const authorize = new URL(login.headers.location!)
    expect(authorize.pathname).toBe('/oauth/authorize')
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorize.searchParams.get('client_id')).toBe('core')
    const cookie = String(login.headers['set-cookie']).split(';')[0]!
    const callback = await app.inject({ url: `/auth/callback?code=code&state=${authorize.searchParams.get('state')}`, headers: { cookie } })
    expect(callback.statusCode).toBe(302)
    expect(forms[0]!.get('code_verifier')).toBeTruthy()
    const sessionCookie = String(callback.headers['set-cookie']).split(';')[0]!
    expect(sessionCookie).not.toBe(cookie)
    expect(callback.headers['set-cookie']).toContain('HttpOnly')
    expect((await app.inject({ url: '/auth/callback?code=code&state=wrong', headers: { cookie } })).statusCode).toBe(400)
    const session = await app.inject({ url: '/auth/session', headers: { cookie: sessionCookie } })
    expect((await app.inject({ method: 'POST', url: '/probe', headers: { cookie: sessionCookie } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: '/probe', headers: { cookie: sessionCookie, 'x-csrf-token': session.json().csrfToken } })).statusCode).toBe(200)
    const responses = await Promise.all([...tokens.keys()].map(token => app.inject({ url: '/probe', headers: { authorization: `Bearer ${token}` } })))
    expect(responses.map(response => response.json().name)).toEqual(['alice', 'bob'])
    expect(upstream.every(headers => !headers.has('x-sislexa-user') && !headers.has('x-sislexa-tenant'))).toBe(true)
    expect(new Set(upstream.map(headers => headers.get('authorization'))).size).toBe(2)
    expect(forms.some(form => form.get('grant_type') === 'urn:ietf:params:oauth:grant-type:token-exchange')).toBe(true)
    expect((await app.inject({ url: '/probe', headers: { authorization: `Bearer ${jwt('alice', 'storage')}` } })).statusCode).toBe(401)
    const logout = await app.inject({ url: '/auth/logout', headers: { cookie: sessionCookie } })
    expect(logout.headers.location).toContain('/oauth/logout')
    expect(forms.some(form => form.get('token_type_hint') === 'refresh_token')).toBe(true)
    expect((await app.inject({ url: '/probe', headers: { cookie: sessionCookie } })).statusCode).toBe(401)
    await expect(storage.service.listSpaces('alice')).rejects.toMatchObject({ code: 'storage_unavailable' })
  } finally { await app.close() }
})
