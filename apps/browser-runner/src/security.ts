import { createHash, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import { resolve } from 'node:path'
import { isPrivateNetworkHost } from '@voicechat/shared'
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

/**
 * Правило приватных сетей общее с редактором сценария (`isPrivateNetworkHost` в
 * shared): пока оно было записано дважды, копии разошлись — редактор пропускал
 * адрес, который раннер резал. Здесь остаётся только проверка «это вообще IP»:
 * имя хоста резолвится вызывающим, и в общее правило попадает уже адрес.
 */
export function isBlockedAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, '').toLowerCase()
  if (!isIP(normalized)) return false
  return isPrivateNetworkHost(normalized)
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

/**
 * Обратная подстановка: внутренний адрес → тот, который назвал человек.
 *
 * Алиас — деталь транспорта оператора, а наружу он протекал: `page.url()` после
 * подмены отдаёт внутренний адрес, и панель показывала «страница загружена с
 * voicechat:8787», а записанный сценарий уносил этот адрес в `startUrl`. На
 * другом стенде такой сценарий не открывается вовсе. Наружу отдаём тот адрес,
 * который человек набрал; факт подмены сообщается отдельным полем.
 */
export function restoreHostAlias(url: URL, aliases: HostAliases): URL {
  if (!aliases.size) return url
  const defaultPort = url.protocol === 'https:' ? '443' : '80'
  const port = url.port || defaultPort
  for (const [key, target] of aliases) {
    const [targetHost, targetPort] = target.split(':')
    if (url.hostname.toLowerCase() !== targetHost.toLowerCase() || port !== (targetPort || defaultPort)) continue
    const next = new URL(url.toString())
    const [keyHost, keyPort] = key.split(':')
    next.hostname = keyHost
    next.port = keyPort && keyPort !== defaultPort ? keyPort : ''
    return next
  }
  return url
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
