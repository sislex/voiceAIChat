import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VoiceChatDb } from './database.js'

let db: VoiceChatDb
let ids = 0
beforeEach(() => {
  ids = 0
  db = new VoiceChatDb(':memory:', { newId: () => `qa-${++ids}`, now: () => 1_000 + ids })
  db.createUser('owner', '', 'developer')
  db.createUser('developer', '', 'developer')
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
  it('requires detailed scenarios before moving from component QA to manual QA', () => {
    const project = db.createProject('owner', { name: 'QA preparation' })
    const preparation = db.getBoard('owner', project.id)!.columns.find((column) => column.semanticType === 'component_qa')!
    const task = db.createTask('owner', project.id, { columnId: preparation.id, title: 'Feature' })!
    expect(() => db.completeQaPreparation('owner', project.id, task.id)).toThrow(/хотя бы один сценарий/)
    db.createAcceptanceCriterion('owner', project.id, task.id, {
      title: 'Happy path', description: 'Проверка формы', preconditions: 'Открыть https://preview.test/form',
      steps: '1. Заполнить поле\n2. Нажать Сохранить', testData: 'Название: QA', expectedResult: 'Форма сохранена без ошибки',
      required: true, testType: 'manual'
    })
    db.completeQaPreparation('owner', project.id, task.id)
    const board = db.getBoard('owner', project.id)!
    const column = board.columns.find((item) => item.id === board.tasks.find((item) => item.id === task.id)!.columnId)
    expect(column?.semanticType).toBe('manual_qa')
  })

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
      status: 'failed', draft: false, executedSteps: 'click Cancel', actualResult: 'still running', comment: 'Cancel does not stop the run',
      classification: 'implementation_defect', severity: 'major', frequency: 'always', reproduction: 'start then cancel'
    })
    const state = db.getQaTaskState('owner', project.id, task.id)!
    expect(state.sessions[0].results[0].issue?.classification).toBe('implementation_defect')
    const taskColumn = db.getBoard('owner', project.id)!.columns.find((c) => c.id === db.getBoard('owner', project.id)!.tasks[0].columnId)
    expect(taskColumn?.semanticType).toBe('manual_qa')
  })

  it('validates blocked comments, ownership, status and audits previous/new values', () => {
    const { project, task } = fixture()
    const session = db.startQaSession('owner', { projectId: project.id, taskId: task.id, branch: 'feature/1', commitSha: 'abc', testRunId: 'test-1' })!
    const result = session.results[0]
    expect(() => db.saveQaResult('owner', project.id, task.id, result.id, 1, {
      status: 'blocked', draft: false, blockerReason: 'Preview down', blockerType: 'environment', blockerOwner: 'ops'
    })).toThrow(/comment/)
    expect(() => db.saveQaResult('developer', project.id, task.id, result.id, 1, { status: 'passed', draft: false })).toThrow(/permission/)
    expect(() => db.saveQaResult('owner', project.id, 'another-task', result.id, 1, { status: 'passed', draft: false })).toThrow(/not found/)
    expect(() => db.saveQaResult('owner', project.id, task.id, result.id, 1, { status: 'unknown' as never, draft: false })).toThrow(/invalid QA result status/)
    db.saveQaResult('owner', project.id, task.id, result.id, 1, {
      status: 'blocked', draft: false, comment: 'Preview down', blockerReason: 'Preview down', blockerType: 'environment', blockerOwner: 'ops'
    })
    const raw = (db as unknown as { db: { prepare(sql: string): { get(...values: unknown[]): { payload_json: string } } } }).db
    const audit = JSON.parse(raw.prepare(`SELECT payload_json FROM qa_audit WHERE action='result.updated' ORDER BY created_at DESC LIMIT 1`).get().payload_json)
    expect(audit).toMatchObject({
      resultId: result.id, sessionId: session.id, criterionId: result.criterionId, actor: 'owner',
      previous: { status: 'not_tested', comment: '', revision: 1 },
      next: { status: 'blocked', comment: 'Preview down', revision: 2 }
    })
    expect(audit.serverTime).toEqual(expect.any(Number))
  })

  it('binds screenshot metadata to project/result and denies outsiders', () => {
    const { project, task } = fixture()
    const session = db.startQaSession('owner', { projectId: project.id, taskId: task.id, branch: 'feature/1', commitSha: 'abc', testRunId: 'test-1' })!
    const attachment = db.addQaAttachment('owner', project.id, task.id, session.results[0].id, { uploadId: 'opaque-upload', name: '../../proof.png', mimeType: 'image/png', size: 42, caption: 'Cancel result' })
    expect(db.getQaAttachment('owner', attachment.id)?.uploadId).toBe('opaque-upload')
    expect(db.getQaAttachment('developer', attachment.id)?.taskId).toBe(task.id)
    db.createUser('outsider', '', 'developer')
    expect(db.getQaAttachment('outsider', attachment.id)).toBeNull()
  })

  it('does not let an ordinary developer attest QA', () => {
    const { project, task } = fixture()
    expect(() => db.startQaSession('developer', { projectId: project.id, taskId: task.id, branch: 'feature/1', commitSha: 'abc', testRunId: 'test-1' })).toThrow(/permission/)
  })

  it('deduplicates QA preparation by task and SHA and stales a session for a new SHA', () => {
    const { project, task } = fixture()
    const session = db.startQaSession('owner', { projectId: project.id, taskId: task.id, branch: 'feature/1', commitSha: 'abc', testRunId: 'test-1' })!
    const first = db.startQaPreparationRun(project.id, task.id, 'feature/1', 'abc')!
    expect(db.startQaPreparationRun(project.id, task.id, 'feature/1', 'abc')).toBeNull()
    db.recordQaPreparationAttempt(first.id, 1, 'Жду результаты…', 'Невалидный JSON')
    db.finishQaPreparationRun(first.id, 'failed', 'Невалидный JSON')
    expect(db.startQaPreparationRun(project.id, task.id, 'feature/1', 'abc', true)?.id).toBe(first.id)
    expect(db.startQaPreparationRun(project.id, task.id, 'feature/1', 'abc', true)).toBeNull()
    expect(db.failInterruptedQaPreparationRuns()).toEqual([first.id])
    const state = db.getQaTaskState('owner', project.id, task.id)!
    expect(state.preparation).toMatchObject({ status: 'failed', canRetry: true, error: 'Подготовка прервана перезапуском сервера' })
    expect(db.startQaPreparationRun(project.id, task.id, 'feature/1', 'def')).not.toBeNull()
    expect(db.getQaTaskState('owner', project.id, task.id)?.sessions.find((item) => item.id === session.id)?.status).toBe('stale')
  })

  it('uses the pushed workspace machine for a merge run instead of the project default', () => {
    const project = db.createProject('owner', { name: 'Merge' })
    const awaiting = db.getBoard('owner', project.id)!.columns.find((column) => column.semanticType === 'awaiting_merge')!
    const task = db.createTask('owner', project.id, { columnId: awaiting.id, title: 'Feature' })!
    const raw = (db as unknown as { db: { prepare(sql: string): { run(...values: unknown[]): unknown } } }).db
    raw.prepare(`INSERT INTO agents (id,name,token_hash,created_at) VALUES (?,?,?,?)`).run('default-agent', 'Default', 'x', 1)
    raw.prepare(`INSERT INTO agents (id,name,token_hash,created_at) VALUES (?,?,?,?)`).run('workspace-agent', 'Workspace', 'x', 1)
    raw.prepare(`INSERT INTO project_machines (project_id,agent_id,path,repos_root,added_at,added_by) VALUES (?,?,?,?,?,?)`).run(project.id, 'default-agent', '/default', '/repos', 1, 'owner')
    raw.prepare(`INSERT INTO project_machines (project_id,agent_id,path,repos_root,added_at,added_by) VALUES (?,?,?,?,?,?)`).run(project.id, 'workspace-agent', '/workspace', '/repos', 1, 'owner')
    raw.prepare(`UPDATE projects SET git_url=?,default_agent_id=? WHERE id=?`).run('git@example/repo.git', 'default-agent', project.id)
    raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('workspace', project.id, task.id, 'workspace-agent', '/repos/task', 'CHAT-179', '1'.repeat(40), 1, 'released', 2)

    expect(db.startMergeRun('owner', project.id, task.id).agentId).toBe('workspace-agent')
    const moved = db.getBoard('owner', project.id)!.tasks.find((item) => item.id === task.id)!
    expect(db.getBoard('owner', project.id)!.columns.find((item) => item.id === moved.columnId)?.semanticType).toBe('merge')
  })

  it('allows the owner personal workspace machine and exposes a newer source after a successful merge', () => {
    const project = db.createProject('owner', { name: 'Repeated merge' })
    const awaiting = db.getBoard('owner', project.id)!.columns.find((column) => column.semanticType === 'awaiting_merge')!
    const task = db.createTask('owner', project.id, { columnId: awaiting.id, title: 'Feature' })!
    const personal = db.createAgent('owner', 'Personal Mac')
    const raw = (db as unknown as { db: { prepare(sql: string): { run(...values: unknown[]): unknown } } }).db
    raw.prepare(`UPDATE projects SET git_url=? WHERE id=?`).run('git@example/repo.git', project.id)
    raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('workspace-old', project.id, task.id, personal.id, '/repos/task', 'CHAT-194', '1'.repeat(40), 1, 'released', 1)

    const merged = db.startMergeRun('owner', project.id, task.id)
    expect(merged).toMatchObject({ agentId: personal.id, machineName: 'Personal Mac' })
    db.updateMergeRun(merged.id, { status: 'success', stage: 'success', mergeSha: '2'.repeat(40) })
    db.moveMergeTask(project.id, task.id, 'awaiting_merge')
    raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('workspace-new', project.id, task.id, personal.id, '/repos/task', 'CHAT-194', '3'.repeat(40), 1, 'released', 2)

    expect(db.getBoard('owner', project.id)!.tasks.find((item) => item.id === task.id)).toMatchObject({
      mergeSourceSha: '3'.repeat(40),
      mergedSourceSha: '1'.repeat(40),
      mergedSha: '2'.repeat(40),
      mergeMachineBound: true
    })
  })

  it('lets a conflict retry pin the resolved branch SHA during fetch', () => {
    const project = db.createProject('owner', { name: 'Merge retry' })
    const awaiting = db.getBoard('owner', project.id)!.columns.find((column) => column.semanticType === 'awaiting_merge')!
    const task = db.createTask('owner', project.id, { columnId: awaiting.id, title: 'Feature' })!
    const raw = (db as unknown as { db: { prepare(sql: string): { run(...values: unknown[]): unknown } } }).db
    raw.prepare(`INSERT INTO agents (id,name,token_hash,created_at) VALUES (?,?,?,?)`).run('workspace-agent', 'Workspace', 'x', 1)
    raw.prepare(`INSERT INTO project_machines (project_id,agent_id,path,repos_root,added_at,added_by) VALUES (?,?,?,?,?,?)`).run(project.id, 'workspace-agent', '/workspace', '/repos', 1, 'owner')
    raw.prepare(`UPDATE projects SET git_url=? WHERE id=?`).run('git@example/repo.git', project.id)
    raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('workspace', project.id, task.id, 'workspace-agent', '/repos/task', 'CHAT-179', '1'.repeat(40), 1, 'released', 2)
    const failed = db.startMergeRun('owner', project.id, task.id)
    db.updateMergeRun(failed.id, { status: 'decision_required', stage: 'decision_required', conflicts: ['file.ts'] })

    expect(db.retryMergeRun('owner', failed.id).sourceSha).toBeNull()
  })

  it('unpins the source SHA when retrying a stale-source run, but keeps it for ordinary failures', () => {
    const project = db.createProject('owner', { name: 'Merge stale retry' })
    const awaiting = db.getBoard('owner', project.id)!.columns.find((column) => column.semanticType === 'awaiting_merge')!
    const task = db.createTask('owner', project.id, { columnId: awaiting.id, title: 'Feature' })!
    const raw = (db as unknown as { db: { prepare(sql: string): { run(...values: unknown[]): unknown } } }).db
    raw.prepare(`INSERT INTO agents (id,name,token_hash,created_at) VALUES (?,?,?,?)`).run('workspace-agent', 'Workspace', 'x', 1)
    raw.prepare(`INSERT INTO project_machines (project_id,agent_id,path,repos_root,added_at,added_by) VALUES (?,?,?,?,?,?)`).run(project.id, 'workspace-agent', '/workspace', '/repos', 1, 'owner')
    raw.prepare(`UPDATE projects SET git_url=? WHERE id=?`).run('git@example/repo.git', project.id)
    raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('workspace', project.id, task.id, 'workspace-agent', '/repos/task', 'CHAT-179', '1'.repeat(40), 1, 'released', 2)

    const stale = db.startMergeRun('owner', project.id, task.id)
    db.updateMergeRun(stale.id, { status: 'decision_required', stage: 'decision_required', error: 'stale source: ветка изменилась после development-рана' })
    const unpinned = db.retryMergeRun('owner', stale.id)
    expect(unpinned.sourceSha).toBeNull()
    db.updateMergeRun(unpinned.id, { status: 'cancelled', stage: 'cancelled' })
    db.moveMergeTask(project.id, task.id, 'awaiting_merge')

    const failed = db.startMergeRun('owner', project.id, task.id)
    db.updateMergeRun(failed.id, { status: 'failed', stage: 'failed', error: 'Проверки упали (exit 1)' })
    const pinned = db.retryMergeRun('owner', failed.id)
    expect(pinned.sourceSha).toBe('1'.repeat(40))

    db.updateMergeRun(pinned.id, { status: 'failed', stage: 'failed', error: 'Проверки упали (exit 1)' })
    db.moveMergeTask(project.id, task.id, 'awaiting_merge')
    expect(db.retryMergeRun('owner', pinned.id, null, true).sourceSha).toBeNull()
    expect(db.listMergeRuns('owner', project.id, task.id).length).toBeGreaterThanOrEqual(4)
    expect(db.listMergeRuns('stranger', project.id, task.id)).toHaveLength(0)
  })

  it('starts a merge run on an explicitly chosen project machine and rejects unbound ones', () => {
    const project = db.createProject('owner', { name: 'Merge machine choice' })
    const awaiting = db.getBoard('owner', project.id)!.columns.find((column) => column.semanticType === 'awaiting_merge')!
    const task = db.createTask('owner', project.id, { columnId: awaiting.id, title: 'Feature' })!
    const raw = (db as unknown as { db: { prepare(sql: string): { run(...values: unknown[]): unknown } } }).db
    raw.prepare(`INSERT INTO agents (id,name,token_hash,created_at) VALUES (?,?,?,?)`).run('workspace-agent', 'Workspace', 'x', 1)
    raw.prepare(`INSERT INTO agents (id,name,token_hash,created_at) VALUES (?,?,?,?)`).run('other-agent', 'Other', 'x', 1)
    raw.prepare(`INSERT INTO project_machines (project_id,agent_id,path,repos_root,added_at,added_by) VALUES (?,?,?,?,?,?)`).run(project.id, 'workspace-agent', '/workspace', '/repos', 1, 'owner')
    raw.prepare(`INSERT INTO project_machines (project_id,agent_id,path,repos_root,added_at,added_by) VALUES (?,?,?,?,?,?)`).run(project.id, 'other-agent', '/other', '/other-repos', 1, 'owner')
    raw.prepare(`UPDATE projects SET git_url=? WHERE id=?`).run('git@example/repo.git', project.id)
    raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('workspace', project.id, task.id, 'workspace-agent', '/repos/task', 'CHAT-180', '1'.repeat(40), 1, 'released', 2)

    expect(() => db.startMergeRun('owner', project.id, task.id, 'ghost-agent')).toThrow('merge machine is not available to user or project')
    const run = db.startMergeRun('owner', project.id, task.id, 'other-agent')
    expect(run.agentId).toBe('other-agent')
    expect(db.getProjectMachine(project.id, 'other-agent')).toMatchObject({ reposRoot: '/other-repos' })
    db.updateMergeRun(run.id, { status: 'failed', stage: 'failed', error: 'Проверки упали (exit 1)' })
    db.moveMergeTask(project.id, task.id, 'awaiting_merge')
    expect(db.retryMergeRun('owner', run.id).agentId).toBe('other-agent')
  })

  it('prefers the latest pushed workspace even when a newer unpushed one exists', () => {
    const project = db.createProject('owner', { name: 'Pushed workspace wins' })
    const awaiting = db.getBoard('owner', project.id)!.columns.find((column) => column.semanticType === 'awaiting_merge')!
    const task = db.createTask('owner', project.id, { columnId: awaiting.id, title: 'Feature' })!
    const raw = (db as unknown as { db: { prepare(sql: string): { run(...values: unknown[]): unknown } } }).db
    raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('pushed', project.id, task.id, 'agent-a', '/repos/task', 'CHAT-182', '1'.repeat(40), 1, 'released', 1)
    raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('fresh', project.id, task.id, 'agent-a', '/repos/task', null, null, 0, 'active', 2)

    expect(db.findLatestCiWorkspace(project.id, task.id)?.id).toBe('fresh')
    expect(db.findLatestPushedCiWorkspace(project.id, task.id)?.id).toBe('pushed')
  })

  it('tracks task repositories per machine until confirmed deletion', () => {
    const project = db.createProject('owner', { name: 'Task repos' })
    const awaiting = db.getBoard('owner', project.id)!.columns.find((column) => column.semanticType === 'awaiting_merge')!
    const task = db.createTask('owner', project.id, { columnId: awaiting.id, title: 'Feature' })!
    db.upsertTaskRepository(project.id, task.id, 'agent-x', '/repos/chatai/CHAT-1', 'dev-workspace')
    db.upsertTaskRepository(project.id, task.id, 'agent-y', '/repos2/chatai/CHAT-1.merge-r1', 'merge-clone')
    expect(db.listActiveTaskRepositories(task.id)).toHaveLength(2)

    db.markTaskRepositoryDeleted(task.id, 'agent-y', '/repos2/chatai/CHAT-1.merge-r1')
    expect(db.listActiveTaskRepositories(task.id)).toHaveLength(1)
    const all = db.listTaskRepositories('owner', project.id, task.id)
    expect(all).toHaveLength(2)
    expect(all.find((repo) => repo.agentId === 'agent-y')?.state).toBe('deleted')
    expect(db.listTaskRepositories('stranger', project.id, task.id)).toHaveLength(0)

    db.upsertTaskRepository(project.id, task.id, 'agent-y', '/repos2/chatai/CHAT-1.merge-r1', 'merge-clone')
    expect(db.listActiveTaskRepositories(task.id)).toHaveLength(2)
  })

  it('keeps three QA stage histories independent, idempotent and gate-driven', () => {
    const project = db.createProject('owner', { name: 'QA stages' })
    const board = db.getBoard('owner', project.id)!
    const component = board.columns.find((column) => column.semanticType === 'component_qa')!
    const task = db.createTask('owner', project.id, { columnId: component.id, title: 'Feature' })!

    const first = db.startQaStageRun('owner', project.id, task.id, 'component_qa')
    expect(db.startQaStageRun('owner', project.id, task.id, 'component_qa').id).toBe(first.id)
    expect(first).toMatchObject({ kind: 'componentQaRun', attempt: 1, canCancel: true })
    db.cancelQaStageRun('owner', first.id)
    const retry = db.retryQaStageRun('owner', first.id)!
    expect(retry).toMatchObject({ stage: 'component_qa', attempt: 2 })
    db.completeQaStageRun('owner', retry.id, { gatePassed: false, gateReasons: ['dom_failed'] })
    expect(db.getQaStageRun('owner', retry.id)).toMatchObject({ status: 'gate_failed', gateReasons: ['dom_failed'] })
    expect(db.getBoard('owner', project.id)!.columns.find((column) => column.id === db.getBoard('owner', project.id)!.tasks.find((item) => item.id === task.id)!.columnId)?.semanticType).toBe('component_qa')

    const passed = db.retryQaStageRun('owner', retry.id)!
    db.completeQaStageRun('owner', passed.id, { gatePassed: true, components: ['TaskModal'] })
    expect(db.getBoard('owner', project.id)!.columns.find((column) => column.id === db.getBoard('owner', project.id)!.tasks.find((item) => item.id === task.id)!.columnId)?.semanticType).toBe('integration_tests')
    const integration = db.startQaStageRun('owner', project.id, task.id, 'integration_tests')
    expect(db.listQaStageRuns('owner', project.id, task.id, 'component_qa')).toHaveLength(3)
    expect(db.listQaStageRuns('owner', project.id, task.id, 'integration_tests')).toHaveLength(1)
    db.completeQaStageRun('owner', integration.id, { testCases: [] })
    expect(db.getQaStageRun('owner', integration.id)).toMatchObject({ status: 'gate_failed', gateReasons: ['missing_required_test_cases'] })
  })

  it('marks unfinished QA stage runs interrupted after restart reconciliation', () => {
    const project = db.createProject('owner', { name: 'QA recovery' })
    const component = db.getBoard('owner', project.id)!.columns.find((column) => column.semanticType === 'component_qa')!
    const task = db.createTask('owner', project.id, { columnId: component.id, title: 'Feature' })!
    const run = db.startQaStageRun('owner', project.id, task.id, 'component_qa')
    expect(db.failInterruptedQaStageRuns()).toEqual([run.id])
    expect(db.getQaStageRun('owner', run.id)).toMatchObject({ status: 'interrupted', canRetry: true })
  })

  function componentFixture(uiImpact:'none'|'existing_components'='existing_components') {
    const project=db.createProject('owner',{name:'Component QA'})
    const column=db.getBoard('owner',project.id)!.columns.find((item)=>item.semanticType==='component_qa')!
    const task=db.createTask('owner',project.id,{columnId:column.id,title:'Button'})!
    const raw=(db as unknown as {db:{prepare(sql:string):{run(...values:unknown[]):unknown}}}).db
    const readiness={functionalRequirements:'Button works',acceptanceCriteria:'Visible',acceptanceCriteriaConflict:false,uiImpact,
      testCases:uiImpact==='none'?[]:[{id:'TC-COMP',title:'Default',description:'',preconditions:'Storybook',testData:'fixture',steps:'render',expectedResult:'visible',required:true,testType:'ui',automatable:true,automationLinks:[],notAutomatedReason:'',alternativeManualVerification:'',comments:''}],
      affectedComponents:uiImpact==='none'?[]:[{id:'button',name:'Button',storybookStoryId:'ui-button--default',reusable:true,coverage:{stories:true,states:true,fixtures:true,playFunctions:true,domTests:true,accessibility:true,visual:true},exclusionReason:'',alternativeVerification:''}]}
    raw.prepare(`INSERT INTO task_preparation_runs (id,project_id,task_id,status,readiness_json,created_at,finished_at) VALUES (?,?,?,'success',?,?,?)`).run('prep-component',project.id,task.id,JSON.stringify(readiness),1,2)
    raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('ws-component',project.id,task.id,'agent-component','/repos/component','CHAT-227','a'.repeat(40),1,'released',3)
    raw.prepare(`INSERT INTO ci_runs (id,project_id,task_id,status,workspace_id,triggered_by,mode,created_at) VALUES (?,?,?,'success',?,'owner','development',?)`).run('dev-component',project.id,task.id,'ws-component',4)
    return {project,task,raw}
  }

  it('creates one active Component QA run pinned to the development SHA',()=>{
    const {project,task}=componentFixture()
    const first=db.startComponentQaRun('owner',project.id,task.id)
    const second=db.startComponentQaRun('owner',project.id,task.id)
    expect(second.id).toBe(first.id)
    expect(first).toMatchObject({status:'queued',commitSha:'a'.repeat(40),developmentRunId:'dev-component',attempt:1})
    expect(db.getComponentQaTaskState('owner',project.id,task.id)?.activeRun?.id).toBe(first.id)
  })

  it('audits uiImpact none as skipped and moves to integration tests',()=>{
    const {project,task}=componentFixture('none')
    const run=db.startComponentQaRun('owner',project.id,task.id)
    expect(run).toMatchObject({status:'skipped',uiImpact:'none'})
    const board=db.getBoard('owner',project.id)!
    const moved=board.tasks.find((item)=>item.id===task.id)!
    expect(board.columns.find((item)=>item.id===moved.columnId)?.semanticType).toBe('integration_tests')
  })

  it('marks interrupted execution as infrastructure and permits retry',()=>{
    const {project,task}=componentFixture()
    const run=db.startComponentQaRun('owner',project.id,task.id)
    db.markComponentQaRunning(run.id)
    expect(db.failInterruptedComponentQaRuns()).toEqual([run.id])
    expect(db.getComponentQaRun('owner',run.id)).toMatchObject({status:'blocked',failureClassification:'infrastructure',canRetry:true})
  })

  function integrationFixture(automatable=true){
    const {project,task,raw}=componentFixture('none')
    const integration=db.getBoard('owner',project.id)!.columns.find((item)=>item.semanticType==='integration_tests')!
    raw.prepare(`UPDATE tasks SET column_id=? WHERE id=?`).run(integration.id,task.id)
    const testCase={id:'TC-INT',title:'API flow',description:'',preconditions:'server',testData:'fixture',steps:'request',expectedResult:'200',required:true,testType:'integration',automatable,automationLinks:[],notAutomatedReason:automatable?'':'External hardware',alternativeManualVerification:automatable?'':'Run device checklist',comments:''}
    const readiness={functionalRequirements:'API works',acceptanceCriteria:'200',acceptanceCriteriaConflict:false,uiImpact:'none',testCases:[testCase],affectedComponents:[]}
    raw.prepare(`UPDATE task_preparation_runs SET readiness_json=? WHERE id='prep-component'`).run(JSON.stringify(readiness))
    return {project,task,raw}
  }
  it('creates one active integration-test run and enforces physical idempotency',()=>{
    const {project,task}=integrationFixture()
    const first=db.startIntegrationTestRun('owner',project.id,task.id),second=db.startIntegrationTestRun('owner',project.id,task.id)
    expect(second.id).toBe(first.id)
    expect(first).toMatchObject({status:'queued',commitSha:'a'.repeat(40),developmentRunId:'dev-component'})
  })
  it('audits a valid no-automation branch as skipped and moves to Automated QA',()=>{
    const {project,task}=integrationFixture(false)
    expect(db.startIntegrationTestRun('owner',project.id,task.id).status).toBe('skipped')
    const board=db.getBoard('owner',project.id)!,moved=board.tasks.find((item)=>item.id===task.id)!
    expect(board.columns.find((item)=>item.id===moved.columnId)?.semanticType).toBe('automated_qa')
  })
  it('stales the previous integration run after a workspace SHA change',()=>{
    const {project,task,raw}=integrationFixture()
    const run=db.startIntegrationTestRun('owner',project.id,task.id)
    db.markIntegrationTestRunning(run.id)
    raw.prepare(`UPDATE ci_workspaces SET commit_sha=? WHERE id='ws-component'`).run('b'.repeat(40))
    const next=db.startIntegrationTestRun('owner',project.id,task.id)
    expect(db.getIntegrationTestRun('owner',run.id)).toMatchObject({status:'stale',staleReason:'sha_changed'})
    expect(next.id).not.toBe(run.id)
  })
})
