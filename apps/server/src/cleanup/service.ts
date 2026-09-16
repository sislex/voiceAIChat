import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import type { CleanupAttempt, CleanupCandidate, CleanupSnapshot, TemporaryResource } from '@voicechat/shared'
import { CleanupStore, type CleanupData } from './store.js'

/** How many attempts of one task the journal keeps — exactly what `snapshot` shows. */
const ATTEMPT_JOURNAL_PER_TASK = 100

export interface OwnerEvidence {
  terminal: boolean
  outcome: 'success' | 'failed' | 'cancelled' | 'crashed' | 'unknown'
  finishedAt: number | null
  resultsSaved: boolean
  blockers: string[]
}
export interface Inspection {
  present: boolean
  identity: string | null
  gitCommonDir: string | null
  gitRegistration: string | null
  gitRegistrationIdentity?: string | null
  bytes: number | null
  sizeReason: string | null
  reasons: string[]
}
export interface ResourceBackend {
  create(resource: TemporaryResource): Promise<Inspection>
  bind?(resource: TemporaryResource): Promise<Inspection>
  inspect(resource: TemporaryResource): Promise<Inspection>
  remove(resource: TemporaryResource): Promise<{ outcome: CleanupAttempt['outcome']; reason: string; freedBytes: number | null }>
}
export interface CleanupDeps {
  store: CleanupStore
  backend: ResourceBackend
  evidence(resource: TemporaryResource): Promise<OwnerEvidence>
  discover?(): Promise<TemporaryResource[]>
  online(machineId: string): boolean
  removed?(resource: TemporaryResource): Promise<void>
  now?: () => number
  retentionMs?: number
}
export function cleanupDuration(value: string | undefined, fallback: number, minimum = 0): number {
  if (value === undefined) return fallback
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum) throw new Error('Invalid cleanup duration')
  return Number(value)
}
export class TemporaryCleanup {
  private now: () => number
  readonly retentionMs: number
  constructor(readonly deps: CleanupDeps) {
    this.now = deps.now ?? Date.now
    this.retentionMs = deps.retentionMs ?? 7 * 24 * 60 * 60_000
    if (!Number.isSafeInteger(this.retentionMs) || this.retentionMs < 0) throw new Error('Invalid cleanup retention')
  }
  async acquire(taskId: string): Promise<() => Promise<void>> {
    const id = randomUUID()
    await this.deps.store.waitLocked(async (data, save) => {
      data.consumers.push({ id, taskId, pid: process.pid, host: hostname() }); save()
    })
    return async () => {
      // A failed release leaves a conservative persistent consumer, never permission.
      await this.deps.store.waitLocked(async (data, save) => {
        data.consumers = data.consumers.filter(c => c.id !== id); save()
      })
    }
  }
  async consume<T>(taskId: string, work: () => Promise<T>): Promise<T> {
    const release = await this.acquire(taskId)
    try { return await work() } finally { await release() }
  }
  async register(input: Omit<TemporaryResource, 'id' | 'generation' | 'identity' | 'gitCommonDir' | 'gitRegistration' | 'createdAt' | 'state'>): Promise<TemporaryResource> {
    return this.deps.store.waitLocked(async (data, save) => {
      const prior = data.resources.find(r => r.machineId === input.machineId && r.path === input.path && r.state !== 'deleted')
      if (prior) {
        if (prior.taskId !== input.taskId || prior.projectId !== input.projectId || prior.category !== input.category) throw new Error('resource_ownership_conflict')
        if (!prior.identity) throw new Error('resource_ownership_unconfirmed')
        return prior
      }
      const resource: TemporaryResource = { ...input, id: randomUUID(), generation: randomUUID(), identity: null, gitCommonDir: null, gitRegistration: null, createdAt: this.now(), state: 'registered' }
      resource.resultsPath = resource.root + '/.voicechat-cleanup-results/' + resource.id
      // Persist intent before creation. A crash can leave an unconfirmed resource, which is retained.
      data.resources.push(resource); save()
      const created = await this.deps.backend.create(resource)
      resource.identity = created.identity
      resource.gitCommonDir = created.gitCommonDir
      resource.gitRegistration = created.gitRegistration
      save()
      return resource
    })
  }
  async bindWorktree(machineId: string, path: string): Promise<void> {
    await this.deps.store.waitLocked(async (data, save) => {
      const resource = data.resources.find(r => r.machineId === machineId && r.path === path && r.state === 'registered')
      if (!resource || !this.deps.backend.bind) throw new Error('worktree_ownership_unconfirmed')
      const result = await this.deps.backend.bind(resource)
      if (result.reasons.length || result.identity !== resource.identity || !result.gitRegistration) throw new Error('worktree_registration_unconfirmed')
      resource.gitCommonDir = result.gitCommonDir; resource.gitRegistration = result.gitRegistration
      resource.gitRegistrationIdentity = result.gitRegistrationIdentity; save()
    })
  }
  async inspect(resource: TemporaryResource): Promise<CleanupCandidate> {
    const reasons: string[] = []
    let retainUntil: number | null = null
    let inspected: Inspection = { present: true, identity: null, gitCommonDir: null, gitRegistration: null, bytes: null, sizeReason: 'not_inspected', reasons: [] }
    if (!this.deps.online(resource.machineId)) reasons.push('machine_offline')
    else {
      try {
        const owner = await this.deps.evidence(resource)
        if (!owner.terminal) reasons.push('owner_not_terminal')
        if (!owner.resultsSaved) reasons.push('results_not_saved')
        reasons.push(...owner.blockers)
        if (owner.outcome !== 'success') {
          if (owner.finishedAt === null) reasons.push('retention_start_unknown')
          else {
            retainUntil = owner.finishedAt + this.retentionMs
            if (this.now() < retainUntil) reasons.push('diagnostic_retention')
          }
        }
        const consumers = this.deps.store.read().consumers.filter(c => c.taskId === resource.taskId && CleanupStore.alive(c))
        if (consumers.length) reasons.push('active_consumer')
        if (!resource.identity) reasons.push('ownership_unconfirmed')
        inspected = await this.deps.backend.inspect(resource)
        reasons.push(...inspected.reasons)
        if (inspected.sizeReason && inspected.sizeReason !== 'not_inspected') reasons.push(inspected.sizeReason)
        if (inspected.present && resource.identity !== inspected.identity) reasons.push('identity_changed')
      } catch (e) { reasons.push(e instanceof Error ? e.message : String(e)) }
    }
    return { resource, eligible: reasons.length === 0, reasons: [...new Set(reasons)], retainUntil, bytes: inspected.bytes, sizeReason: inspected.sizeReason }
  }
  async snapshot(projectId: string, taskId: string): Promise<CleanupSnapshot> {
    const data = this.deps.store.read()
    const discovered = await this.deps.discover?.() ?? []
    for (const r of discovered) if (!data.resources.some(known => known.machineId === r.machineId && known.path === r.path)) data.resources.push(r)
    return {
      candidates: await Promise.all(data.resources.filter(r => r.projectId === projectId && r.taskId === taskId && r.state !== 'deleted').map(r => this.inspect(r))),
      attempts: data.attempts.filter(a => a.resource.projectId === projectId && a.resource.taskId === taskId).slice(-ATTEMPT_JOURNAL_PER_TASK).reverse()
    }
  }
  async cycle(taskId?: string): Promise<void> {
    // Discovery and the registry merge are a short critical section; the expensive
    // part of a sweep — remote inspection of every resource — runs without the lock.
    // Holding it across inspections made the registry busy for as long as the whole
    // sweep, and every task-scoped mutation waits for that same lock to register its
    // consumer: opening a task chat or retrying a run hung for a minute or more and
    // then failed with `cleanup_or_consumer_busy`.
    const pending = await this.deps.store.waitLocked(async (data, save) => {
      for (const r of await this.deps.discover?.() ?? []) {
        if (!data.resources.some(known => known.machineId === r.machineId && known.path === r.path)) { data.resources.push(r); save() }
      }
      return data.resources.filter(r => r.state !== 'deleted' && (!taskId || r.taskId === taskId)).map(r => structuredClone(r))
    })
    for (const preview of pending) {
      // Unlocked evidence only selects candidates. Nothing is deleted on its word:
      // the decision is retaken below under the lock, so a consumer that registers
      // meanwhile is still seen before the destructive request goes out.
      const candidate = await this.inspect(preview)
      if (!candidate.eligible) {
        await this.journal({ id: randomUUID(), resource: structuredClone(preview), at: this.now(), reason: candidate.reasons.join(', ') || 'owner_completed',
          outcome: candidate.reasons.some(r => /offline|unknown|busy|error|unavailable/.test(r)) ? 'deferred' : 'skipped', error: null, freedBytes: null })
        continue
      }
      // The same lock covers final evidence, remote deletion and registration of consumers.
      await this.deps.store.waitLocked(async (data, save) => {
        const resource = data.resources.find(r => r.id === preview.id)
        if (!resource || resource.state === 'deleted') return
        const attempt: CleanupAttempt = { id: randomUUID(), resource: structuredClone(resource), at: this.now(), reason: candidate.reasons.join(', ') || 'owner_completed', outcome: 'skipped', error: null, freedBytes: null }
        const fresh = await this.inspect(resource)
        if (!fresh.eligible) {
          attempt.reason = fresh.reasons.join(', ')
          attempt.outcome = 'deferred'; this.remember(data, attempt); save(); return
        }
        resource.state = 'deleting'
        // Persist the ambiguous interval before sending a destructive request.
        attempt.outcome = 'deferred'; attempt.reason = 'deletion_confirmation_pending'
        this.remember(data, attempt); save()
        try {
          const result = await this.deps.backend.remove(resource)
          Object.assign(attempt, result)
          if (result.outcome === 'deleted' || result.outcome === 'absent') {
            // Notification/DB reconciliation is retried if it fails after filesystem deletion.
            await this.deps.removed?.(resource)
            resource.state = 'deleted'
          }
        } catch (e) {
          attempt.outcome = 'deferred'; attempt.error = e instanceof Error ? e.message : String(e)
          attempt.reason = 'deletion_confirmation_unknown'; attempt.freedBytes = null
        }
        save()
      })
    }
  }
  /** Journal a decision that changes nothing else: the lock is held for the write alone. */
  private async journal(attempt: CleanupAttempt): Promise<void> {
    await this.deps.store.waitLocked(async (data, save) => { this.remember(data, attempt); save() })
  }
  /**
   * The registry is read, rewritten and fsynced in full under the lock on every
   * change, including the two writes each task-scoped request makes. An unbounded
   * journal therefore taxes every request forever: a skipped sweep appends an
   * attempt per resource per minute, which is why retention matches what the API
   * shows — the last attempts of each task.
   */
  private remember(data: CleanupData, attempt: CleanupAttempt): void {
    data.attempts.push(attempt)
    const perTask = new Map<string, number>()
    const kept: CleanupAttempt[] = []
    for (let i = data.attempts.length - 1; i >= 0; i--) {
      const entry = data.attempts[i]
      const count = (perTask.get(entry.resource.taskId) ?? 0) + 1
      perTask.set(entry.resource.taskId, count)
      if (count <= ATTEMPT_JOURNAL_PER_TASK) kept.push(entry)
    }
    data.attempts = kept.reverse()
  }
}
