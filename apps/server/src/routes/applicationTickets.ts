import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { APPLICATION_IDS, isApplicationId, parseApplications, validateCoreId, type ApplicationId, type DeploymentManifest, type EnterTicketRedeemResponse, type LlmBillingSession, type SessionUser } from '@voicechat/shared'
import { SHARED_SESSION_TTL_MS, TicketDelegations } from '../auth/ticketDelegation.js'

const hash = (value: string) => createHash('sha256').update(value).digest()
/** Session context captured when the ticket is issued; the redeemed delegation inherits it. */
export interface TicketIssuer { sid: string | null; billingSession?: LlmBillingSession }
type TicketEntry = { coreId: string; application: ApplicationId; user: SessionUser; issuer: TicketIssuer; expiresAt: number; used: boolean }
export class ApplicationTickets {
  private entries = new Map<string, TicketEntry>()
  constructor(private readonly now = Date.now, readonly delegations = new TicketDelegations(now)) {}
  issue(coreId: string, application: ApplicationId, user: SessionUser, issuer: TicketIssuer = { sid: null }): string {
    validateCoreId(coreId)
    for (const [key, entry] of this.entries) if (entry.expiresAt <= this.now()) this.entries.delete(key)
    if (this.entries.size >= 10000) throw Object.assign(new Error('ticket_capacity'), { statusCode: 503 })
    const ticket = randomBytes(32).toString('base64url')
    this.entries.set(hash(ticket).toString('hex'), { coreId, application, user: structuredClone(user), issuer: structuredClone(issuer), expiresAt: this.now() + 60_000, used: false })
    return ticket
  }
  redeem(coreId: string, application: ApplicationId, ticket: string): EnterTicketRedeemResponse {
    const entry = this.entries.get(hash(ticket).toString('hex'))
    if (!entry || entry.coreId !== coreId || entry.application !== application || entry.expiresAt <= this.now()) throw new Error('ticket_invalid')
    if (entry.used) throw new Error('ticket_used')
    entry.used = true
    const tenantId = entry.user.account?.tenantId ?? null
    const expiresAt = this.now() + SHARED_SESSION_TTL_MS
    const delegation = this.delegations.issue({ userId: entry.user.name, tenantId, applicationId: application, coreId, sid: entry.issuer.sid,
      ...(entry.issuer.billingSession ? { billingSession: entry.issuer.billingSession } : {}), expiresAt })
    return { user: structuredClone(entry.user), tenantId, capabilities: [...(entry.user.account?.capabilities ?? [])], expiresAt, delegation }
  }
}
export interface ApplicationTicketOptions {
  manifest: DeploymentManifest
  /** Per-service credentials; never use the common internal token here. */
  credentials: Partial<Record<ApplicationId, string>>
  /** Core→service bearer for external applications (`VC_APPLICATION_<ID>_SERVICE_TOKEN`). */
  serviceTokens?: Partial<Record<ApplicationId, string>>
  /** HMAC key of per-turn MCP tokens for external applications (`VC_APPLICATION_<ID>_MCP_SECRET`). */
  mcpSecrets?: Partial<Record<ApplicationId, string>>
  tickets?: ApplicationTickets
  /** Resolves the issuing user session (sid, billing reference) for the delegation bound to the ticket. */
  issuer?: (req: FastifyRequest) => TicketIssuer
}
export function applicationTicketOptions(env: NodeJS.ProcessEnv, publicUrl: string | null): ApplicationTicketOptions {
  return { manifest: { coreId: validateCoreId(env.VC_CORE_ID ?? new URL(publicUrl ?? 'http://localhost').hostname), applications: parseApplications(env.VC_APPLICATIONS) },
    credentials: applicationEnv(env, 'TOKEN'), serviceTokens: applicationEnv(env, 'SERVICE_TOKEN'), mcpSecrets: applicationEnv(env, 'MCP_SECRET') }
}
const applicationEnv = (env: NodeJS.ProcessEnv, suffix: string): Partial<Record<ApplicationId, string>> =>
  Object.fromEntries(APPLICATION_IDS.map(id => [id, env[`VC_APPLICATION_${id.replaceAll('-', '_').toUpperCase()}_${suffix}`] || undefined]))
export function registerApplicationTickets(app: FastifyInstance, options: ApplicationTicketOptions): void {
  const tickets = options.tickets ?? new ApplicationTickets()
  validateCoreId(options.manifest.coreId)
  app.post<{ Params: { id: string } }>('/api/applications/:id/enter', async (req, reply) => {
    reply.header('cache-control', 'no-store')
    if (!req.user || req.headers['x-sislexa-delegation']) return reply.code(401).send({ error: 'user_session_required' })
    const application = options.manifest.applications.find(a => a.id === req.params.id && a.enabled)
    if (!application) return reply.code(404).send({ error: 'application_disabled' })
    if (application.location !== 'external' || !application.url || !options.credentials[application.id]) return reply.code(409).send({ error: 'application_not_external' })
    const url = new URL('/_sislexa/enter', application.url)
    url.searchParams.set('core', options.manifest.coreId)
    url.searchParams.set('ticket', tickets.issue(options.manifest.coreId, application.id, req.user, options.issuer?.(req)))
    return { url: url.href }
  })
  app.post<{ Body: { ticket?: unknown; application?: unknown } }>('/internal/v1/tickets/redeem', { bodyLimit: 4096 }, async (req, reply) => {
    reply.header('cache-control', 'no-store')
    const { ticket, application } = req.body ?? {}
    if (!isApplicationId(application) || typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) return reply.code(400).send({ error: 'ticket_invalid' })
    const credential = options.credentials[application]
    if (!credential || !timingSafeEqual(hash(req.headers.authorization ?? ''), hash(`Bearer ${credential}`))) return reply.code(401).send({ error: 'unauthorized' })
    if (!options.manifest.applications.some(a => a.id === application && a.enabled)) return reply.code(404).send({ error: 'application_disabled' })
    try { return tickets.redeem(options.manifest.coreId, application, ticket) }
    catch (error) { return reply.code(401).send({ error: error instanceof Error && error.message === 'ticket_used' ? 'ticket_used' : 'ticket_invalid' }) }
  })
}
