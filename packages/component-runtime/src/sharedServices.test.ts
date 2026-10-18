import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TrustedCoreRegistry, CoreDelegationClient, coreDataPath, registerCoreServiceErrors } from './sharedServices.js'
const entry = (coreId: string) => ({ coreId, url: `https://${coreId}.example.org`, credentialRef: coreId, limits: { machines: 1 } })
describe('shared services', () => {
  it('isolates accounting, credentials, removal and limits', async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response('{}'))
    const registry = new TrustedCoreRegistry(ref => `secret-${ref}`, transport)
    registry.add(entry('core-a')); registry.add(entry('core-b'))
    expect(registry.resolve({ coreId: 'core-a' })).not.toHaveProperty('credentialRef')
    registry.account('core-a', { machines: 1 })
    expect(() => registry.account('core-a', { diskBytes: 10, machines: 1 })).toThrow('core_limit_exceeded')
    expect(registry.usage('core-a').diskBytes).toBe(0)
    expect(registry.usage('core-b').machines).toBe(0)
    await registry.request({ coreId: 'core-b' }, '/internal/test')
    expect(transport.mock.calls[0]?.[0]).toEqual(new URL('https://core-b.example.org/internal/test'))
    registry.remove('core-b')
    await expect(registry.request({ coreId: 'core-b' }, '/test')).rejects.toThrow('core_unknown')
    await expect(registry.request({ coreId: 'core-a' }, '//evil.example')).rejects.toThrow('invalid_core_path')
  })
  it('loads file and single-core defaults without exposing credentials', () => {
    const root = mkdtempSync(join(tmpdir(), 'registry-'))
    try {
      writeFileSync(join(root, 'cores.json'), JSON.stringify([entry('core-a')]))
      expect(TrustedCoreRegistry.fromFile(join(root, 'cores.json')).resolve({ coreId: 'core-a' }).url).toBe('https://core-a.example.org')
      expect(TrustedCoreRegistry.fromEnv({ VC_CORE_URL: 'https://core-a.example.org', VC_CORE_ID: 'core-a', VC_INTERNAL_TOKEN: 'secret' }).resolve({ coreId: 'core-a' })).not.toHaveProperty('credentialRef')
    } finally { rmSync(root, { recursive: true }) }
  })
  it('retries one transient error and preserves session core; never retries used tickets', async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValueOnce(Error('network')).mockResolvedValueOnce(Response.json({ user: { name: 'alice', role: 'admin' }, tenantId: null, capabilities: [], expiresAt: Date.now() + 60000 }))
    const registry = new TrustedCoreRegistry(() => 'secret', transport)
    registry.add(entry('core-a'))
    expect((await registry.redeem('core-a', { ticket: 'opaque', application: 'make' })).coreId).toBe('core-a')
    expect(transport).toHaveBeenCalledTimes(2)
    transport.mockReset().mockResolvedValue(Response.json({ error: 'ticket_used' }, { status: 401 }))
    await expect(registry.redeem('core-a', { ticket: 'opaque', application: 'make' })).rejects.toThrow('ticket_used')
    expect(transport).toHaveBeenCalledTimes(1)
  })
  it('uses the existing delegated chat exchange without a service bearer impersonating a user', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}))
    const registry = new TrustedCoreRegistry(() => 'secret', transport)
    registry.add(entry('core-a'))
    const client = new CoreDelegationClient(registry, { coreId: 'core-a', user: { name: 'alice', role: 'admin' }, tenantId: 'tenant', capabilities: [], expiresAt: Date.now() + 60000 }, 'grant')
    await client.chatSession('conversation')
    const headers = new Headers(transport.mock.calls[0][1]?.headers)
    expect(headers.get('authorization')).toBeNull()
    expect(headers.get('x-sislexa-delegation')).toBe('grant')
    expect(String(transport.mock.calls[0][0])).toBe('https://core-a.example.org/api/chat/session?conversationId=conversation')
  })
  it('serves authenticated per-core usage', async () => {
    const registry = new TrustedCoreRegistry(); registry.add(entry('core-a'))
    const app = Fastify(); registry.registerUsageRoute(app, value => value === 'Bearer admin')
    try {
      expect((await app.inject('/internal/v1/cores/core-a/usage')).statusCode).toBe(401)
      expect((await app.inject({ url: '/internal/v1/cores/core-a/usage', headers: { authorization: 'Bearer admin' } })).json()).toEqual({ coreId: 'core-a', diskBytes: 0, workshops: 0, machines: 0 })
    } finally { await app.close() }
  })
  it('serializes quota failures with the required fields without updating another core', async () => {
    const registry = new TrustedCoreRegistry(); registry.add(entry('core-a')); registry.add(entry('core-b'))
    const app = Fastify(); registerCoreServiceErrors(app)
    app.post('/allocate', async () => registry.account('core-a', { machines: 2 }))
    try {
      const result = await app.inject({ method: 'POST', url: '/allocate' })
      expect(result.statusCode).toBe(409)
      expect(result.json()).toEqual({ error: 'core_limit_exceeded', limit: 'machines', used: 2 })
      expect(registry.usage('core-b').machines).toBe(0)
    } finally { await app.close() }
  })
  it('bounds transient retries and sets an abort deadline on each request', async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(Error('network'))
    const registry = new TrustedCoreRegistry(() => 'secret', transport); registry.add(entry('core-a'))
    await expect(registry.redeem('core-a', { ticket: 'opaque', application: 'make' }, 10)).rejects.toThrow('core_unavailable')
    expect(transport).toHaveBeenCalledTimes(2)
    expect(transport.mock.calls.every(call => call[1]?.signal instanceof AbortSignal && call[1]?.redirect === 'error')).toBe(true)
  })
  it('sends existing turn frames and receives billing and notifications from the session core', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ socketUrl: '/ws?session=scoped', expiresAt: Date.now() + 60000 }))
    const registry = new TrustedCoreRegistry(() => 'secret', transport); registry.add(entry('core-a'))
    const client = new CoreDelegationClient(registry, { coreId: 'core-a', user: { name: 'alice', role: 'admin' }, tenantId: null, capabilities: [], expiresAt: Date.now() + 60000 }, 'grant')
    const socket = Object.assign(new EventTarget(), { send: vi.fn(), close: vi.fn() })
    const notification = vi.fn(); const billing = vi.fn()
    const factory = vi.fn((url: string) => { setTimeout(() => socket.dispatchEvent(new Event('open')), 0); return socket as unknown as WebSocket })
    const connection = await client.connect('conversation', { notification, billing }, factory)
    expect(factory).toHaveBeenCalledWith('wss://core-a.example.org/ws?session=scoped')
    connection.turn({ t: 'claude.send', conversationId: 'conversation', segments: [] })
    expect(JSON.parse(socket.send.mock.calls[1][0])).toEqual({ t: 'claude.send', conversationId: 'conversation', segments: [] })
    socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ t: 'claude.usage', conversationId: 'conversation', usage: {} }) }))
    expect(notification).toHaveBeenCalledOnce(); expect(billing).toHaveBeenCalledOnce()
    expect(() => connection.turn({ t: 'claude.send', conversationId: 'foreign', segments: [] })).toThrow('delegation_denied')
    registry.remove('core-a')
    expect(() => connection.cancel()).toThrow('core_unknown')
    connection.close(); expect(socket.close).toHaveBeenCalled()
  })
  it('rejects traversal and symlink escapes', () => {
    const root = mkdtempSync(join(tmpdir(), 'core-path-'))
    try {
      expect(coreDataPath(root, 'core-a', 'file')).toBe(join(root, 'core-a', 'file'))
      for (const part of ['..', '../escape', '/absolute', 'a\\b', '\0']) expect(() => coreDataPath(root, 'core-a', part)).toThrow()
      mkdirSync(join(root, 'other')); symlinkSync(join(root, 'other'), join(root, 'core-a'))
      expect(() => coreDataPath(root, 'core-a', 'file')).toThrow('invalid_data_path')
      symlinkSync(join(root, 'missing'), join(root, 'core-b'))
      expect(() => coreDataPath(root, 'core-b', 'file')).toThrow('invalid_data_path')
    } finally { rmSync(root, { recursive: true }) }
  })
})
