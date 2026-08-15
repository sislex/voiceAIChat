import { createHash, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import { resolve } from 'node:path'
import type { FastifyInstance, FastifyRequest } from 'fastify'

export function bearerToken(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization
  const match = typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header) : null
  return match?.[1]
}

export function tokenMatches(expected: string, given: string | undefined): boolean {
  if (!expected || !given) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function registerRunnerAuth(app: FastifyInstance, token: string): void {
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/v1/')) return
    if (tokenMatches(token, bearerToken(request))) return
    return reply.code(401).send({ error: 'unauthorized' })
  })
}

/** User and conversation ids never become path segments. */
export function profilePath(root: string, userKey: string, conversationKey: string): string {
  const digest = createHash('sha256').update(userKey).update('\0').update(conversationKey).digest('base64url')
  const base = resolve(root)
  const path = resolve(base, digest.slice(0, 2), digest)
  if (!path.startsWith(base + '/')) throw new Error('invalid profile path')
  return path
}

function blockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] >= 224)
}

export function isBlockedAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, '').toLowerCase()
  const version = isIP(normalized)
  if (version === 4) return blockedIpv4(normalized)
  if (version === 6) return normalized === '::1' || normalized === '::' || normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')
  return false
}

export function validatePublicUrl(raw: string): URL {
  const url = new URL(raw)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('only http/https navigation is allowed')
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || isBlockedAddress(host)) {
    throw new Error('private network targets are blocked')
  }
  url.username = ''
  url.password = ''
  return url
}
