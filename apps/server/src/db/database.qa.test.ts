import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@voicechat/shared'
import { VoiceChatDb } from './database.js'
// Сырой драйвер SQLite и файловые базы: на Postgres (VC_TEST_DB_URL) этих тестов нет — там нет ни файла, ни драйвера.
const ON_POSTGRES = Boolean(process.env.VC_TEST_DB_URL)

let db: VoiceChatDb
let ids = 0
beforeEach(async () => {
  ids = 0
  db = new VoiceChatDb(':memory:', { newId: () => `qa-${++ids}`, now: () => 1_000 + ids })
  await db.identity.createUser('owner', '', 'developer')
  await db.identity.createUser('developer', '', 'developer')
})
afterEach(() => db.close())

async function fixture() {
  const project = await db.projects.createProject('owner', { name: 'QA' })
  await db.projects.addMember('owner', project.id, 'developer')
  const ready = (await db.tasks.getBoard('owner', project.id))!.columns.find((c) => c.semanticType === 'ready')!
  const task = (await db.tasks.createTask('owner', project.id, { columnId: ready.id, title: 'Feature' }))!
  const base = {
    title: 'Cancel run', description: 'User can cancel', preconditions: 'running task',
    steps: 'click Cancel', testData: 'seed-v1', expectedResult: 'run stops',
    required: true, testType: 'manual' as const
  }
  const criterion = (await db.qa.createAcceptanceCriterion('owner', project.id, task.id, base))!
  return { project, task, criterion, base }
}

