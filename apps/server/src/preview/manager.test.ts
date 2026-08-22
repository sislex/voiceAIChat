import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VoiceChatDb } from '../db/database'
import type { CommandExecutor } from '../ci/types'
import { FeaturePreviewManager } from './manager'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function setup(result: { exitCode: number | null; timedOut: boolean } = { exitCode: 0, timedOut: false }) {
  const dir = mkdtempSync(join(tmpdir(), 'preview-test-')); dirs.push(dir)
  const db = {
    getProject: () => ({ id: 'p1', name: 'Project', gitUrl: 'https://example.test/repo.git', ciBranchTemplate: '{task_number}', defaultAgentId: 'a1', machines: [{ agentId: 'a1', reposRoot: '/repos', path: '/repos/project', storageId: 's1' }, { agentId: 'a2', reposRoot: '/other', path: '/other/project', storageId: 's2' }] }),
    getProjectMachine: (_projectId: string, agentId: string) => ({ agentId, path: agentId === 'a1' ? '/repos/project' : '/other/project', reposRoot: agentId === 'a1' ? '/repos' : '/other', storageId: agentId === 'a1' ? 's1' : 's2', storageRoot: agentId === 'a1' ? '/storage' : '/storage-2', storageFormatVersion: 1, directories: null }),
    getBoard: () => ({ tasks: [{ id: 't1', type: 'task', seq: 1, title: 'Task one', agentId: 'a1' }, { id: 't2', type: 'task', seq: 2, title: 'Task two', agentId: 'a1' }] }),
    findActiveCiWorkspace: (_projectId: string, taskId: string) => ({ id: `ws-${taskId}`, agentId: 'a1', path: `/repos/project/${taskId}`, branch: `feature/${taskId === 't1' ? 1 : 2}`, commitSha: taskId === 't1' ? 'aaaaaaaa' : 'bbbbbbbb', pushed: true }),
    findLatestCiWorkspace: (_projectId: string, taskId: string) => ({ id: `ws-${taskId}`, agentId: 'a1', path: `/repos/project/${taskId}`, branch: `feature/${taskId === 't1' ? 1 : 2}`, commitSha: taskId === 't1' ? 'aaaaaaaa' : 'bbbbbbbb', pushed: true }),
    setTaskPreviewReady: vi.fn()
  } as unknown as VoiceChatDb
  let n = 0
  const executor: CommandExecutor = {
    run: vi.fn(async (req, onChunk, signal) => {
      if (signal?.aborted) throw new Error('Команда отменена')
      n++
      if (req.script.includes('git branch --show-current')) onChunk(`VC_BRANCH=feature/${req.workdir.includes('/tasks/t1/') ? '1' : '2'}\nVC_SHA=${req.workdir.includes('/tasks/t1/') ? 'aaaaaaaa' : 'bbbbbbbb'}\n`)
      if (req.script.includes('command -v docker') && result.exitCode !== 0) onChunk('Docker установлен, но не запущен\n')
      if (req.script.includes('VC_ALLOCATED_PORT')) onChunk(`VC_ALLOCATED_PORT=${18000 + n}\n`)
      return req.script.includes('command -v docker') ? result : { exitCode: 0, timedOut: false }
    })
  }
  let id = 0
  const files = new Map<string, string>()
  const fsDelete = vi.fn(async (_agentId: string, path: string) => { files.delete(path) })
  const manager = new FeaturePreviewManager({
    db, executor, storePath: join(dir, 'previews.json'), isOnline: () => true,
    platformOf: () => 'linux', allowedDirsOf: () => ['/storage', '/storage-2'],
    fsRead: async (_agentId, path) => {
      if (path.endsWith('/.voicechat/storage.json')) return { dataBase64: Buffer.from(JSON.stringify({ id: path.startsWith('/storage-2') ? 's2' : 's1', formatVersion: 1 })).toString('base64') }
      const value = files.get(path); if (!value) throw new Error('ENOENT: not found')
      return { dataBase64: value }
    },
    fsWrite: async (_agentId, path, dataBase64) => { files.set(path, dataBase64) },
    fsMkdir: async () => undefined,
    fsRename: async (_agentId, from, to) => { const value = files.get(from); if (!value) throw new Error('ENOENT'); files.set(to, value); files.delete(from) },
    fsDelete,
    newId: () => `id-${++id}`, now: () => id * 100
  })
  return { manager, executor, db, files, fsDelete, storePath: join(dir, 'previews.json') }
}
const wait = async (): Promise<void> => { await new Promise((resolve) => setTimeout(resolve, 30)) }

