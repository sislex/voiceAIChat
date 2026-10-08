import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import WebSocket, { WebSocketServer } from 'ws'
import { DEV_COMPONENT_REGISTRY, DEV_GATEWAY_VERSION } from '../packages/shared/src/devStand.ts'
import { createGateway, targetFor } from './dev-gateway.mjs'
import { componentEnvironment } from './dev-component.mjs'
import { checkRelease, applyRelease } from './release-composition.mjs'
import { ownerPinChanges } from './owner-pins.mjs'
import { verifySnapshot, verifyDesktopRendererProvenance } from './shared-chat-artifacts.mjs'

const manifest = () => ({ schemaVersion: 1, standId: 'test', machineId: 'machine', baseEnvironmentId: 'base',
  components: Object.fromEntries(Object.entries(DEV_COMPONENT_REGISTRY).map(([id, value]) =>
    [id, { repository: value.repository, sha: 'a'.repeat(40), source: 'base' }])) })
test('gateway version works without stand configuration', () => {
  const env = { ...process.env }
  for (const key of ['SISLEXA_STAND_MANIFEST', 'SISLEXA_BASE_STAND_URL', 'SISLEXA_GATEWAY_PORT']) delete env[key]
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/dev-gateway.mjs', '--version'], { env, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), DEV_GATEWAY_VERSION)
})
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
  value.gateway = { port: ports[2] }
  value.future = true
  writeFileSync(path, JSON.stringify(value))
  const warnings = []
  const gateway = await listen(createGateway({ manifestPath: path, baseUrl: base, onError() {}, onWarning: message => warnings.push(message), probeTimeoutMs: 100 }), ports[2])
  const health = await fetch(gateway + '/__gateway/health')
  assert.equal(health.status, 200)
  assert.equal(health.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await health.json(), { version: DEV_GATEWAY_VERSION, standId: 'test',
    components: Object.fromEntries(Object.keys(value.components).map(id => [id, { reachable: true, statusCode: 200 }])) })
  assert.ok(warnings.includes('dev_gateway_unknown_manifest_field: "future"'))
  assert.equal((await fetch(gateway + '/__gateway/health', { method: 'POST' })).status, 405)
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
  devServer.removeAllListeners('request')
  devServer.on('request', (req, res) => { res.writeHead(503); res.end() })
  const responding = await (await fetch(gateway + '/__gateway/health')).json()
  assert.deepEqual(responding.components.core, { reachable: true, statusCode: 503 })
  // A connected upstream that never returns headers must also time out.
  devServer.removeAllListeners('request')
  devServer.on('request', () => {})
  value.standId = 'reloaded'
  writeFileSync(path + '.new', JSON.stringify(value)); renameSync(path + '.new', path)
  const degraded = await (await fetch(gateway + '/__gateway/health')).json()
  assert.equal(degraded.standId, 'reloaded')
  assert.deepEqual(degraded.components.core, { reachable: false })
  assert.deepEqual(degraded.components.make, { reachable: true, statusCode: 200 })
  value.components.core.source = 'base'; writeFileSync(path, JSON.stringify(value))
  assert.equal(await (await fetch(gateway + '/api/events')).text(), 'base:/api/events')
  writeFileSync(path, '{}')
  assert.equal((await fetch(gateway + '/api/events')).status, 503)
  const invalid = await fetch(gateway + '/__gateway/health')
  assert.equal(invalid.status, 503)
  assert.deepEqual(await invalid.json(), { error: 'invalid_dev_stand_manifest' })
})
