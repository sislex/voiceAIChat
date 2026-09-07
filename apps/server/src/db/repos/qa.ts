// Домен «qa»: таблицы qa_sessions, qa_stage_runs, qa_preparation_runs, qa_criterion_results, qa_issues, qa_attachments, qa_audit, acceptance_criteria, acceptance_criterion_versions.
// Файл получен разрезанием бывшего VoiceChatDb (apps/server/src/db/database.ts) по владению таблицами;
// карта владения — ./ownership.ts, правила — docs/plans/db-repositories.md.
import type { AutomatedQaMode, AutomatedQaScenario } from '@voicechat/shared'
import { parseAutomatedQaScenarios, type LlmProvider, type KanbanColumnSemanticType, QA_CRITERION_TEST_TYPES, canCompleteQa, canTransitionWorkflow, validateQaResult, QA_RESULT_STATUSES, type AcceptanceCriterion, type AcceptanceCriterionSnapshot, type AcceptanceCriterionVersion, type QaTaskState, type AnyQaStageRun, type QaRunStage, type QaStageRunStatus, QA_RUN_KIND, canCompleteAutomation, type QaSession, type QaCriterionResult, type QaAttachment, type QaIssue, type QaResultStatus, type QaIssueClassification, type QaSeverity, type QaFrequency } from '@voicechat/shared'
import { BaseRepo } from './base.js'
import { normalizeAutomatedQaScenario, parseStringArray, parseJsonValue } from './support.js'

// ============== Ручное QA: строки БД и мапперы ==================
interface QaCriterionRow { id:string;task_id:string;position:number;title:string;description:string;preconditions:string;steps:string;test_data:string;expected_result:string;required:number;test_type:string;current_version:number;active:number;author:string;created_at:number;updated_at:number }

interface QaCriterionVersionRow { criterion_id:string;version:number;snapshot_json:string;author:string;reason:string;created_at:number;superseded_by:number|null }

interface QaSessionRow { id:string;task_id:string;project_id:string;branch:string;commit_sha:string;test_run_id:string;preview_id:string|null;preview_sha:string|null;app_url:string|null;storybook_url:string|null;test_data_scenario:string;criteria_snapshot_json:string;status:string;tester_id:string|null;initiated_by:string;started_at:number;finished_at:number|null;stale_reason:string|null;summary:string;additional_issues:string;linked_fix_run_id:string|null }

interface QaResultRow { id:string;session_id:string;criterion_id:string;criterion_version:number;status:string;draft:number;tester_id:string|null;assignee_id:string|null;started_at:number|null;finished_at:number|null;branch:string;commit_sha:string;preview_id:string|null;preview_sha:string|null;app_url:string|null;storybook_url:string|null;test_data_scenario:string;executed_steps:string;expected_result:string;actual_result:string;comment:string;environment:string;blocker_reason:string;blocker_type:string|null;blocker_owner:string|null;not_applicable_reason:string;revision:number;updated_at:number }

interface QaIssueRow { id:string;result_id:string;classification:string;severity:string;frequency:string;reproduction:string;proposed_route:string;requirement_proposal:string;resolution:string;linked_fix_run_id:string|null;created_at:number }

interface QaAttachmentRow { id:string;result_id:string;upload_id:string;name:string;mime_type:string;size:number;width:number|null;height:number|null;caption:string;author:string;created_at:number;commit_sha:string }

function qaSnapshot(value:AcceptanceCriterionSnapshot):AcceptanceCriterionSnapshot {
  // Список типов один — общий контракт QA. Пока здесь была тройка legacy-значений,
  // актуальные ui|api|integration|negative|regression молча превращались в manual,
  // и сценарий, по которому запускается Component QA, терял свой тип при сохранении.
  const testType=QA_CRITERION_TEST_TYPES.includes(value.testType)?value.testType:'manual'
  return {title:value.title.trim(),description:value.description.trim(),preconditions:value.preconditions.trim(),steps:value.steps.trim(),testData:value.testData.trim(),expectedResult:value.expectedResult.trim(),required:value.required!==false,testType}
}

function mapQaCriterion(r:QaCriterionRow):AcceptanceCriterion {
  return {id:r.id,taskId:r.task_id,order:r.position,title:r.title,description:r.description,preconditions:r.preconditions,steps:r.steps,testData:r.test_data,expectedResult:r.expected_result,required:!!r.required,testType:(r.test_type as AcceptanceCriterion['testType']),currentVersion:r.current_version,active:!!r.active,author:r.author,createdAt:r.created_at,updatedAt:r.updated_at}
}

function mapQaCriterionVersion(r:QaCriterionVersionRow):AcceptanceCriterionVersion {
  const snapshot=parseJsonValue<AcceptanceCriterionSnapshot>(r.snapshot_json,{title:'',description:'',preconditions:'',steps:'',testData:'',expectedResult:'',required:true,testType:'manual'})
  return {...snapshot,criterionId:r.criterion_id,version:r.version,author:r.author,reason:r.reason,createdAt:r.created_at,supersededBy:r.superseded_by}
}

function qaStatus(value:string):QaResultStatus {
  return value==='in_progress'||value==='passed'||value==='failed'||value==='blocked'||value==='not_applicable'||value==='stale'?value:'not_tested'
}

