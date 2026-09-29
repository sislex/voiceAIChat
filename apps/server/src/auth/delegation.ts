import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { isDelegationIntrospection, permitsDelegatedAction, type DelegationIntrospectionClient, type DelegatedPrincipal, type DelegationScope } from '@sislexa/identity/contracts/index'
import { createVerifiedChatApplicationContext, type ChatConnectionSnapshot, type ChatPermission, type SessionUser, type ChatDelegationReference, type ChatApplicationAttribution } from '@voicechat/shared'
import { accountContext } from '@sislexa/identity/server/users/productPolicy'
import type { VoiceChatDb } from '../db/database.js'

export const DELEGATION_HEADER = 'x-sislexa-delegation'
export class DelegationDenied extends Error {
  readonly statusCode = 403
  constructor() { super('delegation_denied') }
}
const reserved = new Set(['principal', 'application', 'applicationId', 'originApplicationId', 'executorApplicationId', 'delegation', 'delegationId', 'grantId', 'chatContext'])
export function rejectsAttribution(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, item]) => reserved.has(key) || rejectsAttribution(item))
}

/** Tokens stay in memory. Persisted queue references fail closed after a restart. */
export class ChatDelegation {
  private credentials = new Map<string, { token: string; principal: DelegatedPrincipal; billingUserId: string }>()
  constructor(private client: DelegationIntrospectionClient, private db: VoiceChatDb, private now = Date.now,
    private environmentId = 'legacy') {}
  /** Resolve the live subject through Identity, never through caller attribution. */
  async user(token: string): Promise<SessionUser> {
    return this.account(await this.verify(token))
  }
  private async account(principal: DelegatedPrincipal): Promise<SessionUser> {
    const row = await this.db.identity.getUser(principal.userId)
    const access = await this.db.identity.getAccountAccess(principal.userId, principal.tenantId)
    if (!row || row.blocked || row.mustChangePassword || !access || access.tenant.id !== principal.tenantId) throw new DelegationDenied()
    return { name: principal.userId, role: access.systemRole, account: accountContext(access) }
  }
  async snapshot(reference: ChatDelegationReference, conversationId: string, executionAvailable = false): Promise<ChatConnectionSnapshot> {
    await this.authorize(reference, 'read', conversationId)
    const principal = await this.current(reference)
    const permissions: ChatPermission[] = ['chat:conversations:read', 'chat:settings:read']
    try { await this.authorize(reference, 'execute', conversationId); permissions.push('chat:turns:run') } catch { /* Not granted. */ }
    try { await this.authorize(reference, 'write', conversationId); permissions.push('chat:turns:cancel') } catch { /* Not granted. */ }
    await this.authorize(reference, 'read', conversationId)
    return {
      version: 1, connectionId: reference.id, cursor: randomUUID(),
      context: createVerifiedChatApplicationContext({ version: 1, application: this.attribution(reference),
        principal: { identityIssuer: 'identity', userId: reference.userId, tenantId: reference.tenantId, environmentId: this.environmentId },
        sessionId: reference.id, verifiedAt: this.now(), expiresAt: principal.expiresAt, permissions,
        capabilities: [{ id: 'chat.text', available: executionAvailable && permissions.includes('chat:turns:run'),
          ...(!executionAvailable ? { reason: 'host-unsupported' as const }
            : !permissions.includes('chat:turns:run') ? { reason: 'not-granted' as const } : {}) },
          ...(['chat.attachments', 'chat.tools', 'chat.voice.input', 'chat.voice.output'] as const)
            .map(id => ({ id, available: false, reason: 'host-unsupported' as const }))],
        resources: { kind: 'conversation-ids', conversationIds: [conversationId] }
      }, this.now()),
      settings: { version: 1, revision: 0, account: {}, conversation: {}, device: {} },
      reconnect: { status: 'resync-required', reason: 'initial-connect' }
    }
  }
  async bind(token: string, userId: string, tenantId: string | undefined): Promise<ChatDelegationReference> {
    for (const [id, entry] of this.credentials) if (entry.principal.expiresAt <= this.now()) this.credentials.delete(id)
    const principal = await this.verify(token)
    if (principal.userId !== userId || principal.tenantId !== tenantId) throw new DelegationDenied()
    const reference = { id: randomUUID(), userId, tenantId: principal.tenantId, applicationId: principal.applicationId, grantId: principal.grantId }
    const user = await this.account(principal)
    if (!user.account?.userId || user.account.tenantId !== tenantId) throw new DelegationDenied()
    this.credentials.set(reference.id, { token, principal: { ...principal }, billingUserId: user.account.userId })
    return Object.freeze(reference)
  }
  release(reference: ChatDelegationReference): void { this.credentials.delete(reference.id) }
  private async verify(token: string): Promise<DelegatedPrincipal> {
    const verdict = await this.client.introspect({ token, audience: 'core' })
    const now = this.now()
    if (!isDelegationIntrospection(verdict) || !verdict.active || verdict.principal.audience !== 'core'
      || verdict.principal.issuedAt > now || verdict.principal.expiresAt <= now) throw new DelegationDenied()
    return verdict.principal
  }
  async current(reference: ChatDelegationReference): Promise<DelegatedPrincipal> {
    const stored = this.credentials.get(reference.id)
    if (!stored || stored.principal.userId !== reference.userId || stored.principal.tenantId !== reference.tenantId
      || stored.principal.applicationId !== reference.applicationId || stored.principal.grantId !== reference.grantId) throw new DelegationDenied()
    const principal = await this.verify(stored.token)
    if (principal.userId !== reference.userId || principal.tenantId !== reference.tenantId
      || principal.applicationId !== reference.applicationId || principal.grantId !== reference.grantId) throw new DelegationDenied()
    return principal
  }
  /** Admission-only credential; never include this result in a queue or outbox. */
  async billingAuthorization(reference: ChatDelegationReference, conversationId: string) {
    await this.authorize(reference, 'execute', conversationId)
    const stored = this.credentials.get(reference.id)
    if (!stored) throw new DelegationDenied()
    const user = await this.account(stored.principal)
    if (this.credentials.get(reference.id) !== stored || user.name !== reference.userId || user.account?.tenantId !== reference.tenantId
      || user.account.userId !== stored.billingUserId) throw new DelegationDenied()
    return { authorization: 'Bearer '+stored.token,
      principal: { userId: stored.billingUserId, tenantId: reference.tenantId, delegationId: reference.grantId } }
  }
  attribution(reference: ChatDelegationReference): ChatApplicationAttribution {
    return { version: 1, originApplicationId: reference.applicationId, executorApplicationId: 'core', tokenId: null, delegationId: reference.grantId }
  }
  async authorize(reference: ChatDelegationReference, scope: DelegationScope, conversationId?: string, projectId?: string): Promise<void> {
    const principal = await this.current(reference)
    if (!conversationId && !projectId) throw new DelegationDenied()
    if (conversationId) {
      const conversation = await this.db.chat.getConversation(reference.userId, conversationId)
      if (!conversation || conversation.tenantId !== reference.tenantId) throw new DelegationDenied()
      if (!permitsDelegatedAction({ version: 1, active: true, principal }, 'core',
        { tenantId: reference.tenantId, type: 'conversation', id: conversationId }, scope, this.now())) throw new DelegationDenied()
      if (scope === 'execute' && !permitsDelegatedAction({ version: 1, active: true, principal }, 'core',
        { tenantId: reference.tenantId, type: 'conversation', id: conversationId }, 'read', this.now())) throw new DelegationDenied()
      if (projectId && projectId !== conversation.projectId) throw new DelegationDenied()
      projectId = conversation.projectId ?? undefined
      // Project context is included in execution; its read permission is required too.
      if (projectId && scope === 'execute' && !permitsDelegatedAction({ version: 1, active: true, principal }, 'core',
        { tenantId: reference.tenantId, type: 'project', id: projectId }, 'read', this.now())) throw new DelegationDenied()
    }
    if (projectId) {
      const tenant = await this.db.projects.projectTenant(projectId)
      if (tenant?.id !== reference.tenantId || !permitsDelegatedAction({ version: 1, active: true, principal }, 'core',
        { tenantId: reference.tenantId, type: 'project', id: projectId }, scope, this.now())) throw new DelegationDenied()
    }
  }
}

