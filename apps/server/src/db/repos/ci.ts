// Домен «ci»: таблицы ci_commands, ci_slot_commands, ci_command_suggestions, ci_events, ci_fix_attempts, ci_gate_results, ci_interactions, ci_llm_configs, ci_stage_llm_configs, ci_run_kb_gaps, ci_run_kb_metrics, ci_run_logs, ci_run_steps, ci_run_tool_calls, ci_run_tool_responses, ci_run_usage, ci_runs, ci_settings, ci_stage_runs, ci_task_browser_checks, ci_task_process_stages, ci_test_events, ci_test_fix_cycles, ci_test_fix_decisions, ci_test_fix_targeted_runs, ci_test_fix_task_state, ci_test_group_configs, ci_test_group_runs, ci_test_runs, ci_test_targeted_runs, ci_workspaces, merge_runs, integration_test_runs, component_qa_runs.
// Файл получен разрезанием бывшего VoiceChatDb (apps/server/src/db/database.ts) по владению таблицами;
// карта владения — ./ownership.ts, правила — docs/plans/db-repositories.md.
import { DEFAULT_CODEX_MODEL, isProviderAllowed, firstAllowedProvider, clampModel, type LlmProvider, type KbContextMode, type CiCommand, type CiCommandInput, type CiCommandScope, type CiSlot, type CiSlotConfig, type CiBrowserCheck, type CiProcessStage, CI_PROCESS_STAGES, DEFAULT_CI_BROWSER_CHECK, normalizeCiBrowserCheck, normalizeCiProcessStages, type CiLlmConfig, DEFAULT_CI_CLAUDE_MODEL, CI_KB_UPDATE_COMMAND_ID, CI_KB_UPDATE_COMMAND_NAME, DEFAULT_CI_LLM_CONFIG, type CiRunMode, type CiClarifyLevel, type CiInteraction, type CiInteractionKind, type CiInteractionStatus, type CiPlanDecision, type QuestionSpec, type CiGlobalSettings, DEFAULT_CI_GLOBAL_SETTINGS, type CiRun, type MergeRun, ACTIVE_MERGE_STATUSES, type CiRunDetail, type CiExecutionLlmSnapshot, type CiStageRun, type CiRunStep, type CiStatus, type CiStepKind, type CiInitiatedBy, type CiSlotProgress, type CiLogLine, type CiFixAttempt, type CiFixDiagnosticContext, type CiTargetedTestRun, type CiTestFailure, type CiWorkspace, type CiWorkspaceReportItem, type CiCommandSuggestion, type CiRunSummary, type CiCommandMetric, type CiModelWorkMetric, type CiEventActor, type CiRunUsage, type CiUsageKind, CI_USAGE_KINDS, type CiStageLlmSelection, type CiStageLlmSnapshot, resolveCiStageLlm, type CiInputSemantics, type CiToolCalls, type CiToolChars, type CiToolKind, type CiRunToolResponse, type CiRunReport, type CiRunReportStep, type CiTaskReport, type KbGapNote, CI_TOOL_KINDS, CI_TOOL_RESPONSES_KEEP, CI_TOOL_RESPONSES_SHOWN, EMPTY_CI_TOOL_CALLS, EMPTY_CI_TOOL_CHARS, ciTaskTotals, ciUsageStages, ciUsageTotals, normCiStageModels, buildCiAutomationProgress, isVerificationCommand, componentQaLaunchReasons, componentQaSemanticVersion, canTransitionWorkflow, type DevelopmentReadiness, type ComponentQaRun, type ComponentQaScenarioSnapshot, type ComponentQaCommandResult, type ComponentQaArtifact, type IntegrationTestRun, type IntegrationTestTaskState, type IntegrationTestCommandResult, integrationTestSemanticVersion, integrationTestGate } from '@voicechat/shared'
import { calculateKbHit, filesReadFromCiLog } from '../../ci/kbHit.js'
import { testStages } from '../../ci/testStages.js'
import { trimHistoricalRunLogs } from '../../ci/qaStateLogs.js'
import { BaseRepo } from './base.js'
import { parseStringArray, normCiStatus, normKbContextMode, normRunMode, normClarifyLevel, clampClarifyMax, parseJsonValue, parseSlotProgress, mapCiRun, type TaskRow, type CiRunRow } from './support.js'

/** Сколько строк лога рана отдаётся по умолчанию: лента показывает конец, а не всю историю. */
const CI_RUN_LOG_TAIL_LINES = 5_000

/** Жёсткий потолок запроса: даже явный `?limit=` не должен собирать в память весь лог. */
const CI_RUN_LOG_MAX_LINES = 20_000

/** Разбор JSON-объекта из колонки; битое или пустое значение — `null`. */
function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// ======================= CI-раннер: строки БД и мапперы ================
interface CiCommandRow {
  id: string; scope: string; project_id: string | null; name: string; script: string
  description: string; workdir: string; timeout_sec: number | null; env_json: string
  allow_failure: number; is_cleanup: number; available_to_model: number; is_test: number; builtin: string | null; version: number
  created_by: string; created_at: number; updated_at: number; deleted_at: number | null
}

function isMergeToBaseStepLike(name: string, script: string): boolean {
  return /влить.*(ветк|прод)|merge.*(main|base)/i.test(name)
    || (/git\s+merge/i.test(script) && /git\s+push/i.test(script))
}

function isProductionDeployStepLike(name: string, script: string): boolean {
  return /обновить.*прод|production.*deploy|prod.*rebuild/i.test(name)
    || /PROD_DIR|rebuild-when-idle|production_deploy/i.test(script)
}

function parseCiEnv(j: string): Record<string, string> {
  try {
    const o = JSON.parse(j) as unknown
    if (o && typeof o === 'object') {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) out[k] = String(v)
      return out
    }
  } catch {
    /* битый JSON — пустое окружение */
  }
  return {}
}

function mapCiCommand(r: CiCommandRow): CiCommand {
  return {
    id: r.id,
    scope: r.scope === 'global' ? 'global' : 'project',
    projectId: r.project_id,
    name: r.name,
    script: r.script,
    description: r.description,
    workdir: r.workdir,
    timeoutSec: r.timeout_sec,
    env: parseCiEnv(r.env_json),
    allowFailure: !!r.allow_failure,
    isCleanup: !!r.is_cleanup,
    availableToModel: !!r.available_to_model,
    isTest: !!r.is_test,
    builtin: r.builtin === 'kb_update' ? 'kb_update' : null,
    version: r.version,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at
  }
}

function normInteractionKind(k: string): CiInteractionKind {
  return k === 'plan_approval' ? 'plan_approval' : 'clarify'
}

function normInteractionStatus(st: string): CiInteractionStatus {
  return st === 'answered' || st === 'cancelled' ? st : 'pending'
}

function parseQuestionSpecs(j: string | null): QuestionSpec[] {
  if (!j) return []
  try {
    const v = JSON.parse(j)
    return Array.isArray(v) ? (v as QuestionSpec[]) : []
  } catch {
    return []
  }
}

function mapCiInteraction(r: CiInteractionRow): CiInteraction {
  return {
    id: r.id, runId: r.run_id, stepId: r.step_id, seq: r.seq, kind: normInteractionKind(r.kind),
    questions: parseQuestionSpecs(r.questions_json), planText: r.plan_text, answerText: r.answer_text,
    decision: r.decision === 'approved' || r.decision === 'rework' ? r.decision : null,
    status: normInteractionStatus(r.status), conversationId: r.conversation_id, messageId: r.message_id,
    createdAt: r.created_at, answeredAt: r.answered_at, answeredBy: r.answered_by
  }
}

interface CiInteractionRow {
  id: string; run_id: string; step_id: string; seq: number; kind: string
  questions_json: string | null; plan_text: string | null; answer_text: string | null
  decision: string | null; status: string; conversation_id: string | null; message_id: string | null
  created_at: number; answered_at: number | null; answered_by: string | null
}

interface CiRunStepRow {
  id: string; run_id: string; slot: string | null; position: number; kind: string
  parent_step_id: string | null; initiated_by: string; command_id: string | null
  command_snapshot: string | null; title: string; workdir: string | null; status: string
  exit_code: number | null; attempt: number; fixed_by_model: number
  started_at: number | null; finished_at: number | null; duration_ms: number | null
}

function normStepKind(k: string): CiStepKind {
  return k === 'model_work' || k === 'model_command' || k === 'model_summary' ? k : 'command'
}

function normInitiatedBy(v: string): CiInitiatedBy {
  return v === 'user' || v === 'model' ? v : 'system'
}

function mapCiRunStep(r: CiRunStepRow): CiRunStep {
  return {
    id: r.id, runId: r.run_id, slot: r.slot === 'before_model' || r.slot === 'after_model' ? r.slot : null,
    position: r.position, kind: normStepKind(r.kind), parentStepId: r.parent_step_id,
    initiatedBy: normInitiatedBy(r.initiated_by), commandId: r.command_id, commandSnapshot: r.command_snapshot,
    title: r.title, workdir: r.workdir, status: normCiStatus(r.status), exitCode: r.exit_code,
    attempt: r.attempt, fixedByModel: !!r.fixed_by_model, startedAt: r.started_at,
    finishedAt: r.finished_at, durationMs: r.duration_ms
  }
}

interface CiRunUsageRow {
  id: string; run_id: string; step_id: string | null; kind: string; provider: string; model: string
  input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_creation_tokens: number
  cost_usd: number | null; duration_ms: number | null; num_turns: number | null
  input_semantics: string | null; at: number
}

function normUsageKind(k: string): CiUsageKind {
  return k === 'summary' || k === 'fix' || k === 'kb_update' ? k : 'model_work'
}

/**
 * Семантика входа строки. Явно записанная — источник истины; её отсутствие
 * означает историческую строку: у codex вход там ВМЕСТЕ с прочитанным кэшем, у
 * claude он и раньше был без него.
 */
function usageInputSemantics(r: CiRunUsageRow): CiInputSemantics {
  if (r.input_semantics === 'no_cache' || r.input_semantics === 'with_cache') return r.input_semantics
  return r.provider === 'codex' ? 'with_cache' : 'no_cache'
}

function mapCiRunUsage(r: CiRunUsageRow): CiRunUsage {
  return {
    id: r.id, runId: r.run_id, stepId: r.step_id, kind: normUsageKind(r.kind),
    provider: r.provider === 'codex' ? 'codex' : 'claude', model: r.model,
    inputTokens: r.input_tokens, outputTokens: r.output_tokens,
    cacheReadTokens: r.cache_read_tokens, cacheCreationTokens: r.cache_creation_tokens,
    inputSemantics: usageInputSemantics(r),
    costUsd: r.cost_usd, durationMs: r.duration_ms, numTurns: r.num_turns, at: r.at
  }
}

interface CiLogRow { run_id: string; step_id: string; seq: number; stream: string; chunk: string; at: number }

function mapCiLog(r: CiLogRow): CiLogLine {
  return {
    runId: r.run_id, stepId: r.step_id, seq: r.seq,
    stream: r.stream === 'stderr' || r.stream === 'system' ? r.stream : 'stdout',
    chunk: r.chunk, at: r.at
  }
}

interface CiFixRow {
  id: string; run_step_id: string; attempt_no: number; diagnosis: string; action: string
  result: string; diff: string | null; changed_files_json: string; targeted_tests_json: string; full_rerun_json: string | null; failures_json: string; duration_ms: number | null; tokens_used: number | null; created_at: number
}

function mapCiFix(r: CiFixRow): CiFixAttempt {
  return {
    id: r.id, runStepId: r.run_step_id, attemptNo: r.attempt_no, diagnosis: r.diagnosis, action: r.action,
    result: r.result === 'fixed' || r.result === 'gave_up' ? r.result : 'retrying',
    diff: r.diff,
    changedFiles: parseJsonValue<string[]>(r.changed_files_json, []),
    targetedTests: parseJsonValue<CiTargetedTestRun[]>(r.targeted_tests_json, []),
    fullRerun: parseJsonValue<CiFixAttempt['fullRerun']>(r.full_rerun_json, null),
    failures: parseJsonValue<CiTestFailure[]>(r.failures_json, []),
    durationMs: r.duration_ms, tokensUsed: r.tokens_used, createdAt: r.created_at
  }
}

interface CiWorkspaceRow {
  id: string; project_id: string; task_id: string; agent_id: string | null; path: string
  branch: string | null; commit_sha: string | null; pushed: number
  state: string; size_bytes: number | null; created_at: number; released_by_step_id: string | null
}

function mapCiWorkspace(r: CiWorkspaceRow): CiWorkspace {
  return {
    id: r.id, projectId: r.project_id, taskId: r.task_id, agentId: r.agent_id, path: r.path,
    branch: r.branch ?? null, commitSha: r.commit_sha ?? null, pushed: r.pushed === 1,
    state: r.state === 'released' ? 'released' : 'active', sizeBytes: r.size_bytes,
    createdAt: r.created_at, releasedByStepId: r.released_by_step_id
  }
}

interface CiSuggestionRow {
  id: string; command_id: string; run_step_id: string | null; reason: string; proposed_script: string
  status: string; occurrences: number; created_at: number; resolved_by: string | null; resolved_at: number | null
}

function mapCiSuggestion(r: CiSuggestionRow): CiCommandSuggestion {
  return {
    id: r.id, commandId: r.command_id, runStepId: r.run_step_id, reason: r.reason, proposedScript: r.proposed_script,
    status: r.status === 'accepted' || r.status === 'rejected' ? r.status : 'new',
    occurrences: r.occurrences, createdAt: r.created_at, resolvedBy: r.resolved_by, resolvedAt: r.resolved_at
  }
}

/** Где и что выполняет пост-development стадия (Component QA, интеграционные
 *  тесты). `npmCacheDir` — кэш npm задачи из записи рабочей директории: стадия
 *  ставит зависимости сама и берёт тот же кэш, что и development-ран. У старых
 *  записей его нет — тогда npm работает со своим кэшем по умолчанию. */
export interface CiStageExecutionContext {
  agentId: string
  workdir: string
  npmCacheDir: string | null
  commands: string[]
  /** Ветка, относительно точки ветвления с которой анализируется diff задачи. */
  ciBaseBranch: string
}
export class CiRepo extends BaseRepo {
  // ============================ CI-раннер =====================
  /** Видима ли команда пользователю (глобальная — всем; проектная — участнику). */
  private async ciCommandVisible(userId: string, r: CiCommandRow): Promise<boolean> {
    if (r.scope === 'global') return true
    return r.project_id ? await this.repos.projects.isProjectMember(userId, r.project_id) : false
  }

  async getCiCommand(userId: string, id: string): Promise<CiCommand | null> {
    const r = (await this.sql.get(`SELECT * FROM ci_commands WHERE id = ? AND deleted_at IS NULL`, [id])) as CiCommandRow | undefined
    if (!r || !(await this.ciCommandVisible(userId, r))) return null
    return mapCiCommand(r)
  }

  /** Команды, видимые пользователю: глобальные + команды переданного проекта. */
  async listCiCommands(userId: string, projectId?: string): Promise<CiCommand[]> {
    const rows = (await this.sql.all(`SELECT * FROM ci_commands WHERE deleted_at IS NULL ORDER BY scope DESC, name ASC`)) as CiCommandRow[]
    // Членство проверяем один раз на проект: команд может быть много, а проектов — единицы.
    const membership = new Map<string, boolean>()
    const isMember = async (pid: string): Promise<boolean> => {
      if (!membership.has(pid)) membership.set(pid, await this.repos.projects.isProjectMember(userId, pid))
      return membership.get(pid)!
    }
    const visible: CiCommandRow[] = []
    for (const r of rows) {
      const ok = r.scope === 'global' ? true : projectId ? r.project_id === projectId && await isMember(projectId) : !!r.project_id && await isMember(r.project_id)
      if (ok) visible.push(r)
    }
    return visible.map(mapCiCommand)
  }

  private async ciNameTaken(scope: CiCommandScope, projectId: string | null, name: string, exceptId?: string): Promise<boolean> {
    const row = (await this.sql.get(`SELECT id FROM ci_commands WHERE deleted_at IS NULL AND scope = ? AND name = ? AND (project_id IS ? OR project_id = ?)`, [scope, name, scope === 'global' ? null : projectId, projectId])) as { id: string } | undefined
    return !!row && row.id !== exceptId
  }

