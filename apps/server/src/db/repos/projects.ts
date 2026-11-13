import type { IntegrationTokenScope, IntegrationTokenView } from '@voicechat/shared'
import { integrationBearer, type IntegrationPrincipal } from '../../auth/integrationTokens.js'
// Домен «projects»: таблицы projects, project_members, project_member_role_audit, project_invitations, project_types, project_type_review_audit, kanban_columns, board_views.
// Файл получен разрезанием бывшего VoiceChatDb (apps/server/src/db/database.ts) по владению таблицами;
// карта владения — ./ownership.ts, правила — docs/plans/db-repositories.md.
import type { ProjectCommandPolicy } from '@voicechat/shared'
import type { MachineShareAccess } from '@sislexa/agent-contracts'
import { parseProjectCommandPolicy, parseAutomatedQaScenarios, BUILTIN_PROJECT_TYPES, DEFAULT_PROJECT_TYPE_ID, isProjectTypeVisible, projectTypeChainLabel, resolveProjectTypeDefaults, resolveProjectTypeFeatures, type ProjectFeatureOverride, type ProjectFeatureSet, type ProjectTypeChain, type ProjectTypeDefaults, type ProjectTypeNode, type ProjectTypeStatus, type ProjectDetail, type ProjectMember, type ProjectSummary, type WorkItemType, type WorkItemDefaultSkills, type ProjectMachineDirectoryAssignments, recommendedProjectMachineDirectories, type ReleaseTimeouts, DEFAULT_RELEASE_TIMEOUTS } from '@voicechat/shared'
import { createHash, randomBytes } from 'node:crypto'
import { BaseRepo } from './base.js'
import { RANK_STEP, parseStringArray, normKbContextMode, parseJsonValue } from './support.js'

interface ProjectTypeRow {
  id: string
  parent_id: string | null
  name: string
  description: string
  features_json: string
  defaults_json: string
  builtin: number
  owner_id: string | null
  status: string
  review_note: string | null
  reviewed_by: string | null
  reviewed_at: number | null
  created_by: string
  created_at: number
  updated_at: number
}

interface ProjectRow {
  id: string
  tenant_id: string | null
  tenant_kind: 'personal' | 'team' | null
  project_type_id: string | null
  name: string
  description: string
  git_url: string | null
  preview_url: string | null
  test_users_json?: string | null
  technologies: string
  skills: string
  created_by: string
  created_at: number
  updated_at: number
  default_agent_id: string | null
  commit_policy: string
  merge_transport: string
  agent_plan_approval_mode: string
  test_command: string
  component_qa_command: string
  merge_test_command: string
  integration_test_command: string
  command_policy?: string | null
  production_deploy_command: string
  production_agent_id: string | null
  production_environment_mode: string
  production_checkout_path: string
  production_health_check_command: string
  release_timeouts_json: string
  default_skills_epic: string
  default_skills_story: string
  default_skills_task: string
  ci_base_branch: string
  ci_branch_template: string
  ci_reuse_strategy: string
  ci_exec_auth_ref: string
  ci_kb_context_mode: string
  ci_test_fix_cycle_limit: number
  automated_qa_command: string
  automated_qa_mode: string
  automated_qa_scenario_json: string
  autopilot_requires_manual_qa: number
  autopilot_default: number
  autopilot_fix_limit: number
  done_retention_days: number | null
}

interface ProjectMemberRow {
  username: string
  role: string
  added_at: number
}

export class ProjectsRepo extends BaseRepo {
  async listIntegrationTokens(userId: string, projectId: string): Promise<IntegrationTokenView[] | null> {
    if (!await this.isProjectOwner(userId, projectId)) return null
    const rows = await this.sql.all(`SELECT id, project_id, project_ids, name, scopes, created_at, last_used_at
      FROM integration_tokens WHERE project_id = ? AND revoked_at IS NULL ORDER BY created_at, id`, [projectId])
    return rows.map(row => ({
      id: String(row.id), projectId: String(row.project_id), projectIds: JSON.parse(String(row.project_ids)) as string[], name: String(row.name),
      scopes: JSON.parse(String(row.scopes)) as IntegrationTokenScope[],
      createdAt: Number(row.created_at), lastUsedAt: row.last_used_at == null ? null : Number(row.last_used_at)
    }))
  }