function mapQaResult(r:QaResultRow,attachments:QaAttachmentRow[],issue:QaIssueRow|null):QaCriterionResult {
  return {id:r.id,sessionId:r.session_id,criterionId:r.criterion_id,criterionVersion:r.criterion_version,status:qaStatus(r.status),draft:!!r.draft,testerId:r.tester_id,assigneeId:r.assignee_id,startedAt:r.started_at,finishedAt:r.finished_at,branch:r.branch,commitSha:r.commit_sha,previewId:r.preview_id,previewSha:r.preview_sha,appUrl:r.app_url,storybookUrl:r.storybook_url,testDataScenario:r.test_data_scenario,executedSteps:r.executed_steps,expectedResult:r.expected_result,actualResult:r.actual_result,comment:r.comment,environment:r.environment,blockerReason:r.blocker_reason,blockerType:r.blocker_type as QaCriterionResult['blockerType'],blockerOwner:r.blocker_owner,notApplicableReason:r.not_applicable_reason,revision:r.revision,updatedAt:r.updated_at,attachments:attachments.map(a=>({id:a.id,resultId:a.result_id,uploadId:a.upload_id,name:a.name,mimeType:a.mime_type as 'image/png'|'image/jpeg'|'image/webp',size:a.size,width:a.width,height:a.height,caption:a.caption,author:a.author,createdAt:a.created_at,commitSha:a.commit_sha})),issue:issue?{id:issue.id,resultId:issue.result_id,classification:issue.classification as QaIssueClassification,severity:issue.severity as QaSeverity,frequency:issue.frequency as QaFrequency,reproduction:issue.reproduction,proposedRoute:issue.proposed_route as QaIssue['proposedRoute'],requirementProposal:issue.requirement_proposal,resolution:issue.resolution,linkedFixRunId:issue.linked_fix_run_id,createdAt:issue.created_at}:null}
}

function mapQaSession(r:QaSessionRow,results:QaCriterionResult[]):QaSession {
  return {id:r.id,taskId:r.task_id,projectId:r.project_id,branch:r.branch,commitSha:r.commit_sha,testRunId:r.test_run_id,previewId:r.preview_id,previewSha:r.preview_sha,appUrl:r.app_url,storybookUrl:r.storybook_url,testDataScenario:r.test_data_scenario,criteriaSnapshot:parseJsonValue(r.criteria_snapshot_json,[]),status:(r.status==='passed'||r.status==='failed'||r.status==='blocked'||r.status==='stale'?r.status:'active'),testerId:r.tester_id,initiatedBy:r.initiated_by,startedAt:r.started_at,finishedAt:r.finished_at,staleReason:r.stale_reason,summary:r.summary,additionalIssues:r.additional_issues??'',linkedFixRunId:r.linked_fix_run_id??null,results}
}

/** Всё, что нужно раннеру этапа Automated QA: где выполнять и что именно. */
export interface AutomatedQaExecutionContext {
  agentId: string
  workdir: string
  command: string
  mode: AutomatedQaMode
  /** Все сценарии проекта: этап прогоняет набор, а не один. */
  scenarios: AutomatedQaScenario[]
}
export class QaRepo extends BaseRepo {
  private mapQaStageRun(row: Record<string, unknown>): AnyQaStageRun {
    const stage = row.stage as QaRunStage
    const status = row.status as QaStageRunStatus
    return {
      id: String(row.id), projectId: String(row.project_id), taskId: String(row.task_id),
      kind: QA_RUN_KIND[stage], stage, status, attempt: Number(row.attempt),
      triggeredBy: String(row.triggered_by), branch: String(row.branch ?? ''), commitSha: String(row.commit_sha ?? ''),
      llmEngineId: row.llm_engine_id as string | null, llmProvider: (row.llm_provider ?? 'claude') as LlmProvider,
      llmModel: String(row.llm_model ?? ''), currentStep: String(row.current_step ?? ''),
      progress: parseJsonValue(String(row.progress_json ?? '{}'), { current: 0, total: 0, label: '' }),
      log: parseJsonValue(String(row.log_json ?? '[]'), []), result: row.result_json ? parseJsonValue(String(row.result_json), {}) : null,
      scenarios: row.scenario_json ? parseAutomatedQaScenarios(parseJsonValue<unknown>(String(row.scenario_json), [])) : null,
      gateReasons: parseStringArray(String(row.gate_reasons_json ?? '[]')), error: row.error as string | null,
      createdAt: Number(row.created_at), startedAt: row.started_at == null ? null : Number(row.started_at),
      finishedAt: row.finished_at == null ? null : Number(row.finished_at),
      canCancel: ['queued','running','awaiting_input'].includes(status),
      canRetry: ['gate_failed','failed','cancelled','interrupted'].includes(status)
    } as AnyQaStageRun
  }

  async getQaStageRun(userId: string, runId: string): Promise<AnyQaStageRun | null> {
    const row = (await this.sql.get(`SELECT r.* FROM qa_stage_runs r JOIN project_members m ON m.project_id=r.project_id WHERE r.id=? AND m.username=?`, [runId, userId])) as Record<string, unknown> | undefined
    return row ? this.mapQaStageRun(row) : null
  }

  async listQaStageRuns(userId: string, projectId: string, taskId: string, stage: QaRunStage): Promise<AnyQaStageRun[]> {
    if (!(await this.repos.projects.isProjectMember(userId, projectId))) return []
    return ((await this.sql.all(`SELECT * FROM qa_stage_runs WHERE project_id=? AND task_id=? AND stage=? ORDER BY attempt DESC`, [projectId, taskId, stage])) as Record<string, unknown>[]).map((row) => this.mapQaStageRun(row))
  }

  async recordAutoPilotEvent(projectId: string, taskId: string, action: string, payload: Record<string, unknown> = {}): Promise<void> {
    await this.sql.run(`INSERT INTO qa_audit (id,project_id,task_id,action,actor,payload_json,created_at) VALUES (?,?,?,?,?,?,?)`, [this.newId(), projectId, taskId, action, 'automation', JSON.stringify(payload), this.now()])
  }

