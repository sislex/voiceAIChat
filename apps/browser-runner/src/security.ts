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

/**
 * Алиасы адресов: «внешний host:port» → «внутренний host:port».
 *
 * Нужны, чтобы раннер открывал сайт собственного стенда. Контейнер не достаёт
 * до публичного IP своего же хоста (ufw режет трафик «контейнер → INPUT», а
 * опубликованные Docker порты работают в обход ufw только для внешних
 * подключений), зато прекрасно ходит к соседнему сервису по имени в сети
 * compose. Адрес подменяется **после** проверки исходного URL, поэтому SSRF-гейт
 * остаётся на месте: во внутреннюю сеть пускает не пользователь, а оператор,
 * заранее перечисливший пары в конфигурации.
 */
export type HostAliases = Map<string, string>

export function parseHostAliases(raw: string | undefined): HostAliases {
  const aliases: HostAliases = new Map()
  for (const item of (raw ?? '').split(',')) {
    const [from, to] = item.split('=').map((part) => part.trim())
    if (!from || !to) continue
    aliases.set(from.toLowerCase(), to)
  }
  return aliases
}

/**
 * Цели алиасов — единственные внутренние адреса, которым раннер доверяет.
 * Без этого списка подставленный адрес тут же резался бы собственным
 * SSRF-гейтом: `site:8787` резолвится в приватную сеть, как и положено.
 */
export function aliasTargets(aliases: HostAliases): Set<string> {
  const targets = new Set<string>()
  for (const value of aliases.values()) {
    targets.add(value.toLowerCase())
    targets.add(value.split(':')[0].toLowerCase())
  }
  return targets
}

/** Возвращает адрес с подменённым host:port либо исходный, если пары нет. */
export function applyHostAlias(url: URL, aliases: HostAliases): URL {
  if (!aliases.size) return url
  const port = url.port || (url.protocol === 'https:' ? '443' : '80')
  const target = aliases.get(`${url.hostname.toLowerCase()}:${port}`) ?? aliases.get(url.hostname.toLowerCase())
  if (!target) return url
  const next = new URL(url.toString())
  const [host, aliasPort] = target.split(':')
  next.hostname = host
  next.port = aliasPort ?? ''
  return next
}
