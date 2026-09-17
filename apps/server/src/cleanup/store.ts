import { closeSync, fsyncSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { CleanupAttempt, TemporaryResource } from '@voicechat/shared'

export interface Consumer { id: string; taskId: string; pid: number; host: string }
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
  static alive(consumer: { pid: number; host: string }): boolean {
    if (consumer.host !== hostname() || !Number.isSafeInteger(consumer.pid) || consumer.pid < 1) return true
    try { process.kill(consumer.pid, 0); return true }
    catch (e) { return (e as NodeJS.ErrnoException).code !== 'ESRCH' }
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
    if (existsSync(recovery)) throw new CleanupBusy()
    if (existsSync(lock)) {
      // Only one reaper may inspect/retire an old lock. A crash during recovery
      // leaves a visible barrier requiring inspection, never a stolen live lock.
      let guard: number
      try { guard = openSync(recovery, 'wx', 0o600) } catch { throw new CleanupBusy() }
      closeSync(guard)
      try {
        let owner: { pid: number; host: string }
        try { owner = JSON.parse(readFileSync(lock, 'utf8')) } catch { throw new CleanupBusy() }
        if (CleanupStore.alive(owner)) throw new CleanupBusy()
        unlinkSync(lock)
      } finally { unlinkSync(recovery) }
    }
    let fd: number
    try { fd = openSync(lock, 'wx', 0o600) } catch { throw new CleanupBusy() }
    writeFileSync(fd, JSON.stringify({ pid: process.pid, host: hostname() }))
    closeSync(fd)
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
    } finally { unlinkSync(lock) }
  }
}