  /**
   * Новая попытка этапа. Для Playwright-режима фиксируется **снимок** сценария:
   * настройку проекта владелец правит, а ран обязан помнить, что прогонял
   * именно он. `scenario` передаёт повтор — он воспроизводит упавший прогон, а
   * не читает настройку заново.
   */
  async startQaStageRun(userId: string, projectId: string, taskId: string, stage: QaRunStage, scenarios?: AutomatedQaScenario[] | null): Promise<AnyQaStageRun> {
    if (!(await this.repos.projects.isProjectMember(userId, projectId))) throw new Error('Проект недоступен')
    const task = await this.repos.tasks.getTask(projectId, taskId)
    if (!task || task.type !== 'task') throw new Error('Задача не найдена')
    const current = (await this.repos.tasks.getBoard(userId, projectId))?.columns.find((column) => column.id === task.columnId)
    if (current?.semanticType !== stage) throw new Error(`Этап ${stage} нельзя запустить из колонки ${current?.semanticType ?? 'unknown'}`)
    const active = (await this.sql.get(`SELECT * FROM qa_stage_runs WHERE task_id=? AND stage=? AND status IN ('queued','running','awaiting_input')`, [taskId, stage])) as Record<string, unknown> | undefined
    if (active) return this.mapQaStageRun(active)
    const attempt = Number(((await this.sql.get(`SELECT COALESCE(MAX(attempt),0)+1 AS n FROM qa_stage_runs WHERE task_id=? AND stage=?`, [taskId, stage])) as { n: number }).n)
    const id = this.newId(), now = this.now()
    const project = stage === 'automated_qa' ? (await this.sql.get(`SELECT automated_qa_mode,automated_qa_scenario_json FROM projects WHERE id=?`, [projectId])) as { automated_qa_mode: string | null; automated_qa_scenario_json: string | null } | undefined : undefined
    const snapshot = stage === 'automated_qa' && project?.automated_qa_mode === 'playwright'
      ? (scenarios ?? parseAutomatedQaScenarios(parseJsonValue<unknown>(project.automated_qa_scenario_json ?? '', []))).map(normalizeAutomatedQaScenario)
      : null
    await this.sql.run(`INSERT INTO qa_stage_runs
      (id,project_id,task_id,stage,status,attempt,triggered_by,branch,commit_sha,current_step,scenario_json,created_at,started_at)
      VALUES (?,?,?,?,'running',?,?,?,?, 'starting',?,?,?)`, [id, projectId, taskId, stage, attempt, userId, task.mergeSourceBranch ?? '', task.mergeSourceSha ?? '', snapshot ? JSON.stringify(snapshot) : '', now, now])
    return (await this.getQaStageRun(userId, id))!
  }

  async automatedQaExecutionContext(runId: string): Promise<AutomatedQaExecutionContext | null> {
    const row = (await this.sql.get(`SELECT w.agent_id,w.path,q.scenario_json,p.automated_qa_command,p.automated_qa_mode,p.automated_qa_scenario_json FROM qa_stage_runs q JOIN ci_workspaces w ON w.task_id=q.task_id AND w.pushed=1 JOIN projects p ON p.id=q.project_id WHERE q.id=? AND q.stage='automated_qa' ORDER BY w.created_at DESC LIMIT 1`, [runId])) as { agent_id: string | null; path: string | null; scenario_json: string | null; automated_qa_command: string | null; automated_qa_mode: string | null; automated_qa_scenario_json: string | null } | undefined
    if (!row?.agent_id || !row.path) return null
    return {
      agentId: row.agent_id, workdir: row.path, command: row.automated_qa_command?.trim() || 'npm test',
      mode: row.automated_qa_mode === 'playwright' ? 'playwright' : 'command',
      // Снимок рана важнее настройки проекта: пока ран шёл, её могли поправить.
      // Фолбэк на проект — для ранов, заведённых до появления снимка.
      scenarios: parseAutomatedQaScenarios(parseJsonValue<unknown>(row.scenario_json || row.automated_qa_scenario_json || '', [])).map(normalizeAutomatedQaScenario)
    }
  }

  /**
   * Отметка «этап пошёл». Условие `status='queued'` здесь было мёртвым:
   * `startQaStageRun` вставляет строку сразу как `running`, поэтому шаг рана
   * навсегда оставался `starting`, и панель весь прогон показывала запуск.
   */
  async markAutomatedQaRunning(runId: string): Promise<void> {
    await this.sql.run(`UPDATE qa_stage_runs SET status='running',current_step='tests',started_at=COALESCE(started_at,?) WHERE id=? AND status IN ('queued','running')`, [this.now(), runId])
  }

  async appendAutomatedQaLog(runId: string, stream: 'out' | 'err' | 'system', text: string): Promise<void> {
    const row = (await this.sql.get(`SELECT log_json FROM qa_stage_runs WHERE id=?`, [runId])) as { log_json: string } | undefined
    const log = parseJsonValue<Array<{ seq: number; at: number; stream: 'out'|'err'|'system'; text: string }>>(row?.log_json, [])
    log.push({ seq: (log.at(-1)?.seq ?? 0) + 1, at: this.now(), stream, text })
    await this.sql.run(`UPDATE qa_stage_runs SET log_json=? WHERE id=? AND status IN ('queued','running')`, [JSON.stringify(log.slice(-2000)), runId])
  }

  async updateQaStageRun(runId: string, patch: {
    status?: QaStageRunStatus; currentStep?: string; progress?: { current: number; total: number; label: string }
    log?: Array<{ seq: number; at: number; stream: 'out'|'err'|'system'; text: string }>
    result?: Record<string, unknown> | null; gateReasons?: string[]; error?: string | null
  }): Promise<void> {
    const current = (await this.sql.get(`SELECT * FROM qa_stage_runs WHERE id=?`, [runId])) as Record<string, unknown> | undefined
    if (!current) return
    const status = patch.status ?? current.status as QaStageRunStatus
    const terminal = ['success','gate_failed','failed','cancelled','interrupted'].includes(status)
    await this.sql.run(`UPDATE qa_stage_runs SET status=?,current_step=?,progress_json=?,log_json=?,result_json=?,gate_reasons_json=?,error=?,finished_at=? WHERE id=?`, [status, patch.currentStep ?? current.current_step, JSON.stringify(patch.progress ?? parseJsonValue(String(current.progress_json), {})), JSON.stringify(patch.log ?? parseJsonValue(String(current.log_json), [])), patch.result === undefined ? current.result_json : patch.result == null ? null : JSON.stringify(patch.result), JSON.stringify(patch.gateReasons ?? parseStringArray(String(current.gate_reasons_json))), patch.error === undefined ? current.error : patch.error, terminal ? this.now() : current.finished_at, runId])
  }