  async createCiCommand(userId: string, input: CiCommandInput): Promise<CiCommand> {
    const scope: CiCommandScope = input.scope === 'global' ? 'global' : 'project'
    const projectId = scope === 'global' ? null : input.projectId ?? null
    const name = (input.name ?? '').trim()
    if (!name) throw new Error('Имя команды обязательно')
    if (!(input.script ?? '').trim()) throw new Error('Скрипт команды обязателен')
    if (await this.ciNameTaken(scope, projectId, name)) throw new Error('Команда с таким именем уже существует в этой области')
    const id = this.newId()
    const ts = this.now()
    await this.sql.run(`INSERT INTO ci_commands (id, scope, project_id, name, script, description, workdir, timeout_sec, env_json, allow_failure, is_cleanup, available_to_model, is_test, version, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`, [id, scope, projectId, name, input.script ?? '', input.description ?? '', input.workdir ?? '', input.timeoutSec ?? null, JSON.stringify(input.env ?? {}), input.allowFailure ? 1 : 0, input.isCleanup ? 1 : 0, input.availableToModel === false ? 0 : 1, input.isTest ?? isVerificationCommand({ name, script: input.script ?? '' }) ? 1 : 0, userId, ts, ts])
    return mapCiCommand((await this.sql.get(`SELECT * FROM ci_commands WHERE id = ?`, [id])) as CiCommandRow)
  }

  async updateCiCommand(_userId: string, id: string, input: CiCommandInput): Promise<CiCommand | null> {
    const cur = (await this.sql.get(`SELECT * FROM ci_commands WHERE id = ? AND deleted_at IS NULL`, [id])) as CiCommandRow | undefined
    if (!cur) return null
    const set: string[] = []
    const vals: unknown[] = []
    const nextName = input.name !== undefined ? input.name.trim() : cur.name
    if (input.name !== undefined) {
      if (!nextName) throw new Error('Имя команды обязательно')
      if (await this.ciNameTaken(cur.scope === 'global' ? 'global' : 'project', cur.project_id, nextName, id)) throw new Error('Команда с таким именем уже существует в этой области')
      set.push('name = ?'); vals.push(nextName)
    }
    if (input.script !== undefined) { set.push('script = ?'); vals.push(input.script) }
    if (input.description !== undefined) { set.push('description = ?'); vals.push(input.description) }
    if (input.workdir !== undefined) { set.push('workdir = ?'); vals.push(input.workdir) }
    if (input.timeoutSec !== undefined) { set.push('timeout_sec = ?'); vals.push(input.timeoutSec) }
    if (input.env !== undefined) { set.push('env_json = ?'); vals.push(JSON.stringify(input.env)) }
    if (input.allowFailure !== undefined) { set.push('allow_failure = ?'); vals.push(input.allowFailure ? 1 : 0) }
    if (input.isCleanup !== undefined) { set.push('is_cleanup = ?'); vals.push(input.isCleanup ? 1 : 0) }
    if (input.availableToModel !== undefined) { set.push('available_to_model = ?'); vals.push(input.availableToModel ? 1 : 0) }
    if (input.isTest !== undefined) { set.push('is_test = ?'); vals.push(input.isTest ? 1 : 0) }
    // Правка текста скрипта поднимает версию (снапшоты завершённых ранов неизменны).
    if (input.script !== undefined && input.script !== cur.script) set.push('version = version + 1')
    set.push('updated_at = ?'); vals.push(this.now())
    await this.sql.run(`UPDATE ci_commands SET ${set.join(', ')} WHERE id = ?`, [...vals, id])
    return mapCiCommand((await this.sql.get(`SELECT * FROM ci_commands WHERE id = ?`, [id])) as CiCommandRow)
  }

  async softDeleteCiCommand(_userId: string, id: string): Promise<boolean> {
    const cur = (await this.sql.get(`SELECT * FROM ci_commands WHERE id = ? AND deleted_at IS NULL`, [id])) as CiCommandRow | undefined
    if (!cur) return false
    await this.sql.run(`UPDATE ci_commands SET deleted_at = ?, updated_at = ? WHERE id = ?`, [this.now(), this.now(), id])
    return true
  }

  /** Привязки команды: проекты и задачи, где она используется в слотах. */
  async ciCommandUsage(commandId: string): Promise<{ projects: Array<{ id: string; name: string }>; tasks: Array<{ id: string; title: string }> }> {
    const rows = (await this.sql.all(`SELECT owner_type, owner_id FROM ci_slot_commands WHERE command_id = ?`, [commandId])) as Array<{ owner_type: string; owner_id: string }>
    const projects: Array<{ id: string; name: string }> = []
    const tasks: Array<{ id: string; title: string }> = []
    const seenP = new Set<string>()
    const seenT = new Set<string>()
    for (const r of rows) {
      if (r.owner_type === 'project' && !seenP.has(r.owner_id)) {
        seenP.add(r.owner_id)
        const p = (await this.sql.get(`SELECT name FROM projects WHERE id = ?`, [r.owner_id])) as { name: string } | undefined
        if (p) projects.push({ id: r.owner_id, name: p.name })
      } else if (r.owner_type === 'task' && !seenT.has(r.owner_id)) {
        seenT.add(r.owner_id)
        const t = (await this.sql.get(`SELECT title FROM tasks WHERE id = ?`, [r.owner_id])) as { title: string } | undefined
        if (t) tasks.push({ id: r.owner_id, title: t.title })
      }
    }
    return { projects, tasks }
  }

  // --- Слот-конфиг (дефолты проекта / переопределение задачи) ---

  private async readSlot(ownerType: 'project' | 'task', ownerId: string, slot: CiSlot): Promise<string[]> {
    return ((await this.sql.all(`SELECT command_id FROM ci_slot_commands WHERE owner_type = ? AND owner_id = ? AND slot = ? ORDER BY position ASC`, [ownerType, ownerId, slot])) as Array<{ command_id: string }>).map((r) => r.command_id)
  }

  async getCiSlotConfig(ownerType: 'project' | 'task', ownerId: string): Promise<CiSlotConfig> {
    return { beforeModel: await this.readSlot(ownerType, ownerId, 'before_model'), afterModel: await this.readSlot(ownerType, ownerId, 'after_model') }
  }

  /** Есть ли у владельца хоть одна привязка (для метки «унаследовано/переопределено»). */
  async hasCiSlotConfig(ownerType: 'project' | 'task', ownerId: string): Promise<boolean> {
    return await this.sql.get(`SELECT 1 FROM ci_slot_commands WHERE owner_type = ? AND owner_id = ? LIMIT 1`, [ownerType, ownerId]) !== undefined
  }

  async setCiSlotCommands(ownerType: 'project' | 'task', ownerId: string, slot: CiSlot, commandIds: string[]): Promise<void> {
    await this.sql.transaction(async () => {
      await this.sql.run(`DELETE FROM ci_slot_commands WHERE owner_type = ? AND owner_id = ? AND slot = ?`, [ownerType, ownerId, slot])
      for (const [i, commandId] of commandIds.entries()) await this.sql.run(`INSERT INTO ci_slot_commands (id, owner_type, owner_id, slot, command_id, position) VALUES (?, ?, ?, ?, ?, ?)`, [this.newId(), ownerType, ownerId, slot, commandId, i])
    })
  }

  /**
   * Встроенный шаг «Актуализировать базу знаний» в справочнике команд. Скрипт не
   * исполняется — раннер видит `builtin` и зовёт серверный хук; строка нужна,
   * чтобы шаг вёл себя как обычная команда: двигался внутри слота и убирался из
   * проекта или задачи штатным редактором слотов.
   *
   * При первом появлении команды раздаём её в слот «после модели» всех проектов,
   * где пайплайн уже настроен, — перед шагом коммита, чтобы правки `docs/kb/*`
   * уехали тем же коммитом, что и код. Повторно (после того как шаг убрали
   * руками) команда не возвращается: строка справочника уже есть.
   */
  async ensureKbUpdateCommand(): Promise<void> {
    if (await this.sql.get(`SELECT id FROM ci_commands WHERE id = ?`, [CI_KB_UPDATE_COMMAND_ID])) return
    const ts = this.now()
    await this.sql.run(`INSERT INTO ci_commands (id, scope, project_id, name, script, description, workdir, timeout_sec, env_json, allow_failure, is_cleanup, available_to_model, builtin, version, created_by, created_at, updated_at)
         VALUES (?, 'global', NULL, ?, ?, ?, '', NULL, '{}', 0, 0, 0, 'kb_update', 1, 'system', ?, ?)`, [CI_KB_UPDATE_COMMAND_ID, CI_KB_UPDATE_COMMAND_NAME, '# Серверный шаг: скрипт не выполняется.\n# Модель сверяет базу знаний с изменениями рабочей копии (см. kb/codeUpdate.ts).', 'Модель дописывает в базу знаний, что изменилось в этом ране: темы docs/kb/*.md в рабочей копии и статьи раздела проекта. Ошибка шага останавливает ран.', ts, ts])
  }

  /**
   * Идемпотентная миграция development pipeline. Удаляет только известные
   * системные интеграционные команды из after_model; строки справочника и любые
   * пользовательские команды сохраняются для истории и других интерфейсов.
   */
  async pruneDevelopmentAfterModelCommands(): Promise<void> {
    const rows = (await this.sql.all(`
      SELECT s.id, c.name, c.script, c.builtin, c.is_cleanup, c.is_test
      FROM ci_slot_commands s
      JOIN ci_commands c ON c.id = s.command_id
      WHERE s.slot = 'after_model'
    `)) as Array<{ id:string; name:string; script:string; builtin:string|null; is_cleanup:number; is_test:number }>
    const remove = this.sql.prepare(`DELETE FROM ci_slot_commands WHERE id = ?`)
    const tx = () => this.sql.transaction(async () => {
      for (const row of rows) {
        const legacy = row.builtin === 'kb_update'
          || !!row.is_cleanup
          || !!row.is_test
          || isMergeToBaseStepLike(row.name, row.script)
          || isProductionDeployStepLike(row.name, row.script)
        if (legacy) await remove.run(row.id)
      }
    })
    await tx()
  }

  /** Эффективные слоты задачи: её переопределение либо дефолты проекта. */
  async resolveTaskSlots(projectId: string, taskId: string): Promise<CiSlotConfig> {
    if (await this.hasCiSlotConfig('task', taskId)) return await this.getCiSlotConfig('task', taskId)
    return await this.getCiSlotConfig('project', projectId)
  }

  async getTaskProcessStages(taskId: string): Promise<CiProcessStage[]> {
    const row = (await this.sql.get(`SELECT stages_json FROM ci_task_process_stages WHERE task_id = ?`, [taskId])) as { stages_json: string } | undefined
    if (!row) return [...CI_PROCESS_STAGES]
    try { return normalizeCiProcessStages(JSON.parse(row.stages_json)) } catch { return [...CI_PROCESS_STAGES] }
  }

  async setTaskProcessStages(taskId: string, stages: unknown): Promise<CiProcessStage[]> {
    const normalized = normalizeCiProcessStages(stages)
    await this.sql.run(`INSERT INTO ci_task_process_stages (task_id, stages_json) VALUES (?, ?) ON CONFLICT(task_id) DO UPDATE SET stages_json=excluded.stages_json`, [taskId, JSON.stringify(normalized)])
    return normalized
  }

  /** Браузерная проверка задачи; нет строки — режим «без браузера». */
  async getTaskBrowserCheck(taskId: string): Promise<CiBrowserCheck> {
    const row = (await this.sql.get(`SELECT check_json FROM ci_task_browser_checks WHERE task_id = ?`, [taskId])) as { check_json: string } | undefined
    if (!row) return { ...DEFAULT_CI_BROWSER_CHECK }
    try { return normalizeCiBrowserCheck(JSON.parse(row.check_json)) } catch { return { ...DEFAULT_CI_BROWSER_CHECK } }
  }

  async setTaskBrowserCheck(taskId: string, value: unknown): Promise<CiBrowserCheck> {
    const normalized = normalizeCiBrowserCheck(value)
    await this.sql.run(`INSERT INTO ci_task_browser_checks (task_id, check_json) VALUES (?, ?) ON CONFLICT(task_id) DO UPDATE SET check_json=excluded.check_json`, [taskId, JSON.stringify(normalized)])
    return normalized
  }

  async getCiLlmConfig(ownerType: 'project' | 'task', ownerId: string): Promise<CiLlmConfig | null> {
    const row = (await this.sql.get(`SELECT llm_engine_id, provider, model, mode, clarify_level, clarify_max FROM ci_llm_configs WHERE owner_type = ? AND owner_id = ?`, [ownerType, ownerId])) as
      | { llm_engine_id: string | null; provider: string; model: string; mode: string; clarify_level: string; clarify_max: number }
      | undefined
    if (!row) return null
    return {
      ...(row.llm_engine_id ? { llmEngineId: row.llm_engine_id } : {}),
      provider: row.provider === 'codex' ? 'codex' : 'claude',
      model: row.model,
      mode: normRunMode(row.mode),
      clarifyLevel: normClarifyLevel(row.clarify_level),
      clarifyMax: clampClarifyMax(row.clarify_max)
    }
  }

  async setCiLlmConfig(ownerType: 'project' | 'task', ownerId: string, config: CiLlmConfig): Promise<CiLlmConfig> {
    const provider = config.provider === 'codex' ? 'codex' : 'claude'
    const model = config.model.trim() || (provider === 'codex' ? 'gpt-5.4' : DEFAULT_CI_CLAUDE_MODEL)
    const next: CiLlmConfig = {
      ...(config.llmEngineId ? { llmEngineId: config.llmEngineId } : {}),
      provider,
      model,
      mode: normRunMode(config.mode),
      clarifyLevel: normClarifyLevel(config.clarifyLevel),
      clarifyMax: clampClarifyMax(config.clarifyMax)
    }
    await this.sql.run(`INSERT INTO ci_llm_configs (owner_type, owner_id, llm_engine_id, provider, model, mode, clarify_level, clarify_max)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_type, owner_id) DO UPDATE SET llm_engine_id=excluded.llm_engine_id, provider=excluded.provider, model=excluded.model,
           mode=excluded.mode, clarify_level=excluded.clarify_level, clarify_max=excluded.clarify_max`, [ownerType, ownerId, next.llmEngineId, next.provider, next.model, next.mode, next.clarifyLevel, next.clarifyMax])
    return next
  }

  /** Снять переопределение (задача снова наследует настройку проекта). */
  async clearCiLlmConfig(ownerType: 'project' | 'task', ownerId: string): Promise<boolean> {
    return (await this.sql.run(`DELETE FROM ci_llm_configs WHERE owner_type = ? AND owner_id = ?`, [ownerType, ownerId])).changes > 0
  }

  /** Переопределение executor/provider/model одного автоматического этапа. */
  async getCiStageLlmConfig(ownerType: 'project' | 'task', ownerId: string, stage: CiUsageKind): Promise<CiStageLlmSelection | null> {
    const row = (await this.sql.get(`SELECT llm_engine_id, provider, model FROM ci_stage_llm_configs WHERE owner_type = ? AND owner_id = ? AND stage = ?`, [ownerType, ownerId, stage])) as
      | { llm_engine_id: string | null; provider: string | null; model: string | null }
      | undefined
    if (!row) return null
    return {
      ...(row.llm_engine_id !== null ? { llmEngineId: row.llm_engine_id } : {}),
      ...(row.provider ? { provider: row.provider === 'codex' ? 'codex' : 'claude' } : {}),
      ...(row.model !== null ? { model: row.model } : {})
    }
  }

  async setCiStageLlmConfig(ownerType: 'project' | 'task', ownerId: string, stage: CiUsageKind, config: CiStageLlmSelection): Promise<CiStageLlmSelection> {
    if (!CI_USAGE_KINDS.includes(stage)) throw new Error(`Неизвестный этап workflow: ${stage}`)
    const next: CiStageLlmSelection = {
      ...(config.llmEngineId !== undefined ? { llmEngineId: config.llmEngineId } : {}),
      ...(config.provider ? { provider: config.provider === 'codex' ? 'codex' : 'claude' } : {}),
      ...(typeof config.model === 'string' ? { model: config.model.trim() } : {})
    }
    await this.sql.run(`INSERT INTO ci_stage_llm_configs (owner_type, owner_id, stage, llm_engine_id, provider, model)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_type, owner_id, stage) DO UPDATE SET llm_engine_id=excluded.llm_engine_id, provider=excluded.provider, model=excluded.model`, [ownerType, ownerId, stage, next.llmEngineId ?? null, next.provider ?? null, next.model ?? null])
    return next
  }

  async clearCiStageLlmConfig(ownerType: 'project' | 'task', ownerId: string, stage: CiUsageKind): Promise<boolean> {
    return (await this.sql.run(`DELETE FROM ci_stage_llm_configs WHERE owner_type = ? AND owner_id = ? AND stage = ?`, [ownerType, ownerId, stage])).changes > 0
  }

