import { expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { registerProjectComponentsRoutes } from './projectComponents.js'
import { registerMakePreviewInspector, registerReaderProxy } from '../readerBridge/proxy.js'
import { gzipSync } from 'node:zlib'
import { StorybookSessions, type StorybookRegistry } from '../components/storybookSessions.js'
import { VoiceChatDb } from '../db/database.js'
const uuid = '11111111-1111-4111-8111-111111111111'

it('opens stand Storybook after Core session reconstruction using persisted settings', async () => {
  const db = new VoiceChatDb(':memory:')
  const workspace = 'stand:' + [uuid, uuid, uuid].join('/')
  const registry: StorybookRegistry = {
    ptyStart: vi.fn(), ptyInput: vi.fn(), ptyKill: vi.fn(), ptyLive: () => false,
    isOnline: () => true, nameOf: () => 'machine',
    http: vi.fn(async () => ({ status: 200, headers: {}, bodyBase64: Buffer.from(JSON.stringify({ entries: {} })).toString('base64') }))
  }
  const original = new StorybookSessions({ registry, settings: db.settings })
  const app = Fastify()
  const access = vi.fn(async () => ({ url: 'http://core:24016/', expiresAt: 123 }))
  let restored: StorybookSessions | undefined
  try {
    await original.start({ agentId: 'machine', workspaceId: workspace, path: '/live', port: 24017 })
    original.dispose()
    restored = new StorybookSessions({ registry, settings: db.settings })
    app.addHook('preHandler', async req => { req.user = { name: 'alice', role: 'developer' } as NonNullable<typeof req.user> })
    registerProjectComponentsRoutes(app, {
      git: { resolve: vi.fn(async () => ({ agentId: 'machine', path: '/live' })) } as never,
      storybook: restored, tickets: {} as never, standProxy: { access }
    })
    const response = await app.inject({ method: 'POST', url: '/api/projects/project/components/storybook/open',
      headers: { host: 'core:24018' }, payload: { workspace } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ kind: 'proxy', url: 'http://core:24016/' })
    expect(access).toHaveBeenCalledWith('alice', uuid, uuid, 'core:24018', 24017, { inject: 'make-inspector' })
    expect(registry.ptyStart).not.toHaveBeenCalled()
  } finally {
    original.dispose()
    restored?.dispose()
    await app.close()
    await db.close()
  }
})
it.each([true, false])('opens stand Storybook with proxy enabled=%s', async enabled => {
  const app = Fastify()
  app.addHook('preHandler', async req => { req.user = { name: 'alice', role: 'developer' } as NonNullable<typeof req.user> })
  const access = vi.fn(async () => ({ url: 'http://core:24032/', expiresAt: 123 }))
  const refresh = vi.fn(async () => ({ state: 'running', port: 6008 }))
  const workspace = 'stand:' + [uuid, uuid, uuid].join('/')
  registerProjectComponentsRoutes(app, {
    git: { resolve: vi.fn(async () => ({ agentId: 'machine', path: '/live' })) } as never,
    storybook: { refresh } as never, tickets: {} as never,
    standProxy: enabled ? { access } : undefined
  })
  try {
    const response = await app.inject({ method: 'POST', url: '/api/projects/project/components/storybook/open', headers: { host: 'core:8787' }, payload: { workspace, localAgentId: 'machine' } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ kind: 'proxy', tunnelId: null })
    expect(refresh).toHaveBeenCalledWith('machine', workspace, '/live')
    if (enabled) {
      expect(response.json().url).toBe('http://core:24032/')
      expect(access).toHaveBeenCalledWith('alice', uuid, uuid, 'core:8787', 6008, { inject: 'make-inspector' })
      expect(response.headers['set-cookie']).toBeUndefined()
    } else {
      expect(response.json().url).toMatch(/^\/api\/preview\?url=/)
      expect(access).not.toHaveBeenCalled()
      expect(String(response.headers['set-cookie'])).toContain('vc_make_preview_')
    }
    const ordinary = await app.inject({ method: 'POST', url: '/api/projects/project/components/storybook/open',
      payload: { workspace: 'repo', localAgentId: 'machine' } })
    expect(ordinary.statusCode).toBe(200)
    expect(ordinary.json().kind).toBe('direct')
    expect(ordinary.headers['set-cookie']).toBeUndefined()
  } finally { await app.close() }
})

it.each(['embedded', 'remote'] as const)('injects only Make bridge sessions (%s)', async mode => {
  const app = Fastify()
  let user = 'alice'
  let contentType = 'text/html'
  let csp = ''
  let conditional: string | undefined
  const html = '<html><head></head><body>Story</body></html>'
  app.addHook('preHandler', async req => { req.user = { name: user, role: 'developer' } as NonNullable<typeof req.user> })
  registerMakePreviewInspector(app)
  if (mode === 'remote') {
    registerReaderProxy(app, { readerUrl: 'http://reader', fetchImpl: (async (_input, init) => {
      conditional = new Headers(init?.headers).get('if-none-match') ?? undefined
      return new Response(html, {
      headers: { 'content-type': contentType, 'content-security-policy': csp, etag: 'original' }
      })
    }) as typeof fetch })
  } else {
    app.get('/api/preview', async (req, reply) => {
      conditional = req.headers['if-none-match']
      return reply.type(contentType).header('content-security-policy', csp)
        .header('content-encoding', 'gzip').header('etag', 'original').send(gzipSync(html))
    })
  }
  registerProjectComponentsRoutes(app, {
    git: { resolve: vi.fn(async () => ({ agentId: 'machine', path: '/live' })) } as never,
    storybook: { refresh: vi.fn(async () => ({ state: 'running', port: 6008 })) } as never,
    tickets: {} as never
  })
  const url = '/api/preview?url=' + encodeURIComponent('http://machine.machine.internal:6008/iframe.html') + '&id=button'
  const original = mode === 'remote' ? Buffer.from(html) : gzipSync(html)
  try {
    const plain = await app.inject({ url })
    expect(plain.rawPayload).toEqual(original)
    const opened = await app.inject({ method: 'POST', url: '/api/projects/project/components/storybook/open',
      payload: { workspace: 'stand:' + [uuid, uuid, uuid].join('/') } })
    expect(opened.statusCode).toBe(200)
    const cookie = String(opened.headers['set-cookie']).split(';')[0]!
    const headers = { cookie, host: 'core.test', 'if-none-match': 'original' }
    const injected = await app.inject({ url, headers })
    expect(injected.body).toContain('<script src="http://core.test/api/make/inspector.js" data-vc-make-inspector></script></head>')
    expect(injected.headers['content-encoding']).toBeUndefined()
    expect(injected.headers.etag).toBeUndefined()
    expect(conditional).toBeUndefined()
    expect(Number(injected.headers['content-length'])).toBe(injected.rawPayload.length)
    expect((await app.inject({ url })).rawPayload).toEqual(original)
    expect((await app.inject({ url, headers: { ...headers, cookie: cookie + 'forged' } })).rawPayload).toEqual(original)
    expect((await app.inject({ url: url.replace('6008', '6009'), headers })).rawPayload).toEqual(original)
    user = 'bob'
    expect((await app.inject({ url, headers })).rawPayload).toEqual(original)
    user = 'alice'
    csp = "script-src 'none'"
    expect((await app.inject({ url, headers })).rawPayload).toEqual(original)
    csp = ''
    contentType = 'application/javascript'
    expect((await app.inject({ url, headers })).rawPayload).toEqual(original)
    contentType = 'text/html'
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60_000)
    try { expect((await app.inject({ url, headers })).rawPayload).toEqual(original) } finally { now.mockRestore() }
  } finally { await app.close() }
})