/** Every delegated route must have an explicit resource adapter. */
export function registerChatDelegation(app: FastifyInstance, authority?: ChatDelegation, executionAvailable: () => boolean = () => false): void {
  app.get<{ Querystring: { conversationId?: string } }>('/api/chat/context', async (req, reply) => {
    reply.header('cache-control', 'no-store')
    const token = req.headers[DELEGATION_HEADER]
    if (!authority || typeof token !== 'string' || !req.user || !req.query.conversationId) throw new DelegationDenied()
    const reference = await authority.bind(token, req.user.name, req.user.account?.tenantId)
    try { return await authority.snapshot(reference, req.query.conversationId, executionAvailable()) }
    finally { authority.release(reference) }
  })
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return
    if (/^\/api\/(conversations|chat)(?:\/|$)/.test(req.url.split('?')[0]!) && (rejectsAttribution(req.body) || rejectsAttribution(req.query))) return reply.code(400).send({ error: 'untrusted_attribution' })
    const token = req.headers[DELEGATION_HEADER]
    if (typeof token === 'undefined') return
    if (!authority || typeof token !== 'string' || !req.user) return reply.code(403).send({ error: 'delegation_denied' })
    const reference = await authority.bind(token, req.user.name, req.user.account?.tenantId)
    try {
      const path = req.url.split('?')[0]!
      if (path === '/api/chat/context' && req.method === 'GET' || path === '/api/chat/session' && req.method === 'POST') return
      const conversationId = /^\/api\/conversations\/([^/]+)(?:\/|$)/.exec(path)?.[1]
      // Other APIs need a resource-specific adapter before applications may call them.
      if (!conversationId || !/^\/api\/conversations\/[^/]+(?:\/(?:messages(?:\/[^/]+)?|status|settings))?$/.test(path)
        || !['GET', 'HEAD'].includes(req.method)) throw new DelegationDenied()
      await authority.authorize(reference, 'read', decodeURIComponent(conversationId))
    } finally { authority.release(reference) }
  })
}
