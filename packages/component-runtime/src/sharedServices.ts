import { readFileSync, lstatSync } from 'node:fs'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { resolve, sep } from 'node:path'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { isEnterTicketRedeemResponse, validateCoreId, type ClientMessage, type ServerMessage, type TrustedCoreEntry, type CoreUsage, type CoreLimits, type SharedServiceSession, type EnterTicketRedeemRequest,
  type CoreMcpTokenClaims, CORE_MCP_TOKEN_PREFIX, CORE_ID_HEADER, DELEGATION_HEADER_NAME, isApplicationId, isTicketDelegationToken } from '@voicechat/shared'

export class CoreServiceError extends Error {
  constructor(readonly code: string, readonly statusCode = 502) { super(code) }
}
export class CoreLimitExceeded extends CoreServiceError {
  constructor(readonly limit: keyof CoreLimits, readonly used: number) { super('core_limit_exceeded', 409) }
}
/** Install in a service's encapsulated scope so quota failures retain their wire contract. */
export function registerCoreServiceErrors(app: FastifyInstance): void {
  app.setErrorHandler((error: Error, _request, reply: FastifyReply) => {
    if (error instanceof CoreServiceError) return reply.code(error.statusCode).send({ error: error.code,
      ...(error instanceof CoreLimitExceeded ? { limit: error.limit, used: error.used } : {}) })
    return reply.send(error)
  })
}
export class TrustedCoreRegistry {
  #entries = new Map<string, TrustedCoreEntry>()
  #usage = new Map<string, CoreUsage>()
  constructor(private readonly credential: (ref: string) => string = ref => readFileSync(ref, 'utf8').trim(), private readonly transport: typeof fetch = fetch) {}
  static fromFile(path: string): TrustedCoreRegistry {
    const registry = new TrustedCoreRegistry()
    const entries: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(entries)) throw new Error('invalid_core_registry')
    for (const entry of entries) registry.add(entry)
    return registry
  }
  static fromEnv(env: NodeJS.ProcessEnv = process.env): TrustedCoreRegistry {
    const token = env.VC_INTERNAL_TOKEN
    // Only these variables may back the single-core default; any other ref is refused.
    const allowed = new Set(['VC_INTERNAL_TOKEN', 'VC_CORE_SERVICE_TOKEN', 'VC_CORE_MCP_SECRET'])
    const registry = new TrustedCoreRegistry(ref => {
      const name = ref.startsWith('env:') ? ref.slice(4) : ''
      const value = allowed.has(name) ? env[name] : undefined
      if (!value) throw new Error('credential_unavailable')
      return value
    })
    if (env.VC_CORE_URL && token) registry.add({ coreId: env.VC_CORE_ID ?? new URL(env.VC_CORE_URL).hostname, url: env.VC_CORE_URL, credentialRef: 'env:VC_INTERNAL_TOKEN',
      ...(env.VC_CORE_SERVICE_TOKEN ? { serviceCredentialRef: 'env:VC_CORE_SERVICE_TOKEN' } : {}),
      ...(env.VC_CORE_MCP_SECRET ? { mcpSecretRef: 'env:VC_CORE_MCP_SECRET' } : {}) })
    return registry
  }
  add(entry: TrustedCoreEntry): void {
    validateCoreId(entry.coreId)
    const url = new URL(entry.url)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !entry.credentialRef
      || [entry.serviceCredentialRef, entry.mcpSecretRef].some(ref => ref !== undefined && (typeof ref !== 'string' || !ref))) throw new Error('invalid_core_registry')
    for (const [key, value] of Object.entries(entry.limits ?? {})) if (!['diskBytes', 'workshops', 'machines'].includes(key) || !Number.isSafeInteger(value) || value < 0) throw new Error('invalid_core_limits')
    this.#entries.set(entry.coreId, structuredClone({ ...entry, url: url.origin }))
  }
  remove(coreId: string): void { this.#entries.delete(coreId) }
  resolve(session: Pick<SharedServiceSession, 'coreId'>): Omit<TrustedCoreEntry, 'credentialRef'> {
    const entry = this.#entries.get(validateCoreId(session.coreId))
    if (!entry) throw new CoreServiceError('core_unknown', 404)
    const { credentialRef: _, serviceCredentialRef: _service, mcpSecretRef: _mcp, ...publicEntry } = entry
    return structuredClone(publicEntry)
  }
  usage(coreId: string): CoreUsage { this.resolve({ coreId }); return { ...(this.#usage.get(coreId) ?? { coreId, diskBytes: 0, workshops: 0, machines: 0 }) } }
  account(coreId: string, delta: CoreLimits): CoreUsage {
    const entry = this.resolve({ coreId })
    const next = this.usage(coreId)
    for (const key of ['diskBytes', 'workshops', 'machines'] as const) {
      const amount = delta[key] ?? 0
      if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(next[key] + amount) || next[key] + amount < 0) throw new Error('invalid_core_usage')
      next[key] += amount
      if (entry.limits?.[key] !== undefined && next[key] > entry.limits[key]!) throw new CoreLimitExceeded(key, next[key])
    }
    this.#usage.set(coreId, next)
    return { ...next }
  }
  async request(session: Pick<SharedServiceSession, 'coreId'>, path: string, init: RequestInit = {}, timeoutMs = 5000, serviceCredential = true): Promise<Response> {
    const core = this.resolve(session)
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw new Error('invalid_core_path')
    const url = new URL(path, core.url)
    if (url.origin !== core.url) throw new Error('invalid_core_path')
    const headers = new Headers(init.headers)
    try {
      if (serviceCredential) headers.set('authorization', `Bearer ${this.credential(this.#entries.get(session.coreId)!.credentialRef)}`)
      return await this.transport(url, { ...init, headers, redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(init.signal ? [init.signal] : [])]) })
    } catch { throw new CoreServiceError('core_unavailable', 503) }
  }
  async redeem(coreId: string, request: EnterTicketRedeemRequest, timeoutMs = 5000): Promise<SharedServiceSession> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response
      try { response = await this.request({ coreId }, '/internal/v1/tickets/redeem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }, timeoutMs) }
      catch (error) { if (attempt === 0 && error instanceof CoreServiceError && error.code === 'core_unavailable') continue; throw error }
      if (response.status >= 500 && attempt === 0) continue
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new CoreServiceError(['ticket_invalid', 'ticket_used', 'application_disabled', 'core_unknown'].includes(body.error ?? '') ? body.error! : 'ticket_invalid', response.status)
      }
      const body: unknown = await response.json().catch(() => null)
      if (!isEnterTicketRedeemResponse(body)) throw new CoreServiceError('ticket_invalid', 401)
      return { user: body.user, tenantId: body.tenantId, capabilities: body.capabilities, expiresAt: body.expiresAt,
        delegation: { token: body.delegation.token, expiresAt: body.delegation.expiresAt }, coreId }
    }
    throw new CoreServiceError('core_unavailable', 503)
  }
  /**
   * Authenticate a core's call into the service: `x-sislexa-core-id` names a registered core and the bearer must be
   * that core's service credential. A `x-sislexa-delegation` header is passed through for user-scoped methods.
   */
  authenticate(headers: Record<string, string | string[] | undefined>): { coreId: string; delegation?: string } {
    const coreId = headers[CORE_ID_HEADER]
    const authorization = headers.authorization
    if (typeof coreId !== 'string' || typeof authorization !== 'string') throw new CoreServiceError('unauthorized', 401)
    let entry: TrustedCoreEntry | undefined
    try { entry = this.#entries.get(validateCoreId(coreId)) } catch { throw new CoreServiceError('unauthorized', 401) }
    if (!entry?.serviceCredentialRef) throw new CoreServiceError('unauthorized', 401)
    let expected: string
    try { expected = `Bearer ${this.credential(entry.serviceCredentialRef)}` } catch { throw new CoreServiceError('unauthorized', 401) }
    if (!sameSecret(authorization, expected)) throw new CoreServiceError('unauthorized', 401)
    const delegation = headers[DELEGATION_HEADER_NAME]
    if (delegation !== undefined && !isTicketDelegationToken(delegation)) throw new CoreServiceError('unauthorized', 401)
    return { coreId: entry.coreId, ...(delegation ? { delegation } : {}) }
  }
  /** Verify a core-issued MCP token against the MCP secret registered for its core. */
  verifyMcpToken(token: string, now = Date.now()): CoreMcpTokenClaims {
    const claims = decodeCoreMcpToken(token)
    const entry = claims && this.#entries.get(claims.coreId)
    if (!claims || !entry?.mcpSecretRef) throw new CoreServiceError('mcp_token_invalid', 401)
    let secret: string
    try { secret = this.credential(entry.mcpSecretRef) } catch { throw new CoreServiceError('mcp_token_invalid', 401) }
    if (!sameSecret(token, signCoreMcpToken(secret, claims)) || claims.expiresAt <= now) throw new CoreServiceError('mcp_token_invalid', 401)
    return claims
  }
  registerUsageRoute(app: FastifyInstance, authorize: (authorization: string | undefined) => boolean): void {
    app.get<{ Params: { coreId: string } }>('/internal/v1/cores/:coreId/usage', async (req, reply) => {
      if (!authorize(req.headers.authorization)) return reply.code(401).send({ error: 'unauthorized' })
      try { return this.usage(req.params.coreId) } catch { return reply.code(404).send({ error: 'core_unknown' }) }
    })
  }
}

