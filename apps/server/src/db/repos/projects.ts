// Домен «projects»: таблицы projects, project_members, project_member_role_audit, project_invitations, project_types, project_type_review_audit, kanban_columns, board_views.
// Файл получен разрезанием бывшего VoiceChatDb (apps/server/src/db/database.ts) по владению таблицами;
// карта владения — ./ownership.ts, правила — docs/plans/db-repositories.md.
import type { ProjectCommandPolicy, MachineShareAccess, AutomatedQaMode, AutomatedQaScenario, ProjectInvitation, ProjectInvitationForUser, ProjectInvitationPreview, ProjectInvitationStatus, ProjectRole } from '@voicechat/shared'
import { parseProjectCommandPolicy, parseAutomatedQaScenarios, DEFAULT_BOARD_VIEW, sanitizeBoardView, type BoardView, BUILTIN_PROJECT_TYPES, DEFAULT_PROJECT_TYPE_ID, MAX_PROJECT_TYPE_DEPTH, canPublishProjectType, isProjectTypeVisible, projectTypeChainLabel, resolveProjectTypeDefaults, resolveProjectTypeFeatures, type ProjectFeatureOverride, type ProjectFeatureSet, type ProjectTypeChain, type ProjectTypeDefaults, type ProjectTypeNode, type ProjectTypeStatus, type KanbanColumn, type ProjectDetail, type ProjectMember, type ProjectSummary, type WorkItemType, type WorkItemDefaultSkills, type KanbanColumnSemanticType, type ProjectMachineDirectoryAssignments, recommendedProjectMachineDirectories, type KbContextMode, type ReleaseTimeouts, DEFAULT_RELEASE_TIMEOUTS, validateReleaseTimeouts } from '@voicechat/shared'
import { createHash, randomBytes } from 'node:crypto'
import { BaseRepo } from './base.js'
import { normalizeAutomatedQaScenario, RANK_STEP, parseStringArray, mapColumn, normKbContextMode, parseJsonValue } from './support.js'

