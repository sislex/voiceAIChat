import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceChatDb } from '../db/database.js'
import { FeatureCoordinator } from './coordinator.js'
import type { WorkspaceExecutor } from './workspace.js'
import type { PullRequestService } from './pullRequests.js'

let db: VoiceChatDb
let workspace: WorkspaceExecutor
let coordinator: FeatureCoordinator
let n = 0
const sha = 'a'.repeat(40)

beforeEach(() => {
  n = 0
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++n}`, now: () => 1000 + n })
  db.createUser('alice', '', 'user')
  workspace = {
    prepare: vi.fn().mockResolvedValue({ baseCommitSha: sha }),
    commit: vi.fn().mockResolvedValue(sha),
    run: vi.fn().mockResolvedValue(undefined),
    pushFeature: vi.fn().mockResolvedValue(undefined),
    mergeLocal: vi.fn().mockResolvedValue('b'.repeat(40)),
    cleanup: vi.fn().mockResolvedValue(undefined),
    remoteMainSha: vi.fn().mockResolvedValue('b'.repeat(40)),
    checkout: vi.fn().mockResolvedValue(undefined)
  }
  const prs: PullRequestService = { merge: vi.fn().mockResolvedValue({ mergeCommitSha: 'b'.repeat(40), url: 'https://github.test/pr/1' }) }
  coordinator = new FeatureCoordinator(db, workspace, prs)
})
afterEach(() => db.close())

function setup(autoMerge = false) {
  let project = db.createProject('alice', { name: 'P', gitUrl: 'git@github.com:x/y.git', agentPlanApprovalMode: 'automatic' })
  project = db.updateProject('alice', project.id, { testCommand: 'npm test', productionDeployCommand: 'deploy' })!
  const agent = db.createAgent('alice', 'machine')
  db.linkMachine('alice', project.id, agent.id)
  db.setProjectMachineFeatureReposRoot('alice', project.id, agent.id, '/repos')
  db.setProjectDefaultMachine('alice', project.id, agent.id)
  const ready = db.getBoard('alice', project.id)!.columns.find((c) => c.semanticType === 'ready')!
  const task = db.createTask('alice', project.id, { columnId: ready.id, title: 'T' })!
  return db.createFeatureFromTask('alice', project.id, task.id, { autoMerge })!
}

describe('FeatureCoordinator', () => {
  it('подготавливает slot, ветку и автоматический план', async () => {
    const feature = setup()
    await coordinator.prepare('alice', feature)
    const ready = db.getFeature('alice', feature.id)!
    expect(ready.status).toBe('development')
    expect(ready.baseCommitSha).toBe(sha)
    expect(db.getRepositorySlotForFeature('alice', feature.id)?.status).toBe('busy')
    expect(db.listAgentTasks('alice', feature.id)).toHaveLength(1)
  })

  it('тестирует, автоматически мержит и освобождает slot', async () => {
    const feature = setup(true)
    await coordinator.prepare('alice', feature)
    await coordinator.finishDevelopment('alice', feature.id)
    const done = db.getFeature('alice', feature.id)!
    expect(done.status).toBe('completed')
    expect(done.mergedCommitSha).toBe('b'.repeat(40))
    expect(done.deployStatus).toBe('awaiting_confirmation')
    expect(db.getRepositorySlotForFeature('alice', feature.id)?.status).toBe('available')
  })

  it('фиксирует SHA main в записи production-деплоя', async () => {
    const feature = setup(true)
    await coordinator.prepare('alice', feature)
    await coordinator.finishDevelopment('alice', feature.id)
    await coordinator.deploy('alice', feature.id)
    const deployments = db.listFeatureDeployments('alice', feature.id)!
    expect(deployments[0].requestedMainSha).toBe('b'.repeat(40))
    expect(deployments[0].deployedMainSha).toBe('b'.repeat(40))
    expect(deployments[0].status).toBe('succeeded')
  })

  it('ошибка подготовки возвращает Task в ready и оставляет Feature для новой попытки', async () => {
    const feature = setup()
    vi.mocked(workspace.prepare).mockRejectedValueOnce(new Error('clone failed'))
    await coordinator.prepare('alice', feature)
    expect(db.getFeature('alice', feature.id)).toMatchObject({ status: 'failed', lastError: 'clone failed' })
    const board = db.getBoard('alice', feature.projectId)!
    const task = board.tasks.find((t) => t.id === feature.sourceTaskId)!
    expect(board.columns.find((c) => c.id === task.columnId)?.semanticType).toBe('ready')
  })

  it('отмена сохраняет workspace заблокированным и возвращает Task в ready', async () => {
    const feature = setup()
    await coordinator.prepare('alice', feature)
    await coordinator.cancel('alice', feature.id)
    expect(db.getFeature('alice', feature.id)?.status).toBe('cancelled')
    expect(db.getRepositorySlotForFeature('alice', feature.id)?.status).toBe('blocked')
    const board = db.getBoard('alice', feature.projectId)!
    const task = board.tasks.find((t) => t.id === feature.sourceTaskId)!
    expect(board.columns.find((c) => c.id === task.columnId)?.semanticType).toBe('ready')
  })
})
