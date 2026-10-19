import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { TICKET_DELEGATION_PREFIX, isTicketDelegationToken, type ApplicationId, type EnterTicketDelegation, type LlmBillingSession } from '@voicechat/shared'

/** Lifetime of a shared-service session opened by a redeemed ticket; its delegation never outlives it. */
export const SHARED_SESSION_TTL_MS = 8 * 60 * 60_000

export interface TicketDelegationGrant {
  grantId: string
  userId: string
  tenantId: string | null
  applicationId: ApplicationId
  coreId: string
  /** Core session the ticket was issued from; revoking it revokes the delegation. */
  sid: string | null
  /** Billing admission runs as the user's own session, attributed to the application. */
  billingSession?: LlmBillingSession
  issuedAt: number
  expiresAt: number
}

const digest = (token: string) => createHash('sha256').update(token).digest('hex')

/**
 * Core-issued delegations for external applications. Only token hashes are kept, in memory: a restart revokes them
 * and the service re-enters through a fresh ticket.
 */
export class TicketDelegations {
  private entries = new Map<string, TicketDelegationGrant>()
  constructor(private readonly now = Date.now) {}
  issue(grant: Omit<TicketDelegationGrant, 'grantId' | 'issuedAt'>): EnterTicketDelegation {
    this.prune()
    if (this.entries.size >= 10000) throw Object.assign(new Error('delegation_capacity'), { statusCode: 503 })
    const token = TICKET_DELEGATION_PREFIX + randomBytes(32).toString('base64url')
    this.entries.set(digest(token), { ...structuredClone(grant), grantId: 'ticket:' + randomUUID(), issuedAt: this.now() })
    return { token, expiresAt: grant.expiresAt }
  }
  lookup(token: string): TicketDelegationGrant | undefined {
    if (!isTicketDelegationToken(token)) return undefined
    const entry = this.entries.get(digest(token))
    return entry && entry.expiresAt > this.now() ? structuredClone(entry) : undefined
  }
  revoke(match: { applicationId?: ApplicationId; userId?: string; sid?: string }): void {
    for (const [key, entry] of this.entries) {
      if ((match.applicationId === undefined || entry.applicationId === match.applicationId)
        && (match.userId === undefined || entry.userId === match.userId)
        && (match.sid === undefined || entry.sid === match.sid)) this.entries.delete(key)
    }
  }
  private prune() { for (const [key, entry] of this.entries) if (entry.expiresAt <= this.now()) this.entries.delete(key) }
}