describe.skipIf(ON_POSTGRES)('manual QA persistence and workflow', () => {
  // Список типов был продублирован в мапперe тройкой legacy-значений, поэтому
  // актуальные ui|api|integration|negative|regression молча становились manual —
  // а по UI-сценарию запускается Component QA.
  it('сохраняет актуальные типы сценариев и сводит к manual только неизвестный', async () => {
    const { project, task } = await fixture()
    for (const testType of ['ui', 'api', 'integration', 'negative', 'regression'] as const) {
      const created = (await db.qa.createAcceptanceCriterion('owner', project.id, task.id, {
        title: `Сценарий ${testType}`, description: 'Описание', preconditions: 'Открыт экран',
        steps: 'Шаги', testData: 'Данные', expectedResult: 'Результат', required: true, testType
      }))!
      expect(created.testType).toBe(testType)
    }
    const broken = (await db.qa.createAcceptanceCriterion('owner', project.id, task.id, {
      title: 'Неизвестный тип', description: 'Описание', preconditions: 'Открыт экран',
      steps: 'Шаги', testData: 'Данные', expectedResult: 'Результат', required: true,
      testType: 'выдумка' as unknown as 'manual'
    }))!
    expect(broken.testType).toBe('manual')
  })

  it('requires detailed scenarios before moving from component QA to manual QA', async () => {
    const project = await db.projects.createProject('owner', { name: 'QA preparation' })
    const preparation = (await db.tasks.getBoard('owner', project.id))!.columns.find((column) => column.semanticType === 'component_qa')!
    const task = (await db.tasks.createTask('owner', project.id, { columnId: preparation.id, title: 'Feature' }))!
    await expect(async () => await db.qa.completeQaPreparation('owner', project.id, task.id)).rejects.toThrow(/хотя бы один сценарий/)
    await db.qa.createAcceptanceCriterion('owner', project.id, task.id, {
      title: 'Happy path', description: 'Проверка формы', preconditions: 'Открыть https://preview.test/form',
      steps: '1. Заполнить поле\n2. Нажать Сохранить', testData: 'Название: QA', expectedResult: 'Форма сохранена без ошибки',
      required: true, testType: 'manual'
    })
    await db.qa.completeQaPreparation('owner', project.id, task.id)
    const board = (await db.tasks.getBoard('owner', project.id))!
    const column = board.columns.find((item) => item.id === board.tasks.find((item) => item.id === task.id)!.columnId)
    expect(column?.semanticType).toBe('manual_qa')
  })

  it('versions semantic changes and stales active session without inheriting pass', async () => {
    const { project, task, criterion, base } = await fixture()
    const session = (await db.qa.startQaSession('owner', { projectId: project.id, taskId: task.id, branch: 'feature/1', commitSha: 'abc', testRunId: 'test-1', previewId: 'p', previewSha: 'abc' }))!
    await db.qa.saveQaResult('owner', project.id, task.id, session.results[0].id, 1, { status: 'passed', draft: false })
    const revised = (await db.qa.reviseAcceptanceCriterion('owner', project.id, task.id, criterion.id, { ...base, expectedResult: 'run stops within 1s', reason: 'timeout agreed' }))!
    expect(revised.currentVersion).toBe(2)
    const state = (await db.qa.getQaTaskState('owner', project.id, task.id))!
    expect(state.sessions[0].status).toBe('stale')
    expect(state.sessions[0].results[0].status).toBe('passed')
    expect(state.versions.map((v) => v.version)).toEqual([2, 1])
  })

  it('enforces optimistic concurrency and blocks incomplete merge', async () => {
    const { project, task } = await fixture()
    const session = (await db.qa.startQaSession('owner', { projectId: project.id, taskId: task.id, branch: 'feature/1', commitSha: 'abc', testRunId: 'test-1' }))!
    await expect(async () => await db.qa.completeQaSession('owner', project.id, task.id, session.id, '')).rejects.toThrow(/not_tested/)
    const result = await db.qa.saveQaResult('owner', project.id, task.id, session.results[0].id, 1, { status: 'in_progress', draft: true, executedSteps: 'opened' })
    expect(result.revision).toBe(2)
    await expect(async () => await db.qa.saveQaResult('owner', project.id, task.id, result.id, 1, { status: 'passed' })).rejects.toThrow(/revision conflict/)
    await db.qa.saveQaResult('owner', project.id, task.id, result.id, 2, { status: 'passed', draft: false })
    await db.qa.completeQaSession('owner', project.id, task.id, session.id, 'verified')
    const board = (await db.tasks.getBoard('owner', project.id))!
    const column = board.columns.find((c) => c.id === board.tasks[0].columnId)
    expect(column?.semanticType).toBe('awaiting_merge')
  })

  it('requires structured fail and routes implementation defect to development', async () => {
    const { project, task } = await fixture()
    const session = (await db.qa.startQaSession('owner', { projectId: project.id, taskId: task.id, branch: 'feature/1', commitSha: 'abc', testRunId: 'test-1' }))!
    const id = session.results[0].id
    await expect(async () => await db.qa.saveQaResult('owner', project.id, task.id, id, 1, { status: 'failed', draft: false })).rejects.toThrow(/missing QA fields/)
    await db.qa.saveQaResult('owner', project.id, task.id, id, 1, {
      status: 'failed', draft: false, executedSteps: 'click Cancel', actualResult: 'still running', comment: 'Cancel does not stop the run',
      classification: 'implementation_defect', severity: 'major', frequency: 'always', reproduction: 'start then cancel'
    })
    const state = (await db.qa.getQaTaskState('owner', project.id, task.id))!
    expect(state.sessions[0].results[0].issue?.classification).toBe('implementation_defect')
    const taskBoard = (await db.tasks.getBoard('owner', project.id))!
    const taskColumn = taskBoard.columns.find((c) => c.id === taskBoard.tasks[0].columnId)
    expect(taskColumn?.semanticType).toBe('manual_qa')
  })

  it.skipIf(ON_POSTGRES)('validates blocked comments, ownership, status and audits previous/new values', async () => {
    const { project, task } = await fixture()
    const session = (await db.qa.startQaSession('owner', { projectId: project.id, taskId: task.id, branch: 'feature/1', commitSha: 'abc', testRunId: 'test-1' }))!
    const result = session.results[0]
    await expect(async () => await db.qa.saveQaResult('owner', project.id, task.id, result.id, 1, {
      status: 'blocked', draft: false, blockerReason: 'Preview down', blockerType: 'environment', blockerOwner: 'ops'
    })).rejects.toThrow(/comment/)
    await expect(async () => await db.qa.saveQaResult('developer', project.id, task.id, result.id, 1, { status: 'passed', draft: false })).rejects.toThrow(/permission/)
    await expect(async () => await db.qa.saveQaResult('owner', project.id, 'another-task', result.id, 1, { status: 'passed', draft: false })).rejects.toThrow(/not found/)
    await expect(async () => await db.qa.saveQaResult('owner', project.id, task.id, result.id, 1, { status: 'unknown' as never, draft: false })).rejects.toThrow(/invalid QA result status/)
    await db.qa.saveQaResult('owner', project.id, task.id, result.id, 1, {
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

  it('binds screenshot metadata to project/result and denies outsiders', async () => {
    const { project, task } = await fixture()
    const session = (await db.qa.startQaSession('owner', { projectId: project.id, taskId: task.id, branch: 'feature/1', commitSha: 'abc', testRunId: 'test-1' }))!
    const attachment = await db.qa.addQaAttachment('owner', project.id, task.id, session.results[0].id, { uploadId: 'opaque-upload', name: '../../proof.png', mimeType: 'image/png', size: 42, caption: 'Cancel result' })
    expect((await db.qa.getQaAttachment('owner', attachment.id))?.uploadId).toBe('opaque-upload')
    expect((await db.qa.getQaAttachment('developer', attachment.id))?.taskId).toBe(task.id)
    await db.identity.createUser('outsider', '', 'developer')
    expect(await db.qa.getQaAttachment('outsider', attachment.id)).toBeNull()
  })

  it('does not let an ordinary developer attest QA', async () => {
    const { project, task } = await fixture()
    await expect(async () => await db.qa.startQaSession('developer', { projectId: project.id, taskId: task.id, branch: 'feature/1', commitSha: 'abc', testRunId: 'test-1' })).rejects.toThrow(/permission/)
  })

  it('deduplicates QA preparation by task and SHA and stales a session for a new SHA', async () => {
    const { project, task } = await fixture()
    const session = (await db.qa.startQaSession('owner', { projectId: project.id, taskId: task.id, branch: 'feature/1', commitSha: 'abc', testRunId: 'test-1' }))!
    const first = (await db.qa.startQaPreparationRun(project.id, task.id, 'feature/1', 'abc'))!
    expect(await db.qa.startQaPreparationRun(project.id, task.id, 'feature/1', 'abc')).toBeNull()
    await db.qa.recordQaPreparationAttempt(first.id, 1, 'Жду результаты…', 'Невалидный JSON')
    await db.qa.finishQaPreparationRun(first.id, 'failed', 'Невалидный JSON')
    expect((await db.qa.startQaPreparationRun(project.id, task.id, 'feature/1', 'abc', true))?.id).toBe(first.id)
    expect(await db.qa.startQaPreparationRun(project.id, task.id, 'feature/1', 'abc', true)).toBeNull()
    expect(await db.qa.failInterruptedQaPreparationRuns()).toEqual([first.id])
    const state = (await db.qa.getQaTaskState('owner', project.id, task.id))!
    expect(state.preparation).toMatchObject({ status: 'failed', canRetry: true, error: 'Подготовка прервана перезапуском сервера' })
    expect(await db.qa.startQaPreparationRun(project.id, task.id, 'feature/1', 'def')).not.toBeNull()
    expect((await db.qa.getQaTaskState('owner', project.id, task.id))?.sessions.find((item) => item.id === session.id)?.status).toBe('stale')
  })

  it.skipIf(ON_POSTGRES)('uses the pushed workspace machine for a merge run instead of the project default', async () => {
    const project = await db.projects.createProject('owner', { name: 'Merge' })
    const awaiting = (await db.tasks.getBoard('owner', project.id))!.columns.find((column) => column.semanticType === 'awaiting_merge')!
    const task = (await db.tasks.createTask('owner', project.id, { columnId: awaiting.id, title: 'Feature' }))!
    const raw = (db as unknown as { db: { prepare(sql: string): { run(...values: unknown[]): unknown } } }).db
    raw.prepare(`INSERT INTO agents (id,name,token_hash,created_at,user_id) VALUES (?,?,?,?,?)`).run('default-agent', 'Default', 'x', 1, 'owner')
    raw.prepare(`INSERT INTO agents (id,name,token_hash,created_at,user_id) VALUES (?,?,?,?,?)`).run('workspace-agent', 'Workspace', 'x', 1, 'owner')
    raw.prepare(`INSERT INTO project_machines (project_id,agent_id,path,repos_root,added_at,added_by) VALUES (?,?,?,?,?,?)`).run(project.id, 'default-agent', '/default', '/repos', 1, 'owner')
    raw.prepare(`INSERT INTO project_machines (project_id,agent_id,path,repos_root,added_at,added_by) VALUES (?,?,?,?,?,?)`).run(project.id, 'workspace-agent', '/workspace', '/repos', 1, 'owner')
    raw.prepare(`UPDATE projects SET git_url=?,default_agent_id=? WHERE id=?`).run('git@example/repo.git', 'default-agent', project.id)
    raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('workspace', project.id, task.id, 'workspace-agent', '/repos/task', 'CHAT-179', '1'.repeat(40), 1, 'released', 2)

    expect((await db.ci.startMergeRun('owner', project.id, task.id)).agentId).toBe('workspace-agent')
    const moved = (await db.tasks.getBoard('owner', project.id))!.tasks.find((item) => item.id === task.id)!
    expect((await db.tasks.getBoard('owner', project.id))!.columns.find((item) => item.id === moved.columnId)?.semanticType).toBe('merge')
  })

  it.skipIf(ON_POSTGRES)('считает подряд упавшие merge-раны и помнит время последнего', async () => {
    const project = await db.projects.createProject('owner', { name: 'Merge counters' })
    const awaiting = (await db.tasks.getBoard('owner', project.id))!.columns.find((column) => column.semanticType === 'awaiting_merge')!
    const task = (await db.tasks.createTask('owner', project.id, { columnId: awaiting.id, title: 'Feature' }))!
    const agent = await db.machines.createAgent('owner', 'Mac')
    const raw = (db as unknown as { db: { prepare(sql: string): { run(...values: unknown[]): unknown } } }).db
    raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('ws-counters', project.id, task.id, agent.id, '/repos/task', 'CHAT-900', '1'.repeat(40), 1, 'released', 1)

    expect(await db.ci.countTrailingFailedMergeRuns(task.id)).toBe(0)
    expect(await db.ci.lastMergeRunFinishedAt(task.id)).toBeNull()

    const first = await db.ci.startMergeRun('owner', project.id, task.id)
    raw.prepare(`UPDATE merge_runs SET status='failed',finished_at=? WHERE id=?`).run(500, first.id)
    const second = await db.ci.startMergeRun('owner', project.id, task.id)
    raw.prepare(`UPDATE merge_runs SET status='failed',finished_at=? WHERE id=?`).run(900, second.id)

    expect(await db.ci.countTrailingFailedMergeRuns(task.id)).toBe(2)
    expect(await db.ci.lastMergeRunFinishedAt(task.id)).toBe(900)

    // Успех обнуляет хвост: считаем только последние подряд идущие провалы.
    const third = await db.ci.startMergeRun('owner', project.id, task.id)
    raw.prepare(`UPDATE merge_runs SET status='success',finished_at=? WHERE id=?`).run(1200, third.id)
    expect(await db.ci.countTrailingFailedMergeRuns(task.id)).toBe(0)
  })

  it.skipIf(ON_POSTGRES)('records the actual Codex model from global settings for a merge run', async () => {
    const project = await db.projects.createProject('owner', { name: 'Merge Codex' })
    const awaiting = (await db.tasks.getBoard('owner', project.id))!.columns.find((column) => column.semanticType === 'awaiting_merge')!
    const task = (await db.tasks.createTask('owner', project.id, { columnId: awaiting.id, title: 'Feature' }))!
    const agent = await db.machines.createAgent('owner', 'Mac')
    const raw = (db as unknown as { db: { prepare(sql: string): { run(...values: unknown[]): unknown } } }).db
    raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('workspace-codex', project.id, task.id, agent.id, '/repos/task', 'CHAT-266', '1'.repeat(40), 1, 'released', 1)
    await db.settings.saveSettings('owner', { ...DEFAULT_SETTINGS, llmProvider: 'codex', codexModel: 'gpt-5.6-sol' })

    expect(await db.ci.startMergeRun('owner', project.id, task.id)).toMatchObject({
      llmProvider: 'codex', llmModel: 'gpt-5.6-sol',
      requestedLlmProvider: 'codex', requestedLlmModel: 'gpt-5.6-sol', llmFallbackReason: null
    })
  })

  it.skipIf(ON_POSTGRES)('uses the effective kb_update stage LLM for a merge run', async () => {
    const project = await db.projects.createProject('owner', { name: 'Merge stage LLM' })
    const awaiting = (await db.tasks.getBoard('owner', project.id))!.columns.find((column) => column.semanticType === 'awaiting_merge')!
    const task = (await db.tasks.createTask('owner', project.id, { columnId: awaiting.id, title: 'Feature' }))!
    const agent = await db.machines.createAgent('owner', 'Mac')
    const raw = (db as unknown as { db: { prepare(sql: string): { run(...values: unknown[]): unknown } } }).db
    raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('workspace-stage-llm', project.id, task.id, agent.id, '/repos/task', 'CHAT-274', '1'.repeat(40), 1, 'released', 1)
    await db.settings.saveSettings('owner', { ...DEFAULT_SETTINGS, llmProvider: 'claude', model: 'sonnet' })
    await db.ci.setCiStageLlmConfig('project', project.id, 'kb_update', { provider: 'codex', model: 'gpt-5.6-sol' })

    expect(await db.ci.startMergeRun('owner', project.id, task.id)).toMatchObject({
      llmProvider: 'codex', llmModel: 'gpt-5.6-sol',
      requestedLlmProvider: 'codex', requestedLlmModel: 'gpt-5.6-sol', llmFallbackReason: null
    })
  })

  it.skipIf(ON_POSTGRES)('inherits the latest development LLM when kb_update has no override', async () => {
    const project = await db.projects.createProject('owner', { name: 'Merge development LLM' })
    const awaiting = (await db.tasks.getBoard('owner', project.id))!.columns.find((column) => column.semanticType === 'awaiting_merge')!
    const task = (await db.tasks.createTask('owner', project.id, { columnId: awaiting.id, title: 'Feature' }))!
    const agent = await db.machines.createAgent('owner', 'Mac')
    const raw = (db as unknown as { db: { prepare(sql: string): { run(...values: unknown[]): unknown } } }).db
    raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('workspace-development-llm', project.id, task.id, agent.id, '/repos/task', 'CHAT-274-dev', '2'.repeat(40), 1, 'released', 1)
    raw.prepare(`INSERT INTO ci_runs (id,project_id,task_id,status,triggered_by,llm_provider,llm_model,mode,created_at) VALUES (?,?,?,'success','owner','codex','gpt-5.6-sol','development',?)`).run('development-llm', project.id, task.id, 2)
    await db.settings.saveSettings('owner', { ...DEFAULT_SETTINGS, llmProvider: 'claude', model: 'sonnet' })

    expect(await db.ci.startMergeRun('owner', project.id, task.id)).toMatchObject({
      llmProvider: 'codex', llmModel: 'gpt-5.6-sol',
      requestedLlmProvider: 'codex', requestedLlmModel: 'gpt-5.6-sol', llmFallbackReason: null
    })
  })

  it.skipIf(ON_POSTGRES)('gives a per-run override priority and records an allowed provider fallback', async () => {
    const project = await db.projects.createProject('owner', { name: 'Merge override' })
    const awaiting = (await db.tasks.getBoard('owner', project.id))!.columns.find((column) => column.semanticType === 'awaiting_merge')!
    const task = (await db.tasks.createTask('owner', project.id, { columnId: awaiting.id, title: 'Feature' }))!
    const agent = await db.machines.createAgent('owner', 'Mac')
    const raw = (db as unknown as { db: { prepare(sql: string): { run(...values: unknown[]): unknown } } }).db
    raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('workspace-override', project.id, task.id, agent.id, '/repos/task', 'CHAT-266', '1'.repeat(40), 1, 'released', 1)
    await db.settings.saveSettings('owner', { ...DEFAULT_SETTINGS, llmProvider: 'claude', model: 'sonnet' })

    const overridden = await db.ci.startMergeRun('owner', project.id, task.id, null, { provider: 'codex', model: 'gpt-5.6-luna' })
    expect(overridden).toMatchObject({ llmProvider: 'codex', llmModel: 'gpt-5.6-luna', requestedLlmProvider: 'codex', requestedLlmModel: 'gpt-5.6-luna', llmFallbackReason: null })
    await db.ci.updateMergeRun(overridden.id, { status: 'failed', stage: 'failed' })
    await db.tasks.moveMergeTask(project.id, task.id, 'awaiting_merge')
    await db.identity.setUserLlmAccess('owner', [{ provider: 'codex', modelId: '*' }])

    const fallback = await db.ci.startMergeRun('owner', project.id, task.id, null, { provider: 'codex', model: 'gpt-5.6-sol' })
    expect(fallback).toMatchObject({ llmProvider: 'claude', llmModel: 'sonnet', requestedLlmProvider: 'codex', requestedLlmModel: 'gpt-5.6-sol', llmFallbackReason: 'provider_unavailable' })
  })

  it.skipIf(ON_POSTGRES)('allows the owner personal workspace machine and exposes a newer source after a successful merge', async () => {
    const project = await db.projects.createProject('owner', { name: 'Repeated merge' })
    const awaiting = (await db.tasks.getBoard('owner', project.id))!.columns.find((column) => column.semanticType === 'awaiting_merge')!
    const task = (await db.tasks.createTask('owner', project.id, { columnId: awaiting.id, title: 'Feature' }))!
    const personal = await db.machines.createAgent('owner', 'Personal Mac')
    const raw = (db as unknown as { db: { prepare(sql: string): { run(...values: unknown[]): unknown } } }).db
    raw.prepare(`UPDATE projects SET git_url=? WHERE id=?`).run('git@example/repo.git', project.id)
    raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('workspace-old', project.id, task.id, personal.id, '/repos/task', 'CHAT-194', '1'.repeat(40), 1, 'released', 1)

    const merged = await db.ci.startMergeRun('owner', project.id, task.id)
    expect(merged).toMatchObject({ agentId: personal.id, machineName: 'Personal Mac' })
    await db.ci.updateMergeRun(merged.id, { status: 'success', stage: 'success', mergeSha: '2'.repeat(40) })
    await db.tasks.moveMergeTask(project.id, task.id, 'awaiting_merge')
    raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('workspace-new', project.id, task.id, personal.id, '/repos/task', 'CHAT-194', '3'.repeat(40), 1, 'released', 2)

    expect((await db.tasks.getBoard('owner', project.id))!.tasks.find((item) => item.id === task.id)).toMatchObject({
      mergeSourceSha: '3'.repeat(40),
      mergedSourceSha: '1'.repeat(40),
      mergedSha: '2'.repeat(40),
      mergeMachineBound: true
    })
  })

  it.skipIf(ON_POSTGRES)('lets a conflict retry pin the resolved branch SHA during fetch', async () => {
    const project = await db.projects.createProject('owner', { name: 'Merge retry' })
    const awaiting = (await db.tasks.getBoard('owner', project.id))!.columns.find((column) => column.semanticType === 'awaiting_merge')!
    const task = (await db.tasks.createTask('owner', project.id, { columnId: awaiting.id, title: 'Feature' }))!
    const raw = (db as unknown as { db: { prepare(sql: string): { run(...values: unknown[]): unknown } } }).db
    raw.prepare(`INSERT INTO agents (id,name,token_hash,created_at,user_id) VALUES (?,?,?,?,?)`).run('workspace-agent', 'Workspace', 'x', 1, 'owner')
    raw.prepare(`INSERT INTO project_machines (project_id,agent_id,path,repos_root,added_at,added_by) VALUES (?,?,?,?,?,?)`).run(project.id, 'workspace-agent', '/workspace', '/repos', 1, 'owner')
    raw.prepare(`UPDATE projects SET git_url=? WHERE id=?`).run('git@example/repo.git', project.id)
    raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('workspace', project.id, task.id, 'workspace-agent', '/repos/task', 'CHAT-179', '1'.repeat(40), 1, 'released', 2)
    const failed = await db.ci.startMergeRun('owner', project.id, task.id)
    await db.ci.updateMergeRun(failed.id, { status: 'decision_required', stage: 'decision_required', conflicts: ['file.ts'] })

    expect((await db.ci.retryMergeRun('owner', failed.id)).sourceSha).toBeNull()
  })

  it.skipIf(ON_POSTGRES)('unpins the source SHA when retrying a stale-source run, but keeps it for ordinary failures', async () => {
    const project = await db.projects.createProject('owner', { name: 'Merge stale retry' })
    const awaiting = (await db.tasks.getBoard('owner', project.id))!.columns.find((column) => column.semanticType === 'awaiting_merge')!
    const task = (await db.tasks.createTask('owner', project.id, { columnId: awaiting.id, title: 'Feature' }))!
    const raw = (db as unknown as { db: { prepare(sql: string): { run(...values: unknown[]): unknown } } }).db
    raw.prepare(`INSERT INTO agents (id,name,token_hash,created_at,user_id) VALUES (?,?,?,?,?)`).run('workspace-agent', 'Workspace', 'x', 1, 'owner')
    raw.prepare(`INSERT INTO project_machines (project_id,agent_id,path,repos_root,added_at,added_by) VALUES (?,?,?,?,?,?)`).run(project.id, 'workspace-agent', '/workspace', '/repos', 1, 'owner')
    raw.prepare(`UPDATE projects SET git_url=? WHERE id=?`).run('git@example/repo.git', project.id)
    raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('workspace', project.id, task.id, 'workspace-agent', '/repos/task', 'CHAT-179', '1'.repeat(40), 1, 'released', 2)

    const stale = await db.ci.startMergeRun('owner', project.id, task.id)
    await db.ci.updateMergeRun(stale.id, { status: 'decision_required', stage: 'decision_required', error: 'stale source: ветка изменилась после development-рана' })
    const unpinned = await db.ci.retryMergeRun('owner', stale.id)
    expect(unpinned.sourceSha).toBeNull()
    await db.ci.updateMergeRun(unpinned.id, { status: 'cancelled', stage: 'cancelled' })
    await db.tasks.moveMergeTask(project.id, task.id, 'awaiting_merge')

    const failed = await db.ci.startMergeRun('owner', project.id, task.id)
    await db.ci.updateMergeRun(failed.id, { status: 'failed', stage: 'failed', error: 'Проверки упали (exit 1)' })
    const pinned = await db.ci.retryMergeRun('owner', failed.id)
    expect(pinned.sourceSha).toBe('1'.repeat(40))

    await db.ci.updateMergeRun(pinned.id, { status: 'failed', stage: 'failed', error: 'Проверки упали (exit 1)' })
    await db.tasks.moveMergeTask(project.id, task.id, 'awaiting_merge')
    expect((await db.ci.retryMergeRun('owner', pinned.id, null, true)).sourceSha).toBeNull()
    expect((await db.ci.listMergeRuns('owner', project.id, task.id)).length).toBeGreaterThanOrEqual(4)
    expect(await db.ci.listMergeRuns('stranger', project.id, task.id)).toHaveLength(0)
  })

  it.skipIf(ON_POSTGRES)('starts a merge run on an explicitly chosen project machine and rejects unbound ones', async () => {
    const project = await db.projects.createProject('owner', { name: 'Merge machine choice' })
    const awaiting = (await db.tasks.getBoard('owner', project.id))!.columns.find((column) => column.semanticType === 'awaiting_merge')!
    const task = (await db.tasks.createTask('owner', project.id, { columnId: awaiting.id, title: 'Feature' }))!
    const raw = (db as unknown as { db: { prepare(sql: string): { run(...values: unknown[]): unknown } } }).db
    raw.prepare(`INSERT INTO agents (id,name,token_hash,created_at,user_id) VALUES (?,?,?,?,?)`).run('workspace-agent', 'Workspace', 'x', 1, 'owner')
    raw.prepare(`INSERT INTO agents (id,name,token_hash,created_at,user_id) VALUES (?,?,?,?,?)`).run('other-agent', 'Other', 'x', 1, 'owner')
    raw.prepare(`INSERT INTO project_machines (project_id,agent_id,path,repos_root,added_at,added_by) VALUES (?,?,?,?,?,?)`).run(project.id, 'workspace-agent', '/workspace', '/repos', 1, 'owner')
    raw.prepare(`INSERT INTO project_machines (project_id,agent_id,path,repos_root,added_at,added_by) VALUES (?,?,?,?,?,?)`).run(project.id, 'other-agent', '/other', '/other-repos', 1, 'owner')
    raw.prepare(`UPDATE projects SET git_url=? WHERE id=?`).run('git@example/repo.git', project.id)
    raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('workspace', project.id, task.id, 'workspace-agent', '/repos/task', 'CHAT-180', '1'.repeat(40), 1, 'released', 2)

    await expect(async () => await db.ci.startMergeRun('owner', project.id, task.id, 'ghost-agent')).rejects.toThrow('merge machine is not available to user or project')
    const run = await db.ci.startMergeRun('owner', project.id, task.id, 'other-agent')
    expect(run.agentId).toBe('other-agent')
    expect(await db.machines.getProjectMachine(project.id, 'other-agent')).toMatchObject({ reposRoot: '/other-repos' })
    await db.ci.updateMergeRun(run.id, { status: 'failed', stage: 'failed', error: 'Проверки упали (exit 1)' })
    await db.tasks.moveMergeTask(project.id, task.id, 'awaiting_merge')
    expect((await db.ci.retryMergeRun('owner', run.id)).agentId).toBe('other-agent')
  })

  it.skipIf(ON_POSTGRES)('prefers the latest pushed workspace even when a newer unpushed one exists', async () => {
    const project = await db.projects.createProject('owner', { name: 'Pushed workspace wins' })
    const awaiting = (await db.tasks.getBoard('owner', project.id))!.columns.find((column) => column.semanticType === 'awaiting_merge')!
    const task = (await db.tasks.createTask('owner', project.id, { columnId: awaiting.id, title: 'Feature' }))!
    const raw = (db as unknown as { db: { prepare(sql: string): { run(...values: unknown[]): unknown } } }).db
    raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('pushed', project.id, task.id, 'agent-a', '/repos/task', 'CHAT-182', '1'.repeat(40), 1, 'released', 1)
    raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('fresh', project.id, task.id, 'agent-a', '/repos/task', null, null, 0, 'active', 2)

    expect((await db.ci.findLatestCiWorkspace(project.id, task.id))?.id).toBe('fresh')
    expect((await db.ci.findLatestPushedCiWorkspace(project.id, task.id))?.id).toBe('pushed')
  })

  it('tracks task repositories per machine until confirmed deletion', async () => {
    const project = await db.projects.createProject('owner', { name: 'Task repos' })
    const awaiting = (await db.tasks.getBoard('owner', project.id))!.columns.find((column) => column.semanticType === 'awaiting_merge')!
    const task = (await db.tasks.createTask('owner', project.id, { columnId: awaiting.id, title: 'Feature' }))!
    await db.tasks.upsertTaskRepository(project.id, task.id, 'agent-x', '/repos/chatai/CHAT-1', 'dev-workspace')
    await db.tasks.upsertTaskRepository(project.id, task.id, 'agent-y', '/repos2/chatai/CHAT-1.merge-r1', 'merge-clone')
    expect(await db.tasks.listActiveTaskRepositories(task.id)).toHaveLength(2)

    await db.tasks.markTaskRepositoryDeleted(task.id, 'agent-y', '/repos2/chatai/CHAT-1.merge-r1')
    expect(await db.tasks.listActiveTaskRepositories(task.id)).toHaveLength(1)
    const all = await db.tasks.listTaskRepositories('owner', project.id, task.id)
    expect(all).toHaveLength(2)
    expect(all.find((repo) => repo.agentId === 'agent-y')?.state).toBe('deleted')
    expect(await db.tasks.listTaskRepositories('stranger', project.id, task.id)).toHaveLength(0)

    await db.tasks.upsertTaskRepository(project.id, task.id, 'agent-y', '/repos2/chatai/CHAT-1.merge-r1', 'merge-clone')
    expect(await db.tasks.listActiveTaskRepositories(task.id)).toHaveLength(2)
  })

  it('keeps three QA stage histories independent, idempotent and gate-driven', async () => {
    const project = await db.projects.createProject('owner', { name: 'QA stages' })
    const board = (await db.tasks.getBoard('owner', project.id))!
    const component = board.columns.find((column) => column.semanticType === 'component_qa')!
    const task = (await db.tasks.createTask('owner', project.id, { columnId: component.id, title: 'Feature' }))!

    const first = await db.qa.startQaStageRun('owner', project.id, task.id, 'component_qa')
    expect((await db.qa.startQaStageRun('owner', project.id, task.id, 'component_qa')).id).toBe(first.id)
    expect(first).toMatchObject({ kind: 'componentQaRun', attempt: 1, canCancel: true })
    await db.qa.cancelQaStageRun('owner', first.id)
    const retry = (await db.qa.retryQaStageRun('owner', first.id))!
    expect(retry).toMatchObject({ stage: 'component_qa', attempt: 2 })
    await db.qa.completeQaStageRun('owner', retry.id, { gatePassed: false, gateReasons: ['dom_failed'] })
    expect(await db.qa.getQaStageRun('owner', retry.id)).toMatchObject({ status: 'gate_failed', gateReasons: ['dom_failed'] })
    const afterGate = (await db.tasks.getBoard('owner', project.id))!
    expect(afterGate.columns.find((column) => column.id === afterGate.tasks.find((item) => item.id === task.id)!.columnId)?.semanticType).toBe('component_qa')

    const passed = (await db.qa.retryQaStageRun('owner', retry.id))!
    await db.qa.completeQaStageRun('owner', passed.id, { gatePassed: true, components: ['TaskModal'] })
    const afterPass = (await db.tasks.getBoard('owner', project.id))!
    expect(afterPass.columns.find((column) => column.id === afterPass.tasks.find((item) => item.id === task.id)!.columnId)?.semanticType).toBe('integration_tests')
    const integration = await db.qa.startQaStageRun('owner', project.id, task.id, 'integration_tests')
    expect(await db.qa.listQaStageRuns('owner', project.id, task.id, 'component_qa')).toHaveLength(3)
    expect(await db.qa.listQaStageRuns('owner', project.id, task.id, 'integration_tests')).toHaveLength(1)
    await db.qa.completeQaStageRun('owner', integration.id, { testCases: [] })
    expect(await db.qa.getQaStageRun('owner', integration.id)).toMatchObject({ status: 'gate_failed', gateReasons: ['missing_required_test_cases'] })
  })

  it('marks unfinished QA stage runs interrupted after restart reconciliation', async () => {
    const project = await db.projects.createProject('owner', { name: 'QA recovery' })
    const component = (await db.tasks.getBoard('owner', project.id))!.columns.find((column) => column.semanticType === 'component_qa')!
    const task = (await db.tasks.createTask('owner', project.id, { columnId: component.id, title: 'Feature' }))!
    const run = await db.qa.startQaStageRun('owner', project.id, task.id, 'component_qa')
    expect(await db.qa.failInterruptedQaStageRuns()).toEqual([run.id])
    expect(await db.qa.getQaStageRun('owner', run.id)).toMatchObject({ status: 'interrupted', canRetry: true })
  })

  async function componentFixture(uiImpact:'none'|'existing_components'='existing_components') {
    const project=await db.projects.createProject('owner',{name:'Component QA'})
    const column=(await db.tasks.getBoard('owner',project.id))!.columns.find((item)=>item.semanticType==='component_qa')!
    const task=(await db.tasks.createTask('owner',project.id,{columnId:column.id,title:'Button'}))!
    const raw=(db as unknown as {db:{prepare(sql:string):{run(...values:unknown[]):unknown}}}).db
    const readiness={functionalRequirements:'Button works',acceptanceCriteria:'Visible',acceptanceCriteriaConflict:false,uiImpact,
      testCases:uiImpact==='none'?[]:[{id:'TC-COMP',title:'Default',description:'',preconditions:'Storybook',testData:'fixture',steps:'render',expectedResult:'visible',required:true,testType:'ui',automatable:true,automationLinks:[],notAutomatedReason:'',alternativeManualVerification:'',comments:''}],
      affectedComponents:uiImpact==='none'?[]:[{id:'button',name:'Button',storybookStoryId:'ui-button--default',reusable:true,coverage:{stories:true,states:true,fixtures:true,playFunctions:true,domTests:true,accessibility:true,visual:true},exclusionReason:'',alternativeVerification:''}]}
    raw.prepare(`INSERT INTO task_preparation_runs (id,project_id,task_id,status,readiness_json,created_at,finished_at) VALUES (?,?,?,'success',?,?,?)`).run('prep-component',project.id,task.id,JSON.stringify(readiness),1,2)
    raw.prepare(`INSERT INTO ci_workspaces (id,project_id,task_id,agent_id,path,branch,commit_sha,pushed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('ws-component',project.id,task.id,'agent-component','/repos/component','CHAT-227','a'.repeat(40),1,'released',3)
    raw.prepare(`INSERT INTO ci_runs (id,project_id,task_id,status,workspace_id,triggered_by,mode,created_at) VALUES (?,?,?,'success',?,'owner','development',?)`).run('dev-component',project.id,task.id,'ws-component',4)
    return {project,task,raw}
  }

  it('creates one active Component QA run pinned to the development SHA',async ()=>{
    const {project,task}=await componentFixture()
    const first=await db.ci.startComponentQaRun('owner',project.id,task.id)
    const second=await db.ci.startComponentQaRun('owner',project.id,task.id)
    expect(second.id).toBe(first.id)
    expect(first).toMatchObject({status:'queued',commitSha:'a'.repeat(40),developmentRunId:'dev-component',attempt:1})
    expect((await db.tasks.getComponentQaTaskState('owner',project.id,task.id))?.activeRun?.id).toBe(first.id)
  })

  it('audits uiImpact none as skipped and moves to integration tests',async ()=>{
    const {project,task}=await componentFixture('none')
    const run=await db.ci.startComponentQaRun('owner',project.id,task.id)
    expect(run).toMatchObject({status:'skipped',uiImpact:'none'})
    const board=(await db.tasks.getBoard('owner',project.id))!
    const moved=board.tasks.find((item)=>item.id===task.id)!
    expect(board.columns.find((item)=>item.id===moved.columnId)?.semanticType).toBe('integration_tests')
  })

  it('marks interrupted execution as infrastructure and permits retry',async ()=>{
    const {project,task}=await componentFixture()
    const run=await db.ci.startComponentQaRun('owner',project.id,task.id)
    await db.ci.markComponentQaRunning(run.id)
    expect(await db.ci.failInterruptedComponentQaRuns()).toEqual([run.id])
    expect(await db.ci.getComponentQaRun('owner',run.id)).toMatchObject({status:'blocked',failureClassification:'infrastructure',canRetry:true})
  })

  async function integrationFixture(automatable=true){
    const {project,task,raw}=await componentFixture('none')
    const integration=(await db.tasks.getBoard('owner',project.id))!.columns.find((item)=>item.semanticType==='integration_tests')!
    raw.prepare(`UPDATE tasks SET column_id=? WHERE id=?`).run(integration.id,task.id)
    const testCase={id:'TC-INT',title:'API flow',description:'',preconditions:'server',testData:'fixture',steps:'request',expectedResult:'200',required:true,testType:'integration',automatable,automationLinks:[],notAutomatedReason:automatable?'':'External hardware',alternativeManualVerification:automatable?'':'Run device checklist',comments:''}
    const readiness={functionalRequirements:'API works',acceptanceCriteria:'200',acceptanceCriteriaConflict:false,uiImpact:'none',testCases:[testCase],affectedComponents:[]}
    raw.prepare(`UPDATE task_preparation_runs SET readiness_json=? WHERE id='prep-component'`).run(JSON.stringify(readiness))
    return {project,task,raw}
  }
  it('creates one active integration-test run and enforces physical idempotency',async ()=>{
    const {project,task}=await integrationFixture()
    const first=await db.ci.startIntegrationTestRun('owner',project.id,task.id),second=await db.ci.startIntegrationTestRun('owner',project.id,task.id)
    expect(second.id).toBe(first.id)
    expect(first).toMatchObject({status:'queued',commitSha:'a'.repeat(40),developmentRunId:'dev-component'})
  })
  it('audits a valid no-automation branch as skipped and moves to Automated QA',async ()=>{
    const {project,task}=await integrationFixture(false)
    expect((await db.ci.startIntegrationTestRun('owner',project.id,task.id)).status).toBe('skipped')
    const board=(await db.tasks.getBoard('owner',project.id))!,moved=board.tasks.find((item)=>item.id===task.id)!
    expect(board.columns.find((item)=>item.id===moved.columnId)?.semanticType).toBe('automated_qa')
  })
  it.skipIf(ON_POSTGRES)('stales the previous integration run after a workspace SHA change',async ()=>{
    const {project,task,raw}=await integrationFixture()
    const run=await db.ci.startIntegrationTestRun('owner',project.id,task.id)
    await db.ci.markIntegrationTestRunning(run.id)
    raw.prepare(`UPDATE ci_workspaces SET commit_sha=? WHERE id='ws-component'`).run('b'.repeat(40))
    const next=await db.ci.startIntegrationTestRun('owner',project.id,task.id)
    expect(await db.ci.getIntegrationTestRun('owner',run.id)).toMatchObject({status:'stale',staleReason:'sha_changed'})
    expect(next.id).not.toBe(run.id)
  })
})
