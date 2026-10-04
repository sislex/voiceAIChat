import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { EventEmitter } from 'node:events'
import type { WebSocket } from 'ws'
import type { ComponentRuntime } from '@sislexa/component-runtime'
import { Maintenance } from './maintenance.js'
import { registerInternalRoutes, type InternalRoutesDeps } from './routes/internal.js'
import { attachWs } from './ws.js'

const apps: ReturnType<typeof Fastify>[] = []
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())) })
function fixture(component?: ComponentRuntime) {
  const fixtureToken = randomUUID()
  const app = Fastify(); apps.push(app)
  const maintenance = new Maintenance()
  maintenance.register(app)
  const write = vi.fn(async () => ({ ok: true }))
  app.route({ method: ['POST', 'PUT', 'PATCH', 'DELETE'], url: '/api/write', handler: write })
  app.get('/api/read', async () => ({ value: 42 }))
  registerInternalRoutes(app, { maintenance, token: fixtureToken, component,
    makeCore: {} as InternalRoutesDeps['makeCore'], authenticate: vi.fn() })
  const toggle = (readOnly: unknown, reason: unknown = 'cutover', token = fixtureToken) => app.inject({
    method: 'POST', url: '/internal/maintenance', headers: { authorization: `Bearer ${token}` },
    payload: { readOnly, reason }
  })
  return { app, maintenance, write, toggle, fixtureToken }
}

it('requires the service credential, validates input, blocks all REST mutations and supports rollback', async () => {
  const { app, maintenance, write, toggle } = fixture()
  expect((await toggle(true, 'cutover', randomUUID())).statusCode).toBe(401)
  expect((await toggle('true')).statusCode).toBe(400)
  expect((await toggle(true, null)).statusCode).toBe(400)
  expect(maintenance.snapshot().readOnly).toBe(false)
  expect((await toggle(true)).statusCode).toBe(200)
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
    const response = await app.inject({ method, url: '/api/write?x=1', payload: {} })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'read_only', reason: 'cutover' })
  }
  expect(write).not.toHaveBeenCalled()
  expect((await app.inject('/api/read')).json()).toEqual({ value: 42 })
  expect((await app.inject({ method: 'HEAD', url: '/api/read' })).statusCode).toBe(200)
  expect((await toggle(false)).json()).toEqual({ readOnly: false, reason: '' })
  expect((await app.inject({ method: 'POST', url: '/api/write' })).statusCode).toBe(200)
  expect(write).toHaveBeenCalledTimes(1)
  maintenance.set(true, 'another cutover')
  expect(new Maintenance().snapshot()).toEqual({ readOnly: false, reason: '' })
})

it('requires the managed admin service grant, without falling back to a user token', async () => {
  const authorize = vi.fn().mockReturnValue({ ok: false, status: 403 })
  const { toggle, fixtureToken } = fixture({ authorize, config: { legacyScopes: [] } } as unknown as ComponentRuntime)
  expect((await toggle(true)).statusCode).toBe(403)
  expect(authorize).toHaveBeenCalledWith(`Bearer ${fixtureToken}`, 'admin.rpc')
  authorize.mockReturnValue({ ok: true })
  expect((await toggle(true)).statusCode).toBe(200)
})

it('gates existing WS connections, binary frames and unknown writes while subscriptions and output work', async () => {
  const maintenance = new Maintenance()
  const socket = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, bufferedAmount: 0, send: vi.fn() })
  const onMessage = vi.fn(), onBinary = vi.fn()
  const ctx = await attachWs(socket as unknown as WebSocket, { onMessage, onBinary }, { maintenance })
  maintenance.set(true, 'cutover')
  for (const t of ['claude.send', 'pty.input', 'audio.start', 'future.write']) {
    socket.emit('message', Buffer.from(JSON.stringify({ t })), false)
  }
  socket.emit('message', Buffer.from('audio'), true)
  await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(5))
  expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({ status: 503, error: 'read_only', reason: 'cutover' })
  expect(onMessage).not.toHaveBeenCalled(); expect(onBinary).not.toHaveBeenCalled()
  socket.emit('message', Buffer.from('{"t":"board.subscribe","projectId":"p"}'), false)
  await vi.waitFor(() => expect(onMessage).toHaveBeenCalledTimes(1))
  ctx.send({ t: 'board.changed', projectId: 'p' })
  expect(socket.send).toHaveBeenCalledTimes(6)
  maintenance.set(false, '')
  socket.emit('message', Buffer.from('{"t":"claude.send"}'), false)
  socket.emit('message', Buffer.from('audio'), true)
  await vi.waitFor(() => expect(onBinary).toHaveBeenCalledTimes(1))
  expect(onMessage).toHaveBeenCalledTimes(2)
})

it('exposes live process-local maintenance state through Core health', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { buildServer } = await import('./server.js')
  const { loadConfig } = await import('./config.js')
  const directory = mkdtempSync(join(tmpdir(), 'maintenance-'))
  let app: Awaited<ReturnType<typeof buildServer>> | undefined
  const fixtureToken = randomUUID()
  try {
    app = await buildServer({ config: loadConfig({ VC_DATA_DIR: directory, VC_INTERNAL_TOKEN: fixtureToken }) })
    expect((await app.inject('/api/health')).json()).toMatchObject({ ok: true, readOnly: false, reason: '' })
    expect((await app.inject({ method: 'POST', url: '/internal/maintenance',
      headers: { authorization: `Bearer ${fixtureToken}` }, payload: { readOnly: true, reason: 'migration' }
    })).statusCode).toBe(200)
    expect((await app.inject('/api/health')).json()).toMatchObject({ ok: true, readOnly: true, reason: 'migration' })
    expect((await app.inject({ method: 'POST', url: '/api/conversations', payload: {} })).statusCode).toBe(503)
  } finally {
    await app?.close()
    rmSync(directory, { recursive: true, force: true })
  }
}, 30000)
