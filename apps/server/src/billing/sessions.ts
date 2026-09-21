import type { LlmBillingSession, SessionUser } from '@voicechat/shared'

/** Reconnect may restore the same session, but never rebind queued work to another login. */
export class BillingSessions {
  private sessions = new Map<string, { login: string; userId: string; tenantId: string; bearer: string }>()
  register(user: SessionUser, sid: string | null, token: string): LlmBillingSession | undefined {
    if (!sid || !user.account?.userId || !user.account.tenantId) return undefined
    const ref = { sid, userId: user.account.userId, tenantId: user.account.tenantId }
    this.sessions.set(sid, { login: user.name, ...ref, bearer: 'Bearer '+token })
    return ref
  }
  authorization(login: string, ref: LlmBillingSession | undefined): string | undefined {
    if (!ref) return undefined
    const entry = this.sessions.get(ref.sid)
    return entry?.login === login && entry.userId === ref.userId && entry.tenantId === ref.tenantId ? entry.bearer : undefined
  }
  revoke(login: string, sid?: string): void {
    for (const [key, value] of this.sessions) if (value.login === login && (!sid || key === sid)) this.sessions.delete(key)
  }
}