describe('FeaturePreviewManager', () => {
  it('creates at most one environment and replays an idempotency key', async () => {
    const { manager } = setup()
    const first = await manager.operate('u1', 'p1', 't1', 'start', { idempotencyKey: 'same' })
    const replay = await manager.operate('u1', 'p1', 't1', 'start', { idempotencyKey: 'same' })
    expect(replay.id).toBe(first.id)
    expect(manager.list()).toHaveLength(1)
  })

  it('returns the active equivalent launch even with a different idempotency key', async () => {
    const { manager } = setup()
    const first = await manager.operate('u1', 'p1', 't1', 'start', { idempotencyKey: 'request-1' })
    const replay = await manager.operate('u1', 'p1', 't1', 'start', { idempotencyKey: 'request-2' })
    expect(replay.id).toBe(first.id)
    expect(replay.runs).toHaveLength(1)
    await wait()
  })

  it('persists ordered stages and requires the application health check before readiness', async () => {
    const { manager, executor } = setup()
    await manager.operate('u1', 'p1', 't1', 'start')
    await wait()
    const run = manager.get('u1', 'p1', 't1')!.runs.at(-1)!
    expect(run.status).toBe('succeeded')
    expect(run.steps.map((step) => step.id)).toEqual(['machine','workspace','configuration','image','build','container','port','health','connection','ready'])
    expect(run.steps.find((step) => step.id === 'image')).toMatchObject({ status: 'skipped' })
    expect(run.steps.find((step) => step.id === 'health')).toMatchObject({ status: 'succeeded' })
    expect(executor.run).toHaveBeenCalledWith(expect.objectContaining({ script: expect.stringContaining('curl --fail') }), expect.any(Function), expect.any(AbortSignal))
    expect(run.result?.readyAt).not.toBeNull()
  })

  it('isolates Docker resources for two tasks', async () => {
    const { manager } = setup()
    const one = await manager.operate('u1', 'p1', 't1', 'start')
    const two = await manager.operate('u1', 'p1', 't2', 'start')
    expect(one.composeProject).not.toBe(two.composeProject)
    expect(one.workspacePath).not.toBe(two.workspacePath)
    await wait()
  })

  it('prepares an isolated feature workspace on another project machine', async () => {
    const { manager, executor } = setup()
    const env = await manager.operate('u1', 'p1', 't1', 'start', { agentId: 'a2' })
    expect(env.agentId).toBe('a2')
    expect(env.workspacePath).toBe('/storage-2/projects/p1/tasks/t1/environments/preview/id-1/temporary/repository')
    expect(executor.run).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'a2', workdir: '/storage-2/projects/p1/tasks/t1/environments/preview/id-1', env: expect.objectContaining({ VC_PREVIEW_BRANCH: 'feature/1', VC_PREVIEW_SHA: 'aaaaaaaa' })
    }), expect.any(Function))
    await wait()
  })

  it('materializes and reuses the canonical managed preview layout', async () => {
    const { manager, files } = setup()
    const first = await manager.operate('u1', 'p1', 't1', 'start')
    await wait()
    const root = '/storage/projects/p1/tasks/t1/environments/preview/id-1'
    expect(first.workspacePath).toBe(`${root}/temporary/repository`)
    const manifest = JSON.parse(Buffer.from(files.get(`${root}/environment.json`)!, 'base64').toString('utf8'))
    expect(manifest).toEqual({ formatVersion: 1, kind: 'preview', projectId: 'p1', taskId: 't1', storageId: 's1', machineId: 'a1', createdAt: '1970-01-01T00:00:00.100Z' })
    const runManifest = JSON.parse(Buffer.from(files.get(`${root}/runs/id-2/run.json`)!, 'base64').toString('utf8'))
    const report = JSON.parse(Buffer.from(files.get(`${root}/runs/id-2/report.json`)!, 'base64').toString('utf8'))
    expect(runManifest).toMatchObject({ formatVersion: 1, runId: 'id-2', runType: 'preview', machineId: 'a1', workspace: `${root}/temporary/repository`, sourceCommit: 'aaaaaaaa' })
    expect(report).toMatchObject({ formatVersion: 1, runId: 'id-2', status: 'success', sourceCommit: 'aaaaaaaa', finalCommit: 'aaaaaaaa', errors: [], artifacts: [] })
    const restarted = await manager.operate('u1', 'p1', 't1', 'start')
    expect(restarted.id).toBe(first.id)
    expect(restarted.workspacePath).toBe(first.workspacePath)
    await wait()
  })

  it('removes only the confirmed managed preview root after Docker cleanup', async () => {
    const { manager, fsDelete } = setup()
    const env = await manager.operate('u1', 'p1', 't1', 'start')
    await wait()
    await manager.operate('u1', 'p1', 't1', 'remove')
    await wait()
    expect(fsDelete).toHaveBeenCalledWith('a1', env.managed!.previewRoot)
    expect(manager.get('u1', 'p1', 't1')?.state).toBe('removed')
  })

  it('rejects cleanup when environment.json identity conflicts', async () => {
    const { manager, files, fsDelete } = setup()
    const env = await manager.operate('u1', 'p1', 't1', 'start')
    await wait()
    files.set(`${env.managed!.previewRoot}/environment.json`, Buffer.from(JSON.stringify({ formatVersion: 1, kind: 'preview', projectId: 'p1', taskId: 'other', storageId: 's1', machineId: 'a1', createdAt: '1970-01-01T00:00:00.100Z' })).toString('base64'))
    const deletesBefore = fsDelete.mock.calls.length
    await manager.operate('u1', 'p1', 't1', 'remove')
    await wait()
    expect(fsDelete.mock.calls.slice(deletesBefore)).not.toContainEqual(['a1', env.managed!.previewRoot])
    expect(manager.get('u1', 'p1', 't1')?.lastError?.message).toMatch(/environment.json конфликтует/)
  })

  it('keeps persisted legacy workspace and never applies managed directory cleanup', async () => {
    const { manager, db, executor, storePath, fsDelete } = setup()
    await manager.operate('u1', 'p1', 't1', 'start')
    await wait()
    const legacy = manager.get('u1', 'p1', 't1')!
    delete legacy.managed
    legacy.workspacePath = '/repos/project/t1'
    legacy.state = 'stopped'
    writeFileSync(storePath, JSON.stringify({ environments: [legacy], idempotency: {} }))
    const restored = new FeaturePreviewManager({ db, executor, storePath, isOnline: () => true })
    const deletesBefore = fsDelete.mock.calls.length
    await restored.operate('u1', 'p1', 't1', 'remove')
    await wait()
    expect(restored.get('u1', 'p1', 't1')?.workspacePath).toBe('/repos/project/t1')
    expect(fsDelete.mock.calls).toHaveLength(deletesBefore)
  })

  it('starts Docker through an explicit operation and waits for the Engine', async () => {
    const { manager, executor } = setup()
    await manager.operate('u1', 'p1', 't1', 'docker_start')
    await wait()
    expect(manager.get('u1', 'p1', 't1')?.state).toBe('stopped')
    expect(executor.run).toHaveBeenCalledWith(expect.objectContaining({ script: expect.stringContaining('until docker info') }), expect.any(Function), expect.any(AbortSignal))
  })

  it('persists terminal failure instead of remaining building', async () => {
    const { manager } = setup({ exitCode: 2, timedOut: false })
    await manager.operate('u1', 'p1', 't1', 'start')
    await wait()
    const env = manager.get('u1', 'p1', 't1')!
    expect(env.state).toBe('failed')
    expect(env.runs.at(-1)?.status).toBe('failed')
    expect(env.lastError?.type).toBe('docker_daemon_unavailable')
    expect(env.lastError?.message).toBe('Docker установлен, но не запущен')
  })

  it('marks interrupted operation failed during reconciliation', async () => {
    const { manager, db, executor, storePath } = setup()
    const env = await manager.operate('u1', 'p1', 't1', 'start')
    expect(env.state).toBe('building')
    const restarted = new FeaturePreviewManager({ db, executor, storePath, isOnline: () => true })
    await restarted.reconcile()
    expect(restarted.get('u1', 'p1', 't1')?.state).toBe('failed')
  })
})