  async completeQaStageRun(userId: string, runId: string, result: Record<string, unknown>): Promise<AnyQaStageRun | null> {
    const run = await this.getQaStageRun(userId, runId)
    if (!run || !['running','awaiting_input'].includes(run.status)) return run
    let reasons: string[] = []
    if (run.stage === 'integration_tests') {
      const testCases = Array.isArray(result.testCases) ? result.testCases as import('@voicechat/shared').TestCaseDefinition[] : []
      reasons = testCases.some((testCase) => testCase.required) ? canCompleteAutomation(testCases, run.commitSha).reasons : ['missing_required_test_cases']
    } else if (result.gatePassed !== true) {
      reasons = Array.isArray(result.gateReasons) ? result.gateReasons.filter((item): item is string => typeof item === 'string') : ['quality_gate_failed']
    }
    if (reasons.length) {
      await this.updateQaStageRun(runId, { status: 'gate_failed', result, gateReasons: reasons, currentStep: 'gate' })
      return await this.getQaStageRun(userId, runId)
    }
    const next: Record<QaRunStage, KanbanColumnSemanticType> = { component_qa: 'integration_tests', integration_tests: 'automated_qa', automated_qa: 'manual_qa' }
    if (!canTransitionWorkflow(run.stage, next[run.stage], 'automation')) throw new Error(`Переход ${run.stage} → ${next[run.stage]} запрещён workflow`)
    const target = await this.repos.projects.getColumnIdBySemantic(run.projectId, next[run.stage])
    if (!target) throw new Error(`Следующая колонка ${next[run.stage]} не найдена`)
    await this.sql.transaction(async () => {
      await this.updateQaStageRun(runId, { status: 'success', result, gateReasons: [], currentStep: 'complete' })
      await this.repos.tasks.moveTask(userId, run.projectId, run.taskId, { columnId: target })
    })
    return await this.getQaStageRun(userId, runId)
  }

  async cancelQaStageRun(userId: string, runId: string): Promise<AnyQaStageRun | null> {
    const run = await this.getQaStageRun(userId, runId)
    if (!run) return null
    if (run.canCancel) await this.updateQaStageRun(runId, { status: 'cancelled', error: 'Ран отменён пользователем' })
    return await this.getQaStageRun(userId, runId)
  }

  async retryQaStageRun(userId: string, runId: string): Promise<AnyQaStageRun | null> {
    const run = await this.getQaStageRun(userId, runId)
    if (!run) return null
    if (!run.canRetry) throw new Error('Повтор этого рана недоступен')
    // Повтор воспроизводит упавший прогон: берётся снимок сценария того рана, а
    // не текущая настройка проекта. Иначе повторяется не то, что упало.
    return await this.startQaStageRun(userId, run.projectId, run.taskId, run.stage, run.scenarios)
  }

  async answerQaStageRun(userId: string, runId: string, answer: string): Promise<AnyQaStageRun | null> {
    const run = await this.getQaStageRun(userId, runId)
    if (!run || run.stage !== 'integration_tests' || run.status !== 'awaiting_input') throw new Error('Ран не ожидает ответа')
    if (!answer.trim()) throw new Error('Ответ не может быть пустым')
    await this.updateQaStageRun(runId, { status: 'running', currentStep: 'model_answered' })
    return await this.getQaStageRun(userId, runId)
  }

  async failInterruptedQaStageRuns(): Promise<string[]> {
    const rows = (await this.sql.all(`SELECT id FROM qa_stage_runs WHERE stage<>'automated_qa' AND status IN ('queued','running','awaiting_input')`)) as Array<{ id: string }>
    await this.sql.run(`UPDATE qa_stage_runs SET status='interrupted',error='Ран прерван перезапуском сервера',finished_at=? WHERE stage<>'automated_qa' AND status IN ('queued','running','awaiting_input')`, [this.now()])
    // Automated QA детерминирован одной командой: после рестарта безопасно
    // перезапустить ту же попытку, сохранив её id и накопленный лог.
    await this.sql.run(`UPDATE qa_stage_runs SET status='queued',current_step='restarting',started_at=NULL,error=NULL WHERE stage='automated_qa' AND status IN ('running','awaiting_input')`)
    return rows.map((row) => row.id)
  }

  /** Идентификаторы всех ранов этапов — для уборки осиротевших снимков на диске. */
  async qaStageRunIds(): Promise<Set<string>> {
    return new Set(((await this.sql.all(`SELECT id FROM qa_stage_runs`)) as Array<{ id: string }>).map((row) => row.id))
  }

  async recoverableAutomatedQaRuns(): Promise<Array<{ id: string; userId: string; projectId: string }>> {
    return (await this.sql.all(`SELECT id,triggered_by AS userId,project_id AS projectId FROM qa_stage_runs WHERE stage='automated_qa' AND status='queued'`)) as Array<{ id: string; userId: string; projectId: string }>
  }

  async getQaTaskState(userId: string, projectId: string, taskId: string): Promise<QaTaskState | null> {
    if (!(await this.repos.projects.isProjectMember(userId, projectId))) return null
    const task = await this.sql.get(`SELECT 1 FROM tasks WHERE id = ? AND project_id = ?`, [taskId, projectId])
    if (!task) return null
    const criteria = ((await this.sql.all(`SELECT * FROM acceptance_criteria WHERE task_id = ? ORDER BY position`, [taskId])) as QaCriterionRow[]).map(mapQaCriterion)
    const versions = (await Promise.all(criteria.map(async (criterion) =>
      ((await this.sql.all(`SELECT * FROM acceptance_criterion_versions WHERE criterion_id = ? ORDER BY version DESC`, [criterion.id])) as QaCriterionVersionRow[]).map(mapQaCriterionVersion)
    ))).flat()
    const sessions = await Promise.all(((await this.sql.all(`SELECT * FROM qa_sessions WHERE task_id = ? ORDER BY started_at DESC`, [taskId])) as QaSessionRow[]).map(async (row) => await this.mapQaSession(row)))
    const rawPreparation = (await this.sql.get(`SELECT * FROM qa_preparation_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1`, [taskId])) as Record<string, unknown> | undefined
    const preparation = rawPreparation ? {
      id: String(rawPreparation.id), taskId, branch: String(rawPreparation.branch), commitSha: String(rawPreparation.commit_sha),
      status: rawPreparation.status as 'running'|'success'|'failed', attempt: Number(rawPreparation.attempt), maxAttempts: 2,
      error: rawPreparation.error as string | null, attempts: parseJsonValue(String(rawPreparation.diagnostics_json ?? '[]'), []),
      createdAt: Number(rawPreparation.created_at), finishedAt: rawPreparation.finished_at == null ? null : Number(rawPreparation.finished_at),
      canRetry: rawPreparation.status === 'failed', log: String(rawPreparation.log ?? '')
    } : null
    return { criteria, versions, sessions, activeSession: sessions.find((session) => session.status === 'active') ?? null, preparation, canEdit: await this.repos.projects.canQa(userId, projectId) }
  }

