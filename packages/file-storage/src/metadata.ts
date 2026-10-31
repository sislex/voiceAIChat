import type { StorageSpace, StorageEntry, StorageShare } from '@voicechat/shared/fileStorage'

export type StoredSpace = Omit<StorageSpace, 'access' | 'usedBytes' | 'fileCount'>
export interface StoredEntry extends StorageEntry {
  spaceId: string
  blobId: string
  nodeId: string
}
export interface StorageReservation {
  id: string
  ownerId: string
  entry: StoredEntry
  previousBlobId: string | null
  /** Positive growth only: pending shrink must not free quota before commit. */
  chargedBytes: number
  expiresAt: number
}
export interface StorageLinkAcceptance { shareId: string; userId: string; acceptedAt: number }
export interface OwnerStorageUsage { usedBytes: number; fileCount: number }

/** All calls use the transaction's consistent view. Never expose mutable references. */
export interface StorageMetadataTransaction {
  listReservations(): Promise<StorageReservation[]>
  putReservation(value: StorageReservation): Promise<void>
  deleteReservation(id: string): Promise<void>
  getSpace(id: string): Promise<StoredSpace | null>
  /** Canonical identity first within each owner/kind/ref group, including legacy fallback. */
  listSpaces(): Promise<StoredSpace[]>
  /** Create or return the canonical owner/kind/ref space; personal spaces are always new. */
  createSpace(space: StoredSpace): Promise<StoredSpace>
  putSpace(space: StoredSpace): Promise<void>
  deleteSpace(id: string): Promise<void>
  getEntry(spaceId: string, path: string): Promise<StoredEntry | null>
  listEntries(spaceId: string): Promise<StoredEntry[]>
  putEntry(entry: StoredEntry): Promise<void>
  deleteEntry(spaceId: string, path: string): Promise<void>
  listShares(spaceId: string): Promise<StorageShare[]>
  getLink(token: string): Promise<StorageShare | null>
  putShare(share: StorageShare): Promise<void>
  deleteShare(id: string): Promise<void>
  listAcceptances(userId: string): Promise<StorageLinkAcceptance[]>
  putAcceptance(acceptance: StorageLinkAcceptance): Promise<void>
  ownerUsage(ownerId: string): Promise<OwnerStorageUsage>
}
/**
 * Serialize transactions across every coordinator using this store (including
 * quota checks across different spaces of one owner). Commit all metadata only
 * after the callback succeeds; roll back on error. Callbacks may perform node I/O.
 * SQL adapters must provide equivalent isolation and must NOT retry callbacks:
 * a callback can already have stored a blob. Persist metadata before resolving.
 */
export interface StorageMetadataStore {
  transaction<T>(operation: (tx: StorageMetadataTransaction) => Promise<T>): Promise<T>
}

export function createMemoryMetadataStore(): StorageMetadataStore {
  let state = {
    spaces: new Map<string, StoredSpace>(),
    refs: new Map<string, string>(),
    reservations: new Map<string, StorageReservation>(),
    entries: new Map<string, StoredEntry>(),
    shares: new Map<string, StorageShare>(),
    acceptances: new Map<string, StorageLinkAcceptance>(),
  }
  let queue: Promise<unknown> = Promise.resolve()
  const key = (a: string, b: string) => JSON.stringify([a, b])
  return {
    transaction<T>(operation: (tx: StorageMetadataTransaction) => Promise<T>): Promise<T> {
      const result = queue.then(async () => {
        const draft = structuredClone(state)
        const tx: StorageMetadataTransaction = {
          async listReservations() { return structuredClone([...draft.reservations.values()]) },
          async putReservation(r) { draft.reservations.set(r.id, structuredClone(r)) },
          async deleteReservation(id) { draft.reservations.delete(id) },
          async getSpace(id) { return structuredClone(draft.spaces.get(id) ?? null) },
          async listSpaces() {
            const canonical = new Set(draft.refs.values())
            return structuredClone([...draft.spaces.values()].sort((a, b) =>
              Number(canonical.has(b.id)) - Number(canonical.has(a.id)) ||
              a.createdAt - b.createdAt || a.id.localeCompare(b.id)))
          },
          async createSpace(space) {
            const identity = JSON.stringify([space.ownerId, space.kind, space.ref])
            const canonical = draft.spaces.get(draft.refs.get(identity) ?? '')
            const existing = space.kind === 'personal' ? undefined : canonical ?? [...draft.spaces.values()]
              .filter(s => s.ownerId === space.ownerId && s.kind === space.kind && s.ref === space.ref)
              .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0]
            const winner = existing ?? space
            if (space.kind !== 'personal') draft.refs.set(identity, winner.id)
            if (!existing) draft.spaces.set(space.id, structuredClone(space))
            return structuredClone(winner)
          },
          async putSpace(space) { draft.spaces.set(space.id, structuredClone(space)) },
          async deleteSpace(id) {
            draft.spaces.delete(id)
            for (const [identity, spaceId] of draft.refs) if (spaceId === id) draft.refs.delete(identity)
            for (const [k, entry] of draft.entries) if (entry.spaceId === id) draft.entries.delete(k)
            for (const share of [...draft.shares.values()]) if (share.spaceId === id) await tx.deleteShare(share.id)
          },
          async getEntry(spaceId, path) { return structuredClone(draft.entries.get(key(spaceId, path)) ?? null) },
          async listEntries(spaceId) { return structuredClone([...draft.entries.values()].filter(e => e.spaceId === spaceId)) },
          async putEntry(entry) { draft.entries.set(key(entry.spaceId, entry.path), structuredClone(entry)) },
          async deleteEntry(spaceId, path) { draft.entries.delete(key(spaceId, path)) },
          async listShares(spaceId) { return structuredClone([...draft.shares.values()].filter(s => s.spaceId === spaceId)) },
          async getLink(token) { return structuredClone([...draft.shares.values()].find(s => s.audience.kind === 'link' && s.audience.token === token) ?? null) },
          async putShare(share) { draft.shares.set(share.id, structuredClone(share)) },
          async deleteShare(id) {
            draft.shares.delete(id)
            for (const [k, acceptance] of draft.acceptances) if (acceptance.shareId === id) draft.acceptances.delete(k)
          },
          async listAcceptances(userId) { return structuredClone([...draft.acceptances.values()].filter(a => a.userId === userId)) },
          async putAcceptance(a) { draft.acceptances.set(key(a.shareId, a.userId), structuredClone(a)) },
          async ownerUsage(ownerId) {
            const entries = [...draft.entries.values()].filter(e => draft.spaces.get(e.spaceId)?.ownerId === ownerId)
            return { usedBytes: entries.reduce((n, e) => n + e.size, 0), fileCount: entries.length }
          },
        }
        const value = await operation(tx)
        state = draft
        return value
      })
      queue = result.catch(() => {})
      return result
    },
  }
}
