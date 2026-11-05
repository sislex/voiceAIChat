import { createHmac } from 'node:crypto'
import { request as httpsRequest } from 'node:https'
import { createServer, request, type ClientRequest, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { isIP, type LookupFunction } from 'node:net'
import type { Duplex } from 'node:stream'
import { canInjectInspector, injectInspectorHtml } from './htmlInject.js'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { REST, type DevStandAccessResponse } from '@voicechat/shared'
import type { ExternalStandTarget } from './standExternal.js'

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
// CSP applies to the entire ancestor chain, including the Core page outside the lease.
export function standFrameHeaders(headers: IncomingHttpHeaders, parentOrigin: string, origin: string): IncomingHttpHeaders {
  const result = { ...headers }
  let hasFrameAncestors = false
  const rewrite = (value: string) => value.replace(/(^|[;,])(\s*frame-ancestors)(?=\s|;|,|$)([^;,]*)/gi, (directive, separator: string, name: string, sources: string) => {
    hasFrameAncestors = true
    const tokens = sources.trim().split(/\s+/)
    if (tokens.some(token => token.toLowerCase() === "'none'")) return directive
    const additions = [...new Set([parentOrigin, origin])].filter(source => !tokens.includes(source))
    return separator + name + sources.trimEnd() + (additions.length ? ' ' + additions.join(' ') : '')
  })
  const csp = result['content-security-policy']
  if (Array.isArray(csp)) result['content-security-policy'] = csp.map(rewrite)
  else if (csp !== undefined) result['content-security-policy'] = rewrite(csp)
  const xfo = result['x-frame-options']
  if (typeof xfo === 'string' && xfo.trim().toUpperCase() === 'SAMEORIGIN') {
    delete result['x-frame-options']
    if (!hasFrameAncestors) {
      const policy = "frame-ancestors 'self' " + [...new Set([parentOrigin, origin])].join(' ')
      result['content-security-policy'] = csp === undefined ? policy : [...(Array.isArray(csp) ? csp : [csp]), policy]
    }
  }
  return result
}
/** Request headers for an external upstream: lease-scoped cookies only, Host/Origin/Referer of the upstream origin. */
export function externalStandHeaders(headers: IncomingHttpHeaders, key: string, origin: string, upstream: string): IncomingHttpHeaders {
  const result = standHeaders(headers, key, origin, 0)
  result.host = new URL(upstream).host
  if (headers.origin === origin) result.origin = upstream
  const referer = headers.referer
  if (typeof referer === 'string' && (referer === origin || referer.startsWith(origin + '/'))) result.referer = upstream + referer.slice(origin.length)
  return result
}
/**
 * Response headers of an external upstream: Location moved to the lease origin, cookies host-only and
 * `SameSite=Lax` (Secure dropped on an http lease), framing allowed for the Core page, HSTS removed so
 * it never sticks to Core's hostname.
 */
export function externalStandResponseHeaders(headers: IncomingHttpHeaders, key: string, parentOrigin: string, origin: string, upstream: string): IncomingHttpHeaders {
  const result: IncomingHttpHeaders = { ...headers }
  delete result['x-frame-options']; delete result['strict-transport-security']; delete result['alt-svc']
  const strip = (value: string) => value.split(/[;]/).filter(part => !/^\s*frame-ancestors(\s|$)/i.test(part)).join(';')
  const csp = result['content-security-policy']
  const policies = (csp === undefined ? [] : Array.isArray(csp) ? csp : [csp]).map(strip).filter(value => value.trim())
  result['content-security-policy'] = [...policies, "frame-ancestors 'self' " + [...new Set([parentOrigin, origin])].join(' ')]
  const location = result.location
  if (typeof location === 'string') {
    try {
      const target = new URL(location, upstream + '/')
      if (target.origin === upstream && /^(https?:)?\/\//i.test(location)) result.location = origin + target.pathname + target.search + target.hash
    } catch {}
  }
  const secure = origin.startsWith('https:')
  const cookies = result['set-cookie']?.map(cookie => {
    const [pair, ...attrs] = cookie.split(';')
    const kept = attrs.filter(part => !/^\s*(samesite|partitioned)\s*(=|$)/i.test(part) && (secure || !/^\s*secure\s*$/i.test(part)))
    return [pair, ...kept, ' SameSite=Lax'].join(';')
  })
  if (cookies) result['set-cookie'] = standCookies(cookies, key)
  return result
}
type MachineTarget = { machineId: string; gatewayPort: number }
type Target = MachineTarget | ExternalStandTarget
function isExternal(target: Target): target is ExternalStandTarget { return 'kind' in target && target.kind === 'external' }
function sameTarget(a: Target, b: Target): boolean {
  return isExternal(a) || isExternal(b) ? isExternal(a) && isExternal(b) && a.origin === b.origin
    : a.machineId === b.machineId && a.gatewayPort === b.gatewayPort
}
export type StandProxyAccessOptions = { inject?: 'make-inspector' }
type Lease = StandProxyAccessOptions & { target: Target; user: string; projectId: string; standId: string; key: string; port: number; expiresAt: number; origin: string; parentOrigin: string; server: Server; sockets: Set<Duplex> }
export interface StandProxyDeps {
  /** Persistent Core signing secret; keeps stand cookie names stable across restarts. */
  secret: string
  ports: number[]
  publicHost?: string
  publicScheme?: 'http' | 'https'
  member(user: string, project: string): Promise<boolean>
  stand(user: string, project: string, stand: string): Promise<MachineTarget>
  /**
   * Resolver for user-scoped stands (`us-<machineId>-<port>` machine stands and `ue-<hash>` external
   * URLs, Make stands library): no project, it must reject when the user may no longer use the machine
   * or the URL no longer passes the SSRF guard. Called on every proxied request; an external target's
   * resolved address is the one the request connects to.
   */
  userStand?(user: string, stand: string): Promise<Target>
  session(cookie: string): Promise<string | null>
  connect(machine: string, port: number): Duplex
  /** Serves the Make inspector script on injected leases so the stand itself never has to know the route. */
  inspectorScript?(cookie: string): Promise<{ statusCode: number; headers: Record<string, string>; body: Buffer }>
  previewInspectorScript?(parentOrigin: string, cookie: string): Promise<{ statusCode: number; headers: Record<string, string>; body: Buffer }>
  now?: () => number
}
const INSPECTOR_SCRIPT_PATH = '/api/make/inspector.js'
const PREVIEW_INSPECTOR_SCRIPT_PATH = '/__sislexa/preview-inspector.js'
function fail(statusCode: number, message: string): never { throw Object.assign(new Error(message), { statusCode }) }

/** User-scoped stand ids carry no project; their lease is authorized by machine usability (or the URL guard) alone. */
export function isUserStandId(standId: string): boolean { return standId.startsWith('us-') || standId.startsWith('ue-') }

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
  async access(user: string, projectId: string, standId: string, host: string, port?: number, options: StandProxyAccessOptions = {}): Promise<DevStandAccessResponse> {
    if (port !== undefined && (!Number.isInteger(port) || port < 1024 || port > 65535)) fail(400, 'invalid_stand_access')
    const userStand = isUserStandId(standId)
    if (userStand) { if (!this.deps.userStand) fail(404, 'stand_not_found'); if (port !== undefined) fail(400, 'invalid_stand_access'); projectId = '' }
    else if (!await this.deps.member(user, projectId)) fail(403, 'project_access_denied')
    if (!this.deps.ports.length || this.closed) fail(503, 'stand_proxy_unavailable')
    const stand = userStand ? await this.deps.userStand!(user, standId) : await this.deps.stand(user, projectId, standId)
    const target: Target = isExternal(stand) ? stand : { ...stand, gatewayPort: port ?? stand.gatewayPort }
    return this.serial(async () => {
      if (this.closed) fail(503, 'stand_proxy_unavailable')
      await this.expire()
      const hostname = new URL('http://' + (this.deps.publicHost || host)).hostname
      // Core session cookies are host-scoped, so each page hostname needs its own origin.
      const id = JSON.stringify([user, projectId, standId, port ?? null, options.inject ?? null, hostname])
      let lease = this.leases.get(id)
      if (lease && !sameTarget(lease.target, target)) { await this.remove(id, lease); lease = undefined }
      if (!lease) {
        for (const port of this.deps.ports) {
          if ([...this.leases.values()].some(l => l.port === port)) continue
          const server = createServer()
          const candidate: Lease = { target, parentOrigin: new URL((this.deps.publicScheme ?? 'http') + '://' + host).origin, inject: options.inject, user, projectId, standId, port, key: createHmac('sha256', this.deps.secret).update(id).digest('hex').slice(0, 32), expiresAt: 0, origin: (this.deps.publicScheme ?? 'http') + '://' + hostname + ':' + port, server, sockets: new Set() }
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
    const path = (req.url ?? '').split('?')[0]!
    // External leases always re-resolve and pin the upstream address, so nothing bypasses the session check.
    const publicArtifact = !!res && !isExternal(lease.target) && (req.method === 'GET' || req.method === 'HEAD') &&
      /^\/applications\/[a-z][a-z0-9-]+\/[a-zA-Z0-9_-][a-zA-Z0-9_./-]*$/.test(path) &&
      !path.split('/').some(part => part === '.' || part === '..')
    if (this.closed || lease.expiresAt <= this.now()) return deny(401)
    let target: Target = lease.target
    if (!publicArtifact) {
      let user: string | null = null
      try { user = req.headers.cookie ? await this.deps.session(req.headers.cookie) : null } catch {}
      const current = user === lease.user ? await this.authorized(lease) : null
      if (!current) return deny(401)
      target = current
    }
    if (this.closed || lease.expiresAt <= this.now()) return deny(401)
    if (res?.destroyed || socket?.destroyed) return
    lease.expiresAt = this.now() + IDLE_MS
    if (res && lease.inject === 'make-inspector' && this.deps.inspectorScript && (req.method === 'GET' || req.method === 'HEAD') && (req.url ?? '').split('?')[0] === INSPECTOR_SCRIPT_PATH) {
      // The injected tag points at the lease origin; answer it here instead of asking the stand, whose Core may predate the route.
      let script: { statusCode: number; headers: Record<string, string>; body: Buffer }
      try { script = await this.deps.inspectorScript(req.headers.cookie ?? '') } catch { return deny(502) }
      if (res.destroyed) return
      res.writeHead(script.statusCode, { ...script.headers, 'content-length': String(script.body.length) })
      res.end(req.method === 'HEAD' ? undefined : script.body)
      return
    }
    if (res && lease.inject === 'make-inspector' && path === PREVIEW_INSPECTOR_SCRIPT_PATH && (req.method === 'GET' || req.method === 'HEAD')) {
      if (!this.deps.previewInspectorScript) return deny(502)
      let script: { statusCode: number; headers: Record<string, string>; body: Buffer }
      try { script = await this.deps.previewInspectorScript(lease.parentOrigin, req.headers.cookie ?? '') } catch { return deny(502) }
      if (script.statusCode < 200 || script.statusCode >= 300) return deny(502)
      if (res.destroyed) return
      res.writeHead(script.statusCode, { ...script.headers, 'cache-control': 'no-store', 'content-length': String(script.body.length) })
      res.end(req.method === 'HEAD' ? undefined : script.body)
      return
    }
    const touch = () => { lease.expiresAt = this.now() + IDLE_MS }
    let upstream: ClientRequest
    let tunnel: Duplex | undefined
    let responseHeaders: (headers: IncomingHttpHeaders) => IncomingHttpHeaders
    if (isExternal(target)) {
      const external = target
      const url = new URL(external.origin)
      const options = {
        hostname: url.hostname.replace(/^\[|\]$/g, ''), port: url.port || undefined, method: req.method, path: req.url, agent: false as const,
        headers: externalStandHeaders(req.headers, lease.key, lease.origin, external.origin),
        // Connect only to the address the SSRF guard validated for this request (no DNS rebinding).
        lookup: ((_host: string, opts: { all?: boolean }, cb: (...args: unknown[]) => void) => opts?.all
          ? cb(null, [{ address: external.address, family: external.family }]) : cb(null, external.address, external.family)) as unknown as LookupFunction
      }
      upstream = url.protocol === 'https:' ? httpsRequest({ ...options, ...(isIP(options.hostname) ? {} : { servername: options.hostname }) }) : request(options)
      upstream.once('socket', s => { tunnel = s; lease.sockets.add(s); s.once('close', () => lease.sockets.delete(s)); s.on('data', touch) })
      responseHeaders = headers => externalStandResponseHeaders(headers, lease.key, lease.parentOrigin, lease.origin, external.origin)
    } else {
      const machine = target
      try { tunnel = this.deps.connect(machine.machineId, machine.gatewayPort) } catch { return deny(502) }
      const pipe = tunnel
      lease.sockets.add(pipe); pipe.once('close', () => lease.sockets.delete(pipe))
      const requestHeaders = publicArtifact ? { ...req.headers, cookie: undefined } : req.headers
      upstream = request({ hostname: '127.0.0.1', port: machine.gatewayPort, method: req.method, path: req.url, headers: standHeaders(requestHeaders, lease.key, lease.origin, machine.gatewayPort), createConnection: () => pipe })
      pipe.on('data', touch)
      responseHeaders = headers => {
        const result = standFrameHeaders(headers, lease.parentOrigin, lease.origin)
        if (result['set-cookie']) result['set-cookie'] = standCookies(result['set-cookie'], lease.key)
        return result
      }
    }
    const destroyTunnel = () => { tunnel?.destroy(); upstream.destroy() }
    req.on('data', touch)
    upstream.on('error', () => { destroyTunnel(); if (res && !res.headersSent) deny(502); else { res?.destroy(); socket?.destroy() } })
    upstream.on('response', response => {
      const tunnel = { destroy: destroyTunnel }
      response.on('error', () => { res?.destroy(); socket?.destroy(); tunnel.destroy() })
      const headers = responseHeaders(response.headers)
      if (res) {
        res.on('close', () => { response.destroy(); tunnel.destroy() })
        const scriptUrl = lease.origin + INSPECTOR_SCRIPT_PATH
        if (lease.inject === 'make-inspector' && req.method !== 'HEAD' && response.statusCode !== 204 && response.statusCode !== 304 && scriptUrl && canInjectInspector(headers, scriptUrl)) {
          void (async () => {
            const chunks: Buffer[] = []
            for await (const chunk of response) chunks.push(Buffer.from(chunk))
            const original = Buffer.concat(chunks)
            const rewritten = await injectInspectorHtml(original, headers, scriptUrl, [lease.origin + PREVIEW_INSPECTOR_SCRIPT_PATH])
            if (res.destroyed) return
            if (rewritten) {
              headers['content-length'] = String(rewritten.length)
              delete headers['transfer-encoding']
              delete headers['content-encoding']
              delete headers.etag
              delete headers['content-md5']
              delete headers.digest
            }
            res.writeHead(response.statusCode ?? 502, headers)
            res.end(rewritten ?? original)
          })().catch(() => { res.destroy(); tunnel.destroy() })
        } else { res.writeHead(response.statusCode ?? 502, headers); response.pipe(res) }
      }
      else { response.destroy(); socket?.destroy(); tunnel.destroy() }
    })
    upstream.on('upgrade', (response, remote, remoteHead) => {
      if (!socket) { remote.destroy(); return }
      const headers = responseHeaders(response.headers)
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
  /** Current target of the lease for this request, or null when access was revoked or the target moved. */
  private async authorized(lease: Lease): Promise<Target | null> {
    if (!isUserStandId(lease.standId)) return await this.deps.member(lease.user, lease.projectId) ? lease.target : null
    try {
      const target = await this.deps.userStand!(lease.user, lease.standId)
      return sameTarget(target, lease.target) ? target : null
    } catch { return null }
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