  async createIntegrationToken(userId: string, projectId: string, name: string, scopes: IntegrationTokenScope[], projectIds: string[] = [projectId]): Promise<(IntegrationTokenView & { token: string }) | null> {
    if (!Array.isArray(projectIds) || projectIds.length < 1 || projectIds.length > 50
      || !projectIds.includes(projectId) || projectIds.some(id => typeof id !== 'string' || !id)
      || new Set(projectIds).size !== projectIds.length) throw new Error('invalid_integration_token')
    const normalizedProjectIds = [projectId, ...projectIds.filter(id => id !== projectId)]
    for (const id of normalizedProjectIds) if (!await this.isProjectOwner(userId, id)) return null
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 200
      || !Array.isArray(scopes) || !scopes.length || scopes.some(scope => scope !== 'tasks:external' && scope !== 'tasks:read' && scope !== 'tasks:control')
      || new Set(scopes).size !== scopes.length) throw new Error('invalid_integration_token')
    const token = 'sit_' + randomBytes(32).toString('base64url')
    const view: IntegrationTokenView = { id: this.newId(), projectId, projectIds: normalizedProjectIds, name: name.trim(), scopes, createdAt: this.now(), lastUsedAt: null }
    await this.sql.run(`INSERT INTO integration_tokens
      (id, project_id, project_ids, name, scopes, token_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [view.id, projectId, JSON.stringify(normalizedProjectIds), view.name, JSON.stringify(scopes), createHash('sha256').update(token).digest('hex'), userId, view.createdAt])
    return { ...view, token }
  }

  async revokeIntegrationToken(userId: string, projectId: string, id: string): Promise<boolean> {
    if (!await this.isProjectOwner(userId, projectId)) return false
    const result = await this.sql.run(`UPDATE integration_tokens SET revoked_at = ?
      WHERE id = ? AND project_id = ? AND revoked_at IS NULL`, [this.now(), id, projectId])
    return result.changes > 0
  }

  async resolveIntegrationToken(authorization: string | undefined): Promise<IntegrationPrincipal | null> {
    const token = integrationBearer(authorization)
    if (!token) return null
    // Conditional UPDATE atomically checks revocation and records use.
    const row = await this.sql.get(`UPDATE integration_tokens SET last_used_at = ?
      WHERE token_hash = ? AND revoked_at IS NULL RETURNING project_id, project_ids, scopes`,
      [this.now(), createHash('sha256').update(token).digest('hex')])
    return row ? { kind: 'integration', projectId: String(row.project_id), projectIds: JSON.parse(String(row.project_ids)) as string[], scopes: JSON.parse(String(row.scopes)) as IntegrationTokenScope[] } : null
  }

  /** Политика команд проекта (п.10); null — проекта нет. */
  async getProjectCommandPolicy(projectId: string): Promise<ProjectCommandPolicy | null> {
    const r = (await this.sql.get(`SELECT command_policy FROM projects WHERE id = ?`, [projectId])) as { command_policy?: string | null } | undefined
    return r ? parseProjectCommandPolicy(r.command_policy) : null
  }

  /** Raw preview stand config of a project (validated by the caller); null when absent. */
  async getProjectStandPreview(projectId: string): Promise<unknown> {
    const row = await this.sql.get<{ config_json: string }>(`SELECT config_json FROM project_stand_previews WHERE project_id = ?`, [projectId])
    if (!row) return null
    try { return JSON.parse(row.config_json) } catch { return null }
  }

  async setProjectStandPreview(projectId: string, config: object | null, userId: string): Promise<void> {
    if (!config) { await this.sql.run(`DELETE FROM project_stand_previews WHERE project_id = ?`, [projectId]); return }
    await this.sql.run(`INSERT INTO project_stand_previews (project_id, config_json, updated_by, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(project_id) DO UPDATE SET config_json = excluded.config_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      [projectId, JSON.stringify(config), userId, this.now()])
  }

  async isProjectMember(userId: string, projectId: string): Promise<boolean> {
    return (
      await this.sql.get(`SELECT 1 FROM project_members WHERE project_id = ? AND username = ?`, [projectId, userId]) !== undefined
    )
  }

  /** Назначать задачи можно только незаблокированному участнику проекта. */
  async isActiveProjectMember(userId: string, projectId: string): Promise<boolean> {
    return (
      await this.sql.get(`SELECT 1 FROM project_members pm JOIN users u ON u.name = pm.username WHERE pm.project_id = ? AND pm.username = ? AND u.blocked = 0`, [projectId, userId]) !== undefined
    )
  }

  /** Internal worker lookup; the creator supplies the environment link machine scope. */
  async projectCreator(projectId: string): Promise<string | null> {
    return (await this.sql.get<{ created_by: string }>('SELECT created_by FROM projects WHERE id = ?', [projectId]))?.created_by ?? null
  }