interface ProjectInvitationRow {
  id: string
  project_id: string
  email: string | null
  invited_username: string | null
  role: string
  token_hash: string
  status: string
  invited_by: string
  created_at: number
  expires_at: number
  responded_at: number | null
}

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
  /** Вид доски человека в проекте; отсутствующая запись — вид по умолчанию. */
  getBoardView(userId: string, projectId: string): BoardView {
    const row = this.db.prepare(`SELECT value FROM board_views WHERE username = ? AND project_id = ?`).get(userId, projectId) as { value: string } | undefined
    if (!row) return { ...DEFAULT_BOARD_VIEW }
    try {
      return { ...DEFAULT_BOARD_VIEW, ...sanitizeBoardView(JSON.parse(row.value)) }
    } catch {
      return { ...DEFAULT_BOARD_VIEW }
    }
  }

  /** Патч вида: как у настроек — присланные поля поверх сохранённых. */
  saveBoardView(userId: string, projectId: string, patch: Partial<BoardView>): BoardView {
    const next = { ...this.getBoardView(userId, projectId), ...sanitizeBoardView(patch) }
    this.db.prepare(
      `INSERT INTO board_views (username, project_id, value, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(username, project_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(userId, projectId, JSON.stringify(next), this.now())
    return next
  }

  /** Политика команд проекта (п.10); null — проекта нет. */
  getProjectCommandPolicy(projectId: string): ProjectCommandPolicy | null {
    const r = this.db.prepare(`SELECT command_policy FROM projects WHERE id = ?`).get(projectId) as { command_policy?: string | null } | undefined
    return r ? parseProjectCommandPolicy(r.command_policy) : null
  }

  isProjectMember(userId: string, projectId: string): boolean {
    return (
      this.db
        .prepare(`SELECT 1 FROM project_members WHERE project_id = ? AND username = ?`)
        .get(projectId, userId) !== undefined
    )
  }

  /** Назначать задачи можно только незаблокированному участнику проекта. */
  isActiveProjectMember(userId: string, projectId: string): boolean {
    return (
      this.db
        .prepare(`SELECT 1 FROM project_members pm JOIN users u ON u.name = pm.username WHERE pm.project_id = ? AND pm.username = ? AND u.blocked = 0`)
        .get(projectId, userId) !== undefined
    )
  }

  /** Единый серверный источник проектного права владельца. */
  isProjectOwner(userId: string, projectId: string): boolean {
    return (
      this.db
        .prepare(`SELECT 1 FROM project_members WHERE project_id = ? AND username = ? AND role = 'owner'`)
        .get(projectId, userId) !== undefined
    )
  }

  touchProject(projectId: string, ts: number = this.now()): void {
    this.db.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).run(ts, projectId)
  }

  /** Колонка «Готово»: попадание в неё запускает отсчёт скрытия карточки. */
  isDoneColumn(columnId: string): boolean {
    const r = this.db.prepare(`SELECT semantic_type FROM kanban_columns WHERE id = ?`).get(columnId) as
      | { semantic_type: string }
      | undefined
    return r?.semantic_type === 'done'
  }

  /** Порог проекта «сколько дней держать завершённые на доске» (null — не скрывать). */
  doneRetentionDays(projectId: string): number | null {
    const r = this.db.prepare(`SELECT done_retention_days AS d FROM projects WHERE id = ?`).get(projectId) as
      | { d: number | null }
      | undefined
    return r?.d ?? null
  }

  columnInProject(projectId: string, columnId: string): boolean {
    return (
      this.db
        .prepare(`SELECT 1 FROM kanban_columns WHERE id = ? AND project_id = ?`)
        .get(columnId, projectId) !== undefined
    )
  }

  //
  // Токен живёт только в письме: в БД — sha256, в API его нет вовсе. Принять
  // приглашение может ТОЛЬКО адресат (по логину или по совпадению users.email),
  // иначе утёкшая ссылка пускала бы в проект кого угодно.

  private mapInvitation(r: ProjectInvitationRow): ProjectInvitation {
    return {
      id: r.id,
      projectId: r.project_id,
      email: r.email,
      invitedUsername: r.invited_username,
      role: r.role === 'owner' ? 'owner' : 'member',
      status: (['pending', 'accepted', 'declined', 'revoked'] as const).includes(r.status as ProjectInvitationStatus)
        ? (r.status as ProjectInvitationStatus)
        : 'revoked',
      invitedBy: r.invited_by,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      respondedAt: r.responded_at
    }
  }

  private invitationTokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  /**
   * Создать приглашение. `invitee` — логин или email; если такой пользователь
   * известен, приглашение адресуется ему поимённо (и письмо уйдёт на его адрес).
   * Возвращает приглашение и токен — токен нужен ровно один раз, для письма.
   */
  createProjectInvitation(
    userId: string,
    projectId: string,
    invitee: string,
    opts: { role?: ProjectRole; ttlMs?: number } = {}
  ): { invitation: ProjectInvitation; token: string; email: string | null } | null {
    if (!this.isProjectOwner(userId, projectId)) return null
    const raw = invitee.trim()
    if (!raw) throw new Error('Укажите логин или email')
    const looksLikeEmail = raw.includes('@')
    const email = looksLikeEmail ? raw.toLowerCase() : null
    if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254)) throw new Error('Некорректный email')

    const user = looksLikeEmail ? this.repos.identity.getUserByEmail(email!) : this.repos.identity.getUser(raw)
    if (!looksLikeEmail && !user) throw new Error(`Пользователь ${raw} не найден`)
    const invitedUsername = user?.name ?? null
    if (invitedUsername) {
      const already = this.db.prepare(`SELECT 1 FROM project_members WHERE project_id = ? AND username = ?`).get(projectId, invitedUsername)
      if (already) throw new Error('Этот пользователь уже участник проекта')
    }
    // Письмо уходит на явный адрес приглашения либо на подтверждённый адрес
    // найденного пользователя; звали по логину без email — письма не будет.
    const deliverTo = email ?? user?.email ?? null

    const token = randomBytes(24).toString('base64url')
    const id = this.newId()
    const ts = this.now()
    const expiresAt = ts + (opts.ttlMs ?? 7 * 24 * 60 * 60_000)
    // Повторное приглашение того же адресата заменяет прежнее живое: два
    // действующих токена на одного человека — лишняя поверхность.
    this.db.transaction(() => {
      if (invitedUsername) {
        this.db.prepare(`UPDATE project_invitations SET status='revoked', responded_at=? WHERE project_id=? AND invited_username=? AND status='pending'`).run(ts, projectId, invitedUsername)
      }
      if (email) {
        this.db.prepare(`UPDATE project_invitations SET status='revoked', responded_at=? WHERE project_id=? AND email=? AND status='pending'`).run(ts, projectId, email)
      }
      this.db.prepare(
        `INSERT INTO project_invitations (id, project_id, email, invited_username, role, token_hash, status, invited_by, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
      ).run(id, projectId, email, invitedUsername, opts.role === 'owner' ? 'owner' : 'member', this.invitationTokenHash(token), userId, ts, expiresAt)
    })()
    return { invitation: this.mapInvitation(this.invitationRow(id)!), token, email: deliverTo }
  }

  private invitationRow(id: string): ProjectInvitationRow | null {
    return (this.db.prepare(`SELECT * FROM project_invitations WHERE id = ?`).get(id) as ProjectInvitationRow | undefined) ?? null
  }

  /** Живые приглашения проекта (для владельца). */
  listProjectInvitations(userId: string, projectId: string): ProjectInvitation[] | null {
    if (!this.isProjectOwner(userId, projectId)) return null
    const rows = this.db.prepare(
      `SELECT * FROM project_invitations WHERE project_id = ? AND status = 'pending' ORDER BY created_at DESC`
    ).all(projectId) as ProjectInvitationRow[]
    return rows.map((r) => this.mapInvitation(r))
  }

  revokeProjectInvitation(userId: string, projectId: string, invitationId: string): boolean {
    if (!this.isProjectOwner(userId, projectId)) return false
    const changed = this.db.prepare(
      `UPDATE project_invitations SET status='revoked', responded_at=? WHERE id=? AND project_id=? AND status='pending'`
    ).run(this.now(), invitationId, projectId)
    return changed.changes > 0
  }

  /** Перевыпуск токена для повторной отправки письма: срок считается заново. */
  refreshProjectInvitationToken(userId: string, projectId: string, invitationId: string, ttlMs = 7 * 24 * 60 * 60_000): { invitation: ProjectInvitation; token: string; email: string | null } | null {
    if (!this.isProjectOwner(userId, projectId)) return null
    const row = this.invitationRow(invitationId)
    if (!row || row.project_id !== projectId || row.status !== 'pending') return null
    const token = randomBytes(24).toString('base64url')
    const ts = this.now()
    this.db.prepare(`UPDATE project_invitations SET token_hash=?, expires_at=? WHERE id=?`).run(this.invitationTokenHash(token), ts + ttlMs, invitationId)
    const user = row.invited_username ? this.repos.identity.getUser(row.invited_username) : null
    return { invitation: this.mapInvitation(this.invitationRow(invitationId)!), token, email: row.email ?? user?.email ?? null }
  }

  /** Живые приглашения пользователя — по логину и по подтверждённому адресу. */
  listInvitationsForUser(username: string): ProjectInvitationForUser[] {
    const user = this.repos.identity.getUser(username)
    const rows = this.db.prepare(
      `SELECT i.*, p.name AS project_name FROM project_invitations i
       JOIN projects p ON p.id = i.project_id
       WHERE i.status = 'pending' AND i.expires_at > ?
         AND (i.invited_username = ? OR (i.email IS NOT NULL AND i.email = ?))
       ORDER BY i.created_at DESC`
    ).all(this.now(), username, (user?.email ?? '').toLowerCase()) as Array<ProjectInvitationRow & { project_name: string }>
    return rows.map((r) => ({ ...this.mapInvitation(r), projectName: r.project_name }))
  }

  /** Публичный превью по токену: только имя проекта, кто позвал и срок. */
  projectInvitationPreview(token: string): ProjectInvitationPreview | null {
    const row = this.db.prepare(
      `SELECT i.*, p.name AS project_name FROM project_invitations i
       JOIN projects p ON p.id = i.project_id
       WHERE i.token_hash = ? AND i.status = 'pending' AND i.expires_at > ?`
    ).get(this.invitationTokenHash(token), this.now()) as (ProjectInvitationRow & { project_name: string }) | undefined
    if (!row) return null
    return {
      projectId: row.project_id,
      projectName: row.project_name,
      invitedBy: row.invited_by,
      role: row.role === 'owner' ? 'owner' : 'member',
      expiresAt: row.expires_at
    }
  }

  /**
   * Приглашение адресовано этому пользователю? Единственное место, где решается
   * «чья это ссылка»: по логину либо по совпадению подтверждённого адреса.
   */
  private invitationAddressedTo(row: ProjectInvitationRow, username: string): boolean {
    if (row.invited_username) return row.invited_username === username
    if (!row.email) return false
    const email = (this.repos.identity.getUser(username)?.email ?? '').toLowerCase()
    return Boolean(email) && email === row.email.toLowerCase()
  }

  /**
   * Приглашение по токену (ссылка из письма) либо по id (список в интерфейсе).
   * Id не секрет: доступ всё равно решает проверка адресата ниже, а приглашённому
   * по логину токен не приходит вовсе — иначе он не смог бы принять приглашение.
   */
  private invitationByTokenOrId(tokenOrId: string): ProjectInvitationRow | undefined {
    const byToken = this.db.prepare(`SELECT * FROM project_invitations WHERE token_hash = ?`).get(this.invitationTokenHash(tokenOrId)) as ProjectInvitationRow | undefined
    return byToken ?? (this.db.prepare(`SELECT * FROM project_invitations WHERE id = ?`).get(tokenOrId) as ProjectInvitationRow | undefined)
  }

  /** Принять приглашение по токену или id. Возвращает id проекта. */
  acceptProjectInvitation(username: string, tokenOrId: string): { projectId: string } {
    const ts = this.now()
    return this.db.transaction(() => {
      const row = this.invitationByTokenOrId(tokenOrId)
      if (!row) throw new Error('Приглашение недействительно')
      // Повторный переход по той же ссылке — обычное дело: письмо остаётся в
      // почте, а вкладок может быть две. Если это приглашение уже принял тот же
      // человек и он в проекте, отвечаем как на успех: новых прав это не даёт,
      // зато он попадает в проект вместо отказа «Приглашение недействительно».
      if (row.status === 'accepted' && this.invitationAddressedTo(row, username) && this.isProjectMember(username, row.project_id)) {
        return { projectId: row.project_id }
      }
      if (row.status !== 'pending') throw new Error('Приглашение недействительно')
      if (row.expires_at <= ts) throw new Error('Срок приглашения истёк — попросите отправить его заново')
      if (!this.invitationAddressedTo(row, username)) throw new Error('Это приглашение адресовано другому пользователю')
      const user = this.repos.identity.getUser(username)
      if (!user || user.blocked) throw new Error('Учётная запись недоступна')

      this.db.prepare(`INSERT OR IGNORE INTO project_members (project_id, username, role, added_at) VALUES (?, ?, ?, ?)`)
        .run(row.project_id, username, row.role === 'owner' ? 'owner' : 'member', ts)
      this.auditProjectMemberRole(row.project_id, row.invited_by, username, null, row.role === 'owner' ? 'owner' : 'member', 'add', ts)
      this.db.prepare(`UPDATE project_invitations SET status='accepted', responded_at=?, invited_username=? WHERE id=?`).run(ts, username, row.id)
      return { projectId: row.project_id }
    })()
  }

  declineProjectInvitation(username: string, tokenOrId: string): boolean {
    const row = this.invitationByTokenOrId(tokenOrId)
    if (!row || row.status !== 'pending') return false
    if (!this.invitationAddressedTo(row, username)) throw new Error('Это приглашение адресовано другому пользователю')
    this.db.prepare(`UPDATE project_invitations SET status='declined', responded_at=? WHERE id=?`).run(this.now(), row.id)
    return true
  }

  /**
   * Привязать приглашения «на адрес» к новому зарегистрированному пользователю.
   * Автоприёма нет: человек входит, видит приглашение и принимает явно.
   */
  attachInvitationsToNewUser(username: string, email: string): number {
    const changed = this.db.prepare(
      `UPDATE project_invitations SET invited_username = ? WHERE status='pending' AND invited_username IS NULL AND email = ?`
    ).run(username, email.toLowerCase())
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
  seedBuiltinProjectTypes(): void {
    const ts = this.now()
    const upsert = this.db.prepare(`
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
    this.db.transaction(() => {
      for (const node of BUILTIN_PROJECT_TYPES) {
        upsert.run(node.id, node.parentId, node.name, node.description, JSON.stringify(node.features), JSON.stringify(node.defaults), ts, ts)
      }
    })()
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

  getProjectType(id: string): ProjectTypeNode | null {
    const row = this.db.prepare(`SELECT * FROM project_types WHERE id = ?`).get(id) as ProjectTypeRow | undefined
    return row ? this.mapProjectTypeRow(row) : null
  }

  /** Все узлы дерева (каталог фильтруется отдельно — см. listProjectTypes). */
  allProjectTypes(): ProjectTypeNode[] {
    const rows = this.db.prepare(`SELECT * FROM project_types ORDER BY builtin DESC, name`).all() as ProjectTypeRow[]
    return rows.map((r) => this.mapProjectTypeRow(r))
  }

  /** Каталог выбора: встроенные, опубликованные и собственные узлы пользователя. */
  listProjectTypes(userId: string): ProjectTypeNode[] {
    // Счёт использования считаем одним запросом на весь каталог: по узлу их было
    // бы столько же, сколько узлов, а каталог читается на каждом открытии формы.
    const counts = new Map(
      (this.db.prepare(`SELECT project_type_id AS id, COUNT(*) AS n FROM projects GROUP BY project_type_id`).all() as Array<{ id: string | null; n: number }>)
        .map((row) => [row.id ?? '', row.n])
    )
    return this.allProjectTypes()
      .filter((node) => isProjectTypeVisible(node, userId))
      .map((node) => ({ ...node, usageCount: counts.get(node.id) ?? 0 }))
  }

  /** Все узлы, ожидающие решения администратора. */
  listPendingProjectTypes(): ProjectTypeNode[] {
    return this.allProjectTypes().filter((node) => node.status === 'pending')
  }

  /** Путь от корня к узлу. Пустой массив — узла нет или цепочка разорвана. */
  projectTypeAncestry(id: string): ProjectTypeNode[] {
    const chain: ProjectTypeNode[] = []
    const seen = new Set<string>()
    let current = this.getProjectType(id)
    while (current) {
      // Цикл в данных не должен вешать сервер: обрываем и отдаём, что собрали.
      if (seen.has(current.id)) break
      seen.add(current.id)
      chain.unshift(current)
      current = current.parentId ? this.getProjectType(current.parentId) : null
    }
    return chain
  }

  /** Разрешённая цепочка типа: узлы + эффективные возможности + ярлык пути. */
  projectTypeChain(id: string): ProjectTypeChain {
    const cached = this.projectTypeChainCache.get(id)
    if (cached) return cached
    let nodes = this.projectTypeAncestry(id)
    // Неизвестный тип (например, узел удалили в обход RESTRICT) не должен
    // обесточивать проект: откатываемся на встроенный корень.
    if (nodes.length === 0 && id !== DEFAULT_PROJECT_TYPE_ID) nodes = this.projectTypeAncestry(DEFAULT_PROJECT_TYPE_ID)
    const chain: ProjectTypeChain = {
      nodes,
      features: resolveProjectTypeFeatures(nodes),
      label: projectTypeChainLabel(nodes)
    }
    this.projectTypeChainCache.set(id, chain)
    return chain
  }

  /** Эффективные возможности проекта — то, чем гейтятся защищённые операции. */
  projectFeatures(projectId: string): ProjectFeatureSet {
    const row = this.db.prepare(`SELECT project_type_id FROM projects WHERE id = ?`).get(projectId) as { project_type_id: string | null } | undefined
    return this.projectTypeChain(row?.project_type_id || DEFAULT_PROJECT_TYPE_ID).features
  }

  /** Заготовки типа, слитые от корня к листу. */
  projectTypeDefaults(id: string): ProjectTypeDefaults {
    return resolveProjectTypeDefaults(this.projectTypeChain(id).nodes)
  }

  /** Есть ли у узла дети — нужно и для отказа при удалении, и для UI. */
  projectTypeHasChildren(id: string): boolean {
    const row = this.db.prepare(`SELECT 1 FROM project_types WHERE parent_id = ? LIMIT 1`).get(id)
    return Boolean(row)
  }

  projectTypeUsageCount(id: string): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM projects WHERE project_type_id = ?`).get(id) as { n: number }
    return row.n
  }

  private assertProjectTypeParent(parentId: string | null, selfId?: string): void {
    if (!parentId) return
    const parent = this.getProjectType(parentId)
    if (!parent) throw new Error('Родительский тип не найден')
    const ancestry = this.projectTypeAncestry(parentId)
    if (selfId && ancestry.some((node) => node.id === selfId)) throw new Error('Тип не может быть потомком самого себя')
    if (ancestry.length + 1 > MAX_PROJECT_TYPE_DEPTH) throw new Error(`Слишком глубокая вложенность типов (максимум ${MAX_PROJECT_TYPE_DEPTH})`)
  }

  createProjectType(userId: string, args: { parentId: string | null; name: string; description?: string; features?: ProjectFeatureOverride; defaults?: ProjectTypeDefaults }): ProjectTypeNode {
    const name = args.name.trim()
    if (!name) throw new Error('Название типа обязательно')
    this.assertProjectTypeParent(args.parentId)
    const id = this.newId()
    const ts = this.now()
    this.db.prepare(`
      INSERT INTO project_types (id, parent_id, name, description, features_json, defaults_json, builtin, owner_id, status, review_note, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'private', '', ?, ?, ?)
    `).run(id, args.parentId, name, args.description ?? '', JSON.stringify(args.features ?? {}), JSON.stringify(args.defaults ?? {}), userId, userId, ts, ts)
    this.invalidateProjectTypeCache()
    return this.getProjectType(id)!
  }

  updateProjectType(id: string, fields: { parentId?: string | null; name?: string; description?: string; features?: ProjectFeatureOverride; defaults?: ProjectTypeDefaults }): ProjectTypeNode | null {
    const current = this.getProjectType(id)
    if (!current) return null
    if (current.builtin) throw new Error('Встроенный тип нельзя изменить')
    if (fields.parentId !== undefined) this.assertProjectTypeParent(fields.parentId, id)
    const set: string[] = []
    const vals: unknown[] = []
    if (fields.parentId !== undefined) { set.push('parent_id = ?'); vals.push(fields.parentId) }
    if (fields.name !== undefined) {
      const name = fields.name.trim()
      if (!name) throw new Error('Название типа обязательно')
      set.push('name = ?'); vals.push(name)
    }
    if (fields.description !== undefined) { set.push('description = ?'); vals.push(fields.description) }
    if (fields.features !== undefined) { set.push('features_json = ?'); vals.push(JSON.stringify(fields.features)) }
    if (fields.defaults !== undefined) { set.push('defaults_json = ?'); vals.push(JSON.stringify(fields.defaults)) }
    if (!set.length) return current
    set.push('updated_at = ?'); vals.push(this.now())
    this.db.prepare(`UPDATE project_types SET ${set.join(', ')} WHERE id = ?`).run(...vals, id)
    this.invalidateProjectTypeCache()
    return this.getProjectType(id)
  }

  deleteProjectType(id: string): boolean {
    const current = this.getProjectType(id)
    if (!current) return false
    if (current.builtin) throw new Error('Встроенный тип нельзя удалить')
    // Отказ вместо каскада: иначе удаление узла тихо осиротило бы чужие проекты.
    if (this.projectTypeHasChildren(id)) throw new Error('У типа есть подтипы — сначала удалите или перенесите их')
    const used = this.projectTypeUsageCount(id)
    if (used > 0) throw new Error(`Тип используют проекты (${used}) — сначала переведите их на другой тип`)
    this.db.prepare(`DELETE FROM project_types WHERE id = ?`).run(id)
    this.invalidateProjectTypeCache()
    return true
  }

  /**
   * Смена статуса публикации с записью в аудит. Проверку прав делает роут;
   * здесь — инварианты самой модели.
   */
  setProjectTypeStatus(actor: string, id: string, status: ProjectTypeStatus, note = ''): ProjectTypeNode | null {
    const current = this.getProjectType(id)
    if (!current) return null
    if (current.builtin) throw new Error('Встроенный тип не участвует в публикации')
    if (status === 'pending' || status === 'published') {
      if (!canPublishProjectType(this.projectTypeAncestry(id))) {
        throw new Error('Сначала опубликуйте родительские типы — иначе общий тип повиснет на личном')
      }
    }
    if (status === 'private' && current.status === 'published') {
      const used = this.projectTypeUsageCount(id)
      const foreign = this.db.prepare(
        `SELECT COUNT(*) AS n FROM projects WHERE project_type_id = ? AND created_by <> ?`
      ).get(id, current.ownerId ?? '') as { n: number }
      if (foreign.n > 0) throw new Error(`Тип используют чужие проекты (${foreign.n} из ${used}) — отозвать публикацию нельзя`)
    }
    const ts = this.now()
    this.db.transaction(() => {
      this.db.prepare(`UPDATE project_types SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`)
        .run(status, note, actor, ts, ts, id)
      this.db.prepare(`INSERT INTO project_type_review_audit (type_id, actor, old_status, new_status, note, at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, actor, current.status, status, note, ts)
    })()
    this.invalidateProjectTypeCache()
    return this.getProjectType(id)
  }

  /**
   * Узел из текущего состояния проекта: «сохранить настроенный проект как подтип».
   *
   * Возможности снимаются ЭФФЕКТИВНЫЕ и записываются явными переопределениями —
   * иначе новый узел зависел бы от того, что потом сделают с родителем. Заготовки
   * берутся из самого проекта: видимые колонки доски, теги, навыки по типам
   * элементов и git/CI-настройки. Родитель — текущий тип проекта, поэтому узел
   * встаёт ровно на следующий уровень дерева.
   */
  deriveProjectType(userId: string, projectId: string, name: string): ProjectTypeNode | null {
    if (!this.isProjectOwner(userId, projectId)) return null
    const project = this.getProject(userId, projectId)
    if (!project) return null
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Название типа обязательно')

    const features: ProjectFeatureOverride = { ...this.projectTypeChain(project.typeId).features }
    const columns = this.db.prepare(
      `SELECT name, semantic_type FROM kanban_columns WHERE project_id = ? AND hidden = 0 ORDER BY position, created_at, id`
    ).all(projectId) as Array<{ name: string; semantic_type: string }>

    const defaults: ProjectTypeDefaults = {
      columns: columns.map((column) => ({ name: column.name, semanticType: column.semantic_type as ProjectTypeDefaults['columns'] extends Array<infer T> ? T extends { semanticType: infer S } ? S : never : never })),
      technologies: project.technologies,
      skills: project.skills,
      defaultSkills: project.defaultSkills,
      commitPolicy: project.commitPolicy,
      mergeTransport: project.mergeTransport,
      agentPlanApprovalMode: project.agentPlanApprovalMode,
      ...(project.ciBaseBranch ? { ciBaseBranch: project.ciBaseBranch } : {}),
      ...(project.ciBranchTemplate ? { ciBranchTemplate: project.ciBranchTemplate } : {}),
      ...(project.ciReuseStrategy ? { ciReuseStrategy: project.ciReuseStrategy } : {}),
      ...(project.testCommand ? { testCommand: project.testCommand } : {}),
      ...(project.doneRetentionDays !== undefined ? { doneRetentionDays: project.doneRetentionDays } : {})
    }
    return this.createProjectType(userId, { parentId: project.typeId, name: trimmed, description: `Из проекта «${project.name}»`, features, defaults })
  }

  projectTypeReviewAudit(id: string): Array<{ actor: string; oldStatus: string; newStatus: string; note: string; at: number }> {
    const rows = this.db.prepare(`SELECT actor, old_status, new_status, note, at FROM project_type_review_audit WHERE type_id = ? ORDER BY at, id`).all(id) as Array<{ actor: string; old_status: string; new_status: string; note: string; at: number }>
    return rows.map((r) => ({ actor: r.actor, oldStatus: r.old_status, newStatus: r.new_status, note: r.note, at: r.at }))
  }

  private mapProjectSummary(r: ProjectRow, myRole: string): ProjectSummary {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      typeId: r.project_type_id || DEFAULT_PROJECT_TYPE_ID,
      typeChain: this.projectTypeChain(r.project_type_id || DEFAULT_PROJECT_TYPE_ID),
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
  createProject(
    userId: string,
    args: { name: string; typeId?: string; description?: string; gitUrl?: string; technologies?: string[]; skills?: string[]; defaultSkills?: Partial<WorkItemDefaultSkills>; commitPolicy?: 'agent_commits' | 'final_system_commit' | 'manual_user_confirmation'; mergeTransport?: 'local' | 'github_pull_request'; agentPlanApprovalMode?: 'manual' | 'automatic' }
  ): ProjectDetail {
    const id = this.newId()
    const ts = this.now()
    // Заготовки типа — СНИМОК на момент создания: дальше проект живёт своей жизнью,
    // и правка типа не перекраивает работающую доску. Явный аргумент всегда важнее
    // заготовки: пользователь заполнил поле руками.
    const typeId = args.typeId && this.getProjectType(args.typeId) ? args.typeId : DEFAULT_PROJECT_TYPE_ID
    const seed = this.projectTypeDefaults(typeId)
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO projects (id, project_type_id, name, description, git_url, technologies, skills, created_by, created_at, updated_at, commit_policy, merge_transport, agent_plan_approval_mode, default_skills_epic, default_skills_story, default_skills_task, ci_base_branch, ci_branch_template, ci_reuse_strategy, test_command)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          typeId,
          args.name,
          args.description ?? '',
          args.gitUrl ?? null,
          JSON.stringify(args.technologies ?? seed.technologies ?? []),
          JSON.stringify(args.skills ?? seed.skills ?? []),
          userId,
          ts,
          ts,
          args.commitPolicy ?? seed.commitPolicy ?? 'agent_commits',
          args.mergeTransport ?? seed.mergeTransport ?? 'local',
          args.agentPlanApprovalMode ?? seed.agentPlanApprovalMode ?? 'manual',
          JSON.stringify(args.defaultSkills?.epic ?? seed.defaultSkills?.epic ?? []),
          JSON.stringify(args.defaultSkills?.story ?? seed.defaultSkills?.story ?? []),
          JSON.stringify(args.defaultSkills?.task ?? seed.defaultSkills?.task ?? []),
          seed.ciBaseBranch ?? 'main',
          seed.ciBranchTemplate ?? '{task_number}',
          seed.ciReuseStrategy ?? 'fail',
          seed.testCommand ?? ''
        )

      this.db
        .prepare(`INSERT INTO project_members (project_id, username, role, added_at) VALUES (?, ?, 'owner', ?)`)
        .run(id, userId, ts)
      // Колонки берутся из заготовок типа; у «Разработки ПО» их нет, и остаётся
      // системный конвейер. Для «Общего проекта» тип отдаёт короткий нейтральный
      // набор — 13 колонок QA-конвейера там были бы бессмысленны.
      ;(seed.columns?.length
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
      ] as [string, string][]).forEach(([name, semantic], i) =>
        this.db.prepare(`INSERT INTO kanban_columns (id, project_id, name, semantic_type, position, hidden, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`).run(this.newId(), id, name, semantic, (i + 1) * RANK_STEP, ts)
      )
      // Скелет раздела «Разработка проекта» заводит владелец статей — kb. Без него
      // раздел пустой, и «Исследовать проект» нечего сверять с кодом.
      this.repos.kb.seedProjectOverview({ projectId: id, name: args.name, description: args.description ?? '', createdBy: userId, ts })
    })()
    return this.getProject(userId, id) as ProjectDetail
  }

  countOwnedProjects(userId: string): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM project_members WHERE username = ? AND role = 'owner'`).get(userId) as { count: number }
    return row.count
  }

  listProjects(userId: string): ProjectSummary[] {
    const rows = this.db
      .prepare(
        `SELECT p.*, m.role AS my_role FROM projects p
         JOIN project_members m ON m.project_id = p.id
         WHERE m.username = ? ORDER BY p.updated_at DESC`
      )
      .all(userId) as Array<ProjectRow & { my_role: string }>
    return rows.map((r) => this.mapProjectSummary(r, r.my_role))
  }

  getProject(userId: string, id: string): ProjectDetail | null {
    const row = this.db
      .prepare(
        `SELECT p.*, m.role AS my_role FROM projects p
         JOIN project_members m ON m.project_id = p.id
         WHERE p.id = ? AND m.username = ?`
      )
      .get(id, userId) as (ProjectRow & { my_role: string }) | undefined
    if (!row) return null
    const members = (
      this.db
        .prepare(`SELECT pm.username, pm.role, pm.added_at, u.blocked FROM project_members pm JOIN users u ON u.name = pm.username WHERE pm.project_id = ? ORDER BY pm.added_at ASC`)
        .all(id) as Array<ProjectMemberRow & { blocked: number }>
    ).map(
      (m): ProjectMember => ({
        username: m.username,
        role: m.role === 'owner' ? 'owner' : 'member',
        addedAt: m.added_at,
        active: m.blocked === 0
      })
    )
    const machines = (
      this.db.prepare(
        `SELECT a.id AS agent_id,
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
         ORDER BY CASE WHEN a.user_id=? THEN 0 ELSE 1 END, a.name ASC`
      ).all(id, id, userId, userId, userId) as Array<{
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
    ).map((x) => {
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
        isMyDefault: this.repos.machines.getUserProjectDefaultMachine(userId, id) === x.agent_id,
        canUse: x.user_id === userId || !!x.shared,
        unavailableReason: null,
        load: this.repos.ci.countActiveCiRunsByAgent()[x.agent_id] ?? 0,
        online: false,
        addedAt: x.added_at,
        path: x.path ?? '', reposRoot: x.repos_root ?? '',
        storageId: x.storage_id, storage,
        availableStorages: x.user_id === userId ? this.repos.machines.listMachineStorages(userId, x.agent_id).map((item, index) => ({ ...item, primary: index === 0 })) : undefined,
        directories, recommendations,
        readiness: { ready: readinessReasons.length === 0, reasons: readinessReasons },
        sshHost: x.ssh_host ?? '', sshUser: x.ssh_user ?? ''
      }
    })
    return {
      ...this.mapProjectSummary(row, row.my_role),
      members,
      machines,
      defaultAgentId: row.default_agent_id ?? null
    }
  }

  updateProject(
    userId: string,
    id: string,
    fields: {
      name?: string
      description?: string
      gitUrl?: string | null
      previewUrl?: string | null
      testUsers?: import('@voicechat/shared').ProjectTestUser[]
      technologies?: string[]
      skills?: string[]
      defaultSkills?: Partial<WorkItemDefaultSkills>
      commitPolicy?: 'agent_commits' | 'final_system_commit' | 'manual_user_confirmation'
      mergeTransport?: 'local' | 'github_pull_request'
      agentPlanApprovalMode?: 'manual' | 'automatic'
      testCommand?: string
      componentQaCommand?: string
      integrationTestCommand?: string
      automatedQaCommand?: string
      automatedQaMode?: AutomatedQaMode
      automatedQaScenarios?: AutomatedQaScenario[]
      autoPilotDefault?: boolean
      autoPilotRequiresManualQa?: boolean
      autoPilotFixLimit?: number
      commandPolicy?: import('@voicechat/shared').ProjectCommandPolicy
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
  ): ProjectDetail | null {
    if (!this.isProjectOwner(userId, id)) return null
    const set: string[] = []
    const vals: unknown[] = []
    if (fields.typeId !== undefined) {
      // Меняются только ЖИВЫЕ возможности: доска, теги и CI-настройки проекта
      // остаются как есть — они были снимком заготовок на момент создания.
      if (!this.getProjectType(fields.typeId)) throw new Error('Тип проекта не найден')
      set.push('project_type_id = ?')
      vals.push(fields.typeId)
    }
    if (fields.name !== undefined) {
      set.push('name = ?')
      vals.push(fields.name)
    }
    if (fields.description !== undefined) {
      set.push('description = ?')
      vals.push(fields.description)
    }
    if (fields.gitUrl !== undefined) {
      set.push('git_url = ?')
      vals.push(fields.gitUrl)
    }
    if (fields.previewUrl !== undefined) {
      set.push('preview_url = ?')
      vals.push(fields.previewUrl)
    }
    if (fields.testUsers !== undefined) {
      set.push('test_users_json = ?')
      vals.push(JSON.stringify(fields.testUsers))
    }
    if (fields.technologies !== undefined) {
      set.push('technologies = ?')
      vals.push(JSON.stringify(fields.technologies))
    }
    if (fields.skills !== undefined) {
      set.push('skills = ?')
      vals.push(JSON.stringify(fields.skills))
    }
    if (fields.commitPolicy !== undefined) {
      set.push('commit_policy = ?')
      vals.push(fields.commitPolicy)
    }
    if (fields.mergeTransport !== undefined) {
      set.push('merge_transport = ?')
      vals.push(fields.mergeTransport)
    }
    if (fields.agentPlanApprovalMode !== undefined) {
      set.push('agent_plan_approval_mode = ?')
      vals.push(fields.agentPlanApprovalMode)
    }
    if (fields.testCommand !== undefined) { set.push('test_command = ?'); vals.push(fields.testCommand) }
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

    const ts = this.now()
    set.push('updated_at = ?')
    vals.push(ts)
    this.db.prepare(`UPDATE projects SET ${set.join(', ')} WHERE id = ?`).run(...vals, id)
    return this.getProject(userId, id)
  }

  deleteProject(userId: string, id: string): boolean {
    if (!this.isProjectOwner(userId, id)) return false
    // CASCADE удалит members/machines/columns/tasks.
    this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(id)
    return true
  }

  private auditProjectMemberRole(
    projectId: string,
    actor: string,
    targetUser: string,
    oldRole: 'owner' | 'member' | null,
    newRole: 'owner' | 'member' | null,
    action: 'add' | 'role_change' | 'remove',
    createdAt: number
  ): void {
    this.db.prepare(
      `INSERT INTO project_member_role_audit
       (id, project_id, target_user, actor, old_role, new_role, action, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(this.newId(), projectId, targetUser, actor, oldRole, newRole, action, createdAt)
  }

  addMember(userId: string, id: string, username: string): ProjectDetail | null {
    if (!this.isProjectOwner(userId, id)) return null
    if (!this.db.prepare(`SELECT 1 FROM users WHERE name = ?`).get(username)) {
      throw new Error(`Пользователь ${username} не найден`)
    }
    const ts = this.now()
    const inserted = this.db
      .prepare(`INSERT OR IGNORE INTO project_members (project_id, username, role, added_at) VALUES (?, ?, 'member', ?)`)
      .run(id, username, ts)
    if (inserted.changes) this.auditProjectMemberRole(id, userId, username, null, 'member', 'add', ts)
    return this.getProject(userId, id)
  }

  updateMemberRole(
    userId: string,
    id: string,
    username: string,
    role: 'owner' | 'member'
  ): ProjectDetail | null {
    if (!this.isProjectOwner(userId, id)) return null
    const change = this.db.transaction(() => {
      const row = this.db
        .prepare(`SELECT role FROM project_members WHERE project_id = ? AND username = ?`)
        .get(id, username) as { role: string } | undefined
      if (!row) throw new Error('Сначала добавьте пользователя в участники проекта')
      const oldRole = row.role === 'owner' ? 'owner' : 'member'
      if (oldRole === role) return
      if (oldRole === 'owner') {
        const owners = this.db
          .prepare(`SELECT COUNT(*) AS count FROM project_members WHERE project_id = ? AND role = 'owner'`)
          .get(id) as { count: number }
        if (owners.count <= 1) {
          throw new Error('Нельзя понизить последнего владельца. Сначала назначьте другого владельца')
        }
      }
      const ts = this.now()
      this.db.prepare(`UPDATE project_members SET role = ? WHERE project_id = ? AND username = ?`).run(role, id, username)
      this.auditProjectMemberRole(id, userId, username, oldRole, role, 'role_change', ts)
      this.touchProject(id, ts)
    })
    // IMMEDIATE получает write-lock до проверки количества владельцев: два
    // параллельных понижения не могут оба увидеть устаревший count.
    change.immediate()
    return this.getProject(userId, id)
  }

  removeMember(userId: string, id: string, username: string): ProjectDetail | null {
    if (!this.isProjectOwner(userId, id)) return null
    const remove = this.db.transaction(() => {
      const row = this.db
        .prepare(`SELECT role FROM project_members WHERE project_id = ? AND username = ?`)
        .get(id, username) as { role: string } | undefined
      if (!row) return
      const oldRole = row.role === 'owner' ? 'owner' : 'member'
      if (oldRole === 'owner') {
        const owners = this.db
          .prepare(`SELECT COUNT(*) AS count FROM project_members WHERE project_id = ? AND role = 'owner'`)
          .get(id) as { count: number }
        if (owners.count <= 1) {
          throw new Error('Нельзя удалить или вывести последнего владельца. Сначала назначьте другого владельца')
        }
      }
      const ts = this.now()
      this.db.prepare(`DELETE FROM project_members WHERE project_id = ? AND username = ?`).run(id, username)
      this.repos.tasks.unassignUserInProject(id, username, ts)
      this.auditProjectMemberRole(id, userId, username, oldRole, null, 'remove', ts)
      this.touchProject(id, ts)
    })
    remove.immediate()
    return this.getProject(userId, id)
  }

  listProjectMemberRoleAudit(projectId: string): Array<{
    targetUser: string
    actor: string
    oldRole: 'owner' | 'member' | null
    newRole: 'owner' | 'member' | null
    action: 'add' | 'role_change' | 'remove'
    createdAt: number
  }> {
    return (this.db.prepare(
      `SELECT target_user, actor, old_role, new_role, action, created_at
       FROM project_member_role_audit WHERE project_id = ? ORDER BY created_at, rowid`
    ).all(projectId) as Array<Record<string, unknown>>).map((row) => ({
      targetUser: String(row.target_user),
      actor: String(row.actor),
      oldRole: row.old_role === 'owner' ? 'owner' : row.old_role === 'member' ? 'member' : null,
      newRole: row.new_role === 'owner' ? 'owner' : row.new_role === 'member' ? 'member' : null,
      action: row.action as 'add' | 'role_change' | 'remove',
      createdAt: Number(row.created_at)
    }))
  }

  unlinkMachine(userId: string, id: string, agentId: string): ProjectDetail | null {
    if (!this.isProjectMember(userId, id)) return null
    this.repos.machines.setMachineSharedWithProject(userId, id, agentId, false)
    this.db.prepare(`UPDATE projects SET default_agent_id=NULL WHERE id=? AND default_agent_id=?`).run(id, agentId)
    return this.getProject(userId, id)
  }

  /** Назначить машину проекта по умолчанию (только владелец; машина должна быть в проекте). */
  setProjectDefaultMachine(userId: string, id: string, agentId: string): ProjectDetail | null {
    if (!this.isProjectOwner(userId, id)) return null
    const inProject = this.db
      .prepare(`SELECT 1 FROM project_machines WHERE project_id = ? AND agent_id = ?`)
      .get(id, agentId)
    if (!inProject) throw new Error('Машина не привязана к проекту')
    this.db.prepare(`UPDATE projects SET default_agent_id = ? WHERE id = ?`).run(agentId, id)
    this.touchProject(id)
    return this.getProject(userId, id)
  }

  createColumn(userId: string, projectId: string, name: string): KanbanColumn | null {
    if (!this.isProjectMember(userId, projectId)) return null
    const id = this.newId()
    const ts = this.now()
    const max = (
      this.db.prepare(`SELECT MAX(position) AS m FROM kanban_columns WHERE project_id = ?`).get(projectId) as {
        m: number | null
      }
    ).m
    const position = (max ?? 0) + RANK_STEP
    this.db
      .prepare(
        `INSERT INTO kanban_columns (id, project_id, name, position, hidden, created_at) VALUES (?, ?, ?, ?, 0, ?)`
      )
      .run(id, projectId, name, position, ts)
    this.touchProject(projectId, ts)
    return mapColumn({ id, project_id: projectId, name, semantic_type: 'custom', position, hidden: 0, wip_limit: null, created_at: ts })
  }

  renameColumn(userId: string, projectId: string, columnId: string, name: string): boolean {
    return this.updateColumn(userId, projectId, columnId, { name })
  }

  updateColumn(userId: string, projectId: string, columnId: string, fields: { name?: string; wipLimit?: number | null }): boolean {
    if (!this.isProjectMember(userId, projectId) || !this.columnInProject(projectId, columnId)) return false
    const set: string[] = []
    const vals: unknown[] = []
    if (fields.name !== undefined) {
      set.push('name = ?')
      vals.push(fields.name)
    }
    if (fields.wipLimit !== undefined) {
      set.push('wip_limit = ?')
      vals.push(fields.wipLimit != null && fields.wipLimit > 0 ? Math.floor(fields.wipLimit) : null)
    }
    if (!set.length) return true
    this.db.prepare(`UPDATE kanban_columns SET ${set.join(', ')} WHERE id = ? AND project_id = ?`).run(...vals, columnId, projectId)
    this.touchProject(projectId)
    return true
  }

  setColumnHidden(userId: string, projectId: string, columnId: string, hidden: boolean): boolean {
    if (!this.isProjectMember(userId, projectId) || !this.columnInProject(projectId, columnId)) return false
    this.db
      .prepare(`UPDATE kanban_columns SET hidden = ? WHERE id = ? AND project_id = ?`)
      .run(hidden ? 1 : 0, columnId, projectId)
    this.touchProject(projectId)
    return true
  }

  reorderColumns(userId: string, projectId: string, order: string[]): boolean {
    if (!this.isProjectMember(userId, projectId)) return false
    const ids = (
      this.db.prepare(`SELECT id FROM kanban_columns WHERE project_id = ?`).all(projectId) as Array<{ id: string }>
    ).map((x) => x.id)
    const known = new Set(ids)
    if (order.length !== ids.length || !order.every((o) => known.has(o))) return false
    const upd = this.db.prepare(`UPDATE kanban_columns SET position = ? WHERE id = ? AND project_id = ?`)
    this.db.transaction(() => {
      order.forEach((cid, i) => upd.run((i + 1) * RANK_STEP, cid, projectId))
    })()
    this.touchProject(projectId)
    return true
  }

  deleteColumn(userId: string, projectId: string, columnId: string): boolean {
    if (!this.isProjectMember(userId, projectId)) return false
    const semantic = this.db.prepare(`SELECT semantic_type FROM kanban_columns WHERE id = ? AND project_id = ?`).get(columnId, projectId) as { semantic_type: string } | undefined
    if (!semantic || semantic.semantic_type !== 'custom') return false
    // CASCADE удалит задачи пользовательской колонки.
    const info = this.db.prepare(`DELETE FROM kanban_columns WHERE id = ? AND project_id = ?`).run(columnId, projectId)
    if (info.changes) this.touchProject(projectId)
    return info.changes > 0
  }

  /** Навыки по умолчанию проекта для типа элемента (из настроек проекта). */
  projectDefaultSkills(projectId: string, type: WorkItemType): string[] {
    const row = this.db
      .prepare(`SELECT default_skills_epic, default_skills_story, default_skills_task FROM projects WHERE id = ?`)
      .get(projectId) as
      | { default_skills_epic: string; default_skills_story: string; default_skills_task: string }
      | undefined
    if (!row) return []
    const raw = type === 'epic' ? row.default_skills_epic : type === 'story' ? row.default_skills_story : row.default_skills_task
    return parseStringArray(raw)
  }

  /** Право редактировать чужую запись: автор, владелец проекта или админ. */
  canModerateTaskEntry(userId: string, projectId: string, author: string): boolean {
    if (userId === author) return true
    if (this.repos.identity.getUser(userId)?.role === 'admin') return true
    const owner = this.db.prepare(`SELECT 1 FROM project_members WHERE project_id = ? AND username = ? AND role = 'owner'`).get(projectId, userId)
    return Boolean(owner)
  }

  /** Найти системную колонку проекта для автоматического перехода CI. */
  getColumnIdBySemantic(projectId: string, semanticType: KanbanColumnSemanticType): string | null {
    const row = this.db.prepare(`SELECT id FROM kanban_columns WHERE project_id = ? AND semantic_type = ? ORDER BY position LIMIT 1`).get(projectId, semanticType) as { id: string } | undefined
    return row?.id ?? null
  }

  // ============== Структурированное ручное QA =================
  canQa(userId: string, projectId: string): boolean {
    const row = this.db.prepare(`SELECT role, qa_permission FROM project_members WHERE project_id = ? AND username = ?`).get(projectId, userId) as { role: string; qa_permission: number } | undefined
    return !!row && (row.role === 'owner' || !!row.qa_permission)
  }

  /** Следующий номер задачи проекта (CHAT-N): счётчик живёт в projects, выдаёт его владелец. */
  nextTaskSeq(projectId: string): number {
    return (this.db.prepare(`UPDATE projects SET task_seq = task_seq + 1 WHERE id = ? RETURNING task_seq`).get(projectId) as { task_seq: number }).task_seq
  }

  /**
   * Часть каскада удаления аккаунта: живые приглашения закрываем (иначе при повторной
   * регистрации того же логина или адреса они снова к нему привяжутся), членства
   * убираем, осиротевшие без владельца проекты удаляем. Зовётся из identity внутри
   * его транзакции.
   */
  detachDeletedUser(userId: string, email: string): void {
    this.db.prepare(
      `UPDATE project_invitations SET status='revoked', responded_at=?
       WHERE status='pending' AND (invited_username = ? OR (? <> '' AND email = ?))`
    ).run(this.now(), userId, email, email)
    this.db.prepare(`DELETE FROM project_members WHERE username = ?`).run(userId)
    this.db
      .prepare(
        `DELETE FROM projects WHERE id IN (
           SELECT p.id FROM projects p
           WHERE NOT EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.role = 'owner')
         )`
      )
      .run()
  }

  /** Машина удаляется: проекты теряют её как машину по умолчанию и как прод-машину. */
  detachAgent(agentId: string): void {
    this.db.prepare(`UPDATE projects SET default_agent_id = NULL WHERE default_agent_id = ?`).run(agentId)
    this.db.prepare(`UPDATE projects SET production_agent_id = NULL WHERE production_agent_id = ?`).run(agentId)
  }
}
