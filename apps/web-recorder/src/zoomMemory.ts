// Text zoom remembered per site, the way browsers keep a per-origin zoom level:
// a person who enlarged one dense site expects it enlarged next time, and only there.
export const ZOOM_MEMORY_KEY = 'voicechat.reader.zoom.v1'
export const ZOOM_MIN = 50
export const ZOOM_MAX = 200
const HOSTS_LIMIT = 50

const hostOf = (url: string | null): string => { try { return url ? new URL(url).host : '' } catch { return '' } }
const read = (storage: Pick<Storage, 'getItem'> | null): Record<string, number> => {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(ZOOM_MEMORY_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, value]) => typeof value === 'number' && value >= ZOOM_MIN && value <= ZOOM_MAX) as [string, number][])
  } catch { return {} }
}

/** Zoom for the site of `url`; 100 when nothing was remembered or the address is unusable. */
export function loadZoomFor(url: string | null, storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): number {
  const host = hostOf(url)
  return host ? read(storage)[host] ?? 100 : 100
}

/** Remember the zoom for the site of `url`; 100 forgets it, so the map holds only deviations. */
export function saveZoomFor(url: string | null, percent: number, storage: (Pick<Storage, 'getItem' | 'setItem'>) | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  const host = hostOf(url)
  if (!host || !storage) return
  const map = read(storage)
  if (percent === 100) delete map[host]; else map[host] = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(percent)))
  const entries = Object.entries(map).slice(-HOSTS_LIMIT)
  try { storage.setItem(ZOOM_MEMORY_KEY, JSON.stringify(Object.fromEntries(entries))) } catch { /* Quota or disabled storage: zoom still applies to this page. */ }
}