  /** Единый серверный источник проектного права владельца. */
  async isProjectOwner(userId: string, projectId: string): Promise<boolean> {
    return (
      await this.sql.get(`SELECT 1 FROM project_members WHERE project_id = ? AND username = ? AND role = 'owner'`, [projectId, userId]) !== undefined
    )
  }

  async touchProject(projectId: string, ts: number = this.now()): Promise<void> {
    await this.sql.run(`UPDATE projects SET updated_at = ? WHERE id = ?`, [ts, projectId])
  }

  /** Колонка «Готово»: попадание в неё запускает отсчёт скрытия карточки. */
  async isDoneColumn(columnId: string): Promise<boolean> {
    const r = (await this.sql.get(`SELECT semantic_type FROM kanban_columns WHERE id = ?`, [columnId])) as
      | { semantic_type: string }
      | undefined
    return r?.semantic_type === 'done'
  }

  /** Порог проекта «сколько дней держать завершённые на доске» (null — не скрывать). */
  async doneRetentionDays(projectId: string): Promise<number | null> {
    const r = (await this.sql.get(`SELECT done_retention_days AS d FROM projects WHERE id = ?`, [projectId])) as
      | { d: number | null }
      | undefined
    return r?.d ?? null
  }

  async columnInProject(projectId: string, columnId: string): Promise<boolean> {
    return (
      await this.sql.get(`SELECT 1 FROM kanban_columns WHERE id = ? AND project_id = ?`, [columnId, projectId]) !== undefined
    )
  }

  /**
   * Привязать приглашения «на адрес» к новому зарегистрированному пользователю.
   * Автоприёма нет: человек входит, видит приглашение и принимает явно.
   */
  async attachInvitationsToNewUser(username: string, email: string): Promise<number> {
    const changed = await this.sql.run(`UPDATE project_invitations SET invited_username = ? WHERE status='pending' AND invited_username IS NULL AND email = ?`, [username, email.toLowerCase()])
    return changed.changes
  }

  //
  // Возможности типа читаются на каждом защищённом запросе, поэтому разрешённые
  // цепочки кэшируются в памяти. Сервер одноприцессный: любая запись в
  // `project_types` сбрасывает кэш целиком — инвалидировать поддерево точечно
  // не стоит сложности, узлов заведомо мало.
  private projectTypeChainCache = new Map<string, ProjectTypeChain>()

  private invalidateProjectTypeCache(): void {
    this.projectTypeChainCache.clear()
  }

  /** Идемпотентный посев встроенных узлов: пользовательские строки не трогает. */
  async seedBuiltinProjectTypes(): Promise<void> {
    const ts = this.now()
    const upsert = this.sql.prepare(`
      INSERT INTO project_types (id, parent_id, name, description, features_json, defaults_json, builtin, owner_id, status, review_note, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, NULL, 'published', '', 'system', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        parent_id = excluded.parent_id,
        name = excluded.name,
        description = excluded.description,
        features_json = excluded.features_json,
        defaults_json = excluded.defaults_json,
        builtin = 1,
        status = 'published',
        updated_at = excluded.updated_at
      WHERE project_types.builtin = 1
    `)
    await this.sql.transaction(async () => {
      for (const node of BUILTIN_PROJECT_TYPES) {
        await upsert.run(node.id, node.parentId, node.name, node.description, JSON.stringify(node.features), JSON.stringify(node.defaults), ts, ts)
      }
    })
    this.invalidateProjectTypeCache()
  }

  private mapProjectTypeRow(r: ProjectTypeRow): ProjectTypeNode {
    return {
      id: r.id,
      parentId: r.parent_id,
      name: r.name,
      description: r.description,
      features: parseJsonValue<ProjectFeatureOverride>(r.features_json, {}),
      defaults: parseJsonValue<ProjectTypeDefaults>(r.defaults_json, {}),
      builtin: r.builtin !== 0,
      ownerId: r.owner_id,
      status: (['private', 'pending', 'published', 'rejected'] as const).includes(r.status as ProjectTypeStatus)
        ? (r.status as ProjectTypeStatus)
        : 'private',
      reviewNote: r.review_note ?? '',
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }
  }

  async getProjectType(id: string): Promise<ProjectTypeNode | null> {
    const row = (await this.sql.get(`SELECT * FROM project_types WHERE id = ?`, [id])) as ProjectTypeRow | undefined
    return row ? this.mapProjectTypeRow(row) : null
  }

