import { mkdtempSync, rmSync } from 'node:fs'
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
    getProject: () => ({ id: 'p1', machines: [{ agentId: 'a1', reposRoot: '/repos', path: '/repos/project' }] }),
    getBoard: () => ({ tasks: [{ id: 't1', type: 'task' }, { id: 't2', type: 'task' }] }),
    findActiveCiWorkspace: (_projectId: string, taskId: string) => ({ agentId: 'a1', path: `/repos/project/${taskId}` })
  } as unknown as VoiceChatDb
  let n = 0
  const executor: CommandExecutor = {
    run: vi.fn(async (req, onChunk, signal) => {
      if (signal?.aborted) throw new Error('Команда отменена')
      n++
      if (req.script.includes('git branch --show-current')) onChunk(`VC_BRANCH=feature/x\nVC_SHA=${req.workdir.endsWith('t1') ? 'aaaaaaaa' : 'bbbbbbbb'}\n`)
      if (req.script.includes('VC_ALLOCATED_PORT')) onChunk(`VC_ALLOCATED_PORT=${18000 + n}\n`)
      return result
    })
  }
  let id = 0
  const manager = new FeaturePreviewManager({ db, executor, storePath: join(dir, 'previews.json'), isOnline: () => true, newId: () => `id-${++id}`, now: () => id * 100 })
  return { manager, executor, db, storePath: join(dir, 'previews.json') }
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

  it('isolates Docker resources for two tasks', async () => {
    const { manager } = setup()
    const one = await manager.operate('u1', 'p1', 't1', 'start')
    const two = await manager.operate('u1', 'p1', 't2', 'start')
    expect(one.composeProject).not.toBe(two.composeProject)
    expect(one.workspacePath).not.toBe(two.workspacePath)
    await wait()
  })

  it('persists terminal failure instead of remaining building', async () => {
    const { manager } = setup({ exitCode: 2, timedOut: false })
    await manager.operate('u1', 'p1', 't1', 'start')
    await wait()
    const env = manager.get('u1', 'p1', 't1')!
    expect(env.state).toBe('failed')
    expect(env.runs.at(-1)?.status).toBe('failed')
    expect(env.lastError?.type).toBe('build')
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
