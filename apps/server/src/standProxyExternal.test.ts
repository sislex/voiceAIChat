import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { StandProxy } from './standProxy.js'
import { resolveExternalStand } from './standExternal.js'

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
})