  /** Эффективная тройка: стадия задачи → стадия проекта → модель проекта → системный fallback. */
  async resolveTaskStageLlmConfig(projectId: string, taskId: string, stage: CiUsageKind, fallback?: CiStageLlmSnapshot): Promise<CiStageLlmSnapshot> {
    const project = await this.getCiLlmConfig('project', projectId)
    return resolveCiStageLlm({
      taskStage: await this.getCiStageLlmConfig('task', taskId, stage),
      projectStage: await this.getCiStageLlmConfig('project', projectId, stage),
      projectModel: project ? { llmEngineId: project.llmEngineId ?? null, provider: project.provider, model: project.model } : fallback ?? null,
      systemFallback: fallback ?? { llmEngineId: null, provider: DEFAULT_CI_LLM_CONFIG.provider, model: DEFAULT_CI_LLM_CONFIG.model }
    })
  }

  /** Пользовательские LLM-настройки — последний уровень наследования CI. */
  async ciLlmDefaultsForUser(userId: string): Promise<CiLlmConfig> {
    const settings = await this.repos.settings.getSettings(userId)
    return {
      ...DEFAULT_CI_LLM_CONFIG,
      ...(settings.llmEngineId ? { llmEngineId: settings.llmEngineId } : {}),
      provider: settings.llmProvider,
      model: settings.llmProvider === 'codex' ? settings.codexModel : settings.model
    }
  }

  /** Эффективная конфигурация: задача → проект → пользователь → системный дефолт. */
  async resolveTaskLlmConfig(projectId: string, taskId: string, userId?: string): Promise<CiLlmConfig> {
    return await this.getCiLlmConfig('task', taskId)
      ?? await this.getCiLlmConfig('project', projectId)
      ?? (userId ? await this.ciLlmDefaultsForUser(userId) : { ...DEFAULT_CI_LLM_CONFIG })
  }

  // --- Глобальные настройки CI ---

  async getCiSettings(): Promise<CiGlobalSettings> {
    const r = (await this.sql.get(`SELECT * FROM ci_settings WHERE id = 1`)) as Record<string, number | string | null> | undefined
    if (!r) {
      const d = DEFAULT_CI_GLOBAL_SETTINGS
      await this.sql.run(`INSERT INTO ci_settings (id, max_fix_attempts, fix_time_limit_ms, fix_token_limit, default_step_timeout_sec, metrics_window, max_concurrent_runs, max_model_command_calls, interaction_wait_ms, stage_models, bash_output_limit_chars, read_output_limit_chars, read_window_max_lines, grep_match_limit, grep_output_limit_chars) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [d.maxFixAttempts, d.fixTimeLimitMs, d.fixTokenLimit, d.defaultStepTimeoutSec, d.metricsWindow, d.maxConcurrentRuns, d.maxModelCommandCalls, d.interactionWaitMs, JSON.stringify(d.stageModels), d.bashOutputLimitChars, d.readOutputLimitChars, d.readWindowMaxLines, d.grepMatchLimit, d.grepOutputLimitChars])
      return { ...d, stageModels: { ...d.stageModels } }
    }
    const d = DEFAULT_CI_GLOBAL_SETTINGS
    return {
      maxFixAttempts: r.max_fix_attempts as number, fixTimeLimitMs: r.fix_time_limit_ms as number, fixTokenLimit: r.fix_token_limit as number,
      defaultStepTimeoutSec: r.default_step_timeout_sec as number, metricsWindow: r.metrics_window as number,
      maxConcurrentRuns: r.max_concurrent_runs as number, maxModelCommandCalls: r.max_model_command_calls as number,
      interactionWaitMs: (r.interaction_wait_ms as number) ?? d.interactionWaitMs,
      stageModels: normCiStageModels(parseJsonObject(r.stage_models)),
      bashOutputLimitChars: (r.bash_output_limit_chars as number) ?? d.bashOutputLimitChars,
      readOutputLimitChars: (r.read_output_limit_chars as number) ?? d.readOutputLimitChars,
      readWindowMaxLines: (r.read_window_max_lines as number) ?? d.readWindowMaxLines,
      grepMatchLimit: (r.grep_match_limit as number) ?? d.grepMatchLimit,
      grepOutputLimitChars: (r.grep_output_limit_chars as number) ?? d.grepOutputLimitChars
    }
  }

  async updateCiSettings(patch: Partial<CiGlobalSettings>): Promise<CiGlobalSettings> {
    const cur = await this.getCiSettings()
    const next = { ...cur, ...patch, stageModels: patch.stageModels ? normCiStageModels({ ...cur.stageModels, ...patch.stageModels }) : cur.stageModels }
    await this.sql.run(`UPDATE ci_settings SET max_fix_attempts=?, fix_time_limit_ms=?, fix_token_limit=?, default_step_timeout_sec=?, metrics_window=?, max_concurrent_runs=?, max_model_command_calls=?, interaction_wait_ms=?, stage_models=?, bash_output_limit_chars=?, read_output_limit_chars=?, read_window_max_lines=?, grep_match_limit=?, grep_output_limit_chars=? WHERE id=1`, [next.maxFixAttempts, next.fixTimeLimitMs, next.fixTokenLimit, next.defaultStepTimeoutSec, next.metricsWindow, next.maxConcurrentRuns, next.maxModelCommandCalls, next.interactionWaitMs, JSON.stringify(next.stageModels), next.bashOutputLimitChars, next.readOutputLimitChars, next.readWindowMaxLines, next.grepMatchLimit, next.grepOutputLimitChars])
    return next
  }

  // --- Раны и шаги ---

  async createCiRun(args: { projectId: string; taskId: string; agentId: string | null; agentOwnerId?: string | null; agentOwnerName?: string; agentSelectionSource?: 'explicit' | 'explicit_bypass' | 'task_pinned' | 'project_default' | 'user_project_default' | 'fallback' | 'unknown'; triggeredBy: string; prevColumnId: string | null; runColumnId?: string | null; slotProgress: CiSlotProgress; llmEngineId?: string | null; llmProvider?: 'claude' | 'codex'; llmModel?: string; mode?: CiRunMode; clarifyLevel?: CiClarifyLevel; clarifyMax?: number; conversationId?: string | null; kbContextMode?: KbContextMode }): Promise<CiRun> {
    const id = this.newId()
    const ts = this.now()
    await this.sql.run(`INSERT INTO ci_runs (id, project_id, task_id, agent_id, agent_owner_id, agent_owner_name, agent_selection_source, status, triggered_by, prev_column_id, run_column_id, llm_engine_id, llm_provider, llm_model, mode, clarify_level, clarify_max, conversation_id, kb_context_mode, slot_progress_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, args.projectId, args.taskId, args.agentId, args.agentOwnerId ?? null, args.agentOwnerName ?? 'неизвестно', args.agentSelectionSource ?? 'unknown', args.triggeredBy, args.prevColumnId, args.runColumnId ?? null, args.llmEngineId ?? null, args.llmProvider ?? 'claude', args.llmModel ?? DEFAULT_CI_CLAUDE_MODEL, normRunMode(args.mode), normClarifyLevel(args.clarifyLevel), clampClarifyMax(args.clarifyMax), args.conversationId ?? null, normKbContextMode(args.kbContextMode), JSON.stringify(args.slotProgress), ts])
    return mapCiRun((await this.sql.get(`SELECT * FROM ci_runs WHERE id = ?`, [id])) as CiRunRow)
  }

  /**
   * Сколько незавершённых ранов сейчас закреплено за каждой машиной — для
   * распределения параллельных запусков. Ран с пустым `agent_id` (карточки до
   * появления выбора машины) выполняется на машине проекта по умолчанию, поэтому
   * учитывается за ней: без этого такая машина выглядит свободной и собирает всё.
   */
  async countActiveCiRunsByAgent(): Promise<Record<string, number>> {
    const rows = (await this.sql.all(`SELECT COALESCE(r.agent_id, p.default_agent_id) AS agent_id, COUNT(*) AS n
       FROM ci_runs r LEFT JOIN projects p ON p.id = r.project_id
       WHERE r.status IN ('queued', 'running', 'awaiting_input')
       GROUP BY COALESCE(r.agent_id, p.default_agent_id)`)) as Array<{ agent_id: string | null; n: number }>
    const counts: Record<string, number> = {}
    for (const row of rows) if (row.agent_id) counts[row.agent_id] = row.n
    return counts
  }

  /**
   * Успешный прогон этого набора команд на этом коммите, если он уже был.
   * Возвращается вместе с раном-источником: стадия пишет его в лог, чтобы
   * переиспользование было видно человеку, а не выглядело как пропуск проверок.
   */
  async findPassedGateResult(commitSha: string, signature: string): Promise<{ runKind: string; runId: string; createdAt: number } | null> {
    if (!commitSha || !signature) return null
    const row = (await this.sql.get(`SELECT run_kind, run_id, created_at FROM ci_gate_results WHERE commit_sha = ? AND signature = ?`, [commitSha, signature])) as { run_kind: string; run_id: string; created_at: number } | undefined
    return row ? { runKind: row.run_kind, runId: row.run_id, createdAt: row.created_at } : null
  }

  /** Запоминает зелёный прогон; повторная запись того же ключа безвредна. */
  async recordPassedGateResult(args: { projectId: string; taskId: string; commitSha: string; signature: string; commands: readonly string[]; runKind: string; runId: string }): Promise<void> {
    if (!args.commitSha || !args.signature) return
    await this.sql.run(`INSERT INTO ci_gate_results (id, project_id, task_id, commit_sha, signature, commands_json, run_kind, run_id, created_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(commit_sha, signature) DO NOTHING`, [this.newId(), args.projectId, args.taskId, args.commitSha, args.signature, JSON.stringify(args.commands), args.runKind, args.runId, this.now()])
  }

  async getCiRunRaw(runId: string): Promise<CiRun | null> {
    const r = (await this.sql.get(`SELECT * FROM ci_runs WHERE id = ?`, [runId])) as CiRunRow | undefined
    return r ? mapCiRun(r) : null
  }

  async activeCiRunForTask(taskId: string): Promise<CiRun | null> {
    const r = (await this.sql.get(`SELECT * FROM ci_runs WHERE task_id = ? AND status IN ('queued', 'running', 'awaiting_input') ORDER BY created_at DESC, rowid DESC LIMIT 1`, [taskId])) as CiRunRow | undefined
    return r ? mapCiRun(r) : null
  }

  async getCiRun(userId: string, runId: string): Promise<CiRunDetail | null> {
    const r = (await this.sql.get(`SELECT * FROM ci_runs WHERE id = ?`, [runId])) as CiRunRow | undefined
    if (!r || !(await this.repos.projects.isProjectMember(userId, r.project_id))) return null
    const run = mapCiRun(r)
    const steps = ((await this.sql.all(`SELECT * FROM ci_run_steps WHERE run_id = ? ORDER BY position ASC, id ASC`, [runId])) as CiRunStepRow[]).map(mapCiRunStep)
    const fixAttempts = ((await this.sql.all(`SELECT f.* FROM ci_fix_attempts f JOIN ci_run_steps s ON s.id = f.run_step_id WHERE s.run_id = ? ORDER BY f.created_at ASC`, [runId])) as CiFixRow[]).map(mapCiFix)
    const stageRuns = await this.listCiStageRuns(runId)
    return { run, executionLlm: this.ciExecutionLlm(run, stageRuns), stageRuns, steps, fixAttempts, interactions: await this.listCiInteractions(runId) }
  }

  async listCiRunsForTask(userId: string, projectId: string, taskId: string): Promise<CiRun[]> {
    if (!(await this.repos.projects.isProjectMember(userId, projectId))) return []
    return ((await this.sql.all(`SELECT * FROM ci_runs WHERE task_id = ? ORDER BY created_at DESC`, [taskId])) as CiRunRow[]).map(mapCiRun)
  }

  async updateCiRun(runId: string, patch: { status?: CiStatus; error?: string | null; runColumnId?: string | null; terminalColumnId?: string | null; agentId?: string | null; agentSelectionSource?: CiRun['agentSelectionSource']; workspaceId?: string | null; startedAt?: number; finishedAt?: number; durationMs?: number; slotProgress?: CiSlotProgress; llmEngineId?: string | null; llmProvider?: 'claude' | 'codex'; llmModel?: string; mode?: CiRunMode; conversationId?: string | null; modelSessionId?: string | null; fixContext?: CiFixDiagnosticContext | null }): Promise<CiRun | null> {
    const set: string[] = []
    const vals: unknown[] = []
    if (patch.status !== undefined) { set.push('status = ?'); vals.push(patch.status) }
    if (patch.error !== undefined || patch.status !== undefined) {
      const error = patch.error?.trim() || (patch.status === 'failed' ? 'Ран завершился с ошибкой до появления подробной диагностики.' : null)
      set.push('error = ?'); vals.push(error)
    }
    if (patch.runColumnId !== undefined) { set.push('run_column_id = ?'); vals.push(patch.runColumnId) }
    if (patch.terminalColumnId !== undefined) { set.push('terminal_column_id = ?'); vals.push(patch.terminalColumnId) }
    if (patch.agentId !== undefined) { set.push('agent_id = ?'); vals.push(patch.agentId) }
    if (patch.agentSelectionSource !== undefined) { set.push('agent_selection_source = ?'); vals.push(patch.agentSelectionSource) }
    if (patch.workspaceId !== undefined) { set.push('workspace_id = ?'); vals.push(patch.workspaceId) }
    if (patch.startedAt !== undefined) { set.push('started_at = ?'); vals.push(patch.startedAt) }
    if (patch.finishedAt !== undefined) { set.push('finished_at = ?'); vals.push(patch.finishedAt) }
    if (patch.durationMs !== undefined) { set.push('duration_ms = ?'); vals.push(patch.durationMs) }
    if (patch.slotProgress !== undefined) { set.push('slot_progress_json = ?'); vals.push(JSON.stringify(patch.slotProgress)) }
    if (patch.llmEngineId !== undefined) { set.push('llm_engine_id = ?'); vals.push(patch.llmEngineId) }
    if (patch.llmProvider !== undefined) { set.push('llm_provider = ?'); vals.push(patch.llmProvider) }
    if (patch.llmModel !== undefined) { set.push('llm_model = ?'); vals.push(patch.llmModel) }
    if (patch.mode !== undefined) { set.push('mode = ?'); vals.push(normRunMode(patch.mode)) }
    if (patch.conversationId !== undefined) { set.push('conversation_id = ?'); vals.push(patch.conversationId) }
    if (patch.modelSessionId !== undefined) { set.push('model_session_id = ?'); vals.push(patch.modelSessionId) }
    if (patch.fixContext !== undefined) { set.push('fix_context_json = ?'); vals.push(patch.fixContext ? JSON.stringify(patch.fixContext) : null) }
    if (!set.length) return await this.getCiRunRaw(runId)
    await this.sql.run(`UPDATE ci_runs SET ${set.join(', ')} WHERE id = ?`, [...vals, runId])
    return await this.getCiRunRaw(runId)
  }

  async createCiStageRun(args: { runId: string; taskId: string; stage: CiUsageKind; llm: CiStageLlmSnapshot }): Promise<CiStageRun> {
    const id = this.newId()
    const ts = this.now()
    await this.sql.run(`INSERT INTO ci_stage_runs (id, run_id, task_id, stage, status, llm_engine_id, llm_provider, llm_model, created_at)
      VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)`, [id, args.runId, args.taskId, args.stage, args.llm.llmEngineId, args.llm.provider, args.llm.model, ts])
    return (await this.listCiStageRuns(args.runId)).find((stage) => stage.id === id)!
  }

  async updateCiStageRun(id: string, patch: { status?: CiStatus; outcome?: string | null; startedAt?: number; finishedAt?: number; durationMs?: number }): Promise<CiStageRun | null> {
    const set: string[] = []
    const values: unknown[] = []
    if (patch.status !== undefined) { set.push('status = ?'); values.push(patch.status) }
    if (patch.outcome !== undefined) { set.push('outcome = ?'); values.push(patch.outcome) }
    if (patch.startedAt !== undefined) { set.push('started_at = ?'); values.push(patch.startedAt) }
    if (patch.finishedAt !== undefined) { set.push('finished_at = ?'); values.push(patch.finishedAt) }
    if (patch.durationMs !== undefined) { set.push('duration_ms = ?'); values.push(patch.durationMs) }
    if (!set.length) return null
    await this.sql.run(`UPDATE ci_stage_runs SET ${set.join(', ')} WHERE id = ?`, [...values, id])
    const row = (await this.sql.get(`SELECT run_id FROM ci_stage_runs WHERE id = ?`, [id])) as { run_id: string } | undefined
    return row ? (await this.listCiStageRuns(row.run_id)).find((stage) => stage.id === id) ?? null : null
  }

  private ciExecutionLlm(run: CiRun, stageRuns: CiStageRun[]): CiExecutionLlmSnapshot {
    const stage = [...stageRuns].reverse().find((item) => ['queued', 'running', 'awaiting_input'].includes(item.status))
      ?? stageRuns.at(-1)
    const base = {
      llmEngineId: run.llmEngineId ?? null, provider: run.llmProvider ?? null,
      model: run.llmModel || null
    }
    if (stage) return {
      source: 'stage', stage: stage.stage, llmEngineId: stage.llm.llmEngineId ?? null,
      provider: stage.llm.provider ?? null, model: stage.llm.model || null, base
    }
    return {
      source: 'run', stage: null, ...base, base
    }
  }

  async listCiStageRuns(runId: string): Promise<CiStageRun[]> {
    const rows = (await this.sql.all(`SELECT * FROM ci_stage_runs WHERE run_id = ? ORDER BY created_at, rowid`, [runId])) as Array<Record<string, string | number | null>>
    const usage = await this.listCiRunUsage(runId)
    return rows.map((row) => {
      const startedAt = row.started_at as number | null
      const finishedAt = row.finished_at as number | null
      return {
        id: row.id as string,
        runId: row.run_id as string,
        taskId: row.task_id as string,
        stage: row.stage as CiUsageKind,
        status: normCiStatus(row.status as string),
        llm: { llmEngineId: row.llm_engine_id as string | null, provider: row.llm_provider === 'codex' ? 'codex' : 'claude', model: row.llm_model as string },
        startedAt,
        finishedAt,
        durationMs: row.duration_ms as number | null,
        usage: ciUsageTotals(usage.filter((item) => item.kind === row.stage && (startedAt === null || item.at >= startedAt) && (finishedAt === null || item.at <= finishedAt))),
        outcome: row.outcome as string | null
      }
    })
  }

  /**
   * Восстанавливает CI после потери process-local исполнителей. Раны, которые ещё
   * не получили started_at, остаются в очереди; начавшиеся закрываются отдельным
   * исходом interrupted, чтобы рестарт не выглядел ошибкой задачи.
   */
  async reconcileInterruptedCiRuns(): Promise<{ queued: CiRun[]; interrupted: CiRun[] }> {
    const rows = (await this.sql.all(`SELECT * FROM ci_runs WHERE status IN ('queued', 'running', 'awaiting_input') ORDER BY created_at, rowid`)) as CiRunRow[]
    const ts = this.now()
    const queued: CiRun[] = []
    const interrupted: CiRun[] = []
    for (const r of rows) {
      if (r.status === 'queued' && r.started_at == null) {
        const run = await this.getCiRunRaw(r.id)
        if (run) queued.push(run)
        await this.addCiEvent({ projectId: r.project_id, runId: r.id, type: 'run.requeued', actorType: 'system', payload: { reason: 'server_restart' } })
        continue
      }
      await this.sql.run(`UPDATE ci_run_steps SET status = 'interrupted', finished_at = ? WHERE run_id = ? AND status IN ('running', 'awaiting_input')`, [ts, r.id])
      await this.sql.run(`UPDATE ci_run_steps SET status = 'skipped' WHERE run_id = ? AND status = 'queued'`, [r.id])
      await this.sql.run(`UPDATE ci_interactions SET status = 'cancelled', answered_at = ? WHERE run_id = ? AND status = 'pending'`, [ts, r.id])
      const progress = parseSlotProgress(r.slot_progress_json)
      await this.sql.run(`UPDATE ci_runs SET status = 'interrupted', error = ?, slot_progress_json = ?, finished_at = ?, duration_ms = ? WHERE id = ?`, ['Ран прерван перезапуском сервера.', JSON.stringify({ ...progress, phase: 'Прерван перезапуском сервера', fixing: false }), ts, r.started_at ? ts - r.started_at : null, r.id])
      await this.addCiEvent({ projectId: r.project_id, runId: r.id, type: 'run.finished', actorType: 'system', payload: { status: 'interrupted', reason: 'server_restart' } })
      const run = await this.getCiRunRaw(r.id)
      if (run) interrupted.push(run)
    }
    return { queued, interrupted }
  }

  async addCiRunStep(args: { runId: string; slot: CiSlot | null; position: number; kind: CiStepKind; parentStepId?: string | null; initiatedBy?: CiInitiatedBy; commandId?: string | null; commandSnapshot?: string | null; title: string; workdir?: string | null; status?: CiStatus }): Promise<CiRunStep> {
    const id = this.newId()
    await this.sql.run(`INSERT INTO ci_run_steps (id, run_id, slot, position, kind, parent_step_id, initiated_by, command_id, command_snapshot, title, workdir, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, args.runId, args.slot, args.position, args.kind, args.parentStepId ?? null, args.initiatedBy ?? 'system', args.commandId ?? null, args.commandSnapshot ?? null, args.title, args.workdir ?? null, args.status ?? 'queued'])
    return mapCiRunStep((await this.sql.get(`SELECT * FROM ci_run_steps WHERE id = ?`, [id])) as CiRunStepRow)
  }

  async updateCiRunStep(stepId: string, patch: { status?: CiStatus; exitCode?: number | null; attempt?: number; fixedByModel?: boolean; startedAt?: number; finishedAt?: number; durationMs?: number }): Promise<CiRunStep | null> {
    const set: string[] = []
    const vals: unknown[] = []
    if (patch.status !== undefined) { set.push('status = ?'); vals.push(patch.status) }
    if (patch.exitCode !== undefined) { set.push('exit_code = ?'); vals.push(patch.exitCode) }
    if (patch.attempt !== undefined) { set.push('attempt = ?'); vals.push(patch.attempt) }
    if (patch.fixedByModel !== undefined) { set.push('fixed_by_model = ?'); vals.push(patch.fixedByModel ? 1 : 0) }
    if (patch.startedAt !== undefined) { set.push('started_at = ?'); vals.push(patch.startedAt) }
    if (patch.finishedAt !== undefined) { set.push('finished_at = ?'); vals.push(patch.finishedAt) }
    if (patch.durationMs !== undefined) { set.push('duration_ms = ?'); vals.push(patch.durationMs) }
    if (!set.length) { const r = (await this.sql.get(`SELECT * FROM ci_run_steps WHERE id = ?`, [stepId])) as CiRunStepRow | undefined; return r ? mapCiRunStep(r) : null }
    await this.sql.run(`UPDATE ci_run_steps SET ${set.join(', ')} WHERE id = ?`, [...vals, stepId])
    const r = (await this.sql.get(`SELECT * FROM ci_run_steps WHERE id = ?`, [stepId])) as CiRunStepRow | undefined
    return r ? mapCiRunStep(r) : null
  }

  // --- Лог (потоковый, с монотонным seq для реплея) ---

  async appendCiLog(runId: string, stepId: string, stream: 'stdout' | 'stderr' | 'system', chunk: string): Promise<CiLogLine> {
    const at = this.now()
    const row = (await this.sql.get(`SELECT COALESCE(MAX(seq), 0) AS m FROM ci_run_logs WHERE run_id = ?`, [runId])) as { m: number }
    const seq = row.m + 1
    await this.sql.run(`INSERT INTO ci_run_logs (id, run_id, step_id, seq, stream, chunk, at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [this.newId(), runId, stepId, seq, stream, chunk, at])
    return { runId, stepId, seq, stream, chunk, at }
  }

  /**
   * Хвост лога рана. Раньше метод отдавал все строки: у длинного рана это сотни
   * тысяч записей, и сериализация такого ответа роняла процесс целиком
   * («FATAL ERROR: Reached heap limit» в `StreamBase::Writev` — прод 2026-09-05).
   * Лента показывает конец лога и дописывает новые строки по WS, поэтому хвост
   * закрывает её потребность, а сервер остаётся живым.
   */
  async getCiRunLog(userId: string, runId: string, limit = CI_RUN_LOG_TAIL_LINES): Promise<CiLogLine[]> {
    const r = (await this.sql.get(`SELECT project_id FROM ci_runs WHERE id = ?`, [runId])) as { project_id: string } | undefined
    if (!r || !(await this.repos.projects.isProjectMember(userId, r.project_id))) return []
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), CI_RUN_LOG_MAX_LINES) : CI_RUN_LOG_TAIL_LINES
    const rows = (await this.sql.all(`SELECT * FROM ci_run_logs WHERE run_id = ? ORDER BY seq DESC LIMIT ?`, [runId, safeLimit])) as CiLogRow[]
    return rows.reverse().map(mapCiLog)
  }