  /** Все узлы дерева (каталог фильтруется отдельно — см. listProjectTypes). */
  async allProjectTypes(): Promise<ProjectTypeNode[]> {
    const rows = (await this.sql.all(`SELECT * FROM project_types ORDER BY builtin DESC, name`)) as ProjectTypeRow[]
    return rows.map((r) => this.mapProjectTypeRow(r))
  }

  /** Каталог выбора: встроенные, опубликованные и собственные узлы пользователя. */
  async listProjectTypes(userId: string): Promise<ProjectTypeNode[]> {
    // Счёт использования считаем одним запросом на весь каталог: по узлу их было
    // бы столько же, сколько узлов, а каталог читается на каждом открытии формы.
    const counts = new Map(
      ((await this.sql.all(`SELECT project_type_id AS id, COUNT(*) AS n FROM projects GROUP BY project_type_id`)) as Array<{ id: string | null; n: number }>)
        .map((row) => [row.id ?? '', row.n])
    )
    return (await this.allProjectTypes())
      .filter((node) => isProjectTypeVisible(node, userId))
      .map((node) => ({ ...node, usageCount: counts.get(node.id) ?? 0 }))
  }

  /** Путь от корня к узлу. Пустой массив — узла нет или цепочка разорвана. */
  async projectTypeAncestry(id: string): Promise<ProjectTypeNode[]> {
    const chain: ProjectTypeNode[] = []
    const seen = new Set<string>()
    let current = await this.getProjectType(id)
    while (current) {
      // Цикл в данных не должен вешать сервер: обрываем и отдаём, что собрали.
      if (seen.has(current.id)) break
      seen.add(current.id)
      chain.unshift(current)
      current = current.parentId ? await this.getProjectType(current.parentId) : null
    }
    return chain
  }

  /** Разрешённая цепочка типа: узлы + эффективные возможности + ярлык пути. */
  async projectTypeChain(id: string): Promise<ProjectTypeChain> {
    const cached = this.projectTypeChainCache.get(id)
    if (cached) return cached
    let nodes = await this.projectTypeAncestry(id)
    // Неизвестный тип (например, узел удалили в обход RESTRICT) не должен
    // обесточивать проект: откатываемся на встроенный корень.
    if (nodes.length === 0 && id !== DEFAULT_PROJECT_TYPE_ID) nodes = await this.projectTypeAncestry(DEFAULT_PROJECT_TYPE_ID)
    const chain: ProjectTypeChain = {
      nodes,
      features: resolveProjectTypeFeatures(nodes),
      label: projectTypeChainLabel(nodes)
    }
    this.projectTypeChainCache.set(id, chain)
    return chain
  }

  /** Эффективные возможности проекта — то, чем гейтятся защищённые операции. */
  async projectFeatures(projectId: string): Promise<ProjectFeatureSet> {
    const row = (await this.sql.get(`SELECT project_type_id FROM projects WHERE id = ?`, [projectId])) as { project_type_id: string | null } | undefined
    return (await this.projectTypeChain(row?.project_type_id || DEFAULT_PROJECT_TYPE_ID)).features
  }

  /** Заготовки типа, слитые от корня к листу. */
  async projectTypeDefaults(id: string): Promise<ProjectTypeDefaults> {
    return resolveProjectTypeDefaults((await this.projectTypeChain(id)).nodes)
  }

