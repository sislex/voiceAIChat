// Домен «ci»: таблицы ci_commands, ci_slot_commands, ci_command_suggestions, ci_events, ci_fix_attempts, ci_gate_results, ci_interactions, ci_llm_configs, ci_stage_llm_configs, ci_run_kb_gaps, ci_run_kb_metrics, ci_run_logs, ci_run_steps, ci_run_tool_calls, ci_run_tool_responses, ci_run_usage, ci_runs, ci_settings, ci_stage_runs, ci_task_browser_checks, ci_task_process_stages, ci_test_events, ci_test_fix_cycles, ci_test_fix_decisions, ci_test_fix_targeted_runs, ci_test_fix_task_state, ci_test_group_configs, ci_test_group_runs, ci_test_runs, ci_test_targeted_runs, ci_workspaces, merge_runs, integration_test_runs, component_qa_runs.
// Файл получен разрезанием бывшего VoiceChatDb (apps/server/src/db/database.ts) по владению таблицами;
// карта владения — ./ownership.ts, правила — docs/plans/db-repositories.md.
import { type KbContextMode, type CiBrowserCheck, DEFAULT_CI_BROWSER_CHECK, normalizeCiBrowserCheck, type CiLlmConfig, DEFAULT_CI_CLAUDE_MODEL, CI_KB_UPDATE_COMMAND_ID, CI_KB_UPDATE_COMMAND_NAME, DEFAULT_CI_LLM_CONFIG, type CiRunMode, type CiClarifyLevel, type CiInteraction, type CiInteractionKind, type CiInteractionStatus, type QuestionSpec, type CiGlobalSettings, DEFAULT_CI_GLOBAL_SETTINGS, type CiRun, type CiRunDetail, type CiExecutionLlmSnapshot, type CiStageRun, type CiRunStep, type CiStatus, type CiStepKind, type CiInitiatedBy, type CiSlotProgress, type CiLogLine, type CiFixAttempt, type CiFixDiagnosticContext, type CiTargetedTestRun, type CiTestFailure, type CiWorkspace, type CiWorkspaceReportItem, type CiRunSummary, type CiEventActor, type CiRunUsage, type CiUsageKind, type CiInputSemantics, ciUsageTotals, normCiStageModels, buildCiAutomationProgress } from '@voicechat/shared'
import { BaseRepo } from './base.js'
import { normCiStatus, normKbContextMode, normRunMode, normClarifyLevel, clampClarifyMax, parseJsonValue, mapCiRun, type CiRunRow } from './support.js'

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

function isMergeToBaseStepLike(name: string, script: string): boolean {
  return /влить.*(ветк|прод)|merge.*(main|base)/i.test(name)
    || (/git\s+merge/i.test(script) && /git\s+push/i.test(script))
}

function isProductionDeployStepLike(name: string, script: string): boolean {
  return /обновить.*прод|production.*deploy|prod.*rebuild/i.test(name)
    || /PROD_DIR|rebuild-when-idle|production_deploy/i.test(script)
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

export class CiRepo extends BaseRepo {

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

  /** Браузерная проверка задачи; нет строки — режим «без браузера». */
  async getTaskBrowserCheck(taskId: string): Promise<CiBrowserCheck> {
    const row = (await this.sql.get(`SELECT check_json FROM ci_task_browser_checks WHERE task_id = ?`, [taskId])) as { check_json: string } | undefined
    if (!row) return { ...DEFAULT_CI_BROWSER_CHECK }
    try { return normalizeCiBrowserCheck(JSON.parse(row.check_json)) } catch { return { ...DEFAULT_CI_BROWSER_CHECK } }
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

  // --- Лог (потоковый, с монотонным seq для реплея) ---

  async appendCiLog(runId: string, stepId: string, stream: 'stdout' | 'stderr' | 'system', chunk: string): Promise<CiLogLine> {
    const at = this.now()
    const row = (await this.sql.get(`SELECT COALESCE(MAX(seq), 0) AS m FROM ci_run_logs WHERE run_id = ?`, [runId])) as { m: number }
    const seq = row.m + 1
    await this.sql.run(`INSERT INTO ci_run_logs (id, run_id, step_id, seq, stream, chunk, at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [this.newId(), runId, stepId, seq, stream, chunk, at])
    return { runId, stepId, seq, stream, chunk, at }
  }

  async listCiInteractions(runId: string): Promise<CiInteraction[]> {
    return ((await this.sql.all(`SELECT * FROM ci_interactions WHERE run_id = ? ORDER BY seq ASC`, [runId])) as CiInteractionRow[]).map(mapCiInteraction)
  }

  /** Строки расхода рана (в порядке ходов). Гейта нет: зовётся из отчётов. */
  async listCiRunUsage(runId: string): Promise<CiRunUsage[]> {
    return ((await this.sql.all(`SELECT * FROM ci_run_usage WHERE run_id = ? ORDER BY at ASC, rowid ASC`, [runId])) as CiRunUsageRow[]).map(mapCiRunUsage)
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

  /** Последний workspace с отправленной веткой — источник правды merge-рана.
   *  Более новая неотправленная запись (начатый dev-ран) его не заслоняет. */
  async findLatestPushedCiWorkspace(projectId: string, taskId: string): Promise<CiWorkspace | null> {
    const r = (await this.sql.get(`SELECT * FROM ci_workspaces WHERE project_id = ? AND task_id = ? AND pushed = 1 ORDER BY created_at DESC LIMIT 1`, [projectId, taskId])) as CiWorkspaceRow | undefined
    return r ? mapCiWorkspace(r) : null
  }

  /** Ветка и SHA рабочей копии. `pushed` отдельным аргументом: ручной коммит из
   *  панели кода ещё не отправлен в origin, и merge-ран не должен принять его за
   *  источник (он берёт `findLatestPushedCiWorkspace`). */
  async updateCiWorkspaceRevision(workspaceId: string, branch: string, commitSha: string, pushed: boolean): Promise<void> {
    await this.sql.run(`UPDATE ci_workspaces SET branch=?, commit_sha=?, pushed=? WHERE id=?`, [branch, commitSha, pushed ? 1 : 0, workspaceId])
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

  // --- Аудит / история ---

  async addCiEvent(args: { projectId: string; runId?: string | null; commandId?: string | null; type: string; actorType: CiEventActor; actorId?: string | null; payload?: Record<string, unknown> }): Promise<void> {
    await this.sql.run(`INSERT INTO ci_events (id, project_id, run_id, command_id, type, actor_type, actor_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [this.newId(), args.projectId, args.runId ?? null, args.commandId ?? null, args.type, args.actorType, args.actorId ?? null, JSON.stringify(args.payload ?? {}), this.now()])
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
