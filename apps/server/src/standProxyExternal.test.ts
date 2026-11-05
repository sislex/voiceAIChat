import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { gzipSync } from 'node:zlib'
import type { AddressInfo } from 'node:net'
import { StandProxy } from './standProxy.js'
import { resolveExternalStand } from './standExternal.js'
import { rewriteOriginText, rewritableAcceptEncoding, isRewritableType } from './standRewrite.js'

const cleanup: Array<() => Promise<unknown> | unknown> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function listen(server: Server, port = 0): Promise<number> {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  cleanup.push(() => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())) })
  return (server.address() as AddressInfo).port
}

describe('stand proxy external upstream', () => {
  it('proxies at the lease root, rewrites Location/Set-Cookie/Origin and injects the inspector', async () => {
    vi.stubEnv('VC_STAND_PROXY_ALLOW_PRIVATE', '1')
    cleanup.push(() => vi.unstubAllEnvs())
    const seen: Array<{ host?: string; cookie?: string; origin?: string; referer?: string; authorization?: string }> = []
    const upstream = createServer((req, res) => {
      seen.push({ host: req.headers.host, cookie: req.headers.cookie, origin: req.headers.origin, referer: req.headers.referer, authorization: req.headers.authorization })
      if (req.url === '/login') {
        res.writeHead(302, { location: upstreamOrigin + '/webapp/?x=1', 'set-cookie': 'sid=abc; Domain=localhost; Path=/webapp; Secure; HttpOnly; SameSite=None', 'x-frame-options': 'DENY', 'strict-transport-security': 'max-age=1' })
        return res.end()
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "frame-ancestors 'none'; script-src 'self'" })
      res.end('<html><head></head><body>app</body></html>')
    })
    const upstreamPort = await listen(upstream)
    const upstreamOrigin = 'http://127.0.0.1:' + upstreamPort
    const probe = createServer(); const leasePort = await listen(probe); await new Promise<void>(r => probe.close(() => r()))
    const proxy = new StandProxy({
      secret: 's', ports: [leasePort], member: async () => true, stand: async () => { throw new Error('unused') },
      session: async cookie => cookie.includes('vc_session=alice') ? 'alice' : null,
      connect: () => { throw new Error('no tunnel') },
      userStand: async () => resolveExternalStand(upstreamOrigin),
      inspectorScript: async () => ({ statusCode: 200, headers: { 'content-type': 'application/javascript' }, body: Buffer.from('//inspector') })
    })
    cleanup.push(() => proxy.close())
    const lease = await proxy.access('alice', '', 'ue-test', '127.0.0.1:25273', undefined, { inject: 'make-inspector' })
    const origin = new URL(lease.url).origin
    expect(origin).toBe('http://127.0.0.1:' + leasePort)

    const login = await fetch(origin + '/login', { redirect: 'manual', headers: { cookie: 'vc_session=alice', authorization: 'Bearer core', origin, referer: origin + '/webapp/' } })
    expect(login.status).toBe(302)
    expect(login.headers.get('location')).toBe(origin + '/webapp/?x=1')
    expect(login.headers.get('x-frame-options')).toBeNull()
    expect(login.headers.get('strict-transport-security')).toBeNull()
    const cookie = login.headers.get('set-cookie')!
    expect(cookie).toMatch(/^sxs_[a-f0-9]{32}_sid=abc; Path=\/webapp; HttpOnly; SameSite=Lax$/)
    expect(seen[0]).toEqual({ host: '127.0.0.1:' + upstreamPort, cookie: undefined, origin: upstreamOrigin, referer: upstreamOrigin + '/webapp/', authorization: undefined })

    const page = await fetch(origin + '/webapp/', { headers: { cookie: 'vc_session=alice; ' + cookie.split(';')[0] } })
    expect(seen[1]!.cookie).toBe('sid=abc')
    expect(page.headers.get('content-security-policy')).not.toContain("'none'")
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'self' http://127.0.0.1:25273")
    expect(await page.text()).toContain(origin + '/api/make/inspector.js')
    // Without the user's Core session the lease refuses to proxy.
    expect((await fetch(origin + '/webapp/')).status).toBe(401)
  })

  it('rewrites the upstream origin in textual bodies (plain and gzip) and forwards API POSTs', async () => {
    vi.stubEnv('VC_STAND_PROXY_ALLOW_PRIVATE', '1')
    cleanup.push(() => vi.unstubAllEnvs())
    const posts: Array<{ origin?: string; referer?: string; type?: string; body: string; encoding?: string }> = []
    let acceptEncoding: string | undefined
    const upstream = createServer((req, res) => {
      if (req.url === '/meridian/api/authenticate' && req.method === 'POST') {
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', () => {
          posts.push({ origin: req.headers.origin, referer: req.headers.referer, type: req.headers['content-type'], body })
          res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': upstreamOrigin, 'access-control-allow-credentials': 'true' })
          res.end(JSON.stringify({ token: 't', next: upstreamOrigin + '/webapp/home' }))
        })
        return
      }
      if (req.url === '/webapp/assets/config.json') {
        acceptEncoding = req.headers['accept-encoding']
        const config = JSON.stringify({ api: upstreamOrigin + '/meridian/api', ws: upstreamOrigin.replace('http', 'ws') + '/ws', other: 'http://127.0.0.1:1/x' })
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', etag: '"cfg1"', 'content-length': String(Buffer.byteLength(config)) })
        return res.end(config)
      }
      if (req.url === '/webapp/main.js') {
        const js = 'const a="' + upstreamOrigin + '/api";const b="' + upstreamOrigin.replace(/\//g, '\\/') + '\\/x";const c="//' + new URL(upstreamOrigin).host + '/y";const d="//' + new URL(upstreamOrigin).host + '0/no";'
        const gz = gzipSync(js)
        res.writeHead(200, { 'content-type': 'application/javascript', 'content-encoding': 'gzip', 'content-length': String(gz.length), etag: '"js1"' })
        return res.end(gz)
      }
      const png = Buffer.from(upstreamOrigin)
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(png.length) })
      res.end(png)
    })
    const upstreamPort = await listen(upstream)
    const upstreamOrigin = 'http://127.0.0.1:' + upstreamPort
    const upstreamHost = '127.0.0.1:' + upstreamPort
    const probe = createServer(); const leasePort = await listen(probe); await new Promise<void>(r => probe.close(() => r()))
    const proxy = new StandProxy({
      secret: 's', ports: [leasePort], member: async () => true, stand: async () => { throw new Error('unused') },
      session: async cookie => cookie.includes('vc_session=alice') ? 'alice' : null,
      connect: () => { throw new Error('no tunnel') },
      userStand: async () => resolveExternalStand(upstreamOrigin)
    })
    cleanup.push(() => proxy.close())
    const lease = await proxy.access('alice', '', 'ue-test', '127.0.0.1:25273')
    const origin = new URL(lease.url).origin
    const leaseHost = new URL(origin).host
    const headers = { cookie: 'vc_session=alice', 'accept-encoding': 'gzip, zstd, br' }

    const config = await fetch(origin + '/webapp/assets/config.json', { headers })
    const configText = await config.text()
    expect(acceptEncoding).toBe('gzip, br')
    expect(JSON.parse(configText)).toEqual({ api: origin + '/meridian/api', ws: 'ws://' + leaseHost + '/ws', other: 'http://127.0.0.1:1/x' })
    expect(config.headers.get('content-length')).toBe(String(Buffer.byteLength(configText)))
    expect(config.headers.get('etag')).toBe('W/"cfg1"')

    const js = await fetch(origin + '/webapp/main.js', { headers })
    const jsText = await js.text()
    expect(js.headers.get('content-encoding')).toBeNull()
    expect(js.headers.get('content-length')).toBe(String(Buffer.byteLength(jsText)))
    expect(jsText).toBe('const a="' + origin + '/api";const b="' + origin.replace(/\//g, '\\/') + '\\/x";const c="//' + leaseHost + '/y";const d="//' + upstreamHost + '0/no";')

    const png = await fetch(origin + '/logo.png', { headers })
    expect(await png.text()).toBe(upstreamOrigin)

    const auth = await fetch(origin + '/meridian/api/authenticate', {
      method: 'POST', body: JSON.stringify({ username: 'u', password: 'p' }),
      headers: { ...headers, 'content-type': 'application/json', origin, referer: origin + '/webapp/login' }
    })
    expect(auth.status).toBe(200)
    expect(auth.headers.get('access-control-allow-origin')).toBe(origin)
    expect(await auth.json()).toEqual({ token: 't', next: origin + '/webapp/home' })
    expect(posts).toEqual([{ origin: upstreamOrigin, referer: upstreamOrigin + '/webapp/login', type: 'application/json', body: '{"username":"u","password":"p"}' }])
  })

  it('rewrites only the exact upstream host in every URL form', () => {
    const up = 'https://stg-02.example.com', lease = 'http://127.0.0.1:28851'
    expect(rewriteOriginText('"https://stg-02.example.com/a" "//stg-02.example.com/b" "https:\\/\\/stg-02.example.com\\/c" wss://stg-02.example.com/ws HTTPS://STG-02.EXAMPLE.COM:443/d', up, lease))
      .toBe('"http://127.0.0.1:28851/a" "//127.0.0.1:28851/b" "http:\\/\\/127.0.0.1:28851\\/c" ws://127.0.0.1:28851/ws http://127.0.0.1:28851/d')
    expect(rewriteOriginText('https://stg-02.example.com.evil/x https://stg-02.example.com:8443/y https://a.stg-02.example.com/z', up, lease))
      .toBe('https://stg-02.example.com.evil/x https://stg-02.example.com:8443/y https://a.stg-02.example.com/z')
    expect(rewritableAcceptEncoding('zstd')).toBeUndefined()
    expect(isRewritableType('application/vnd.api+json')).toBe(true)
    expect(isRewritableType('text/css; charset=utf-16')).toBe(false)
    expect(isRewritableType('font/woff2')).toBe(false)
  })
})
