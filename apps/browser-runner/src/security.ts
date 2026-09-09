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

/** Доверие относится к host:port; соседние сервисы на том же хосте не разрешаются. */
export function browserTarget(url: URL): string {
  return `${url.hostname.toLowerCase()}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`
}

export function validatePublicUrl(raw: string, trustedTargets: ReadonlySet<string> = new Set()): URL {
  const url = new URL(raw)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('only http/https navigation is allowed')
  const host = url.hostname.toLowerCase()
  if (!trustedTargets.has(browserTarget(url)) && (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || isBlockedAddress(host))) {
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

/** URL.host разбирается целиком: split(':') разрушает IPv6 и скрывает битый порт. */
function parseAuthority(raw: string): { host: string; port: string } | null {
  const match = /^(\[[^\]]+\]|[^:/?#@\s]+)(?::(\d+))?$/.exec(raw)
  if (!match) return null
  const port = match[2] ? String(Number(match[2])) : ''
  if (port && (Number(port) < 1 || Number(port) > 65535)) return null
  try {
    const parsed = new URL(`http://${raw}/`)
    if (!parsed.hostname || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null
    return { host: parsed.hostname.toLowerCase(), port }
  } catch { return null }
}

function authority(value: { host: string; port: string }): string {
  return `${value.host}${value.port ? `:${value.port}` : ''}`
}

export function parseHostAliases(raw: string | undefined): HostAliases {
  const aliases: HostAliases = new Map()
  for (const item of (raw ?? '').split(',')) {
    const parts = item.split('=')
    if (parts.length !== 2) continue
    const from = parseAuthority(parts[0].trim()), to = parseAuthority(parts[1].trim())
    if (!from || !to) continue
    aliases.set(authority(from), authority(to))
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
    const parsed = parseAuthority(value)
    if (!parsed) continue
    // Без порта алиас указывает стандартный порт исходной HTTP/HTTPS-схемы,
    // но никогда не открывает все порты внутреннего хоста.
    for (const port of parsed.port ? [parsed.port] : ['80', '443']) targets.add(`${parsed.host}:${port}`)
  }
  return targets
}

/**
 * Origin сервера, которому раннер доверяет как оркестратору: через него идут
 * браузерные проверки задач (прокси превью доставляет dev-сервер машины). Его
 * имя в сети compose резолвится в приватный адрес, поэтому собственный
 * SSRF-гейт зарезал бы запрос — как и любой другой внутренний адрес. Пускает
 * его оператор переменной окружения, а не пользователь адресом.
 */
export function previewOriginTarget(raw: string | undefined): string | null {
  if (!raw) return null
  let url: URL
  try { url = new URL(raw) } catch { return null }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return browserTarget(url)
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
    const parsedTarget = parseAuthority(target), parsedKey = parseAuthority(key)
    if (!parsedTarget || !parsedKey) continue
    if (url.hostname.toLowerCase() !== parsedTarget.host || port !== (parsedTarget.port || defaultPort)) continue
    const next = new URL(url.toString())
    next.hostname = parsedKey.host
    next.port = parsedKey.port || ''
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
  const parsed = parseAuthority(target)
  if (!parsed) throw new Error('invalid host alias target')
  const next = new URL(url.toString())
  next.hostname = parsed.host
  next.port = parsed.port
  return next
}
