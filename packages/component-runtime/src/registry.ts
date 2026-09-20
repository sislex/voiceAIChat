import { createHash, randomBytes } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import type { DatabaseSync as SqliteDatabase } from 'node:sqlite'
// Vite 5's builtin list predates node:sqlite; native require keeps it external.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
import type { ComponentConfig, ComponentContract, ComponentPrincipal } from '@voicechat/shared'
import { assertPrivate } from './files.js'

interface TokenRow { id: string; consumer: string; scopes: string; digest: string; issued: number; expires: number; revoked: number | null }
export type Authorization = { ok: true; principal: ComponentPrincipal } | { ok: false; status: 401 | 403 }
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

/** Provider-local transactions make revocation visible to all live workers and the CLI. */
export class ComponentTokenRegistry {
  private readonly db: SqliteDatabase
  constructor(private readonly contract: ComponentContract, private readonly config: ComponentConfig, private readonly now: () => number = Date.now) {
    if (!config.registryDirectory) throw Error('Provider token registry is not configured')
    mkdirSync(config.registryDirectory, { recursive: true, mode: 0o700 })
    assertPrivate(config.registryDirectory, true)
    const file = join(config.registryDirectory, 'tokens.sqlite')
    try { closeSync(openSync(file, 'wx', 0o600)) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    for (const path of [file, file + '-wal', file + '-shm']) if (existsSync(path)) assertPrivate(path)
    this.db = new DatabaseSync(file)
    try {
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;')
      this.transaction(() => {
        const version = this.db.prepare('PRAGMA user_version').get()!.user_version
        if (version !== 0 && version !== 1) throw Error('Unsupported component registry version')
        this.db.exec(`CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
          CREATE TABLE IF NOT EXISTS tokens (id TEXT PRIMARY KEY, consumer TEXT NOT NULL, scopes TEXT NOT NULL,
          digest TEXT NOT NULL UNIQUE, issued INTEGER NOT NULL, expires INTEGER NOT NULL, revoked INTEGER) STRICT;
          PRAGMA user_version=1;`)
        const identity = JSON.stringify([contract.applicationId, config.environmentId])
        const stored = this.db.prepare("SELECT value FROM metadata WHERE key='identity'").get()
        if (stored && stored.value !== identity) throw Error('Token registry belongs to another provider or environment')
        this.db.prepare("INSERT OR IGNORE INTO metadata VALUES ('identity', ?)").run(identity)
      })
    } catch (error) { this.db.close(); throw error }
  }
  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = action(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  issue(consumerId: string, scopes: string[], ttlSeconds: number): { token: string; principal: ComponentPrincipal } {
    const grant = this.config.grants.find(item => item.consumerId === consumerId)
    if (!grant || !scopes.length || new Set(scopes).size !== scopes.length || scopes.some(scope => !grant.scopes.includes(scope)) ||
        !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > grant.maxTtlSeconds) throw Error('Requested token exceeds the consumer grant')
    const tokenId = randomBytes(16).toString('hex'), token = `sc1_${tokenId}_${randomBytes(32).toString('base64url')}`
    const issued = this.now(), expiresAt = issued + ttlSeconds * 1000
    this.db.prepare('INSERT INTO tokens VALUES (?, ?, ?, ?, ?, ?, NULL)').run(tokenId, consumerId, JSON.stringify(scopes), digest(token), issued, expiresAt)
    return { token, principal: { tokenId, consumerId, providerId: this.contract.applicationId, environmentId: this.config.environmentId, scopes: [...scopes], expiresAt } }
  }
  authorize(header: string | undefined, required: readonly string[]): Authorization {
    if (!header || !/^Bearer sc1_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/.test(header)) return { ok: false, status: 401 }
    const row = this.db.prepare('SELECT * FROM tokens WHERE digest=?').get(digest(header.slice(7))) as unknown as TokenRow | undefined
    if (!row || row.revoked !== null || row.expires <= this.now()) return { ok: false, status: 401 }
    const grant = this.config.grants.find(item => item.consumerId === row.consumer)
    const scopes = JSON.parse(row.scopes) as string[]
    if (!grant || row.expires - row.issued > grant.maxTtlSeconds * 1000 || scopes.some(scope => !grant.scopes.includes(scope)) || required.some(scope => !scopes.includes(scope))) return { ok: false, status: 403 }
    return { ok: true, principal: { tokenId: row.id, consumerId: row.consumer, providerId: this.contract.applicationId, environmentId: this.config.environmentId, scopes, expiresAt: row.expires } }
  }
  revoke(tokenId: string): boolean {
    return Number(this.db.prepare('UPDATE tokens SET revoked=? WHERE id=? AND revoked IS NULL').run(this.now(), tokenId).changes) > 0
  }
  list(): Omit<ComponentPrincipal, 'providerId' | 'environmentId'>[] {
    return this.db.prepare('SELECT id, consumer, scopes, expires FROM tokens WHERE revoked IS NULL AND expires > ?').all(this.now()).map(row => ({ tokenId: row.id as string, consumerId: row.consumer as string, scopes: JSON.parse(row.scopes as string) as string[], expiresAt: row.expires as number }))
  }
  close(): void { this.db.close() }
}
