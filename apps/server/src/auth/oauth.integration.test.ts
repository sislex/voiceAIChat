import { expect, it, vi } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { REST } from '@voicechat/shared'
import { resolveUser } from '@sislexa/identity/server/users/auth'
import { signToken } from '@sislexa/identity/server/users/accounts'

it('bootstraps the Core session after OAuth callback and rejects missing or denied sessions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'core-oauth-session-'))
  const db = new VoiceChatDb(':memory:')
  await db.ready
  await db.identity.ensureAdmin('')
  const access = await db.identity.getAccountAccess('admin')
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const data = [{ alg: 'RS256', kid: 'session-test' }, {
    iss: 'https://identity', sub: 'admin', aud: 'core', tenant: access!.tenant.id,
    sid: 'session', exp: Math.floor(Date.now() / 1000) + 3600,
  }].map(part => Buffer.from(JSON.stringify(part)).toString('base64url')).join('.')
  const token = `${data}.${sign('sha256', Buffer.from(data), privateKey).toString('base64url')}`
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname === '/.well-known/openid-configuration') return Response.json({
      issuer: 'https://identity', authorization_endpoint: 'https://identity/oauth/authorize',
      token_endpoint: 'https://identity/oauth/token', jwks_uri: 'https://identity/oauth/jwks',
      end_session_endpoint: 'https://identity/oauth/logout',
    })
    if (url.pathname === '/oauth/jwks') return Response.json({
      keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'session-test' }],
    })
    if (url.pathname === '/oauth/token') {
      const body = new URLSearchParams(init?.body as URLSearchParams)
      expect(body.get('grant_type')).toBe('authorization_code')
      expect(body.get('code_verifier')).toBeTruthy()
      return Response.json({ access_token: token, token_type: 'Bearer', expires_in: 3600 })
    }
    throw new Error('Unexpected upstream')
  }))
  let app: Awaited<ReturnType<typeof buildServer>> | undefined
  try {
    app = await buildServer({ db, config: loadConfig({ VC_DATA_DIR: root, AUTH_MODE: 'identity',
      AUTH_URL: 'https://identity', PUBLIC_URL: 'https://core', STORAGE_URL: 'https://storage' }) })
    const bootstrap = [
      { method: 'GET' as const, url: REST.sessionMe },
      { method: 'GET' as const, url: '/auth/session' },
      { method: 'GET' as const, url: REST.sessionSignup },
      { method: 'POST' as const, url: REST.sessionPreview },
      { method: 'POST' as const, url: REST.sessionCookie },
      { method: 'GET' as const, url: REST.sessionAccountAccess },
      { method: 'POST' as const, url: REST.sessionNoticesSeen },
    ]
    for (const route of bootstrap) expect((await app.inject(route)).statusCode).toBe(401)
    for (const headers of [{ cookie: '__Host-sislexa_session=missing' }, { authorization: 'Bearer invalid' }]) {
      expect((await app.inject({ url: REST.sessionMe, headers })).statusCode).toBe(401)
    }
    const login = await app.inject({ url: '/auth/login' })
    expect(login.statusCode).toBe(302)
    const state = new URL(login.headers.location!).searchParams.get('state')!
    const callback = await app.inject({ url: `/auth/callback?code=test&state=${state}`,
      headers: { cookie: login.cookies.map(c => `${c.name}=${c.value}`).join('; ') } })
    expect(callback.statusCode).toBe(302)
    expect(callback.headers.location).toBe('/')
    const headers = { cookie: callback.cookies.map(c => `${c.name}=${c.value}`).join('; ') }
    const me = await app.inject({ url: REST.sessionMe, headers })
    expect(me.statusCode).toBe(200)
    expect(me.headers['cache-control']).toBe('no-store')
    const legacyUser = await resolveUser(db, signToken({ name: 'admin', role: 'admin' }, 'test-secret'), 'test-secret')
    expect(me.json().user).toEqual(legacyUser)
    expect(me.json().notices).toEqual(await db.identity.unseenSecurityNotices('admin'))
    const session = await app.inject({ url: '/auth/session', headers })
    expect(session.statusCode).toBe(200)
    expect(me.json().csrf).toEqual(session.json().csrfToken)
    expect(me.json().csrf).toEqual(expect.any(String))
    expect((await app.inject({ method: 'POST', url: REST.sessionNoticesSeen, headers })).statusCode).toBe(403)
    const csrfHeaders = { ...headers, 'x-csrf-token': me.json().csrf }
    expect((await app.inject({ method: 'POST', url: REST.sessionNoticesSeen, headers: csrfHeaders })).statusCode).toBe(200)
    for (const route of bootstrap.slice(2, -1)) {
      expect((await app.inject({ ...route, headers: csrfHeaders })).statusCode).toBe(403)
    }
    const row = (await db.identity.getUser('admin'))!
    const userSpy = vi.spyOn(db.identity, 'getUser').mockResolvedValue({ ...row, mustChangePassword: true })
    expect((await app.inject({ url: REST.sessionMe, headers })).json().user.mustChangePassword).toBe(true)
    userSpy.mockResolvedValue({ ...row, blocked: true })
    expect((await app.inject({ url: REST.sessionMe, headers })).statusCode).toBe(403)
    userSpy.mockRestore()
    vi.spyOn(db.identity, 'getAccountAccess').mockResolvedValue(null)
    expect((await app.inject({ url: REST.sessionMe, headers })).statusCode).toBe(403)
  } finally {
    vi.restoreAllMocks()
    await app?.close(); await db.close(); vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true })
  }
})

