// Домен «tasks»: таблицы tasks, task_comments, task_worklog, task_history, task_designs, task_creation_requests, task_creation_audit, task_improvements, task_rework_cycles, task_rework_attachments, task_repositories, task_launch_results, task_preparation_runs, task_preparation_events, task_preparation_steps, task_preparation_questions, task_preparation_notification_dismissals, assistant_orchestrations, assistant_orchestration_items.
// Файл получен разрезанием бывшего VoiceChatDb (apps/server/src/db/database.ts) по владению таблицами;
// карта владения — ./ownership.ts, правила — docs/plans/db-repositories.md.
import { type Board, type Task, type TaskRunResult, normalizeTaskRunOutcome, type TaskPriority, type WorkItemType, type TaskChatBadge, type TaskChatContext, type TaskChatCrumb, type TaskDesignLink, type MakeTaskLink, type MakeLinkableTask, issueKey, completedVisibilityCutoff, applyTaskStatuses, type TaskStatus, type BoardStatuses, compareTasksInColumn, type MergeRun, type TaskRepository, ACTIVE_MERGE_STATUSES } from '@voicechat/shared'
import { MAKE_KIND, normalizeMakePath } from '@voicechat/make-contracts/make'
import { BaseRepo } from './base.js'
import { RANK_STEP, parseStringArray, mapColumn, mapCiRun, type ColumnRow, type TaskRow, type CiRunRow } from './support.js'

/** Порог схлопывания дробного ранга — ниже него колонка ренормализуется. */
const RANK_EPS = 1e-6

/** Заголовок автозадачи учёта «влито в прод-ветку, но прод не пересобран». */
export const PROD_REBUILD_TASK_TITLE = 'Пересборка прода'

/** Первая строка описания автозадачи — дальше идёт список вмерженных задач. */
export const PROD_REBUILD_TASK_INTRO = 'Влито в прод-ветку, но прод-контейнер в ране не пересобирался. Пересобрать прод для задач:'

/** Валидный приоритет (неизвестное → medium). */
function normPriority(raw: string): TaskPriority {
  return raw === 'low' || raw === 'high' || raw === 'urgent' || raw === 'medium' ? raw : 'medium'
}

function normWorkItemType(raw: string): WorkItemType {
  return raw === 'epic' || raw === 'story' ? raw : 'task'
}

/** Колонки, из которых собирается карточка доски: без тяжёлых текстов задачи. */
const BOARD_TASK_COLUMNS = [
  'id', 'project_id', 'column_id', 'title', 'type', 'parent_id', 'source_task_id', 'priority', 'assignee',
  'created_by', 'created_by_name', 'agent_id', 'labels', 'skills', 'story_points', 'due_date', 'flagged',
  'auto_pilot', 'auto_pilot_requires_manual_qa', 'auto_pilot_fix_cycles', 'done_at', 'preview_ready', 'seq', 'position', 'created_at', 'updated_at'
].join(', ')

/**
 * Скелет карточки: только собственные колонки `tasks`. Состояние процессов
 * (чат, merge, подготовка, последний ран) сюда не входит — его накладывает
 * `mapTaskStatus` из второй фазы доски.
 */
