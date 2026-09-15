/**
 * Session-local reads. A consumer owns its subscription, never the shared flight.
 * Entry identity fences invalidation so old completions cannot replace new data.
 */
export const RESOURCE_TTL = {
  profile: 60_000, access: 60_000, usage: 30_000, security: 30_000,
  machines: 30_000, settings: 60_000, catalogs: 300_000, projects: 30_000, board: 10_000
} as const
export type ResourceFamily = keyof typeof RESOURCE_TTL
export function resourceKey(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(resourceKey).join(',') + ']'
  return '{' + Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => JSON.stringify(k) + ':' + resourceKey(v)).join(',') + '}'
}
type Entry = { family: ResourceFamily; params: unknown; data?: unknown; ready: boolean; expires: number; flight?: Promise<unknown> }
export class ReadCache {
  private entries = new Map<string, Entry>()
  private listeners = new Set<() => void>()
  onInvalidated(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  constructor(
    private readonly now: () => number = Date.now,
    private readonly diagnostic: (event: { resource: ResourceFamily; outcome: 'hit' | 'miss' }) => void = () => {}
  ) {}
  peek<T>(family: ResourceFamily, params: unknown): T | undefined {
    const entry = this.entries.get(family + ':' + resourceKey(params))
    return entry?.ready ? entry.data as T : undefined
  }
  seed<T>(family: ResourceFamily, params: unknown, data: T): void {
    this.entries.set(family + ':' + resourceKey(params), { family, params, data, ready: true, expires: this.now() + RESOURCE_TTL[family] })
  }
  fresh(family: ResourceFamily, params: unknown): boolean {
    const entry = this.entries.get(family + ':' + resourceKey(params))
    return Boolean(entry?.ready && this.now() < entry.expires)
  }
  read<T>(family: ResourceFamily, params: unknown, load: () => Promise<T>): Promise<T> {
    const key = family + ':' + resourceKey(params)
    let entry = this.entries.get(key)
    if (entry?.flight || (entry?.ready && this.now() < entry.expires)) {
      this.diagnostic({ resource: family, outcome: 'hit' })
      if (entry.flight) return entry.flight as Promise<T>
      const cached = entry
      return Promise.resolve().then(() => {
        if (this.entries.get(key) !== cached) throw Object.assign(new Error('Obsolete read'), { name: 'AbortError' })
        return cached.data as T
      })
    }
    this.diagnostic({ resource: family, outcome: 'miss' })
    // Bound retained inactive reads without evicting work owned by live consumers.
    if (this.entries.size >= 256) {
      for (const [oldKey, oldEntry] of this.entries) {
        if (oldKey !== key && !oldEntry.flight) { this.entries.delete(oldKey); break }
      }
    }
    entry = { family, params, ready: entry?.ready ?? false, data: entry?.data, expires: 0 }
    this.entries.set(key, entry)
    const current = entry
    const flight = Promise.resolve().then(load).then((data) => {
      if (this.entries.get(key) !== current) throw Object.assign(new Error('Obsolete read'), { name: 'AbortError' })
      current.data = data
      current.ready = true
      current.expires = this.now() + RESOURCE_TTL[family]
      return data
    }).catch(error => {
      if (this.entries.get(key) !== current) throw Object.assign(new Error('Obsolete read'), { name: 'AbortError' })
      throw error
    }).finally(() => {
      if (this.entries.get(key) === current) current.flight = undefined
    })
    current.flight = flight
    return flight
  }
  subscribe<T>(family: ResourceFamily, params: unknown, load: () => Promise<T>, receive: (data: T) => void, fail: (error: unknown) => void): () => void {
    let active = true
    const pending = this.read(family, params, load)
    const key = family + ':' + resourceKey(params)
    const entry = this.entries.get(key)
    void pending.then(
      data => { if (active && this.entries.get(key) === entry) receive(data) },
      error => { if (active && !isObsoleteRead(error)) fail(error) }
    )
    return () => { active = false }
  }
  invalidate(family?: ResourceFamily, matches: (params: unknown) => boolean = () => true): void {
    for (const [key, entry] of this.entries) {
      if ((!family || entry.family === family) && matches(entry.params)) this.entries.delete(key)
    }
    for (const listener of this.listeners) listener()
  }
  clear(): void {
    this.entries.clear()
    for (const listener of this.listeners) listener()
  }
}
export function isObsoleteRead(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
