import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { registerProjectRoutes } from '../routes/projects.js'
import { BoardHub } from '../projects/boardHub.js'
import { recommendedProjectMachineDirectories, type ProjectMachineDirectoryAssignments, type MergeRunStatus, type ServerMessage } from '@voicechat/shared'
import { VoiceChatDb } from '../db/database.js'
import { MergeRunManager } from './runManager.js'
import type { CommandExecutor } from '../ci/types.js'

let db: VoiceChatDb
let directory: string
let projectId: string, taskId: string, id: string, a: string, b: string, c: string
let manager: MergeRunManager
let executor: CommandExecutor
let online: boolean
const events: Array<{ message: ServerMessage; user: string }> = []
const boardChanged = vi.fn()
const raw = () => (db as unknown as { db: { prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] } } }).db
function makeManager() {
  return new MergeRunManager({ db, executor, isOnline: () => online,
    broadcast: (message, user) => events.push({ message, user }), boardChanged })
}
function barrier() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
async function change(agentId = b, expectedAssignmentVersion = 0, user = 'owner') {
  return manager.changeMachine(id, user, { agentId, expectedAssignmentVersion })
}
async function snapshot() { return (await db.ci.getMergeRun('owner', id))! }
function audits() { return raw().prepare("SELECT * FROM qa_audit WHERE action='merge.machine_changed'").all() as Array<{ payload_json: string; actor: string }> }

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'merge-reassignment-'))
  db = new VoiceChatDb(join(directory, 'db.sqlite'))
  await db.ready
  await db.identity.createUser('owner', '', 'developer')
  await db.identity.createUser('viewer', '', 'observer')
  await db.identity.createUser('stranger', '', 'developer')
  const project = await db.projects.createProject('owner', { name: 'Reassignment', gitUrl: 'git@example/repo.git' })
  projectId = project.id
  await db.projects.addMember('owner', projectId, 'viewer')
  const board = (await db.tasks.getBoard('owner', projectId))!
  const task = (await db.tasks.createTask('owner', projectId, { columnId: board.columns.find(column => column.semanticType === 'awaiting_merge')!.id, title: 'Queued task' }))!
  taskId = task.id
  const agents = []
  for (const name of ['A', 'B', 'C']) {
    const agent = await db.machines.createAgent('owner', name)
    await db.machines.linkMachine('owner', projectId, agent.id)
    await db.machines.setProjectMachineReposRoot('owner', projectId, agent.id, '/repos')
    agents.push(agent.id)
  }
  ;[a, b, c] = agents
  raw().prepare('INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('workspace', projectId, taskId, a, '/repos/project/task', 'CHAT-475', '1'.repeat(40), 1, 'released', 1)
  const run = await db.ci.startMergeRun('owner', projectId, taskId)
  id = run.id
  raw().prepare('UPDATE tasks SET auto_pilot=1,auto_pilot_requires_manual_qa=0 WHERE id=?').run(taskId)
  await db.ci.updateMergeRun(id, { targetSha: '2'.repeat(40), log: 'existing log', stages: [{ stage: 'queued', status: 'queued', startedAt: null, finishedAt: null, durationMs: null, exitCode: null, timedOut: false, message: 'waiting', log: 'stage log' }] })
  online = true
  executor = { run: vi.fn(async (_request, onChunk) => {
    await onChunk('1'.repeat(40) + '\trefs/heads/CHAT-475\n' + '2'.repeat(40) + '\trefs/heads/main\n')
    return { exitCode: 0, timedOut: false }
  }) }
  manager = makeManager()
  events.length = 0; boardChanged.mockClear()
})
afterEach(async () => { vi.restoreAllMocks(); await db.close(); rmSync(directory, { recursive: true, force: true }) })

