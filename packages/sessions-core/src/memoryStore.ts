// Референс-реализация хранилища: тесты, Storybook и первый запуск в чужом
// приложении не должны требовать базы. Она же — эталон поведения: контрактный
// набор сначала прогоняется на ней, потом на настоящем хранилище.
import type { Awaitable, PruneOptions, SessionStore } from './ports'
import type { DeviceSession, NewSession, SessionPatch } from './types'

interface Row extends DeviceSession {
  revokedAt: number | null
}

/** Запись активности дешевеет, если не трогать хранилище на каждый запрос. */
export const TOUCH_INTERVAL_MS = 60_000
/** Отозванные строки держим неделю: по ним разбирают инциденты. */
export const KEEP_REVOKED_MS = 7 * 24 * 60 * 60_000

export class InMemorySessionStore implements SessionStore {
  private readonly rows = new Map<string, Row>()

  constructor(private readonly clock: () => number = Date.now) {}

  /** Снимок для тестов и отладки — включая отозванные строки. */
  all(): DeviceSession[] {
    return [...this.rows.values()].map((r) => ({ ...r }))
  }

  create(input: NewSession): Awaitable<void> {
    const now = this.clock()
    const existing = this.rows.get(input.sid)
    if (existing) {
      existing.lastSeen = now
      return
    }
    this.rows.set(input.sid, {
      sid: input.sid,
      user: input.user,
      createdAt: now,
      lastSeen: now,
      expiresAt: now + input.ttlMs,
      ip: input.ip,
      userAgent: input.userAgent,
      label: null,
      deviceKey: input.deviceKey ?? null,
      trustedAt: null,
      platform: input.platform ?? null,
      clientVersion: input.clientVersion ?? null,
      geo: input.geo ?? null,
      requests: 0,
      lastPath: null,
      revokedAt: null
    })
  }

  get(sid: string): DeviceSession | null {
    const row = this.rows.get(sid)
    if (!row || row.revokedAt || row.expiresAt <= this.clock()) return null
    return { ...row }
  }

  has(sid: string): boolean {
    return this.rows.has(sid)
  }

  list(user: string): DeviceSession[] {
    const now = this.clock()
    return [...this.rows.values()]
      .filter((r) => r.user === user && !r.revokedAt && r.expiresAt > now)
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map((r) => ({ ...r }))
  }

  touch(sid: string, input: { ttlMs: number; path?: string }): void {
    const row = this.rows.get(sid)
    if (!row || row.revokedAt) return
    const now = this.clock()
    if (now - row.lastSeen < TOUCH_INTERVAL_MS) return
    row.lastSeen = now
    row.expiresAt = now + input.ttlMs
    row.requests = (row.requests ?? 0) + 1
    if (input.path) row.lastPath = input.path
  }

  update(sid: string, patch: SessionPatch): boolean {
    const row = this.rows.get(sid)
    if (!row || row.revokedAt) return false
    if (patch.label !== undefined) row.label = patch.label
    if (patch.trusted !== undefined) row.trustedAt = patch.trusted ? this.clock() : null
    if (patch.geo !== undefined) row.geo = patch.geo
    return true
  }

  revoke(sid: string): boolean {
    const row = this.rows.get(sid)
    if (!row || row.revokedAt) return false
    row.revokedAt = this.clock()
    return true
  }

  revokeAll(user: string, exceptSid?: string | null): number {
    let revoked = 0
    const now = this.clock()
    for (const row of this.rows.values()) {
      if (row.user !== user || row.revokedAt || row.sid === exceptSid) continue
      row.revokedAt = now
      revoked++
    }
    return revoked
  }

  prune(options: PruneOptions = {}): number {
    const now = this.clock()
    const keep = options.keepRevokedMs ?? KEEP_REVOKED_MS
    let removed = 0
    for (const [sid, row] of [...this.rows.entries()]) {
      if (row.expiresAt < now || (row.revokedAt !== null && row.revokedAt < now - keep)) {
        this.rows.delete(sid)
        removed++
      }
    }
    return removed
  }
}
