// Test-only writers for rows that production Core never writes itself: Kanban owns the
// CI/QA/release/board workflow and writes these shared tables from its own process. Tests
// still need such rows to exercise Core readers, so the former repository writers live here.
// Each helper runs exactly like a port call (waits for `db.ready`, enters the port lane) and
// uses the same SQL adapter, so it works on SQLite and Postgres alike.
import {
  DEFAULT_CI_CLAUDE_MODEL,
  DEFAULT_RELEASE_TIMEOUTS,
  RELEASE_STEP_ORDER,
  parseApplicationEnvironment,
  parseEnvironmentId,
  releaseFailureSummary,
  releaseStepLimit,
  validateReleaseTimeouts,
  type AutomatedQaMode,
  type AutomatedQaScenario,
  type CiClarifyLevel,
  type CiFixDiagnosticContext,
  type CiLlmConfig,
  type CiRun,
  type CiRunMode,
  type CiSlotProgress,
  type CiStatus,
  type EnvironmentDefinition,
  type EnvironmentState,
  type KanbanColumn,
  type KbContextMode,
  type ProjectCommandPolicy,
  type ProjectDetail,
  type ProjectRelease,
  type ProjectTestUser,
  type ReleaseStepKind,
  type ReleaseTimeouts,
  type Task,
  type TaskPriority,
  type WorkItemDefaultSkills,
  type WorkItemType
} from '@voicechat/shared'
import type { Lane } from '@sislexa/identity/storage-sql/lane'
import type { VoiceChatDb } from '../db/database.js'
import type { RepoContext } from '../db/repos/base.js'
import { RANK_STEP, clampClarifyMax, mapCiRun, mapColumn, normClarifyLevel, normKbContextMode, normRunMode, normalizeAutomatedQaScenario, type CiRunRow } from '../db/repos/support.js'
import { normPriority } from '../db/repos/tasks.js'

/** Private repository helpers that the seed writers reuse (they stay in production for live callers). */
interface ProjectsInternals {
  auditProjectMemberRole(projectId: string, actor: string, targetUser: string, oldRole: 'owner' | 'member' | null, newRole: 'owner' | 'member' | null, action: 'add' | 'role_change' | 'remove', createdAt: number): Promise<void>
}
interface TasksInternals {
  validateTaskAgent(userId: string, projectId: string, agentId: string | null | undefined): Promise<string | null>
}
interface EnvironmentsInternals {
  requireMember(userId: string, projectId: string): Promise<void>
}
interface ReleasesInternals {
  releaseRow(id: string): Promise<{ id: string; project_id: string; branch: string; version: string; attempt: number } | undefined>
}

/** Run `fn` the way a port call runs: after schema setup and inside the port lane. */
async function withCtx<T>(db: VoiceChatDb, fn: (ctx: RepoContext) => Promise<T>): Promise<T> {
  await db.ready
  const { ctx, lane } = db as unknown as { ctx: RepoContext; lane: Lane | null }
  return lane ? lane.run(() => fn(ctx)) : fn(ctx)
}

// --- ci ---

export function setCiLlmConfig(db: VoiceChatDb, ownerType: 'project' | 'task', ownerId: string, config: CiLlmConfig): Promise<CiLlmConfig> {
  return withCtx(db, async ({ sql }) => {
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
    await sql.run(`INSERT INTO ci_llm_configs (owner_type, owner_id, llm_engine_id, provider, model, mode, clarify_level, clarify_max)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_type, owner_id) DO UPDATE SET llm_engine_id=excluded.llm_engine_id, provider=excluded.provider, model=excluded.model,
           mode=excluded.mode, clarify_level=excluded.clarify_level, clarify_max=excluded.clarify_max`, [ownerType, ownerId, next.llmEngineId, next.provider, next.model, next.mode, next.clarifyLevel, next.clarifyMax])
    return next
  })
}

