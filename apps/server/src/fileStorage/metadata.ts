import type { Sql } from '@sislexa/identity/storage-sql/types'
import type { StorageMetadataStore, StorageMetadataTransaction, StoredSpace, StoredEntry, StorageLinkAcceptance, StorageReservation } from '../../../../packages/file-storage/src/metadata.js'
import type { StorageShare } from '@voicechat/shared/fileStorage'

/** Shared lock serializes quota checks across processes without replaying node I/O. */
export const STORAGE_SCHEMA = `
CREATE TABLE IF NOT EXISTS storage_lock (id INTEGER PRIMARY KEY, version INTEGER NOT NULL);
INSERT INTO storage_lock (id, version) VALUES (1, 0) ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS storage_spaces (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, data TEXT NOT NULL);
-- Canonical identities are separate so legacy duplicate spaces remain readable.
-- ref_key is JSON encoded to distinguish null from an empty string on both engines.
CREATE TABLE IF NOT EXISTS storage_space_refs (
  owner_id TEXT NOT NULL, kind TEXT NOT NULL, ref_key TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES storage_spaces(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS storage_space_refs_unique ON storage_space_refs(owner_id, kind, ref_key);
CREATE TABLE IF NOT EXISTS storage_entries (
  space_id TEXT NOT NULL REFERENCES storage_spaces(id) ON DELETE CASCADE,
  path TEXT NOT NULL, size INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(space_id, path)
);
CREATE TABLE IF NOT EXISTS storage_reservations (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS storage_shares (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES storage_spaces(id) ON DELETE CASCADE,
  token TEXT UNIQUE, data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS storage_acceptances (
  share_id TEXT NOT NULL REFERENCES storage_shares(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(share_id, user_id)
);
`

export function createSqlMetadataStore(sql: Sql): StorageMetadataStore {
  const one = async <T>(query: string, params: unknown[]): Promise<T | null> => {
    const row = await sql.get<{data: string}>(query, params)
    return row ? JSON.parse(row.data) as T : null
  }
  const many = async <T>(query: string, params: unknown[] = []): Promise<T[]> =>
    (await sql.all<{data: string}>(query, params)).map(row => JSON.parse(row.data) as T)
  const tx: StorageMetadataTransaction = {
    listReservations: () => many<StorageReservation>('SELECT data FROM storage_reservations'),
    async putReservation(r) { await sql.run('INSERT INTO storage_reservations (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data', [r.id, JSON.stringify(r)]) },
    async deleteReservation(id) { await sql.run('DELETE FROM storage_reservations WHERE id = ?', [id]) },
    getSpace: id => one<StoredSpace>('SELECT data FROM storage_spaces WHERE id = ?', [id]),
    async listSpaces() {
      const canonical = new Set((await sql.all<{space_id: string}>('SELECT space_id FROM storage_space_refs')).map(r => r.space_id))
      return (await many<StoredSpace>('SELECT data FROM storage_spaces')).sort((a, b) =>
        Number(canonical.has(b.id)) - Number(canonical.has(a.id)) ||
        a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    },
    async createSpace(s) {
      if (s.kind === 'personal') { await tx.putSpace(s); return s }
      const key = [s.ownerId, s.kind, JSON.stringify(s.ref)]
      const lookup = () => one<StoredSpace>(
        'SELECT s.data FROM storage_space_refs r JOIN storage_spaces s ON s.id = r.space_id WHERE r.owner_id = ? AND r.kind = ? AND r.ref_key = ?', key)
      const canonical = await lookup()
      if (canonical) return canonical
      // Adopt one old space without merging or hiding any legacy duplicates.
      const existing = (await many<StoredSpace>('SELECT data FROM storage_spaces WHERE owner_id = ?', [s.ownerId]))
        .filter(space => space.kind === s.kind && space.ref === s.ref)
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0]
      const candidate = existing ?? s
      if (!existing) await tx.putSpace(candidate)
      // DO NOTHING keeps a PostgreSQL transaction usable after a competing insert.
      await sql.run('INSERT INTO storage_space_refs (owner_id, kind, ref_key, space_id) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id, kind, ref_key) DO NOTHING', [...key, candidate.id])
      const winner = await lookup()
      if (!winner) throw new Error('Storage space identity missing after insert')
      if (!existing && winner.id !== candidate.id) await tx.deleteSpace(candidate.id)
      return winner
    },
    async putSpace(s) { await sql.run('INSERT INTO storage_spaces (id, owner_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET owner_id = excluded.owner_id, data = excluded.data', [s.id, s.ownerId, JSON.stringify(s)]) },
    async deleteSpace(id) { await sql.run('DELETE FROM storage_spaces WHERE id = ?', [id]) },
    getEntry: (id, path) => one<StoredEntry>('SELECT data FROM storage_entries WHERE space_id = ? AND path = ?', [id, path]),
    listEntries: id => many<StoredEntry>('SELECT data FROM storage_entries WHERE space_id = ?', [id]),
    async putEntry(e) { await sql.run('INSERT INTO storage_entries (space_id, path, size, data) VALUES (?, ?, ?, ?) ON CONFLICT(space_id, path) DO UPDATE SET size = excluded.size, data = excluded.data', [e.spaceId, e.path, e.size, JSON.stringify(e)]) },
    async deleteEntry(id, path) { await sql.run('DELETE FROM storage_entries WHERE space_id = ? AND path = ?', [id, path]) },
    listShares: id => many<StorageShare>('SELECT data FROM storage_shares WHERE space_id = ?', [id]),
    getLink: token => one<StorageShare>('SELECT data FROM storage_shares WHERE token = ?', [token]),
    async putShare(s) { await sql.run('INSERT INTO storage_shares (id, space_id, token, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET token = excluded.token, data = excluded.data', [s.id, s.spaceId, s.audience.kind === 'link' ? s.audience.token : null, JSON.stringify(s)]) },
    async deleteShare(id) { await sql.run('DELETE FROM storage_shares WHERE id = ?', [id]) },
    listAcceptances: userId => many<StorageLinkAcceptance>('SELECT data FROM storage_acceptances WHERE user_id = ?', [userId]),
    async putAcceptance(a) { await sql.run('INSERT INTO storage_acceptances (share_id, user_id, data) VALUES (?, ?, ?) ON CONFLICT(share_id, user_id) DO UPDATE SET data = excluded.data', [a.shareId, a.userId, JSON.stringify(a)]) },
    async ownerUsage(ownerId) {
      const row = await sql.get<{used: number; count: number}>('SELECT COALESCE(SUM(e.size), 0) AS used, COUNT(*) AS count FROM storage_entries e JOIN storage_spaces s ON s.id = e.space_id WHERE s.owner_id = ?', [ownerId])
      return { usedBytes: Number(row?.used ?? 0), fileCount: Number(row?.count ?? 0) }
    },
  }
  return { transaction: operation => sql.transaction(async () => {
    // First statement obtains the SQLite write lock before any snapshot reads.
    await sql.run('UPDATE storage_lock SET version = version WHERE id = 1')
    return operation(tx)
  }) }
}
