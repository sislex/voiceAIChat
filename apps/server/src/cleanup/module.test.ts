import { afterEach, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TemporaryResource } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import type { KanbanMachines } from '../kanban/core.js'
import type { FeaturePreviewManager } from '../preview/manager.js'
import type { TemporaryCleanup } from './service.js'
import { CleanupBusy } from './store.js'
import { createTemporaryCleanup, startTemporaryCleanup, registerCleanupRoutes } from './module.js'

const directories: string[] = []
afterEach(() => { vi.useRealTimers(); for (const d of directories.splice(0)) rmSync(d, { recursive: true, force: true }) })
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'cleanup-module-')); directories.push(directory)
  const owner = { id: 'r', taskId: 't', projectId: 'p', agentId: 'm', status: 'success', finishedAt: 100, createdAt: 1 }
  let ciRuns: object[] = [], mergeRuns: object[] = [], previews: object[] = [], qaRuns: object[] = []
  const db = {
    tasks: { getCiTask: async () => ({ id: 't' }), isTaskClosed: async () => true, getComponentQaTaskState: async () => null, listCleanupRepositoryCandidates: async () => [] },
    ci: { listCiRunsForTask: async () => ciRuns, listMergeRuns: async () => mergeRuns, getCiRunRaw: async () => owner, getMergeRunRaw: async () => owner },
    qa: { listQaStageRuns: async () => qaRuns }
  } as unknown as VoiceChatDb
  const machines = { isOnline: () => true, policyOf: () => ({ allowedDirs: ['/managed'] }), platformOf: () => 'linux' } as unknown as KanbanMachines
  const cleanup = createTemporaryCleanup(db, machines, directory, () => ({ list: () => previews }) as FeaturePreviewManager, () => {})
  const resource: TemporaryResource = { id: 'i', projectId: 'p', taskId: 't', runId: 'r', userId: 'u', machineId: 'm', machineName: 'M', root: '/managed', path: '/managed/resource', category: 'process', generation: 'g', identity: '1:2', gitCommonDir: null, gitRegistration: null, createdAt: 1, state: 'registered' }
  return { cleanup, resource, owner, ci: (v: object[]) => { ciRuns = v }, merge: (v: object[]) => { mergeRuns = v }, preview: (v: object[]) => { previews = v }, qa: (v: object[]) => { qaRuns = v } }
}
// @testCase TC-01
it('uses actual lifecycle evidence for CI, merge, QA, preview and owner identity', async () => {
  const f = fixture(), evidence = () => f.cleanup.deps.evidence(f.resource)
  expect(await evidence()).toMatchObject({ terminal: true, resultsSaved: true, blockers: [] })
  f.ci([{ status: 'running' }]); expect((await evidence()).blockers).toContain('active_run'); f.ci([])
  for (const status of ['deploying', 'production_checks', 'rolling_back']) {
    f.merge([{ status }]); expect((await evidence()).blockers).toContain('active_merge')
  }
  f.merge([]); f.qa([{ status: 'running' }]); expect((await evidence()).blockers).toContain('qa_consumer'); f.qa([])
  f.preview([{ taskId: 't', workspacePath: f.resource.path, state: 'stopped' }])
  expect((await evidence()).blockers).toContain('preview_consumer'); f.preview([])
  f.owner.agentId = 'foreign'; expect((await evidence()).blockers).toContain('owner_identity_unconfirmed')
})
// @testCase TC-02
it('recognizes interrupted owners but retains decision-required merge ownership', async () => {
  const f = fixture()
  f.owner.status = 'interrupted'
  expect(await f.cleanup.deps.evidence(f.resource)).toMatchObject({ terminal: true, outcome: 'crashed', finishedAt: 100 })
  f.resource.category = 'merge-worktree'; f.owner.status = 'decision_required'
  expect(await f.cleanup.deps.evidence(f.resource)).toMatchObject({ terminal: false, outcome: 'unknown' })
})
// @testCase TC-02
it('runs the same recovery cycle on startup and periodically and stops scheduling on close', async () => {
  vi.useFakeTimers()
  const app = Fastify(), cycle = vi.fn(async () => {})
  startTemporaryCleanup(app, { cycle } as unknown as TemporaryCleanup)
  await vi.advanceTimersByTimeAsync(120000)
  expect(cycle).toHaveBeenCalledTimes(3)
  await app.close(); await vi.advanceTimersByTimeAsync(120000)
  expect(cycle).toHaveBeenCalledTimes(3)
})
// @testCase TC-03
it('holds HTTP restart and preview mutations behind resource admission and releases after response', async () => {
  const app = Fastify()
  let enter!: () => void
  const barrier = new Promise<void>(resolve => { enter = resolve })
  const release = vi.fn(async () => {}), handler = vi.fn(async () => ({ ok: true }))
  const acquire = vi.fn(async () => { await barrier; return release })
  registerCleanupRoutes(app, {} as VoiceChatDb, { acquire } as unknown as TemporaryCleanup)
  app.post('/api/projects/p/tasks/t/preview', handler)
  const response = app.inject({ method: 'POST', url: '/api/projects/p/tasks/t/preview' })
  await vi.waitFor(() => expect(acquire).toHaveBeenCalledWith('t'))
  expect(handler).not.toHaveBeenCalled()
  enter()
  expect((await response).statusCode).toBe(200)
  expect(handler).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce()
  await app.close()
})
// @testCase TC-03
it('answers a busy registry with a retryable 503 instead of a server error', async () => {
  const app = Fastify()
  const acquire = vi.fn(async () => { throw new CleanupBusy() })
  registerCleanupRoutes(app, {} as VoiceChatDb, { acquire } as unknown as TemporaryCleanup)
  const handler = vi.fn(async () => ({ ok: true }))
  app.post('/api/projects/p/tasks/t/preview', handler)
  const response = await app.inject({ method: 'POST', url: '/api/projects/p/tasks/t/preview' })
  expect(response.statusCode).toBe(503)
  expect(response.json()).toEqual({ error: 'cleanup_or_consumer_busy' })
  expect(response.headers['retry-after']).toBe('5')
  expect(handler).not.toHaveBeenCalled()
  await app.close()
})