  // --- fix-loop ---

  // --- Интеракции рана (вопросы модели / одобрение плана) ---

  /** Создать паузу рана. Монотонный `seq` — как у лога, для устойчивого порядка. */
  async addCiInteraction(args: {
    runId: string
    stepId: string
    kind: CiInteractionKind
    questions?: QuestionSpec[]
    planText?: string | null
    conversationId?: string | null
  }): Promise<CiInteraction> {
    const id = this.newId()
    const row = (await this.sql.get(`SELECT MAX(seq) AS m FROM ci_interactions WHERE run_id = ?`, [args.runId])) as { m: number | null }
    const seq = (row?.m ?? 0) + 1
    await this.sql.run(`INSERT INTO ci_interactions (id, run_id, step_id, seq, kind, questions_json, plan_text, status, conversation_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`, [id, args.runId, args.stepId, seq, args.kind, JSON.stringify(args.questions ?? []), args.planText ?? null, args.conversationId ?? null, this.now()])
    return mapCiInteraction((await this.sql.get(`SELECT * FROM ci_interactions WHERE id = ?`, [id])) as CiInteractionRow)
  }

  async getCiInteraction(id: string): Promise<CiInteraction | null> {
    const r = (await this.sql.get(`SELECT * FROM ci_interactions WHERE id = ?`, [id])) as CiInteractionRow | undefined
    return r ? mapCiInteraction(r) : null
  }

  async listCiInteractions(runId: string): Promise<CiInteraction[]> {
    return ((await this.sql.all(`SELECT * FROM ci_interactions WHERE run_id = ? ORDER BY seq ASC`, [runId])) as CiInteractionRow[]).map(mapCiInteraction)
  }

  /** Запомнить id продублированного в чат сообщения. */
  async setCiInteractionMessage(id: string, conversationId: string, messageId: string): Promise<void> {
    await this.sql.run(`UPDATE ci_interactions SET conversation_id = ?, message_id = ? WHERE id = ?`, [conversationId, messageId, id])
  }

  /**
   * Ответить на паузу. Условие `status = 'pending'` в WHERE делает первый ответ
   * победителем: второй (из ленты или из чата) не проходит и получает `null`.
   */
  async answerCiInteraction(id: string, args: { userId: string; text?: string | null; decision?: CiPlanDecision | null }): Promise<CiInteraction | null> {
    const changed = (await this.sql.run(`UPDATE ci_interactions SET status = 'answered', answer_text = ?, decision = ?, answered_at = ?, answered_by = ? WHERE id = ? AND status = 'pending'`, [args.text ?? null, args.decision ?? null, this.now(), args.userId, id])).changes
    return changed > 0 ? await this.getCiInteraction(id) : null
  }

  /** Снять паузу без ответа (таймаут/отмена рана). */
  async cancelCiInteraction(id: string): Promise<CiInteraction | null> {
    await this.sql.run(`UPDATE ci_interactions SET status = 'cancelled', answered_at = ? WHERE id = ? AND status = 'pending'`, [this.now(), id])
    return await this.getCiInteraction(id)
  }

  async addCiFixAttempt(args: { runStepId: string; attemptNo: number; diagnosis: string; action: string; result: CiFixAttempt['result']; diff?: string | null; changedFiles?: string[]; targetedTests?: CiTargetedTestRun[]; fullRerun?: CiFixAttempt['fullRerun']; failures?: CiTestFailure[]; durationMs?: number | null; tokensUsed?: number | null }): Promise<CiFixAttempt> {
    const id = this.newId()
    await this.sql.run(`INSERT INTO ci_fix_attempts (id, run_step_id, attempt_no, diagnosis, action, result, diff, changed_files_json, targeted_tests_json, full_rerun_json, failures_json, duration_ms, tokens_used, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, args.runStepId, args.attemptNo, args.diagnosis, args.action, args.result, args.diff ?? null, JSON.stringify(args.changedFiles ?? []), JSON.stringify(args.targetedTests ?? []), args.fullRerun ? JSON.stringify(args.fullRerun) : null, JSON.stringify(args.failures ?? []), args.durationMs ?? null, args.tokensUsed ?? null, this.now()])
    return mapCiFix((await this.sql.get(`SELECT * FROM ci_fix_attempts WHERE id = ?`, [id])) as CiFixRow)
  }

  // --- Расход модели по ходам рана ---

  /**
   * Записать расход одного хода CLI. Стоимость сохраняем только ту, что сообщил
   * сам CLI: оценку по прайсу отчёт считает на лету, иначе смена цен переписала
   * бы историю задним числом.
   */
  async addCiRunUsage(args: {
    runId: string
    stepId: string | null
    kind: CiUsageKind
    provider: 'claude' | 'codex'
    model: string
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
    costUsd?: number | null
    durationMs?: number | null
    numTurns?: number | null
    /** Семантика `inputTokens`; по умолчанию — приведённая («вход без кэша»). */
    inputSemantics?: CiInputSemantics
  }): Promise<CiRunUsage> {
    const id = this.newId()
    const at = this.now()
    await this.sql.run(`INSERT INTO ci_run_usage (id, run_id, step_id, kind, provider, model, input_tokens, output_tokens,
                                   cache_read_tokens, cache_creation_tokens, cost_usd, duration_ms, num_turns,
                                   input_semantics, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, args.runId, args.stepId, args.kind, args.provider, args.model, Math.max(0, Math.round(args.inputTokens ?? 0)), Math.max(0, Math.round(args.outputTokens ?? 0)), Math.max(0, Math.round(args.cacheReadTokens ?? 0)), Math.max(0, Math.round(args.cacheCreationTokens ?? 0)), args.costUsd ?? null, args.durationMs ?? null, args.numTurns ?? null, args.inputSemantics ?? 'no_cache', at])
    return mapCiRunUsage((await this.sql.get(`SELECT * FROM ci_run_usage WHERE id = ?`, [id])) as CiRunUsageRow)
  }

  /** Строки расхода рана (в порядке ходов). Гейта нет: зовётся из отчётов. */
  async listCiRunUsage(runId: string): Promise<CiRunUsage[]> {
    return ((await this.sql.all(`SELECT * FROM ci_run_usage WHERE run_id = ? ORDER BY at ASC, rowid ASC`, [runId])) as CiRunUsageRow[]).map(mapCiRunUsage)
  }

  /**
   * Прибавить вызовы инструментов хода к счётчику рана. Метрика, поэтому
   * упавшая запись гасится вызывающим — как и у расхода. Нулевые виды не пишем:
   * «нет строки» = «счётчика у рана нет», и отчёт должен уметь это отличать от
   * настоящего нуля вызовов.
   */
  async addCiRunToolCalls(runId: string, calls: Partial<CiToolCalls>, chars?: Partial<CiToolChars>): Promise<void> {
    const at = this.now()
    const upsert = this.sql.prepare(
      `INSERT INTO ci_run_tool_calls (run_id, tool, calls, chars, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(run_id, tool) DO UPDATE SET calls = calls + excluded.calls,
         chars = chars + excluded.chars, updated_at = excluded.updated_at`
    )
    for (const kind of CI_TOOL_KINDS) {
      const n = calls[kind] ?? 0
      const c = Math.max(0, Math.round(chars?.[kind] ?? 0))
      // Объём без вызовов бывает: ответ пришёл, а вызов посчитан другим видом
      // (в `tool_result` имени инструмента нет) — такую строку писать надо.
      if (n > 0 || c > 0) await upsert.run(runId, kind, Math.round(n), c, at)
    }
  }

  /** Счётчик вызовов инструментов рана; null — у рана его нет (ран до фичи). */
  async ciRunToolCalls(runId: string): Promise<CiToolCalls | null> {
    const rows = (await this.sql.all(`SELECT tool, calls FROM ci_run_tool_calls WHERE run_id = ?`, [runId])) as Array<{ tool: string; calls: number }>
    if (!rows.length) return null
    const calls: CiToolCalls = { ...EMPTY_CI_TOOL_CALLS }
    for (const row of rows) {
      const kind = CI_TOOL_KINDS.find((k) => k === row.tool)
      if (kind) calls[kind] += row.calls
    }
    return calls
  }

