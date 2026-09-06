// Домен «tasks»: таблицы tasks, task_comments, task_worklog, task_history, task_designs, task_creation_requests, task_creation_audit, task_improvements, task_rework_cycles, task_rework_attachments, task_repositories, task_launch_results, task_preparation_runs, task_preparation_events, task_preparation_steps, task_preparation_questions, task_preparation_notification_dismissals, assistant_orchestrations, assistant_orchestration_items.
// Файл получен разрезанием бывшего VoiceChatDb (apps/server/src/db/database.ts) по владению таблицами;
// карта владения — ./ownership.ts, правила — docs/plans/db-repositories.md.
import type { Orchestration, OrchestrationItem, OrchestrationItemInput, OrchestrationItemStatus, OrchestrationStatus } from '@voicechat/shared'
import { type LlmProvider, type Board, type Task, type TaskReworkCycle, type TaskAttachment, type CreateTaskReworkCycleInput, type TaskRunResult, normalizeTaskRunOutcome, type TaskPriority, type WorkItemType, type KanbanColumnSemanticType, type TaskChatBadge, type TaskChatContext, type TaskChatCrumb, type TaskActivity, type TaskComment, type TaskWorklogEntry, type TaskDesignLink, type ProjectDesignSource, type MakeTaskLink, type MakeLinkableTask, MAKE_KIND, normalizeMakePath, issueKey, completedVisibilityCutoff, applyTaskStatuses, type TaskStatus, type BoardStatuses, compareTasksInColumn, type MergeRun, type TaskRepository, ACTIVE_MERGE_STATUSES, type TaskImprovement, type ProjectImprovement, type ImprovementStatus, type TaskTimeline, type TaskTimelineAttempt, type TaskTimelineStage, type TaskTimelineStatus, mergedTimelineDuration, subtractTimelineIntervals, timelineDuration, timelineIso, canCompleteComponentQa, componentQaLaunchReasons, componentQaSemanticVersion, canTransitionWorkflow, type TaskPreparationRun, type PreparationEvent, type TaskPreparationStep, type PreparationQuestion, type PreparationAnswerResult, type PreparationClarificationNotification, type TaskPreparationPhase, type PreparationGateResult, redactPreparationText, developmentReadinessGateResults, type TaskLaunchResult, type DevelopmentReadiness, type ComponentQaRun, type ComponentQaTaskState } from '@voicechat/shared'
import { createHash } from 'node:crypto'
import { trimHistoricalRunLogs } from '../../ci/qaStateLogs.js'
import { BaseRepo } from './base.js'
import { RANK_STEP, parseStringArray, normColumnSemantic, mapColumn, parseJsonValue, mapCiRun, type ColumnRow, type TaskRow, type CiRunRow } from './support.js'

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
  'auto_pilot', 'auto_pilot_fix_cycles', 'done_at', 'preview_ready', 'seq', 'position', 'created_at', 'updated_at'
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
export class TasksRepo extends BaseRepo {
  /**
   * Привязать чат к проекту (или отвязать при projectId=null). При привязке
   * машина остаётся null: это динамическое наследование персонального default
   * текущего пользователя. Навыки наследуются от проекта. Гейт — членство.
   */
  // --- Оркестрация канбан-ассистента ---------------------------------
  // План живёт в БД, потому что ожидание merge переживает и вкладку, и рестарт.

