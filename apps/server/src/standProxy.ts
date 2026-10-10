import { randomBytes } from 'node:crypto'
import { createServer, request, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { REST, type DevStandAccessResponse } from '@voicechat/shared'

export const IDLE_MS = 60 * 60 * 1000
export function proxyPorts(value = ''): number[] {
  if (!value.trim()) return []
  const match = /^(\d+)(?:-(\d+))?$/.exec(value.trim())
  if (!match) throw new Error('Invalid VC_STAND_PROXY_PORTS')
  const start = Number(match[1]), end = Number(match[2] ?? match[1])
  if (start < 1 || end > 65535 || end < start || end - start > 1000) throw new Error('Invalid VC_STAND_PROXY_PORTS')
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
}
export function standHeaders(headers: IncomingHttpHeaders, key: string, origin: string, port: number): IncomingHttpHeaders {
  const result: IncomingHttpHeaders = { ...headers, host: '127.0.0.1:' + port }
  delete result.authorization
  for (const name of Object.keys(result)) if (name.startsWith('x-vc-') || name.startsWith('x-sislexa-') || name.startsWith('x-forwarded-')) delete result[name]
  delete result.cookie
  const prefix = 'sxs_' + key + '_'
  const cookies = (headers.cookie ?? '').split(';').map(s => s.trim()).filter(s => s.startsWith(prefix) && s.includes('=')).map(s => s.slice(prefix.length))
  if (cookies.length) result.cookie = cookies.join('; ')
  // The stand UI reads `vc_csrf` from document.cookie and finds Core's own token there
  // (cookies are per host); the stand validates header === cookie, so echo its renamed one.
  if (headers['x-vc-csrf'] !== undefined) {
    const csrf = ['__Secure-vc_csrf=', 'vc_csrf='].map(name => cookies.find(c => c.startsWith(name))).find(Boolean)
    if (csrf) result['x-vc-csrf'] = csrf.slice(csrf.indexOf('=') + 1)
  }
  if (result.origin === origin) result.origin = 'http://127.0.0.1:' + port
  return result
}
export function standCookies(cookies: string[] | undefined, key: string): string[] | undefined {
  return cookies?.map(cookie => 'sxs_' + key + '_' + cookie.split(';').filter((part, i) => i === 0 || !/^\s*domain\s*=/i.test(part)).join(';'))
}
type Target = { machineId: string; gatewayPort: number }
type Lease = Target & { user: string; projectId: string; standId: string; key: string; port: number; expiresAt: number; origin: string; server: Server; sockets: Set<Duplex> }
export interface StandProxyDeps {
  ports: number[]
  publicHost?: string
  member(user: string, project: string): Promise<boolean>
  stand(user: string, project: string, stand: string): Promise<Target>
  session(cookie: string): Promise<string | null>
  connect(machine: string, port: number): Duplex
  now?: () => number
}
function fail(statusCode: number, message: string): never { throw Object.assign(new Error(message), { statusCode }) }

export class StandProxy {
  private leases = new Map<string, Lease>()
  private queue: Promise<unknown> = Promise.resolve()
  private timer: NodeJS.Timeout
  private now: () => number
  private closed = false
  constructor(private deps: StandProxyDeps) {
    this.now = deps.now ?? Date.now
    this.timer = setInterval(() => { void this.serial(() => this.expire()) }, 30_000)
    this.timer.unref()
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn); this.queue = next.catch(() => {}); return next
  }
  async access(user: string, projectId: string, standId: string, host: string, port?: number): Promise<DevStandAccessResponse> {
    if (port !== undefined && (!Number.isInteger(port) || port < 1024 || port > 65535)) fail(400, 'invalid_stand_access')
    if (!await this.deps.member(user, projectId)) fail(403, 'project_access_denied')
    if (!this.deps.ports.length || this.closed) fail(503, 'stand_proxy_unavailable')
    const stand = await this.deps.stand(user, projectId, standId)
    const target = { ...stand, gatewayPort: port ?? stand.gatewayPort }
    return this.serial(async () => {
      if (this.closed) fail(503, 'stand_proxy_unavailable')
      await this.expire()
      const id = JSON.stringify([user, projectId, standId, port ?? null])
      let lease = this.leases.get(id)
      if (lease && (lease.machineId !== target.machineId || lease.gatewayPort !== target.gatewayPort)) { await this.remove(id, lease); lease = undefined }
      if (!lease) {
        const hostname = new URL('http://' + (this.deps.publicHost || host)).hostname
        for (const port of this.deps.ports) {
          if ([...this.leases.values()].some(l => l.port === port)) continue
          const server = createServer()
          const candidate: Lease = { ...target, user, projectId, standId, port, key: randomBytes(16).toString('hex'), expiresAt: 0, origin: 'http://' + hostname + ':' + port, server, sockets: new Set() }
          server.on('connection', socket => { candidate.sockets.add(socket); socket.on('close', () => candidate.sockets.delete(socket)) })
          server.on('request', (req, res) => { void this.forward(candidate, req, res).catch(() => res.destroy()) })
          server.on('upgrade', (req, socket, head) => {
            socket.on('error', () => socket.destroy())
            void this.forward(candidate, req, undefined, socket, head).catch(() => socket.destroy())
          })
          try {
            await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', () => { server.removeListener('error', reject); resolve() }) })
          } catch { continue }
          lease = candidate; this.leases.set(id, lease); break
        }
      }
      if (!lease) fail(503, 'stand_proxy_unavailable')
      lease.expiresAt = this.now() + IDLE_MS
      return { url: lease.origin + '/', expiresAt: lease.expiresAt }
    })
  }
  private async forward(lease: Lease, req: IncomingMessage, res?: ServerResponse, socket?: Duplex, head?: Buffer): Promise<void> {
    const deny = (code: number) => { if (res) { res.writeHead(code); res.end() } else socket?.end('HTTP/1.1 ' + code + ' Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n') }
    let user: string | null = null
    try { user = req.headers.cookie ? await this.deps.session(req.headers.cookie) : null } catch {}
    if (this.closed || lease.expiresAt <= this.now() || user !== lease.user || !await this.deps.member(lease.user, lease.projectId)) return deny(401)
    if (res?.destroyed || socket?.destroyed) return
    lease.expiresAt = this.now() + IDLE_MS
    let tunnel: Duplex
    try { tunnel = this.deps.connect(lease.machineId, lease.gatewayPort) } catch { return deny(502) }
    lease.sockets.add(tunnel); tunnel.once('close', () => lease.sockets.delete(tunnel))
    const upstream = request({ hostname: '127.0.0.1', port: lease.gatewayPort, method: req.method, path: req.url, headers: standHeaders(req.headers, lease.key, lease.origin, lease.gatewayPort), createConnection: () => tunnel })
    const touch = () => { lease.expiresAt = this.now() + IDLE_MS }
    tunnel.on('data', touch)
    req.on('data', touch)
    upstream.on('error', () => { tunnel.destroy(); if (res && !res.headersSent) deny(502); else { res?.destroy(); socket?.destroy() } })
    upstream.on('response', response => {
      response.on('error', () => { res?.destroy(); socket?.destroy(); tunnel.destroy() })
      const headers = { ...response.headers }
      if (headers['set-cookie']) headers['set-cookie'] = standCookies(headers['set-cookie'], lease.key)
      if (res) { res.writeHead(response.statusCode ?? 502, headers); response.pipe(res); res.on('close', () => { response.destroy(); tunnel.destroy() }) }
      else { response.destroy(); socket?.destroy(); tunnel.destroy() }
    })
    upstream.on('upgrade', (response, remote, remoteHead) => {
      if (!socket) { remote.destroy(); return }
      const headers = { ...response.headers }
      if (headers['set-cookie']) headers['set-cookie'] = standCookies(headers['set-cookie'], lease.key)
      socket.write('HTTP/1.1 101 Switching Protocols\r\n' + Object.entries(headers).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).filter(v => v !== undefined).map(v => k + ': ' + v + '\r\n')).join('') + '\r\n')
      if (remoteHead.length) socket.write(remoteHead)
      if (head?.length) remote.write(head)
      socket.on('data', touch)
      socket.on('error', () => remote.destroy()); remote.on('error', () => socket.destroy())
      socket.on('close', () => remote.destroy()); remote.on('close', () => socket.destroy())
      remote.pipe(socket).pipe(remote)
    })
    req.on('aborted', () => upstream.destroy())
    socket?.once('close', () => upstream.destroy())
    if (socket) upstream.end()
    else req.pipe(upstream)
  }
  private async remove(id: string, lease: Lease): Promise<void> {
    this.leases.delete(id)
    for (const socket of lease.sockets) socket.destroy()
    await new Promise<void>(resolve => lease.server.close(() => resolve()))
  }
  async expire(): Promise<void> { for (const [id, lease] of this.leases) if (lease.expiresAt <= this.now()) await this.remove(id, lease) }
  async close(): Promise<void> {
    this.closed = true; clearInterval(this.timer)
    await this.serial(async () => { for (const [id, lease] of this.leases) await this.remove(id, lease) })
  }
}
export function registerStandProxy(app: FastifyInstance, proxy: StandProxy, session: StandProxyDeps['session']): void {
  app.post(REST.devStandAccess, async (req, reply) => {
    const body = z.object({ projectId: z.string().min(1), standId: z.string().min(1), port: z.number().int().min(1024).max(65535).optional() }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid_stand_access' })
    const user = req.headers.cookie ? await session(req.headers.cookie) : null
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    try { return await proxy.access(user, body.data.projectId, body.data.standId, req.headers.host ?? '', body.data.port) }
    catch (error) { const e = error as Error & { statusCode?: number }; return reply.code(e.statusCode ?? 502).send({ error: e.message }) }
  })
  app.addHook('onClose', () => proxy.close())
}
