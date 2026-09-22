import type { FastifyInstance } from 'fastify'
import type { VoiceChatDb } from '../db/database.js'
import type { KanbanMachines } from '../kanban/core.js'
import type { FeaturePreviewManager } from '../preview/manager.js'
import { isTerminalCiStatus, ACTIVE_MERGE_STATUSES, QA_RUN_STAGES, isMachineStoragePathAllowed } from '@voicechat/shared'
import { join, dirname } from 'node:path'
import { uid } from "@sislexa/identity/server/users/auth"
import { CleanupStore, CleanupBusy } from './store.js'
import { TemporaryCleanup, cleanupDuration } from './service.js'
import { RemoteResourceBackend } from './remote.js'

export function createTemporaryCleanup(db: VoiceChatDb, machines: KanbanMachines, dataDir: string, previews: () => FeaturePreviewManager | undefined, changed: (projectId: string, taskId: string) => void): TemporaryCleanup {
  return new TemporaryCleanup({
    store: new CleanupStore(join(dataDir, 'temporary-resources.json')),
    backend: new RemoteResourceBackend(async (id, command) => { const result = await machines.exec(id, command, 120_000); return { ...result, stdout: result.output } }),
    retentionMs: cleanupDuration(process.env.VC_TEMP_DIAGNOSTIC_RETENTION_MS, 7 * 24 * 60 * 60_000),
    online: id => machines.isOnline(id),
    discover: async () => (await db.tasks.listCleanupRepositoryCandidates()).filter(repo => repo.kind === 'dev-workspace').map(repo => ({
      id: 'legacy-' + repo.id, projectId: repo.projectId, taskId: repo.taskId, runId: null, userId: '',
      machineId: repo.agentId, machineName: repo.machineName ?? repo.agentId, path: repo.path, root: dirname(repo.path),
      category: 'task-environment' as const, generation: 'unconfirmed', identity: null, gitCommonDir: null,
      gitRegistration: null, createdAt: repo.createdAt, state: 'registered' as const
    })),
    evidence: async resource => {
      const runs = await db.ci.listCiRunsForTask(resource.userId, resource.projectId, resource.taskId)
      const merges = await db.ci.listMergeRuns(resource.userId, resource.projectId, resource.taskId, 1000)
      const blockers: string[] = []
      if (!isMachineStoragePathAllowed(resource.path, machines.policyOf(resource.machineId)?.allowedDirs ?? [], machines.platformOf(resource.machineId) ?? 'linux')) blockers.push('path_policy_denied')
      const component = await db.tasks.getComponentQaTaskState(resource.userId, resource.projectId, resource.taskId)
      if (component?.activeRun) blockers.push('component_qa_consumer')
      for (const stage of QA_RUN_STAGES) {
        const qa = await db.qa.listQaStageRuns(resource.userId, resource.projectId, resource.taskId, stage)
        if (qa.some(run => ['queued', 'running', 'awaiting_input'].includes(run.status))) blockers.push('qa_consumer')
      }
      if (runs.some(run => !isTerminalCiStatus(run.status))) blockers.push('active_run')
      if (merges.some(run => ACTIVE_MERGE_STATUSES.includes(run.status))) blockers.push('active_merge')
      const preview = previews()?.list().filter(env => env.taskId === resource.taskId) ?? []
      if (preview.some(env => !['removed', 'stopped', 'not_created'].includes(env.state) || (env.workspacePath === resource.path && env.state !== 'removed'))) blockers.push('preview_consumer')
      const owner = resource.category === 'merge-worktree'
        ? await db.ci.getMergeRunRaw(resource.runId!)
        : resource.runId ? (await db.ci.getCiRunRaw(resource.runId) ?? await db.ci.getMergeRunRaw(resource.runId)) : null
      if (resource.runId) {
        const success = owner?.status === 'success'
        const failed = owner?.status === 'failed'
        const cancelled = owner?.status === 'cancelled'
        const crashed = owner?.status === 'interrupted'
        if (!owner || owner.projectId !== resource.projectId || owner.taskId !== resource.taskId || owner.agentId !== resource.machineId) blockers.push('owner_identity_unconfirmed')
        return { terminal: success || failed || cancelled || crashed, outcome: success ? 'success' : failed ? 'failed' : cancelled ? 'cancelled' : crashed ? 'crashed' : 'unknown',
          finishedAt: owner?.finishedAt ?? null, resultsSaved: !!owner?.finishedAt, blockers }
      }
      // A missing task is not proof of completion or preserved results.
      const task = await db.tasks.getCiTask(resource.userId, resource.projectId, resource.taskId)
      const closed = !!task && await db.tasks.isTaskClosed(resource.taskId)
      const latestOwner = [...runs, ...merges].sort((a, b) => b.createdAt - a.createdAt)[0]
      const success = latestOwner?.status === 'success'
      return { terminal: closed, outcome: success ? 'success' : 'failed', finishedAt: latestOwner?.finishedAt ?? null,
        resultsSaved: closed && !!latestOwner?.finishedAt, blockers }
    },
    removed: async resource => {
      if (resource.category === 'task-environment') await db.tasks.markTaskRepositoryDeleted(resource.taskId, resource.machineId, resource.path)
      changed(resource.projectId, resource.taskId)
    }
  })
}
export function registerCleanupRoutes(app: FastifyInstance, db: VoiceChatDb, cleanup: TemporaryCleanup): void {
  const releases = new WeakMap<object, () => Promise<void>>()
  app.addHook('preHandler', async (req, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return
    const taskMatch = /^\/api\/projects\/[^/]+\/tasks\/([^/?]+)/.exec(req.url)
    const runMatch = /^\/api\/(ci|merge)\/runs\/([^/?]+)/.exec(req.url)
    let taskId = taskMatch ? decodeURIComponent(taskMatch[1]) : null
    if (!taskId && runMatch && req.user) {
      const run = runMatch[1] === 'merge' ? await db.ci.getMergeRun(req.user.name, runMatch[2]) : (await db.ci.getCiRun(req.user.name, runMatch[2]))?.run
      taskId = run?.taskId ?? null
    }
    if (!taskId) return
    try {
      releases.set(req, await cleanup.acquire(taskId))
    } catch (error) {
      // A busy registry is a temporary state of the cleanup sweep, not a broken
      // request: 500 told clients (and people) that their retry itself failed.
      if (!(error instanceof CleanupBusy)) throw error
      await reply.code(503).header('retry-after', '5').send({ error: 'cleanup_or_consumer_busy' })
      return reply
    }
  })
  app.addHook('onResponse', async req => { const release = releases.get(req); releases.delete(req); await release?.() })
  app.get<{ Params: { projectId: string; taskId: string } }>('/api/projects/:projectId/tasks/:taskId/temporary-resources', async (req, reply) => {
    const { projectId, taskId } = req.params
    if (!await db.tasks.getCiTask(uid(req), projectId, taskId)) return reply.code(404).send({ error: 'not found' })
    return cleanup.snapshot(projectId, taskId)
  })
}
export function startTemporaryCleanup(app: FastifyInstance, cleanup: TemporaryCleanup): void {
  const interval = cleanupDuration(process.env.VC_TEMP_CLEANUP_INTERVAL_MS, 60_000, 1000)
  let running = false
  const tick = async (): Promise<void> => {
    if (running) return
    running = true
    try { await cleanup.cycle() } catch (e) { app.log.warn({ err: e }, 'Temporary cleanup deferred') }
    finally { running = false }
  }
  // Reconnects are retried by the same bounded interval, without a second policy.
  const timer = setInterval(() => void tick(), interval)
  timer.unref()
  app.addHook('onClose', async () => { clearInterval(timer) })
  void tick()
}