it.each([
  [404, 'stand_not_found'],
  [503, 'stand_proxy_unavailable'],
  [502, 'invalid_stand_response']
])('keeps the stand proxy status %i and code %s', async (statusCode, code) => {
  const app = Fastify()
  app.addHook('preHandler', async req => { req.user = { name: 'alice', role: 'developer' } as NonNullable<typeof req.user> })
  const access = vi.fn(async () => { throw Object.assign(new Error(code), { statusCode }) })
  registerProjectComponentsRoutes(app, {
    git: { resolve: vi.fn(async () => ({ agentId: 'machine', path: '/live' })) } as never,
    storybook: { refresh: vi.fn(async () => ({ state: 'running', port: 6008 })) } as never, tickets: {} as never,
    standProxy: { access }
  })
  try {
    const response = await app.inject({ method: 'POST', url: '/api/projects/project/components/storybook/open',
      payload: { workspace: 'stand:' + [uuid, uuid, uuid].join('/') } })
    expect(response.statusCode).toBe(statusCode)
    expect(response.json()).toMatchObject({ error: code, code })
  } finally { await app.close() }
})

it.each([
  ['offline machine', { isOnline: () => false }, 409, 'machine_offline'],
  ['no free port', {}, 409, 'storybook_no_free_port']
] as const)('reports Storybook start refusal for an %s', async (_name, overrides, statusCode, code) => {
  const app = Fastify()
  app.addHook('preHandler', async req => { req.user = { name: 'alice', role: 'developer' } as NonNullable<typeof req.user> })
  const registry: StorybookRegistry = {
    ptyStart: vi.fn(), ptyInput: vi.fn(), ptyKill: vi.fn(), ptyLive: () => true,
    isOnline: () => true, nameOf: () => 'machine', http: vi.fn(async () => { throw new Error('closed') }), ...overrides
  }
  const storybook = new StorybookSessions({ registry })
  registerProjectComponentsRoutes(app, {
    git: { resolve: vi.fn(async (_user: string, _project: string, workspace: string) => ({ agentId: 'machine', path: '/' + workspace })) } as never,
    storybook, tickets: {} as never
  })
  try {
    if (code === 'storybook_no_free_port') {
      for (let i = 0; i <= 40; i++) await storybook.start({ agentId: 'machine', workspaceId: `ws${i}`, path: `/ws${i}` })
    }
    const response = await app.inject({ method: 'POST', url: '/api/projects/project/components/storybook',
      payload: { workspace: 'extra', action: 'start' } })
    expect(response.statusCode).toBe(statusCode)
    expect(response.json()).toMatchObject({ error: code, code })
  } finally { storybook.dispose(); await app.close() }
})

it('keeps components_failed for errors without a status', async () => {
  const app = Fastify()
  app.addHook('preHandler', async req => { req.user = { name: 'alice', role: 'developer' } as NonNullable<typeof req.user> })
  registerProjectComponentsRoutes(app, {
    git: { resolve: vi.fn(async () => { throw new Error('boom') }) } as never,
    storybook: {} as never, tickets: {} as never
  })
  try {
    const response = await app.inject({ method: 'GET', url: '/api/projects/project/components/storybook?workspace=repo' })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'components_failed', message: 'boom' })
  } finally { await app.close() }
})