function mapTaskCore(r: TaskRow): Task {
  return {
    id: r.id,
    projectId: r.project_id,
    columnId: r.column_id,
    type: normWorkItemType(r.type),
    parentId: r.parent_id,
    sourceTaskId: r.source_task_id ?? null,
    title: r.title,
    description: r.description ?? '',
    acceptanceCriteria: r.acceptance_criteria ?? '',
    priority: normPriority(r.priority),
    assignee: r.assignee,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    agentId: r.agent_id ?? null,
    labels: parseStringArray(r.labels),
    skills: parseStringArray(r.skills),
    storyPoints: r.story_points ?? null,

    dueDate: r.due_date ?? null,
    flagged: r.flagged !== 0,
    autoPilot: r.auto_pilot !== 0,
    autoPilotRequiresManualQa: r.auto_pilot_requires_manual_qa === 1,
    autoPilotFixCycles: r.auto_pilot_fix_cycles ?? 0,
    doneAt: r.done_at ?? null,
    previewReady: r.preview_ready !== 0,
    seq: r.seq ?? 0,
    position: r.position,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

/** Скелет плюс состояние процессов — полная карточка одного SELECT-а. */
function mapTask(r: TaskRow): Task {
  return {
    ...mapTaskCore(r),
    chatId: r.chat_id ?? null,
    mergeSourceBranch: r.merge_source_branch ?? null,
    mergeSourceSha: r.merge_source_sha ?? null,
    activeMergeRunId: r.active_merge_run_id ?? null,
    latestMergeRunId: r.latest_merge_run_id ?? null,
    activeMergeStatus: r.active_merge_status ?? null,
    mergePermitted: r.merge_permitted !== 0,
    mergeMachineBound: r.merge_machine_bound !== 0,
    mergedSha: r.merged_sha ?? null,
    mergedSourceSha: r.merged_source_sha ?? null,
    taskPreparationRunId: r.task_preparation_run_id ?? null,
    taskPreparationStatus: (r.task_preparation_status as Task['taskPreparationStatus']) ?? null,
    taskPreparationError: r.task_preparation_error ?? null,
    taskPreparationLog: r.task_preparation_log ?? null
  }
}

function mapTaskRepository(r: Record<string, unknown>): TaskRepository {
  return {
    id: String(r.id), projectId: String(r.project_id), taskId: String(r.task_id), agentId: String(r.agent_id),
    machineName: (r.machine_name as string | null) ?? null, path: String(r.path), kind: r.kind as TaskRepository['kind'],
    state: r.state as TaskRepository['state'], createdAt: Number(r.created_at), deletedAt: r.deleted_at as number | null
  }
}
/** Черновик доработки в том виде, в котором его присылает карточка задачи. */
export interface ReworkDraftInput {
  description: string
  criteria: string[]
  makeSources: Array<{ conversationId: string; title?: string; mode: 'whole_project' | 'files'; paths: string[] }>
}

export class TasksRepo extends BaseRepo {

  /**
   * Снапшот доски целиком: скелет карточек плюс состояние их процессов. Клиент
   * грузит эти две фазы отдельными запросами (доска рисуется, не дожидаясь
   * статусов); здесь они склеены для MCP, автопрохода и тестов.
   */
  async getBoard(userId: string, projectId: string, opts?: { includeCompleted?: boolean }): Promise<Board | null> {
    const board = await this.getBoardSkeleton(userId, projectId, opts)
    if (!board) return null
    const statuses = await this.getBoardStatuses(userId, projectId, opts)
    return { columns: board.columns, tasks: applyTaskStatuses(board.tasks, statuses?.tasks ?? []), ciRuns: statuses?.ciRuns ?? [], projects: board.projects }
  }

  /**
   * Первая фаза доски: колонки и лёгкие карточки — что за задача и где лежит.
   * Один запрос к `tasks` без единого join: доска обязана появляться сразу,
   * а состояние процессов приезжает следом (`getBoardStatuses`).
   *
   * По умолчанию задачи, завершённые дольше порога проекта
   * (`doneRetentionDays`), с доски убраны — как в Jira. Из БД они не удаляются:
   * приходят с `includeCompleted` и открываются по прямой ссылке. Отсечка
   * считается границей `doneAt` и уходит в SQL — иначе колонка «Готово»
   * вычитывалась бы целиком только ради того, чтобы её отбросить.
   */
  async getBoardSkeleton(userId: string, projectId: string, opts?: { includeCompleted?: boolean }): Promise<Board | null> {
    if (!(await this.repos.projects.isProjectMember(userId, projectId))) return null
    const columns = (
      (await this.sql.all(`SELECT * FROM kanban_columns WHERE project_id = ? ORDER BY position ASC, created_at ASC`, [projectId])) as ColumnRow[]
    ).map(mapColumn)
    const cutoff = await this.boardDoneCutoff(projectId, opts)
    // Читаем ровно те колонки, из которых складывается карточка. `SELECT *` тянул
    // бы вместе с ними описание и критерии приёмки — многие килобайты на задачу,
    // которые доска всё равно гасит: сотни карточек превращали ответ в мегабайты.
    const tasks = (
      (await this.sql.all(`SELECT ${BOARD_TASK_COLUMNS} FROM tasks
             WHERE project_id = @projectId AND (@cutoff IS NULL OR done_at IS NULL OR done_at >= @cutoff)
             ORDER BY column_id ASC, position ASC`, [{ projectId, cutoff }])) as TaskRow[]
      // Тексты карточка получает при открытии (`getTaskDetail` → TaskModal).
    ).map((row) => ({ ...mapTaskCore(row), description: '', acceptanceCriteria: '' }))
    const semanticByColumnId = new Map(columns.map((column) => [column.id, column.semanticType]))
    tasks.sort((a, b) => {
      if (a.columnId !== b.columnId) return a.columnId.localeCompare(b.columnId)
      return compareTasksInColumn(a, b, semanticByColumnId.get(a.columnId) ?? 'custom')
    })
    // Local Core mode keeps projects flat: the board covers only the requested project.
    const project = (await this.sql.get(`SELECT name FROM projects WHERE id = ?`, [projectId])) as { name: string } | undefined
    return { columns, tasks, projects: [{ id: projectId, name: project?.name ?? '' }] }
  }

  /**
   * Вторая фаза доски: что происходит с карточками — связанный чат, merge,
   * подготовка, последний результат любого этапа и сводки CI-ранов.
   *
   * Всё собирается запросами «по проекту целиком» с оконной функцией вместо
   * коррелированных подзапросов на карточку: прежний снапшот на 400 задач
   * выполнял тысячи запросов и держал event loop сервера секундами — а он один
   * на все соединения, так что вместе с доской ждали и login, и health.
   */
  async getBoardStatuses(userId: string, projectId: string, opts?: { includeCompleted?: boolean }): Promise<BoardStatuses | null> {
    if (!(await this.repos.projects.isProjectMember(userId, projectId))) return null
    const cutoff = await this.boardDoneCutoff(projectId, opts)
    // Подзапрос «задачи доски» повторяется в каждом запросе фазы: он идёт по
    // индексу (project_id) и дешевле, чем список из сотен плейсхолдеров.
    const scope = `SELECT id FROM tasks WHERE project_id = @projectId AND (@cutoff IS NULL OR done_at IS NULL OR done_at >= @cutoff)`
    const args = { projectId, cutoff }

    const chatByTask = new Map(
      ((await this.sql.all(`SELECT task_id, id FROM (
           SELECT c.task_id AS task_id, c.id AS id,
                  ROW_NUMBER() OVER (PARTITION BY c.task_id ORDER BY c.created_at ASC) AS rn
             FROM conversations c
            WHERE c.user_id = @userId AND c.task_id IN (${scope})
         ) WHERE rn = 1`, [{ ...args, userId }])) as Array<{ task_id: string; id: string }>).map((r) => [r.task_id, r.id])
    )

    // Последняя отправленная рабочая копия задачи: из неё и ветка с SHA, и
    // ответ на вопрос, доступна ли машина этого воркспейса текущему проекту.
    const workspaceByTask = new Map(
      ((await this.sql.all(`SELECT task_id, branch, commit_sha, agent_id FROM (
           SELECT w.task_id AS task_id, w.branch AS branch, w.commit_sha AS commit_sha, w.agent_id AS agent_id,
                  ROW_NUMBER() OVER (PARTITION BY w.task_id ORDER BY w.created_at DESC) AS rn
             FROM ci_workspaces w
            WHERE w.pushed = 1 AND w.task_id IN (${scope})
         ) WHERE rn = 1`, [args])) as Array<{ task_id: string; branch: string | null; commit_sha: string | null; agent_id: string | null }>)
        .map((r) => [r.task_id, r])
    )
    const boundAgentIds = new Set(
      ((await this.sql.all(`SELECT a.id FROM agents a
          WHERE a.user_id = @userId
             OR EXISTS(SELECT 1 FROM project_machines pm WHERE pm.project_id = @projectId AND pm.agent_id = a.id)`, [{ projectId, userId }])) as Array<{ id: string }>).map((r) => r.id)
    )

    const mergeRuns = await this.latestByTask<{ task_id: string; id: string; status: string; merge_sha: string | null; source_sha: string | null }>(
      `SELECT task_id, id, status, merge_sha, source_sha, created_at FROM merge_runs WHERE task_id IN (${scope})`,
      args
    )
    const preparationRuns = await this.latestByTask<{ task_id: string; id: string; status: string; error: string | null }>(
      `SELECT task_id, id, status, error, created_at FROM task_preparation_runs WHERE task_id IN (${scope})`,
      args
    )
    const runResultByTask = await this.latestTaskRunResults(scope, args)
    // Право на merge — свойство участника в проекте, а не карточки: считаем один
    // раз, а не по разу на каждую из сотен задач, как было в подзапросе доски.
    const mergePermitted = Boolean(
      await this.sql.get(`SELECT 1 FROM project_members WHERE project_id = ? AND username = ? AND role = 'owner'`, [projectId, userId])
    )

    const taskIds = ((await this.sql.all(scope, [args])) as Array<{ id: string }>).map((r) => r.id)
    const tasks: TaskStatus[] = taskIds.map((taskId) => {
      const workspace = workspaceByTask.get(taskId)
      const merges = mergeRuns.get(taskId) ?? []
      const activeMerge = merges.find((run) => ACTIVE_MERGE_STATUSES.includes(run.status as MergeRun['status']))
      const successMerge = merges.find((run) => run.status === 'success')
      const preparation = preparationRuns.get(taskId)?.[0] ?? null
      return {
        taskId,
        chatId: chatByTask.get(taskId) ?? null,
        mergeSourceBranch: workspace?.branch ?? null,
        mergeSourceSha: workspace?.commit_sha ?? null,
        activeMergeRunId: activeMerge?.id ?? null,
        latestMergeRunId: merges[0]?.id ?? null,
        activeMergeStatus: activeMerge?.status ?? null,
        mergePermitted,
        mergeMachineBound: Boolean(workspace?.agent_id && boundAgentIds.has(workspace.agent_id)),
        mergedSha: successMerge?.merge_sha ?? null,
        mergedSourceSha: successMerge?.source_sha ?? null,
        taskPreparationRunId: preparation?.id ?? null,
        taskPreparationStatus: (preparation?.status as Task['taskPreparationStatus']) ?? null,
        taskPreparationError: preparation?.error ?? null,
        latestRunResult: runResultByTask.get(taskId) ?? null
      }
    })
    return { tasks, ciRuns: await this.repos.ci.latestCiRunSummaries(projectId, { sql: scope, args }) }
  }

  /** Граница `done_at` для доски: `null` — показывать всё, включая старое «Готово». */
  private async boardDoneCutoff(projectId: string, opts?: { includeCompleted?: boolean }): Promise<number | null> {
    return opts?.includeCompleted ? null : completedVisibilityCutoff(await this.repos.projects.doneRetentionDays(projectId), this.now())
  }

  /**
   * Строки источника, сгруппированные по задаче и отсортированные «свежие
   * сверху». Источник обязан отдавать `task_id` и `created_at`; фильтр по
   * задачам доски уже внутри запроса.
   */
  private async latestByTask<T extends { task_id: string }>(sql: string, args: Record<string, unknown>): Promise<Map<string, T[]>> {
    const rows = (await this.sql.all(`${sql} ORDER BY created_at DESC, rowid DESC`, [args])) as T[]
    const grouped = new Map<string, T[]>()
    for (const row of rows) {
      const list = grouped.get(row.task_id)
      if (list) list.push(row)
      else grouped.set(row.task_id, [row])
    }
    return grouped
  }

  /**
   * Полная задача по id (с тяжёлыми полями: описание, критерии, лог подготовки),
   * которые доска намеренно не отдаёт. TaskModal грузит её при открытии карточки.
   */
  async getTaskDetail(userId: string, projectId: string, taskId: string): Promise<Task | null> {
    if (!(await this.repos.projects.isProjectMember(userId, projectId))) return null
    const row = (await this.sql.get(`SELECT t.*, (SELECT c.id FROM conversations c WHERE c.task_id = t.id AND c.user_id = ?
                      ORDER BY c.created_at ASC LIMIT 1) AS chat_id,
           (SELECT w.branch FROM ci_workspaces w WHERE w.task_id=t.id AND w.pushed=1 ORDER BY w.created_at DESC LIMIT 1) AS merge_source_branch,
           (SELECT w.commit_sha FROM ci_workspaces w WHERE w.task_id=t.id AND w.pushed=1 ORDER BY w.created_at DESC LIMIT 1) AS merge_source_sha,
           (SELECT r.id FROM merge_runs r WHERE r.task_id=t.id AND r.status IN ('queued','checking','fetching','merging','resolving_conflicts','kb_update','testing','pushing') ORDER BY r.created_at DESC LIMIT 1) AS active_merge_run_id,
           (SELECT r.id FROM merge_runs r WHERE r.task_id=t.id ORDER BY r.created_at DESC LIMIT 1) AS latest_merge_run_id,
           (SELECT r.status FROM merge_runs r WHERE r.task_id=t.id AND r.status IN ('queued','checking','fetching','merging','resolving_conflicts','kb_update','testing','pushing') ORDER BY r.created_at DESC LIMIT 1) AS active_merge_status,
           EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=t.project_id AND pm.username=? AND pm.role='owner') AS merge_permitted,
           EXISTS(
             SELECT 1 FROM ci_workspaces w JOIN agents a ON a.id=w.agent_id
             WHERE w.id=(SELECT latest.id FROM ci_workspaces latest WHERE latest.task_id=t.id AND latest.pushed=1 ORDER BY latest.created_at DESC LIMIT 1)
               AND (a.user_id=? OR EXISTS(SELECT 1 FROM project_machines pm WHERE pm.project_id=t.project_id AND pm.agent_id=a.id))
           ) AS merge_machine_bound,
           (SELECT r.merge_sha FROM merge_runs r WHERE r.task_id=t.id AND r.status='success' ORDER BY r.created_at DESC LIMIT 1) AS merged_sha,
           (SELECT r.source_sha FROM merge_runs r WHERE r.task_id=t.id AND r.status='success' ORDER BY r.created_at DESC LIMIT 1) AS merged_source_sha,
           (SELECT p.id FROM task_preparation_runs p WHERE p.task_id=t.id ORDER BY p.created_at DESC LIMIT 1) AS task_preparation_run_id,
           (SELECT p.status FROM task_preparation_runs p WHERE p.task_id=t.id ORDER BY p.created_at DESC LIMIT 1) AS task_preparation_status,
           (SELECT p.error FROM task_preparation_runs p WHERE p.task_id=t.id ORDER BY p.created_at DESC LIMIT 1) AS task_preparation_error,
           (SELECT p.log FROM task_preparation_runs p WHERE p.task_id=t.id ORDER BY p.created_at DESC LIMIT 1) AS task_preparation_log
         FROM tasks t WHERE t.id = ? AND t.project_id = ? LIMIT 1`, [userId, userId, userId, taskId, projectId])) as TaskRow | undefined
    if (!row) return null
    return { ...mapTask(row), latestRunResult: await this.latestTaskRunResult(row.id), designs: await this.taskDesigns(row.id) }
  }

  /**
   * Связи задачи с дизайнами. Имя и владелец Make-проекта приезжают вместе со
   * связью: карточка показывает список, не загружая список чатов.
   */
  async taskDesigns(taskId: string): Promise<TaskDesignLink[]> {
    const rows = (await this.sql.all(`SELECT d.id, d.task_id, d.conversation_id, d.path, d.mode, d.paths_json, d.label, d.created_at, d.created_by,
                c.title AS conversation_title, c.user_id AS conversation_owner
           FROM task_designs d JOIN conversations c ON c.id = d.conversation_id
          WHERE d.task_id = ?
          ORDER BY d.created_at ASC`, [taskId])) as Array<{
        id: string; task_id: string; conversation_id: string; path: string; mode: string; paths_json: string; label: string
        created_at: number; created_by: string | null; conversation_title: string; conversation_owner: string | null
      }>
    const grouped = new Map<string, TaskDesignLink>()
    for (const r of rows) {
      const rowMode = r.mode === 'files' ? 'files' : 'whole_project'
      const rowPaths = rowMode === 'files' ? (JSON.parse(r.paths_json) as string[]) : []
      const current = grouped.get(r.conversation_id)
      if (current) {
        if (current.mode === 'whole_project' || rowMode === 'whole_project') {
          current.mode = 'whole_project'
          current.paths = []
          current.path = ''
        } else {
          current.paths = [...new Set([...current.paths, ...rowPaths])].sort((a, b) => a.localeCompare(b))
          current.path = current.paths[0] ?? ''
        }
        if (!current.label && r.label) current.label = r.label
        continue
      }
      grouped.set(r.conversation_id, {
        id: r.id, taskId: r.task_id, conversationId: r.conversation_id,
        conversationTitle: r.conversation_title, conversationOwner: r.conversation_owner,
        mode: rowMode, paths: rowPaths, path: rowMode === 'files' ? rowPaths[0] ?? r.path : '',
        label: r.label, createdAt: r.created_at, createdBy: r.created_by
      })
    }
    return [...grouped.values()].sort((a, b) => a.conversationId.localeCompare(b.conversationId))
  }

  /** Проверяет, что новую дизайн-связь создаёт владелец Make-проекта. */
  async assertTaskDesignSource(userId: string, projectId: string, taskId: string, conversationId: string, transfer = false): Promise<void> {
    if (!(await this.repos.projects.isProjectMember(userId, projectId))) throw new Error('Пользователь не состоит в проекте')
    if (!(await this.getTask(projectId, taskId))) throw new Error('Задача не найдена в проекте')
    const conv = (await this.sql.get(`SELECT id, assistant_kind, project_id, user_id FROM conversations WHERE id = ?`, [conversationId])) as { id: string; assistant_kind: string | null; project_id: string | null; user_id: string | null } | undefined
    if (!conv || conv.assistant_kind !== MAKE_KIND) throw new Error('Дизайн берётся только из проекта Make')
    if (!transfer && conv.project_id !== projectId) throw new Error('Make-проект не привязан к этому проекту')
    if (conv.user_id !== userId) throw new Error('Можно связать только свой Make-проект')
  }

  /**
   * Связывает карточку с принадлежащим пользователю Make-проектом, который
   * привязан к тому же обычному проекту.
   */
  async linkTaskDesign(
    userId: string,
    projectId: string,
    taskId: string,
    args: { conversationId: string; mode?: 'whole_project' | 'files'; paths?: string[]; path?: string; label?: string },
    options: { transfer?: boolean } = {}
  ): Promise<TaskDesignLink[]> {
    await this.assertTaskDesignSource(userId, projectId, taskId, args.conversationId, options.transfer)
    const legacyPath = (args.path ?? '').trim()
    const mode = args.mode ?? (legacyPath ? 'files' : 'whole_project')
    const inputPaths = args.paths ?? (legacyPath ? [legacyPath] : [])
    if (mode === 'whole_project' && inputPaths.length) throw new Error('Режим всего проекта несовместим с отдельными файлами')
    if (mode === 'files' && inputPaths.length === 0) throw new Error('Выберите хотя бы один файл Make-проекта')
    const normalized = inputPaths.map((value) => normalizeMakePath(value))
    if (normalized.some((value, index) => value === null || value !== inputPaths[index])) throw new Error('Путь файла дизайна должен быть каноническим относительным путём')
    const paths = [...new Set(normalized as string[])].sort((a, b) => a.localeCompare(b))
    const path = mode === 'files' ? paths[0]! : ''
    const label = (args.label ?? '').trim().slice(0, 120)
    const replace = () => this.sql.transaction(async () => {
      await this.sql.run(`DELETE FROM task_designs WHERE task_id = ? AND conversation_id = ?`, [taskId, args.conversationId])
      await this.sql.run(`INSERT INTO task_designs (id, task_id, conversation_id, path, mode, paths_json, label, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [this.newId(), taskId, args.conversationId, path, mode, JSON.stringify(paths), label, userId, this.now()])
    })
    await replace()
    await this.repos.projects.touchProject(projectId, this.now())
    return await this.taskDesigns(taskId)
  }

  async unlinkTaskDesign(userId: string, projectId: string, taskId: string, linkId: string): Promise<TaskDesignLink[] | null> {
    if (!(await this.repos.projects.isProjectMember(userId, projectId))) return null
    if (!(await this.getTask(projectId, taskId))) return null
    await this.sql.run(`DELETE FROM task_designs WHERE id = ? AND task_id = ?`, [linkId, taskId])
    await this.repos.projects.touchProject(projectId, this.now())
    return await this.taskDesigns(taskId)
  }

  /**
   * Обратное направление: какие карточки ссылаются на Make-проект (или на его
   * страницу). Доступ проверяет вызывающий роут — там же, где право на сам
   * Make-проект.
   */
  async makeTaskLinks(conversationId: string, path?: string): Promise<MakeTaskLink[]> {
    const rows = (await this.sql.all(`SELECT d.id, d.path, d.label, d.created_at, t.id AS task_id, t.title, t.seq, t.project_id,
                p.name AS project_name, kc.name AS column_name
           FROM task_designs d
           JOIN tasks t ON t.id = d.task_id
           JOIN projects p ON p.id = t.project_id
           LEFT JOIN kanban_columns kc ON kc.id = t.column_id
          WHERE d.conversation_id = ?${path === undefined ? '' : ' AND d.path = ?'}
          ORDER BY d.created_at ASC`, [...(path === undefined ? [conversationId] : [conversationId, path])])) as Array<{
        id: string; path: string; label: string; created_at: number; task_id: string; title: string
        seq: number; project_id: string; project_name: string; column_name: string | null
      }>
    return rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      projectId: r.project_id,
      taskKey: issueKey(r.project_name, { seq: r.seq }),
      taskTitle: r.title,
      columnName: r.column_name,
      path: r.path,
      label: r.label,
      createdAt: r.created_at
    }))
  }

  /** Карточки проекта Make-чата — выбор в диалоге «Связать с задачей». */
  async makeLinkableTasks(userId: string, conversationId: string): Promise<MakeLinkableTask[]> {
    const conv = (await this.sql.get(`SELECT project_id FROM conversations WHERE id = ? AND assistant_kind = ?`, [conversationId, MAKE_KIND])) as { project_id: string | null } | undefined
    const projectId = conv?.project_id
    if (!projectId || !(await this.repos.projects.isProjectMember(userId, projectId))) return []
    const rows = (await this.sql.all(`SELECT t.id, t.title, t.seq, t.project_id, p.name AS project_name, kc.name AS column_name
           FROM tasks t JOIN projects p ON p.id = t.project_id
           LEFT JOIN kanban_columns kc ON kc.id = t.column_id
          WHERE t.project_id = ? ORDER BY t.seq DESC`, [projectId])) as Array<{ id: string; title: string; seq: number; project_id: string; project_name: string; column_name: string | null }>
    return rows.map((r) => ({
      taskId: r.id,
      projectId: r.project_id,
      taskKey: issueKey(r.project_name, { seq: r.seq }),
      title: r.title,
      columnName: r.column_name
    }))
  }

  /**
   * Контекст задачи для шапки связанного чата: иерархия Эпик→Стори→Задача,
   * этап воркфлоу (колонка), машина и папка разработки, последний CI-ран.
   * `null`, если чат не привязан к задаче.
   */
  async getTaskChatContext(userId: string, conversationId: string, isOnline?: (agentId: string) => boolean): Promise<TaskChatContext | null> {
    const conv = await this.repos.chat.getConversation(userId, conversationId)
    if (!conv?.taskId || !conv.projectId) return null
    const project = await this.repos.projects.getProject(userId, conv.projectId)
    if (!project) return null
    const task = await this.getTask(conv.projectId, conv.taskId)
    if (!task) return null

    const crumb = (t: Task): TaskChatCrumb => ({ id: t.id, title: t.title, key: issueKey(project.name, t) })
    const parent = task.parentId ? await this.getTask(conv.projectId, task.parentId) : null
    const grandParent = parent?.parentId ? await this.getTask(conv.projectId, parent.parentId) : null
    // Родитель задачи — стори или сразу эпик; у стори родитель всегда эпик.
    const story = parent?.type === 'story' ? parent : null
    const epic = parent?.type === 'epic' ? parent : grandParent?.type === 'epic' ? grandParent : null

    const column = (await this.sql.get(`SELECT name, semantic_type FROM kanban_columns WHERE id = ?`, [task.columnId])) as
      | { name: string; semantic_type: string | null }
      | undefined
    const resolution = await this.repos.chat.resolveConversationMachine(userId, conversationId, { isOnline })
    const agentId = resolution?.error ? null : resolution?.agentId ?? null
    const machine = agentId ? project.machines.find((m) => m.agentId === agentId) : undefined
    const displaySummary = await this.repos.ci.latestCiRunSummary(task.id)
    const runRow = displaySummary ? (await this.sql.get(`SELECT * FROM ci_runs WHERE id = ?`, [displaySummary.id])) as CiRunRow | undefined : undefined
    const run = runRow ? mapCiRun(runRow) : null

    return {
      conversationId: conv.id,
      projectId: project.id,
      projectName: project.name,
      epic: epic ? crumb(epic) : null,
      story: story ? crumb(story) : null,
      task: { ...crumb(task), type: task.type },
      columnName: column?.name ?? '',
      columnSemantic: (column?.semantic_type as TaskChatContext['columnSemantic']) ?? null,
      agentId: agentId ?? null,
      agentName: agentId ? await this.repos.machines.agentName(agentId) : null,
      // Папка чата приоритетнее: пользователь мог сменить её вручную.
      workdir: conv.workdir || machine?.path || null,
      run: run ? { id: run.id, status: run.status, mode: run.mode, startedAt: run.startedAt, durationMs: run.durationMs } : null
    }
  }

  /**
   * Метки всех чатов пользователя, привязанных к задачам: ключ, тип и последний
   * ран задачи. Список бесед подсвечивается тем же состоянием, что карточка на
   * доске, но доску при этом не открывают — поэтому сводки нужны сразу, одним
   * запросом на весь список, а не по чату.
   */
  async taskChatBadges(userId: string, opts?: { withRuns?: boolean }): Promise<TaskChatBadge[]> {
    const rows = (await this.sql.all(`SELECT c.id AS conversation_id, t.id AS task_id, t.project_id, t.seq, t.type,
                p.name AS project_name, kc.semantic_type AS column_semantic
         FROM conversations c
         JOIN tasks t ON t.id = c.task_id
         JOIN projects p ON p.id = t.project_id
         JOIN kanban_columns kc ON kc.id = t.column_id
         WHERE c.user_id = ? AND c.task_id IS NOT NULL`, [userId])) as Array<{ conversation_id: string; task_id: string; project_id: string; seq: number; type: string; project_name: string; column_semantic: string | null }>
    return await Promise.all(rows.map(async (r) => ({
      conversationId: r.conversation_id,
      projectId: r.project_id,
      taskId: r.task_id,
      key: issueKey(r.project_name, { seq: r.seq }),
      type: normWorkItemType(r.type),
      columnSemantic: (r.column_semantic as TaskChatBadge['columnSemantic']) ?? null,
      // Сводка рана — по запросу: она собирается пятью запросами на задачу и
      // весила 91% ответа (1.4 МБ из 1.5 МБ на боевом аккаунте), а список чатов
      // рисует из неё только состояние подсветки.
      ...(opts?.withRuns ? { run: await this.repos.ci.latestCiRunSummary(r.task_id) } : {})
    })))
  }

  async getTask(projectId: string, taskId: string): Promise<Task | null> {
    const r = (await this.sql.get(`SELECT * FROM tasks WHERE id = ? AND project_id = ?`, [taskId, projectId])) as
      | TaskRow
      | undefined
    return r ? mapTask(r) : null
  }

  /** Машина карточки доступна владельцу лично либо через контекст проекта. */
  private async validateTaskAgent(userId: string, projectId: string, agentId: string | null | undefined): Promise<string | null> {
    if (agentId == null) return null
    if (!(await this.repos.machines.canUseAgent(userId, agentId, projectId))) throw new Error('Машина недоступна для этой задачи')
    return agentId
  }

  async createTask(
    userId: string,
    projectId: string,
    args: {
      columnId: string
      title: string
      description?: string
      acceptanceCriteria?: string
      type?: WorkItemType
      parentId?: string | null
      priority?: TaskPriority
      assignee?: string | null
      agentId?: string | null
      labels?: string[]
      skills?: string[]
      storyPoints?: number | null
      dueDate?: number | null
      source?: string
      idempotencyKey?: string
    }
  ): Promise<Task | null> {
    if (!(await this.repos.projects.isProjectMember(userId, projectId))) return null
    const key = args.idempotencyKey?.trim()
    if (key) {
      const prior = (await this.sql.get(`SELECT task_id FROM task_creation_requests WHERE actor = ? AND idempotency_key = ?`, [userId, key])) as { task_id: string } | undefined
      if (prior) {
        const task = await this.getTask(projectId, prior.task_id)
        if (task?.type === 'task' && args.source !== undefined) {
          await this.repos.chat.openOrCreateTaskChat(userId, projectId, task.id)
        }
        return task
      }
    }
    if (!(await this.repos.projects.columnInProject(projectId, args.columnId))) return null

    const explicit = args.assignee !== undefined && args.assignee !== null
    const userCreation = args.source !== undefined
    const createdBy = userCreation ? userId : null
    const assignee = explicit ? args.assignee! : userCreation ? userId : null
    if (assignee !== null && !(await this.repos.projects.isActiveProjectMember(assignee, projectId))) {
      throw new Error(explicit
        ? 'Исполнитель должен быть активным и незаблокированным участником проекта'
        : 'Создатель не может быть назначен исполнителем в этом проекте')
    }
    const itemType = args.type ?? 'task'
    const skills = args.skills ?? await this.repos.projects.projectDefaultSkills(projectId, itemType)
    const parent = args.parentId ? await this.getTask(projectId, args.parentId) : null
    if (itemType === 'epic' && args.parentId) throw new Error('Эпик не может иметь родителя')
    if (args.parentId && !parent) throw new Error('Родитель не найден в проекте')
    if (itemType === 'story' && parent?.type !== 'epic') throw new Error('Родителем истории может быть только эпик')
    if (itemType === 'task' && parent && parent.type !== 'story' && parent.type !== 'epic') throw new Error('Недопустимый родитель задачи')

    const automation = (await this.sql.get(`SELECT autopilot_default, autopilot_requires_manual_qa FROM projects WHERE id = ?`, [projectId])) as { autopilot_default: number; autopilot_requires_manual_qa: number } | undefined
    const autoPilotDefault = automation?.autopilot_default === 1
    const id = this.newId()
    const ts = this.now()
    const created = await this.sql.transaction(async () => {
      if (key) {
        const prior = (await this.sql.get(`SELECT task_id FROM task_creation_requests WHERE actor = ? AND idempotency_key = ?`, [userId, key])) as { task_id: string } | undefined
        if (prior) return prior.task_id
      }
      const max = (await this.sql.get(`SELECT MAX(position) AS m FROM tasks WHERE project_id = ? AND column_id = ?`, [projectId, args.columnId])) as { m: number | null }
      const seq = await this.repos.projects.nextTaskSeq(projectId)
      await this.sql.run(`INSERT INTO tasks (id, project_id, column_id, title, description, acceptance_criteria, type, parent_id, priority, assignee, created_by, created_by_name, agent_id, labels, skills, story_points, due_date, flagged, done_at, seq, position, created_at, updated_at, auto_pilot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`, [id, projectId, args.columnId, args.title, args.description ?? '', args.acceptanceCriteria ?? '', itemType, args.parentId ?? null, normPriority(args.priority ?? 'medium'), assignee, createdBy, createdBy, await this.validateTaskAgent(userId, projectId, args.agentId), JSON.stringify(args.labels ?? []), JSON.stringify(skills), args.storyPoints ?? null, args.dueDate ?? null, (await this.repos.projects.isDoneColumn(args.columnId)) ? ts : null, seq, (max.m ?? 0) + RANK_STEP, ts, ts, itemType === 'task' && autoPilotDefault ? 1 : 0])
      if (itemType === 'task' && automation?.autopilot_requires_manual_qa === 1) {
        await this.sql.run(`UPDATE tasks SET auto_pilot_requires_manual_qa=1 WHERE id=?`, [id])
      }
      await this.sql.run(`INSERT INTO task_creation_audit (id, project_id, task_id, created_by, created_by_name, assignee, source, assignment_method, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [this.newId(), projectId, id, createdBy, createdBy, assignee, args.source ?? 'system', userCreation ? (explicit ? 'explicit' : 'automatic') : 'system', ts])
      if (key) await this.sql.run(`INSERT INTO task_creation_requests (actor, idempotency_key, task_id) VALUES (?, ?, ?)`, [userId, key, id])
      await this.repos.projects.touchProject(projectId, ts)
      return id
    })
    const task = await this.getTask(projectId, created)
    // Пользовательский таск сразу получает приватный связанный чат автора.
    // Эпики, стори и системные создания сохраняют ленивое поведение.
    if (task?.type === 'task' && userCreation) {
      await this.repos.chat.openOrCreateTaskChat(userId, projectId, task.id)
    }
    return task
  }

  async updateTask(
    userId: string,
    projectId: string,
    taskId: string,
    fields: { title?: string; description?: string; acceptanceCriteria?: string; type?: WorkItemType; parentId?: string | null; priority?: TaskPriority; assignee?: string | null; agentId?: string | null; labels?: string[]; skills?: string[]; storyPoints?: number | null; dueDate?: number | null; flagged?: boolean; autoPilot?: boolean; autoPilotRequiresManualQa?: boolean }
  ): Promise<Task | null> {
    if (!(await this.repos.projects.isProjectMember(userId, projectId))) return null
    const current = await this.getTask(projectId, taskId)

    if (!current) return null
    if (fields.assignee != null && !(await this.repos.projects.isActiveProjectMember(fields.assignee, projectId))) {
      throw new Error('Исполнитель должен быть активным участником проекта')
    }
    if (fields.agentId !== undefined) await this.validateTaskAgent(userId, projectId, fields.agentId)
    const nextType = fields.type ?? current.type
    const nextParentId = fields.parentId === undefined ? current.parentId : fields.parentId
    if (nextParentId === taskId) throw new Error('Элемент не может быть своим родителем')
    const nextParent = nextParentId ? await this.getTask(projectId, nextParentId) : null
    if (nextType === 'epic' && nextParentId) throw new Error('Эпик не может иметь родителя')
    if (nextParentId && !nextParent) throw new Error('Родитель не найден в проекте')
    if (nextType === 'story' && nextParent?.type !== 'epic') throw new Error('Родителем истории может быть только эпик')
    if (nextType === 'task' && nextParent && nextParent.type !== 'story' && nextParent.type !== 'epic') throw new Error('Недопустимый родитель задачи')
    let ancestor = nextParent
    while (ancestor) {
      if (ancestor.id === taskId) throw new Error('Циклическая иерархия')
      ancestor = ancestor.parentId ? await this.getTask(projectId, ancestor.parentId) : null
    }
    const set: string[] = []
    const vals: unknown[] = []
    if (fields.title !== undefined) {
      set.push('title = ?')
      vals.push(fields.title)
    }
    if (fields.description !== undefined) {
      set.push('description = ?')
      vals.push(fields.description)
    }
    if (fields.acceptanceCriteria !== undefined) {
      set.push('acceptance_criteria = ?')
      vals.push(fields.acceptanceCriteria)
    }
    if (fields.type !== undefined) {
      set.push('type = ?')
      vals.push(fields.type)
    }
    if (fields.parentId !== undefined) {
      set.push('parent_id = ?')
      vals.push(fields.parentId)
    }
    if (fields.priority !== undefined) {
      set.push('priority = ?')
      vals.push(normPriority(fields.priority))
    }
    if (fields.assignee !== undefined) {
      set.push('assignee = ?')
      vals.push(fields.assignee)
    }
    if (fields.agentId !== undefined) {
      set.push('agent_id = ?')
      vals.push(fields.agentId)
    }
    if (fields.labels !== undefined) {
      set.push('labels = ?')
      vals.push(JSON.stringify(fields.labels.map((l) => l.trim()).filter(Boolean)))
    }
    if (fields.skills !== undefined) {
      set.push('skills = ?')
      vals.push(JSON.stringify(fields.skills.map((s) => s.trim()).filter(Boolean)))
    }
    if (fields.storyPoints !== undefined) {
      set.push('story_points = ?')
      vals.push(fields.storyPoints != null && fields.storyPoints >= 0 ? fields.storyPoints : null)
    }
    if (fields.dueDate !== undefined) {
      set.push('due_date = ?')
      vals.push(fields.dueDate)
    }
    if (fields.flagged !== undefined) {
      set.push('flagged = ?')
      vals.push(fields.flagged ? 1 : 0)
    }
    if (fields.autoPilot !== undefined) {
      if (typeof fields.autoPilot !== 'boolean') throw new Error('autoPilot must be a boolean')
      set.push('auto_pilot = ?')
      vals.push(fields.autoPilot ? 1 : 0)
    }
    if (fields.autoPilotRequiresManualQa !== undefined) {
      if (typeof fields.autoPilotRequiresManualQa !== 'boolean') throw new Error('autoPilotRequiresManualQa must be a boolean')
      set.push('auto_pilot_requires_manual_qa = ?')
      vals.push(fields.autoPilotRequiresManualQa ? 1 : 0)
    }
    if (!set.length) return current
    const ts = this.now()
    set.push('updated_at = ?')
    vals.push(ts)
    await this.sql.run(`UPDATE tasks SET ${set.join(', ')} WHERE id = ? AND project_id = ?`, [...vals, taskId, projectId])
    // История изменений (вкладка «Активность», как в Jira): пишем только
    // реально изменившиеся человекочитаемые поля — техника (позиции, ранги)
    // человеку в истории не нужна.
    await this.recordTaskHistoryDiff(userId, projectId, taskId, current, fields, ts)
    await this.repos.projects.touchProject(projectId, ts)
    return await this.getTask(projectId, taskId)
  }

  /** Дифф видимых полей задачи → строки истории. Пустая строка и null равны. */
  private async recordTaskHistoryDiff(
    actor: string,
    projectId: string,
    taskId: string,
    before: Task,
    fields: Record<string, unknown>,
    at: number,
    via: 'user' | 'model' = 'user'
  ): Promise<void> {
    const norm = (value: unknown): string | null => {
      if (value === undefined || value === null) return null
      if (Array.isArray(value)) return value.length ? value.join(', ') : null
      const text = String(value).trim()
      return text === '' ? null : text
    }
    const watched: Array<[string, unknown, unknown]> = [
      ['title', before.title, fields.title],
      ['description', before.description, fields.description],
      ['acceptanceCriteria', before.acceptanceCriteria, fields.acceptanceCriteria],
      ['priority', before.priority, fields.priority],
      ['assignee', before.assignee, fields.assignee],
      ['storyPoints', before.storyPoints, fields.storyPoints],
      ['dueDate', before.dueDate, fields.dueDate],
      ['labels', before.labels, fields.labels],
      ['skills', before.skills, fields.skills],
      ['type', before.type, fields.type],
      ['flagged', before.flagged, fields.flagged]
    ]
    const insert = this.sql.prepare(`INSERT INTO task_history (id, project_id, task_id, actor, via, field, from_value, to_value, at) VALUES (?,?,?,?,?,?,?,?,?)`)
    for (const [field, was, next] of watched) {
      if (next === undefined) continue
      const fromValue = norm(was)
      const toValue = norm(next)
      if (fromValue === toValue) continue
      await insert.run(this.newId(), projectId, taskId, actor, via, field, fromValue, toValue, at)
    }
  }

  private async renormalizeColumn(projectId: string, columnId: string): Promise<void> {
    const rows = (await this.sql.all(`SELECT id FROM tasks WHERE project_id = ? AND column_id = ? ORDER BY position ASC, id ASC`, [projectId, columnId])) as Array<{ id: string }>
    const upd = this.sql.prepare(`UPDATE tasks SET position = ? WHERE id = ?`)
    for (const [i, r] of rows.entries()) await upd.run((i + 1) * RANK_STEP, r.id)
  }

  /** Переместить задачу в колонку между соседями afterId (выше) и beforeId (ниже). */
  async moveTask(
    userId: string,
    projectId: string,
    taskId: string,
    args: { columnId: string; afterId?: string | null; beforeId?: string | null }
  ): Promise<Task | null> {
    if (!(await this.repos.projects.isProjectMember(userId, projectId))) return null
    const current = await this.getTask(projectId, taskId)
    if (!current) return null
    if (!(await this.repos.projects.columnInProject(projectId, args.columnId))) return null
    const ts = this.now()
    await this.sql.transaction(async () => {
      const rankOf = async (nid: string | null | undefined): Promise<number | null> => {
        if (!nid) return null
        const r = (await this.sql.get(`SELECT position FROM tasks WHERE id = ? AND project_id = ? AND column_id = ?`, [nid, projectId, args.columnId])) as { position: number } | undefined
        return r ? r.position : null
      }
      let after = await rankOf(args.afterId)
      let before = await rankOf(args.beforeId)
      let pos: number
      if (after != null && before != null) {
        if (Math.abs(after - before) < RANK_EPS) {
          await this.renormalizeColumn(projectId, args.columnId)
          after = await rankOf(args.afterId)
          before = await rankOf(args.beforeId)
        }
        pos = ((after ?? 0) + (before ?? (after ?? 0) + 2 * RANK_STEP)) / 2
      } else if (after != null) {
        pos = after + RANK_STEP
      } else if (before != null) {
        pos = before - RANK_STEP
      } else {
        const max = (
          (await this.sql.get(`SELECT MAX(position) AS m FROM tasks WHERE project_id = ? AND column_id = ?`, [projectId, args.columnId])) as { m: number | null }
        ).m
        pos = (max ?? 0) + RANK_STEP
      }
      // Момент попадания в «Готово» — точка отсчёта, после которой карточка
      // уходит с доски. Переезд между done-колонками отсчёт не сбрасывает,
      // возврат в работу — сбрасывает (задача снова живая).
      const done = (await this.repos.projects.isDoneColumn(args.columnId)) ? 1 : 0
      await this.sql.run(`UPDATE tasks SET column_id = ?, position = ?, updated_at = ?,
                  done_at = CASE WHEN ? = 1 THEN COALESCE(done_at, ?) ELSE NULL END
           WHERE id = ? AND project_id = ?`, [args.columnId, pos, ts, done, ts, taskId, projectId])
      // История: перенос между колонками — главное событие жизни карточки.
      // Перестановка внутри колонки историю не пишет: этап не изменился.
      const fromColumn = (await this.sql.get(`SELECT name FROM kanban_columns WHERE id = ?`, [current.columnId])) as { name: string } | undefined
      const toColumn = (await this.sql.get(`SELECT name FROM kanban_columns WHERE id = ?`, [args.columnId])) as { name: string } | undefined
      if (current.columnId !== args.columnId) {
        await this.sql.run(`INSERT INTO task_history (id, project_id, task_id, actor, via, field, from_value, to_value, at) VALUES (?,?,?,?,?,?,?,?,?)`, [this.newId(), projectId, taskId, userId, 'user', 'column', fromColumn?.name ?? current.columnId, toColumn?.name ?? args.columnId, ts])
      }
    })
    await this.repos.projects.touchProject(projectId, ts)
    return await this.getTask(projectId, taskId)
  }

  async deleteTask(userId: string, projectId: string, taskId: string): Promise<boolean> {
    if (!(await this.repos.projects.isProjectMember(userId, projectId))) return false
    let changes = 0
    await this.sql.transaction(async () => {
      changes = (await this.sql.run(`DELETE FROM tasks WHERE id = ? AND project_id = ?`, [taskId, projectId])).changes
    })
    if (changes) await this.repos.projects.touchProject(projectId)
    return changes > 0
  }

  /** Публичный доступ к задаче для CI-раннера (по членству проекта). */
  async getCiTask(userId: string, projectId: string, taskId: string): Promise<Task | null> {
    if (!(await this.repos.projects.isProjectMember(userId, projectId))) return null
    const task = await this.getTask(projectId, taskId)
    // Дизайны едут вместе с задачей: их видит и промпт CI-рана, и контекст чата.
    return task ? { ...task, designs: await this.taskDesigns(task.id) } : null
  }

  /**
   * Последний актуальный процесс среди всех workflow-ранов задачи. Новый старт
   * сразу вытесняет прежнюю ошибку. cancelled нейтрален, stale считается skipped.
   */
  /** Ветки UNION-а «все этапы задачи»: имя этапа, таблица и приоритет при равном времени. */
  private static readonly TASK_RUN_SOURCES: ReadonlyArray<{ kind: string; table: string; createdAt: string }> = [
    { kind: `'preparation'`, table: 'task_preparation_runs', createdAt: 'created_at' },
    { kind: `'development'`, table: 'ci_runs', createdAt: 'created_at' },
    { kind: 'stage', table: 'qa_stage_runs', createdAt: 'created_at' },
    { kind: `'component_qa'`, table: 'component_qa_runs', createdAt: 'created_at' },
    { kind: `'integration_tests'`, table: 'integration_test_runs', createdAt: 'created_at' },
    { kind: `'qa_preparation'`, table: 'qa_preparation_runs', createdAt: 'created_at' },
    { kind: `'manual_qa'`, table: 'qa_sessions', createdAt: 'started_at' },
    { kind: `'merge'`, table: 'merge_runs', createdAt: 'created_at' }
  ]

  /** Статусы, при которых этап считается идущим прямо сейчас (он и главный в сводке). */
  private static readonly TASK_RUN_ACTIVE_STATUSES =
    `'queued','running','awaiting_input','waiting_for_answer','validating','active','checking','fetching','merging','resolving_conflicts','kb_update','testing','pushing','deploying','production_checks','rolling_back'`

  /** Порядок «самый актуальный этап сверху» — общий для одиночной и групповой выборки. */
  private static taskRunOrder(): string {
    return `created_at DESC, CASE WHEN status IN (${TasksRepo.TASK_RUN_ACTIVE_STATUSES}) THEN 1 ELSE 0 END DESC, seq DESC, rank DESC`
  }

  /** UNION ALL по всем таблицам этапов; `where` подставляется в каждую ветку. */
  private static taskRunUnion(where: string): string {
    return TasksRepo.TASK_RUN_SOURCES
      .map(({ kind, table, createdAt }, index) =>
        `SELECT task_id, id, ${kind} kind, status, ${createdAt} created_at, finished_at, rowid seq, ${index + 1} rank FROM ${table} WHERE ${where}`)
      .join(' UNION ALL ')
  }

  private static toTaskRunResult(row: { id: string; kind: TaskRunResult['kind']; status: string; created_at: number; finished_at: number | null }): TaskRunResult {
    return { id: row.id, kind: row.kind, status: row.status, outcome: normalizeTaskRunOutcome(row.status), createdAt: row.created_at, finishedAt: row.finished_at }
  }

  /**
   * Последний актуальный этап сразу по всем задачам доски: одна оконная выборка
   * вместо восьми запросов на карточку. `scope` — подзапрос с id задач доски.
   */
  private async latestTaskRunResults(scope: string, args: Record<string, unknown>): Promise<Map<string, TaskRunResult>> {
    const rows = (await this.sql.all(`
      SELECT task_id, id, kind, status, created_at, finished_at FROM (
        SELECT task_id, id, kind, status, created_at, finished_at,
               ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY ${TasksRepo.taskRunOrder()}) rn
          FROM (${TasksRepo.taskRunUnion(`task_id IN (${scope})`)})
      ) WHERE rn = 1
    `, [args])) as Array<{ task_id: string; id: string; kind: TaskRunResult['kind']; status: string; created_at: number; finished_at: number | null }>
    return new Map(rows.map((row) => [row.task_id, TasksRepo.toTaskRunResult(row)]))
  }

  async latestTaskRunResult(taskId: string): Promise<TaskRunResult | null> {
    const row = (await this.sql.get(`
      SELECT id, kind, status, created_at, finished_at
        FROM (${TasksRepo.taskRunUnion('task_id = @taskId')})
       ORDER BY ${TasksRepo.taskRunOrder()} LIMIT 1
    `, [{ taskId }])) as
      | { id: string; kind: TaskRunResult['kind']; status: string; created_at: number; finished_at: number | null }
      | undefined
    return row ? TasksRepo.toTaskRunResult(row) : null
  }

  async upsertTaskRepository(projectId: string, taskId: string, agentId: string, path: string, kind: TaskRepository['kind']): Promise<void> {
    await this.sql.run(`INSERT INTO task_repositories (id,project_id,task_id,agent_id,path,kind,state,created_at) VALUES (?,?,?,?,?,?,'active',?)
      ON CONFLICT(task_id,agent_id,path) DO UPDATE SET state='active', deleted_at=NULL, kind=excluded.kind`, [this.newId(), projectId, taskId, agentId, path, kind, this.now()])
  }

  async getTaskRepositoryById(id: string): Promise<TaskRepository | null> {
    const r = (await this.sql.get(`SELECT r.*, a.name AS machine_name FROM task_repositories r LEFT JOIN agents a ON a.id=r.agent_id WHERE r.id=?`, [id])) as Record<string, unknown> | undefined
    return r ? mapTaskRepository(r) : null
  }

  async listTaskRepositories(userId: string, projectId: string, taskId: string): Promise<TaskRepository[]> {
    if (!(await this.repos.projects.isProjectMember(userId, projectId))) return []
    return ((await this.sql.all(`SELECT r.*, a.name AS machine_name FROM task_repositories r LEFT JOIN agents a ON a.id=r.agent_id WHERE r.task_id=? AND r.project_id=? ORDER BY r.created_at`, [taskId, projectId])) as Record<string, unknown>[]).map(mapTaskRepository)
  }

  /** Каскад удаления аккаунта: снять исполнителя со всех задач (зовётся из identity). */
  async unassignUser(userId: string): Promise<void> {
    await this.sql.run(`UPDATE tasks SET assignee = NULL WHERE assignee = ?`, [userId])
  }

  /** Участник вышел из проекта — его задачи остаются без исполнителя (зовётся из projects.removeMember). */
  async unassignUserInProject(projectId: string, username: string, ts: number): Promise<void> {
    await this.sql.run(`UPDATE tasks SET assignee = NULL, updated_at = ? WHERE project_id = ? AND assignee = ?`, [ts, projectId, username])
  }
}
