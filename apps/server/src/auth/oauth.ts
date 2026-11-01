import { AsyncLocalStorage } from 'node:async_hooks'
import { AuthClient, MemorySessionStore, configFromEnv } from '@sislexa/auth-client'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AuthenticateFn, AuthVerdict } from '@sislexa/identity/server/users/auth'
import { accountContext } from '@sislexa/identity/server/users/productPolicy'
import type { VoiceChatDb } from '../db/database.js'

export interface CoreOAuthConfig { authUrl: string; publicUrl: string; secretFile?: string }
const requests = new AsyncLocalStorage<{ token?: string }>()
export function coreOAuthConfig(env: NodeJS.ProcessEnv): CoreOAuthConfig | undefined {
  if ((env.AUTH_MODE ?? (env.AUTH_URL ? 'identity' : 'legacy')) === 'legacy') return undefined
  if (env.AUTH_MODE && env.AUTH_MODE !== 'identity') throw new Error('Invalid AUTH_MODE')
  if (!env.AUTH_URL || !env.PUBLIC_URL) throw new Error('Identity requires AUTH_URL and PUBLIC_URL')
  if (env.AUTH_CLIENT_ID && env.AUTH_CLIENT_ID !== 'core') throw new Error('AUTH_CLIENT_ID must be core')
  for (const value of [env.AUTH_URL, env.PUBLIC_URL]) {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid OAuth origin')
  }
  return { authUrl: env.AUTH_URL, publicUrl: env.PUBLIC_URL, secretFile: env.AUTH_CLIENT_SECRET_FILE }
}
export async function registerCoreOAuth(app: FastifyInstance, db: VoiceChatDb, config: CoreOAuthConfig) {
  const authConfig = await configFromEnv({
    AUTH_URL: config.authUrl, AUTH_CLIENT_ID: 'core', PUBLIC_URL: config.publicUrl,
    AUTH_CLIENT_SECRET_FILE: config.secretFile,
  })
  // The pinned client owns the OAuth flow; Core supplies logout revocation via its store.
  class CoreSessions extends MemorySessionStore {
    override async delete(id: string) {
      const session = await this.get(id)
      await super.delete(id)
      if (!session?.tokens) return
      const token = session.tokens.refresh_token ?? session.tokens.access_token
      const body = new URLSearchParams({ token, client_id: 'core',
        token_type_hint: session.tokens.refresh_token ? 'refresh_token' : 'access_token' })
      if (authConfig.clientSecret) body.set('client_secret', authConfig.clientSecret)
      // Local logout must succeed even when Identity is unavailable.
      try { await fetch(new URL('/oauth/revoke', authConfig.authUrl), {
        method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(5000),
      }) } catch { /* Identity logout will also terminate the upstream session. */ }
    }
  }
  const client = new AuthClient({ config: authConfig, sessions: new CoreSessions() })
  app.addHook('onRequest', (_req, _reply, done) => requests.run({}, done))
  await client.plugin(app)
  const authenticate: AuthenticateFn = async input => {
    const request = input as FastifyRequest
    delete request.authUser
    let denied: AuthVerdict = { ok: false, status: 401, error: 'unauthorized' }
    // Adapt the owner's reply-based guard to Core's transport-neutral verdict port.
    const reply = {
      code(status: 401 | 403) { denied = { ok: false, status, error: 'unauthorized' }; return this },
      send(body: {error: string}) { if (!denied.ok) denied.error = body.error },
    } as unknown as FastifyReply
    await client.requireUser(request, reply)
    const user = request.authUser as import('@sislexa/auth-client').AuthUser | undefined
    if (!user) return denied
    const { claims, accessToken } = user
    const row = await db.identity.getUser(claims.sub)
    const access = await db.identity.getAccountAccess(claims.sub, claims.tenant)
    if (!row || row.blocked || !access || (claims.tenant && access.tenant.id !== claims.tenant))
      return { ok: false, status: 403, error: 'account_access_denied' }
    const context = requests.getStore()
    if (context) context.token = accessToken
    return { ok: true, user: { name: row.name, role: access.systemRole, account: accountContext(access) } }
  }
  return { authenticate, async storageToken() {
    const token = requests.getStore()?.token
    if (!token) throw new Error('Storage requires an authenticated Identity request')
    return client.exchange(token, 'storage')
  } }
}
