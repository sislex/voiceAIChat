// Where the person stopped reading each page of this session. A browser restores
// the scroll position when you come back; the panel keeps it per address in memory
// only, because it describes this sitting, not the person's long-term history.
const LIMIT = 30
const positions = new Map<string, number>()

const keyOf = (url: string | null): string => {
  try { return url ? new URL(url).toString() : '' } catch { return url ?? '' }
}

export function rememberScroll(url: string | null, top: number): void {
  const key = keyOf(url)
  if (!key || !Number.isFinite(top) || top < 0) return
  positions.delete(key)
  positions.set(key, Math.round(top))
  if (positions.size > LIMIT) positions.delete(positions.keys().next().value!)
}

/** Position to restore, or 0 when this page was not read in this session. */
export function rememberedScroll(url: string | null): number {
  return positions.get(keyOf(url)) ?? 0
}

export function forgetScrollPositions(): void { positions.clear() }