  /** Сколько планов проекта сейчас идёт: серия задач не должна размножаться. */
  countActiveOrchestrations(owner: string, projectId: string): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS n FROM assistant_orchestrations WHERE owner = ? AND project_id = ? AND status = 'running'`
    ).get(owner, projectId) as { n: number }
    return row.n
  }

  createOrchestration(
    owner: string,
    projectId: string,
    conversationId: string | null,
    title: string,
    items: OrchestrationItemInput[]
  ): Orchestration | null {
    if (!this.repos.projects.isProjectMember(owner, projectId)) return null
    const id = this.newId()
    const ts = this.now()
    this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO assistant_orchestrations (id, project_id, conversation_id, owner, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'running', ?, ?)`
      ).run(id, projectId, conversationId, owner, title, ts, ts)
      const insert = this.db.prepare(
        `INSERT INTO assistant_orchestration_items (id, orchestration_id, position, kind, title, task_id, depends_on_json, payload_json, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
      )
      items.forEach((item, index) => {
        insert.run(this.newId(), id, index, item.kind, item.title, item.taskId ?? null, JSON.stringify(item.dependsOn ?? []), JSON.stringify(item.payload ?? {}))
      })
    })()
    return this.getOrchestration(owner, id)
  }

  getOrchestration(owner: string, id: string): Orchestration | null {
    const row = this.db.prepare(`SELECT * FROM assistant_orchestrations WHERE id = ? AND owner = ?`).get(id, owner) as Record<string, string | number | null> | undefined
    return row ? this.orchestrationOf(row) : null
  }

  /** Для менеджера: план без проверки владельца (владелец берётся из строки). */
  getOrchestrationById(id: string): Orchestration | null {
    const row = this.db.prepare(`SELECT * FROM assistant_orchestrations WHERE id = ?`).get(id) as Record<string, string | number | null> | undefined
    return row ? this.orchestrationOf(row) : null
  }

  listOrchestrations(owner: string, projectId: string, limit = 20): Orchestration[] {
    const rows = this.db.prepare(
      `SELECT * FROM assistant_orchestrations WHERE owner = ? AND project_id = ? ORDER BY created_at DESC LIMIT ?`
    ).all(owner, projectId, limit) as Array<Record<string, string | number | null>>
    return rows.map((row) => this.orchestrationOf(row))
  }

  /** Незавершённые планы — их менеджер подхватывает после рестарта сервера. */
  listActiveOrchestrations(): Orchestration[] {
    const rows = this.db.prepare(`SELECT * FROM assistant_orchestrations WHERE status = 'running'`).all() as Array<Record<string, string | number | null>>
    return rows.map((row) => this.orchestrationOf(row))
  }

  updateOrchestrationStatus(id: string, status: OrchestrationStatus, error?: string | null): void {
    this.db.prepare(`UPDATE assistant_orchestrations SET status = ?, error = ?, updated_at = ? WHERE id = ?`)
      .run(status, error ?? null, this.now(), id)
  }

  updateOrchestrationItem(
    itemId: string,
    patch: { status?: OrchestrationItemStatus; taskId?: string | null; runId?: string | null; error?: string | null; attempts?: number }
  ): void {
    const set: string[] = []
    const values: unknown[] = []
    if (patch.status !== undefined) {
      set.push('status = ?')
      values.push(patch.status)
      if (patch.status === 'running') { set.push('started_at = ?'); values.push(this.now()) }
      if (patch.status === 'done' || patch.status === 'failed' || patch.status === 'cancelled') { set.push('finished_at = ?'); values.push(this.now()) }
    }
    if (patch.taskId !== undefined) { set.push('task_id = ?'); values.push(patch.taskId) }
    if (patch.runId !== undefined) { set.push('run_id = ?'); values.push(patch.runId) }
    if (patch.error !== undefined) { set.push('error = ?'); values.push(patch.error) }
    if (patch.attempts !== undefined) { set.push('attempts = ?'); values.push(patch.attempts) }
    if (!set.length) return
    values.push(itemId)
    this.db.prepare(`UPDATE assistant_orchestration_items SET ${set.join(', ')} WHERE id = ?`).run(...values)
    const owner = this.db.prepare(`SELECT orchestration_id FROM assistant_orchestration_items WHERE id = ?`).get(itemId) as { orchestration_id: string } | undefined
    if (owner) this.db.prepare(`UPDATE assistant_orchestrations SET updated_at = ? WHERE id = ?`).run(this.now(), owner.orchestration_id)
  }

  cancelOrchestration(owner: string, id: string): Orchestration | null {
    const plan = this.getOrchestration(owner, id)
    if (!plan) return null
    this.db.transaction(() => {
      this.db.prepare(`UPDATE assistant_orchestration_items SET status = 'cancelled', finished_at = ? WHERE orchestration_id = ? AND status IN ('pending', 'running')`)
        .run(this.now(), id)
      this.updateOrchestrationStatus(id, 'cancelled')
    })()
    return this.getOrchestration(owner, id)
  }

  private orchestrationOf(row: Record<string, string | number | null>): Orchestration {
    const id = String(row.id)
    const items = (this.db.prepare(
      `SELECT * FROM assistant_orchestration_items WHERE orchestration_id = ? ORDER BY position`
    ).all(id) as Array<Record<string, string | number | null>>).map((item): OrchestrationItem => ({
      id: String(item.id),
      position: Number(item.position),
      kind: String(item.kind) as OrchestrationItem['kind'],
      title: String(item.title),
      taskId: item.task_id ? String(item.task_id) : null,
      dependsOn: parseJsonValue<number[]>(typeof item.depends_on_json === 'string' ? item.depends_on_json : '[]', []).filter((value): value is number => typeof value === 'number'),
      payload: parseJsonValue<Record<string, unknown>>(typeof item.payload_json === 'string' ? item.payload_json : '{}', {}),
      status: String(item.status) as OrchestrationItem['status'],
      runId: item.run_id ? String(item.run_id) : null,
      attempts: item.attempts === null || item.attempts === undefined ? 0 : Number(item.attempts),
      error: item.error ? String(item.error) : null,
      startedAt: item.started_at === null ? null : Number(item.started_at),
      finishedAt: item.finished_at === null ? null : Number(item.finished_at)
    }))
    return {
      id,
      projectId: String(row.project_id),
      conversationId: row.conversation_id ? String(row.conversation_id) : null,
      owner: String(row.owner),
      title: String(row.title),
      status: String(row.status) as Orchestration['status'],
      error: row.error ? String(row.error) : null,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      items
    }
  }

  /**
   * Снапшот доски целиком: скелет карточек плюс состояние их процессов. Клиент
   * грузит эти две фазы отдельными запросами (доска рисуется, не дожидаясь
   * статусов); здесь они склеены для MCP, автопрохода и тестов.
   */
  getBoard(userId: string, projectId: string, opts?: { includeCompleted?: boolean }): Board | null {
    const board = this.getBoardSkeleton(userId, projectId, opts)
    if (!board) return null
    const statuses = this.getBoardStatuses(userId, projectId, opts)
    return { columns: board.columns, tasks: applyTaskStatuses(board.tasks, statuses?.tasks ?? []), ciRuns: statuses?.ciRuns ?? [] }
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
  getBoardSkeleton(userId: string, projectId: string, opts?: { includeCompleted?: boolean }): Board | null {
    if (!this.repos.projects.isProjectMember(userId, projectId)) return null
    const columns = (
      this.db
        .prepare(`SELECT * FROM kanban_columns WHERE project_id = ? ORDER BY position ASC, created_at ASC`)
        .all(projectId) as ColumnRow[]
    ).map(mapColumn)
    const cutoff = this.boardDoneCutoff(projectId, opts)
    // Читаем ровно те колонки, из которых складывается карточка. `SELECT *` тянул
    // бы вместе с ними описание и критерии приёмки — многие килобайты на задачу,
    // которые доска всё равно гасит: сотни карточек превращали ответ в мегабайты.
    const tasks = (
      this.db
        .prepare(
          `SELECT ${BOARD_TASK_COLUMNS} FROM tasks
             WHERE project_id = @projectId AND (@cutoff IS NULL OR done_at IS NULL OR done_at >= @cutoff)
             ORDER BY column_id ASC, position ASC`
        )
        .all({ projectId, cutoff }) as TaskRow[]
      // Тексты карточка получает при открытии (`getTaskDetail` → TaskModal).
    ).map((row) => ({ ...mapTaskCore(row), description: '', acceptanceCriteria: '' }))
    const semanticByColumnId = new Map(columns.map((column) => [column.id, column.semanticType]))
    tasks.sort((a, b) => {
      if (a.columnId !== b.columnId) return a.columnId.localeCompare(b.columnId)
      return compareTasksInColumn(a, b, semanticByColumnId.get(a.columnId) ?? 'custom')
    })
    return { columns, tasks }
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
  getBoardStatuses(userId: string, projectId: string, opts?: { includeCompleted?: boolean }): BoardStatuses | null {
    if (!this.repos.projects.isProjectMember(userId, projectId)) return null
    const cutoff = this.boardDoneCutoff(projectId, opts)
    // Подзапрос «задачи доски» повторяется в каждом запросе фазы: он идёт по
    // индексу (project_id) и дешевле, чем список из сотен плейсхолдеров.
    const scope = `SELECT id FROM tasks WHERE project_id = @projectId AND (@cutoff IS NULL OR done_at IS NULL OR done_at >= @cutoff)`
    const args = { projectId, cutoff }

    const chatByTask = new Map(
      (this.db.prepare(
        `SELECT task_id, id FROM (
           SELECT c.task_id AS task_id, c.id AS id,
                  ROW_NUMBER() OVER (PARTITION BY c.task_id ORDER BY c.created_at ASC) AS rn
             FROM conversations c
            WHERE c.user_id = @userId AND c.task_id IN (${scope})
         ) WHERE rn = 1`
      ).all({ ...args, userId }) as Array<{ task_id: string; id: string }>).map((r) => [r.task_id, r.id])
    )

    // Последняя отправленная рабочая копия задачи: из неё и ветка с SHA, и
    // ответ на вопрос, доступна ли машина этого воркспейса текущему проекту.
    const workspaceByTask = new Map(
      (this.db.prepare(
        `SELECT task_id, branch, commit_sha, agent_id FROM (
           SELECT w.task_id AS task_id, w.branch AS branch, w.commit_sha AS commit_sha, w.agent_id AS agent_id,
                  ROW_NUMBER() OVER (PARTITION BY w.task_id ORDER BY w.created_at DESC) AS rn
             FROM ci_workspaces w
            WHERE w.pushed = 1 AND w.task_id IN (${scope})
         ) WHERE rn = 1`
      ).all(args) as Array<{ task_id: string; branch: string | null; commit_sha: string | null; agent_id: string | null }>)
        .map((r) => [r.task_id, r])
    )
    const boundAgentIds = new Set(
      (this.db.prepare(
        `SELECT a.id FROM agents a
          WHERE a.user_id = @userId
             OR EXISTS(SELECT 1 FROM project_machines pm WHERE pm.project_id = @projectId AND pm.agent_id = a.id)`
      ).all({ projectId, userId }) as Array<{ id: string }>).map((r) => r.id)
    )

    const mergeRuns = this.latestByTask<{ task_id: string; id: string; status: string; merge_sha: string | null; source_sha: string | null }>(
      `SELECT task_id, id, status, merge_sha, source_sha, created_at FROM merge_runs WHERE task_id IN (${scope})`,
      args
    )
    const preparationRuns = this.latestByTask<{ task_id: string; id: string; status: string; error: string | null }>(
      `SELECT task_id, id, status, error, created_at FROM task_preparation_runs WHERE task_id IN (${scope})`,
      args
    )
    const runResultByTask = this.latestTaskRunResults(scope, args)
    // Право на merge — свойство участника в проекте, а не карточки: считаем один
    // раз, а не по разу на каждую из сотен задач, как было в подзапросе доски.
    const mergePermitted = Boolean(
      this.db.prepare(`SELECT 1 FROM project_members WHERE project_id = ? AND username = ? AND role = 'owner'`).get(projectId, userId)
    )

    const taskIds = (this.db.prepare(scope).all(args) as Array<{ id: string }>).map((r) => r.id)
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
    return { tasks, ciRuns: this.repos.ci.latestCiRunSummaries(projectId, { sql: scope, args }) }
  }

  /** Граница `done_at` для доски: `null` — показывать всё, включая старое «Готово». */
  private boardDoneCutoff(projectId: string, opts?: { includeCompleted?: boolean }): number | null {
    return opts?.includeCompleted ? null : completedVisibilityCutoff(this.repos.projects.doneRetentionDays(projectId), this.now())
  }

  /**
   * Строки источника, сгруппированные по задаче и отсортированные «свежие
   * сверху». Источник обязан отдавать `task_id` и `created_at`; фильтр по
   * задачам доски уже внутри запроса.
   */
  private latestByTask<T extends { task_id: string }>(sql: string, args: Record<string, unknown>): Map<string, T[]> {
    const rows = this.db.prepare(`${sql} ORDER BY created_at DESC, rowid DESC`).all(args) as T[]
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
  getTaskDetail(userId: string, projectId: string, taskId: string): Task | null {
    if (!this.repos.projects.isProjectMember(userId, projectId)) return null
    const row = this.db
      .prepare(
        `SELECT t.*, (SELECT c.id FROM conversations c WHERE c.task_id = t.id AND c.user_id = ?
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
         FROM tasks t WHERE t.id = ? AND t.project_id = ? LIMIT 1`
      )
      .get(userId, userId, userId, taskId, projectId) as TaskRow | undefined
    if (!row) return null
    return { ...mapTask(row), latestRunResult: this.latestTaskRunResult(row.id), designs: this.taskDesigns(row.id) }
  }

  /**
   * Связи задачи с дизайнами. Имя и владелец Make-проекта приезжают вместе со
   * связью: карточка показывает список, не загружая список чатов.
   */
  taskDesigns(taskId: string): TaskDesignLink[] {
    const rows = this.db
      .prepare(
        `SELECT d.id, d.task_id, d.conversation_id, d.path, d.mode, d.paths_json, d.label, d.created_at, d.created_by,
                c.title AS conversation_title, c.user_id AS conversation_owner
           FROM task_designs d JOIN conversations c ON c.id = d.conversation_id
          WHERE d.task_id = ?
          ORDER BY d.created_at ASC`
      )
      .all(taskId) as Array<{
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

  listTaskDesigns(userId: string, projectId: string, taskId: string): TaskDesignLink[] | null {
    if (!this.repos.projects.isProjectMember(userId, projectId)) return null
    if (!this.getTask(projectId, taskId)) return null
    return this.taskDesigns(taskId)
  }

  /** Проверяет, что новую дизайн-связь создаёт владелец Make-проекта. */
  assertTaskDesignSource(userId: string, projectId: string, taskId: string, conversationId: string): void {
    if (!this.repos.projects.isProjectMember(userId, projectId)) throw new Error('Пользователь не состоит в проекте')
    if (!this.getTask(projectId, taskId)) throw new Error('Задача не найдена в проекте')
    const conv = this.db
      .prepare(`SELECT id, assistant_kind, project_id, user_id FROM conversations WHERE id = ?`)
      .get(conversationId) as { id: string; assistant_kind: string | null; project_id: string | null; user_id: string | null } | undefined
    if (!conv || conv.assistant_kind !== MAKE_KIND) throw new Error('Дизайн берётся только из проекта Make')
    if (conv.project_id !== projectId) throw new Error('Make-проект не привязан к этому проекту')
    if (conv.user_id !== userId) throw new Error('Можно связать только свой Make-проект')
  }

  /**
   * Связывает карточку с принадлежащим пользователю Make-проектом, который
   * привязан к тому же обычному проекту.
   */
  linkTaskDesign(
    userId: string,
    projectId: string,
    taskId: string,
    args: { conversationId: string; mode?: 'whole_project' | 'files'; paths?: string[]; path?: string; label?: string }
  ): TaskDesignLink[] {
    this.assertTaskDesignSource(userId, projectId, taskId, args.conversationId)
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
    const replace = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM task_designs WHERE task_id = ? AND conversation_id = ?`).run(taskId, args.conversationId)
      this.db.prepare(`INSERT INTO task_designs (id, task_id, conversation_id, path, mode, paths_json, label, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(this.newId(), taskId, args.conversationId, path, mode, JSON.stringify(paths), label, userId, this.now())
    })
    replace()
    this.repos.projects.touchProject(projectId, this.now())
    return this.taskDesigns(taskId)
  }

  unlinkTaskDesign(userId: string, projectId: string, taskId: string, linkId: string): TaskDesignLink[] | null {
    if (!this.repos.projects.isProjectMember(userId, projectId)) return null
    if (!this.getTask(projectId, taskId)) return null
    this.db.prepare(`DELETE FROM task_designs WHERE id = ? AND task_id = ?`).run(linkId, taskId)
    this.repos.projects.touchProject(projectId, this.now())
    return this.taskDesigns(taskId)
  }

  /** Собственные Make-проекты пользователя, привязанные к проекту. */
  projectDesignSources(userId: string, projectId: string): ProjectDesignSource[] | null {
    if (!this.repos.projects.isProjectMember(userId, projectId)) return null
    const rows = this.db
      .prepare(
        `SELECT id, title, user_id, updated_at FROM conversations
          WHERE project_id = ? AND assistant_kind = ? AND user_id = ? ORDER BY updated_at DESC`
      )
      .all(projectId, MAKE_KIND, userId) as Array<{ id: string; title: string; user_id: string | null; updated_at: number }>
    return rows.map((r) => ({
      conversationId: r.id,
      title: r.title,
      owner: r.user_id,
      own: r.user_id === userId,
      updatedAt: r.updated_at
    }))
  }

  /**
   * Обратное направление: какие карточки ссылаются на Make-проект (или на его
   * страницу). Доступ проверяет вызывающий роут — там же, где право на сам
   * Make-проект.
   */
  makeTaskLinks(conversationId: string, path?: string): MakeTaskLink[] {
    const rows = this.db
      .prepare(
        `SELECT d.id, d.path, d.label, d.created_at, t.id AS task_id, t.title, t.seq, t.project_id,
                p.name AS project_name, kc.name AS column_name
           FROM task_designs d
           JOIN tasks t ON t.id = d.task_id
           JOIN projects p ON p.id = t.project_id
           LEFT JOIN kanban_columns kc ON kc.id = t.column_id
          WHERE d.conversation_id = ?${path === undefined ? '' : ' AND d.path = ?'}
          ORDER BY d.created_at ASC`
      )
      .all(...(path === undefined ? [conversationId] : [conversationId, path])) as Array<{
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
  makeLinkableTasks(userId: string, conversationId: string): MakeLinkableTask[] {
    const conv = this.db
      .prepare(`SELECT project_id FROM conversations WHERE id = ? AND assistant_kind = ?`)
      .get(conversationId, MAKE_KIND) as { project_id: string | null } | undefined
    const projectId = conv?.project_id
    if (!projectId || !this.repos.projects.isProjectMember(userId, projectId)) return []
    const rows = this.db
      .prepare(
        `SELECT t.id, t.title, t.seq, t.project_id, p.name AS project_name, kc.name AS column_name
           FROM tasks t JOIN projects p ON p.id = t.project_id
           LEFT JOIN kanban_columns kc ON kc.id = t.column_id
          WHERE t.project_id = ? ORDER BY t.seq DESC`
      )
      .all(projectId) as Array<{ id: string; title: string; seq: number; project_id: string; project_name: string; column_name: string | null }>
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
  getTaskChatContext(userId: string, conversationId: string, isOnline?: (agentId: string) => boolean): TaskChatContext | null {
    const conv = this.repos.chat.getConversation(userId, conversationId)
    if (!conv?.taskId || !conv.projectId) return null
    const project = this.repos.projects.getProject(userId, conv.projectId)
    if (!project) return null
    const task = this.getTask(conv.projectId, conv.taskId)
    if (!task) return null

    const crumb = (t: Task): TaskChatCrumb => ({ id: t.id, title: t.title, key: issueKey(project.name, t) })
    const parent = task.parentId ? this.getTask(conv.projectId, task.parentId) : null
    const grandParent = parent?.parentId ? this.getTask(conv.projectId, parent.parentId) : null
    // Родитель задачи — стори или сразу эпик; у стори родитель всегда эпик.
    const story = parent?.type === 'story' ? parent : null
    const epic = parent?.type === 'epic' ? parent : grandParent?.type === 'epic' ? grandParent : null

    const column = this.db.prepare(`SELECT name, semantic_type FROM kanban_columns WHERE id = ?`).get(task.columnId) as
      | { name: string; semantic_type: string | null }
      | undefined
    const resolution = this.repos.chat.resolveConversationMachine(userId, conversationId, { isOnline })
    const agentId = resolution?.error ? null : resolution?.agentId ?? null
    const machine = agentId ? project.machines.find((m) => m.agentId === agentId) : undefined
    const displaySummary = this.repos.ci.latestCiRunSummary(task.id)
    const runRow = displaySummary ? this.db.prepare(`SELECT * FROM ci_runs WHERE id = ?`).get(displaySummary.id) as CiRunRow | undefined : undefined
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
      agentName: agentId ? this.repos.machines.agentName(agentId) : null,
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
  taskChatBadges(userId: string, opts?: { withRuns?: boolean }): TaskChatBadge[] {
    const rows = this.db
      .prepare(
        `SELECT c.id AS conversation_id, t.id AS task_id, t.project_id, t.seq, t.type,
                p.name AS project_name, kc.semantic_type AS column_semantic
         FROM conversations c
         JOIN tasks t ON t.id = c.task_id
         JOIN projects p ON p.id = t.project_id
         JOIN kanban_columns kc ON kc.id = t.column_id
         WHERE c.user_id = ? AND c.task_id IS NOT NULL`
      )
      .all(userId) as Array<{ conversation_id: string; task_id: string; project_id: string; seq: number; type: string; project_name: string; column_semantic: string | null }>
    return rows.map((r) => ({
      conversationId: r.conversation_id,
      projectId: r.project_id,
      taskId: r.task_id,
      key: issueKey(r.project_name, { seq: r.seq }),
      type: normWorkItemType(r.type),
      columnSemantic: (r.column_semantic as TaskChatBadge['columnSemantic']) ?? null,
      // Сводка рана — по запросу: она собирается пятью запросами на задачу и
      // весила 91% ответа (1.4 МБ из 1.5 МБ на боевом аккаунте), а список чатов
      // рисует из неё только состояние подсветки.
      ...(opts?.withRuns ? { run: this.repos.ci.latestCiRunSummary(r.task_id) } : {})
    }))
  }

  getTask(projectId: string, taskId: string): Task | null {
    const r = this.db.prepare(`SELECT * FROM tasks WHERE id = ? AND project_id = ?`).get(taskId, projectId) as
      | TaskRow
      | undefined
    return r ? mapTask(r) : null
  }

  /** Машина карточки доступна владельцу лично либо через контекст проекта. */
  private validateTaskAgent(userId: string, projectId: string, agentId: string | null | undefined): string | null {
    if (agentId == null) return null
    if (!this.repos.machines.canUseAgent(userId, agentId, projectId)) throw new Error('Машина недоступна для этой задачи')
    return agentId
  }

  createTask(
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
  ): Task | null {
    if (!this.repos.projects.isProjectMember(userId, projectId)) return null
    const key = args.idempotencyKey?.trim()
    if (key) {
      const prior = this.db.prepare(
        `SELECT task_id FROM task_creation_requests WHERE actor = ? AND idempotency_key = ?`
      ).get(userId, key) as { task_id: string } | undefined
      if (prior) return this.getTask(projectId, prior.task_id)
    }
    if (!this.repos.projects.columnInProject(projectId, args.columnId)) return null

    const explicit = args.assignee !== undefined && args.assignee !== null
    const userCreation = args.source !== undefined
    const createdBy = userCreation ? userId : null
    const assignee = explicit ? args.assignee! : userCreation ? userId : null
    if (assignee !== null && !this.repos.projects.isActiveProjectMember(assignee, projectId)) {
      throw new Error(explicit
        ? 'Исполнитель должен быть активным и незаблокированным участником проекта'
        : 'Создатель не может быть назначен исполнителем в этом проекте')
    }
    const itemType = args.type ?? 'task'
    const skills = args.skills ?? this.repos.projects.projectDefaultSkills(projectId, itemType)
    const parent = args.parentId ? this.getTask(projectId, args.parentId) : null
    if (itemType === 'epic' && args.parentId) throw new Error('Эпик не может иметь родителя')
    if (args.parentId && !parent) throw new Error('Родитель не найден в проекте')
    if (itemType === 'story' && parent?.type !== 'epic') throw new Error('Родителем истории может быть только эпик')
    if (itemType === 'task' && parent && parent.type !== 'story' && parent.type !== 'epic') throw new Error('Недопустимый родитель задачи')

    const autoPilotDefault = (this.db.prepare(`SELECT autopilot_default FROM projects WHERE id = ?`).get(projectId) as { autopilot_default: number } | undefined)?.autopilot_default === 1
    const id = this.newId()
    const ts = this.now()
    const created = this.db.transaction(() => {
      if (key) {
        const prior = this.db.prepare(
          `SELECT task_id FROM task_creation_requests WHERE actor = ? AND idempotency_key = ?`
        ).get(userId, key) as { task_id: string } | undefined
        if (prior) return prior.task_id
      }
      const max = this.db.prepare(
        `SELECT MAX(position) AS m FROM tasks WHERE project_id = ? AND column_id = ?`
      ).get(projectId, args.columnId) as { m: number | null }
      const seq = this.repos.projects.nextTaskSeq(projectId)
      this.db.prepare(
        `INSERT INTO tasks (id, project_id, column_id, title, description, acceptance_criteria, type, parent_id, priority, assignee, created_by, created_by_name, agent_id, labels, skills, story_points, due_date, flagged, done_at, seq, position, created_at, updated_at, auto_pilot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, projectId, args.columnId, args.title, args.description ?? '',
        args.acceptanceCriteria ?? '', itemType, args.parentId ?? null,
        normPriority(args.priority ?? 'medium'), assignee, createdBy, createdBy,
        this.validateTaskAgent(userId, projectId, args.agentId),
        JSON.stringify(args.labels ?? []), JSON.stringify(skills),
        args.storyPoints ?? null, args.dueDate ?? null,
        this.repos.projects.isDoneColumn(args.columnId) ? ts : null, seq, (max.m ?? 0) + RANK_STEP, ts, ts,
        // Автопроход наследуется от настройки проекта: иначе конвейер каждой новой
        // карточки всё равно начинался с того, что человек включает флаг руками.
        // Только задачи — эпик и история этапы не проходят.
        itemType === 'task' && autoPilotDefault ? 1 : 0
      )
      this.db.prepare(
        `INSERT INTO task_creation_audit (id, project_id, task_id, created_by, created_by_name, assignee, source, assignment_method, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(this.newId(), projectId, id, createdBy, createdBy, assignee, args.source ?? 'system', userCreation ? (explicit ? 'explicit' : 'automatic') : 'system', ts)
      if (key) this.db.prepare(
        `INSERT INTO task_creation_requests (actor, idempotency_key, task_id) VALUES (?, ?, ?)`
      ).run(userId, key, id)
      this.repos.projects.touchProject(projectId, ts)
      return id
    })()
    return this.getTask(projectId, created)
  }

  updateTask(
    userId: string,
    projectId: string,
    taskId: string,
    fields: { title?: string; description?: string; acceptanceCriteria?: string; type?: WorkItemType; parentId?: string | null; priority?: TaskPriority; assignee?: string | null; agentId?: string | null; labels?: string[]; skills?: string[]; storyPoints?: number | null; dueDate?: number | null; flagged?: boolean; autoPilot?: boolean }
  ): Task | null {
    if (!this.repos.projects.isProjectMember(userId, projectId)) return null
    const current = this.getTask(projectId, taskId)

    if (!current) return null
    if (fields.assignee != null && !this.repos.projects.isActiveProjectMember(fields.assignee, projectId)) {
      throw new Error('Исполнитель должен быть активным участником проекта')
    }
    if (fields.agentId !== undefined) this.validateTaskAgent(userId, projectId, fields.agentId)
    const nextType = fields.type ?? current.type
    const nextParentId = fields.parentId === undefined ? current.parentId : fields.parentId
    if (nextParentId === taskId) throw new Error('Элемент не может быть своим родителем')
    const nextParent = nextParentId ? this.getTask(projectId, nextParentId) : null
    if (nextType === 'epic' && nextParentId) throw new Error('Эпик не может иметь родителя')
    if (nextParentId && !nextParent) throw new Error('Родитель не найден в проекте')
    if (nextType === 'story' && nextParent?.type !== 'epic') throw new Error('Родителем истории может быть только эпик')
    if (nextType === 'task' && nextParent && nextParent.type !== 'story' && nextParent.type !== 'epic') throw new Error('Недопустимый родитель задачи')
    let ancestor = nextParent
    while (ancestor) {
      if (ancestor.id === taskId) throw new Error('Циклическая иерархия')
      ancestor = ancestor.parentId ? this.getTask(projectId, ancestor.parentId) : null
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
      set.push('auto_pilot = ?')
      vals.push(fields.autoPilot ? 1 : 0)
    }
    if (!set.length) return current
    const ts = this.now()
    set.push('updated_at = ?')
    vals.push(ts)
    this.db.prepare(`UPDATE tasks SET ${set.join(', ')} WHERE id = ? AND project_id = ?`).run(...vals, taskId, projectId)
    // История изменений (вкладка «Активность», как в Jira): пишем только
    // реально изменившиеся человекочитаемые поля — техника (позиции, ранги)
    // человеку в истории не нужна.
    this.recordTaskHistoryDiff(userId, projectId, taskId, current, fields, ts)
    this.repos.projects.touchProject(projectId, ts)
    return this.getTask(projectId, taskId)
  }

  /** Дифф видимых полей задачи → строки истории. Пустая строка и null равны. */
  private recordTaskHistoryDiff(
    actor: string,
    projectId: string,
    taskId: string,
    before: Task,
    fields: Record<string, unknown>,
    at: number,
    via: 'user' | 'model' = 'user'
  ): void {
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
    const insert = this.db.prepare(`INSERT INTO task_history (id, project_id, task_id, actor, via, field, from_value, to_value, at) VALUES (?,?,?,?,?,?,?,?,?)`)
    for (const [field, was, next] of watched) {
      if (next === undefined) continue
      const fromValue = norm(was)
      const toValue = norm(next)
      if (fromValue === toValue) continue
      insert.run(this.newId(), projectId, taskId, actor, via, field, fromValue, toValue, at)
    }
  }

  private renormalizeColumn(projectId: string, columnId: string): void {
    const rows = this.db
      .prepare(`SELECT id FROM tasks WHERE project_id = ? AND column_id = ? ORDER BY position ASC, id ASC`)
      .all(projectId, columnId) as Array<{ id: string }>
    const upd = this.db.prepare(`UPDATE tasks SET position = ? WHERE id = ?`)
    rows.forEach((r, i) => upd.run((i + 1) * RANK_STEP, r.id))
  }

  /** Переместить задачу в колонку между соседями afterId (выше) и beforeId (ниже). */
  moveTask(
    userId: string,
    projectId: string,
    taskId: string,
    args: { columnId: string; afterId?: string | null; beforeId?: string | null }
  ): Task | null {
    if (!this.repos.projects.isProjectMember(userId, projectId)) return null
    const current = this.getTask(projectId, taskId)
    if (!current) return null
    if (!this.repos.projects.columnInProject(projectId, args.columnId)) return null
    const ts = this.now()
    this.db.transaction(() => {
      const rankOf = (nid: string | null | undefined): number | null => {
        if (!nid) return null
        const r = this.db
          .prepare(`SELECT position FROM tasks WHERE id = ? AND project_id = ? AND column_id = ?`)
          .get(nid, projectId, args.columnId) as { position: number } | undefined
        return r ? r.position : null
      }
      let after = rankOf(args.afterId)
      let before = rankOf(args.beforeId)
      let pos: number
      if (after != null && before != null) {
        if (Math.abs(after - before) < RANK_EPS) {
          this.renormalizeColumn(projectId, args.columnId)
          after = rankOf(args.afterId)
          before = rankOf(args.beforeId)
        }
        pos = ((after ?? 0) + (before ?? (after ?? 0) + 2 * RANK_STEP)) / 2
      } else if (after != null) {
        pos = after + RANK_STEP
      } else if (before != null) {
        pos = before - RANK_STEP
      } else {
        const max = (
          this.db
            .prepare(`SELECT MAX(position) AS m FROM tasks WHERE project_id = ? AND column_id = ?`)
            .get(projectId, args.columnId) as { m: number | null }
        ).m
        pos = (max ?? 0) + RANK_STEP
      }
      // Момент попадания в «Готово» — точка отсчёта, после которой карточка
      // уходит с доски. Переезд между done-колонками отсчёт не сбрасывает,
      // возврат в работу — сбрасывает (задача снова живая).
      const done = this.repos.projects.isDoneColumn(args.columnId) ? 1 : 0
      this.db
        .prepare(
          `UPDATE tasks SET column_id = ?, position = ?, updated_at = ?,
                  done_at = CASE WHEN ? = 1 THEN COALESCE(done_at, ?) ELSE NULL END
           WHERE id = ? AND project_id = ?`
        )
        .run(args.columnId, pos, ts, done, ts, taskId, projectId)
      // История: перенос между колонками — главное событие жизни карточки.
      // Перестановка внутри колонки историю не пишет: этап не изменился.
      const fromColumn = this.db.prepare(`SELECT name FROM kanban_columns WHERE id = ?`).get(current.columnId) as { name: string } | undefined
      const toColumn = this.db.prepare(`SELECT name FROM kanban_columns WHERE id = ?`).get(args.columnId) as { name: string } | undefined
      if (current.columnId !== args.columnId) {
        this.db.prepare(`INSERT INTO task_history (id, project_id, task_id, actor, via, field, from_value, to_value, at) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(this.newId(), projectId, taskId, userId, 'user', 'column', fromColumn?.name ?? current.columnId, toColumn?.name ?? args.columnId, ts)
      }
    })()
    this.repos.projects.touchProject(projectId, ts)
    return this.getTask(projectId, taskId)
  }

  taskActivity(userId: string, projectId: string, taskId: string): TaskActivity | null {
    if (!this.repos.projects.isProjectMember(userId, projectId)) return null
    if (!this.getTask(projectId, taskId)) return null
    const comments = (this.db.prepare(`SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC, rowid ASC`).all(taskId) as Array<Record<string, unknown>>)
      .map((row) => ({ id: String(row.id), taskId, author: String(row.author), via: row.via === 'model' ? 'model' as const : 'user' as const, text: String(row.text), createdAt: Number(row.created_at), updatedAt: row.updated_at === null ? null : Number(row.updated_at) }))
    const worklog = (this.db.prepare(`SELECT * FROM task_worklog WHERE task_id = ? ORDER BY started_at DESC, rowid DESC`).all(taskId) as Array<Record<string, unknown>>)
      .map((row) => ({ id: String(row.id), taskId, author: String(row.author), minutes: Number(row.minutes), comment: String(row.comment), startedAt: Number(row.started_at), createdAt: Number(row.created_at), updatedAt: row.updated_at === null ? null : Number(row.updated_at) }))
    const history = (this.db.prepare(`SELECT * FROM task_history WHERE task_id = ? ORDER BY at DESC, rowid DESC LIMIT 200`).all(taskId) as Array<Record<string, unknown>>)
      .map((row) => ({ id: String(row.id), taskId, actor: String(row.actor), via: row.via === 'model' ? 'model' as const : 'user' as const, field: String(row.field), from: row.from_value === null ? null : String(row.from_value), to: row.to_value === null ? null : String(row.to_value), at: Number(row.at) }))
    return { comments, worklog, history, totalMinutes: worklog.reduce((total, entry) => total + entry.minutes, 0) }
  }

  addTaskComment(userId: string, projectId: string, taskId: string, text: string, via: 'user' | 'model' = 'user'): TaskComment | null {
    if (!this.repos.projects.isProjectMember(userId, projectId)) return null
    if (!this.getTask(projectId, taskId)) return null
    const trimmed = text.trim()
    if (!trimmed) throw new Error('Пустой комментарий сохранять нечего')
    const id = this.newId(); const ts = this.now()
    this.db.prepare(`INSERT INTO task_comments (id, project_id, task_id, author, via, text, created_at, updated_at) VALUES (?,?,?,?,?,?,?,NULL)`)
      .run(id, projectId, taskId, userId, via, trimmed, ts)
    this.repos.projects.touchProject(projectId, ts)
    return { id, taskId, author: userId, via, text: trimmed, createdAt: ts, updatedAt: null }
  }

  updateTaskComment(userId: string, projectId: string, commentId: string, text: string): TaskComment | null {
    const row = this.db.prepare(`SELECT * FROM task_comments WHERE id = ? AND project_id = ?`).get(commentId, projectId) as Record<string, unknown> | undefined
    if (!row || !this.repos.projects.isProjectMember(userId, projectId)) return null
    if (!this.repos.projects.canModerateTaskEntry(userId, projectId, String(row.author))) throw new Error('Комментарий может править автор, владелец проекта или админ')
    const trimmed = text.trim()
    if (!trimmed) throw new Error('Пустой комментарий сохранять нечего')
    const ts = this.now()
    this.db.prepare(`UPDATE task_comments SET text = ?, updated_at = ? WHERE id = ?`).run(trimmed, ts, commentId)
    return { id: commentId, taskId: String(row.task_id), author: String(row.author), via: row.via === 'model' ? 'model' : 'user', text: trimmed, createdAt: Number(row.created_at), updatedAt: ts }
  }

  deleteTaskComment(userId: string, projectId: string, commentId: string): boolean {
    const row = this.db.prepare(`SELECT author FROM task_comments WHERE id = ? AND project_id = ?`).get(commentId, projectId) as { author: string } | undefined
    if (!row || !this.repos.projects.isProjectMember(userId, projectId)) return false
    if (!this.repos.projects.canModerateTaskEntry(userId, projectId, row.author)) throw new Error('Комментарий может удалить автор, владелец проекта или админ')
    return this.db.prepare(`DELETE FROM task_comments WHERE id = ?`).run(commentId).changes > 0
  }

  addTaskWorklog(userId: string, projectId: string, taskId: string, entry: { minutes: number; comment?: string; startedAt?: number }): TaskWorklogEntry | null {
    if (!this.repos.projects.isProjectMember(userId, projectId)) return null
    if (!this.getTask(projectId, taskId)) return null
    const minutes = Math.round(entry.minutes)
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60 * 31) throw new Error('Время — от 1 минуты до месяца')
    const id = this.newId(); const ts = this.now()
    const startedAt = entry.startedAt ?? ts
    this.db.prepare(`INSERT INTO task_worklog (id, project_id, task_id, author, minutes, comment, started_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,NULL)`)
      .run(id, projectId, taskId, userId, minutes, (entry.comment ?? '').trim(), startedAt, ts)
    this.repos.projects.touchProject(projectId, ts)
    return { id, taskId, author: userId, minutes, comment: (entry.comment ?? '').trim(), startedAt, createdAt: ts, updatedAt: null }
  }

  updateTaskWorklog(userId: string, projectId: string, entryId: string, patch: { minutes?: number; comment?: string; startedAt?: number }): TaskWorklogEntry | null {
    const row = this.db.prepare(`SELECT * FROM task_worklog WHERE id = ? AND project_id = ?`).get(entryId, projectId) as Record<string, unknown> | undefined
    if (!row || !this.repos.projects.isProjectMember(userId, projectId)) return null
    if (!this.repos.projects.canModerateTaskEntry(userId, projectId, String(row.author))) throw new Error('Запись ворклога может править автор, владелец проекта или админ')
    const minutes = patch.minutes === undefined ? Number(row.minutes) : Math.round(patch.minutes)
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60 * 31) throw new Error('Время — от 1 минуты до месяца')
    const ts = this.now()
    const comment = patch.comment === undefined ? String(row.comment) : patch.comment.trim()
    const startedAt = patch.startedAt ?? Number(row.started_at)
    this.db.prepare(`UPDATE task_worklog SET minutes = ?, comment = ?, started_at = ?, updated_at = ? WHERE id = ?`).run(minutes, comment, startedAt, ts, entryId)
    return { id: entryId, taskId: String(row.task_id), author: String(row.author), minutes, comment, startedAt, createdAt: Number(row.created_at), updatedAt: ts }
  }

  deleteTaskWorklog(userId: string, projectId: string, entryId: string): boolean {
    const row = this.db.prepare(`SELECT author FROM task_worklog WHERE id = ? AND project_id = ?`).get(entryId, projectId) as { author: string } | undefined
    if (!row || !this.repos.projects.isProjectMember(userId, projectId)) return false
    if (!this.repos.projects.canModerateTaskEntry(userId, projectId, row.author)) throw new Error('Запись ворклога может удалить автор, владелец проекта или админ')
    return this.db.prepare(`DELETE FROM task_worklog WHERE id = ?`).run(entryId).changes > 0
  }

  deleteTask(userId: string, projectId: string, taskId: string): boolean {
    if (!this.repos.projects.isProjectMember(userId, projectId)) return false
    let changes = 0
    this.db.transaction(() => {
      changes = this.db.prepare(`DELETE FROM tasks WHERE id = ? AND project_id = ?`).run(taskId, projectId).changes
    })()
    if (changes) this.repos.projects.touchProject(projectId)
    return changes > 0
  }

  /** Публичный доступ к задаче для CI-раннера (по членству проекта). */
  getCiTask(userId: string, projectId: string, taskId: string): Task | null {
    if (!this.repos.projects.isProjectMember(userId, projectId)) return null
    const task = this.getTask(projectId, taskId)
    // Дизайны едут вместе с задачей: их видит и промпт CI-рана, и контекст чата.
    return task ? { ...task, designs: this.taskDesigns(task.id) } : null
  }

  /**
   * Учёт «влито в прод-ветку, но прод не пересобран»: в проекте держим ОДНУ
   * открытую карточку «Пересборка прода», описание которой — список вмерженных
   * задач (строка на задачу). Идемпотентно: повторный ран той же задачи строку
   * не дублирует, а уехавшая в done карточка не мешает завести новую. Всё в
   * транзакции — иначе параллельные раны проекта наплодят дубли карточки.
   * `null`, если в проекте нет колонки `ready` (создавать карточку некуда).
   */
  ensureProdRebuildTask(userId: string, projectId: string, line: string): { task: Task; created: boolean; appended: boolean } | null {
    if (!this.repos.projects.isProjectMember(userId, projectId)) return null
    const entry = line.trim()
    if (!entry) return null
    return this.db.transaction(() => {
      const open = this.db
        .prepare(
          `SELECT t.id FROM tasks t JOIN kanban_columns c ON c.id = t.column_id
           WHERE t.project_id = ? AND t.title = ? AND COALESCE(c.semantic_type, '') != 'done'
           ORDER BY t.created_at ASC, t.id ASC LIMIT 1`
        )
        .get(projectId, PROD_REBUILD_TASK_TITLE) as { id: string } | undefined
      if (!open) {
        const columnId = this.repos.projects.getColumnIdBySemantic(projectId, 'ready')
        if (!columnId) return null
        const task = this.createTask(userId, projectId, {
          columnId,
          title: PROD_REBUILD_TASK_TITLE,
          description: `${PROD_REBUILD_TASK_INTRO}\n\n${entry}`,
          type: 'task',
          assignee: null
        })
        return task ? { task, created: true, appended: true } : null
      }
      const current = this.getTask(projectId, open.id)
      if (!current) return null
      if (current.description.split('\n').some((l) => l.trim() === entry)) return { task: current, created: false, appended: false }
      const description = `${current.description.replace(/\s+$/, '')}\n${entry}`
      const updated = this.updateTask(userId, projectId, open.id, { description })
      return updated ? { task: updated, created: false, appended: true } : null
    })()
  }

  /** Закрыта ли задача (Done/Отменена) или её уже нет: рабочую копию и её
   *  зависимости держим до этого момента — пост-development стадии выполняются
   *  в том же checkout, что и development-ран. */
  isTaskClosed(taskId: string): boolean {
    const row = this.db.prepare(`SELECT c.semantic_type FROM tasks t LEFT JOIN kanban_columns c ON c.id = t.column_id WHERE t.id = ?`).get(taskId) as { semantic_type: string | null } | undefined
    return !row || row.semantic_type === 'done' || row.semantic_type === 'cancelled'
  }

  taskTimeline(userId: string, projectId: string, taskId: string): TaskTimeline | null {
    if (!this.repos.projects.getProject(userId, projectId)) return null
    const task = this.db.prepare(`SELECT id, created_at, updated_at, done_at FROM tasks WHERE id = ? AND project_id = ?`).get(taskId, projectId) as { id: string; created_at: number; updated_at: number; done_at: number | null } | undefined
    if (!task) return null

    type Raw = {
      id: string; type: string; title: string; status: string; attempt: number
      queued: number | null; started: number | null; finished: number | null
      executor: string | null; machine: string | null; model: string | null
      reason_code: string | null; reason_message: string | null; kind: string
      position: number | null
    }
    const rows: Raw[] = []
    const append = (sql: string): void => {
      rows.push(...this.db.prepare(sql).all(taskId) as Raw[])
    }

    append(`SELECT r.id, 'development' type, 'Development' title, r.status, ROW_NUMBER() OVER (ORDER BY r.created_at, r.id) attempt,
      r.created_at queued, r.started_at started, r.finished_at finished, r.triggered_by executor, a.name machine,
      (SELECT NULLIF(u.model, '') FROM ci_run_usage u WHERE u.run_id=r.id ORDER BY u.at LIMIT 1) model,
      NULL reason_code, NULL reason_message, 'ci' kind, 20 position
      FROM ci_runs r LEFT JOIN agents a ON a.id=r.agent_id WHERE r.task_id=?`)
    append(`SELECT s.id, 'development_step:' || COALESCE(s.command_id, s.kind || ':' || s.title) type, s.title,
      s.status, s.attempt, NULL queued, s.started_at started, s.finished_at finished, r.triggered_by executor, a.name machine,
      (SELECT NULLIF(u.model, '') FROM ci_run_usage u WHERE u.run_id=r.id AND u.step_id=s.id ORDER BY u.at LIMIT 1) model,
      CASE WHEN s.status IN ('failed','timeout','cancelled','skipped') THEN 'step_' || s.status END reason_code,
      CASE WHEN s.exit_code IS NOT NULL AND s.exit_code <> 0 THEN 'exit ' || s.exit_code END reason_message,
      'ci_step' kind, 21 position FROM ci_run_steps s JOIN ci_runs r ON r.id=s.run_id LEFT JOIN agents a ON a.id=r.agent_id WHERE r.task_id=?`)
    append(`SELECT r.id, 'task_preparation' type, 'Создание и подготовка задачи' title, r.status, r.attempt,
      r.created_at queued, NULL started, r.finished_at finished, NULL executor, NULL machine, NULL model,
      CASE WHEN r.error IS NOT NULL THEN 'preparation_error' END reason_code, r.error reason_message, 'task_preparation' kind, 10 position
      FROM task_preparation_runs r WHERE r.task_id=?`)
    append(`SELECT r.id, 'component_qa' type, 'Component QA' title, r.status, r.attempt,
      r.created_at queued, r.started_at started, r.finished_at finished, NULL executor, NULL machine, NULL model,
      r.failure_classification reason_code, CASE WHEN length(r.blocker_reasons_json)>2 THEN r.blocker_reasons_json END reason_message,
      'component_qa' kind, 30 position FROM component_qa_runs r WHERE r.task_id=?`)
    append(`SELECT r.id, 'integration_tests' type, 'Создание и запуск интеграционных тестов' title, r.status, r.attempt,
      r.created_at queued, r.started_at started, r.finished_at finished, NULL executor, NULL machine, NULL model,
      r.failure_classification reason_code, COALESCE(r.failure_reason, r.stale_reason) reason_message,
      'integration_tests' kind, 40 position FROM integration_test_runs r WHERE r.task_id=?`)
    append(`SELECT r.id, r.stage type,
      CASE r.stage WHEN 'automated_qa' THEN 'Automated QA' WHEN 'component_qa' THEN 'Component QA' ELSE 'Интеграционные тесты' END title,
      r.status, r.attempt, r.created_at queued, r.started_at started, r.finished_at finished, r.triggered_by executor,
      NULL machine, NULLIF(r.llm_model,'') model,
      CASE WHEN r.error IS NOT NULL THEN 'qa_error' WHEN length(r.gate_reasons_json)>2 THEN 'gate_failed' END reason_code,
      COALESCE(r.error, CASE WHEN length(r.gate_reasons_json)>2 THEN r.gate_reasons_json END) reason_message,
      'qa_stage' kind, CASE r.stage WHEN 'component_qa' THEN 30 WHEN 'integration_tests' THEN 40 ELSE 50 END position
      FROM qa_stage_runs r WHERE r.task_id=?`)
    append(`SELECT r.id, 'manual_qa_preparation' type, 'Подготовка ручного тестирования' title, r.status, r.attempt,
      r.created_at queued, NULL started, r.finished_at finished, NULL executor, NULL machine, NULL model,
      CASE WHEN r.error IS NOT NULL THEN 'qa_preparation_error' END reason_code, r.error reason_message,
      'qa_preparation' kind, 60 position FROM qa_preparation_runs r WHERE r.task_id=?`)
    append(`SELECT r.id, 'manual_qa' type, 'Ручное тестирование' title, r.status,
      ROW_NUMBER() OVER (ORDER BY r.started_at, r.id) attempt, NULL queued, r.started_at started, r.finished_at finished,
      COALESCE(r.tester_id,r.initiated_by) executor, NULL machine, NULL model,
      CASE WHEN r.stale_reason IS NOT NULL THEN 'stale' END reason_code, r.stale_reason reason_message,
      'qa_session' kind, 70 position FROM qa_sessions r WHERE r.task_id=?`)
    append(`SELECT r.id, 'merge' type, 'Merge и push' title, r.status,
      ROW_NUMBER() OVER (ORDER BY r.created_at, r.id) attempt, r.created_at queued, r.started_at started, r.finished_at finished,
      r.triggered_by executor, a.name machine, NULL model,
      CASE WHEN r.error IS NOT NULL THEN 'merge_error' END reason_code, r.error reason_message,
      'merge' kind, 80 position FROM merge_runs r LEFT JOIN agents a ON a.id=r.agent_id WHERE r.task_id=?`)

    const normalize = (status: string): TaskTimelineStatus => {
      if (status === 'queued') return 'queued'
      if (status === 'running' || status === 'active' || ['checking','fetching','merging','resolving_conflicts','kb_update','testing','pushing'].includes(status)) return 'running'
      if (status === 'awaiting_input') return 'awaiting_input'
      if (['success','passed','done'].includes(status)) return 'succeeded'
      if (status === 'cancelled') return 'cancelled'
      if (status === 'skipped') return 'skipped'
      return 'failed'
    }
    const waitingRows = this.db.prepare(`SELECT i.run_id, i.created_at started, i.answered_at finished
      FROM ci_interactions i JOIN ci_runs r ON r.id=i.run_id WHERE r.task_id=? ORDER BY i.seq`).all(taskId) as Array<{ run_id: string; started: number; finished: number | null }>
    const toInterval = (start: number, end: number | null) => ({ startedAt: timelineIso(start)!, finishedAt: timelineIso(end), durationMs: timelineDuration(start, end) })
    const attempts = rows.map((row): TaskTimelineAttempt & { _position: number | null; _type: string; _title: string; _rawStart: number | null; _rawFinish: number | null; _active: Array<{ start: number; end: number | null }>; _queue: Array<{ start: number; end: number | null }>; _waiting: Array<{ start: number; end: number | null }> } => {
      const waiting = row.kind === 'ci' ? waitingRows.filter((item) => item.run_id === row.id).map((item) => ({ start: item.started, end: item.finished })) : []
      const active = row.started == null ? [] : subtractTimelineIntervals([{ start: row.started, end: row.finished }], waiting)
      const queue = row.queued != null && row.started != null ? [{ start: row.queued, end: row.started }] : []
      const status = normalize(row.status)
      return {
        id: `${row.kind}:${row.id}`, number: row.attempt, status,
        queuedAt: timelineIso(row.queued), startedAt: timelineIso(row.started), finishedAt: timelineIso(row.finished),
        queueIntervals: queue.map((item) => toInterval(item.start, item.end)),
        activeIntervals: active.map((item) => toInterval(item.start, item.end)),
        awaitingInputIntervals: waiting.map((item) => toInterval(item.start, item.end)),
        queueDuration: queue.length ? mergedTimelineDuration(queue) : row.queued == null || row.started == null ? null : 0,
        activeDuration: row.started == null ? null : mergedTimelineDuration(active),
        awaitingInputDuration: waiting.length ? mergedTimelineDuration(waiting) : 0,
        calendarDuration: timelineDuration(row.queued ?? row.started, row.finished),
        executor: row.executor, machine: row.machine, model: row.model,
        reason: row.reason_code || row.reason_message ? { code: row.reason_code, message: row.reason_message } : null,
        runs: [{ id: row.id, kind: row.kind }],
        dataComplete: row.started != null && (row.finished != null || ['running','awaiting_input'].includes(status)),
        _position: row.position, _type: row.type, _title: row.title, _rawStart: row.started, _rawFinish: row.finished,
        _active: active, _queue: queue, _waiting: waiting
      }
    })

    const grouped = new Map<string, typeof attempts>()
    for (const attempt of attempts) grouped.set(attempt._type, [...(grouped.get(attempt._type) ?? []), attempt])
    const stages: TaskTimelineStage[] = [...grouped.entries()].map(([type, items]) => {
      items.sort((a, b) => a.number - b.number || a.id.localeCompare(b.id))
      const latest = items[items.length - 1]
      const starts = items.map((item) => item._rawStart).filter((value): value is number => value != null)
      const finishes = items.map((item) => item._rawFinish).filter((value): value is number => value != null)
      const queued = items.map((item) => item.queuedAt ? Date.parse(item.queuedAt) : null).filter((value): value is number => value != null)
      const allTerminal = items.every((item) => ['succeeded','failed','cancelled','skipped'].includes(item.status))
      return {
        id: `stage:${type}`, type, title: latest._title, status: latest.status,
        queuedAt: timelineIso(queued.length ? Math.min(...queued) : null),
        startedAt: timelineIso(starts.length ? Math.min(...starts) : null),
        finishedAt: timelineIso(allTerminal && finishes.length ? Math.max(...finishes) : null),
        queueDuration: items.some((item) => item.queueDuration != null) ? mergedTimelineDuration(items.flatMap((item) => item._queue)) : null,
        activeDuration: items.some((item) => item.activeDuration != null) ? mergedTimelineDuration(items.flatMap((item) => item._active)) : null,
        awaitingInputDuration: mergedTimelineDuration(items.flatMap((item) => item._waiting)),
        calendarDuration: timelineDuration(queued.length ? Math.min(...queued) : starts.length ? Math.min(...starts) : null, allTerminal && finishes.length ? Math.max(...finishes) : null),
        attemptCount: items.filter((item) => item.status !== 'skipped' || item.runs.length > 0).length,
        successfulDuration: items.filter((item) => item.status === 'succeeded').reduce((sum, item) => sum + (item.calendarDuration ?? 0), 0),
        unsuccessfulDuration: items.filter((item) => ['failed','cancelled'].includes(item.status)).reduce((sum, item) => sum + (item.calendarDuration ?? 0), 0),
        executor: latest.executor, machine: latest.machine, model: latest.model, reason: latest.reason,
        runs: items.flatMap((item) => item.runs), attempts: items.map(({ _position, _type, _title, _rawStart, _rawFinish, _active, _queue, _waiting, ...attempt }) => attempt),
        workflowPosition: latest._position, dataComplete: items.every((item) => item.dataComplete)
      }
    }).sort((a, b) => (a.workflowPosition ?? Number.MAX_SAFE_INTEGER) - (b.workflowPosition ?? Number.MAX_SAFE_INTEGER)
      || (a.queuedAt || a.startedAt ? Date.parse(a.queuedAt ?? a.startedAt!) : task.created_at)
        - (b.queuedAt || b.startedAt ? Date.parse(b.queuedAt ?? b.startedAt!) : task.created_at)
      || a.id.localeCompare(b.id))

    if (task.done_at != null) stages.push({
      id: 'stage:completion', type: 'completion', title: 'Завершение', status: 'succeeded',
      queuedAt: null, startedAt: timelineIso(task.done_at), finishedAt: timelineIso(task.done_at),
      queueDuration: null, activeDuration: 0, awaitingInputDuration: 0, calendarDuration: 0,
      attemptCount: 0, successfulDuration: 0, unsuccessfulDuration: 0, executor: null, machine: null, model: null,
      reason: null, runs: [], attempts: [], workflowPosition: 100, dataComplete: true
    })
    const starts = attempts.map((item) => item._rawStart).filter((value): value is number => value != null)
    const facts = [task.created_at, task.updated_at, task.done_at, ...rows.flatMap((row) => [row.queued, row.started, row.finished]), ...waitingRows.flatMap((row) => [row.started, row.finished])]
      .filter((value): value is number => value != null)
    return {
      version: 1, taskId, generatedAt: new Date(this.now()).toISOString(),
      summary: {
        createdAt: timelineIso(task.created_at)!,
        firstStartedAt: timelineIso(starts.length ? Math.min(...starts) : null),
        finishedAt: timelineIso(task.done_at),
        calendarDuration: timelineDuration(task.created_at, task.done_at),
        activeDuration: mergedTimelineDuration(attempts.flatMap((item) => item._active)),
        queueDuration: mergedTimelineDuration(attempts.flatMap((item) => item._queue)),
        awaitingInputDuration: mergedTimelineDuration(attempts.flatMap((item) => item._waiting)),
        lastChangedAt: timelineIso(Math.max(...facts))!
      },
      stages
    }
  }

  // --- Предложения улучшений авторанов ---

  upsertTaskImprovement(args: Omit<TaskImprovement, 'id' | 'status' | 'isNew' | 'occurrences' | 'createdAt' | 'updatedAt' | 'acceptanceCriteria' | 'createdTaskId' | 'files'> & { acceptanceCriteria?: string; files?: string[] }): TaskImprovement {
    const redact = (value: string): string => value
      .replace(/\b(?:sk|ghp|github_pat|xox[baprs])[-_A-Za-z0-9]{12,}\b/gi, '[REDACTED]')
      .replace(/((?:token|password|secret|authorization|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
      .slice(0, 20_000)
    const evidence = [...new Set(args.evidence.map(redact).filter(Boolean))].slice(-30)
    const files = [...new Set((args.files ?? []).map((file) => file.trim()).filter(Boolean))].slice(0, 30)
    // Критерии по умолчанию — подтверждённые данные: так было до появления
    // явных критериев у анализатора, и старые вызовы продолжают работать.
    const acceptanceCriteria = redact(args.acceptanceCriteria?.trim() || evidence.join('\n'))
    const existing = this.db.prepare('SELECT * FROM task_improvements WHERE task_id=? AND fingerprint=?').get(args.taskId, args.fingerprint) as any
    const at = this.now()
    if (existing) {
      const merged = [...new Set([...(JSON.parse(existing.evidence_json || '[]') as string[]), ...evidence])].slice(-30)
      const mergedFiles = [...new Set([...(JSON.parse(existing.files_json || '[]') as string[]), ...files])].slice(0, 30)
      this.db.prepare(`UPDATE task_improvements SET run_id=?, step_id=?, source=?, description=?, acceptance_criteria=?, evidence_json=?, files_json=?, occurrences=occurrences+1, updated_at=? WHERE id=?`)
        .run(args.runId, args.stepId, args.source, redact(args.description), acceptanceCriteria, JSON.stringify(merged), JSON.stringify(mergedFiles), at, existing.id)
      return this.mapTaskImprovement(this.db.prepare('SELECT * FROM task_improvements WHERE id=?').get(existing.id) as any)
    }
    const id = this.newId()
    this.db.prepare(`INSERT INTO task_improvements
      (id,project_id,task_id,run_id,step_id,source,status,title,description,acceptance_criteria,fingerprint,evidence_json,files_json,occurrences,suggested_action,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'new',?,?,?,?,?,?,1,?,?,?)`)
      .run(id,args.projectId,args.taskId,args.runId,args.stepId,args.source,redact(args.title),redact(args.description),acceptanceCriteria,args.fingerprint,JSON.stringify(evidence),JSON.stringify(files),args.suggestedAction,at,at)
    return this.mapTaskImprovement(this.db.prepare('SELECT * FROM task_improvements WHERE id=?').get(id) as any)
  }

  listTaskImprovements(userId: string, projectId: string, taskId: string): TaskImprovement[] {
    if (!this.getCiTask(userId, projectId, taskId)) return []
    return (this.db.prepare('SELECT * FROM task_improvements WHERE project_id=? AND task_id=? ORDER BY updated_at DESC').all(projectId, taskId) as any[])
      .map((row) => this.mapTaskImprovement(row))
  }

  listProjectImprovementTaskIds(userId: string, projectId: string): Array<{ taskId: string; count: number; improvementId: string }> {
    if (!this.repos.projects.isProjectMember(userId, projectId)) return []
    return (this.db.prepare(`SELECT task_id, COUNT(*) count,
      (SELECT id FROM task_improvements i2 WHERE i2.task_id=i.task_id AND i2.status IN ('new','accepted') ORDER BY i2.updated_at DESC LIMIT 1) improvement_id
      FROM task_improvements i WHERE project_id=? AND status IN ('new','accepted') GROUP BY task_id`).all(projectId) as any[])
      .map((row) => ({ taskId: row.task_id, count: Number(row.count), improvementId: row.improvement_id }))
  }

  /**
   * Очередь «Улучшения» проекта: каждое актуальное (`new`/`accepted`) предложение
   * отдельной записью вместе с исходной задачей — колонка рисует карточку на
   * предложение, а не на задачу.
   */
  listProjectImprovements(userId: string, projectId: string): ProjectImprovement[] {
    if (!this.repos.projects.isProjectMember(userId, projectId)) return []
    return (this.db.prepare(`SELECT i.*, t.title task_title, t.seq task_seq, t.column_id task_column_id
      FROM task_improvements i JOIN tasks t ON t.id = i.task_id
      WHERE i.project_id=? AND i.status IN ('new','accepted') ORDER BY i.updated_at DESC`).all(projectId) as any[])
      .map((row) => ({ ...this.mapTaskImprovement(row), taskTitle: row.task_title, taskSeq: Number(row.task_seq), taskColumnId: row.task_column_id }))
  }

  /** Проект предложения — чтобы после удаления известить доску. */
  improvementProjectId(id: string): string | null {
    return (this.db.prepare('SELECT project_id FROM task_improvements WHERE id=?').get(id) as { project_id: string } | undefined)?.project_id ?? null
  }

  /** «Отмена» предложения в очереди: запись удаляется, а не помечается — очередь должна пустеть. */
  deleteTaskImprovement(userId: string, id: string): boolean {
    const row = this.db.prepare('SELECT project_id FROM task_improvements WHERE id=?').get(id) as { project_id: string } | undefined
    if (!row || !this.repos.projects.isProjectMember(userId, row.project_id)) return false
    return this.db.prepare('DELETE FROM task_improvements WHERE id=?').run(id).changes > 0
  }

  updateTaskImprovementStatus(userId: string, id: string, status: ImprovementStatus): TaskImprovement | null {
    const row = this.db.prepare('SELECT * FROM task_improvements WHERE id=?').get(id) as any
    if (!row || !this.repos.projects.isProjectMember(userId, row.project_id)) return null
    const allowed = (row.status === 'new' && (status === 'accepted' || status === 'rejected'))
      || (row.status === 'accepted' && status === 'implemented')
    if (!allowed) throw new Error(`Переход ${row.status} → ${status} недопустим`)
    const at = this.now()
    this.db.prepare('UPDATE task_improvements SET status=?, resolved_by=?, resolved_at=?, updated_at=? WHERE id=?')
      .run(status, userId, at, at, id)
    return this.mapTaskImprovement(this.db.prepare('SELECT * FROM task_improvements WHERE id=?').get(id) as any)
  }

  /**
   * Задача из предложения. Без `columnId` берётся единственная колонка `backlog`
   * (TODO): очередь улучшений обслуживается одной кнопкой, без выбора колонки.
   * Подготовку запускает вызывающий код (`startPreparation` у маршрута) — у БД
   * нет доступа к LLM-раннеру.
   */
  createTaskFromImprovement(userId: string, id: string, args: import('@voicechat/shared').CreateTaskFromImprovementInput): Omit<import('@voicechat/shared').CreateTaskFromImprovementResult, 'preparationStarted' | 'preparationError'> | null {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM task_improvements WHERE id=?').get(id) as any
      if (!row || !this.repos.projects.isProjectMember(userId, row.project_id)) return null
      if (row.created_task_id) {
        const task = this.getTask(row.project_id, row.created_task_id)
        if (!task) throw new Error('Связанная задача не найдена')
        return { task, improvement: this.mapTaskImprovement(row), created: false }
      }
      if (row.suggested_action !== 'create_chatai_task') throw new Error('Предложение не поддерживает создание задачи ChatAI')
      if (row.status !== 'new' && row.status !== 'accepted') throw new Error('Предложение уже обработано')
      if (!this.getTask(row.project_id, row.task_id)) throw new Error('Исходная задача не найдена')
      let columnId = args.columnId
      if (!columnId) {
        const backlog = (this.getBoard(userId, row.project_id)?.columns ?? []).filter((column) => column.semanticType === 'backlog')
        if (backlog.length !== 1) throw new Error(backlog.length === 0 ? 'В проекте нет колонки TODO (semantic type backlog)' : 'В проекте несколько колонок TODO: выберите колонку явно')
        columnId = backlog[0].id
      }
      if (!this.repos.projects.columnInProject(row.project_id, columnId)) throw new Error('Выбранная колонка недоступна')
      const title = (args.title ?? row.title).trim()
      if (!title) throw new Error('Название задачи обязательно')
      const description = args.description ?? row.description
      const acceptanceCriteria = args.acceptanceCriteria ?? (row.acceptance_criteria || '')
      const task = this.createTask(userId, row.project_id, { columnId, title, description, acceptanceCriteria, type: 'task', source: 'improvement' })
      if (!task) throw new Error('Не удалось создать задачу')
      this.db.prepare('UPDATE tasks SET source_task_id=? WHERE id=?').run(row.task_id, task.id)
      const at = this.now()
      this.db.prepare("UPDATE task_improvements SET created_task_id=?, status='implemented', resolved_by=?, resolved_at=?, updated_at=? WHERE id=? AND created_task_id IS NULL")
        .run(task.id, userId, at, at, id)
      const improvement = this.mapTaskImprovement(this.db.prepare('SELECT * FROM task_improvements WHERE id=?').get(id) as any)
      return { task: this.getTask(row.project_id, task.id)!, improvement, created: true }
    })()
  }

  private mapTaskImprovement(row: any): TaskImprovement {
    return {
      id: row.id, projectId: row.project_id, taskId: row.task_id, runId: row.run_id, stepId: row.step_id,
      source: row.source, status: row.status, title: row.title, description: row.description,
      acceptanceCriteria: row.acceptance_criteria || '', createdTaskId: row.created_task_id ?? null,
      fingerprint: row.fingerprint, evidence: JSON.parse(row.evidence_json || '[]'), files: JSON.parse(row.files_json || '[]'), occurrences: row.occurrences,
      suggestedAction: row.suggested_action, isNew: row.status === 'new', createdAt: row.created_at, updatedAt: row.updated_at
    }
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
  private latestTaskRunResults(scope: string, args: Record<string, unknown>): Map<string, TaskRunResult> {
    const rows = this.db.prepare(`
      SELECT task_id, id, kind, status, created_at, finished_at FROM (
        SELECT task_id, id, kind, status, created_at, finished_at,
               ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY ${TasksRepo.taskRunOrder()}) rn
          FROM (${TasksRepo.taskRunUnion(`task_id IN (${scope})`)})
      ) WHERE rn = 1
    `).all(args) as Array<{ task_id: string; id: string; kind: TaskRunResult['kind']; status: string; created_at: number; finished_at: number | null }>
    return new Map(rows.map((row) => [row.task_id, TasksRepo.toTaskRunResult(row)]))
  }

  latestTaskRunResult(taskId: string): TaskRunResult | null {
    const row = this.db.prepare(`
      SELECT id, kind, status, created_at, finished_at
        FROM (${TasksRepo.taskRunUnion('task_id = @taskId')})
       ORDER BY ${TasksRepo.taskRunOrder()} LIMIT 1
    `).get({ taskId }) as
      | { id: string; kind: TaskRunResult['kind']; status: string; created_at: number; finished_at: number | null }
      | undefined
    return row ? TasksRepo.toTaskRunResult(row) : null
  }

  listTaskReworkCycles(userId: string, projectId: string, taskId: string): TaskReworkCycle[] {
    if (!this.repos.projects.isProjectMember(userId, projectId)) return []
    const task = this.db.prepare('SELECT id FROM tasks WHERE id = ? AND project_id = ?').get(taskId, projectId)
    if (!task) return []
    const rows = this.db.prepare('SELECT * FROM task_rework_cycles WHERE task_id = ? ORDER BY sequence ASC').all(taskId) as Array<Record<string, unknown>>
    const attachments = this.db.prepare('SELECT * FROM task_rework_attachments WHERE cycle_id = ? ORDER BY position ASC')
    return rows.map((row) => ({
      id: String(row.id), taskId: String(row.task_id), sequence: Number(row.sequence),
      description: String(row.description), criteria: JSON.parse(String(row.criteria_json)),
      makeSources: JSON.parse(String(row.make_sources_json)),
      attachments: (attachments.all(row.id) as Array<Record<string, unknown>>).map((file) => ({
        id: String(file.upload_id), name: String(file.name), mimeType: String(file.mime_type),
        size: Number(file.size), status: 'ready' as const
      })),
      ...(row.implemented_result ? { implementedResult: String(row.implemented_result) } : {}),
      createdBy: String(row.created_by), createdAt: Number(row.created_at),
      preparationRunId: row.preparation_run_id == null ? null : String(row.preparation_run_id)
    }))
  }

  createTaskReworkCycle(
    userId: string,
    projectId: string,
    taskId: string,
    input: CreateTaskReworkCycleInput,
    files: Array<TaskAttachment & { uploadId: string }>
  ): TaskReworkCycle {
    const description = input.description.trim()
    if (!description) throw new Error('validation_error')
    const criteria = (input.criteria ?? []).map((item) => item.trim()).filter(Boolean)
    const makePaths = [...new Set(input.makePaths ?? [])].map((item) => item.trim()).filter(Boolean)
    if (input.makeMode !== 'whole_project' && input.makeMode !== 'files') throw new Error('validation_error')
    if (!input.idempotencyKey?.trim() || input.idempotencyKey.length > 200) throw new Error('validation_error')
    const makeSources = input.makeSources ?? [{ conversationId: '', title: '', mode: input.makeMode, paths: input.makeMode === 'files' ? makePaths : [] }]
    const payloadHash = createHash('sha256').update(JSON.stringify({ description, criteria, makeSources, uploadIds: input.uploadIds ?? [] })).digest('hex')
    return this.db.transaction(() => {
      if (!this.repos.projects.isProjectMember(userId, projectId)) throw new Error('not_found')
      const existing = this.db.prepare('SELECT payload_hash FROM task_rework_cycles WHERE task_id = ? AND idempotency_key = ?').get(taskId, input.idempotencyKey) as { payload_hash: string } | undefined
      if (existing) {
        if (existing.payload_hash !== payloadHash) throw new Error('idempotency_conflict')
        return this.listTaskReworkCycles(userId, projectId, taskId).find((cycle) =>
          (this.db.prepare('SELECT id FROM task_rework_cycles WHERE id = ? AND idempotency_key = ?').get(cycle.id, input.idempotencyKey))
        )!
      }
      if (files.length !== (input.uploadIds ?? []).length) throw new Error('invalid_upload')
      const task = this.db.prepare(`SELECT t.column_id, c.semantic_type
        FROM tasks t JOIN kanban_columns c ON c.id = t.column_id
        WHERE t.id = ? AND t.project_id = ?`).get(taskId, projectId) as { column_id: string; semantic_type: KanbanColumnSemanticType } | undefined
      if (!task) throw new Error('not_found')
      const allowed = new Set(['component_qa','integration_tests','automated_qa','testing','qa_preparation','manual_qa','awaiting_merge','merge','decision_required','done'])
      if (!allowed.has(task.semantic_type) || task.semantic_type === 'cancelled') throw new Error('invalid_state')
      const successful = this.db.prepare("SELECT id FROM ci_runs WHERE task_id = ? AND status = 'success' ORDER BY created_at DESC LIMIT 1").get(taskId) as { id: string } | undefined
      if (!successful) throw new Error('invalid_state')
      const activeDevelopment = this.db.prepare("SELECT id FROM ci_runs WHERE task_id = ? AND status IN ('queued','running','awaiting_input') LIMIT 1").get(taskId)
      const latestWorkflowRun = this.latestTaskRunResult(taskId)
      if (activeDevelopment || latestWorkflowRun?.outcome === 'active') throw new Error('active_run')
      const target = this.db.prepare("SELECT id FROM kanban_columns WHERE project_id = ? AND semantic_type = 'preparation' LIMIT 1").get(projectId) as { id: string } | undefined
      if (!target || !canTransitionWorkflow(task.semantic_type, 'preparation', 'user')) throw new Error('invalid_state')
      const sequence = Number((this.db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS n FROM task_rework_cycles WHERE task_id = ?').get(taskId) as { n: number }).n)
      const id = this.newId()
      const createdAt = this.now()
      const prep = this.db.prepare("SELECT id FROM task_preparation_runs WHERE task_id = ? AND status = 'success' ORDER BY created_at DESC LIMIT 1").get(taskId) as { id: string } | undefined
      this.db.prepare(`INSERT INTO task_rework_cycles
        (id, project_id, task_id, sequence, description, criteria_json, make_sources_json, created_by, created_at, preparation_run_id, idempotency_key, payload_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, projectId, taskId, sequence, description, JSON.stringify(criteria), JSON.stringify(makeSources), userId, createdAt, prep?.id ?? null, input.idempotencyKey, payloadHash)
      const insertFile = this.db.prepare('INSERT INTO task_rework_attachments (id, cycle_id, upload_id, position, name, mime_type, size) VALUES (?, ?, ?, ?, ?, ?, ?)')
      files.forEach((file, position) => insertFile.run(this.newId(), id, file.uploadId, position, file.name, file.mimeType, file.size))
      if (!this.moveTask(userId, projectId, taskId, { columnId: target.id })) throw new Error('invalid_state')
      return this.listTaskReworkCycles(userId, projectId, taskId).find((cycle) => cycle.id === id)!
    })()
  }

  setTaskPreviewReady(projectId: string, taskId: string, ready: boolean): void {
    this.db.prepare(`UPDATE tasks SET preview_ready=?, updated_at=? WHERE id=? AND project_id=?`).run(ready ? 1 : 0, this.now(), taskId, projectId)
  }

  getComponentQaTaskState(userId: string, projectId: string, taskId: string): ComponentQaTaskState | null {
    if (!this.repos.projects.isProjectMember(userId,projectId)) return null
    const task = this.db.prepare(`SELECT t.id,c.semantic_type FROM tasks t JOIN kanban_columns c ON c.id=t.column_id WHERE t.id=? AND t.project_id=?`).get(taskId,projectId) as {id:string;semantic_type:string}|undefined
    if (!task) return null
    const allRuns=(this.db.prepare(`SELECT * FROM component_qa_runs WHERE task_id=? ORDER BY attempt DESC,created_at DESC`).all(taskId) as Record<string,unknown>[]).map((row)=>this.repos.ci.mapComponentQaRun(row))
    const activeRun=allRuns.find((run)=>run.status==='queued'||run.status==='running') ?? null
    const latestRun=allRuns[0] ?? null
    const runs=trimHistoricalRunLogs(allRuns,[activeRun?.id,latestRun?.id])
    const prep=this.db.prepare(`SELECT readiness_json FROM task_preparation_runs WHERE task_id=? AND status='success' AND readiness_json IS NOT NULL ORDER BY created_at DESC LIMIT 1`).get(taskId) as {readiness_json:string}|undefined
    const readiness=prep ? parseJsonValue<DevelopmentReadiness|null>(prep.readiness_json,null) : null
    const workspace=this.repos.ci.findLatestPushedCiWorkspace(projectId,taskId)
    const launchReasons:string[]=[]
    if (task.semantic_type!=='component_qa') launchReasons.push('task_not_in_component_qa')
    if (!workspace?.branch || !workspace.commitSha) launchReasons.push('missing_development_workspace')
    if (!readiness) launchReasons.push('missing_readiness_snapshot')
    else launchReasons.push(...componentQaLaunchReasons(readiness))
    let gateReasons:string[]=[]
    if (latestRun && workspace && readiness) gateReasons=canCompleteComponentQa({
      run:latestRun,currentCommitSha:workspace.commitSha ?? '',currentReadinessVersion:componentQaSemanticVersion(readiness),
      acceptanceCriteriaConflict:readiness.acceptanceCriteriaConflict
    }).reasons
    return {activeRun,latestRun,runs,launchReasons,canStart:!activeRun&&launchReasons.length===0,canComplete:gateReasons.length===0&&!!latestRun,gateReasons}
  }

  completeComponentQaRun(userId:string,projectId:string,taskId:string,runId:string):ComponentQaRun {
    if (!this.repos.projects.canQa(userId,projectId)) throw new Error('QA permission required')
    const run=this.repos.ci.getComponentQaRun(userId,runId)
    const workspace=this.repos.ci.findLatestPushedCiWorkspace(projectId,taskId)
    const prep=this.db.prepare(`SELECT readiness_json FROM task_preparation_runs WHERE task_id=? AND status='success' AND readiness_json IS NOT NULL ORDER BY created_at DESC LIMIT 1`).get(taskId) as {readiness_json:string}|undefined
    if (!run||run.taskId!==taskId||!workspace?.commitSha||!prep) throw new Error('component QA state incomplete')
    const readiness=parseJsonValue<DevelopmentReadiness|null>(prep.readiness_json,null)
    if (!readiness) throw new Error('component QA state incomplete')
    const gate=canCompleteComponentQa({run,currentCommitSha:workspace.commitSha,currentReadinessVersion:componentQaSemanticVersion(readiness),acceptanceCriteriaConflict:readiness.acceptanceCriteriaConflict})
    if (!gate.allowed) throw new Error(`component QA gate incomplete: ${gate.reasons.join(', ')}`)
    const task=this.db.prepare(`SELECT c.semantic_type FROM tasks t JOIN kanban_columns c ON c.id=t.column_id WHERE t.id=? AND t.project_id=?`).get(taskId,projectId) as {semantic_type:string}|undefined
    if (task?.semantic_type!=='component_qa'||!canTransitionWorkflow('component_qa','integration_tests','automation')) throw new Error('workflow transition conflict')
    const target=this.repos.projects.getColumnIdBySemantic(projectId,'integration_tests')
    if (!target) throw new Error('integration_tests column not found')
    this.moveTask(userId,projectId,taskId,{columnId:target})
    return run
  }

  currentIntegrationInputs(projectId:string,taskId:string) {
    const task=this.db.prepare(`SELECT c.semantic_type FROM tasks t JOIN kanban_columns c ON c.id=t.column_id WHERE t.id=? AND t.project_id=?`).get(taskId,projectId) as {semantic_type:string}|undefined
    const workspace=this.repos.ci.findLatestPushedCiWorkspace(projectId,taskId)
    const prep=this.db.prepare(`SELECT id,readiness_json FROM task_preparation_runs WHERE task_id=? AND status='success' AND readiness_json IS NOT NULL ORDER BY created_at DESC LIMIT 1`).get(taskId) as {id:string;readiness_json:string}|undefined
    const readiness=prep?parseJsonValue<DevelopmentReadiness|null>(prep.readiness_json,null):null
    const dev=workspace?this.db.prepare(`SELECT id FROM ci_runs WHERE project_id=? AND task_id=? AND workspace_id=? AND status='success' ORDER BY created_at DESC LIMIT 1`).get(projectId,taskId,workspace.id) as {id:string}|undefined:undefined
    return {task,workspace,prep,readiness,dev}
  }

  moveMergeTask(projectId: string, taskId: string, semanticType: 'done' | 'merge' | 'awaiting_merge' | 'decision_required'): void {
    const now = this.now()
    this.db.prepare(`UPDATE tasks SET column_id=(SELECT id FROM kanban_columns WHERE project_id=? AND semantic_type=?), done_at=?, updated_at=? WHERE id=? AND project_id=?`)
      .run(projectId, semanticType, semanticType === 'done' ? now : null, now, taskId, projectId)
  }

  upsertTaskRepository(projectId: string, taskId: string, agentId: string, path: string, kind: TaskRepository['kind']): void {
    this.db.prepare(`INSERT INTO task_repositories (id,project_id,task_id,agent_id,path,kind,state,created_at) VALUES (?,?,?,?,?,?,'active',?)
      ON CONFLICT(task_id,agent_id,path) DO UPDATE SET state='active', deleted_at=NULL, kind=excluded.kind`).run(this.newId(), projectId, taskId, agentId, path, kind, this.now())
  }

  markTaskRepositoryDeleted(taskId: string, agentId: string, path: string): void {
    this.db.prepare(`UPDATE task_repositories SET state='deleted', deleted_at=? WHERE task_id=? AND agent_id=? AND path=? AND state='active'`).run(this.now(), taskId, agentId, path)
  }

  listActiveTaskRepositories(taskId: string): TaskRepository[] {
    return (this.db.prepare(`SELECT r.*, a.name AS machine_name FROM task_repositories r LEFT JOIN agents a ON a.id=r.agent_id WHERE r.task_id=? AND r.state='active' ORDER BY r.created_at`).all(taskId) as Record<string, unknown>[]).map(mapTaskRepository)
  }

  getTaskRepositoryById(id: string): TaskRepository | null {
    const r = this.db.prepare(`SELECT r.*, a.name AS machine_name FROM task_repositories r LEFT JOIN agents a ON a.id=r.agent_id WHERE r.id=?`).get(id) as Record<string, unknown> | undefined
    return r ? mapTaskRepository(r) : null
  }

  listTaskRepositories(userId: string, projectId: string, taskId: string): TaskRepository[] {
    if (!this.repos.projects.isProjectMember(userId, projectId)) return []
    return (this.db.prepare(`SELECT r.*, a.name AS machine_name FROM task_repositories r LEFT JOIN agents a ON a.id=r.agent_id WHERE r.task_id=? AND r.project_id=? ORDER BY r.created_at`).all(taskId, projectId) as Record<string, unknown>[]).map(mapTaskRepository)
  }

  private preparationEvents(attemptId: string): PreparationEvent[] {
    const rows = this.db.prepare(`SELECT * FROM task_preparation_events WHERE attempt_id=? ORDER BY sequence`).all(attemptId) as Record<string, unknown>[]
    return rows.map((row) => ({
      eventId: String(row.event_id), attemptId: String(row.attempt_id), sequence: Number(row.sequence),
      timestamp: Number(row.timestamp), type: String(row.type), phase: row.phase as TaskPreparationPhase,
      text: String(row.text), ...(row.data_json ? { data: parseJsonValue<Record<string, unknown>>(String(row.data_json), {}) } : {})
    }))
  }

  private preparationSteps(attemptId: string): TaskPreparationStep[] {
    const events = this.preparationEvents(attemptId)
    const rows = this.db.prepare(`SELECT * FROM task_preparation_steps WHERE attempt_id=? ORDER BY ordinal`).all(attemptId) as Record<string, unknown>[]
    return rows.map((row) => {
      const id = String(row.id)
      const startedAt = row.started_at == null ? null : Number(row.started_at)
      const finishedAt = row.finished_at == null ? null : Number(row.finished_at)
      const phaseMatches = (phase: TaskPreparationPhase): boolean => id.endsWith(':infrastructure')
        ? ['initialization', 'knowledge_research', 'hierarchy_research', 'related_tasks_research', 'code_research', 'tests_research', 'storybook_research'].includes(phase)
        : id.endsWith(':model')
          ? ['clarification', 'brief_generation'].includes(phase)
          : ['readiness_validation', 'persistence', 'completed'].includes(phase)
      return {
        id, name: String(row.name), ordinal: Number(row.ordinal), status: row.status as TaskPreparationStep['status'],
        startedAt, finishedAt, durationMs: startedAt == null ? null : Math.max(0, (finishedAt ?? this.now()) - startedAt),
        error: row.error as string | null,
        log: events.filter((event) => phaseMatches(event.phase) && event.type === 'model_output').map((event) => ({ ...event, stepId: id, stream: 'stdout' as const }))
      }
    })
  }

  private preparationQuestions(attemptId: string): PreparationQuestion[] {
    const rows = this.db.prepare(`SELECT * FROM task_preparation_questions WHERE attempt_id=? ORDER BY asked_at,question_id`).all(attemptId) as Record<string, unknown>[]
    return rows.map((row) => ({
      questionId: String(row.question_id), attemptId: String(row.attempt_id), text: String(row.text),
      material: Boolean(row.material), status: row.answered_at == null ? 'open' : 'answered',
      answer: row.answer as string | null, askedAt: Number(row.asked_at),
      answeredAt: row.answered_at == null ? null : Number(row.answered_at), answeredBy: row.answered_by as string | null
    }))
  }

  private mapTaskPreparationRun(row: Record<string, unknown>): TaskPreparationRun {
    const status = row.status as TaskPreparationRun['status']
    const createdAt = Number(row.created_at)
    const startedAt = row.started_at == null ? createdAt : Number(row.started_at)
    const finishedAt = row.finished_at == null ? null : Number(row.finished_at)
    return {
      id: String(row.id), attemptId: String(row.id), projectId: String(row.project_id), taskId: String(row.task_id),
      taskKey: String(row.task_key || row.task_id), status, phase: (row.phase || (status === 'success' ? 'completed' : 'initialization')) as TaskPreparationPhase,
      attempt: Number(row.attempt), attemptNumber: Number(row.attempt), maxAttempts: 2,
      machineId: row.machine_id as string | null, machineName: row.machine_name_snapshot as string | null,
      llmEngineId: row.llm_engine_id as string | null, provider: (row.provider ?? 'claude') as LlmProvider,
      model: String(row.model ?? ''), profileId: String(row.profile_id ?? ''),
      log: String(row.log ?? ''), events: this.preparationEvents(String(row.id)), steps: this.preparationSteps(String(row.id)), questions: this.preparationQuestions(String(row.id)),
      error: row.error as string | null,
      readiness: row.readiness_json ? parseJsonValue<DevelopmentReadiness>(String(row.readiness_json), null as unknown as DevelopmentReadiness) : null,
      gateReasons: parseStringArray(String(row.gate_reasons_json ?? '[]')),
      gateResults: parseJsonValue<PreparationGateResult[]>(String(row.gate_results_json ?? '[]'), []),
      createdAt, startedAt, finishedAt, durationMs: Math.max(0, (finishedAt ?? this.now()) - startedAt),
      canRetry: status === 'failed' || status === 'cancelled' || status === 'blocked',
      canCancel: status === 'queued' || status === 'running' || status === 'waiting_for_answer' || status === 'validating',
      canAnswer: status === 'waiting_for_answer'
    }
  }

  getTaskPreparationRun(userId: string, runId: string): TaskPreparationRun | null {
    const row = this.db.prepare(`SELECT p.* FROM task_preparation_runs p JOIN project_members m ON m.project_id=p.project_id WHERE p.id=? AND m.username=?`).get(runId, userId) as Record<string, unknown> | undefined
    return row ? this.mapTaskPreparationRun(row) : null
  }

  listTaskPreparationRuns(userId: string, projectId: string, taskId: string): TaskPreparationRun[] {
    if (!this.repos.projects.isProjectMember(userId, projectId)) return []
    return (this.db.prepare(`SELECT * FROM task_preparation_runs WHERE project_id=? AND task_id=? ORDER BY attempt DESC`).all(projectId, taskId) as Record<string, unknown>[]).map((row) => this.mapTaskPreparationRun(row))
  }

  appendTaskPreparationEvent(attemptId: string, type: string, phase: TaskPreparationPhase, text: string, data?: Record<string, unknown>): PreparationEvent | null {
    return this.db.transaction(() => {
      const run = this.db.prepare(`SELECT id FROM task_preparation_runs WHERE id=?`).get(attemptId)
      if (!run) return null
      const sequence = Number((this.db.prepare(`SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM task_preparation_events WHERE attempt_id=?`).get(attemptId) as { sequence: number }).sequence)
      const eventId = this.newId(), timestamp = this.now(), safeText = redactPreparationText(text)
      this.db.prepare(`INSERT INTO task_preparation_events (event_id,attempt_id,sequence,timestamp,type,phase,text,data_json) VALUES (?,?,?,?,?,?,?,?)`).run(
        eventId, attemptId, sequence, timestamp, type, phase, safeText, data ? JSON.stringify(data) : null
      )
      return { eventId, attemptId, sequence, timestamp, type, phase, text: safeText, ...(data ? { data } : {}) }
    })()
  }

  transitionTaskPreparationRun(id: string, status: TaskPreparationRun['status'], phase: TaskPreparationPhase, text: string): void {
    const terminal = ['success', 'completed', 'failed', 'cancelled', 'blocked']
    this.db.transaction(() => {
      const row = this.db.prepare(`SELECT status FROM task_preparation_runs WHERE id=?`).get(id) as { status: string } | undefined
      if (!row || terminal.includes(row.status)) return
      this.db.prepare(`UPDATE task_preparation_runs SET status=?,phase=? WHERE id=?`).run(status, phase, id)
      this.appendTaskPreparationEvent(id, 'state_changed', phase, text, { status, phase })
    })()
  }

  createTaskPreparationQuestion(id: string, text: string, material = true): PreparationQuestion | null {
    const questionId = this.newId(), askedAt = this.now(), safeText = redactPreparationText(text)
    const changed = this.db.prepare(`INSERT INTO task_preparation_questions (question_id,attempt_id,text,material,asked_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM task_preparation_runs WHERE id=? AND status IN ('running','validating'))`).run(questionId, id, safeText, material ? 1 : 0, askedAt, id)
    if (!changed.changes) return null
    this.transitionTaskPreparationRun(id, 'waiting_for_answer', 'clarification', 'Требуется ответ на существенный вопрос')
    this.appendTaskPreparationEvent(id, 'question_asked', 'clarification', safeText, { questionId, material })
    return this.preparationQuestions(id).find((question) => question.questionId === questionId) ?? null
  }

  answerTaskPreparationQuestion(userId: string, questionId: string, answer: string): PreparationAnswerResult | null {
    return this.db.transaction(() => {
      const row = this.db.prepare(`SELECT q.attempt_id FROM task_preparation_questions q JOIN task_preparation_runs r ON r.id=q.attempt_id JOIN project_members m ON m.project_id=r.project_id WHERE q.question_id=? AND m.username=?`).get(questionId, userId) as { attempt_id: string } | undefined
      if (!row) return null
      const safeAnswer = redactPreparationText(answer).trim()
      if (!safeAnswer) throw new Error('Ответ не может быть пустым')
      const answeredAt = this.now()
      const result = this.db.prepare(`UPDATE task_preparation_questions SET answer=?,answered_at=?,answered_by=? WHERE question_id=? AND answered_at IS NULL`).run(safeAnswer, answeredAt, userId, questionId)
      const question = this.preparationQuestions(row.attempt_id).find((item) => item.questionId === questionId)!
      if (!result.changes) return { accepted: false, alreadyAnswered: true, question }
      this.db.prepare(`UPDATE task_preparation_runs SET status='queued',phase='clarification' WHERE id=? AND status='waiting_for_answer'`).run(row.attempt_id)
      this.appendTaskPreparationEvent(row.attempt_id, 'answer_accepted', 'clarification', 'Ответ принят', { questionId })
      return { accepted: true, alreadyAnswered: false, question }
    })()
  }

  listTaskPreparationNotifications(userId: string): PreparationClarificationNotification[] {
    const rows = this.db.prepare(`
      SELECT q.question_id,q.attempt_id,q.text,q.asked_at,
             r.project_id,r.task_id,p.name AS project_name,t.title AS task_title,
             d.dismissed_at
      FROM task_preparation_questions q
      JOIN task_preparation_runs r ON r.id=q.attempt_id
      JOIN projects p ON p.id=r.project_id
      JOIN tasks t ON t.id=r.task_id
      JOIN project_members m ON m.project_id=r.project_id AND m.username=?
      LEFT JOIN task_preparation_notification_dismissals d
        ON d.question_id=q.question_id AND d.user_id=?
      WHERE q.material=1 AND q.answered_at IS NULL AND r.status='waiting_for_answer'
        AND d.question_id IS NULL
      ORDER BY q.asked_at,q.question_id
    `).all(userId, userId) as Record<string, unknown>[]
    return rows.map((row) => ({
      questionId: String(row.question_id), attemptId: String(row.attempt_id),
      projectId: String(row.project_id), projectName: String(row.project_name),
      taskId: String(row.task_id), taskTitle: String(row.task_title),
      text: String(row.text), askedAt: Number(row.asked_at),
      dismissedAt: row.dismissed_at == null ? null : Number(row.dismissed_at)
    }))
  }

  dismissTaskPreparationNotification(userId: string, questionId: string): boolean {
    const now = this.now()
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO task_preparation_notification_dismissals (question_id,user_id,dismissed_at)
      SELECT q.question_id,?,?
      FROM task_preparation_questions q
      JOIN task_preparation_runs r ON r.id=q.attempt_id
      JOIN project_members m ON m.project_id=r.project_id AND m.username=?
      WHERE q.question_id=? AND q.material=1 AND q.answered_at IS NULL AND r.status='waiting_for_answer'
    `).run(userId, now, userId, questionId)
    if (result.changes) return true
    return Boolean(this.db.prepare(`SELECT 1 FROM task_preparation_notification_dismissals WHERE question_id=? AND user_id=?`).get(questionId, userId))
  }

  confirmedDevelopmentReadiness(taskId: string): DevelopmentReadiness | null {
    const row = this.db.prepare(`SELECT id,readiness_json,gate_results_json FROM task_preparation_runs WHERE task_id=? AND status IN ('success','completed') AND readiness_json IS NOT NULL ORDER BY attempt DESC LIMIT 1`).get(taskId) as { id: string; readiness_json: string; gate_results_json: string } | undefined
    if (!row) return null
    const readiness = parseJsonValue<DevelopmentReadiness | null>(row.readiness_json, null)
    if (!readiness) return null
    if (readiness.schemaVersion !== 2) return readiness
    const gates = parseJsonValue<PreparationGateResult[]>(row.gate_results_json, [])
    if (!readiness.confirmation?.confirmed || readiness.confirmation.attemptId !== row.id || !gates.length || gates.some((gate) => gate.status !== 'pass')) return null
    return readiness
  }

  getTaskLaunchPreparationResult(userId: string, projectId: string, proposalId: string): TaskLaunchResult | null {
    if (!this.repos.projects.isProjectMember(userId, projectId)) return null
    const row = this.db.prepare(`SELECT task_id,run_id,error FROM task_launch_results WHERE project_id=? AND proposal_id=? AND action='preparation'`).get(projectId, proposalId) as { task_id: string; run_id: string | null; error: string | null } | undefined
    if (!row) return null
    if (row.error) return { type: 'preparation', status: 'partial', taskId: row.task_id, runId: row.run_id ?? undefined, error: row.error, canRetry: true }
    if (!row.run_id) return { type: 'preparation', status: 'partial', taskId: row.task_id, error: 'Подготовка ещё не запущена', canRetry: true }
    return { type: 'preparation', status: 'success', taskId: row.task_id, runId: row.run_id }
  }

  createTaskFromProposalInPreparation(userId: string, projectId: string, proposalId: string, args: Omit<Parameters<TasksRepo['createTask']>[2], 'columnId'>): TaskLaunchResult {
    if (!this.repos.projects.isProjectMember(userId, projectId)) throw new Error('Проект недоступен')
    const previous = this.getTaskLaunchPreparationResult(userId, projectId, proposalId)
    if (previous) return previous
    const columns = this.db.prepare(`SELECT id FROM kanban_columns WHERE project_id=? AND semantic_type='preparation'`).all(projectId) as Array<{ id: string }>
    if (columns.length !== 1) throw new Error(columns.length === 0 ? 'Не настроена колонка с semantic type preparation' : 'Найдено несколько колонок с semantic type preparation')
    return this.db.transaction(() => {
      const repeated = this.getTaskLaunchPreparationResult(userId, projectId, proposalId)
      if (repeated) return repeated
      const task = this.createTask(userId, projectId, { ...args, columnId: columns[0].id })
      if (!task) throw new Error('Не удалось создать задачу')
      const now = this.now()
      this.db.prepare(`INSERT INTO task_launch_results (project_id,proposal_id,action,task_id,created_by,created_at,updated_at) VALUES (?,?,'preparation',?,?,?,?)`).run(projectId, proposalId, task.id, userId, now, now)
      return { type: 'preparation', status: 'partial', taskId: task.id, error: 'Подготовка ещё не запущена', canRetry: true } as TaskLaunchResult
    })()
  }

  saveTaskLaunchPreparationRun(projectId: string, proposalId: string, runId: string | null, error: string | null): void {
    this.db.prepare(`UPDATE task_launch_results SET run_id=?,error=?,updated_at=? WHERE project_id=? AND proposal_id=? AND action='preparation'`).run(runId, error, this.now(), projectId, proposalId)
  }

  activeTaskPreparationRun(userId: string, projectId: string, taskId: string): TaskPreparationRun | null {
    if (!this.repos.projects.isProjectMember(userId, projectId)) throw new Error('Проект недоступен')
    const row = this.db.prepare(`SELECT * FROM task_preparation_runs WHERE project_id=? AND task_id=? AND status IN ('queued','running','waiting_for_answer','validating')`).get(projectId, taskId) as Record<string, unknown> | undefined
    return row ? this.mapTaskPreparationRun(row) : null
  }

  startTaskPreparationRun(userId: string, projectId: string, taskId: string, execution: { machineId?: string | null; machineName?: string | null; llmEngineId?: string | null; provider: LlmProvider; model: string } = { provider: 'claude', model: '' }): TaskPreparationRun {
    if (!this.repos.projects.isProjectMember(userId, projectId)) throw new Error('Проект недоступен')
    const task = this.getTask(projectId, taskId)
    if (!task || task.type !== 'task') throw new Error('Задача не найдена')
    const board = this.getBoard(userId, projectId)
    const current = board?.columns.find((column) => column.id === task.columnId)
    if (current?.semanticType !== 'backlog' && current?.semanticType !== 'preparation') throw new Error('Подготовку можно запускать только из TODO или Подготовки к разработке')
    const active = this.db.prepare(`SELECT * FROM task_preparation_runs WHERE task_id=? AND status IN ('queued','running','waiting_for_answer','validating')`).get(taskId) as Record<string, unknown> | undefined
    if (active) return this.mapTaskPreparationRun(active)
    const preparationColumns = board?.columns.filter((column) => column.semanticType === 'preparation') ?? []
    if (preparationColumns.length !== 1) throw new Error(preparationColumns.length === 0 ? 'Не настроена колонка с semantic type preparation' : 'Найдено несколько колонок с semantic type preparation')
    const target = preparationColumns[0].id
    const id = this.newId(), now = this.now()
    const attempt = Number((this.db.prepare(`SELECT COALESCE(MAX(attempt), 0) + 1 AS attempt FROM task_preparation_runs WHERE task_id=?`).get(taskId) as { attempt: number }).attempt)
    const profileId = createHash('sha256').update(userId).digest('hex').slice(0, 16)
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO task_preparation_runs (id,project_id,task_id,task_key,status,phase,attempt,machine_id,machine_name_snapshot,llm_engine_id,provider,model,profile_id,created_at,started_at) VALUES (?,?,?,?, 'running','initialization',?,?,?,?,?,?,?,?,?)`).run(id, projectId, taskId, taskId, attempt, execution.machineId ?? null, execution.machineName ? redactPreparationText(execution.machineName) : null, execution.llmEngineId ?? null, execution.provider, redactPreparationText(execution.model), profileId, now, now)
      const steps = [['infrastructure', 1, 'Подготовка инфраструктуры'], ['model', 2, 'Работа модели'], ['result', 3, 'Проверка и сохранение результата']] as const
      for (const [suffix, ordinal, name] of steps) this.db.prepare(`INSERT INTO task_preparation_steps (id,attempt_id,ordinal,name,status,started_at) VALUES (?,?,?,?,?,?)`).run(`${id}:${suffix}`, id, ordinal, name, ordinal === 1 ? 'running' : 'queued', ordinal === 1 ? now : null)
      this.appendTaskPreparationEvent(id, 'attempt_created', 'initialization', 'Попытка подготовки создана')
      this.appendTaskPreparationEvent(id, 'attempt_started', 'initialization', 'Подготовка запущена')
      if (task.columnId !== target) this.moveTask(userId, projectId, taskId, { columnId: target })
    })()
    return this.getTaskPreparationRun(userId, id)!
  }

  appendTaskPreparationLog(id: string, chunk: string): void {
    const safe = redactPreparationText(chunk)
    this.db.prepare(`UPDATE task_preparation_runs SET log=substr(log || ?, -500000) WHERE id=? AND status IN ('queued','running','validating')`).run(safe, id)
    if (safe.trim()) {
      const phase = (this.db.prepare(`SELECT phase FROM task_preparation_runs WHERE id=?`).get(id) as { phase: TaskPreparationPhase } | undefined)?.phase ?? 'brief_generation'
      this.appendTaskPreparationEvent(id, 'model_output', phase, safe)
    }
  }

  setTaskPreparationExecution(id: string, _execution: { llmEngineId?: string | null; provider: LlmProvider; model: string }, phase: TaskPreparationPhase = 'knowledge_research'): void {
    const now = this.now()
    this.db.transaction(() => {
      this.db.prepare(`UPDATE task_preparation_runs SET status='running',phase=? WHERE id=? AND status IN ('queued','running')`).run(phase, id)
      this.db.prepare(`UPDATE task_preparation_steps SET status='success',finished_at=? WHERE id=? AND status='running'`).run(now, `${id}:infrastructure`)
      this.db.prepare(`UPDATE task_preparation_steps SET status='running',started_at=? WHERE id=? AND status='queued'`).run(now, `${id}:model`)
      this.appendTaskPreparationEvent(id, 'research_started', phase, 'Исследование источников начато')
    })()
  }

  completeTaskPreparationRun(userId: string, id: string, readiness: DevelopmentReadiness): TaskPreparationRun | null {
    const run = this.getTaskPreparationRun(userId, id)
    if (!run || (run.status !== 'running' && run.status !== 'validating')) return run
    const target = this.repos.projects.getColumnIdBySemantic(run.projectId, 'ready')
    if (!target) throw new Error('Колонка Ready for Development не найдена')
    const gateResults = developmentReadinessGateResults(readiness)
    const reasons = gateResults.filter((result) => result.status === 'fail').flatMap((result) => result.refs)
    if (reasons.length) {
      this.blockTaskPreparationRun(id, 'Гейт готовности не пройден', reasons, gateResults)
      return this.getTaskPreparationRun(userId, id)
    }
    const sanitized = JSON.parse(JSON.stringify(readiness, (_key, value) => typeof value === 'string' ? redactPreparationText(value) : value)) as DevelopmentReadiness
    const now = this.now()
    if (sanitized.schemaVersion === 2) sanitized.confirmation = { confirmed: true, confirmedAt: now, confirmedBy: run.profileId ?? '', attemptId: id }
    this.db.transaction(() => {
      this.db.prepare(`UPDATE tasks SET description=?,acceptance_criteria=?,updated_at=? WHERE id=?`).run(sanitized.functionalRequirements.trim(), sanitized.acceptanceCriteria.trim(), now, run.taskId)
      for (const testCase of sanitized.testCases) {
        this.repos.qa.createAcceptanceCriterion(userId, run.projectId, run.taskId, {
          title: testCase.title, description: testCase.description, preconditions: testCase.preconditions,
          steps: testCase.steps, testData: testCase.testData, expectedResult: testCase.expectedResult,
          required: testCase.required, testType: testCase.testType
        })
      }
      this.db.prepare(`UPDATE task_preparation_steps SET status='success',finished_at=? WHERE id=? AND status='running'`).run(now, `${id}:model`)
      this.db.prepare(`UPDATE task_preparation_steps SET status='running',started_at=? WHERE id=? AND status='queued'`).run(now, `${id}:result`)
      this.appendTaskPreparationEvent(id, 'gate_completed', 'readiness_validation', 'Все проверки готовности пройдены', { gateResults })
      this.appendTaskPreparationEvent(id, 'brief_persisted', 'persistence', 'Development Brief сохранён')
      this.moveTask(userId, run.projectId, run.taskId, { columnId: target })
      this.db.prepare(`UPDATE task_preparation_runs SET status='success',phase='completed',readiness_json=?,gate_reasons_json='[]',gate_results_json=?,finished_at=? WHERE id=? AND status IN ('running','validating')`).run(JSON.stringify(sanitized), JSON.stringify(gateResults), now, id)
      this.db.prepare(`UPDATE task_preparation_steps SET status='success',finished_at=? WHERE id=? AND status='running'`).run(now, `${id}:result`)
      this.appendTaskPreparationEvent(id, 'attempt_completed', 'completed', 'Подготовка успешно завершена')
    })()
    return this.getTaskPreparationRun(userId, id)
  }

  blockTaskPreparationRun(id: string, error: string, reasons: string[], gateResults: PreparationGateResult[] = []): void {
    const now = this.now(), safeError = redactPreparationText(error)
    this.db.prepare(`UPDATE task_preparation_runs SET status='blocked',phase='readiness_validation',error=?,gate_reasons_json=?,gate_results_json=?,finished_at=? WHERE id=? AND status IN ('queued','running','waiting_for_answer','validating')`).run(safeError, JSON.stringify(reasons), JSON.stringify(gateResults), now, id)
    this.appendTaskPreparationEvent(id, 'attempt_blocked', 'readiness_validation', safeError, { reasons })
  }

  failTaskPreparationRun(id: string, error: string, reasons: string[] = []): void {
    const safeError = redactPreparationText(error)
    const now = this.now()
    this.db.transaction(() => {
      this.db.prepare(`UPDATE task_preparation_runs SET status='failed',error=?,gate_reasons_json=?,finished_at=? WHERE id=? AND status IN ('queued','running','validating')`).run(safeError, JSON.stringify(reasons), now, id)
      this.db.prepare(`UPDATE task_preparation_steps SET status='failed',error=?,finished_at=? WHERE attempt_id=? AND status='running'`).run(safeError, now, id)
      this.db.prepare(`UPDATE task_preparation_steps SET status='cancelled',finished_at=? WHERE attempt_id=? AND status='queued'`).run(now, id)
      this.appendTaskPreparationEvent(id, 'attempt_failed', 'completed', safeError, { reasons })
    })()
  }

  cancelTaskPreparationRun(userId: string, id: string, reason = 'Подготовка отменена пользователем'): TaskPreparationRun | null {
    const run = this.getTaskPreparationRun(userId, id)
    if (!run) return null
    const safeReason = redactPreparationText(reason)
    const changed = this.db.prepare(`UPDATE task_preparation_runs SET status='cancelled',error=?,finished_at=? WHERE id=? AND status IN ('queued','running','waiting_for_answer','validating')`).run(safeReason, this.now(), id)
    if (changed.changes) {
      const now = this.now()
      this.db.prepare(`UPDATE task_preparation_steps SET status='cancelled',error=?,finished_at=? WHERE attempt_id=? AND status IN ('queued','running')`).run(safeReason, now, id)
      this.appendTaskPreparationEvent(id, 'attempt_cancelled', 'completed', safeReason, { initiatedBy: run.profileId })
    }
    return this.getTaskPreparationRun(userId, id)
  }

  failInterruptedTaskPreparationRuns(): string[] {
    const rows = this.db.prepare(`SELECT id FROM task_preparation_runs WHERE status IN ('queued','running','validating')`).all() as Array<{ id: string }>
    for (const row of rows) this.failTaskPreparationRun(row.id, 'Подготовка прервана перезапуском сервера')
    return rows.map((row) => row.id)
  }

  /**
   * Проекты, где есть хоть одна карточка с автопроходом. Нужен фоновому тику:
   * этап, упавший из-за уснувшей машины, иначе ждал бы следующего действия
   * человека — а весь смысл автопрохода в том, чтобы человека не ждать.
   */
  autoPilotProjectIds(): string[] {
    return (this.db.prepare(`SELECT DISTINCT project_id FROM tasks WHERE auto_pilot=1 AND type='task'`).all() as Array<{ project_id: string }>).map((row) => row.project_id)
  }

  autoPilotSnapshot(projectId: string): Array<{ task: Task; stage: KanbanColumnSemanticType; userId: string; requiresManualQa: boolean }> {
    const project = this.db.prepare(`SELECT created_by,autopilot_requires_manual_qa FROM projects WHERE id=?`).get(projectId) as { created_by: string; autopilot_requires_manual_qa: number } | undefined
    if (!project) return []
    return (this.db.prepare(`SELECT t.* FROM tasks t WHERE t.project_id=? AND t.auto_pilot=1 AND t.type='task'`).all(projectId) as TaskRow[]).map((row) => {
      const task = mapTask(row)
      const column = this.db.prepare(`SELECT semantic_type FROM kanban_columns WHERE id=?`).get(task.columnId) as { semantic_type: string } | undefined
      return { task, stage: normColumnSemantic(column?.semantic_type ?? 'custom'), userId: project.created_by, requiresManualQa: project.autopilot_requires_manual_qa !== 0 }
    })
  }

  transitionAutoPilotTask(projectId: string, taskId: string, to: KanbanColumnSemanticType, action: string): Task {
    const task = this.getTask(projectId, taskId)
    if (!task?.autoPilot) throw new Error('autopilot is disabled')
    const fromRow = this.db.prepare(`SELECT semantic_type FROM kanban_columns WHERE id=?`).get(task.columnId) as { semantic_type: string } | undefined
    const from = normColumnSemantic(fromRow?.semantic_type ?? 'custom')
    if (!canTransitionWorkflow(from, to, 'automation')) throw new Error(`workflow transition unavailable: ${from} → ${to}`)
    const target = this.repos.projects.getColumnIdBySemantic(projectId, to)
    if (!target) throw new Error(`${to} column not found`)
    const owner = (this.db.prepare(`SELECT created_by FROM projects WHERE id=?`).get(projectId) as { created_by: string } | undefined)?.created_by
    if (!owner || !this.moveTask(owner, projectId, taskId, { columnId: target })) throw new Error('autopilot transition failed')
    this.repos.qa.recordAutoPilotEvent(projectId, taskId, action, { from, to })
    return this.getTask(projectId, taskId)!
  }

  /**
   * Возврат задачи в разработку после провала этапа. `remarks` — замечания,
   * которые уходят в описание баг-задачи: без них на доработке видна одна
   * строка «команда завершилась с кодом 1», и модель чинит вслепую.
   */
  handleAutoPilotFailure(userId: string, projectId: string, taskId: string, stage: string, runId: string, reason: string, remarks = ''): { decisionRequired: boolean; bugTaskId?: string } | null {
    const task = this.getTask(projectId, taskId)
    if (!task?.autoPilot) return null
    const project = this.repos.projects.getProject(userId, projectId)
    if (!project) throw new Error('project not found')
    const cycles = task.autoPilotFixCycles ?? 0
    const limit = project.autoPilotFixLimit ?? 3
    const runLink = `/projects/${projectId}/tasks/${taskId}?run=${runId}`
    if (cycles >= limit) {
      this.transitionAutoPilotTask(projectId, taskId, 'decision_required', 'autopilot.limit_exhausted')
      this.repos.qa.recordAutoPilotEvent(projectId, taskId, 'autopilot.stopped', { stage, runId, reason, cycles, limit })
      return { decisionRequired: true }
    }
    // Задачу могли увести вручную, пока шёл этап: из `awaiting_merge`, `merge` и
    // `done` пути в разработку нет. Раньше обработчик бросал исключение прямо в
    // колбэк завершения рана — падал не автопроход, а само завершение.
    const current = this.getBoard(userId, projectId)?.columns.find((column) => column.id === task.columnId)
    if (!current || !canTransitionWorkflow(current.semanticType, 'development', 'automation')) {
      this.repos.qa.recordAutoPilotEvent(projectId, taskId, 'autopilot.stopped', {
        stage, runId, reason, cycles, limit, blockedFrom: current?.semanticType ?? 'unknown'
      })
      return { decisionRequired: true }
    }
    const backlog = this.repos.projects.getColumnIdBySemantic(projectId, 'backlog')
    if (!backlog) throw new Error('backlog column not found')
    const bug = this.createTask(userId, projectId, { columnId: backlog, title: `Bug: ${stage} — ${task.title}`, description: `Автопроход исходной задачи завершился ошибкой.\n\n- Этап: ${stage}\n- Причина: ${reason}\n- Ран: ${runLink}${remarks.trim() ? `\n\n## Замечания этапа\n\n\`\`\`\n${remarks.trim().slice(-8000)}\n\`\`\`` : ''}`, type: 'task', labels: ['bug'] })
    if (!bug) throw new Error('failed to create autopilot bug')
    this.db.transaction(() => {
      this.db.prepare(`UPDATE tasks SET source_task_id=? WHERE id=?`).run(taskId, bug.id)
      this.db.prepare(`UPDATE tasks SET auto_pilot_fix_cycles=auto_pilot_fix_cycles+1 WHERE id=?`).run(taskId)
    })()
    this.transitionAutoPilotTask(projectId, taskId, 'development', 'autopilot.return_to_development')
    this.repos.qa.recordAutoPilotEvent(projectId, taskId, 'autopilot.failure', { stage, runId, reason, bugTaskId: bug.id, cycle: cycles + 1, limit })
    return { decisionRequired: false, bugTaskId: bug.id }
  }

  /** Каскад удаления аккаунта: снять исполнителя со всех задач (зовётся из identity). */
  unassignUser(userId: string): void {
    this.db.prepare(`UPDATE tasks SET assignee = NULL WHERE assignee = ?`).run(userId)
  }

  /** Участник вышел из проекта — его задачи остаются без исполнителя (зовётся из projects.removeMember). */
  unassignUserInProject(projectId: string, username: string, ts: number): void {
    this.db.prepare(`UPDATE tasks SET assignee = NULL, updated_at = ? WHERE project_id = ? AND assignee = ?`).run(ts, projectId, username)
  }

  /** Снимок готовности успешного preparation-рана; null — рана нет или он не успешен. */
  preparationReadiness(runId: string | null): DevelopmentReadiness | null {
    if (!runId) return null
    const prep = this.db.prepare(`SELECT readiness_json FROM task_preparation_runs WHERE id=? AND status='success'`).get(runId) as { readiness_json: string } | undefined
    return prep ? parseJsonValue<DevelopmentReadiness | null>(prep.readiness_json, null) : null
  }

  /** CI дописывает в снимок готовности ссылки на автотесты; сам снимок — данные подготовки задачи. */
  savePreparationReadiness(runId: string, readiness: DevelopmentReadiness): void {
    this.db.prepare(`UPDATE task_preparation_runs SET readiness_json=? WHERE id=?`).run(JSON.stringify(readiness), runId)
  }

  /**
   * Перенос задачи в колонку по семантике без истории и проверок членства — для
   * системных переходов (старт merge-рана), где решение уже принято вызывающим.
   */
  placeTaskInSemanticColumn(projectId: string, taskId: string, semantic: KanbanColumnSemanticType, ts: number): void {
    this.db.prepare(`UPDATE tasks SET column_id=(SELECT id FROM kanban_columns WHERE project_id=? AND semantic_type=?), updated_at=? WHERE id=?`).run(projectId, semantic, ts, taskId)
  }
}
