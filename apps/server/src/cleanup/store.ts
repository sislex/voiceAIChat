import { closeSync, fsyncSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { CleanupAttempt, TemporaryResource } from '@voicechat/shared'

export interface Consumer { id: string; taskId: string; pid: number; host: string; instance?: string }
interface Owner { pid: number; host: string; instance?: string }
const envMs = (name: string, fallback: number): number => {
  const value = Number(process.env[name])
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}
/** Process identity that survives neither restart nor container replacement. */
export const INSTANCE_ID = randomUUID()
const HEARTBEAT_MS = envMs('VC_CLEANUP_HEARTBEAT_MS', 10_000)
const INSTANCE_STALE_MS = envMs('VC_CLEANUP_INSTANCE_STALE_MS', 60_000)
const LEGACY_LOCK_STALE_MS = envMs('VC_CLEANUP_LEGACY_LOCK_STALE_MS', 10 * 60_000)
const RECOVERY_STALE_MS = envMs('VC_CLEANUP_RECOVERY_STALE_MS', 60_000)
const heartbeats = new Map<string, NodeJS.Timeout>()
/** Locks this process holds right now, shared by every store object on one path. */
const heldLocks = new Map<string, number>()
export interface CleanupData { resources: TemporaryResource[]; attempts: CleanupAttempt[]; consumers: Consumer[] }
const empty = (): CleanupData => ({ resources: [], attempts: [], consumers: [] })
export class CleanupBusy extends Error { constructor() { super('cleanup_or_consumer_busy') } }
/** Shared data directory is required for all instances of one kanban service.
 * No lease expiry can transfer authority while a remote deletion is in flight.
 */
export class CleanupStore {
  constructor(readonly path: string) {}
  read(): CleanupData {
    if (!existsSync(this.path)) return empty()
    const data = JSON.parse(readFileSync(this.path, 'utf8')) as CleanupData
    if (!Array.isArray(data.resources) || !Array.isArray(data.attempts) || !Array.isArray(data.consumers)) throw new Error('cleanup_registry_invalid')
    return data
  }
  get instancesDir(): string { return join(dirname(this.path), '.cleanup-instances') }
  /** Keep this process visibly alive to other instances sharing the data directory.
   * A container replacement changes hostname and PID namespace, so neither can
   * prove a previous owner is gone; a missing heartbeat can. */
  heartbeat(): void {
    const write = (): void => {
      try {
        mkdirSync(this.instancesDir, { recursive: true })
        const target = join(this.instancesDir, INSTANCE_ID + '.json')
        const tmp = target + '.' + randomUUID() + '.tmp'
        writeFileSync(tmp, JSON.stringify({ pid: process.pid, host: hostname(), at: Date.now() }), { mode: 0o600 })
        renameSync(tmp, target)
      } catch { /* A later beat retries; liveness errs towards "busy", never towards stealing. */ }
    }
    if (heartbeats.has(this.instancesDir)) return
    write()
    const timer = setInterval(write, HEARTBEAT_MS)
    timer.unref?.()
    heartbeats.set(this.instancesDir, timer)
  }
  private instanceAlive(instance: string): boolean {
    if (instance === INSTANCE_ID) return true
    try {
      const beat = JSON.parse(readFileSync(join(this.instancesDir, instance + '.json'), 'utf8')) as { at?: number }
      return typeof beat.at === 'number' && Date.now() - beat.at < INSTANCE_STALE_MS
    } catch { return false }
  }
  /** Liveness of a consumer or lock owner. Instance heartbeats decide for current
   * records; legacy records keep the conservative PID/host rule. */
  alive(owner: Owner): boolean {
    if (typeof owner.instance === 'string' && owner.instance) return this.instanceAlive(owner.instance)
    return CleanupStore.alive(owner)
  }
  static alive(consumer: Owner): boolean {
    if (consumer.host !== hostname() || !Number.isSafeInteger(consumer.pid) || consumer.pid < 1) return true
    try { process.kill(consumer.pid, 0); return true }
    catch (e) { return (e as NodeJS.ErrnoException).code !== 'ESRCH' }
  }
  private lockYoung(lock: string): boolean {
    try { return Date.now() - statSync(lock).mtimeMs < LEGACY_LOCK_STALE_MS } catch { return true }
  }
  private lockOwnerAlive(owner: Owner, lock: string): boolean {
    if (owner.instance === INSTANCE_ID) return (heldLocks.get(lock) ?? 0) > 0
    if (typeof owner.instance === 'string' && owner.instance) return this.instanceAlive(owner.instance)
    // A pre-heartbeat owner on another host (e.g. a replaced container) can only be
    // retired by age: its process cannot be inspected from here.
    if (owner.host !== hostname()) {
      try { return Date.now() - statSync(lock).mtimeMs < LEGACY_LOCK_STALE_MS } catch { return true }
    }
    return CleanupStore.alive(owner)
  }
  async waitLocked<T>(work: (data: CleanupData, save: () => void) => Promise<T>): Promise<T> {
    const deadline = Date.now() + 120_000
    for (;;) {
      if (Date.now() >= deadline) throw new CleanupBusy()
      try { return await this.locked(work) }
      catch (e) { if (!(e instanceof CleanupBusy)) throw e; await new Promise(resolve => setTimeout(resolve, 50)) }
    }
  }
  async locked<T>(work: (data: CleanupData, save: () => void) => Promise<T>): Promise<T> {
    mkdirSync(dirname(this.path), { recursive: true })
    const lock = this.path + '.lock'
    // A stale owner is recoverable only after the OS proves that process is gone.
    // PID reuse is conservative: it delays cleanup rather than stealing a live lock.
    const recovery = lock + '.recovery'
    this.heartbeat()
    if (existsSync(recovery)) {
      // Recovery is a few synchronous file operations; an old barrier means its
      // reaper died mid-way and nobody else could ever proceed.
      let age = 0
      try { age = Date.now() - statSync(recovery).mtimeMs } catch { age = 0 }
      if (age < RECOVERY_STALE_MS) throw new CleanupBusy()
      try { unlinkSync(recovery) } catch { throw new CleanupBusy() }
    }
    if (existsSync(lock)) {
      // Only one reaper may inspect/retire an old lock. A crash during recovery
      // leaves a visible barrier requiring inspection, never a stolen live lock.
      let guard: number
      try { guard = openSync(recovery, 'wx', 0o600) } catch { throw new CleanupBusy() }
      closeSync(guard)
      try {
        let owner: Owner | null = null
        try { owner = JSON.parse(readFileSync(lock, 'utf8')) as Owner } catch { owner = null }
        // An empty or unreadable lock has no owner to ask: its creator failed
        // before recording itself (e.g. disk full). Retire it only after it ages.
        if (owner ? this.lockOwnerAlive(owner, lock) : this.lockYoung(lock)) throw new CleanupBusy()
        unlinkSync(lock)
      } finally { unlinkSync(recovery) }
    }
    let fd: number
    try { fd = openSync(lock, 'wx', 0o600) } catch { throw new CleanupBusy() }
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid, host: hostname(), instance: INSTANCE_ID })) }
    catch (error) {
      // Never leave an ownerless lock behind: it would block every task request.
      try { closeSync(fd) } catch { /* already closed */ }
      try { unlinkSync(lock) } catch { /* nothing to remove */ }
      throw error
    }
    closeSync(fd)
    heldLocks.set(lock, (heldLocks.get(lock) ?? 0) + 1)
    try {
      const data = this.read()
      const save = (): void => {
        const tmp = this.path + '.' + randomUUID() + '.tmp'
        const output = openSync(tmp, 'wx', 0o600)
        try { writeFileSync(output, JSON.stringify(data)); fsyncSync(output) } finally { closeSync(output) }
        renameSync(tmp, this.path)
        const directory = openSync(dirname(this.path), 'r')
        try { fsyncSync(directory) } finally { closeSync(directory) }
      }
      return await work(data, save)
    } finally {
      const count = (heldLocks.get(lock) ?? 1) - 1
      if (count > 0) heldLocks.set(lock, count); else heldLocks.delete(lock)
      unlinkSync(lock)
    }
  }
}
