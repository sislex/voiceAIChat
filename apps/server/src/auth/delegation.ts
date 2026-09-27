import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { isDelegationIntrospection, permitsDelegatedAction, type DelegationIntrospectionClient, type DelegatedPrincipal, type DelegationScope } from '@sislexa/identity/contracts/index'
import type { ChatDelegationReference, ChatApplicationAttribution } from '@voicechat/shared'
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
  private credentials = new Map<string, { token: string; principal: DelegatedPrincipal }>()
  constructor(private client: DelegationIntrospectionClient, private db: VoiceChatDb, private now = Date.now) {}
  async bind(token: string, userId: string, tenantId: string | undefined): Promise<ChatDelegationReference> {
    for (const [id, entry] of this.credentials) if (entry.principal.expiresAt <= this.now()) this.credentials.delete(id)
    const principal = await this.verify(token)
    if (principal.userId !== userId || principal.tenantId !== tenantId) throw new DelegationDenied()
    const reference = { id: randomUUID(), userId, tenantId: principal.tenantId, applicationId: principal.applicationId, grantId: principal.grantId }
    this.credentials.set(reference.id, { token, principal })
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
    if (!stored) throw new DelegationDenied()
    const principal = await this.verify(stored.token)
    if (principal.userId !== reference.userId || principal.tenantId !== reference.tenantId
      || principal.applicationId !== reference.applicationId || principal.grantId !== reference.grantId) throw new DelegationDenied()
    return principal
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
      projectId ??= conversation.projectId ?? undefined
    }
    if (projectId) {
      const tenant = await this.db.projects.projectTenant(projectId)
      if (tenant?.id !== reference.tenantId || !permitsDelegatedAction({ version: 1, active: true, principal }, 'core',
        { tenantId: reference.tenantId, type: 'project', id: projectId }, scope, this.now())) throw new DelegationDenied()
    }
  }
}

/** User authentication remains mandatory; a grant can narrow but never replace it. */
export function registerChatDelegation(app: FastifyInstance, authority?: ChatDelegation): void {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return
    if (/^\/api\/(conversations|chat)(?:\/|$)/.test(req.url.split('?')[0]!) && (rejectsAttribution(req.body) || rejectsAttribution(req.query))) return reply.code(400).send({ error: 'untrusted_attribution' })
    const token = req.headers[DELEGATION_HEADER]
    if (typeof token === 'undefined') return
    if (!authority || typeof token !== 'string' || !req.user) return reply.code(403).send({ error: 'delegation_denied' })
    const reference = await authority.bind(token, req.user.name, req.user.account?.tenantId)
    try {
      const path = req.url.split('?')[0]!
      const conversationId = /^\/api\/conversations\/([^/]+)(?:\/|$)/.exec(path)?.[1]
      // Other APIs need a resource-specific adapter before applications may call them.
      if (!conversationId || !/^\/api\/conversations\/[^/]+(?:\/(?:settings|messages(?:\/[^/]+)?|status))?$/.test(path)) throw new DelegationDenied()
      const scope = ['GET', 'HEAD'].includes(req.method) ? 'read' : 'write'
      await authority.authorize(reference, scope, decodeURIComponent(conversationId))
      const body = req.body as { projectId?: unknown; values?: { projectId?: unknown } } | undefined
      const target = body?.projectId ?? body?.values?.projectId
      if (typeof target === 'string') await authority.authorize(reference, 'write', undefined, target)
    } finally { authority.release(reference) }
  })
}
