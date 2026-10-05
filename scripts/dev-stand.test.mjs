import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import WebSocket, { WebSocketServer } from 'ws'
import { DEV_COMPONENT_REGISTRY } from '../packages/shared/src/devStand.ts'
import { createGateway, targetFor } from './dev-gateway.mjs'
import { componentEnvironment } from './dev-component.mjs'
import { checkRelease, applyRelease } from './release-composition.mjs'
import { ownerPinChanges } from './owner-pins.mjs'
import { verifySnapshot, verifyDesktopRendererProvenance } from './shared-chat-artifacts.mjs'

const manifest = () => ({ schemaVersion: 1, standId: 'test', machineId: 'machine', baseEnvironmentId: 'base',
  components: Object.fromEntries(Object.entries(DEV_COMPONENT_REGISTRY).map(([id, value]) =>
    [id, { repository: value.repository, sha: 'a'.repeat(40), source: 'base' }])) })
test('longest component prefix wins; inactive components fall back to Caddy', () => {
  const value = manifest()
  for (const id of ['core', 'core-ui', 'make']) value.components[id] = { ...value.components[id], source: 'dev', url: `http://${id}` }
  for (const [path, expected] of [['/api/make/x?q=1', 'make'], ['/api/makex', 'core'], ['/api/browser/x', 'base'], ['/ws', 'core'], ['/assets/x', 'core-ui'], ['/p/x', 'make']])
    assert.equal(targetFor(value, path, 'http://base'), `http://${expected}`)
})
test('Core launcher requires stand data and sends external components through the stand', () => {
  assert.throws(() => componentEnvironment({}), /stand allocation/)
  const env = componentEnvironment({ SISLEXA_STAND_URL: 'http://stand', VC_DATA_DIR: '/stand/data', VC_DB_URL: 'postgres://stand/db', VC_PORT: '24001' })
  assert.equal(env.PORT, '24001'); assert.equal(env.HOST, '0.0.0.0')
  assert.equal(env.VC_DATA_DIR, '/stand/data'); assert.equal(env.VC_DB_URL, 'postgres://stand/db')
  assert.equal(env.VC_KANBAN_URL, 'http://stand'); assert.equal(env.VC_MAKE_MODE, 'remote')
})
test('composition, owner pins and Desktop provenance reject development versions', async () => {
  const version = '1.2.3-dev.aaaaaaaaaaaa'
  assert.throws(() => checkRelease('', { version }, ''), /development build/)
  assert.throws(() => applyRelease('', { version }, ''), /development build/)
  assert.throws(() => ownerPinChanges([], () => null, file => file === 'deploy/tools.lock.json' ? JSON.stringify({ tools: { core: { version } } }) : null), /development build/)
  assert.throws(() => verifyDesktopRendererProvenance({ dependencies: { coreUi: { version, commit: 'a' } } }, { version, commit: 'a' }), /Desktop renderer provenance.*development build/)
  await assert.rejects(verifySnapshot({ packages: [{ version }] }), /development build/)
})
test('gateway streams SSE, proxies WebSocket frames, and reloads atomic manifests', { timeout: 10_000 }, async t => {
  const dir = mkdtempSync(join(process.env.DELIVERY_ATTEMPT_ROOT ? join(process.env.DELIVERY_ATTEMPT_ROOT, 'tmp') : tmpdir(), 'gateway-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const ports = (process.env.DELIVERY_PORTS?.match(/\d+/g) ?? ['24000', '24001', '24002']).map(Number)
  const servers = []
  const sockets = new Set()
  t.after(async () => {
    for (const socket of sockets) socket.destroy()
    for (const server of servers.reverse()) await new Promise(resolve => server.close(resolve))
  })
  const listen = async (server, port) => {
    servers.push(server)
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
    server.listen(port, '127.0.0.1'); await once(server, 'listening')
    return `http://127.0.0.1:${port}`
  }
  const base = await listen(http.createServer((req, res) => res.end('base:' + req.url)), ports[0])
  const devServer = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: live\n\n') })
  const wss = new WebSocketServer({ server: devServer })
  t.after(() => { for (const client of wss.clients) client.terminate(); wss.close() })
  wss.on('connection', socket => socket.on('message', data => socket.send(data)))
  const dev = await listen(devServer, ports[1])
  const path = join(dir, 'manifest.json'), value = manifest()
  writeFileSync(path, JSON.stringify(value))
  const gateway = await listen(createGateway({ manifestPath: path, baseUrl: base, onError() {} }), ports[2])
  assert.equal(await (await fetch(gateway + '/ws')).text(), 'base:/ws')
  value.components.core = { ...value.components.core, source: 'dev', url: dev }
  writeFileSync(path + '.new', JSON.stringify(value)); renameSync(path + '.new', path)
  const abort = new AbortController()
  const response = await fetch(gateway + '/api/events', { signal: abort.signal })
  assert.match(new TextDecoder().decode((await response.body.getReader().read()).value), /data: live/)
  abort.abort()
  const ws = new WebSocket(gateway.replace('http:', 'ws:') + '/ws')
  await once(ws, 'open'); ws.send('echo')
  assert.equal(String((await once(ws, 'message'))[0]), 'echo')
  ws.close(); await once(ws, 'close')
  value.components.core.source = 'base'; writeFileSync(path, JSON.stringify(value))
  assert.equal(await (await fetch(gateway + '/api/events')).text(), 'base:/api/events')
  writeFileSync(path, '{}')
  assert.equal((await fetch(gateway + '/api/events')).status, 503)
})
