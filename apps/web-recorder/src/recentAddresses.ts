// Recently opened addresses of this browser profile: quick re-entry on a phone,
// where typing a URL is slow. Stored per browser, not per conversation, because
// the same person returns to the same handful of sites from any chat.
export const RECENT_ADDRESSES_KEY = 'voicechat.reader.recent.v1'
export const RECENT_ADDRESSES_LIMIT = 6

export function rememberRecentAddress(list: readonly string[], url: string): string[] {
  let normalized: string
  try {
    const parsed = new URL(url)
    if (!/^https?:$/.test(parsed.protocol)) return [...list]
    // Credentials and fragments are never worth re-opening from a history chip.
    parsed.username = ''; parsed.password = ''; parsed.hash = ''
    normalized = parsed.toString()
  } catch { return [...list] }
  return [normalized, ...list.filter(item => item !== normalized)].slice(0, RECENT_ADDRESSES_LIMIT)
}

export function loadRecentAddresses(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): string[] {
  try {
    const raw = storage?.getItem(RECENT_ADDRESSES_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.length <= 4096).slice(0, RECENT_ADDRESSES_LIMIT) : []
  } catch { return [] }
}

export function saveRecentAddresses(list: readonly string[], storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try { storage?.setItem(RECENT_ADDRESSES_KEY, JSON.stringify(list.slice(0, RECENT_ADDRESSES_LIMIT))) } catch { /* Quota or disabled storage: chips are a convenience, not state. */ }
}

/** Short label for a chip: host plus a trimmed path, without the scheme noise. */
export function recentAddressLabel(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname === '/' && !parsed.search ? '' : parsed.pathname + parsed.search
    const label = parsed.host + path
    return label.length > 42 ? label.slice(0, 41) + '…' : label
  } catch { return url }
}
