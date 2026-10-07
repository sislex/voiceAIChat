import { randomBytes } from 'node:crypto'
import type { AuthenticateFn } from '@sislexa/identity/server/users/auth'

/** Exact-request capabilities for Core-originated requests; never persisted as sessions. */
export class MakeRequestAuthority {
  private grants = new Map<string, { userId: string; method: string; url: string; expires: number }>()
  constructor(private readonly user: (id: string) => Promise<Extract<Awaited<ReturnType<AuthenticateFn>>, { ok: true }>['user'] | null>) {}

  async run<T>(userId: string, method: string, url: string, request: (authorization: string) => Promise<T>): Promise<T> {
    const token = 'make_request_' + randomBytes(32).toString('hex')
    this.grants.set(token, { userId, method, url, expires: Date.now() + 30_000 })
    try { return await request('Bearer ' + token) } finally { this.grants.delete(token) }
  }

  async authenticate(req: Parameters<AuthenticateFn>[0]): Promise<Awaited<ReturnType<AuthenticateFn>> | undefined> {
    const token = req.headers.authorization?.replace(/^Bearer /, '')
    if (!token?.startsWith('make_request_')) return undefined
    const grant = this.grants.get(token)
    if (!grant || grant.expires <= Date.now() || grant.method !== req.method || grant.url !== req.url)
      return { ok: false, status: 403, error: 'make_request_denied' }
    const user = await this.user(grant.userId)
    return user ? { ok: true, user } : { ok: false, status: 403, error: 'make_request_denied' }
  }
}
