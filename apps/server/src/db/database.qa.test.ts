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
})
