// Стабильный ключ устройства и нормализация адреса. Ключ нужен там, где нельзя
// опираться на sid: доверенные устройства переживают перелогин, а список не
// должен считать новым устройством тот же браузер с соседнего IP провайдера.
import { parseUserAgent } from './device'
import type { GeoInfo } from './types'

/** Приватные и служебные диапазоны: по ним гео определить нельзя и не нужно. */
const PRIVATE_V4 = [
  /^10\./, /^127\./, /^169\.254\./, /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./
]

export interface NormalizedIp {
  /** Адрес без IPv4-mapped-префикса и без порта. */
  address: string
  family: 'v4' | 'v6' | 'unknown'
  /** Loopback, локальная сеть, link-local, ULA — всё, что не маршрутизируется наружу. */
  private: boolean
  /** Сеть, к которой адрес принадлежит: /24 для IPv4 и /64 для IPv6. */
  subnet: string
}

/**
 * Приводит адрес к сравнимому виду. Fastify отдаёт IPv4-mapped адреса
 * (`::ffff:1.2.3.4`) за прокси, а порт иногда приезжает вместе с адресом —
 * без нормализации один и тот же клиент выглядит как разные устройства.
 */
export function normalizeIp(raw: string | null | undefined): NormalizedIp {
  let ip = (raw ?? '').trim().toLowerCase()
  if (ip.startsWith('[')) {
    const close = ip.indexOf(']')
    ip = close > 0 ? ip.slice(1, close) : ip.slice(1)
  }
  if (ip.startsWith('::ffff:')) ip = ip.slice(7)
  // Порт отрезаем только у IPv4: у голого IPv6 двоеточий много и это его часть.
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(':'))
  if (!ip) return { address: '', family: 'unknown', private: false, subnet: '' }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split('.')
    return {
      address: ip,
      family: 'v4',
      private: PRIVATE_V4.some((r) => r.test(ip)) || ip === '0.0.0.0',
      subnet: `${parts[0]}.${parts[1]}.${parts[2]}.0/24`
    }
  }
  if (ip.includes(':')) {
    const groups = expandV6(ip).slice(0, 4)
    return {
      address: ip,
      family: 'v6',
      private: ip === '::1' || ip === '::' || /^f[cd]/.test(ip) || ip.startsWith('fe80'),
      subnet: `${groups.join(':')}::/64`
    }
  }
  return { address: ip, family: 'unknown', private: false, subnet: '' }
}

/** Разворачивает сокращённую запись IPv6 в восемь групп — нужно только для подсети. */
function expandV6(ip: string): string[] {
  const [head, tail] = ip.split('::')
  const left = head ? head.split(':').filter(Boolean) : []
  const right = tail ? tail.split(':').filter(Boolean) : []
  const middle = ip.includes('::') ? Array(Math.max(0, 8 - left.length - right.length)).fill('0') : []
  return [...left, ...middle, ...right].slice(0, 8).map((g) => g.padStart(4, '0'))
}

/** Гео по адресу без внешних сервисов: отличает локальную сеть от публичного адреса. */
export function localGeo(ip: string | null | undefined): GeoInfo | null {
  const norm = normalizeIp(ip)
  if (!norm.address) return null
  return norm.private ? { local: true, label: 'локальная сеть' } : null
}

/**
 * FNV-1a: короткий стабильный хеш без node:crypto — ядро должно одинаково
 * работать в браузере, в Node и в чужом рантайме. Криптостойкость здесь не
 * нужна: ключ не секрет и всегда проверяется вместе с сессией в хранилище.
 */
export function hash32(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * Ключ устройства: класс устройства + браузер + ОС + подсеть. Мажорная версия
 * браузера в него не входит — иначе автообновление Chrome превращало бы
 * знакомое устройство в новое и сбрасывало доверие каждые несколько недель.
 */
export function deviceKey(input: { userAgent: string | null | undefined; ip: string | null | undefined }): string {
  const profile = parseUserAgent(input.userAgent)
  const norm = normalizeIp(input.ip)
  return hash32([profile.kind, profile.browser, profile.os, norm.subnet].join('|'))
}