  private async mapProjectSummary(r: ProjectRow, myRole: string): Promise<ProjectSummary> {
    return {
      id: r.id,
      // Local Core mode keeps projects flat; subprojects live in the Kanban service.
      parentProjectId: null,
      subprojectCount: 0,
      ...(r.tenant_id ? { tenantId: r.tenant_id } : {}),
      ...(r.tenant_kind ? { tenantKind: r.tenant_kind } : {}),
      name: r.name,
      description: r.description,
      typeId: r.project_type_id || DEFAULT_PROJECT_TYPE_ID,
      typeChain: await this.projectTypeChain(r.project_type_id || DEFAULT_PROJECT_TYPE_ID),
      gitUrl: r.git_url,
      previewUrl: r.preview_url ?? null,
      testUsers: parseJsonValue<import('@voicechat/shared').ProjectTestUser[]>(r.test_users_json ?? null, []),
      technologies: parseStringArray(r.technologies),
      skills: parseStringArray(r.skills),
      defaultSkills: {
        epic: parseStringArray(r.default_skills_epic),
        story: parseStringArray(r.default_skills_story),
        task: parseStringArray(r.default_skills_task)
      },
      createdBy: r.created_by,

      createdAt: r.created_at,
      updatedAt: r.updated_at,
      role: myRole === 'owner' ? 'owner' : 'member',
      commitPolicy: r.commit_policy === 'final_system_commit' || r.commit_policy === 'manual_user_confirmation' ? r.commit_policy : 'agent_commits',
      mergeTransport: r.merge_transport === 'github_pull_request' ? 'github_pull_request' : 'local',
      agentPlanApprovalMode: r.agent_plan_approval_mode === 'automatic' ? 'automatic' : 'manual',
      testCommand: r.test_command || undefined,
      mergeTestCommand: r.merge_test_command || undefined,
      componentQaCommand: r.component_qa_command || undefined,
      integrationTestCommand: r.integration_test_command || undefined,
      automatedQaCommand: r.automated_qa_command || 'npm test',
      automatedQaMode: r.automated_qa_mode === 'playwright' ? 'playwright' : 'command',
      automatedQaScenarios: parseAutomatedQaScenarios(parseJsonValue<unknown>(r.automated_qa_scenario_json, [])),
      autoPilotDefault: r.autopilot_default !== 0,
      autoPilotRequiresManualQa: r.autopilot_requires_manual_qa !== 0,
      autoPilotFixLimit: Number.isInteger(r.autopilot_fix_limit) && r.autopilot_fix_limit >= 0 ? r.autopilot_fix_limit : 3,
      commandPolicy: parseProjectCommandPolicy(r.command_policy),
      productionDeployCommand: r.production_deploy_command || undefined,
      productionAgentId: r.production_agent_id,
      productionEnvironmentMode: r.production_environment_mode === 'managed' ? 'managed' : 'legacy',
      productionCheckoutPath: r.production_checkout_path || undefined,
      productionHealthCheckCommand: r.production_health_check_command || undefined,
      releaseTimeouts: {...DEFAULT_RELEASE_TIMEOUTS,...parseJsonValue<Partial<ReleaseTimeouts>>(r.release_timeouts_json,{})},
      ciBaseBranch: r.ci_base_branch,
      ciBranchTemplate: r.ci_branch_template,
      ciReuseStrategy: r.ci_reuse_strategy === 'reuse' || r.ci_reuse_strategy === 'clean' ? r.ci_reuse_strategy : 'fail',
      ciExecAuthRef: r.ci_exec_auth_ref,
      ciKbContextMode: normKbContextMode(r.ci_kb_context_mode),
      ciTestFixCycleLimit: Number.isInteger(r.ci_test_fix_cycle_limit) && r.ci_test_fix_cycle_limit >= 0 ? r.ci_test_fix_cycle_limit : 10,
      doneRetentionDays: r.done_retention_days
    }
  }