export function createCiRun(db: VoiceChatDb, args: { projectId: string; taskId: string; agentId: string | null; agentOwnerId?: string | null; agentOwnerName?: string; agentSelectionSource?: 'explicit' | 'explicit_bypass' | 'task_pinned' | 'project_default' | 'user_project_default' | 'fallback' | 'unknown'; triggeredBy: string; prevColumnId: string | null; runColumnId?: string | null; slotProgress: CiSlotProgress; llmEngineId?: string | null; llmProvider?: 'claude' | 'codex'; llmModel?: string; mode?: CiRunMode; clarifyLevel?: CiClarifyLevel; clarifyMax?: number; conversationId?: string | null; kbContextMode?: KbContextMode }): Promise<CiRun> {
  return withCtx(db, async ({ sql, newId, now }) => {
    const id = newId()
    const ts = now()
    await sql.run(`INSERT INTO ci_runs (id, project_id, task_id, agent_id, agent_owner_id, agent_owner_name, agent_selection_source, status, triggered_by, prev_column_id, run_column_id, llm_engine_id, llm_provider, llm_model, mode, clarify_level, clarify_max, conversation_id, kb_context_mode, slot_progress_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, args.projectId, args.taskId, args.agentId, args.agentOwnerId ?? null, args.agentOwnerName ?? 'неизвестно', args.agentSelectionSource ?? 'unknown', args.triggeredBy, args.prevColumnId, args.runColumnId ?? null, args.llmEngineId ?? null, args.llmProvider ?? 'claude', args.llmModel ?? DEFAULT_CI_CLAUDE_MODEL, normRunMode(args.mode), normClarifyLevel(args.clarifyLevel), clampClarifyMax(args.clarifyMax), args.conversationId ?? null, normKbContextMode(args.kbContextMode), JSON.stringify(args.slotProgress), ts])
    return mapCiRun((await sql.get(`SELECT * FROM ci_runs WHERE id = ?`, [id])) as CiRunRow)
  })
}

export function updateCiRun(db: VoiceChatDb, runId: string, patch: { status?: CiStatus; error?: string | null; runColumnId?: string | null; terminalColumnId?: string | null; agentId?: string | null; agentSelectionSource?: CiRun['agentSelectionSource']; workspaceId?: string | null; startedAt?: number; finishedAt?: number; durationMs?: number; slotProgress?: CiSlotProgress; llmEngineId?: string | null; llmProvider?: 'claude' | 'codex'; llmModel?: string; mode?: CiRunMode; conversationId?: string | null; modelSessionId?: string | null; fixContext?: CiFixDiagnosticContext | null }): Promise<CiRun | null> {
  return withCtx(db, async ({ sql, repos }) => {
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
    if (!set.length) return await repos.ci.getCiRunRaw(runId)
    await sql.run(`UPDATE ci_runs SET ${set.join(', ')} WHERE id = ?`, [...vals, runId])
    return await repos.ci.getCiRunRaw(runId)
  })
}

// --- projects ---

export function transferTenant(db: VoiceChatDb, userId: string, projectId: string, currentTenantId: string, targetTenantId: string, targetTenantKind: 'personal' | 'team'): Promise<ProjectDetail | null> {
  return withCtx(db, async ({ sql, now, repos }) => {
    if (!(await repos.projects.isProjectOwner(userId, projectId))) return null
    return sql.transaction(async () => {
      const changed = await sql.run('UPDATE projects SET tenant_id = ?, tenant_kind = ?, updated_at = ? WHERE id = ? AND tenant_id = ?', [targetTenantId, targetTenantKind, now(), projectId, currentTenantId])
      if (changed.changes !== 1) return null
      await repos.chat.moveProjectToTenant(projectId, targetTenantId)
      return repos.projects.getProject(userId, projectId, targetTenantId, targetTenantKind)
    })
  })
}

export function updateProject(
  db: VoiceChatDb,
  userId: string,
  id: string,
  fields: {
    name?: string
    description?: string
    gitUrl?: string | null
    previewUrl?: string | null
    testUsers?: ProjectTestUser[]
    technologies?: string[]
    skills?: string[]
    defaultSkills?: Partial<WorkItemDefaultSkills>
    commitPolicy?: 'agent_commits' | 'final_system_commit' | 'manual_user_confirmation'
    mergeTransport?: 'local' | 'github_pull_request'
    agentPlanApprovalMode?: 'manual' | 'automatic'
    testCommand?: string
    mergeTestCommand?: string
    componentQaCommand?: string
    integrationTestCommand?: string
    automatedQaCommand?: string
    automatedQaMode?: AutomatedQaMode
    automatedQaScenarios?: AutomatedQaScenario[]
    autoPilotDefault?: boolean
    autoPilotRequiresManualQa?: boolean
    autoPilotFixLimit?: number
    commandPolicy?: ProjectCommandPolicy
    productionDeployCommand?: string
    productionAgentId?: string | null
    productionEnvironmentMode?: 'legacy' | 'managed'
    productionCheckoutPath?: string
    productionHealthCheckCommand?: string
    releaseTimeouts?: ReleaseTimeouts
    ciBaseBranch?: string
    ciBranchTemplate?: string
    ciReuseStrategy?: 'reuse' | 'clean' | 'fail'
    ciExecAuthRef?: string
    ciKbContextMode?: KbContextMode
    ciTestFixCycleLimit?: number
    doneRetentionDays?: number | null
    typeId?: string
  }
): Promise<ProjectDetail | null> {
  return withCtx(db, async ({ sql, now, repos }) => {
    if (!(await repos.projects.isProjectOwner(userId, id))) return null
    const set: string[] = []
    const vals: unknown[] = []
    if (fields.typeId !== undefined) {
      // Only live capabilities change: board, tags and CI settings stay a snapshot of the creation defaults.
      if (!(await repos.projects.getProjectType(fields.typeId))) throw new Error('Тип проекта не найден')
      set.push('project_type_id = ?')
      vals.push(fields.typeId)
    }
    if (fields.name !== undefined) { set.push('name = ?'); vals.push(fields.name) }
    if (fields.description !== undefined) { set.push('description = ?'); vals.push(fields.description) }
    if (fields.gitUrl !== undefined) { set.push('git_url = ?'); vals.push(fields.gitUrl) }
    if (fields.previewUrl !== undefined) { set.push('preview_url = ?'); vals.push(fields.previewUrl) }
    if (fields.testUsers !== undefined) { set.push('test_users_json = ?'); vals.push(JSON.stringify(fields.testUsers)) }
    if (fields.technologies !== undefined) { set.push('technologies = ?'); vals.push(JSON.stringify(fields.technologies)) }
    if (fields.skills !== undefined) { set.push('skills = ?'); vals.push(JSON.stringify(fields.skills)) }
    if (fields.commitPolicy !== undefined) { set.push('commit_policy = ?'); vals.push(fields.commitPolicy) }
    if (fields.mergeTransport !== undefined) { set.push('merge_transport = ?'); vals.push(fields.mergeTransport) }
    if (fields.agentPlanApprovalMode !== undefined) { set.push('agent_plan_approval_mode = ?'); vals.push(fields.agentPlanApprovalMode) }
    if (fields.testCommand !== undefined) { set.push('test_command = ?'); vals.push(fields.testCommand) }
    if (fields.mergeTestCommand !== undefined) { set.push('merge_test_command = ?'); vals.push(fields.mergeTestCommand) }
    if (fields.componentQaCommand !== undefined) { set.push('component_qa_command = ?'); vals.push(fields.componentQaCommand) }
    if (fields.integrationTestCommand !== undefined) { set.push('integration_test_command = ?'); vals.push(fields.integrationTestCommand) }
    if (fields.automatedQaCommand !== undefined) { set.push('automated_qa_command = ?'); vals.push(fields.automatedQaCommand.trim() || 'npm test') }
    if (fields.automatedQaMode !== undefined) { set.push('automated_qa_mode = ?'); vals.push(fields.automatedQaMode === 'playwright' ? 'playwright' : 'command') }
    if (fields.automatedQaScenarios !== undefined) { set.push('automated_qa_scenario_json = ?'); vals.push(JSON.stringify(fields.automatedQaScenarios.map(normalizeAutomatedQaScenario))) }
    if (fields.autoPilotDefault !== undefined) { set.push('autopilot_default = ?'); vals.push(fields.autoPilotDefault ? 1 : 0) }
    if (fields.autoPilotRequiresManualQa !== undefined) { set.push('autopilot_requires_manual_qa = ?'); vals.push(fields.autoPilotRequiresManualQa ? 1 : 0) }
    if (fields.autoPilotFixLimit !== undefined) {
      if (!Number.isInteger(fields.autoPilotFixLimit) || fields.autoPilotFixLimit < 0) throw new Error('autoPilotFixLimit must be a non-negative integer')
      set.push('autopilot_fix_limit = ?'); vals.push(fields.autoPilotFixLimit)
    }
    if (fields.commandPolicy !== undefined) { set.push('command_policy = ?'); vals.push(JSON.stringify(fields.commandPolicy)) }
    if (fields.productionDeployCommand !== undefined) { set.push('production_deploy_command = ?'); vals.push(fields.productionDeployCommand) }
    if (fields.productionAgentId !== undefined) { set.push('production_agent_id = ?'); vals.push(fields.productionAgentId) }
    if (fields.productionEnvironmentMode !== undefined) { set.push('production_environment_mode = ?'); vals.push(fields.productionEnvironmentMode) }
    if (fields.productionCheckoutPath !== undefined) { set.push('production_checkout_path = ?'); vals.push(fields.productionCheckoutPath) }
    if (fields.productionHealthCheckCommand !== undefined) { set.push('production_health_check_command = ?'); vals.push(fields.productionHealthCheckCommand) }
    if (fields.releaseTimeouts !== undefined) { set.push('release_timeouts_json = ?'); vals.push(JSON.stringify(validateReleaseTimeouts(fields.releaseTimeouts))) }
    if (fields.ciBaseBranch !== undefined) { set.push('ci_base_branch = ?'); vals.push(fields.ciBaseBranch) }
    if (fields.ciBranchTemplate !== undefined) { set.push('ci_branch_template = ?'); vals.push(fields.ciBranchTemplate) }
    if (fields.ciReuseStrategy !== undefined) { set.push('ci_reuse_strategy = ?'); vals.push(fields.ciReuseStrategy) }
    if (fields.ciExecAuthRef !== undefined) { set.push('ci_exec_auth_ref = ?'); vals.push(fields.ciExecAuthRef) }
    if (fields.ciKbContextMode !== undefined) { set.push('ci_kb_context_mode = ?'); vals.push(normKbContextMode(fields.ciKbContextMode)) }
    if (fields.ciTestFixCycleLimit !== undefined) {
      if (!Number.isInteger(fields.ciTestFixCycleLimit) || fields.ciTestFixCycleLimit < 0) throw new Error('ciTestFixCycleLimit must be a non-negative integer')
      set.push('ci_test_fix_cycle_limit = ?'); vals.push(fields.ciTestFixCycleLimit)
    }
    if (fields.doneRetentionDays !== undefined) { set.push('done_retention_days = ?'); vals.push(fields.doneRetentionDays) }
    if (fields.defaultSkills?.epic !== undefined) { set.push('default_skills_epic = ?'); vals.push(JSON.stringify(fields.defaultSkills.epic)) }
    if (fields.defaultSkills?.story !== undefined) { set.push('default_skills_story = ?'); vals.push(JSON.stringify(fields.defaultSkills.story)) }
    if (fields.defaultSkills?.task !== undefined) { set.push('default_skills_task = ?'); vals.push(JSON.stringify(fields.defaultSkills.task)) }
    set.push('updated_at = ?')
    vals.push(now())
    await sql.run(`UPDATE projects SET ${set.join(', ')} WHERE id = ?`, [...vals, id])
    return await repos.projects.getProject(userId, id)
  })
}

export function addMember(db: VoiceChatDb, userId: string, id: string, username: string): Promise<ProjectDetail | null> {
  return withCtx(db, async ({ sql, now, repos }) => {
    if (!(await repos.projects.isProjectOwner(userId, id))) return null
    if (!(await sql.get(`SELECT 1 FROM users WHERE name = ?`, [username]))) {
      throw new Error(`Пользователь ${username} не найден`)
    }
    const ts = now()
    const inserted = await sql.run(`INSERT OR IGNORE INTO project_members (project_id, username, role, added_at) VALUES (?, ?, 'member', ?)`, [id, username, ts])
    if (inserted.changes) await (repos.projects as unknown as ProjectsInternals).auditProjectMemberRole(id, userId, username, null, 'member', 'add', ts)
    return await repos.projects.getProject(userId, id)
  })
}

export function updateMemberRole(db: VoiceChatDb, userId: string, id: string, username: string, role: 'owner' | 'member'): Promise<ProjectDetail | null> {
  return withCtx(db, async ({ sql, now, repos }) => {
    if (!(await repos.projects.isProjectOwner(userId, id))) return null
    // Adapter transactions run one at a time, so two concurrent demotions cannot both see a stale owner count.
    await sql.transaction(async () => {
      const row = (await sql.get(`SELECT role FROM project_members WHERE project_id = ? AND username = ?`, [id, username])) as { role: string } | undefined
      if (!row) throw new Error('Сначала добавьте пользователя в участники проекта')
      const oldRole = row.role === 'owner' ? 'owner' : 'member'
      if (oldRole === role) return
      if (oldRole === 'owner') {
        const owners = (await sql.get(`SELECT COUNT(*) AS count FROM project_members WHERE project_id = ? AND role = 'owner'`, [id])) as { count: number }
        if (owners.count <= 1) {
          throw new Error('Нельзя понизить последнего владельца. Сначала назначьте другого владельца')
        }
      }
      const ts = now()
      await sql.run(`UPDATE project_members SET role = ? WHERE project_id = ? AND username = ?`, [role, id, username])
      await (repos.projects as unknown as ProjectsInternals).auditProjectMemberRole(id, userId, username, oldRole, role, 'role_change', ts)
      await repos.projects.touchProject(id, ts)
    })
    return await repos.projects.getProject(userId, id)
  })
}

/** Set the project default machine (owner only; the machine must belong to the project). */
export function setProjectDefaultMachine(db: VoiceChatDb, userId: string, id: string, agentId: string): Promise<ProjectDetail | null> {
  return withCtx(db, async ({ sql, repos }) => {
    if (!(await repos.projects.isProjectOwner(userId, id))) return null
    const inProject = await sql.get(`SELECT 1 FROM project_machines WHERE project_id = ? AND agent_id = ?`, [id, agentId])
    if (!inProject) throw new Error('Машина не привязана к проекту')
    await sql.run(`UPDATE projects SET default_agent_id = ? WHERE id = ?`, [agentId, id])
    await repos.projects.touchProject(id)
    return await repos.projects.getProject(userId, id)
  })
}

export function createColumn(db: VoiceChatDb, userId: string, projectId: string, name: string): Promise<KanbanColumn | null> {
  return withCtx(db, async ({ sql, newId, now, repos }) => {
    if (!(await repos.projects.isProjectMember(userId, projectId))) return null
    const id = newId()
    const ts = now()
    const max = ((await sql.get(`SELECT MAX(position) AS m FROM kanban_columns WHERE project_id = ?`, [projectId])) as { m: number | null }).m
    const position = (max ?? 0) + RANK_STEP
    await sql.run(`INSERT INTO kanban_columns (id, project_id, name, position, hidden, created_at) VALUES (?, ?, ?, ?, 0, ?)`, [id, projectId, name, position, ts])
    await repos.projects.touchProject(projectId, ts)
    return mapColumn({ id, project_id: projectId, name, semantic_type: 'custom', position, hidden: 0, wip_limit: null, created_at: ts })
  })
}

// --- tasks ---

export function updateTask(
  db: VoiceChatDb,
  userId: string,
  projectId: string,
  taskId: string,
  fields: { title?: string; description?: string; acceptanceCriteria?: string; type?: WorkItemType; parentId?: string | null; priority?: TaskPriority; assignee?: string | null; agentId?: string | null; labels?: string[]; skills?: string[]; storyPoints?: number | null; dueDate?: number | null; flagged?: boolean; autoPilot?: boolean; autoPilotRequiresManualQa?: boolean }
): Promise<Task | null> {
  return withCtx(db, async ({ sql, newId, now, repos }) => {
    const tasks = repos.tasks
    if (!(await repos.projects.isProjectMember(userId, projectId))) return null
    const current = await tasks.getTask(projectId, taskId)
    if (!current) return null
    if (fields.assignee != null && !(await repos.projects.isActiveProjectMember(fields.assignee, projectId))) {
      throw new Error('Исполнитель должен быть активным участником проекта')
    }
    if (fields.agentId !== undefined) await (tasks as unknown as TasksInternals).validateTaskAgent(userId, projectId, fields.agentId)
    const nextType = fields.type ?? current.type
    const nextParentId = fields.parentId === undefined ? current.parentId : fields.parentId
    if (nextParentId === taskId) throw new Error('Элемент не может быть своим родителем')
    const nextParent = nextParentId ? await tasks.getTask(projectId, nextParentId) : null
    if (nextType === 'epic' && nextParentId) throw new Error('Эпик не может иметь родителя')
    if (nextParentId && !nextParent) throw new Error('Родитель не найден в проекте')
    if (nextType === 'story' && nextParent?.type !== 'epic') throw new Error('Родителем истории может быть только эпик')
    if (nextType === 'task' && nextParent && nextParent.type !== 'story' && nextParent.type !== 'epic') throw new Error('Недопустимый родитель задачи')
    let ancestor = nextParent
    while (ancestor) {
      if (ancestor.id === taskId) throw new Error('Циклическая иерархия')
      ancestor = ancestor.parentId ? await tasks.getTask(projectId, ancestor.parentId) : null
    }
    const set: string[] = []
    const vals: unknown[] = []
    if (fields.title !== undefined) { set.push('title = ?'); vals.push(fields.title) }
    if (fields.description !== undefined) { set.push('description = ?'); vals.push(fields.description) }
    if (fields.acceptanceCriteria !== undefined) { set.push('acceptance_criteria = ?'); vals.push(fields.acceptanceCriteria) }
    if (fields.type !== undefined) { set.push('type = ?'); vals.push(fields.type) }
    if (fields.parentId !== undefined) { set.push('parent_id = ?'); vals.push(fields.parentId) }
    if (fields.priority !== undefined) { set.push('priority = ?'); vals.push(normPriority(fields.priority)) }
    if (fields.assignee !== undefined) { set.push('assignee = ?'); vals.push(fields.assignee) }
    if (fields.agentId !== undefined) { set.push('agent_id = ?'); vals.push(fields.agentId) }
    if (fields.labels !== undefined) { set.push('labels = ?'); vals.push(JSON.stringify(fields.labels.map((l) => l.trim()).filter(Boolean))) }
    if (fields.skills !== undefined) { set.push('skills = ?'); vals.push(JSON.stringify(fields.skills.map((s) => s.trim()).filter(Boolean))) }
    if (fields.storyPoints !== undefined) { set.push('story_points = ?'); vals.push(fields.storyPoints != null && fields.storyPoints >= 0 ? fields.storyPoints : null) }
    if (fields.dueDate !== undefined) { set.push('due_date = ?'); vals.push(fields.dueDate) }
    if (fields.flagged !== undefined) { set.push('flagged = ?'); vals.push(fields.flagged ? 1 : 0) }
    if (fields.autoPilot !== undefined) {
      if (typeof fields.autoPilot !== 'boolean') throw new Error('autoPilot must be a boolean')
      set.push('auto_pilot = ?'); vals.push(fields.autoPilot ? 1 : 0)
    }
    if (fields.autoPilotRequiresManualQa !== undefined) {
      if (typeof fields.autoPilotRequiresManualQa !== 'boolean') throw new Error('autoPilotRequiresManualQa must be a boolean')
      set.push('auto_pilot_requires_manual_qa = ?'); vals.push(fields.autoPilotRequiresManualQa ? 1 : 0)
    }
    if (!set.length) return current
    const ts = now()
    set.push('updated_at = ?')
    vals.push(ts)
    await sql.run(`UPDATE tasks SET ${set.join(', ')} WHERE id = ? AND project_id = ?`, [...vals, taskId, projectId])
    // Activity history (Jira-like): record only human-visible fields that actually changed.
    const norm = (value: unknown): string | null => {
      if (value === undefined || value === null) return null
      if (Array.isArray(value)) return value.length ? value.join(', ') : null
      const text = String(value).trim()
      return text === '' ? null : text
    }
    const watched: Array<[string, unknown, unknown]> = [
      ['title', current.title, fields.title],
      ['description', current.description, fields.description],
      ['acceptanceCriteria', current.acceptanceCriteria, fields.acceptanceCriteria],
      ['priority', current.priority, fields.priority],
      ['assignee', current.assignee, fields.assignee],
      ['storyPoints', current.storyPoints, fields.storyPoints],
      ['dueDate', current.dueDate, fields.dueDate],
      ['labels', current.labels, fields.labels],
      ['skills', current.skills, fields.skills],
      ['type', current.type, fields.type],
      ['flagged', current.flagged, fields.flagged]
    ]
    const insert = sql.prepare(`INSERT INTO task_history (id, project_id, task_id, actor, via, field, from_value, to_value, at) VALUES (?,?,?,?,?,?,?,?,?)`)
    for (const [field, was, next] of watched) {
      if (next === undefined) continue
      const fromValue = norm(was)
      const toValue = norm(next)
      if (fromValue === toValue) continue
      await insert.run(newId(), projectId, taskId, userId, 'user', field, fromValue, toValue, ts)
    }
    await repos.projects.touchProject(projectId, ts)
    return await tasks.getTask(projectId, taskId)
  })
}

export function deleteTask(db: VoiceChatDb, userId: string, projectId: string, taskId: string): Promise<boolean> {
  return withCtx(db, async ({ sql, repos }) => {
    if (!(await repos.projects.isProjectMember(userId, projectId))) return false
    let changes = 0
    await sql.transaction(async () => {
      changes = (await sql.run(`DELETE FROM tasks WHERE id = ? AND project_id = ?`, [taskId, projectId])).changes
    })
    if (changes) await repos.projects.touchProject(projectId)
    return changes > 0
  })
}

// --- environments ---

/** Environment worker write (state/port of an environment). */
export function setEnvironmentState(db: VoiceChatDb, projectId: string, environmentId: string, patch: { state?: EnvironmentState; port?: number | null }): Promise<void> {
  return withCtx(db, async ({ sql, now }) => {
    const fields = ['updated_at = ?']
    const values: (string | number | null)[] = [now()]
    if (patch.state !== undefined) {
      if (!['draft', 'provisioning', 'ready', 'failed', 'removing', 'removed'].includes(patch.state)) throw new Error('Invalid environment state')
      fields.push('state = ?'); values.push(patch.state)
    }
    if (patch.port !== undefined) {
      if (patch.port !== null && (!Number.isInteger(patch.port) || patch.port < 1 || patch.port > 65535)) throw new Error('Invalid environment port')
      fields.push('port = ?'); values.push(patch.port)
    }
    const result = await sql.run(`UPDATE environments SET ${fields.join(', ')} WHERE project_id = ? AND id = ?`, [...values, projectId, environmentId])
    if (!result.changes) throw new Error('Environment not found')
  })
}

export function upsertEnvironment(db: VoiceChatDb, userId: string, projectId: string, input: Pick<EnvironmentDefinition, 'id' | 'name' | 'machines' | 'checkoutPath'>): Promise<EnvironmentDefinition> {
  return withCtx(db, async ({ sql, now, repos }) => {
    const environments = repos.environments
    await (environments as unknown as EnvironmentsInternals).requireMember(userId, projectId)
    if (!await repos.projects.isProjectOwner(userId, projectId)) throw new Error('Project owner required')
    const id = parseEnvironmentId(input.id)
    if (typeof input.name !== 'string' || !input.name.trim() || typeof input.checkoutPath !== 'string' || !input.checkoutPath.trim() || !Array.isArray(input.machines) || input.machines.length !== 1 || typeof input.machines[0] !== 'string' || !input.machines[0].trim()) throw new Error('Invalid environment definition')
    if ((await environments.getEnvironment(userId, projectId, id))?.mode === 'managed') throw new Error('Managed environment cannot be changed')
    const ts = now()
    const written = await sql.run(`INSERT INTO environments (id, project_id, name, machines_json, checkout_path, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, id) DO UPDATE SET name = excluded.name, machines_json = excluded.machines_json, checkout_path = excluded.checkout_path, updated_at = excluded.updated_at WHERE environments.mode = 'external'`, [id, projectId, input.name, JSON.stringify(input.machines), input.checkoutPath, userId, ts, ts])
    if (!written.changes) throw new Error('Managed environment cannot be changed')
    return (await environments.getEnvironment(userId, projectId, id))!
  })
}

// --- releases ---

async function addReleaseEvent(ctx: RepoContext, releaseId: string, type: string, actor: string, payload: unknown): Promise<void> {
  await ctx.sql.run(`INSERT INTO project_release_events (id,release_id,type,actor,payload_json,created_at) VALUES (?,?,?,?,?,?)`, [ctx.newId(), releaseId, type, actor, JSON.stringify(payload), ctx.now()])
}

export function createProjectRelease(db: VoiceChatDb, userId: string, projectId: string, input: { branch: string; version: string; sha: string; status?: ProjectRelease['status']; models?: Partial<Record<ReleaseStepKind, string>>; previousReleaseId?: string | null; agentId?: string; checkoutPath?: string; limits?: ReleaseTimeouts }): Promise<ProjectRelease> {
  return withCtx(db, async (ctx) => {
    const { sql, newId, now, repos } = ctx
    const releases = repos.releases
    if (!(await repos.projects.isProjectOwner(userId, projectId))) throw new Error('release permission required')
    const previous = input.previousReleaseId ? await (releases as unknown as ReleasesInternals).releaseRow(input.previousReleaseId) : null
    if (input.previousReleaseId && (!previous || previous.project_id !== projectId || previous.branch !== input.branch)) throw new Error('invalid previous release')
    // The attempt is always max+1 per branch, so a retry from the same prepared release never hits UNIQUE.
    const nextByBranch = (((await sql.get(`SELECT MAX(attempt) AS n FROM project_releases WHERE project_id=? AND branch=?`, [projectId, input.branch])) as { n: number | null }).n ?? 0) + 1
    const attempt = previous ? Math.max(previous.attempt + 1, nextByBranch) : nextByBranch
    const id = newId(), ts = now()
    await sql.transaction(async () => {
      if (input.previousReleaseId) {
        const component = await sql.get<{ state_json: string; active_deployment_id: string | null }>(`SELECT state_json,active_deployment_id FROM application_environments WHERE project_id=? AND environment='production'`, [projectId])
        if (component && (component.active_deployment_id || parseApplicationEnvironment(JSON.parse(component.state_json)).applications.length)) throw new Error('Production управляется выпусками приложений; общий deploy перезаписал бы независимые артефакты')
      }
      const limits = validateReleaseTimeouts(input.limits ?? DEFAULT_RELEASE_TIMEOUTS)
      await sql.run(`INSERT INTO project_releases (id,project_id,version,branch,commit_sha,status,triggered_by,attempt,previous_release_id,created_at,agent_id,checkout_path) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [id, projectId, input.version, input.branch, input.sha, input.status ?? 'preparing', userId, attempt, input.previousReleaseId ?? null, ts, input.agentId ?? null, input.checkoutPath ?? null])
      for (const [position, kind] of RELEASE_STEP_ORDER.entries()) await sql.run(`INSERT INTO project_release_steps (id,release_id,kind,position,status,model,attempt,limit_ms) VALUES (?,?,?,?,?,?,?,?)`, [newId(), id, kind, position, 'queued', input.models?.[kind] ?? null, attempt, releaseStepLimit(kind, limits)])
      await addReleaseEvent(ctx, id, 'release.created', userId, { branch: input.branch, version: input.version, sha: input.sha, attempt })
    })
    return (await releases.getProjectRelease(userId, projectId, id)) as ProjectRelease
  })
}