  /**
   * Пробелы базы знаний, о которых сообщила модель (блок `kb-gaps` в её ответе).
   * Ключ — (ран, вопрос): fix-loop и следующие ходы называют тот же пробел
   * снова, а два одинаковых пункта в промпте шага актуализации дают две записи
   * об одном и том же. При повторе берётся более полный ответ: вторая попытка
   * обычно знает больше первой.
   *
   * Пробел без ответа не пишется вовсе — заносить в базу нечего (фильтрует
   * `parseKbGaps`). Метрика по духу: упавшую запись гасит вызывающий.
   */
  async addCiRunKbGaps(runId: string, stepId: string | null, gaps: KbGapNote[]): Promise<void> {
    const at = this.now()
    const upsert = this.sql.prepare(
      `INSERT INTO ci_run_kb_gaps (run_id, question, answer, topic, step_id, at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id, question) DO UPDATE SET
         answer = CASE WHEN length(excluded.answer) > length(answer) THEN excluded.answer ELSE answer END,
         topic = COALESCE(excluded.topic, topic), step_id = excluded.step_id`
    )
    for (const gap of gaps) {
      if (!gap.question.trim() || !gap.answer.trim()) continue
      await upsert.run(runId, gap.question.trim(), gap.answer.trim(), gap.topic?.trim() || null, stepId, at)
    }
  }

  /** Пробелы рана в порядке появления: раньше назван — раньше в промпте шага. */
  async ciRunKbGaps(runId: string): Promise<KbGapNote[]> {
    return ((await this.sql.all(`SELECT question, answer, topic FROM ci_run_kb_gaps WHERE run_id = ? ORDER BY at ASC, rowid ASC`, [runId])) as Array<{ question: string; answer: string; topic: string | null }>)
      .map((row) => ({ question: row.question, answer: row.answer, ...(row.topic ? { topic: row.topic } : {}) }))
  }

  /**
   * Объём ответов инструментов рана (символы по видам); null — метрики у рана
   * нет. Ран до метрики и ран, где ответы были пустыми, — разные вещи: колонка
   * `chars` у старых строк нулевая, поэтому «нет строк» и «есть нули» различаем
   * по наличию строк самой таблицы.
   */
  async ciRunToolChars(runId: string): Promise<CiToolChars | null> {
    const rows = (await this.sql.all(`SELECT tool, chars FROM ci_run_tool_calls WHERE run_id = ?`, [runId])) as Array<{ tool: string; chars: number }>
    if (!rows.length) return null
    const chars: CiToolChars = { ...EMPTY_CI_TOOL_CHARS }
    for (const row of rows) {
      const kind = CI_TOOL_KINDS.find((k) => k === row.tool)
      if (kind) chars[kind] += row.chars ?? 0
    }
    return chars
  }

