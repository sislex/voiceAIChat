import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, request } from 'node:http'
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib'
import { connect, type Socket } from 'node:net'
import { once } from 'node:events'
import { WebSocket, WebSocketServer } from 'ws'
import Fastify from 'fastify'
import { AgentRegistry } from './agents/registry.js'
import { AGENT_VERSION } from '@sislexa/agent-contracts'
import { IDLE_MS, StandProxy, proxyPorts, registerStandProxy, standCookies, standHeaders, standFrameHeaders } from './standProxy.js'

const ports = (process.env.DELIVERY_PORTS?.match(/\d+/g) ?? ['24016', '24017', '24018', '24019']).map(Number)
const cleanup: Array<() => Promise<unknown> | unknown> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
function deps() {
  return { ports: [ports[0]!], member: vi.fn(async () => true), stand: vi.fn(async () => ({ machineId: 'm', gatewayPort: ports[3]! })),
    session: vi.fn(async (cookie: string) => cookie.includes('vc_session=alice') ? 'alice' : cookie.includes('vc_session=bob') ? 'bob' : null),
    connect: vi.fn(() => { throw new Error('No tunnel') }) }
}
describe('stand proxy policy', () => {
  it('rewrites every CSP policy while preserving explicit denial and unrelated headers', () => {
    const parent = 'http://127.0.0.1:25273', lease = 'http://127.0.0.1:28810'
    const allowed = "frame-ancestors 'self' " + parent + ' ' + lease
    const headers = {
      'content-security-policy': ["default-src 'self'; frame-ancestors 'self'", "frame-ancestors 'none', frame-ancestors 'self'; img-src *"],
      'x-frame-options': 'SAMEORIGIN',
      'content-security-policy-report-only': "frame-ancestors 'none'",
    }
    expect(standFrameHeaders(headers, parent, lease)).toEqual({
      'content-security-policy': ["default-src 'self'; " + allowed, "frame-ancestors 'none', " + allowed + '; img-src *'],
      'content-security-policy-report-only': "frame-ancestors 'none'",
    })
    expect(headers['x-frame-options']).toBe('SAMEORIGIN')
    expect(standFrameHeaders({ 'content-security-policy': allowed }, parent, lease)['content-security-policy']).toBe(allowed)
    expect(standFrameHeaders({ 'x-frame-options': 'DENY' }, parent, lease)).toEqual({ 'x-frame-options': 'DENY' })
    expect(standFrameHeaders({ 'content-security-policy': "default-src 'self'" }, parent, lease)).toEqual({ 'content-security-policy': "default-src 'self'" })
  })

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
  it('rewrites only the exact HTTPS lease Origin to the HTTP gateway', () => {
    expect(standHeaders({ origin: 'https://core:8790' }, 'key', 'https://core:8790', 9000).origin).toBe('http://127.0.0.1:9000')
    for (const origin of ['http://core:8790', 'https://core:8791', 'https://foreign']) {
      expect(standHeaders({ origin }, 'key', 'https://core:8790', 9000).origin).toBe(origin)
    }
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
  it.each(['http', 'https'] as const)('allows the Core ancestor through %s leases without weakening explicit denial', async publicScheme => {
    const gateway = createServer((req, res) => {
      if (req.url === '/self') res.setHeader('content-security-policy', "default-src 'self'; frame-ancestors 'self'")
      if (req.url === '/none') {
        res.setHeader('content-security-policy', "frame-ancestors 'none'")
        res.setHeader('x-frame-options', 'SAMEORIGIN')
      }
      if (req.url === '/multiple') res.setHeader('content-security-policy', ["frame-ancestors 'self'", "img-src *; FRAME-ANCESTORS https://trusted.example, frame-ancestors 'self'"])
      if (req.url === '/xfo' || req.url === '/xfo-csp') res.setHeader('x-frame-options', 'sameorigin')
      if (req.url === '/xfo-csp') res.setHeader('content-security-policy', "default-src 'self'")
      res.end('preview')
    })
    await new Promise<void>((resolve, reject) => { gateway.once('error', reject); gateway.listen(ports[3], '127.0.0.1', resolve) })
    cleanup.push(() => { gateway.closeAllConnections(); return new Promise<void>(resolve => gateway.close(() => resolve())) })
    const proxy = new StandProxy({ ...deps(), publicScheme, connect: () => connect(ports[3]!, '127.0.0.1') })
    cleanup.push(() => proxy.close())
    const lease = await proxy.access('alice', 'p', 's', '127.0.0.1:25273')
    const origins = publicScheme + '://127.0.0.1:25273 ' + new URL(lease.url).origin
    const allowed = "frame-ancestors 'self' " + origins
    for (const [path, expected] of [
      ['/self', "default-src 'self'; " + allowed],
      ['/none', "frame-ancestors 'none'"],
      ['/multiple', allowed + ', img-src *; FRAME-ANCESTORS https://trusted.example ' + origins + ', ' + allowed],
      ['/xfo', allowed],
      ['/xfo-csp', "default-src 'self', " + allowed],
      ['/plain', null],
    ] as const) {
      // HTTPS leases are terminated outside this HTTP listener; request Host is not the parent.
      const result = await fetch(lease.url.replace(/^https:/, 'http:') + path.slice(1), { headers: { cookie: 'vc_session=alice', host: 'unrelated.example', connection: 'close' } })
      expect(result.headers.get('content-security-policy'), path).toBe(expected)
      expect(result.headers.get('x-frame-options'), path).toBeNull()
      expect(await result.text()).toBe('preview')
    }
  })

  it('serves public application artifacts without credentials only on live leases', async () => {
    const seen: Array<{ method?: string; url?: string; cookie?: string }> = []
    const gateway = createServer((req, res) => {
      seen.push({ method: req.method, url: req.url, cookie: req.headers.cookie })
      res.setHeader('set-cookie', 'vc_session=stand; Path=/')
      res.end('artifact')
    })
    await new Promise<void>((resolve, reject) => { gateway.once('error', reject); gateway.listen(ports[3], '127.0.0.1', resolve) })
    cleanup.push(() => { gateway.closeAllConnections(); return new Promise<void>(resolve => gateway.close(() => resolve())) })
    const d = deps()
    const tunnel = vi.fn(() => connect(ports[3]!, '127.0.0.1'))
    let now = 1000
    const proxy = new StandProxy({ ...d, connect: tunnel, now: () => now })
    cleanup.push(() => proxy.close())
    const lease = await proxy.access('alice', 'p', 's', '127.0.0.1')
    d.member.mockClear()
    // Use raw request paths so dot segments are not normalized by fetch/URL.
    const send = (method: string, path: string, cookie?: string) => new Promise<{ status: number; cookie?: string }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: ports[0], method, path,
        headers: { connection: 'close', ...(cookie ? { cookie } : {}) } }, res => {
        res.resume()
        res.on('end', () => resolve({ status: res.statusCode!, cookie: res.headers['set-cookie']?.[0]?.split(';')[0] }))
      })
      req.on('error', reject)
      req.end()
    })
    const first = await send('GET', '/applications/make-ui/manifest.json')
    expect(first.status).toBe(200)
    expect(first.cookie).toMatch(/^sxs_[a-f0-9]+_vc_session=stand$/)
    expect((await send('HEAD', '/applications/make-ui/assets/app.js?v=1')).status).toBe(200)
    expect((await send('GET', '/applications/make-ui/app.css', 'vc_session=alice; ' + first.cookie)).status).toBe(200)
    expect(seen).toEqual([
      { method: 'GET', url: '/applications/make-ui/manifest.json', cookie: undefined },
      { method: 'HEAD', url: '/applications/make-ui/assets/app.js?v=1', cookie: undefined },
      { method: 'GET', url: '/applications/make-ui/app.css', cookie: undefined }
    ])
    expect(d.session).not.toHaveBeenCalled()
    expect(d.member).not.toHaveBeenCalled()
    for (const [method, path] of [
      ['GET', '/api/settings'],
      ['POST', '/applications/make-ui/manifest.json'],
      ['GET', '/applications/x/../api'],
      ['GET', '/applications/make-ui/../api'],
      ['GET', '/applications/make-ui/assets/./app.js'],
      ['GET', '/applications/make-ui/%2e%2e/api'],
      ['GET', '/applications/make-ui/assets%2fapp.js'],
      ['GET', '/applications/Make-ui/manifest.json']
    ]) expect((await send(method!, path!)).status).toBe(401)
    expect(tunnel).toHaveBeenCalledTimes(3)
    now = lease.expiresAt
    expect((await send('GET', '/applications/make-ui/manifest.json')).status).toBe(401)
    expect(tunnel).toHaveBeenCalledTimes(3)
  })

  it.each([undefined, 'make-inspector'] as const)('keeps working leases for each request hostname with injection %s', async inject => {
    const gateway = createServer((_req, res) => res.end('stand preview'))
    await new Promise<void>((resolve, reject) => { gateway.once('error', reject); gateway.listen(ports[3], '127.0.0.1', resolve) })
    cleanup.push(() => { gateway.closeAllConnections(); return new Promise<void>(resolve => gateway.close(() => resolve())) })
    const tunnel = vi.fn((_machine: string, port: number) => connect({ host: '127.0.0.1', port }))
    const d = deps()
    const proxy = new StandProxy({ ...d, ports: ports.slice(0, 2), connect: tunnel })
    cleanup.push(() => proxy.close())
    const local = await proxy.access('alice', 'p', 's', 'localhost:25273', undefined, { inject })
    const ip = await proxy.access('alice', 'p', 's', '127.0.0.1:25273', undefined, { inject })
    expect(new URL(local.url).hostname).toBe('localhost')
    expect(new URL(ip.url).hostname).toBe('127.0.0.1')
    expect(new URL(local.url).port).not.toBe(new URL(ip.url).port)
    expect((await proxy.access('alice', 'p', 's', 'LOCALHOST:25274', undefined, { inject })).url).toBe(local.url)
    for (const url of [local.url, ip.url]) {
      const result = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
        // Force IPv4 because proxy listeners bind 0.0.0.0 and localhost may resolve to ::1.
        const req = request(url, { family: 4, agent: false, headers: { cookie: 'vc_session=alice' } }, res => {
          let body = ''
          res.setEncoding('utf8')
          res.on('data', chunk => { body += chunk }); res.on('error', reject)
          res.on('end', () => resolve({ status: res.statusCode, body }))
        })
        req.on('error', reject); req.end()
      })
      expect(result).toEqual({ status: 200, body: 'stand preview' })
    }
    expect(tunnel).toHaveBeenCalledTimes(2)
    expect(tunnel).toHaveBeenCalledWith('m', ports[3])
    const app = Fastify(); registerStandProxy(app, proxy, d.session); cleanup.push(() => app.close())
    const exhausted = await app.inject({ method: 'POST', url: '/api/dev-stand-access', headers: { host: 'third.example:25273', cookie: 'vc_session=alice' }, payload: { projectId: 'p', standId: 's' } })
    expect(exhausted.statusCode).toBe(503)
    expect(exhausted.json()).toEqual({ error: 'stand_proxy_unavailable' })
  })
  it('reuses the configured public hostname across request hosts with a single port', async () => {
    const proxy = new StandProxy({ ...deps(), publicHost: 'preview.example', publicScheme: 'https' })
    cleanup.push(() => proxy.close())
    const local = await proxy.access('alice', 'p', 's', 'localhost:25273')
    const ip = await proxy.access('alice', 'p', 's', '127.0.0.1:25273')
    expect(local.url).toBe('https://preview.example:' + ports[0] + '/')
    expect(ip.url).toBe(local.url)
  })
  it.each(['http', 'https'] as const)('injects the %s lease origin behind TLS termination and preserves other responses', async publicScheme => {
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
    const previewInspectorScript = vi.fn(async (parentOrigin: string) => ({ statusCode: 200, headers: { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=300' }, body: Buffer.from('window.parentOrigin=' + JSON.stringify(parentOrigin)) }))
    const proxy = new StandProxy({ ...deps(), publicScheme, ports: ports.slice(0, 2), connect: (_machine, port) => connect({ host: '127.0.0.1', port }), inspectorScript, previewInspectorScript })
    cleanup.push(() => proxy.close())
    const ordinary = await proxy.access('alice', 'p', 's', '127.0.0.1')
    const opted = await proxy.access('alice', 'p', 's', '127.0.0.1:25273', undefined, { inject: 'make-inspector' })
    expect(opted.url).not.toBe(ordinary.url)
    expect(opted.url).toBe(publicScheme + '://127.0.0.1:' + ports[1] + '/')
    expect((await proxy.access('alice', 'p', 's', '127.0.0.1:25273', undefined, { inject: 'make-inspector' })).url).toBe(opted.url)
    const read = (base: string, path: string) => new Promise<{ body: Buffer; headers: import('node:http').IncomingHttpHeaders; status: number | undefined }>((resolve, reject) => {
      // Caddy terminates TLS; the Core listener receives HTTP with an unrelated Host.
      const req = request(new URL(path, base.replace(/^https:/, 'http:')), { agent: false, headers: { cookie: 'vc_session=alice', host: 'incoming.example:24016' } }, res => {
        const chunks: Buffer[] = []
        res.on('data', chunk => chunks.push(chunk)); res.on('error', reject)
        res.on('end', () => resolve({ body: Buffer.concat(chunks), headers: res.headers, status: res.statusCode }))
      })
      req.on('error', reject); req.end()
    })
    for (const path of ['/', '/gzip', '/br', '/deflate', '/body', '/chunked']) {
      const result = await read(opted.url, path)
      expect(result.headers['transfer-encoding']).toBeUndefined()
      const script = '<script src="' + opted.url + 'api/make/inspector.js" data-vc-make-inspector></script>' +
        '<script src="' + opted.url + '__sislexa/preview-inspector.js"></script>'
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
    const executor = await read(opted.url, '/__sislexa/preview-inspector.js?parentOrigin=https://forged.example')
    expect(executor.status).toBe(200)
    expect(executor.body.toString()).toBe('window.parentOrigin=' + JSON.stringify(publicScheme + '://127.0.0.1:25273'))
    expect(executor.headers['cache-control']).toBe('no-store')
    expect(executor.headers['content-type']).toBe('text/javascript')
    expect(previewInspectorScript).toHaveBeenCalledWith(publicScheme + '://127.0.0.1:25273')
    expect((await read(ordinary.url, '/__sislexa/preview-inspector.js')).body.toString()).toBe(html)
    expect(previewInspectorScript).toHaveBeenCalledTimes(1)
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