/** Resolve existing ancestors too: lexical containment alone does not stop symlink escapes. */
export function coreDataPath(root: string, coreId: string, ...parts: string[]): string {
  validateCoreId(coreId)
  if (parts.some(p => !p || p === '.' || p === '..' || /[\\/\0]/.test(p))) throw new Error('invalid_data_path')
  const base = resolve(root)
  const path = resolve(base, coreId, ...parts)
  for (const part of [base, ...path.slice(base.length + 1).split(sep).map((_, i, list) => resolve(base, ...list.slice(0, i + 1)))]) {
    try { if (lstatSync(part).isSymbolicLink()) throw new Error('invalid_data_path') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return path
}

/**
 * Without an explicit grant the client uses the Core-issued delegation from the redeemed ticket; Core accepts it only
 * next to this service's own credential. An explicit Identity grant keeps the user-only path of Core ChatDelegation.
 */
export class CoreDelegationClient {
  constructor(private readonly registry: TrustedCoreRegistry, private readonly session: SharedServiceSession, private readonly grant?: string) {}
  request(path: string, init: RequestInit = {}): Promise<Response> {
    const expiresAt = this.grant === undefined ? Math.min(this.session.expiresAt, this.session.delegation?.expiresAt ?? 0) : this.session.expiresAt
    if (expiresAt <= Date.now()) throw new CoreServiceError('session_expired', 401)
    const headers = new Headers(init.headers)
    headers.set('x-sislexa-delegation', this.grant ?? this.session.delegation.token)
    if (this.session.tenantId) headers.set('x-sislexa-tenant-id', this.session.tenantId)
    return this.registry.request(this.session, path, { ...init, headers }, 5000, this.grant === undefined)
  }
  chatSession(conversationId: string): Promise<Response> { return this.request('/api/chat/session?conversationId=' + encodeURIComponent(conversationId), { method: 'POST' }) }

  /** Core owns execution and Billing admission; usage and notifications return on its existing WS contract. */
  async connect(conversationId: string, handlers: {
    notification: (message: ServerMessage) => void
    billing?: (message: Extract<ServerMessage, { t: 'claude.usage' }>) => void
  }, socketFactory: (url: string) => WebSocket = url => new WebSocket(url)): Promise<{
    turn: (message: Extract<ClientMessage, { t: 'claude.send' }>) => void
    cancel: () => void
    close: () => void
  }> {
    const response = await this.chatSession(conversationId)
    if (!response.ok) throw new CoreServiceError('delegation_denied', response.status)
    const exchange = await response.json() as { socketUrl?: string; expiresAt?: number }
    const core = this.registry.resolve(this.session)
    if (!exchange.socketUrl?.startsWith('/ws?session=') || !exchange.expiresAt || exchange.expiresAt <= Date.now()) throw new CoreServiceError('delegation_denied', 403)
    const url = new URL(exchange.socketUrl, core.url)
    if (url.origin !== core.url || url.pathname !== '/ws') throw new CoreServiceError('delegation_denied', 403)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = socketFactory(url.href)
    await new Promise<void>((resolveOpen, reject) => {
      const timeout = setTimeout(() => { socket.close(); reject(new CoreServiceError('core_unavailable', 503)) }, 5000)
      socket.addEventListener('open', () => { clearTimeout(timeout); resolveOpen() }, { once: true })
      socket.addEventListener('error', () => { clearTimeout(timeout); reject(new CoreServiceError('core_unavailable', 503)) }, { once: true })
    })
    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string') return
      let message: ServerMessage
      try { message = JSON.parse(event.data) as ServerMessage } catch { return }
      if (!message || typeof message.t !== 'string') return
      if ('conversationId' in message && message.conversationId !== conversationId) return
      if (message.t === 'claude.usage') handlers.billing?.(message)
      handlers.notification(message)
    })
    const send = (message: ClientMessage) => {
      this.registry.resolve(this.session)
      if (this.session.expiresAt <= Date.now() || exchange.expiresAt! <= Date.now()
        || this.grant === undefined && this.session.delegation.expiresAt <= Date.now()) { socket.close(); throw new CoreServiceError('session_expired', 401) }
      socket.send(JSON.stringify(message))
    }
    send({ t: 'chat.connect', v: 1, conversationId })
    return {
      turn: message => {
        if (message.conversationId !== conversationId || message.attachments?.length || message.assistantContext) throw new CoreServiceError('delegation_denied', 403)
        send(message)
      },
      cancel: () => send({ t: 'claude.cancel', conversationId }),
      close: () => socket.close(),
    }
  }
}