  /** Создаёт проект: владелец-участник + дефолтные колонки (в одной транзакции). */
  async createProject(
    userId: string,
    args: { name: string; tenantId?: string; tenantKind?: 'personal' | 'team'; typeId?: string; description?: string; gitUrl?: string; technologies?: string[]; skills?: string[]; defaultSkills?: Partial<WorkItemDefaultSkills>; commitPolicy?: 'agent_commits' | 'final_system_commit' | 'manual_user_confirmation'; mergeTransport?: 'local' | 'github_pull_request'; agentPlanApprovalMode?: 'manual' | 'automatic' }
  ): Promise<ProjectDetail> {
    const id = this.newId()
    const ts = this.now()
    // Заготовки типа — СНИМОК на момент создания: дальше проект живёт своей жизнью,
    // и правка типа не перекраивает работающую доску. Явный аргумент всегда важнее
    // заготовки: пользователь заполнил поле руками.
    const typeId = args.typeId && await this.getProjectType(args.typeId) ? args.typeId : DEFAULT_PROJECT_TYPE_ID
    const seed = await this.projectTypeDefaults(typeId)
    // Public routes always pass a verified tenant. Nullable ownership preserves
    // the long-standing low-level fixture API; startup backfill repairs persisted legacy rows.
    const tenantId = args.tenantId ?? (await this.repos.identity.getAccountAccess(userId))?.tenant.id ?? null
    const tenantKind = args.tenantKind ?? (tenantId ? 'personal' : null)
    await this.sql.transaction(async () => {
      await this.sql.run(`INSERT INTO projects (id, tenant_id, tenant_kind, project_type_id, name, description, git_url, technologies, skills, created_by, created_at, updated_at, commit_policy, merge_transport, agent_plan_approval_mode, default_skills_epic, default_skills_story, default_skills_task, ci_base_branch, ci_branch_template, ci_reuse_strategy, test_command)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, tenantId, tenantKind, typeId, args.name, args.description ?? '', args.gitUrl ?? null, JSON.stringify(args.technologies ?? seed.technologies ?? []), JSON.stringify(args.skills ?? seed.skills ?? []), userId, ts, ts, args.commitPolicy ?? seed.commitPolicy ?? 'agent_commits', args.mergeTransport ?? seed.mergeTransport ?? 'local', args.agentPlanApprovalMode ?? seed.agentPlanApprovalMode ?? 'manual', JSON.stringify(args.defaultSkills?.epic ?? seed.defaultSkills?.epic ?? []), JSON.stringify(args.defaultSkills?.story ?? seed.defaultSkills?.story ?? []), JSON.stringify(args.defaultSkills?.task ?? seed.defaultSkills?.task ?? []), seed.ciBaseBranch ?? 'main', seed.ciBranchTemplate ?? '{task_number}', seed.ciReuseStrategy ?? 'fail', seed.testCommand ?? ''])

      await this.sql.run(`INSERT INTO project_members (project_id, username, role, added_at) VALUES (?, ?, 'owner', ?)`, [id, userId, ts])
      // Колонки берутся из заготовок типа; у «Разработки ПО» их нет, и остаётся
      // системный конвейер. Для «Общего проекта» тип отдаёт короткий нейтральный
      // набор — 13 колонок QA-конвейера там были бы бессмысленны.
      for (const [i, [name, semantic]] of (seed.columns?.length
        ? seed.columns.map((column) => [column.name, column.semanticType] as [string, string])
        : [
        ['Бэклог', 'backlog'],
        ['Подготовка к разработке', 'preparation'],
        ['Ready for Development', 'ready'],
        ['Development', 'development'],
        ['Component QA', 'component_qa'],
        ['Создание интеграционных автотестов', 'integration_tests'],
        ['Automated QA', 'automated_qa'],
        ['Ручное QA', 'manual_qa'],
        ['Ожидает мержа', 'awaiting_merge'],
        ['Мерж', 'merge'],
        ['Готово', 'done'],
        ['Отменено', 'cancelled'],
        ['Требуется решение', 'decision_required']
      ] as [string, string][]).entries()) {
        await this.sql.run(`INSERT INTO kanban_columns (id, project_id, name, semantic_type, position, hidden, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`, [this.newId(), id, name, semantic, (i + 1) * RANK_STEP, ts])
      }
      // Скелет раздела «Разработка проекта» заводит владелец статей — kb. Без него
      // раздел пустой, и «Исследовать проект» нечего сверять с кодом.
      await this.repos.kb.seedProjectOverview({ projectId: id, name: args.name, description: args.description ?? '', createdBy: userId, ts })
    })
    return (await this.getProject(userId, id)) as ProjectDetail
  }

  async listProjects(userId: string, tenantId?: string, tenantKind?: 'personal' | 'team'): Promise<ProjectSummary[]> {
    const rows = (await this.sql.all(`SELECT p.*, m.role AS my_role FROM projects p
         JOIN project_members m ON m.project_id = p.id
         WHERE m.username = ? AND (? IS NULL OR p.tenant_id = ? OR (? = 'personal' AND p.tenant_kind = 'personal')) ORDER BY p.updated_at DESC`, [userId, tenantId ?? null, tenantId ?? null, tenantKind ?? null])) as Array<ProjectRow & { my_role: string }>
    return await Promise.all(rows.map(async (r) => await this.mapProjectSummary(r, r.my_role)))
  }

  async getProject(userId: string, id: string, tenantId?: string, tenantKind?: 'personal' | 'team'): Promise<ProjectDetail | null> {
    const row = (await this.sql.get(`SELECT p.*, m.role AS my_role FROM projects p
         JOIN project_members m ON m.project_id = p.id
         WHERE p.id = ? AND m.username = ? AND (? IS NULL OR p.tenant_id = ? OR (? = 'personal' AND p.tenant_kind = 'personal'))`, [id, userId, tenantId ?? null, tenantId ?? null, tenantKind ?? null])) as (ProjectRow & { my_role: string }) | undefined
    if (!row) return null
    const members = (
      (await this.sql.all(`SELECT pm.username, pm.role, pm.added_at, u.blocked FROM project_members pm JOIN users u ON u.name = pm.username WHERE pm.project_id = ? ORDER BY pm.added_at ASC`, [id])) as Array<ProjectMemberRow & { blocked: number }>
    ).map(
      (m): ProjectMember => ({
        username: m.username,
        role: m.role === 'owner' ? 'owner' : 'member',
        addedAt: m.added_at,
        active: m.blocked === 0
      })
    )
    const machines = await Promise.all((
      (await this.sql.all(`SELECT a.id AS agent_id,
                COALESCE(pm.path,'') AS path,
                COALESCE(pm.repos_root,'') AS repos_root,
                COALESCE(pm.ssh_host,'') AS ssh_host,
                COALESCE(pm.ssh_user,'') AS ssh_user,
                pm.storage_id, COALESCE(pm.directories_json,'') AS directories_json,
                s.root_path AS storage_root_path, s.format_version AS storage_format_version,
                COALESCE(pm.added_at, share.created_at, a.created_at) AS added_at,
                a.name, a.user_id,
                CASE WHEN share.shared = 1 THEN 1 ELSE 0 END AS shared,
                COALESCE(share.access,'full') AS share_access
         FROM agents a
         LEFT JOIN project_machines pm ON pm.agent_id=a.id AND pm.project_id=?
         LEFT JOIN machine_storages s ON s.id=pm.storage_id AND s.machine_id=a.id
         LEFT JOIN machine_project_shares share ON share.agent_id=a.id AND share.project_id=?
         WHERE a.user_id=? OR (share.shared=1 AND a.user_id<>?)
         ORDER BY CASE WHEN a.user_id=? THEN 0 ELSE 1 END, a.name ASC`, [id, id, userId, userId, userId])) as Array<{
        agent_id: string
        path: string | null
        repos_root: string | null
        ssh_host: string | null
        ssh_user: string | null
        storage_id: string | null
        directories_json: string | null
        storage_root_path: string | null
        storage_format_version: number | null
        added_at: number
        name: string
        user_id: string
        shared: number
        share_access: string
      }>
    ).map(async (x) => {
      let directories: ProjectMachineDirectoryAssignments | undefined
      try { directories = x.directories_json ? JSON.parse(x.directories_json) as ProjectMachineDirectoryAssignments : undefined } catch { directories = undefined }
      const storage = x.storage_id && x.storage_root_path ? {
        id: x.storage_id, machineId: x.agent_id, rootPath: x.storage_root_path,
        formatVersion: x.storage_format_version ?? 1, status: 'ready' as const
      } : null
      const recommendations = storage
        ? recommendedProjectMachineDirectories(storage.rootPath, id, this.repos.machines.projectStoragePlatform(storage.rootPath))
        : undefined
      const readinessReasons: string[] = []
      if (!storage) readinessReasons.push('не выбрано хранилище MachineStorage')
      if (!directories) readinessReasons.push('не настроены каталоги проекта')
      if (!(x.path ?? '').trim()) readinessReasons.push('не заполнена «Папка проекта»')
      if (!(x.repos_root ?? '').trim()) readinessReasons.push('не заполнен «Корень Feature Run»')
      return {
        agentId: x.agent_id,
        name: x.name,
        owner: x.user_id,
        ownership: x.user_id === userId ? 'mine' as const : 'other' as const,
        sharedWithProject: !!x.shared,
        ...(x.shared ? { shareAccess: (x.share_access === 'read' ? 'read' : 'full') as MachineShareAccess } : {}),
        isMyDefault: await this.repos.machines.getUserProjectDefaultMachine(userId, id) === x.agent_id,
        canUse: x.user_id === userId || !!x.shared,
        unavailableReason: null,
        load: (await this.repos.ci.countActiveCiRunsByAgent())[x.agent_id] ?? 0,
        online: false,
        addedAt: x.added_at,
        path: x.path ?? '', reposRoot: x.repos_root ?? '',
        storageId: x.storage_id, storage,
        availableStorages: x.user_id === userId ? (await this.repos.machines.listMachineStorages(userId, x.agent_id)).map((item, index) => ({ ...item, primary: index === 0 })) : undefined,
        directories, recommendations,
        readiness: { ready: readinessReasons.length === 0, reasons: readinessReasons },
        sshHost: x.ssh_host ?? '', sshUser: x.ssh_user ?? ''
      }
    }))
    return {
      ...await this.mapProjectSummary(row, row.my_role),
      members,
      machines,
      defaultAgentId: row.default_agent_id ?? null
    }
  }

  async projectTenant(projectId: string): Promise<{ id: string; kind: 'personal' | 'team' } | null> {
    const row = await this.sql.get<{ tenant_id: string | null; tenant_kind: 'personal' | 'team' | null }>('SELECT tenant_id, tenant_kind FROM projects WHERE id = ?', [projectId])
    return row?.tenant_id ? { id: row.tenant_id, kind: row.tenant_kind ?? 'personal' } : null
  }

  async backfillTenantIds(resolve: (userName: string) => Promise<string | null>): Promise<void> {
    await this.sql.run("UPDATE projects SET tenant_kind = 'personal' WHERE tenant_kind IS NULL OR tenant_kind = ''")
    const rows = await this.sql.all<{ created_by: string }>('SELECT DISTINCT created_by FROM projects WHERE tenant_id IS NULL OR tenant_id = \'\'')
    for (const row of rows) {
      const tenantId = await resolve(row.created_by)
      if (tenantId) await this.sql.run('UPDATE projects SET tenant_id = ? WHERE created_by = ? AND (tenant_id IS NULL OR tenant_id = \'\')', [tenantId, row.created_by])
    }
  }

  private async auditProjectMemberRole(
    projectId: string,
    actor: string,
    targetUser: string,
    oldRole: 'owner' | 'member' | null,
    newRole: 'owner' | 'member' | null,
    action: 'add' | 'role_change' | 'remove',
    createdAt: number
  ): Promise<void> {
    await this.sql.run(`INSERT INTO project_member_role_audit
       (id, project_id, target_user, actor, old_role, new_role, action, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [this.newId(), projectId, targetUser, actor, oldRole, newRole, action, createdAt])
  }

  async removeMember(userId: string, id: string, username: string): Promise<ProjectDetail | null> {
    if (!(await this.isProjectOwner(userId, id))) return null
    const remove = () => this.sql.transaction(async () => {
      const row = (await this.sql.get(`SELECT role FROM project_members WHERE project_id = ? AND username = ?`, [id, username])) as { role: string } | undefined
      if (!row) return
      const oldRole = row.role === 'owner' ? 'owner' : 'member'
      if (oldRole === 'owner') {
        const owners = (await this.sql.get(`SELECT COUNT(*) AS count FROM project_members WHERE project_id = ? AND role = 'owner'`, [id])) as { count: number }
        if (owners.count <= 1) {
          throw new Error('Нельзя удалить или вывести последнего владельца. Сначала назначьте другого владельца')
        }
      }
      const ts = this.now()
      await this.sql.run(`DELETE FROM project_members WHERE project_id = ? AND username = ?`, [id, username])
      await this.repos.tasks.unassignUserInProject(id, username, ts)
      await this.auditProjectMemberRole(id, userId, username, oldRole, null, 'remove', ts)
      await this.touchProject(id, ts)
    })
    await remove()
    return await this.getProject(userId, id)
  }

  /** Навыки по умолчанию проекта для типа элемента (из настроек проекта). */
  async projectDefaultSkills(projectId: string, type: WorkItemType): Promise<string[]> {
    const row = (await this.sql.get(`SELECT default_skills_epic, default_skills_story, default_skills_task FROM projects WHERE id = ?`, [projectId])) as
      | { default_skills_epic: string; default_skills_story: string; default_skills_task: string }
      | undefined
    if (!row) return []
    const raw = type === 'epic' ? row.default_skills_epic : type === 'story' ? row.default_skills_story : row.default_skills_task
    return parseStringArray(raw)
  }

  /** Следующий номер задачи проекта (CHAT-N): счётчик живёт в projects, выдаёт его владелец. */
  async nextTaskSeq(projectId: string): Promise<number> {
    return ((await this.sql.get(`UPDATE projects SET task_seq = task_seq + 1 WHERE id = ? RETURNING task_seq`, [projectId])) as { task_seq: number }).task_seq
  }

  /**
   * Часть каскада удаления аккаунта: живые приглашения закрываем (иначе при повторной
   * регистрации того же логина или адреса они снова к нему привяжутся), членства
   * убираем, осиротевшие без владельца проекты удаляем. Зовётся из identity внутри
   * его транзакции.
   */
  async detachDeletedUser(userId: string, email: string): Promise<void> {
    await this.sql.run(`UPDATE project_invitations SET status='revoked', responded_at=?
       WHERE status='pending' AND (invited_username = ? OR (? <> '' AND email = ?))`, [this.now(), userId, email, email])
    await this.sql.run(`DELETE FROM project_members WHERE username = ?`, [userId])
    await this.sql.run(`DELETE FROM projects WHERE id IN (
           SELECT p.id FROM projects p
           WHERE NOT EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.role = 'owner')
         )`)
  }

  /** Машина удаляется: проекты теряют её как машину по умолчанию и как прод-машину. */
  async detachAgent(agentId: string): Promise<void> {
    await this.sql.run(`UPDATE projects SET default_agent_id = NULL WHERE default_agent_id = ?`, [agentId])
    await this.sql.run(`UPDATE projects SET production_agent_id = NULL WHERE production_agent_id = ?`, [agentId])
  }
}
