import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, request } from 'node:http'
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib'
import { connect, type Socket } from 'node:net'
import { once } from 'node:events'
import { WebSocket, WebSocketServer } from 'ws'
import Fastify from 'fastify'
import { AgentRegistry } from './agents/registry.js'
import { AGENT_VERSION } from '@sislexa/agent-contracts'
import { IDLE_MS, StandProxy, proxyPorts, registerStandProxy, standCookies, standHeaders } from './standProxy.js'

const ports = (process.env.DELIVERY_PORTS?.match(/\d+/g) ?? ['24016', '24017', '24018', '24019']).map(Number)
const cleanup: Array<() => Promise<unknown> | unknown> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
function deps() {
  return { ports: [ports[0]!], member: vi.fn(async () => true), stand: vi.fn(async () => ({ machineId: 'm', gatewayPort: ports[3]! })),
    session: vi.fn(async (cookie: string) => cookie.includes('vc_session=alice') ? 'alice' : cookie.includes('vc_session=bob') ? 'bob' : null),
    connect: vi.fn(() => { throw new Error('No tunnel') }) }
}
describe('stand proxy policy', () => {
  it.each([1023, 65536, 6006.5, '6006', null])('rejects invalid target port %s at the route', async port => {
    const d = deps(); const proxy = new StandProxy(d)
    const app = Fastify(); registerStandProxy(app, proxy, d.session); cleanup.push(() => app.close())
    const response = await app.inject({ method: 'POST', url: '/api/dev-stand-access', headers: { cookie: 'vc_session=alice' }, payload: { projectId: 'p', standId: 's', port } })
    expect(response.statusCode).toBe(400)
    expect(d.stand).not.toHaveBeenCalled()
  })
  it('parses disabled and bounded ranges', () => {
    expect(proxyPorts('')).toEqual([]); expect(proxyPorts('8790-8794')).toEqual([8790, 8791, 8792, 8793, 8794])
    for (const input of ['0', '65536', '5-4', 'x', '1-65535']) expect(() => proxyPorts(input)).toThrow()
  })
  it('isolates cookies, credentials and host/origin in both directions', () => {
    const headers = standHeaders({ host: 'core:8790', origin: 'http://core:8790', cookie: 'vc_session=secret; sxs_other_session=bad; sxs_key_vc_session=stand; sxs_key_theme=dark', authorization: 'Bearer secret', 'x-vc-csrf': 'secret' }, 'key', 'http://core:8790', 9000)
    expect(headers).toEqual({ host: '127.0.0.1:9000', origin: 'http://127.0.0.1:9000', cookie: 'vc_session=stand; theme=dark' })
    expect(standHeaders({ origin: 'http://foreign' }, 'key', 'http://core', 9000).origin).toBe('http://foreign')
    const swapped = standHeaders({ cookie: 'vc_csrf=core-token; sxs_key_vc_csrf=stand-token; sxs_key_vc_session=s', 'x-vc-csrf': 'core-token' }, 'key', 'http://core', 9000)
    expect(swapped['x-vc-csrf']).toBe('stand-token')
    expect(swapped.cookie).toBe('vc_csrf=stand-token; vc_session=s')
    expect(standHeaders({ cookie: 'vc_csrf=core-token', 'x-vc-csrf': 'core-token' }, 'key', 'http://core', 9000)['x-vc-csrf']).toBeUndefined()
    expect(standCookies(['vc_session=x; Domain=core; Path=/; HttpOnly; SameSite=Lax', '__Secure-vc_session=y; Secure'], 'key')).toEqual(['sxs_key_vc_session=x; Path=/; HttpOnly; SameSite=Lax', 'sxs_key___Secure-vc_session=y; Secure'])
  })
  it('checks membership before Kanban, fails disabled, registers outside projects', async () => {
    const d = deps(); d.ports = []; const proxy = new StandProxy(d); cleanup.push(() => proxy.close())
    d.member.mockResolvedValue(false)
    await expect(proxy.access('alice', 'p', 's', 'core')).rejects.toMatchObject({ statusCode: 403 })
    expect(d.stand).not.toHaveBeenCalled()
    d.member.mockResolvedValue(true)
    await expect(proxy.access('alice', 'p', 's', 'core')).rejects.toMatchObject({ statusCode: 503, message: 'stand_proxy_unavailable' })
    const app = Fastify(); registerStandProxy(app, proxy, d.session); cleanup.push(() => app.close())
    expect((await app.inject({ method: 'POST', url: '/api/dev-stand-access', payload: { projectId: 'p', standId: 's' } })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/api/dev-stand-access', headers: { cookie: 'vc_session=alice' }, payload: { projectId: 'p', standId: 's' } })).statusCode).toBe(503)
  })
})
describe('stand proxy listeners', () => {
  it('rewrites only opted-in HTML leases and preserves other upstream bytes and headers', async () => {
    const html = '<html><head></head><body>Привет</body></html>'
    const gateway = createServer((req, res) => {
      const path = req.url!
      const raw = Buffer.from(path === '/json' ? '{"ok":true}' : path === '/body' ? '<body class="app">hello</body>' : html)
      const encode = path === '/gzip' || path === '/csp' ? gzipSync : path === '/br' ? brotliCompressSync : path === '/deflate' ? deflateSync : (b: Buffer) => b
      const body = encode(raw)
      res.setHeader('content-type', path === '/json' ? 'application/json' : 'text/html; charset=utf-8')
      if (path !== '/chunked') res.setHeader('content-length', body.length)
      res.setHeader('etag', '"upstream"')
      if (path === '/gzip' || path === '/csp') res.setHeader('content-encoding', 'gzip')
      if (path === '/br' || path === '/deflate') res.setHeader('content-encoding', path.slice(1))
      if (path === '/csp') res.setHeader('content-security-policy', "script-src 'none'")
      if (path === '/chunked') { res.write(body); res.end() } else res.end(body)
    })
    await new Promise<void>((resolve, reject) => { gateway.once('error', reject); gateway.listen(ports[3], '127.0.0.1', resolve) })
    cleanup.push(() => { gateway.closeAllConnections(); return new Promise<void>(resolve => gateway.close(() => resolve())) })
    const inspectorScript = vi.fn(async (cookie: string) => ({ statusCode: 200, headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=300' }, body: Buffer.from('window.__inspector=' + JSON.stringify(cookie)) }))
    const proxy = new StandProxy({ ...deps(), ports: ports.slice(0, 2), connect: (_machine, port) => connect({ host: '127.0.0.1', port }), inspectorScript })
    cleanup.push(() => proxy.close())
    const ordinary = await proxy.access('alice', 'p', 's', '127.0.0.1')
    const opted = await proxy.access('alice', 'p', 's', '127.0.0.1', undefined, { inject: 'make-inspector' })
    expect(opted.url).not.toBe(ordinary.url)
    expect((await proxy.access('alice', 'p', 's', '127.0.0.1', undefined, { inject: 'make-inspector' })).url).toBe(opted.url)
    const read = (base: string, path: string) => new Promise<{ body: Buffer; headers: import('node:http').IncomingHttpHeaders; status: number | undefined }>((resolve, reject) => {
      const req = request(new URL(path, base), { headers: { cookie: 'vc_session=alice', host: 'incoming.example:24016' } }, res => {
        const chunks: Buffer[] = []
        res.on('data', chunk => chunks.push(chunk)); res.on('error', reject)
        res.on('end', () => resolve({ body: Buffer.concat(chunks), headers: res.headers, status: res.statusCode }))
      })
      req.on('error', reject); req.end()
    })
    for (const path of ['/', '/gzip', '/br', '/deflate', '/body', '/chunked']) {
      const result = await read(opted.url, path)
      expect(result.headers['transfer-encoding']).toBeUndefined()
      const script = '<script src="http://incoming.example:24016/api/make/inspector.js" data-vc-make-inspector></script>'
      expect(result.body.toString()).toBe(path === '/body' ? '<body class="app">' + script + 'hello</body>' : html.replace('</head>', script + '</head>'))
      expect(result.status).toBe(200)
      expect(result.headers['content-length']).toBe(String(result.body.length))
      expect(result.headers['content-encoding']).toBeUndefined()
      expect(result.headers.etag).toBeUndefined()
    }
    for (const [base, path, expected] of [[ordinary.url, '/gzip', gzipSync(Buffer.from(html))], [opted.url, '/csp', gzipSync(Buffer.from(html))], [opted.url, '/json', Buffer.from('{"ok":true}')]] as const) {
      const result = await read(base, path)
      expect(result.body).toEqual(expected)
      expect(result.headers.etag).toBe('"upstream"')
      expect(result.headers['content-length']).toBe(String(expected.length))
      expect(result.headers['content-encoding']).toBe(path === '/json' ? undefined : 'gzip')
    }
    const served = await read(opted.url, '/api/make/inspector.js?v=1')
    expect(served.status).toBe(200)
    expect(served.body.toString()).toBe('window.__inspector="vc_session=alice"')
    expect(served.headers['content-type']).toBe('application/javascript; charset=utf-8')
    expect(served.headers['cache-control']).toBe('public, max-age=300')
    expect(served.headers['content-length']).toBe(String(served.body.length))
    expect(inspectorScript).toHaveBeenCalledTimes(1)
    const plain = await read(ordinary.url, '/api/make/inspector.js')
    expect(plain.body.toString()).toBe(html)
    expect(inspectorScript).toHaveBeenCalledTimes(1)
  })
  it('keys leases by requested port and forwards to that port', async () => {
    const d = deps(); d.ports = ports.slice(0, 3)
    const proxy = new StandProxy(d); cleanup.push(() => proxy.close())
    const gateway = await proxy.access('alice', 'p', 's', '127.0.0.1')
    const story = await proxy.access('alice', 'p', 's', '127.0.0.1', 6008)
    expect(story.url).not.toBe(gateway.url)
    expect((await proxy.access('alice', 'p', 's', '127.0.0.1', 6008)).url).toBe(story.url)
    expect((await fetch(story.url, { headers: { cookie: 'vc_session=alice' } })).status).toBe(502)
    expect(d.connect).toHaveBeenCalledWith('m', 6008)
    const other = await proxy.access('alice', 'p', 's', '127.0.0.1', 6009)
    expect(other.url).not.toBe(story.url)
  })
  it('serializes reuse, expires idle leases, exhausts and reclaims ports', async () => {
    let now = 100; const d = deps(); const proxy = new StandProxy({ ...d, now: () => now }); cleanup.push(() => proxy.close())
    const [first, same] = await Promise.all([proxy.access('alice', 'p', 's', '127.0.0.1:8787'), proxy.access('alice', 'p', 's', '127.0.0.1')])
    expect(same).toEqual(first)
    await expect(proxy.access('bob', 'p', 's', '127.0.0.1')).rejects.toMatchObject({ statusCode: 503 })
    now += IDLE_MS + 1
    const next = await proxy.access('bob', 'p', 's', '127.0.0.1')
    expect(next.url).toBe(first.url); expect(next.expiresAt).toBe(now + IDLE_MS)
  })
  it.each([undefined, 'make-inspector'] as const)('streams SSE and WebSocket through agent frames with injection %s; rejects other users before connecting', async inject => {
    const seen: Array<{ cookie?: string; host?: string; origin?: string }> = []
    const gateway = createServer((req, res) => {
      seen.push(req.headers)
      res.writeHead(200, { 'content-type': 'text/event-stream', 'set-cookie': 'vc_session=stand; Domain=core; Path=/; HttpOnly' })
      res.write('data: first\n\n')
      const timer = setTimeout(() => res.end('data: last\n\n'), 100)
      res.on('close', () => clearTimeout(timer))
    })
    const wsServer = new WebSocketServer({ server: gateway })
    wsServer.on('error', () => {})
    wsServer.on('connection', (ws, req) => { seen.push(req.headers); ws.on('message', data => ws.send(data)) })
    await new Promise<void>((resolve, reject) => { gateway.once('error', reject); gateway.listen(ports[3], '127.0.0.1', resolve) })
    cleanup.push(() => { for (const ws of wsServer.clients) ws.terminate(); gateway.closeAllConnections(); return new Promise<void>(resolve => gateway.close(() => resolve())) })
    const registry = new AgentRegistry()
    const sockets = new Map<string, Socket>()
    registry.register('m', 'fake', {
      close() {},
      send(raw) {
        const msg = JSON.parse(raw)
        const frame = (t: string, extra = {}) => { void registry.handleMessage('m', { t, tunnelId: msg.tunnelId, connectionId: msg.connectionId, ...extra } as never) }
        if (msg.t === 'tunnel.connect') {
          const socket = connect({ host: '127.0.0.1', port: msg.port }); sockets.set(msg.connectionId, socket)
          socket.on('connect', () => frame('tunnel.connected'))
          socket.on('data', data => frame('tunnel.data', { data: data.toString('base64') }))
          socket.on('end', () => frame('tunnel.end')); socket.on('error', () => frame('tunnel.connectionError'))
        } else {
          const socket = sockets.get(msg.connectionId)
          if (msg.t === 'tunnel.data') socket?.write(Buffer.from(msg.data, 'base64'))
          if (msg.t === 'tunnel.pause') socket?.pause()
          if (msg.t === 'tunnel.resume') socket?.resume()
          if (msg.t === 'tunnel.end') socket?.end()
        }
      }
    }, undefined, AGENT_VERSION)
    cleanup.push(() => { registry.unregister('m'); for (const s of sockets.values()) s.destroy() })
    const d = deps(); const tunnel = vi.fn((machine: string, port: number) => registry.connectCoreTunnel(machine, port))
    const proxy = new StandProxy({ ...d, connect: tunnel }); cleanup.push(() => proxy.close())
    const lease = await proxy.access('alice', 'p', 's', '127.0.0.1', undefined, { inject })
    for (const cookie of ['', 'vc_session=bob']) {
      const response = await fetch(lease.url, { headers: { cookie, connection: 'close' } }); expect(response.status).toBe(401)
    }
    expect(tunnel).not.toHaveBeenCalled()
    const deniedWs = new WebSocket(lease.url.replace('http:', 'ws:'))
    deniedWs.on('error', () => {})
    const denied = await new Promise<number>(resolve => deniedWs.on('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode!); deniedWs.terminate() }))
    expect(denied).toBe(401)
    expect(tunnel).not.toHaveBeenCalled()
    const response = await fetch(lease.url, { headers: { cookie: 'vc_session=alice', origin: lease.url.slice(0, -1), connection: 'close' } })
    const reader = response.body!.getReader()
    const first = await reader.read(); expect(new TextDecoder().decode(first.value)).toContain('data: first')
    expect(first.done).toBe(false)
    while (!(await reader.read()).done) {}
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!
    expect(cookie).toMatch(/^sxs_[a-f0-9]+_vc_session=stand$/)
    expect(seen[0]).toMatchObject({ host: '127.0.0.1:' + ports[3], origin: 'http://127.0.0.1:' + ports[3] })
    expect(seen[0]!.cookie).toBeUndefined()
    const ws = new WebSocket(lease.url.replace('http:', 'ws:'), { headers: { cookie: 'vc_session=alice; ' + cookie, origin: lease.url.slice(0, -1) } })
    cleanup.push(() => ws.terminate())
    await once(ws, 'open')
    const message = once(ws, 'message'); ws.send('echo'); expect((await message)[0].toString()).toBe('echo')
    expect(seen[1]).toMatchObject({ cookie: 'vc_session=stand', origin: 'http://127.0.0.1:' + ports[3] })
    ws.close()
    await once(ws, 'close')
    d.member.mockResolvedValue(false)
    expect((await fetch(lease.url, { headers: { cookie: 'vc_session=alice', connection: 'close' } })).status).toBe(401)
  })
})
