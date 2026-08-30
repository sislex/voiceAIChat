// Определение места входа по IP. По умолчанию модуль работает офлайн: приватные
// адреса подписываются как «локальная сеть», публичные остаются без места.
// Внешний провайдер включается только явной переменной VC_GEOIP_URL — адрес
// пользователя это персональные данные, и отправлять его наружу без ведома
// владельца установки нельзя.
import type { GeoInfo, GeoResolver } from '@voicechat/sessions-core'
import { localGeo, normalizeIp } from '@voicechat/sessions-core'

export interface GeoResolverOptions {
  /** Шаблон адреса с плейсхолдером `{ip}`; пусто — только офлайн-разбор. */
  url?: string | null
  timeoutMs?: number
  /** Сколько держать ответ по подсети (по умолчанию сутки). */
  ttlMs?: number
  /** Сколько подсетей помнить: у сервиса на сотню пользователей их единицы. */
  cacheMax?: number
  fetchImpl?: typeof fetch
  onError?: (message: string) => void
}

interface CacheEntry { geo: GeoInfo | null; at: number }

/** Терпимый разбор ответа: у публичных гео-сервисов поля называются по-разному. */
export function parseGeoPayload(payload: unknown): GeoInfo | null {
  if (!payload || typeof payload !== 'object') return null
  const raw = payload as Record<string, unknown>
  const str = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = raw[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return undefined
  }
  const country = str('country_code', 'countryCode', 'country')?.slice(0, 40)
  const city = str('city', 'city_name')?.slice(0, 60)
  if (!country && !city) return null
  return { ...(country ? { country } : {}), ...(city ? { city } : {}), label: [city, country].filter(Boolean).join(', ') }
}

export function createGeoResolver(options: GeoResolverOptions = {}): GeoResolver {
  const { url, timeoutMs = 2000, ttlMs = 24 * 60 * 60_000, cacheMax = 500, fetchImpl = fetch, onError } = options
  // Кешируем по подсети, а не по адресу: соседние адреса одного провайдера
  // дают то же место, а запросов наружу становится на порядок меньше.
  const cache = new Map<string, CacheEntry>()

  return {
    async resolve(ip: string): Promise<GeoInfo | null> {
      const local = localGeo(ip)
      if (local) return local
      const norm = normalizeIp(ip)
      if (!norm.address || !url) return null
      const key = norm.subnet || norm.address
      const hit = cache.get(key)
      if (hit && Date.now() - hit.at < ttlMs) return hit.geo
      let geo: GeoInfo | null = null
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
          const res = await fetchImpl(url.replace('{ip}', encodeURIComponent(norm.address)), { signal: controller.signal })
          if (res.ok) geo = parseGeoPayload(await res.json())
        } finally {
          clearTimeout(timer)
        }
      } catch (error) {
        // Fail-open: без места список сессий остаётся полезным, а вход не ждёт.
        onError?.(error instanceof Error ? error.message : String(error))
      }
      if (cache.size >= cacheMax) cache.delete(cache.keys().next().value as string)
      cache.set(key, { geo, at: Date.now() })
      return geo
    }
  }
}