it('routes Core chat uploads, attachment reads, Storage API and admin usage with exchanged tokens', async () => {
  const root = await mkdtemp(join(tmpdir(), 'core-oauth-'))
  const db = new VoiceChatDb(':memory:')
  await db.ready
  await db.identity.ensureAdmin('')
  const access = await db.identity.getAccountAccess('admin')
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwt = (aud: string) => {
    const data = [ { alg: 'RS256', kid: 'test' }, { iss: 'https://identity', sub: 'admin', aud,
      tenant: access!.tenant.id, sid: 'session', exp: Math.floor(Date.now() / 1000) + 3600 },
    ].map(part => Buffer.from(JSON.stringify(part)).toString('base64url')).join('.')
    return `${data}.${sign('sha256', Buffer.from(data), privateKey).toString('base64url')}`
  }
  const coreToken = jwt('core'), storageToken = jwt('storage')
  const seen: string[] = []
  let storedPath = ''
  const entry = () => ({ path: storedPath, size: 5, mimeType: 'text/plain', revision: 1, updatedAt: 1, updatedBy: 'admin' })
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname === '/.well-known/openid-configuration') return Response.json({ issuer: 'https://identity',
      authorization_endpoint: 'https://identity/oauth/authorize', token_endpoint: 'https://identity/oauth/token',
      jwks_uri: 'https://identity/oauth/jwks', end_session_endpoint: 'https://identity/oauth/logout' })
    if (url.pathname === '/oauth/jwks') return Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test' }] })
    if (url.pathname === '/oauth/token') {
      expect(new URLSearchParams(init?.body as URLSearchParams).get('subject_token')).toBe(coreToken)
      return Response.json({ access_token: storageToken, token_type: 'Bearer', expires_in: 3600 })
    }
    if (url.origin !== 'https://storage') throw new Error('Unexpected upstream')
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${storageToken}`)
    expect(new Headers(init?.headers).has('x-sislexa-user')).toBe(false)
    seen.push(url.pathname)
    if (url.pathname.endsWith('/usage')) return Response.json({ userId: 'admin', usedBytes: 5, quotaBytes: 100, fileCount: 1 })
    if (url.pathname.endsWith('/spaces')) return Response.json(init?.method === 'POST' ? { id: 'space' } : { spaces: [] })
    if (init?.method === 'PUT') { storedPath = url.searchParams.get('path')!; return Response.json(entry()) }
    if (url.pathname.endsWith('/files')) return Response.json({ entries: [entry()] })
    return new Response('hello', { headers: { 'content-length': '5' } })
  }))
  let app: Awaited<ReturnType<typeof buildServer>> | undefined
  try {
    app = await buildServer({ db, config: loadConfig({ VC_DATA_DIR: root, AUTH_MODE: 'identity',
      AUTH_URL: 'https://identity', PUBLIC_URL: 'https://core', STORAGE_URL: 'https://storage' }) })
    const headers = { authorization: `Bearer ${coreToken}` }
    const conversation = await app.inject({ method: 'POST', url: REST.conversations, headers, payload: {} })
    expect(conversation.statusCode).toBe(200)
    const uploaded = await app.inject({ method: 'POST', url: REST.uploads, headers,
      payload: { name: 'hello.txt', dataBase64: Buffer.from('hello').toString('base64'), conversationId: conversation.json().id } })
    expect(uploaded.statusCode).toBe(200)
    expect(uploaded.json().storage.spaceId).toBe('space')
    const attachment = await app.inject({ url: `${REST.serverFile}?path=${encodeURIComponent(uploaded.json().path)}`, headers })
    expect(attachment.statusCode).toBe(200)
    expect(attachment.json().dataBase64).toBe(Buffer.from('hello').toString('base64'))
    const read = await app.inject({ url: `/api/storage/spaces/space/file?path=${encodeURIComponent(storedPath)}`, headers })
    expect(read.statusCode).toBe(200)
    expect(read.body).toBe('hello')
    expect((await app.inject({ url: '/api/storage/spaces', headers })).statusCode).toBe(200)
    const admin = await app.inject({ url: REST.adminStorage, headers })
    expect(admin.statusCode).toBe(200)
    expect(admin.json()).toMatchObject({ storageAdminUrl: 'https://storage', storageUsage: { userId: 'admin' } })
    expect((await app.inject({ method: 'PATCH', url: REST.adminUser('admin'), headers, payload: { storageQuotaBytes: 0 } })).statusCode).toBe(409)
    expect(seen).toContain('/api/storage/usage')
  } finally {
    await app?.close(); await db.close(); vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true })
  }
})