const sameSecret = (actual: string, expected: string): boolean => {
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
/** Sign MCP claims for one turn; the core keeps the secret, the service verifies with `verifyCoreMcpToken`. */
export function signCoreMcpToken(secret: string, claims: CoreMcpTokenClaims): string {
  if (!secret) throw new Error('mcp_secret_required')
  const payload = Buffer.from(JSON.stringify({ v: 1, coreId: claims.coreId, application: claims.application, userId: claims.userId,
    conversationId: claims.conversationId, ...(claims.turnId ? { turnId: claims.turnId } : {}), expiresAt: claims.expiresAt })).toString('base64url')
  const body = CORE_MCP_TOKEN_PREFIX + payload
  return body + '.' + createHmac('sha256', secret).update(body).digest('base64url')
}
function decodeCoreMcpToken(token: unknown): CoreMcpTokenClaims | undefined {
  if (typeof token !== 'string' || token.length > 4096 || !token.startsWith(CORE_MCP_TOKEN_PREFIX)) return undefined
  const parts = token.slice(CORE_MCP_TOKEN_PREFIX.length).split('.')
  if (parts.length !== 2) return undefined
  try {
    const c = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')) as Partial<CoreMcpTokenClaims>
    if (c.v !== 1 || typeof c.coreId !== 'string' || !isApplicationId(c.application) || typeof c.userId !== 'string' || !c.userId
      || typeof c.conversationId !== 'string' || !c.conversationId || (c.turnId !== undefined && typeof c.turnId !== 'string')
      || !Number.isSafeInteger(c.expiresAt)) return undefined
    validateCoreId(c.coreId)
    return c as CoreMcpTokenClaims
  } catch { return undefined }
}
/** Resolve the calling core of a Core→service request (`authorization` + `x-sislexa-core-id`). */
export function authenticateCoreRequest(registry: TrustedCoreRegistry, req: { headers: Record<string, string | string[] | undefined> }): { coreId: string; delegation?: string } {
  return registry.authenticate(req.headers)
}
/** Verify a core-issued MCP token: returns its core, user, conversation and application, or throws `mcp_token_invalid`. */
export function verifyCoreMcpToken(registry: TrustedCoreRegistry, token: string, now = Date.now()): CoreMcpTokenClaims {
  return registry.verifyMcpToken(token, now)
}