describe('queued merge machine reassignment', () => {
  // @testCase TC-API-01
  it('exposes success, precise HTTP conflicts and authorization through the real route', async () => {
    const app = Fastify()
    app.addHook('preHandler', async request => {
      const name = String(request.headers['x-test-user'] ?? 'owner')
      request.user = { name, role: name === 'viewer' ? 'observer' : 'developer' }
    })
    registerProjectRoutes(app, db, new BoardHub(), undefined, undefined, undefined, manager)
    const url = `/api/merge/runs/${id}/machine`
    const payload = { agentId: b, expectedAssignmentVersion: 0 }
    try {
      expect((await app.inject({ method: 'POST', url, payload: { agentId: b } })).statusCode).toBe(400)
      const denied = await app.inject({ method: 'POST', url, payload, headers: { 'x-test-user': 'stranger' } })
      expect(denied.statusCode).toBe(404); expect(denied.json()).not.toHaveProperty('run')
      expect((await app.inject({ method: 'POST', url, payload, headers: { 'x-test-user': 'viewer' } })).statusCode).toBe(403)
      const success = await app.inject({ method: 'POST', url, payload })
      expect(success.statusCode).toBe(200)
      expect(success.json()).toMatchObject({ ok: true, run: { id, agentId: b } })
      const stale = await app.inject({ method: 'POST', url, payload })
      expect(stale.statusCode).toBe(409)
      expect(stale.json()).toMatchObject({ ok: false, code: 'assignment_changed', run: { id, assignmentVersion: 1 } })
      await db.ci.claimQueuedMergeRun(id)
      const started = await app.inject({ method: 'POST', url, payload: { agentId: c, expectedAssignmentVersion: 1 } })
      expect(started.statusCode).toBe(409)
      expect(started.json()).toMatchObject({ code: 'not_queued', run: { status: 'checking' } })
    } finally { await app.close() }
  })

  // @testCase TC-API-01
  // @testCase TC-INT-03
  it('preserves the run and task, commits one audit, and publishes to both authorized viewers', async () => {
    const before = await snapshot()
    const task = await db.tasks.getCiTask('owner', projectId, taskId)
    const taskRow = raw().prepare('SELECT * FROM tasks WHERE id=?').get(taskId)
    expect(await change()).toMatchObject({ ok: true, run: { id, agentId: b, machineName: 'B', assignmentVersion: 1, status: 'queued' } })
    const after = await snapshot()
    expect({ ...after, agentId: before.agentId, machineName: before.machineName, assignmentVersion: before.assignmentVersion }).toEqual(before)
    expect(await db.tasks.getCiTask('owner', projectId, taskId)).toEqual(task)
    expect(raw().prepare('SELECT * FROM tasks WHERE id=?').get(taskId)).toEqual(taskRow)
    expect(taskRow).toMatchObject({ auto_pilot: 1, auto_pilot_requires_manual_qa: 0 })
    expect(audits()).toHaveLength(1)
    expect(JSON.parse(audits()[0].payload_json)).toMatchObject({ runId: id, oldAgentId: a, newAgentId: b, actor: 'owner', reason: 'user_requested', at: expect.any(Number) })
    expect(events.map(event => event.user).sort()).toEqual(['owner', 'viewer'])
    expect(events.every(event => event.message.t === 'merge.snapshot' && event.message.run.agentId === b)).toBe(true)
    expect(boardChanged).toHaveBeenCalledWith(projectId)
    expect(await db.ci.listMergeRuns('viewer', projectId, taskId)).toEqual([after])
    expect(await change(b, 1)).toMatchObject({ ok: true })
    expect(await change()).toMatchObject({ ok: false, code: 'assignment_changed' })
    expect(audits()).toHaveLength(1)
  })

  // @testCase TC-API-01
  it.each<MergeRunStatus>(['checking','fetching','merging','resolving_conflicts','kb_update','testing','pushing','deploying','production_checks','rolling_back','success','failed','cancelled','decision_required','timeout'])('rejects %s with the current authorized snapshot', async status => {
    await db.ci.updateMergeRun(id, { status })
    const before = await snapshot()
    expect(await change()).toEqual({ ok: false, code: 'not_queued', error: 'Ран больше не находится в очереди', run: before })
    expect(await snapshot()).toEqual(before)
    expect(audits()).toHaveLength(0)
    expect(executor.run).not.toHaveBeenCalled()
  })

  // @testCase TC-NEG-01
  it('rejects a non-member, an observer and a machine outside the project without disclosing a snapshot', async () => {
    expect(await change(b, 0, 'stranger')).toMatchObject({ ok: false, code: 'not_found' })
    expect(await change(b, 0, 'viewer')).toMatchObject({ ok: false, code: 'forbidden' })
    const outside = await db.machines.createAgent('owner', 'outside')
    const result = await change(outside.id)
    expect(result).toMatchObject({ ok: false, code: 'forbidden' })
    expect(result).not.toHaveProperty('run')
    expect((await snapshot()).agentId).toBe(a)
    expect(audits()).toHaveLength(0)
    expect(executor.run).not.toHaveBeenCalled()
  })

  // @testCase TC-NEG-01
  it.each(['machine_offline','storage_missing','storage_not_found','storage_marker_invalid','storage_path_invalid','storage_policy_denied','storage_symlink','storage_read_only','clone_invalid','git_unavailable'] as const)('does not mutate on %s preflight failure', async code => {
    const before = await snapshot()
    vi.spyOn(manager, 'checkReadiness').mockResolvedValue({ ready: false, selectable: false, mode: 'managed', code, message: code })
    expect(await change()).toMatchObject({ ok: false, code: 'readiness_failed', readiness: { code } })
    expect(await snapshot()).toEqual(before)
    expect(audits()).toHaveLength(0)
  })

  // @testCase TC-NEG-01
  it.each(['offline','missing','root','marker','path','policy','symlink','read-only','clone','origin','branch'] as const)('runs the real preflight against invalid %s dependencies', async failure => {
    const machine = (await db.machines.getProjectMachine(projectId, b))!
    const paths = recommendedProjectMachineDirectories('/storage', projectId, 'linux')
    const directories = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, { path, override: false }])) as ProjectMachineDirectoryAssignments
    if (failure === 'path') directories.mergeClones.override = true
    vi.spyOn(db.machines, 'getProjectMachine').mockResolvedValue({
      ...machine, storageId: failure === 'missing' ? null : 'storage', reposRoot: null,
      storageRoot: failure === 'root' ? null : '/storage', storageFormatVersion: 1, directories
    })
    executor.run = vi.fn(async (_request, onChunk) => {
      if (failure === 'symlink') return { exitCode: 73, timedOut: false }
      if (failure === 'clone') return { exitCode: 74, timedOut: false }
      if (failure === 'origin') return { exitCode: 128, timedOut: false }
      await onChunk('1'.repeat(40) + '\\trefs/heads/main\\n')
      return { exitCode: 0, timedOut: false }
    })
    manager = new MergeRunManager({ db, executor, isOnline: () => failure !== 'offline',
      policyOf: () => ({ allowedDirs: failure === 'policy' ? ['/elsewhere'] : ['/storage'] }),
      fsRead: async () => ({ dataBase64: Buffer.from(JSON.stringify({ id: failure === 'marker' ? 'wrong' : 'storage', formatVersion: 1 })).toString('base64') }),
      fsWrite: async () => { if (failure === 'read-only') throw new Error('read-only') },
      fsDelete: async () => {}, broadcast: () => {}, boardChanged })
    const expected = { offline:'machine_offline', missing:'storage_missing', root:'storage_not_found', marker:'storage_marker_invalid',
      path:'storage_path_invalid', policy:'storage_policy_denied', symlink:'storage_symlink', 'read-only':'storage_read_only', clone:'clone_invalid', origin:'git_unavailable', branch:'git_unavailable' }[failure]
    expect(await change()).toMatchObject({ ok: false, code: 'readiness_failed', readiness: { code: expected } })
    expect((await snapshot()).agentId).toBe(a)
    expect(audits()).toHaveLength(0)
  })

  // @testCase TC-INT-02
  it('reconcile after commit and lost realtime executes the persisted assignment exactly once', async () => {
    boardChanged.mockImplementationOnce(() => { throw new Error('connection lost after commit') })
    await expect(change()).rejects.toThrow('connection lost after commit')
    expect((await snapshot()).agentId).toBe(b)
    await db.close()
    db = new VoiceChatDb(join(directory, 'db.sqlite')); await db.ready
    const seen: string[] = []
    executor.run = vi.fn(async request => { seen.push(request.agentId!); return { exitCode: 1, timedOut: false } })
    manager = makeManager()
    await manager.reconcile()
    await vi.waitFor(async () => expect((await snapshot()).status).toBe('failed'))
    expect(seen).toEqual([b])
    expect(audits()).toHaveLength(1)
    expect(await db.ci.listMergeRuns('owner', projectId, taskId)).toHaveLength(1)
  })

  // @testCase TC-INT-01
  it('resolves concurrent changes and rejects ABA and lost-response replays', async () => {
    const results = await Promise.all([change(b), change(c)])
    expect(results.filter(result => result.ok)).toHaveLength(1)
    expect(results.filter(result => !result.ok)).toMatchObject([{ code: 'assignment_changed' }])
    expect(await change(a, 1)).toMatchObject({ ok: true, run: { assignmentVersion: 2 } })
    expect(await change(c, 0)).toMatchObject({ ok: false, code: 'assignment_changed', run: { agentId: a, assignmentVersion: 2 } })
    expect(audits()).toHaveLength(2)
  })

  // @testCase TC-INT-01
  it.each(['claim','cancel','permission','offline','configuration'] as const)('rechecks %s after a suspended preflight', async race => {
    const entered = barrier(), resume = barrier()
    vi.spyOn(manager, 'checkReadiness').mockImplementation(async () => {
      entered.release(); await resume.promise
      return { ready: true, selectable: true, mode: 'legacy', code: 'ready', message: 'Ready' }
    })
    const changing = change()
    await entered.promise
    if (race === 'claim') await db.ci.claimQueuedMergeRun(id)
    if (race === 'cancel') await manager.cancel(id, 'owner')
    if (race === 'permission') raw().prepare("UPDATE users SET role='observer' WHERE name='owner'").run()
    if (race === 'offline') online = false
    if (race === 'configuration') await db.machines.setProjectMachineReposRoot('owner', projectId, b, '/changed')
    resume.release()
    const result = await changing
    expect(result.ok).toBe(false)
    expect((await db.ci.getMergeRunRaw(id))!.agentId).toBe(a)
    expect(audits()).toHaveLength(0)
  })

  // @testCase TC-INT-02
  it('rolls back assignment when audit fails and preserves a committed assignment after reopening the DB', async () => {
    const before = await snapshot()
    const audit = vi.spyOn(db.qa, 'addPreviewAudit').mockRejectedValueOnce(new Error('audit failure'))
    await expect(change()).rejects.toThrow('audit failure')
    expect(await snapshot()).toEqual(before)
    expect(audits()).toHaveLength(0)
    audit.mockRestore()
    await db.close()
    db = new VoiceChatDb(join(directory, 'db.sqlite')); await db.ready; manager = makeManager()
    expect((await snapshot()).agentId).toBe(a)
    expect(await change()).toMatchObject({ ok: true })
    await db.close()
    db = new VoiceChatDb(join(directory, 'db.sqlite')); await db.ready; manager = makeManager()
    expect(await snapshot()).toMatchObject({ agentId: b, assignmentVersion: 1 })
    expect(audits()).toHaveLength(1)
    const claimed = await db.ci.claimQueuedMergeRun(id)
    expect(claimed).toMatchObject({ agentId: b, status: 'checking' })
    expect(await db.ci.claimQueuedMergeRun(id)).toBeNull()
  })

  // @testCase TC-INT-01
  // @testCase TC-REG-01
  it('an old scheduled callback executes only B and an autopilot start reuses the same run', async () => {
    vi.useFakeTimers()
    try {
      const old = await snapshot()
      manager.start(old)
      expect(await change()).toMatchObject({ ok: true })
      expect((await db.ci.startMergeRun('owner', projectId, taskId)).id).toBe(id)
      const executing = barrier(), finish = barrier()
      const agents: string[] = []
      executor.run = vi.fn(async request => {
        agents.push(request.agentId!)
        executing.release(); await finish.promise
        return { exitCode: 1, timedOut: false }
      })
      await vi.advanceTimersByTimeAsync(25)
      await executing.promise
      expect(agents).toEqual([b])
      finish.release()
      await vi.waitFor(async () => expect((await snapshot()).status).toBe('failed'))
      expect(agents.every(agent => agent === b)).toBe(true)
      expect(await db.ci.listMergeRuns('owner', projectId, taskId)).toHaveLength(1)
    } finally { vi.useRealTimers() }
  })
})
