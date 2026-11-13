import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { SessionUser } from '@voicechat/shared'
import type { AuthenticateFn } from '@sislexa/identity/server/users/auth'

import { MODEL_RUNNER_API_PREFIX as MODEL_API_PREFIX } from '@voicechat/shared'
export { MODEL_API_PREFIX }
export interface ModelToken { access: string; sid: string; tenantId: string }
type Verified = { access?: string; sid?: string; tenantId?: string }

/** Only verified Identity metadata (or its verified legacy session row) grants authority. */
export function modelTokenAuthority(
  authenticate: AuthenticateFn,
  legacy: (req: Parameters<AuthenticateFn>[0]) => Promise<Verified | undefined>,
  selectTenant?: (user: SessionUser, tenantId: string) => Promise<SessionUser | undefined>
) {
  const tokens = new WeakMap<object, ModelToken>()
  const verdicts = new WeakMap<object, Awaited<ReturnType<AuthenticateFn>>>()
  const verify: AuthenticateFn = async req => {
    const modelPath = req.url.split('?')[0]!.startsWith(MODEL_API_PREFIX)
    // Delegation authentication intentionally annotates the original headers.
    const headers = modelPath ? { ...req.headers } : req.headers
    if (modelPath) delete headers['x-sislexa-tenant-id']
    const verdict = await authenticate({ method: req.method, url: req.url, headers })
    if (!verdict.ok) return verdict
    const metadata = verdict as typeof verdict & Verified
    const old = metadata.sid ? undefined : await legacy(req)
    const access = metadata.access ?? old?.access ?? 'full'
    if (access === 'models' && !modelPath) return { ok: false, status: 403, error: 'token_scope_denied' }
    if (modelPath) {
      if (!/^Bearer \S+$/i.test(req.headers.authorization ?? '') || !['full', 'models'].includes(access)) {
        return { ok: false, status: 403, error: 'token_scope_denied' }
      }
      const sid = metadata.sid ?? old?.sid
      const tenantId = metadata.tenantId ?? old?.tenantId ?? (access === 'full' ? verdict.user.account?.tenantId : undefined)
      if (access === 'models' && tenantId && verdict.user.account?.tenantId !== tenantId && selectTenant) {
        const selected = await selectTenant(verdict.user, tenantId)
        if (selected) verdict.user = selected
      }
      if (!sid || !tenantId || !verdict.user.account || verdict.user.account.tenantId !== tenantId) {
        return { ok: false, status: 403, error: 'token_scope_denied' }
      }
      tokens.set(req, { access, sid, tenantId })
    }
    return verdict
  }
  const wrapped: AuthenticateFn = async req => {
    const cached = verdicts.get(req)
    if (cached) return cached
    const verdict = await verify(req)
    verdicts.set(req, verdict)
    return verdict
  }
  return {
    authenticate: wrapped,
    token: (req: FastifyRequest) => tokens.get(req),
    register(app: FastifyInstance) {
      // Identity's generic guard skips public endpoints and WebSocket upgrades.
      app.addHook('preHandler', async (req, reply) => {
        if (!req.headers.authorization && !req.headers.cookie) return
        const verdict = await wrapped(req)
        if (!verdict.ok && verdict.error === 'token_scope_denied') return reply.code(403).send({ error: verdict.error })
      })
    }
  }
}
