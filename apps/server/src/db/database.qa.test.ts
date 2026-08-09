import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VoiceChatDb } from './database.js'

let db: VoiceChatDb
let ids = 0
beforeEach(() => {
  ids = 0
  db = new VoiceChatDb(':memory:', { newId: () => `qa-${++ids}`, now: () => 1_000 + ids })
  db.createUser('owner', '', 'user')
  db.createUser('developer', '', 'user')
})
afterEach(() => db.close())

function fixture() {
  const project = db.createProject('owner', { name: 'QA' })
  db.addMember('owner', project.id, 'developer')
  const ready = db.getBoard('owner', project.id)!.columns.find((c) => c.semanticType === 'ready')!
  const task = db.createTask('owner', project.id, { columnId: ready.id, title: 'Feature' })!
  const base = {
    title: 'Cancel run', description: 'User can cancel', preconditions: 'running task',
    steps: 'click Cancel', testData: 'seed-v1', expectedResult: 'run stops',
    required: true, testType: 'manual' as const
  }
  const criterion = db.createAcceptanceCriterion('owner', project.id, task.id, base)!
  return { project, task, criterion, base }
}

describe('manual QA persistence and workflow', () => {
  it('versions semantic changes and stales active session without inheriting pass', () => {
    const { project, task, criterion, base } = fixture()
    const session = db.startQaSession('owner', { projectId: project.id, taskId: task.id, branch: 'feature/1', commitSha: 'abc', testRunId: 'test-1', previewId: 'p', previewSha: 'abc' })!
    db.saveQaResult('owner', project.id, task.id, session.results[0].id, 1, { status: 'passed', draft: false })
    const revised = db.reviseAcceptanceCriterion('owner', project.id, task.id, criterion.id, { ...base, expectedResult: 'run stops within 1s', reason: 'timeout agreed' })!
    expect(revised.currentVersion).toBe(2)
    const state = db.getQaTaskState('owner', project.id, task.id)!
    expect(state.sessions[0].status).toBe('stale')
    expect(state.sessions[0].results[0].status).toBe('passed')
    expect(state.versions.map((v) => v.version)).toEqual([2, 1])
  })

  it('enforces optimistic concurrency and blocks incomplete merge', () => {
    const { project, task } = fixture()
    const session = db.startQaSession('owner', { projectId: project.id, taskId: task.id, branch: 'feature/1', commitSha: 'abc', testRunId: 'test-1' })!
    expect(() => db.completeQaSession('owner', project.id, task.id, session.id, '')).toThrow(/not_tested/)
    const result = db.saveQaResult('owner', project.id, task.id, session.results[0].id, 1, { status: 'in_progress', draft: true, executedSteps: 'opened' })
    expect(result.revision).toBe(2)
    expect(() => db.saveQaResult('owner', project.id, task.id, result.id, 1, { status: 'passed' })).toThrow(/revision conflict/)
    db.saveQaResult('owner', project.id, task.id, result.id, 2, { status: 'passed', draft: false })
    db.completeQaSession('owner', project.id, task.id, session.id, 'verified')
    const column = db.getBoard('owner', project.id)!.columns.find((c) => c.id === db.getBoard('owner', project.id)!.tasks[0].columnId)
    expect(column?.semanticType).toBe('awaiting_merge')
  })

  it('requires structured fail and routes implementation defect to development', () => {
    const { project, task } = fixture()
    const session = db.startQaSession('owner', { projectId: project.id, taskId: task.id, branch: 'feature/1', commitSha: 'abc', testRunId: 'test-1' })!
    const id = session.results[0].id
    expect(() => db.saveQaResult('owner', project.id, task.id, id, 1, { status: 'failed', draft: false })).toThrow(/missing QA fields/)
    db.saveQaResult('owner', project.id, task.id, id, 1, {
      status: 'failed', draft: false, executedSteps: 'click Cancel', actualResult: 'still running',
      classification: 'implementation_defect', severity: 'major', frequency: 'always', reproduction: 'start then cancel'
    })
    const state = db.getQaTaskState('owner', project.id, task.id)!
    expect(state.sessions[0].results[0].issue?.classification).toBe('implementation_defect')
    const taskColumn = db.getBoard('owner', project.id)!.columns.find((c) => c.id === db.getBoard('owner', project.id)!.tasks[0].columnId)
    expect(taskColumn?.semanticType).toBe('development')
  })

  it('binds screenshot metadata to project/result and denies outsiders', () => {
    const { project, task } = fixture()
    const session = db.startQaSession('owner', { projectId: project.id, taskId: task.id, branch: 'feature/1', commitSha: 'abc', testRunId: 'test-1' })!
    const attachment = db.addQaAttachment('owner', project.id, task.id, session.results[0].id, { uploadId: 'opaque-upload', name: '../../proof.png', mimeType: 'image/png', size: 42, caption: 'Cancel result' })
    expect(db.getQaAttachment('owner', attachment.id)?.uploadId).toBe('opaque-upload')
    expect(db.getQaAttachment('developer', attachment.id)?.taskId).toBe(task.id)
    db.createUser('outsider', '', 'user')
    expect(db.getQaAttachment('outsider', attachment.id)).toBeNull()
  })

  it('does not let an ordinary developer attest QA', () => {
    const { project, task } = fixture()
    expect(() => db.startQaSession('developer', { projectId: project.id, taskId: task.id, branch: 'feature/1', commitSha: 'abc', testRunId: 'test-1' })).toThrow(/permission/)
  })
})