  async createAcceptanceCriterion(userId: string, projectId: string, taskId: string, input: AcceptanceCriterionSnapshot & { order?: number }): Promise<AcceptanceCriterion | null> {
    if (!(await this.repos.projects.isProjectMember(userId, projectId))) return null
    if (!(await this.sql.get(`SELECT 1 FROM tasks WHERE id = ? AND project_id = ?`, [taskId, projectId]))) return null
    const now = this.now(), id = this.newId()
    const order = input.order ?? (((await this.sql.get(`SELECT COALESCE(MAX(position), 0) + 1 AS n FROM acceptance_criteria WHERE task_id = ?`, [taskId])) as { n: number }).n)
    const snapshot = qaSnapshot(input)
    await this.sql.transaction(async () => {
      await this.sql.run(`INSERT INTO acceptance_criteria
        (id, task_id, position, title, description, preconditions, steps, test_data, expected_result, required, test_type, current_version, active, author, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`, [id, taskId, order, snapshot.title, snapshot.description, snapshot.preconditions, snapshot.steps, snapshot.testData, snapshot.expectedResult, snapshot.required ? 1 : 0, snapshot.testType, userId, now, now])
      await this.sql.run(`INSERT INTO acceptance_criterion_versions (criterion_id, version, snapshot_json, author, reason, created_at) VALUES (?, 1, ?, ?, 'initial', ?)`, [id, JSON.stringify(snapshot), userId, now])
      await this.addQaAudit(projectId, taskId, userId, 'criterion.created', { criterionId: id, version: 1 })
    })
    return mapQaCriterion((await this.sql.get(`SELECT * FROM acceptance_criteria WHERE id = ?`, [id])) as QaCriterionRow)
  }

