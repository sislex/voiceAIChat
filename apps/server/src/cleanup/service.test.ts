import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import type { TemporaryCategory, TemporaryResource } from '@voicechat/shared'
import { CleanupStore } from './store.js'
import { TemporaryCleanup, cleanupDuration, type Inspection, type OwnerEvidence, type ResourceBackend } from './service.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cleanup-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })
const gate = () => { let resolve!: () => void; return { promise: new Promise<void>(r => { resolve = r }), release: () => resolve() } }
function fixture() {
  let now = 1000, online = true
  const owner: OwnerEvidence = { terminal: true, outcome: 'success', finishedAt: 1000, resultsSaved: true, blockers: [] }
  const files = new Map<string, string>()
  const inspection = (r: TemporaryResource): Inspection => ({ present: files.has(r.path), identity: files.get(r.path) ?? null, gitCommonDir: null, gitRegistration: null, bytes: files.has(r.path) ? 42 : 0, sizeReason: null, reasons: [] })
  const backend: ResourceBackend = {
    create: vi.fn(async r => { files.set(r.path, r.generation); return inspection(r) }),
    inspect: vi.fn(async r => inspection(r)),
    remove: vi.fn(async r => { const present = files.delete(r.path); return { outcome: present ? 'deleted' as const : 'absent' as const, reason: 'checked', freedBytes: present ? 42 : 0 } })
  }
  const store = new CleanupStore(join(dir, 'registry.json'))
  const deps = { store, backend, evidence: async () => structuredClone(owner), online: () => online, now: () => now, retentionMs: 100, removed: vi.fn(async () => {}) }
  const service = new TemporaryCleanup(deps)
  const register = (category: TemporaryCategory = 'process', suffix = '') => service.register({ projectId: 'p', taskId: 't', runId: 'run', userId: 'u', machineId: 'm', machineName: 'MacBook', path: '/owned/' + category + suffix, root: '/owned', category })
  return { service, deps, owner, backend, store, files, register, clock: (n: number) => { now = n }, online: (v: boolean) => { online = v } }
}
// @testCase TC-01
it.each(['process', 'merge-worktree', 'task-environment'] as const)('cleans %s only after owner, processes, consumers and results are released', async category => {
  const f = fixture()
  const resource = await f.register(category)
  f.owner.terminal = false
  await f.service.cycle(); expect(f.files.has(resource.path)).toBe(true)
  f.owner.terminal = true; f.owner.resultsSaved = false
  await f.service.cycle(); expect(f.files.has(resource.path)).toBe(true)
  f.owner.resultsSaved = true; f.owner.blockers = ['active_process']
  await f.service.cycle(); expect(f.files.has(resource.path)).toBe(true)
  f.owner.blockers = []
  await f.service.consume('t', async () => { await f.service.cycle(); expect(f.files.has(resource.path)).toBe(true) })
  await f.service.cycle()
  expect(f.files.has(resource.path)).toBe(false)
  expect(f.deps.removed).toHaveBeenCalledOnce()
  expect(f.store.read().attempts.at(-1)).toMatchObject({ outcome: 'deleted', freedBytes: 42, resource: { machineId: 'm', taskId: 't', runId: 'run' } })
})
// @testCase TC-02
it.each(['failed', 'cancelled', 'crashed'] as const)('recovers %s across restart with retention boundaries', async outcome => {
  const f = fixture(); await f.register()
  f.owner.outcome = outcome; f.clock(1099)
  const restarted = new TemporaryCleanup({ ...f.deps, store: new CleanupStore(f.store.path) })
  await restarted.cycle(); expect(f.backend.remove).not.toHaveBeenCalled()
  f.clock(1100); await restarted.cycle(); expect(f.backend.remove).toHaveBeenCalledOnce()
})
// @testCase TC-02
it('recovers stale consumers only after their process is proven absent and still checks remote state', async () => {
  const f = fixture(); await f.register()
  await f.store.locked(async (data, save) => { data.consumers.push({ id: 'orphan', taskId: 't', pid: 2147483647, host: hostname() }); save() })
  f.owner.blockers = ['process_state_unknown']
  await f.service.cycle(); expect(f.backend.remove).not.toHaveBeenCalled()
  f.owner.blockers = []; await f.service.cycle(); expect(f.backend.remove).toHaveBeenCalledOnce()
})
// @testCase TC-03
it('serializes two cleanup executors and a preview/restart arriving at the deletion barrier', async () => {
  const f = fixture(); await f.register()
  const entered = gate(), finish = gate()
  vi.mocked(f.backend.remove).mockImplementationOnce(async r => { entered.release(); await finish.promise; f.files.delete(r.path); return { outcome: 'deleted', reason: 'checked', freedBytes: 42 } })
  const first = f.service.cycle()
  await entered.promise
  const work = vi.fn(async () => { expect(f.store.read().resources[0].state).toBe('deleted') })
  const second = new TemporaryCleanup({ ...f.deps, store: new CleanupStore(f.store.path) }).cycle()
  const preview = f.service.consume('t', work)
  await Promise.resolve(); expect(work).not.toHaveBeenCalled()
  finish.release(); await Promise.all([first, second, preview])
  expect(f.backend.remove).toHaveBeenCalledOnce()
})
// @testCase TC-03
it('preserves a resource acquired before cleanup starts and rejects foreign reuse', async () => {
  const f = fixture(); const r = await f.register()
  await f.service.consume('t', async () => { await f.service.cycle(); expect(f.backend.remove).not.toHaveBeenCalled() })
  await expect(f.service.register({ ...r, taskId: 'foreign' })).rejects.toThrow('ownership_conflict')
})
// @testCase TC-04
it('retains unknown resources and replaced identities regardless of age', async () => {
  const f = fixture(); const r = await f.register()
  f.files.set(r.path, 'foreign-inode')
  await f.service.cycle(); expect(f.backend.remove).not.toHaveBeenCalled()
  expect(f.store.read().attempts.at(-1)?.reason).toContain('identity_changed')
})
// @testCase TC-06
it('defers offline and reconciles a lost deletion acknowledgement without counting space twice', async () => {
  const f = fixture(); await f.register(); f.online(false)
  await f.service.cycle(); expect(f.backend.remove).not.toHaveBeenCalled()
  f.online(true)
  vi.mocked(f.backend.remove).mockImplementationOnce(async r => { f.files.delete(r.path); throw new Error('connection lost') })
  await f.service.cycle()
  expect(f.store.read().resources[0].state).toBe('deleting')
  const restarted = new TemporaryCleanup(f.deps)
  await restarted.cycle()
  expect(f.store.read().attempts.map(a => a.freedBytes)).toEqual([null, null, 0])
  expect(f.store.read().attempts.at(-1)?.outcome).toBe('absent')
})
// @testCase TC-06
it('does not reuse an unconfirmed creation intent after an acknowledgement failure', async () => {
  const f = fixture()
  vi.mocked(f.backend.create).mockRejectedValueOnce(new Error('connection lost'))
  await expect(f.register()).rejects.toThrow('connection lost')
  await expect(f.register()).rejects.toThrow('resource_ownership_unconfirmed')
  expect(f.store.read().resources[0].identity).toBeNull()
  await f.service.cycle()
  expect(f.backend.remove).not.toHaveBeenCalled()
})
// @testCase TC-06
it('records a partial failure, retries idempotently, and does not mark the repository deleted early', async () => {
  const f = fixture(); await f.register('task-environment')
  vi.mocked(f.backend.remove).mockResolvedValueOnce({ outcome: 'partial', reason: 'permission_denied', freedBytes: null })
  await f.service.cycle()
  expect(f.deps.removed).not.toHaveBeenCalled()
  expect(f.store.read().attempts.at(-1)?.outcome).toBe('partial')
  await f.service.cycle(); expect(f.deps.removed).toHaveBeenCalledOnce()
})
// @testCase TC-03
it('rechecks owner and retention after selection instead of trusting preview eligibility', async () => {
  const f = fixture(); await f.register()
  let checks = 0
  f.deps.evidence = async () => ({ ...f.owner, terminal: ++checks === 1 })
  await f.service.cycle()
  expect(f.backend.remove).not.toHaveBeenCalled()
  expect(f.store.read().attempts.at(-1)).toMatchObject({ outcome: 'deferred', reason: 'owner_not_terminal' })
})
// @testCase TC-07
it('previews without writing registry/journal or deleting files and explains unknown size', async () => {
  const f = fixture(); await f.register()
  const saved = readFileSync(f.store.path, 'utf8')
  vi.mocked(f.backend.inspect).mockResolvedValue({ present: true, identity: null, gitCommonDir: null, gitRegistration: null, bytes: null, sizeReason: 'permission_denied', reasons: ['permission_denied'] })
  const view = await f.service.snapshot('p', 't')
  expect(view.candidates[0]).toMatchObject({ bytes: null, sizeReason: 'permission_denied', eligible: false })
  expect(readFileSync(f.store.path, 'utf8')).toBe(saved)
  expect(f.backend.remove).not.toHaveBeenCalled()
  expect(await f.service.snapshot('foreign', 't')).toEqual({ candidates: [], attempts: [] })
})
// @testCase TC-02
it('does not silently reset a damaged persistent registry and validates settings', async () => {
  const f = fixture(); writeFileSync(f.store.path, '{broken')
  await expect(f.service.cycle()).rejects.toThrow()
  for (const value of ['-1', '1.5', 'NaN', 'Infinity', '']) expect(() => cleanupDuration(value, 100)).toThrow()
  expect(cleanupDuration('0', 100)).toBe(0)
})