export function setProjectReleaseStatus(db: VoiceChatDb, id: string, status: ProjectRelease['status'], actor: string): Promise<void> {
  return withCtx(db, async (ctx) => {
    const { sql, newId, now, repos } = ctx
    const ts = now()
    await sql.run(`UPDATE project_releases SET status=?,released_at=? WHERE id=?`, [status, status === 'released' ? ts : null, id])
    await addReleaseEvent(ctx, id, `release.${status}`, actor, {})
    if (!['ready', 'released', 'failed'].includes(status)) return
    const release = await (repos.releases as unknown as ReleasesInternals).releaseRow(id)
    if (!release) return
    const owner = await sql.get<{ username: string }>(`SELECT username FROM project_members WHERE project_id=? AND role='owner' ORDER BY added_at LIMIT 1`, [release.project_id])
    if (!owner) return
    const failed = (await sql.get(`SELECT kind,log FROM project_release_steps WHERE release_id=? AND status='failed' ORDER BY position DESC LIMIT 1`, [id])) as { kind: string; log: string } | undefined
    const title = status === 'released' ? `Релиз ${release.version} опубликован` : status === 'ready' ? `Сборка ${release.version} завершена` : `Сборка ${release.version} упала`
    const text = status === 'failed' ? `Сборка ${release.version} упала: ${releaseFailureSummary(failed?.kind ?? '', failed?.log ?? '')}` : status === 'released' ? `Релиз ${release.version} опубликован` : `Сборка ${release.version} готова к деплою`
    await sql.run(`INSERT INTO release_notifications (id,user_id,project_id,release_id,title,text,created_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM release_notifications WHERE release_id=?)`, [newId(), owner.username, release.project_id, id, title, text, ts, id])
  })
}