  /**
   * Записать тяжёлый ответ инструмента и оставить у рана только верхушку по
   * объёму (`CI_TOOL_RESPONSES_KEEP`): это метрика «кто раздул контекст», а не
   * архив ленты — она и так целиком в `ci_run_logs`.
   */
  async addCiRunToolResponse(args: {
    runId: string
    stepId: string | null
    tool: string
    kind: CiToolKind
    label: string
    chars: number
    originalChars?: number | null
  }): Promise<void> {
    const id = this.newId()
    await this.sql.run(`INSERT INTO ci_run_tool_responses (id, run_id, step_id, tool, kind, label, chars, original_chars, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, args.runId, args.stepId, args.tool, args.kind, args.label.slice(0, 300), Math.max(0, Math.round(args.chars)), args.originalChars ?? null, this.now()])
    await this.sql.run(`DELETE FROM ci_run_tool_responses WHERE run_id = ? AND id NOT IN (
         SELECT id FROM ci_run_tool_responses WHERE run_id = ? ORDER BY chars DESC, at ASC LIMIT ?
       )`, [args.runId, args.runId, CI_TOOL_RESPONSES_KEEP])
  }

  /** Самые тяжёлые ответы инструментов рана — от тяжёлого к лёгкому. */
  async ciRunToolResponses(runId: string, limit = CI_TOOL_RESPONSES_SHOWN): Promise<CiRunToolResponse[]> {
    return ((await this.sql.all(`SELECT * FROM ci_run_tool_responses WHERE run_id = ? ORDER BY chars DESC, at ASC LIMIT ?`, [runId, limit])) as Array<{ step_id: string | null; tool: string; kind: string; label: string; chars: number; original_chars: number | null; at: number }>)
      .map((row) => ({
        tool: row.tool,
        kind: CI_TOOL_KINDS.find((k) => k === row.kind) ?? 'other',
        label: row.label,
        chars: row.chars,
        originalChars: row.original_chars,
        stepId: row.step_id,
        at: row.at
      }))
  }

  /** Финальный агрегат: список файлов остаётся в логе, в БД сохраняются только числа. */
  async calculateAndSaveCiKbHit(runId: string): Promise<ReturnType<typeof calculateKbHit>> {
    const sections = ((await this.sql.all(`SELECT s.document_id, s.anchor, s.related_files FROM kb_usage_sections s
       JOIN kb_usage_queries q ON q.id = s.query_id
       WHERE q.ci_run_id = ? AND q.status = 'delivered' ORDER BY q.created_at, s.position`, [runId])) as Array<{ document_id: string; anchor: string; related_files: string }>).map((row) => ({
      documentId: row.document_id, anchor: row.anchor, relatedFiles: parseStringArray(row.related_files)
    }))
    const chunks = ((await this.sql.all(`SELECT chunk FROM ci_run_logs WHERE run_id = ? ORDER BY seq`, [runId])) as Array<{ chunk: string }>).map((row) => row.chunk)
    if (!chunks.length) return null
    const metric = calculateKbHit(sections, filesReadFromCiLog(chunks))
    if (!metric) return null
    await this.sql.run(`INSERT INTO ci_run_kb_metrics (run_id, sections_delivered, sections_hit, hit_ratio, calculated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET sections_delivered = excluded.sections_delivered,
      sections_hit = excluded.sections_hit, hit_ratio = excluded.hit_ratio, calculated_at = excluded.calculated_at`, [runId, metric.sectionsDelivered, metric.sectionsHit, metric.hitRatio, this.now()])
    return metric
  }

  private async ciKbHit(runId: string): Promise<{ sectionsDelivered: number; sectionsHit: number; hitRatio: number } | null> {
    const row = (await this.sql.get(`SELECT sections_delivered, sections_hit, hit_ratio FROM ci_run_kb_metrics WHERE run_id = ?`, [runId])) as
      { sections_delivered: number; sections_hit: number; hit_ratio: number } | undefined
    return row ? { sectionsDelivered: row.sections_delivered, sectionsHit: row.sections_hit, hitRatio: row.hit_ratio } : null
  }

  /**
   * Отчёт по рану: сводка, агрегаты расхода и все шаги с длительностями. Гейт —
   * членство в проекте рана (как у ленты), поэтому чужой получает null → 404.
   * У старых ранов строк расхода нет: шаги и время на месте, расход — нули.
   */
  async ciRunReport(userId: string, runId: string): Promise<CiRunReport | null> {
    const run = await this.getCiRunRaw(runId)
    if (!run || !(await this.repos.projects.isProjectMember(userId, run.projectId))) return null
    return await this.buildCiRunReport(run)
  }

  /**
   * Отчёт по задаче: все её раны (повторы и отмены — тоже расход) и итог по ним.
   * Порядок — от свежего рана к старому, как в списке ранов задачи.
   */
  async ciTaskReport(userId: string, projectId: string, taskId: string): Promise<CiTaskReport | null> {
    if (!(await this.repos.projects.isProjectMember(userId, projectId))) return null
    if (!(await this.sql.get(`SELECT 1 FROM tasks WHERE id = ? AND project_id = ?`, [taskId, projectId]))) return null
    const runs = await Promise.all(((await this.sql.all(`SELECT * FROM ci_runs WHERE task_id = ? AND project_id = ? ORDER BY created_at DESC, rowid DESC`, [taskId, projectId])) as CiRunRow[])
      .map(async (r) => await this.buildCiRunReport(mapCiRun(r))))
    return { projectId, taskId, runs, ...ciTaskTotals(runs) }
  }

  private async buildCiRunReport(run: CiRun): Promise<CiRunReport> {
    const usage = await this.listCiRunUsage(run.id)
    const byStep = new Map<string, CiRunUsage[]>()
    for (const u of usage) {
      if (!u.stepId) continue
      const list = byStep.get(u.stepId) ?? []
      list.push(u)
      byStep.set(u.stepId, list)
    }
    const steps: CiRunReportStep[] = ((await this.sql.all(`SELECT * FROM ci_run_steps WHERE run_id = ? ORDER BY position ASC, id ASC`, [run.id])) as CiRunStepRow[])
      .map(mapCiRunStep)
      .map((s) => ({
        id: s.id, parentStepId: s.parentStepId, title: s.title, slot: s.slot, kind: s.kind,
        initiatedBy: s.initiatedBy, status: s.status, attempt: s.attempt, fixedByModel: s.fixedByModel,
        exitCode: s.exitCode, durationMs: s.durationMs,
        usage: byStep.has(s.id) ? ciUsageTotals(byStep.get(s.id)!) : null
      }))
    const fixAttempts = ((await this.sql.get(`SELECT COUNT(*) AS n FROM ci_fix_attempts f JOIN ci_run_steps s ON s.id = f.run_step_id WHERE s.run_id = ?`, [run.id])) as { n: number }).n
    return {
      runId: run.id, projectId: run.projectId, taskId: run.taskId, status: run.status, mode: run.mode,
      provider: run.llmProvider, model: run.llmModel, startedAt: run.startedAt, finishedAt: run.finishedAt,
      durationMs: run.durationMs, createdAt: run.createdAt, fixAttempts,
      totals: ciUsageTotals(usage), stages: ciUsageStages(usage), steps, kbHit: await this.ciKbHit(run.id),
      toolCalls: await this.ciRunToolCalls(run.id),
      toolChars: await this.ciRunToolChars(run.id),
      toolResponses: await this.ciRunToolResponses(run.id)
    }
  }

  // --- Рабочие директории ---

  async createCiWorkspace(args: { projectId: string; taskId: string; agentId: string | null; path: string; npmCacheDir?: string | null }): Promise<CiWorkspace> {
    const id = this.newId()
    await this.sql.run(`INSERT INTO ci_workspaces (id, project_id, task_id, agent_id, path, npm_cache_dir, state, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`, [id, args.projectId, args.taskId, args.agentId, args.path, args.npmCacheDir ?? null, this.now()])
    return mapCiWorkspace((await this.sql.get(`SELECT * FROM ci_workspaces WHERE id = ?`, [id])) as CiWorkspaceRow)
  }

  async getCiWorkspaceById(id: string): Promise<CiWorkspace | null> {
    const r = (await this.sql.get(`SELECT * FROM ci_workspaces WHERE id = ?`, [id])) as CiWorkspaceRow | undefined
    return r ? mapCiWorkspace(r) : null
  }

  async findActiveCiWorkspace(projectId: string, taskId: string): Promise<CiWorkspace | null> {
    const r = (await this.sql.get(`SELECT * FROM ci_workspaces WHERE project_id = ? AND task_id = ? AND state = 'active' ORDER BY created_at DESC LIMIT 1`, [projectId, taskId])) as CiWorkspaceRow | undefined
    return r ? mapCiWorkspace(r) : null
  }

  async findLatestCiWorkspace(projectId: string, taskId: string): Promise<CiWorkspace | null> {
    const r = (await this.sql.get(`SELECT * FROM ci_workspaces WHERE project_id = ? AND task_id = ? ORDER BY created_at DESC LIMIT 1`, [projectId, taskId])) as CiWorkspaceRow | undefined
    return r ? mapCiWorkspace(r) : null
  }

  /** Последний workspace с отправленной веткой — источник правды merge-рана.
   *  Более новая неотправленная запись (начатый dev-ран) его не заслоняет. */
  async findLatestPushedCiWorkspace(projectId: string, taskId: string): Promise<CiWorkspace | null> {
    const r = (await this.sql.get(`SELECT * FROM ci_workspaces WHERE project_id = ? AND task_id = ? AND pushed = 1 ORDER BY created_at DESC LIMIT 1`, [projectId, taskId])) as CiWorkspaceRow | undefined
    return r ? mapCiWorkspace(r) : null
  }

  async findLatestCiRunForTask(projectId: string, taskId: string): Promise<CiRun | null> {
    const row = (await this.sql.get(`SELECT id FROM ci_runs WHERE project_id=? AND task_id=? ORDER BY created_at DESC LIMIT 1`, [projectId, taskId])) as { id:string } | undefined
    return row ? await this.getCiRunRaw(row.id) : null
  }

  /** Ветка и SHA рабочей копии. `pushed` отдельным аргументом: ручной коммит из
   *  панели кода ещё не отправлен в origin, и merge-ран не должен принять его за
   *  источник (он берёт `findLatestPushedCiWorkspace`). */
  async updateCiWorkspaceRevision(workspaceId: string, branch: string, commitSha: string, pushed: boolean): Promise<void> {
    await this.sql.run(`UPDATE ci_workspaces SET branch=?, commit_sha=?, pushed=? WHERE id=?`, [branch, commitSha, pushed ? 1 : 0, workspaceId])
  }

  async recordCiWorkspaceRevision(workspaceId: string, branch: string, commitSha: string): Promise<void> {
    await this.updateCiWorkspaceRevision(workspaceId, branch, commitSha, true)
  }

  async releaseCiWorkspace(workspaceId: string, releasedByStepId: string | null): Promise<void> {
    await this.sql.run(`UPDATE ci_workspaces SET state = 'released', released_by_step_id = ? WHERE id = ?`, [releasedByStepId, workspaceId])
  }

  /** Отчёт по занятому месту: активные + осиротевшие (задача закрыта/удалена). */
  async listCiWorkspaceReport(userId: string, projectId?: string): Promise<CiWorkspaceReportItem[]> {
    const rows = (projectId
      ? await this.sql.all(`SELECT * FROM ci_workspaces WHERE project_id = ? ORDER BY created_at DESC`, [projectId])
      : await this.sql.all(`SELECT * FROM ci_workspaces ORDER BY created_at DESC`)) as CiWorkspaceRow[]
    const out: CiWorkspaceReportItem[] = []
    for (const r of rows) {
      if (!(await this.repos.projects.isProjectMember(userId, r.project_id))) continue
      const task = (await this.sql.get(`SELECT t.title, c.semantic_type FROM tasks t LEFT JOIN kanban_columns c ON c.id = t.column_id WHERE t.id = ?`, [r.task_id])) as { title: string; semantic_type: string } | undefined
      const taskClosed = !task || task.semantic_type === 'done'
      out.push({ ...mapCiWorkspace(r), taskTitle: task?.title ?? null, orphaned: r.state === 'active' && taskClosed })
    }
    return out
  }

  // --- Предложения модели ---

  async addCiSuggestion(args: { commandId: string; runStepId: string | null; reason: string; proposedScript: string }): Promise<CiCommandSuggestion> {
    // Однотипные (та же команда + та же причина) группируются со счётчиком.
    const existing = (await this.sql.get(`SELECT * FROM ci_command_suggestions WHERE command_id = ? AND reason = ? AND status = 'new'`, [args.commandId, args.reason])) as CiSuggestionRow | undefined
    if (existing) {
      await this.sql.run(`UPDATE ci_command_suggestions SET occurrences = occurrences + 1, proposed_script = ?, run_step_id = ? WHERE id = ?`, [args.proposedScript, args.runStepId, existing.id])
      return mapCiSuggestion((await this.sql.get(`SELECT * FROM ci_command_suggestions WHERE id = ?`, [existing.id])) as CiSuggestionRow)
    }
    const id = this.newId()
    await this.sql.run(`INSERT INTO ci_command_suggestions (id, command_id, run_step_id, reason, proposed_script, status, occurrences, created_at) VALUES (?, ?, ?, ?, ?, 'new', 1, ?)`, [id, args.commandId, args.runStepId, args.reason, args.proposedScript, this.now()])
    return mapCiSuggestion((await this.sql.get(`SELECT * FROM ci_command_suggestions WHERE id = ?`, [id])) as CiSuggestionRow)
  }

  async listCiSuggestions(userId: string, projectId?: string): Promise<CiCommandSuggestion[]> {
    const rows = (await this.sql.all(`SELECT s.* FROM ci_command_suggestions s JOIN ci_commands c ON c.id = s.command_id WHERE s.status = 'new' ORDER BY s.created_at DESC`)) as Array<CiSuggestionRow>
    const visible: CiSuggestionRow[] = []
    for (const s of rows) {
      const c = (await this.sql.get(`SELECT scope, project_id FROM ci_commands WHERE id = ?`, [s.command_id])) as { scope: string; project_id: string | null } | undefined
      if (!c) continue
      if (c.scope === 'global') { visible.push(s); continue }
      if (c.project_id && await this.repos.projects.isProjectMember(userId, c.project_id) && (!projectId || c.project_id === projectId)) visible.push(s)
    }
    return visible.map(mapCiSuggestion)
  }

  async countNewCiSuggestions(commandId: string): Promise<number> {
    const r = (await this.sql.get(`SELECT COUNT(*) AS n FROM ci_command_suggestions WHERE command_id = ? AND status = 'new'`, [commandId])) as { n: number }
    return r.n
  }

  async resolveCiSuggestion(userId: string, id: string, accept: boolean): Promise<CiCommandSuggestion | null> {
    const s = (await this.sql.get(`SELECT * FROM ci_command_suggestions WHERE id = ?`, [id])) as CiSuggestionRow | undefined
    if (!s) return null
    await this.sql.transaction(async () => {
      await this.sql.run(`UPDATE ci_command_suggestions SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`, [accept ? 'accepted' : 'rejected', userId, this.now(), id])
      if (accept) {
        // Принятие создаёт новую версию команды (текст скрипта заменяется).
        await this.sql.run(`UPDATE ci_commands SET script = ?, version = version + 1, updated_at = ? WHERE id = ?`, [s.proposed_script, this.now(), s.command_id])
      }
    })
    return mapCiSuggestion((await this.sql.get(`SELECT * FROM ci_command_suggestions WHERE id = ?`, [id])) as CiSuggestionRow)
  }

  // --- Аудит / история ---

  async addCiEvent(args: { projectId: string; runId?: string | null; commandId?: string | null; type: string; actorType: CiEventActor; actorId?: string | null; payload?: Record<string, unknown> }): Promise<void> {
    await this.sql.run(`INSERT INTO ci_events (id, project_id, run_id, command_id, type, actor_type, actor_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [this.newId(), args.projectId, args.runId ?? null, args.commandId ?? null, args.type, args.actorType, args.actorId ?? null, JSON.stringify(args.payload ?? {}), this.now()])
  }

  // --- Метрики (на лету, окно metrics_window) ---

  async ciCommandMetrics(userId: string, projectId: string): Promise<CiCommandMetric[]> {
    if (!(await this.repos.projects.isProjectMember(userId, projectId))) return []
    const window = (await this.getCiSettings()).metricsWindow
    const cmds = (await this.sql.all(`SELECT DISTINCT command_id FROM ci_run_steps s JOIN ci_runs r ON r.id = s.run_id WHERE r.project_id = ? AND s.command_id IS NOT NULL AND s.kind = 'command'`, [projectId])) as Array<{ command_id: string }>
    const out: CiCommandMetric[] = []
    for (const { command_id } of cmds) {
      const rows = (await this.sql.all(`SELECT s.status, s.duration_ms FROM ci_run_steps s JOIN ci_runs r ON r.id = s.run_id WHERE r.project_id = ? AND s.command_id = ? AND s.kind = 'command' AND s.status IN ('success','failed','timeout') ORDER BY s.finished_at DESC LIMIT ?`, [projectId, command_id, window])) as Array<{ status: string; duration_ms: number | null }>
      if (!rows.length) continue
      const succ = rows.filter((r) => r.status === 'success' && r.duration_ms != null).map((r) => r.duration_ms as number).sort((a, b) => a - b)
      const median = succ.length ? succ[Math.floor((succ.length - 1) / 2)] : null
      const avg = succ.length ? Math.round(succ.reduce((a, b) => a + b, 0) / succ.length) : null
      const p90 = succ.length ? succ[Math.min(succ.length - 1, Math.floor(succ.length * 0.9))] : null
      const successRate = rows.length ? rows.filter((r) => r.status === 'success').length / rows.length : 0
      out.push({ projectId, commandId: command_id, medianMs: median, avgMs: avg, p90Ms: p90, samples: succ.length, successRate })
    }
    return out
  }

  async ciModelWorkMetric(userId: string, projectId: string): Promise<CiModelWorkMetric> {
    if (!(await this.repos.projects.isProjectMember(userId, projectId))) return { projectId, avgMs: null, samples: 0 }
    const rows = (await this.sql.all(`SELECT s.duration_ms FROM ci_run_steps s JOIN ci_runs r ON r.id = s.run_id WHERE r.project_id = ? AND s.kind = 'model_work' AND s.status = 'success' AND s.duration_ms IS NOT NULL ORDER BY s.finished_at DESC LIMIT 10`, [projectId])) as Array<{ duration_ms: number }>
    if (!rows.length) return { projectId, avgMs: null, samples: 0 }
    return { projectId, avgMs: Math.round(rows.reduce((a, r) => a + r.duration_ms, 0) / rows.length), samples: rows.length }
  }

  /**
   * Единый серверный селектор состояния задачи. Активный ран всегда главный.
   * Отмена/skip остаются последней попыткой, но не вытесняют предыдущий успех.
   * Терминальные ошибки и отмены актуальны лишь в колонке, зафиксированной при
   * завершении; ручной перенос немедленно убирает их с поверхностей задачи.
   */
  /**
   * Сводки CI по задачам доски. `scope` (подзапрос с id карточек) обязателен для
   * доски: без него сюда попадали сводки всех задач проекта за всю его историю —
   * на боевом проекте 383 сводки вместо 11 нужных, мегабайт ответа и четыре
   * запроса в БД на каждую лишнюю.
   */
  async latestCiRunSummaries(projectId: string, scope?: { sql: string; args: Record<string, unknown> }): Promise<CiRunSummary[]> {
    const where = scope ? `project_id = @projectId AND task_id IN (${scope.sql})` : `project_id = @projectId`
    const params = { projectId, ...(scope?.args ?? {}) }
    const rows = (await this.sql.all(`SELECT * FROM ci_runs WHERE ${where} ORDER BY created_at DESC, rowid DESC`, [params])) as CiRunRow[]
    const columns = new Map(((await this.sql.all(`SELECT id, column_id FROM tasks WHERE project_id = ?`, [projectId])) as Array<{ id: string; column_id: string }>).map((r) => [r.id, r.column_id]))
    const grouped = new Map<string, CiRunRow[]>()
    for (const row of rows) grouped.set(row.task_id, [...(grouped.get(row.task_id) ?? []), row])
    // История длительностей шагов — свойство проекта, а не рана: считаем её один
    // раз на всю доску. Раньше каждая карточка со своим раном тянула тот же JOIN
    // на 200 строк, и доска проекта с сотней ранов делала сотню таких запросов.
    const history = await this.ciStepDurationHistory(projectId)
    const out: CiRunSummary[] = []
    for (const [taskId, taskRows] of grouped) {
      const summary = await this.taskCiDisplaySummary(taskRows, columns.get(taskId) ?? null, history)
      if (summary) out.push(summary)
    }
    return out
  }

  /** Длительности успешных шагов проекта по названию — база для прогноза прогресса. */
  private async ciStepDurationHistory(projectId: string): Promise<Record<string, number[]>> {
    const rows = (await this.sql.all(`
      SELECT s.title, s.duration_ms
      FROM ci_run_steps s
      JOIN ci_runs r ON r.id = s.run_id
      WHERE r.project_id = ? AND r.status = 'success' AND s.status = 'success'
        AND s.duration_ms IS NOT NULL AND s.duration_ms > 0
      ORDER BY r.finished_at DESC
      LIMIT 200
    `, [projectId])) as Array<{ title: string; duration_ms: number }>
    const history: Record<string, number[]> = {}
    for (const item of rows) (history[item.title] ??= []).push(item.duration_ms)
    return history
  }

  /** Единая отображаемая сводка одной задачи; null — значимого результата нет. */
  /**
   * Сколько событий данного типа записано у рана. Нужно автопроходу: сбой машины
   * лечится повтором с упавшего шага (работа модели уже в рабочей копии), но
   * число таких повторов обязано быть конечным — иначе сломанное окружение
   * крутило бы ран по кругу.
   */
  async countCiEvents(runId: string, type: string): Promise<number> {
    return Number(((await this.sql.get(`SELECT COUNT(*) AS n FROM ci_events WHERE run_id = ? AND type = ?`, [runId, type])) as { n: number }).n)
  }

  /**
   * Сколько последних ранов задачи подряд закончились провалом. Автопроходу это
   * нужно как предохранитель: карточку в development надо подтолкнуть новым
   * раном, но повторять это бесконечно на сломанной задаче нельзя.
   */
  async countTrailingFailedCiRuns(taskId: string): Promise<number> {
    const rows = (await this.sql.all(`SELECT status FROM ci_runs WHERE task_id = ? ORDER BY created_at DESC, rowid DESC`, [taskId])) as Array<{ status: string }>
    let count = 0
    for (const row of rows) {
      if (row.status === 'failed' || row.status === 'timeout') count += 1
      else break
    }
    return count
  }

  /** Когда завершился последний ран задачи: по нему автопроход выдерживает паузу между перезапусками. */
  async lastCiRunFinishedAt(taskId: string): Promise<number | null> {
    const row = (await this.sql.get(`SELECT finished_at FROM ci_runs WHERE task_id = ? AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`, [taskId])) as { finished_at: number } | undefined
    return row?.finished_at ?? null
  }

  async latestCiRunSummary(taskId: string): Promise<CiRunSummary | null> {
    const rows = (await this.sql.all(`SELECT * FROM ci_runs WHERE task_id = ? ORDER BY created_at DESC, rowid DESC`, [taskId])) as CiRunRow[]
    const task = (await this.sql.get(`SELECT column_id FROM tasks WHERE id = ?`, [taskId])) as { column_id: string } | undefined
    return await this.taskCiDisplaySummary(rows, task?.column_id ?? null)
  }

  private async taskCiDisplaySummary(rows: CiRunRow[], currentColumnId: string | null, history?: Record<string, number[]>): Promise<CiRunSummary | null> {
    const active = rows.find((row) => ['queued', 'running', 'awaiting_input'].includes(row.status))
    if (active) return await this.ciRunSummary(active, history)
    const latest = rows[0]
    const relevant = (row: CiRunRow): boolean =>
      row.status === 'success' || (row.terminal_column_id != null && row.terminal_column_id === currentColumnId)
    let primary = rows.find((row) => relevant(row) && row.status !== 'cancelled' && row.status !== 'skipped')
    if (!primary && latest && relevant(latest)) primary = latest
    if (!primary) return null
    const summary = await this.ciRunSummary(primary, history)
    if (latest && relevant(latest) && latest.id !== primary.id && (latest.status === 'cancelled' || latest.status === 'skipped')) {
      summary.latestAttempt = await this.ciRunSummary(latest, history)
    }
    return summary
  }

  /** `history` передаётся, когда сводок много: считать её на каждый ран незачем. */
  private async ciRunSummary(row: CiRunRow, history?: Record<string, number[]>): Promise<CiRunSummary> {
    const run = mapCiRun(row)
    const stepRows = (await this.sql.all(`SELECT * FROM ci_run_steps WHERE run_id = ? ORDER BY position ASC, id ASC`, [row.id])) as CiRunStepRow[]
    const steps = stepRows.map(mapCiRunStep)
    const modelActive = run.status === 'running' && steps.some((step) => step.kind === 'model_work' && step.status === 'running')
    const stepHistory = history ?? await this.ciStepDurationHistory(row.project_id)
    return {
      id: run.id,
      taskId: run.taskId,
      status: run.status,
      error: run.error,
      slotProgress: run.slotProgress,
      durationMs: run.durationMs,
      modelActive,
      awaitingInput: run.status === 'awaiting_input',
      progress: buildCiAutomationProgress(run, steps, stepHistory),
      executionLlm: this.ciExecutionLlm(run, await this.listCiStageRuns(run.id)),
      terminalColumnId: run.terminalColumnId
    }
  }

  mapComponentQaRun(row: Record<string, unknown>): ComponentQaRun {
    const status = row.status as ComponentQaRun['status']
    return {
      id:String(row.id), projectId:String(row.project_id), taskId:String(row.task_id),
      developmentRunId:String(row.development_run_id), linkedFixRunId:row.linked_fix_run_id as string|null,
      branch:String(row.branch), commitSha:String(row.commit_sha), attempt:Number(row.attempt), status,
      uiImpact:row.ui_impact as ComponentQaRun['uiImpact'], readinessRunId:String(row.readiness_run_id),
      readinessVersion:String(row.readiness_version),
      scenarios:parseJsonValue<ComponentQaScenarioSnapshot[]>(String(row.scenarios_json ?? '[]'), []),
      components:parseJsonValue(String(row.components_json ?? '[]'), []),
      commands:parseJsonValue<ComponentQaCommandResult[]>(String(row.commands_json ?? '[]'), []),
      artifacts:parseJsonValue<ComponentQaArtifact[]>(String(row.artifacts_json ?? '[]'), []),
      failureClassification:row.failure_classification as ComponentQaRun['failureClassification'],
      blockerReasons:parseStringArray(String(row.blocker_reasons_json ?? '[]')), summary:String(row.summary ?? ''),
      log:String(row.log ?? ''), storybookUrl:row.storybook_url as string|null, createdAt:Number(row.created_at),
      startedAt:row.started_at == null ? null : Number(row.started_at), finishedAt:row.finished_at == null ? null : Number(row.finished_at),
      staleReason:row.stale_reason as string|null, canCancel:status === 'queued' || status === 'running',
      canRetry:['failed','blocked','cancelled','stale'].includes(status)
    }
  }

  async getComponentQaRun(userId: string, runId: string): Promise<ComponentQaRun | null> {
    const row = (await this.sql.get(`SELECT r.* FROM component_qa_runs r JOIN project_members m ON m.project_id=r.project_id WHERE r.id=? AND m.username=?`, [runId, userId])) as Record<string,unknown>|undefined
    return row ? this.mapComponentQaRun(row) : null
  }

  async startComponentQaRun(userId: string, projectId: string, taskId: string): Promise<ComponentQaRun> {
    if (!(await this.repos.projects.canQa(userId,projectId))) throw new Error('QA permission required')
    return await this.sql.transaction(async ()=>{
      const task=(await this.sql.get(`SELECT c.semantic_type FROM tasks t JOIN kanban_columns c ON c.id=t.column_id WHERE t.id=? AND t.project_id=?`, [taskId, projectId])) as {semantic_type:string}|undefined
      if (!task) throw new Error('task not found')
      if (task.semantic_type!=='component_qa') throw new Error('task must be in component_qa')
      const workspace=await this.findLatestPushedCiWorkspace(projectId,taskId)
      if (!workspace?.branch || !workspace.commitSha || !workspace.agentId || !workspace.path) throw new Error('missing current development workspace')
      const dev=(await this.sql.get(`SELECT id FROM ci_runs WHERE project_id=? AND task_id=? AND workspace_id=? AND status='success' ORDER BY created_at DESC LIMIT 1`, [projectId, taskId, workspace.id])) as {id:string}|undefined
      if (!dev) throw new Error('successful development run not found')
      const prep=(await this.sql.get(`SELECT id,readiness_json FROM task_preparation_runs WHERE task_id=? AND status='success' AND readiness_json IS NOT NULL ORDER BY created_at DESC LIMIT 1`, [taskId])) as {id:string;readiness_json:string}|undefined
      if (!prep) throw new Error('missing readiness snapshot')
      const readiness=parseJsonValue<DevelopmentReadiness|null>(prep.readiness_json,null)
      if (!readiness || !readiness.uiImpact) throw new Error('missing readiness snapshot')
      await this.sql.run(`UPDATE component_qa_runs SET status='stale',stale_reason='development_sha_changed',finished_at=? WHERE task_id=? AND commit_sha<>? AND status IN ('queued','running')`, [this.now(), taskId, workspace.commitSha])
      const version=componentQaSemanticVersion(readiness)
      await this.sql.run(`UPDATE component_qa_runs SET status='stale',stale_reason='scenario_version_changed',finished_at=? WHERE task_id=? AND readiness_version<>? AND status IN ('queued','running')`, [this.now(), taskId, version])
      const active=(await this.sql.get(`SELECT * FROM component_qa_runs WHERE task_id=? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1`, [taskId])) as Record<string,unknown>|undefined
      if (active) return this.mapComponentQaRun(active)
      const reasons=componentQaLaunchReasons(readiness)
      const attempt=Number(((await this.sql.get(`SELECT COALESCE(MAX(attempt),0)+1 AS n FROM component_qa_runs WHERE task_id=?`, [taskId])) as {n:number}).n)
      const id=this.newId(), now=this.now()
      const componentCases=readiness.testCases.filter((item)=>item.testType==='ui'||item.testType==='automated'||item.testType==='mixed')
      const scenarios:ComponentQaScenarioSnapshot[]=componentCases.map((testCase)=>({testCase,version:1,semanticHash:version,status:'pending',actualResult:'',diagnostic:''}))
      const status:ComponentQaRun['status']=readiness.uiImpact==='none'?'skipped':reasons.length?'blocked':'queued'
      await this.sql.run(`INSERT INTO component_qa_runs (id,project_id,task_id,development_run_id,branch,commit_sha,attempt,status,ui_impact,readiness_run_id,readiness_version,scenarios_json,components_json,blocker_reasons_json,summary,created_at,finished_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id, projectId, taskId, dev.id, workspace.branch, workspace.commitSha, attempt, status, readiness.uiImpact, prep.id, version, JSON.stringify(scenarios), JSON.stringify(readiness.affectedComponents), JSON.stringify(reasons), readiness.uiImpact==='none'?'Component QA не применим: uiImpact=none':reasons.length?'Component QA заблокирован обязательными входными данными':'', now, status==='queued'?null:now])
      if (status==='skipped') {
        const target=await this.repos.projects.getColumnIdBySemantic(projectId,'integration_tests')
        if (!target || !canTransitionWorkflow('component_qa','integration_tests','automation')) throw new Error('integration_tests transition unavailable')
        await this.repos.tasks.moveTask(userId,projectId,taskId,{columnId:target})
      }
      return (await this.getComponentQaRun(userId,id))!
    })
  }

  async componentQaExecutionContext(runId:string):Promise<CiStageExecutionContext|null> {
    const row=(await this.sql.get(`SELECT w.agent_id,w.path,w.npm_cache_dir,p.test_command,p.component_qa_command,p.ci_base_branch FROM component_qa_runs r JOIN ci_runs d ON d.id=r.development_run_id JOIN ci_workspaces w ON w.id=d.workspace_id JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.status='queued' AND w.commit_sha=r.commit_sha AND w.pushed=1`, [runId])) as {agent_id:string|null;path:string;npm_cache_dir:string|null;test_command:string|null;component_qa_command:string|null;ci_base_branch:string|null}|undefined
    if (!row?.agent_id||!row.path) return null
    return {agentId:row.agent_id,workdir:row.path,npmCacheDir:row.npm_cache_dir,commands:testStages(row.component_qa_command?.trim()||row.test_command||'',['npm run test:storybook']),ciBaseBranch:row.ci_base_branch?.trim()||'main'}
  }

  async markComponentQaRunning(id:string):Promise<void> {
    await this.sql.run(`UPDATE component_qa_runs SET status='running',started_at=COALESCE(started_at,?) WHERE id=? AND status='queued'`, [this.now(), id])
  }

  async appendComponentQaLog(id:string,stream:'stdout'|'stderr',chunk:string):Promise<void> {
    const prefix=stream==='stderr'?'[stderr] ':''
    await this.sql.run(`UPDATE component_qa_runs SET log=substr(log || ?, -500000) WHERE id=? AND status='running'`, [prefix+chunk, id])
  }

  async finishComponentQaRun(userId:string,runId:string,input:{status:'passed'|'failed'|'blocked';scenarios:ComponentQaScenarioSnapshot[];commands:ComponentQaCommandResult[];artifacts?:ComponentQaArtifact[];summary:string;storybookUrl?:string|null;failureClassification?:ComponentQaRun['failureClassification'];blockerReasons?:string[]}):Promise<ComponentQaRun> {
    const run=await this.getComponentQaRun(userId,runId)
    if (!run || run.status!=='running') throw new Error('component QA run is not running')
    await this.sql.run(`UPDATE component_qa_runs SET status=?,scenarios_json=?,commands_json=?,artifacts_json=?,summary=?,storybook_url=?,failure_classification=?,blocker_reasons_json=?,finished_at=? WHERE id=? AND status='running'`, [input.status, JSON.stringify(input.scenarios), JSON.stringify(input.commands), JSON.stringify(input.artifacts??[]), input.summary, input.storybookUrl??null, input.failureClassification??null, JSON.stringify(input.blockerReasons??[]), this.now(), runId])
    return (await this.getComponentQaRun(userId,runId))!
  }

  async cancelComponentQaRun(userId:string,runId:string):Promise<ComponentQaRun> {
    const run=await this.getComponentQaRun(userId,runId)
    if (!run) throw new Error('component QA run not found')
    if (!(await this.repos.projects.canQa(userId,run.projectId))) throw new Error('QA permission required')
    await this.sql.run(`UPDATE component_qa_runs SET status='cancelled',summary='Component QA отменён пользователем',finished_at=? WHERE id=? AND status IN ('queued','running')`, [this.now(), runId])
    return (await this.getComponentQaRun(userId,runId))!
  }

  async linkComponentQaFixRun(userId:string,runId:string,fixRunId:string):Promise<ComponentQaRun> {
    const run=await this.getComponentQaRun(userId,runId)
    if (!run||!(await this.repos.projects.canQa(userId,run.projectId))) throw new Error('QA permission required')
    await this.sql.run(`UPDATE component_qa_runs SET status='failed',linked_fix_run_id=?,failure_classification='implementation_defect',finished_at=COALESCE(finished_at,?) WHERE id=?`, [fixRunId, this.now(), runId])
    return (await this.getComponentQaRun(userId,runId))!
  }

  async failInterruptedComponentQaRuns():Promise<string[]> {
    const rows=(await this.sql.all(`SELECT id FROM component_qa_runs WHERE status IN ('queued','running')`)) as Array<{id:string}>
    await this.sql.run(`UPDATE component_qa_runs SET status='blocked',failure_classification='infrastructure',blocker_reasons_json='["server_restarted"]',summary='Component QA прерван перезапуском сервера',finished_at=? WHERE status IN ('queued','running')`, [this.now()])
    return rows.map((row)=>row.id)
  }

  // ============== Создание интеграционных автотестов =================
  private mapIntegrationTestRun(row:Record<string,unknown>):IntegrationTestRun {
    const status=row.status as IntegrationTestRun['status']
    return {
      id:String(row.id),projectId:String(row.project_id),taskId:String(row.task_id),
      developmentRunId:row.development_run_id==null?'':String(row.development_run_id),linkedFixRunId:row.linked_fix_run_id as string|null,
      branch:String(row.branch),commitSha:String(row.commit_sha),attempt:Number(row.attempt),status,
      readinessRunId:String(row.readiness_run_id),snapshotVersion:String(row.snapshot_version),
      testCases:parseJsonValue(String(row.test_cases_json??'[]'),[]),automationLinks:parseJsonValue(String(row.automation_links_json??'[]'),[]),
      commands:parseJsonValue<IntegrationTestCommandResult[]>(String(row.commands_json??'[]'),[]),
      log:String(row.log??''),failureClassification:row.failure_classification as IntegrationTestRun['failureClassification'],
      failureReason:row.failure_reason as string|null,blockerReasons:parseStringArray(String(row.blocker_reasons_json??'[]')),
      summary:String(row.summary??''),createdAt:Number(row.created_at),startedAt:row.started_at==null?null:Number(row.started_at),
      finishedAt:row.finished_at==null?null:Number(row.finished_at),staleReason:row.stale_reason as IntegrationTestRun['staleReason'],
      canCancel:status==='queued'||status==='running',canRetry:['failed','blocked','cancelled','stale'].includes(status)
    }
  }

  async getIntegrationTestRun(userId:string,runId:string):Promise<IntegrationTestRun|null> {
    const row=(await this.sql.get(`SELECT r.* FROM integration_test_runs r JOIN project_members m ON m.project_id=r.project_id WHERE r.id=? AND m.username=?`, [runId, userId])) as Record<string,unknown>|undefined
    return row?this.mapIntegrationTestRun(row):null
  }

  async getIntegrationTestTaskState(userId:string,projectId:string,taskId:string):Promise<IntegrationTestTaskState|null> {
    if(!(await this.repos.projects.isProjectMember(userId,projectId))) return null
    const input=await this.repos.tasks.currentIntegrationInputs(projectId,taskId)
    if(!input.task) return null
    const allRuns=((await this.sql.all(`SELECT * FROM integration_test_runs WHERE task_id=? ORDER BY attempt DESC,created_at DESC`, [taskId])) as Record<string,unknown>[]).map((row)=>this.mapIntegrationTestRun(row))
    const activeRun=allRuns.find((run)=>run.status==='queued'||run.status==='running')??null
    const latestRun=allRuns[0]??null
    // Историческим попыткам оставляем только хвост лога: полный текст каждой
    // делал ответ многомегабайтным, и клиент с сервером ложились вместе.
    const runs=trimHistoricalRunLogs(allRuns,[activeRun?.id,latestRun?.id])
    const reasons:string[]=[]
    if(input.task.semantic_type!=='integration_tests') reasons.push('task_not_in_integration_tests')
    if(!input.workspace?.branch||!input.workspace.commitSha||!input.workspace.agentId||!input.workspace.path||!input.workspace.pushed) reasons.push('missing_pushed_development_workspace')
    if(!input.dev) reasons.push('successful_development_run_not_found')
    if(!input.prep||!input.readiness) reasons.push('missing_readiness_snapshot')
    const cases=input.readiness?.testCases??[]
    const gate=latestRun&&input.workspace?.commitSha&&input.readiness?integrationTestGate(latestRun,input.workspace.commitSha,cases):{allowed:false,reasons:['integration_test_run_missing']}
    return {activeRun,latestRun,runs,testCases:cases,launchReasons:reasons,canStart:!activeRun&&reasons.length===0,canComplete:gate.allowed,gateReasons:gate.reasons}
  }

  async startIntegrationTestRun(userId:string,projectId:string,taskId:string):Promise<IntegrationTestRun> {
    if(!(await this.repos.projects.canQa(userId,projectId))) throw new Error('QA permission required')
    return await this.sql.transaction(async ()=>{
      const input=await this.repos.tasks.currentIntegrationInputs(projectId,taskId)
      const reasons:string[]=[]
      if(!input.task) throw new Error('task not found')
      if(input.task.semantic_type!=='integration_tests') reasons.push('task_not_in_integration_tests')
      if(!input.workspace?.branch||!input.workspace.commitSha||!input.workspace.agentId||!input.workspace.path||!input.workspace.pushed) reasons.push('missing_pushed_development_workspace')
      if(!input.dev) reasons.push('successful_development_run_not_found')
      if(!input.prep||!input.readiness) reasons.push('missing_readiness_snapshot')
      const currentSha=input.workspace?.commitSha??''
      const cases=input.readiness?.testCases??[]
      const version=integrationTestSemanticVersion(cases)
      const ts=this.now()
      await this.sql.run(`UPDATE integration_test_runs SET status='stale',stale_reason='sha_changed',finished_at=? WHERE task_id=? AND commit_sha<>? AND status IN ('queued','running','passed','failed','blocked','cancelled','skipped')`, [ts, taskId, currentSha])
      await this.sql.run(`UPDATE integration_test_runs SET status='stale',stale_reason='snapshot_changed',finished_at=? WHERE task_id=? AND snapshot_version<>? AND status IN ('queued','running','passed','failed','blocked','cancelled','skipped')`, [ts, taskId, version])
      const active=(await this.sql.get(`SELECT * FROM integration_test_runs WHERE task_id=? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1`, [taskId])) as Record<string,unknown>|undefined
      if(active) return this.mapIntegrationTestRun(active)
      const requiredAutomatable=cases.filter((item)=>item.required&&item.automatable)
      const invalidExcluded=cases.filter((item)=>item.required&&!item.automatable&&(!item.notAutomatedReason.trim()||!item.alternativeManualVerification.trim()))
      const skipped=reasons.length===0&&requiredAutomatable.length===0&&invalidExcluded.length===0
      const status:IntegrationTestRun['status']=skipped?'skipped':reasons.length?'blocked':'queued'
      const attempt=Number(((await this.sql.get(`SELECT COALESCE(MAX(attempt),0)+1 n FROM integration_test_runs WHERE task_id=?`, [taskId])) as {n:number}).n)
      const id=this.newId()
      await this.sql.run(`INSERT INTO integration_test_runs (id,project_id,task_id,development_run_id,branch,commit_sha,attempt,status,readiness_run_id,snapshot_version,test_cases_json,blocker_reasons_json,summary,created_at,finished_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id, projectId, taskId, input.dev?.id??null, input.workspace?.branch??'', currentSha, attempt, status, input.prep?.id??'', version, JSON.stringify(cases), JSON.stringify(reasons), skipped?'Нет обязательных automatable-кейсов':reasons.length?'Запуск заблокирован предусловиями':'', ts, status==='queued'?null:ts])
      if(skipped){
        const target=await this.repos.projects.getColumnIdBySemantic(projectId,'automated_qa')
        if(!target||!canTransitionWorkflow('integration_tests','automated_qa','automation')) throw new Error('automated_qa transition unavailable')
        await this.repos.tasks.moveTask(userId,projectId,taskId,{columnId:target})
      }
      return (await this.getIntegrationTestRun(userId,id))!
    })
  }

  async integrationTestExecutionContext(runId:string):Promise<CiStageExecutionContext|null> {
    const row=(await this.sql.get(`SELECT w.agent_id,w.path,w.npm_cache_dir,p.test_command,p.integration_test_command,p.ci_base_branch FROM integration_test_runs r JOIN ci_runs d ON d.id=r.development_run_id JOIN ci_workspaces w ON w.id=d.workspace_id JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.status='queued' AND w.commit_sha=r.commit_sha AND w.pushed=1`, [runId])) as {agent_id:string|null;path:string;npm_cache_dir:string|null;test_command:string|null;integration_test_command:string|null;ci_base_branch:string|null}|undefined
    return row?.agent_id&&row.path?{agentId:row.agent_id,workdir:row.path,npmCacheDir:row.npm_cache_dir,commands:testStages(row.integration_test_command?.trim()||row.test_command||'',['npm run affected-check']),ciBaseBranch:row.ci_base_branch?.trim()||'main'}:null
  }

  async markIntegrationTestRunning(id:string):Promise<void> { await this.sql.run(`UPDATE integration_test_runs SET status='running',started_at=COALESCE(started_at,?) WHERE id=? AND status='queued'`, [this.now(), id]) }

  async appendIntegrationTestLog(id:string,chunk:string):Promise<void> { await this.sql.run(`UPDATE integration_test_runs SET log=substr(log||?,-500000) WHERE id=? AND status='running'`, [chunk, id]) }

  async finishIntegrationTestRun(userId:string,runId:string,input:{status:'passed'|'failed'|'blocked';commands:IntegrationTestCommandResult[];summary:string;failureClassification?:IntegrationTestRun['failureClassification'];failureReason?:string|null;blockerReasons?:string[]}):Promise<IntegrationTestRun> {
    const run=await this.getIntegrationTestRun(userId,runId)
    if(!run||run.status!=='running') throw new Error('integration test run is not running')
    await this.sql.run(`UPDATE integration_test_runs SET status=?,commands_json=?,summary=?,failure_classification=?,failure_reason=?,blocker_reasons_json=?,finished_at=? WHERE id=? AND status='running'`, [input.status, JSON.stringify(input.commands), input.summary, input.failureClassification??null, input.failureReason??null, JSON.stringify(input.blockerReasons??[]), this.now(), runId])
    return (await this.getIntegrationTestRun(userId,runId))!
  }

  async recordIntegrationAutomationLinks(userId:string,runId:string,links:Array<{testId:string;path:string}>,commitSha:string):Promise<IntegrationTestRun> {
    const run=await this.getIntegrationTestRun(userId,runId)
    if(!run||run.status!=='running') throw new Error('integration test run is not running')
    const readiness=await this.repos.tasks.preparationReadiness(run.readinessRunId)
    if(!readiness) throw new Error('readiness snapshot missing')
    const now=this.now(), created=links.map((item)=>({testId:item.testId,path:item.path,updatedAt:now,commitSha}))
    readiness.testCases=readiness.testCases.map((testCase)=>({...testCase,automationLinks:[...testCase.automationLinks.filter((link)=>link.commitSha!==commitSha),...created.filter((link)=>link.testId===testCase.id)]}))
    await this.repos.tasks.savePreparationReadiness(run.readinessRunId,readiness)
    await this.sql.run(`UPDATE integration_test_runs SET commit_sha=?,test_cases_json=?,automation_links_json=? WHERE id=?`, [commitSha, JSON.stringify(readiness.testCases), JSON.stringify(created), runId])
    await this.sql.run(`UPDATE ci_workspaces SET commit_sha=? WHERE id=(SELECT workspace_id FROM ci_runs WHERE id=?)`, [commitSha, run.developmentRunId])
    return (await this.getIntegrationTestRun(userId,runId))!
  }

  async completeIntegrationTestRun(userId:string,projectId:string,taskId:string,runId:string):Promise<IntegrationTestRun> {
    if(!(await this.repos.projects.canQa(userId,projectId))) throw new Error('QA permission required')
    return await this.sql.transaction(async ()=>{
      const run=await this.getIntegrationTestRun(userId,runId),input=await this.repos.tasks.currentIntegrationInputs(projectId,taskId)
      if(!run||run.taskId!==taskId||!input.workspace?.commitSha||!input.readiness) throw new Error('integration test state incomplete')
      const gate=integrationTestGate(run,input.workspace.commitSha,input.readiness.testCases)
      if(!gate.allowed) throw new Error(`integration test gate incomplete: ${gate.reasons.join(', ')}`)
      if(input.task?.semantic_type!=='integration_tests'||!canTransitionWorkflow('integration_tests','automated_qa','automation')) throw new Error('workflow transition conflict')
      const target=await this.repos.projects.getColumnIdBySemantic(projectId,'automated_qa')
      if(!target) throw new Error('automated_qa column not found')
      await this.repos.tasks.moveTask(userId,projectId,taskId,{columnId:target})
      return run
    })
  }

  async cancelIntegrationTestRun(userId:string,runId:string):Promise<IntegrationTestRun> {
    const run=await this.getIntegrationTestRun(userId,runId)
    if(!run||!(await this.repos.projects.canQa(userId,run.projectId))) throw new Error('QA permission required')
    await this.sql.run(`UPDATE integration_test_runs SET status='cancelled',summary='Ран отменён пользователем',finished_at=? WHERE id=? AND status IN ('queued','running')`, [this.now(), runId])
    return (await this.getIntegrationTestRun(userId,runId))!
  }

  async linkIntegrationTestFixRun(userId:string,runId:string,fixRunId:string):Promise<IntegrationTestRun> {
    const run=await this.getIntegrationTestRun(userId,runId)
    if(!run||!(await this.repos.projects.canQa(userId,run.projectId))) throw new Error('QA permission required')
    await this.sql.run(`UPDATE integration_test_runs SET linked_fix_run_id=? WHERE id=? AND linked_fix_run_id IS NULL`, [fixRunId, runId])
    return (await this.getIntegrationTestRun(userId,runId))!
  }

  async failInterruptedIntegrationTestRuns():Promise<string[]> {
    const rows=(await this.sql.all(`SELECT id FROM integration_test_runs WHERE status IN ('queued','running')`)) as Array<{id:string}>
    await this.sql.run(`UPDATE integration_test_runs SET status='blocked',failure_classification='infrastructure',failure_reason='server_restarted',blocker_reasons_json='["server_restarted"]',summary='Ран прерван перезапуском сервера',finished_at=? WHERE status IN ('queued','running')`, [this.now()])
    return rows.map((row)=>row.id)
  }

  /**
   * Идемпотентно создаёт отдельный merge-ран и в той же SQLite-транзакции
   * переводит карточку в системную колонку merge. Все значения ветки/машины
   * берутся из серверных записей, а не из тела HTTP-запроса.
   */
  async startMergeRun(userId: string, projectId: string, taskId: string, agentIdOverride?: string | null, llmOverride?: { provider?: LlmProvider; model?: string }): Promise<MergeRun> {
    return await this.sql.transaction(async () => {
      const existing = (await this.sql.get(`SELECT * FROM merge_runs WHERE task_id=? AND status IN ('queued','checking','fetching','merging','resolving_conflicts','kb_update','testing','pushing') ORDER BY created_at DESC LIMIT 1`, [taskId])) as Record<string, unknown> | undefined
      if (existing) return await this.mapMergeRun(existing)

      const row = (await this.sql.get(`SELECT t.*, c.semantic_type, p.ci_base_branch, p.default_agent_id, pm.role
        FROM tasks t JOIN kanban_columns c ON c.id=t.column_id JOIN projects p ON p.id=t.project_id
        JOIN project_members pm ON pm.project_id=p.id AND pm.username=?
        WHERE t.id=? AND t.project_id=?`, [userId, taskId, projectId])) as (TaskRow & { semantic_type: string; ci_base_branch: string; default_agent_id: string | null; role: string }) | undefined
      if (!row) throw new Error('task not found')
      if (row.semantic_type !== 'awaiting_merge' && row.semantic_type !== 'merge') throw new Error('task must be in awaiting_merge or merge')
      if ((row.ci_base_branch || 'main') !== 'main') throw new Error('merge target must be main')

      const workspace = (await this.sql.get(`SELECT branch,commit_sha,agent_id FROM ci_workspaces WHERE task_id=? AND project_id=? AND pushed=1 AND branch IS NOT NULL ORDER BY created_at DESC LIMIT 1`, [taskId, projectId])) as { branch: string; commit_sha: string | null; agent_id: string | null } | undefined
      if (!workspace?.branch || !workspace.commit_sha || !/^(?!-)(?!.*\.\.)(?!.*[~^:?*\\[\\]\\\\])[A-Za-z0-9._/-]+$/.test(workspace.branch)) throw new Error('prepared task branch or pushed source SHA not found')
      const agentId = agentIdOverride ?? workspace.agent_id
      if (!agentId || !(await this.repos.machines.canUseAgent(userId, agentId, projectId))) throw new Error(agentIdOverride ? 'merge machine is not available to user or project' : 'prepared workspace machine is not available to user or project')
      if (agentId !== workspace.agent_id && !(await this.repos.machines.getProjectMachine(projectId, agentId))) throw new Error('selected merge machine has no project repository settings')
      if (!(await this.sql.get(`SELECT id FROM kanban_columns WHERE project_id=? AND semantic_type='merge'`, [projectId]))) throw new Error('merge column not found')

      const settings = await this.repos.settings.getSettings(userId)
      const globalLlm = await this.ciLlmDefaultsForUser(userId)
      const development = await this.findLatestCiRunForTask(projectId, taskId)
      const stageLlm = await this.resolveTaskStageLlmConfig(projectId, taskId, 'kb_update', development
        ? { llmEngineId: development.llmEngineId ?? null, provider: development.llmProvider, model: development.llmModel }
        : { llmEngineId: globalLlm.llmEngineId ?? null, provider: globalLlm.provider, model: globalLlm.model })
      const requestedProvider = llmOverride?.provider ?? stageLlm.provider
      const requestedModel = (llmOverride?.model ?? stageLlm.model ?? '').trim()
      const access = await this.repos.identity.getUserLlmAccess(userId)
      const provider = isProviderAllowed(access, requestedProvider) ? requestedProvider : firstAllowedProvider(access)
      if (!provider) throw new Error('Нет доступных движков и моделей для merge-рана')
      const providerDefaultModel = provider === 'codex'
        ? (settings.codexModel.trim() || DEFAULT_CODEX_MODEL)
        : (settings.model.trim() && settings.model !== 'default' ? settings.model.trim() : DEFAULT_CI_CLAUDE_MODEL)
      const modelCandidate = provider === requestedProvider && requestedModel && requestedModel !== 'default' ? requestedModel : providerDefaultModel
      const model = clampModel(access, provider, modelCandidate)
      if (!model) throw new Error('Нет доступных моделей для merge-рана')
      const fallbackReason = provider !== requestedProvider ? 'provider_unavailable' : model !== modelCandidate ? 'model_unavailable' : null
      const role = (await this.repos.identity.getUser(userId))?.role ?? 'developer'
      const engine = await this.repos.llm.resolveLlmEngine(stageLlm.llmEngineId ?? settings.llmEngineId, provider, role)

      const id = this.newId(), now = this.now()
      await this.sql.run(`INSERT INTO merge_runs (id,project_id,task_id,status,triggered_by,source_branch,target_branch,source_sha,agent_id,llm_engine_id,llm_provider,llm_model,requested_llm_provider,requested_llm_model,llm_fallback_reason,stage,started_at,created_at,log)
        VALUES (?,?,?,'queued',?,?,'main',?,?,?,?,?,?,?,?,'queued',?,?,?)`, [id, projectId, taskId, userId, workspace.branch, workspace.commit_sha, agentId, engine.engine?.id ?? null, provider, model, requestedProvider, requestedModel || null, fallbackReason, now, now, `[${new Date(now).toISOString()}] merge requested by ${userId}\\n`])
      await this.repos.tasks.placeTaskInSemanticColumn(projectId, taskId, 'merge', now)
      return await this.mapMergeRun((await this.sql.get(`SELECT * FROM merge_runs WHERE id=?`, [id])) as Record<string, unknown>)
    })
  }

  async getMergeRun(userId: string, runId: string): Promise<MergeRun | null> {
    const row = (await this.sql.get(`SELECT r.* FROM merge_runs r JOIN project_members m ON m.project_id=r.project_id AND m.username=? WHERE r.id=?`, [userId, runId])) as Record<string, unknown> | undefined
    return row ? await this.mapMergeRun(row) : null
  }

  async getMergeRunRaw(runId: string): Promise<MergeRun | null> {
    const row = (await this.sql.get(`SELECT * FROM merge_runs WHERE id=?`, [runId])) as Record<string, unknown> | undefined
    return row ? await this.mapMergeRun(row) : null
  }

  async listActiveMergeRuns(): Promise<MergeRun[]> {
    return await Promise.all(((await this.sql.all(`SELECT * FROM merge_runs WHERE status IN ('queued','checking','fetching','merging','resolving_conflicts','kb_update','testing','pushing') ORDER BY created_at`)) as Record<string, unknown>[]).map(async (row) => await this.mapMergeRun(row)))
  }

  async updateMergeRun(runId: string, fields: Partial<Pick<MergeRun, 'status' | 'stage' | 'sourceSha' | 'targetSha' | 'mergeSha' | 'conflicts' | 'stages' | 'checks' | 'error' | 'recommendedAction' | 'log' | 'pushStartedAt' | 'startedAt' | 'finishedAt' | 'deployId' | 'deployVersion' | 'productionStatus' | 'llmEngineId' | 'llmProvider' | 'llmModel'>>): Promise<MergeRun | null> {
    const names: Record<string, string> = { sourceSha:'source_sha', targetSha:'target_sha', mergeSha:'merge_sha', conflicts:'conflicts_json', stages:'stages_json', checks:'checks_json', recommendedAction:'recommended_action', pushStartedAt:'push_started_at', startedAt:'started_at', finishedAt:'finished_at', deployId:'deploy_id', deployVersion:'deploy_version', productionStatus:'production_status', llmEngineId:'llm_engine_id', llmProvider:'llm_provider', llmModel:'llm_model' }
    const set: string[] = [], values: unknown[] = []
    for (const [key, value] of Object.entries(fields)) {
      set.push(`${names[key] ?? key}=?`)
      values.push(key === 'conflicts' || key === 'stages' || key === 'checks' ? JSON.stringify(value) : value)
    }
    if (!set.length) return await this.getMergeRunRaw(runId)
    await this.sql.run(`UPDATE merge_runs SET ${set.join(',')} WHERE id=?`, [...values, runId])
    return await this.getMergeRunRaw(runId)
  }

  async appendMergeLog(runId: string, chunk: string): Promise<MergeRun | null> {
    await this.sql.run(`UPDATE merge_runs SET log=log || ? WHERE id=?`, [chunk, runId])
    return await this.getMergeRunRaw(runId)
  }

  async retryMergeRun(userId: string, runId: string, agentIdOverride?: string | null, unpin?: boolean): Promise<MergeRun> {
    const previous = await this.getMergeRun(userId, runId)
    if (!previous) throw new Error('merge run not found')
    if (ACTIVE_MERGE_STATUSES.includes(previous.status)) return previous
    // Retry is an explicit user decision: failed/cancelled runs already stay in
    // merge, while decision_required returns there before creating the next run.
    await this.repos.tasks.moveMergeTask(previous.projectId, previous.taskId, 'merge')
    const next = await this.startMergeRun(userId, previous.projectId, previous.taskId, agentIdOverride ?? previous.agentId, {
      provider: previous.requestedLlmProvider ?? previous.llmProvider,
      model: previous.requestedLlmModel ?? previous.llmModel
    })
    if (unpin || previous.conflicts.length > 0 || /stale source/i.test(previous.error ?? '')) return await this.updateMergeRun(next.id, { sourceSha: null }) ?? next
    return next
  }

  /**
   * Сколько последних merge-ранов задачи подряд закончились провалом. Нужен
   * автопроходу: карточку в колонке merge надо подтолкнуть новым раном, но
   * повторять это бесконечно на сломанном окружении нельзя.
   */
  async countTrailingFailedMergeRuns(taskId: string): Promise<number> {
    const rows = (await this.sql.all(`SELECT status FROM merge_runs WHERE task_id = ? ORDER BY created_at DESC`, [taskId])) as Array<{ status: string }>
    let count = 0
    for (const row of rows) {
      if (row.status === 'failed' || row.status === 'timeout') count += 1
      else break
    }
    return count
  }

  /** Когда завершился последний merge-ран задачи: по нему выдерживается пауза между попытками. */
  async lastMergeRunFinishedAt(taskId: string): Promise<number | null> {
    const row = (await this.sql.get(`SELECT finished_at FROM merge_runs WHERE task_id = ? AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`, [taskId])) as { finished_at: number } | undefined
    return row?.finished_at ?? null
  }

  async listMergeRuns(userId: string, projectId: string, taskId: string, limit = 20): Promise<MergeRun[]> {
    if (!(await this.repos.projects.isProjectMember(userId, projectId))) return []
    return await Promise.all(((await this.sql.all(`SELECT * FROM merge_runs WHERE task_id=? AND project_id=? ORDER BY created_at DESC LIMIT ?`, [taskId, projectId, limit])) as Record<string, unknown>[]).map(async (row) => await this.mapMergeRun(row)))
  }

  private async mapMergeRun(r: Record<string, unknown>): Promise<MergeRun> {
    return {
      id: String(r.id), projectId: String(r.project_id), taskId: String(r.task_id), status: r.status as MergeRun['status'],
      triggeredBy: String(r.triggered_by), sourceBranch: String(r.source_branch), targetBranch: 'main',
      sourceSha: r.source_sha as string | null, targetSha: r.target_sha as string | null, mergeSha: r.merge_sha as string | null,
      revertSha: r.revert_sha as string | null, agentId: String(r.agent_id), llmEngineId: r.llm_engine_id as string | null,
      llmProvider: r.llm_provider as MergeRun['llmProvider'], llmModel: String(r.llm_model ?? ''),
      requestedLlmProvider: r.requested_llm_provider == null ? null : r.requested_llm_provider as MergeRun['llmProvider'],
      requestedLlmModel: r.requested_llm_model == null ? null : String(r.requested_llm_model),
      llmFallbackReason: r.llm_fallback_reason == null ? null : r.llm_fallback_reason as MergeRun['llmFallbackReason'],
      stage: String(r.stage) as MergeRun['stage'],
      stages: parseJsonValue(r.stages_json as string, []), conflicts: parseStringArray(r.conflicts_json as string),
      conflictDetails: parseStringArray(r.conflicts_json as string).map((path) => ({ path })), checks: parseJsonValue(r.checks_json as string, []),
      deployId: r.deploy_id as string | null, deployVersion: r.deploy_version as string | null,
      productionStatus: r.production_status as string | null, error: r.error as string | null, recommendedAction: r.recommended_action as string | null,
      log: String(r.log ?? ''), canCancel: !r.push_started_at && ACTIVE_MERGE_STATUSES.includes(r.status as MergeRun['status']),
      canRetry: !ACTIVE_MERGE_STATUSES.includes(r.status as MergeRun['status']) && r.status !== 'success', pushStartedAt: r.push_started_at as number | null,
      startedAt: r.started_at as number | null, finishedAt: r.finished_at as number | null, createdAt: Number(r.created_at), machineName: await this.repos.machines.agentName(String(r.agent_id))
    }
  }

  /** Существующие раны CI — для уборки файлов, которые каскад БД не трогает. */
  async ciRunIds(): Promise<Set<string>> {
    return new Set(((await this.sql.all(`SELECT id FROM ci_runs`)) as Array<{ id: string }>).map((row) => row.id))
  }

  /** Машина удаляется: активные и nullable-привязки теряют её, история ран сохраняется (зовётся из machines.deleteAgent). */
  async detachAgent(agentId: string): Promise<void> {
    await this.sql.run(`UPDATE ci_workspaces SET agent_id = NULL WHERE agent_id = ?`, [agentId])
    await this.sql.run(`UPDATE ci_runs SET agent_id = NULL WHERE agent_id = ?`, [agentId])
    await this.sql.run(`UPDATE ci_test_runs SET agent_id = NULL WHERE agent_id = ?`, [agentId])
  }
}