  async reviseAcceptanceCriterion(userId: string, projectId: string, taskId: string, criterionId: string, input: AcceptanceCriterionSnapshot & { reason: string; semanticChange?: boolean }): Promise<AcceptanceCriterion | null> {
    if (!(await this.repos.projects.isProjectMember(userId, projectId))) return null
    const current = (await this.sql.get(`SELECT * FROM acceptance_criteria WHERE id = ? AND task_id = ?`, [criterionId, taskId])) as QaCriterionRow | undefined
    if (!current) return null
    const now = this.now(), snapshot = qaSnapshot(input)
    const version = current.current_version + (input.semanticChange === false ? 0 : 1)
    await this.sql.transaction(async () => {
      if (version !== current.current_version) {
        await this.sql.run(`UPDATE acceptance_criterion_versions SET superseded_by = ? WHERE criterion_id = ? AND version = ?`, [version, criterionId, current.current_version])
        await this.sql.run(`INSERT INTO acceptance_criterion_versions (criterion_id, version, snapshot_json, author, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [criterionId, version, JSON.stringify(snapshot), userId, input.reason.trim(), now])
      }
      await this.sql.run(`UPDATE acceptance_criteria SET title=?, description=?, preconditions=?, steps=?, test_data=?, expected_result=?, required=?, test_type=?, current_version=?, updated_at=? WHERE id=?`, [snapshot.title, snapshot.description, snapshot.preconditions, snapshot.steps, snapshot.testData, snapshot.expectedResult, snapshot.required ? 1 : 0, snapshot.testType, version, now, criterionId])
      if (version !== current.current_version) {
        await this.sql.run(`UPDATE qa_sessions SET status='stale', stale_reason='criteria_snapshot_changed', finished_at=? WHERE task_id=? AND status='active'`, [now, taskId])
      }
      await this.addQaAudit(projectId, taskId, userId, version === current.current_version ? 'criterion.edited' : 'criterion.versioned', { criterionId, version, reason: input.reason })
    })
    return mapQaCriterion((await this.sql.get(`SELECT * FROM acceptance_criteria WHERE id = ?`, [criterionId])) as QaCriterionRow)
  }

  async startQaPreparationRun(projectId: string, taskId: string, branch: string, commitSha: string, retry = false): Promise<{ id: string; status: string } | null> {
    const existing = (await this.sql.get(`SELECT id,status FROM qa_preparation_runs WHERE task_id=? AND commit_sha=?`, [taskId, commitSha])) as { id:string; status:string } | undefined
    if (existing) {
      if (!retry || existing.status !== 'failed') return null
      const changed = await this.sql.run(`UPDATE qa_preparation_runs SET status='running',error=NULL,attempt=1,diagnostics_json='[]',log='',created_at=?,finished_at=NULL WHERE id=? AND status='failed'`, [this.now(), existing.id])
      return changed.changes ? { id: existing.id, status: 'running' } : null
    }
    const id = this.newId()
    await this.sql.run(`INSERT INTO qa_preparation_runs (id,project_id,task_id,branch,commit_sha,status,created_at) VALUES (?,?,?,?,?,'running',?)`, [id, projectId, taskId, branch, commitSha, this.now()])
    const active = (await this.sql.get(`SELECT commit_sha FROM qa_sessions WHERE project_id=? AND task_id=? AND status='active' LIMIT 1`, [projectId, taskId])) as { commit_sha:string } | undefined
    if (active && active.commit_sha !== commitSha) await this.markQaSessionStale(projectId, taskId, `Новый commit SHA: ${commitSha}`)
    return { id, status: 'running' }
  }

  async appendQaPreparationLog(id: string, chunk: string): Promise<void> {
    await this.sql.run(`UPDATE qa_preparation_runs SET log=substr(log || ?, -500000) WHERE id=? AND status='running'`, [chunk, id])
  }

  async recordQaPreparationAttempt(id: string, attempt: number, rawResponse: string, error: string | null): Promise<void> {
    const row = (await this.sql.get(`SELECT diagnostics_json FROM qa_preparation_runs WHERE id=? AND status='running'`, [id])) as { diagnostics_json: string } | undefined
    if (!row) return
    const diagnostics = parseJsonValue<Array<Record<string, unknown>>>(row.diagnostics_json, [])
    diagnostics.push({ attempt, rawResponse: rawResponse.slice(-500000), error, status: error ? 'failed' : 'success' })
    await this.sql.run(`UPDATE qa_preparation_runs SET attempt=?,diagnostics_json=? WHERE id=? AND status='running'`, [attempt, JSON.stringify(diagnostics), id])
  }

  async finishQaPreparationRun(id: string, status: 'success'|'failed', error: string | null = null): Promise<void> {
    await this.sql.run(`UPDATE qa_preparation_runs SET status=?,error=?,finished_at=? WHERE id=? AND status='running'`, [status, error, this.now(), id])
  }

  async failInterruptedQaPreparationRuns(): Promise<string[]> {
    const rows = (await this.sql.all(`SELECT id FROM qa_preparation_runs WHERE status='running'`)) as Array<{ id: string }>
    await this.sql.run(`UPDATE qa_preparation_runs SET status='failed',error='Подготовка прервана перезапуском сервера',finished_at=? WHERE status='running'`, [this.now()])
    return rows.map((row) => row.id)
  }

  async completeQaPreparation(userId: string, projectId: string, taskId: string): Promise<QaTaskState | null> {
    if (!(await this.repos.projects.isProjectMember(userId, projectId))) return null
    const task = await this.sql.get(`SELECT 1 FROM tasks WHERE id=? AND project_id=?`, [taskId, projectId])
    if (!task) return null
    const criteria = ((await this.sql.all(`SELECT * FROM acceptance_criteria WHERE task_id=? AND active=1 ORDER BY position`, [taskId])) as QaCriterionRow[]).map(mapQaCriterion)
    if (!criteria.length) throw new Error('Добавьте хотя бы один сценарий ручного QA')
    const incomplete = criteria.filter((criterion) => !criterion.title.trim() || !criterion.steps.trim() || !criterion.expectedResult.trim())
    if (incomplete.length) throw new Error('Каждый сценарий должен содержать название, подробные шаги и ожидаемый результат')
    const column = await this.repos.projects.getColumnIdBySemantic(projectId, 'manual_qa')
    if (!column) throw new Error('manual_qa column not found')
    await this.sql.transaction(async () => {
      await this.repos.tasks.moveTask(userId, projectId, taskId, { columnId: column })
      await this.addQaAudit(projectId, taskId, userId, 'preparation.completed', { criteria: criteria.map((criterion) => criterion.id) })
    })
    return await this.getQaTaskState(userId, projectId, taskId)
  }

  async startQaSession(userId: string, args: { projectId: string; taskId: string; branch: string; commitSha: string; testRunId: string; previewId?: string | null; previewSha?: string | null; appUrl?: string | null; storybookUrl?: string | null; testDataScenario?: string; testerId?: string | null }, system = false): Promise<QaSession | null> {
    if (!system && !(await this.repos.projects.canQa(userId, args.projectId))) throw new Error('QA permission required')
    if (!(await this.sql.get(`SELECT 1 FROM tasks WHERE id=? AND project_id=?`, [args.taskId, args.projectId]))) return null
    if (await this.sql.get(`SELECT 1 FROM qa_sessions WHERE task_id=? AND status='active'`, [args.taskId])) throw new Error('active QA session already exists')
    if (args.previewId && args.previewSha !== args.commitSha) throw new Error('preview SHA does not match commit SHA')
    const criteria = ((await this.sql.all(`SELECT * FROM acceptance_criteria WHERE task_id=? AND active=1 ORDER BY position`, [args.taskId])) as QaCriterionRow[]).map(mapQaCriterion)
    if (!criteria.length) throw new Error('acceptance criteria required')
    const snapshot = criteria.map((criterion) => ({ criterionId: criterion.id, version: criterion.currentVersion, required: criterion.required }))
    const now = this.now(), sessionId = this.newId()
    await this.sql.transaction(async () => {
      await this.sql.run(`INSERT INTO qa_sessions
        (id,task_id,project_id,branch,commit_sha,test_run_id,preview_id,preview_sha,app_url,storybook_url,test_data_scenario,criteria_snapshot_json,status,tester_id,initiated_by,started_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'active',?,?,?)`, [sessionId, args.taskId, args.projectId, args.branch, args.commitSha, args.testRunId, args.previewId??null, args.previewSha??null, args.appUrl??null, args.storybookUrl??null, args.testDataScenario??'', JSON.stringify(snapshot), args.testerId??userId, userId, now])
      const insert = this.sql.prepare(`INSERT INTO qa_criterion_results
        (id,session_id,criterion_id,criterion_version,status,draft,branch,commit_sha,preview_id,preview_sha,app_url,storybook_url,test_data_scenario,expected_result,revision,updated_at)
        VALUES (?,?,?,?,'not_tested',0,?,?,?,?,?,?,?,?,1,?)`)
      for (const criterion of criteria) await insert.run(this.newId(),sessionId,criterion.id,criterion.currentVersion,args.branch,args.commitSha,args.previewId??null,args.previewSha??null,args.appUrl??null,args.storybookUrl??null,args.testDataScenario??'',criterion.expectedResult,now)
      const column = await this.repos.projects.getColumnIdBySemantic(args.projectId, 'manual_qa')
      if (column) await this.repos.tasks.moveTask(userId, args.projectId, args.taskId, { columnId: column })
      await this.addQaAudit(args.projectId,args.taskId,userId,'session.started',{sessionId,commitSha:args.commitSha})
    })
    return await this.mapQaSession((await this.sql.get(`SELECT * FROM qa_sessions WHERE id=?`, [sessionId])) as QaSessionRow)
  }

  async saveQaResult(userId: string, projectId: string, taskId: string, resultId: string, expectedRevision: number, patch: Partial<Pick<QaCriterionResult, 'status'|'draft'|'executedSteps'|'actualResult'|'comment'|'environment'|'blockerReason'|'blockerType'|'blockerOwner'|'notApplicableReason'|'assigneeId'>> & { classification?: QaIssueClassification; severity?: QaSeverity; frequency?: QaFrequency; reproduction?: string; requirementProposal?: string }): Promise<QaCriterionResult> {
    if (!(await this.repos.projects.canQa(userId, projectId))) throw new Error('QA permission required')
    const current = (await this.sql.get(`SELECT r.*, s.project_id, s.task_id, s.status AS session_status, s.stale_reason FROM qa_criterion_results r JOIN qa_sessions s ON s.id=r.session_id WHERE r.id=? AND s.project_id=? AND s.task_id=?`, [resultId, projectId, taskId])) as (QaResultRow & { session_status:string; stale_reason:string|null }) | undefined
    if (!current) throw new Error('QA result not found')
    if (current.revision !== expectedRevision) throw new Error('QA result revision conflict')
    if (current.session_status !== 'active' || current.stale_reason) throw new Error('QA session is stale or closed')
    const previous = mapQaResult(current, [], null)
    const next = { ...previous, ...patch }
    const status = patch.status ?? next.status
    if (!QA_RESULT_STATUSES.includes(status)) throw new Error('invalid QA result status')
    if (!patch.draft) {
      const missing = validateQaResult(status, next)
      if (missing.length) throw new Error(`missing QA fields: ${missing.join(', ')}`)
    }
    if ((status === 'passed' || status === 'not_applicable') && !(await this.repos.projects.canQa(userId, projectId))) throw new Error('QA permission required')
    const now=this.now(), finished = !patch.draft && ['passed','failed','blocked','not_applicable'].includes(status) ? now : null
    await this.sql.transaction(async () => {
      const changed=await this.sql.run(`UPDATE qa_criterion_results SET status=?,draft=?,tester_id=?,started_at=COALESCE(started_at,?),finished_at=?,executed_steps=?,actual_result=?,comment=?,environment=?,blocker_reason=?,blocker_type=?,blocker_owner=?,not_applicable_reason=?,assignee_id=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?`, [status, patch.draft?1:0, userId, now, finished, next.executedSteps, next.actualResult, next.comment, next.environment, next.blockerReason, next.blockerType, next.blockerOwner, next.notApplicableReason, next.assigneeId, now, resultId, expectedRevision])
      if (!changed.changes) throw new Error('QA result revision conflict')
      if (status === 'failed') {
        if (!patch.classification || !patch.severity || !patch.frequency || !patch.reproduction?.trim()) throw new Error('structured QA issue required')
        const route = patch.classification === 'implementation_defect' ? 'development' : patch.classification === 'requirement_change' ? 'ready' : patch.classification === 'needs_decision' ? 'decision_required' : 'manual_qa'
        await this.sql.run(`INSERT INTO qa_issues (id,result_id,classification,severity,frequency,reproduction,proposed_route,requirement_proposal,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(result_id) DO UPDATE SET classification=excluded.classification,severity=excluded.severity,frequency=excluded.frequency,reproduction=excluded.reproduction,proposed_route=excluded.proposed_route,requirement_proposal=excluded.requirement_proposal`, [this.newId(), resultId, patch.classification, patch.severity, patch.frequency, patch.reproduction, route, patch.requirementProposal??'', now])
      }
      await this.addQaAudit(projectId,taskId,userId,patch.draft?'result.draft_saved':'result.updated',{
        resultId, sessionId: current.session_id, criterionId: current.criterion_id, actor: userId, serverTime: now,
        previous: { status: previous.status, comment: previous.comment, revision: previous.revision },
        next: { status, comment: next.comment, revision: expectedRevision + 1 }
      })
    })
    return (await this.qaResultById(resultId)) as QaCriterionResult
  }

  async saveQaAdditionalIssues(userId: string, projectId: string, taskId: string, sessionId: string, value: string): Promise<QaSession> {
    if (!(await this.repos.projects.canQa(userId, projectId))) throw new Error('QA permission required')
    const changed = await this.sql.run(`UPDATE qa_sessions SET additional_issues=? WHERE id=? AND project_id=? AND task_id=? AND status='active' AND stale_reason IS NULL`, [value, sessionId, projectId, taskId])
    if (!changed.changes) throw new Error('QA session is stale or closed')
    await this.addQaAudit(projectId, taskId, userId, 'session.additional_issues_saved', { sessionId })
    return await this.mapQaSession((await this.sql.get(`SELECT * FROM qa_sessions WHERE id=?`, [sessionId])) as QaSessionRow)
  }

  async linkQaFixRun(userId: string, projectId: string, taskId: string, sessionId: string, runId: string): Promise<void> {
    if (!(await this.repos.projects.canQa(userId, projectId))) throw new Error('QA permission required')
    const session = await this.sql.get(`SELECT id FROM qa_sessions WHERE id=? AND project_id=? AND task_id=? AND status='active'`, [sessionId, projectId, taskId])
    if (!session) throw new Error('QA session is stale or closed')
    const now = this.now()
    await this.sql.transaction(async () => {
      await this.sql.run(`UPDATE qa_issues SET linked_fix_run_id=? WHERE result_id IN (SELECT id FROM qa_criterion_results WHERE session_id=? AND status='failed')`, [runId, sessionId])
      await this.sql.run(`UPDATE qa_sessions SET status='failed',finished_at=?,summary=?,linked_fix_run_id=? WHERE id=? AND status='active'`, [now, 'Передано на исправление', runId, sessionId])
      await this.addQaAudit(projectId, taskId, userId, 'session.fix_started', { sessionId, runId })
    })
  }

  async completeQaSession(userId: string, projectId: string, taskId: string, sessionId: string, summary: string): Promise<QaSession> {
    if (!(await this.repos.projects.canQa(userId,projectId))) throw new Error('QA permission required')
    const row=(await this.sql.get(`SELECT * FROM qa_sessions WHERE id=? AND project_id=? AND task_id=?`, [sessionId, projectId, taskId])) as QaSessionRow|undefined
    if (!row) throw new Error('QA session not found')
    const session=await this.mapQaSession(row), gate=canCompleteQa(session)
    if (!gate.allowed) throw new Error(`QA is incomplete: ${gate.reasons.join(', ')}`)
    const now=this.now()
    await this.sql.transaction(async ()=>{
      await this.sql.run(`UPDATE qa_sessions SET status='passed',finished_at=?,summary=? WHERE id=? AND status='active'`, [now, summary.trim(), sessionId])
      const column=await this.repos.projects.getColumnIdBySemantic(projectId,'awaiting_merge')
      if (!column) throw new Error('awaiting_merge column not found')
      await this.repos.tasks.moveTask(userId,projectId,taskId,{columnId:column})
      await this.addQaAudit(projectId,taskId,userId,'session.completed',{sessionId,summary})
    })
    return await this.mapQaSession((await this.sql.get(`SELECT * FROM qa_sessions WHERE id=?`, [sessionId])) as QaSessionRow)
  }

  async markQaSessionStale(projectId: string, taskId: string, reason: string): Promise<void> {
    const now=this.now()
    await this.sql.run(`UPDATE qa_sessions SET status='stale',stale_reason=?,finished_at=? WHERE project_id=? AND task_id=? AND status='active'`, [reason, now, projectId, taskId])
    await this.sql.run(`UPDATE qa_criterion_results SET status='stale',revision=revision+1,updated_at=? WHERE session_id IN (SELECT id FROM qa_sessions WHERE project_id=? AND task_id=? AND status='stale' AND stale_reason=?) AND status IN ('not_tested','in_progress')`, [now, projectId, taskId, reason])
  }

  async addQaAttachment(userId:string,projectId:string,taskId:string,resultId:string,input:{uploadId:string;name:string;mimeType:'image/png'|'image/jpeg'|'image/webp';size:number;width?:number|null;height?:number|null;caption?:string}):Promise<QaAttachment> {
    if (!(await this.repos.projects.canQa(userId,projectId))) throw new Error('QA permission required')
    const result=(await this.sql.get(`SELECT r.commit_sha FROM qa_criterion_results r JOIN qa_sessions s ON s.id=r.session_id WHERE r.id=? AND s.project_id=? AND s.task_id=?`, [resultId, projectId, taskId])) as {commit_sha:string}|undefined
    if (!result) throw new Error('QA result not found')
    const count=((await this.sql.get(`SELECT COUNT(*) AS n FROM qa_attachments WHERE result_id=?`, [resultId])) as {n:number}).n
    if (count>=10) throw new Error('QA attachment limit reached')
    const id=this.newId(),now=this.now(),safeName=input.name.split(/[\\/]/).pop() || 'screenshot'
    await this.sql.run(`INSERT INTO qa_attachments (id,result_id,upload_id,name,mime_type,size,width,height,caption,author,created_at,commit_sha) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [id, resultId, input.uploadId, safeName, input.mimeType, input.size, input.width??null, input.height??null, input.caption?.trim()??'', userId, now, result.commit_sha])
    await this.addQaAudit(projectId,taskId,userId,'attachment.added',{attachmentId:id,resultId,uploadId:input.uploadId})
    return {id,resultId,uploadId:input.uploadId,name:safeName,mimeType:input.mimeType,size:input.size,width:input.width??null,height:input.height??null,caption:input.caption?.trim()??'',author:userId,createdAt:now,commitSha:result.commit_sha}
  }

  async getQaAttachment(userId:string,attachmentId:string):Promise<(QaAttachment&{projectId:string;taskId:string})|null> {
    const row=(await this.sql.get(`SELECT a.*,s.project_id,s.task_id FROM qa_attachments a JOIN qa_criterion_results r ON r.id=a.result_id JOIN qa_sessions s ON s.id=r.session_id WHERE a.id=?`, [attachmentId])) as (QaAttachmentRow&{project_id:string;task_id:string})|undefined
    if (!row||!(await this.repos.projects.isProjectMember(userId,row.project_id))) return null
    return {id:row.id,resultId:row.result_id,uploadId:row.upload_id,name:row.name,mimeType:row.mime_type as QaAttachment['mimeType'],size:row.size,width:row.width,height:row.height,caption:row.caption,author:row.author,createdAt:row.created_at,commitSha:row.commit_sha,projectId:row.project_id,taskId:row.task_id}
  }

  private async qaResultById(id: string): Promise<QaCriterionResult | null> {
    const row=(await this.sql.get(`SELECT * FROM qa_criterion_results WHERE id=?`, [id])) as QaResultRow|undefined
    if (!row) return null
    const issue=(await this.sql.get(`SELECT * FROM qa_issues WHERE result_id=?`, [id])) as QaIssueRow|undefined
    const attachments=(await this.sql.all(`SELECT * FROM qa_attachments WHERE result_id=? ORDER BY created_at`, [id])) as QaAttachmentRow[]
    return mapQaResult(row,attachments,issue??null)
  }

  private async mapQaSession(row: QaSessionRow): Promise<QaSession> {
    const results=await Promise.all(((await this.sql.all(`SELECT * FROM qa_criterion_results WHERE session_id=? ORDER BY rowid`, [row.id])) as QaResultRow[]).map(async (result)=>(await this.qaResultById(result.id)) as QaCriterionResult))
    return mapQaSession(row,results)
  }

  async addPreviewAudit(userId:string,projectId:string,taskId:string,action:string,payload:unknown):Promise<void> {
    await this.addQaAudit(projectId, taskId, userId, action, payload)
  }

  private async addQaAudit(projectId:string,taskId:string,actor:string,action:string,payload:unknown):Promise<void> {
    await this.sql.run(`INSERT INTO qa_audit (id,project_id,task_id,action,actor,payload_json,created_at) VALUES (?,?,?,?,?,?,?)`, [this.newId(), projectId, taskId, action, actor, JSON.stringify(payload), this.now()])
  }
}
