// REST для проектов и канбан-доски. Все маршруты под Bearer-защитой; доступ
// определяется членством в проекте (см. VoiceChatDb: isProjectMember/Owner).
// После мутаций доски зовём boardHub.emit → живой board.update подписчикам.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  REST,
  type Board,
  type KanbanColumn,
  type ProjectDetail,
  type ProjectSummary,
  type Task,
  type TaskPriority,
  type WorkItemDefaultSkills,
  type CiReuseStrategy,
  type KbContextMode,
  WIDGET_TOOL_CONTRACT_VERSION,
  queryWidgetItems,
  normalizeAcceptanceCriteria,
  taskWidgetItem,
  type WidgetToolActionRequest,
  type WidgetToolGetRequest,
  type WidgetToolQueryRequest
} from '@voicechat/shared'

import type { VoiceChatDb } from '../db/database.js'
import { requireProjectPermission, uid } from '../users/auth.js'
import type { BoardHub } from '../projects/boardHub.js'
import type { KnowledgeBaseService } from '../kb/types.js'
import { kbUsageFlags } from '../kb/routes.js'
import type { CiRunManager } from '../ci/runManager.js'
import type { AgentRegistry } from '../agents/registry.js'
import type { MergeRunManager } from '../merge/runManager.js'

const nf = (reply: FastifyReply): FastifyReply => reply.code(404).send({ error: 'not found' })
const forbidden = (reply: FastifyReply): FastifyReply => reply.code(403).send({ error: 'forbidden' })
const badReq = (reply: FastifyReply, message: string): FastifyReply => reply.code(400).send({ error: message })

/** Флаг из query-строки: `?includeCompleted=1` (или `=true`). */
function queryFlag(v: string | undefined): boolean {
  return v === '1' || v === 'true'
}

/** Порог скрытия завершённых: пусто/мусор → null («не скрывать»), иначе целые дни ≥ 0. */
function normRetentionDays(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null
}

/** Достаёт понятный текст ошибки БД (валидация assignee/участника/машины). */
function normalizePreviewUrl(value: unknown): string | null | undefined {
  if (value === null || value === '') return null
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch { return undefined }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function registerProjectRoutes(
  app: FastifyInstance,
  db: VoiceChatDb,
  boardHub: BoardHub,
  /** Телеметрия БЗ по проекту: без неё маршрут агрегата не регистрируется. */
  kbUsage?: { kb: KnowledgeBaseService; toolEnabled: boolean },
  /** Нужен переносу в TODO: ожидающий CI-ран надо снять до успешного ответа. */
  ci?: CiRunManager,
  agents?: AgentRegistry,
  merge?: MergeRunManager,
  startTaskPreparation?: (userId: string, projectId: string, taskId: string) => void
): void {
  // Гейт участника: проект есть и текущий пользователь — участник; иначе null.
  const withMachineStatus = (project: ProjectDetail | null): ProjectDetail | null => {
    if (project && agents) {
      project.machines = project.machines.map((machine) => ({ ...machine, online: agents.isOnline(machine.agentId) }))
    }
    return project
  }
  const member = (req: FastifyRequest, id: string): ProjectDetail | null =>
    withMachineStatus(db.getProject(uid(req), id))

  const taskCreateGuard = { preHandler: requireProjectPermission('task:create') }
  const taskUpdateGuard = { preHandler: requireProjectPermission('task:update') }
  const mergeGuard = { preHandler: requireProjectPermission('task:merge') }
  const settingsGuard = { preHandler: requireProjectPermission('project:settings') }

  // --- Проекты ---------------------------------------------------------

  app.get(REST.projects, async (req): Promise<ProjectSummary[]> => db.listProjects(uid(req)))

  app.post<{
    Body: { name?: string; description?: string; gitUrl?: string; technologies?: string[]; skills?: string[]; defaultSkills?: Partial<WorkItemDefaultSkills>; commitPolicy?: 'agent_commits' | 'final_system_commit' | 'manual_user_confirmation'; mergeTransport?: 'local' | 'github_pull_request'; agentPlanApprovalMode?: 'manual' | 'automatic' }
  }>(REST.projects, settingsGuard, async (req, reply): Promise<ProjectDetail | FastifyReply> => {
    const b = req.body ?? {}
    const name = (b.name ?? '').trim()
    if (!name) return badReq(reply, 'name required')
    return db.createProject(uid(req), {
      name,
      description: b.description,
      gitUrl: b.gitUrl,
      technologies: b.technologies,
      skills: b.skills,
      defaultSkills: b.defaultSkills,
      commitPolicy: b.commitPolicy,
      mergeTransport: b.mergeTransport,
      agentPlanApprovalMode: b.agentPlanApprovalMode
    })
  })


  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const p = member(req, req.params.id)
    return p ?? nf(reply)
  })

  app.patch<{
    Params: { id: string }
    Body: {
      name?: string
      description?: string
      gitUrl?: string | null
      previewUrl?: string | null
      technologies?: string[]
      skills?: string[]
      defaultSkills?: Partial<WorkItemDefaultSkills>
      commitPolicy?: 'agent_commits' | 'final_system_commit' | 'manual_user_confirmation'
      mergeTransport?: 'local' | 'github_pull_request'
      agentPlanApprovalMode?: 'manual' | 'automatic'
      testCommand?: string
      productionDeployCommand?: string
      productionAgentId?: string | null
      productionCheckoutPath?: string
      productionHealthCheckCommand?: string
      releaseTimeouts?: import('@voicechat/shared').ReleaseTimeouts
      ciBaseBranch?: string
      ciBranchTemplate?: string
      ciReuseStrategy?: CiReuseStrategy
      ciExecAuthRef?: string
      /** Режим базы знаний в ходах модели CI-рана (auto|manual|off). */
      ciKbContextMode?: KbContextMode
      ciTestFixCycleLimit?: number
      doneRetentionDays?: number | null
    }
  }>('/api/projects/:id', async (req, reply) => {

    const p = member(req, req.params.id)
    if (!p) return nf(reply)
    const body = { ...(req.body ?? {}) }
    if (body.previewUrl !== undefined) {
      const previewUrl = normalizePreviewUrl(body.previewUrl)
      if (previewUrl === undefined) return badReq(reply, 'previewUrl must be an http/https URL')
      body.previewUrl = previewUrl
    }
    if (body.doneRetentionDays !== undefined) body.doneRetentionDays = normRetentionDays(body.doneRetentionDays)
    if (body.ciTestFixCycleLimit !== undefined && (!Number.isInteger(body.ciTestFixCycleLimit) || body.ciTestFixCycleLimit < 0)) return badReq(reply, 'ciTestFixCycleLimit must be a non-negative integer')
    if (body.releaseTimeouts !== undefined) { try { const { validateReleaseTimeouts } = await import('@voicechat/shared'); validateReleaseTimeouts(body.releaseTimeouts) } catch(error) { return badReq(reply,errMessage(error)) } }
    return db.updateProject(uid(req), req.params.id, body) ?? nf(reply)
  })

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const p = member(req, req.params.id)
    if (!p) return nf(reply)
    db.deleteProject(uid(req), req.params.id)
    return { ok: true }
  })

  // --- Участники (только владелец) -------------------------------------

  app.post<{ Params: { id: string }; Body: { username?: string } }>(
    '/api/projects/:id/members',
    async (req, reply) => {
      const p = member(req, req.params.id)
      if (!p) return nf(reply)
        const username = (req.body?.username ?? '').trim()
      if (!username) return badReq(reply, 'username required')
      try {
        return db.addMember(uid(req), req.params.id, username) ?? nf(reply)
      } catch (err) {
        return badReq(reply, errMessage(err))
      }
    }
  )

  app.patch<{ Params: { id: string; username: string }; Body: { role?: 'owner' | 'member' } }>(
    '/api/projects/:id/members/:username',
    async (req, reply) => {
      const p = member(req, req.params.id)
      if (!p) return nf(reply)
      const role = req.body?.role
      if (role !== 'owner' && role !== 'member') return badReq(reply, 'role must be owner or member')
      try {
        return db.updateMemberRole(uid(req), req.params.id, req.params.username, role) ?? nf(reply)
      } catch (err) {
        return badReq(reply, errMessage(err))
      }
    }
  )

  app.delete<{ Params: { id: string; username: string } }>(
    '/api/projects/:id/members/:username',
    async (req, reply) => {
      const p = member(req, req.params.id)
      if (!p) return nf(reply)
      try {
        const detail = db.removeMember(uid(req), req.params.id, req.params.username)
        boardHub.emit(req.params.id) // снятые назначения меняют доску
        return detail ?? nf(reply)
      } catch (err) {
        return badReq(reply, errMessage(err))
      }
    }
  )

  // --- Машины проекта ----------------------------------------------------

  app.put<{ Params: { id: string; agentId: string }; Body: { shared?: boolean } }>(
    '/api/projects/:id/machines/:agentId/share',
    async (req, reply) => {
      if (!member(req, req.params.id)) return nf(reply)
      if (typeof req.body?.shared !== 'boolean') return badReq(reply, 'shared must be boolean')
      try {
        db.setMachineSharedWithProject(uid(req), req.params.id, req.params.agentId, req.body.shared)
        return withMachineStatus(db.getProject(uid(req), req.params.id)) ?? nf(reply)
      } catch (err) {
        return reply.code(403).send({ error: errMessage(err) })
      }
    }
  )

  app.put<{ Params: { id: string }; Body: { agentId?: string | null } }>(
    '/api/projects/:id/machines/default',
    async (req, reply) => {
      if (!member(req, req.params.id)) return nf(reply)
      const agentId = req.body?.agentId
      if (agentId !== null && typeof agentId !== 'string') return badReq(reply, 'agentId must be string or null')
      try {
        db.setUserProjectDefaultMachine(uid(req), req.params.id, agentId)
        return withMachineStatus(db.getProject(uid(req), req.params.id)) ?? nf(reply)
      } catch (err) {
        return badReq(reply, errMessage(err))
      }
    }
  )

  app.get<{ Params: { id: string } }>('/api/projects/:id/machines/audit', async (req, reply) => {
    if (!db.isProjectOwner(uid(req), req.params.id)) return forbidden(reply)
    return db.listMachineShareAudit(req.params.id)
  })

  app.get<{ Params: { id: string } }>('/api/projects/:id/machines', async (req, reply) => {
    const p = member(req, req.params.id)
    return p ? p.machines : nf(reply)
  })

  app.get<{ Params: { id: string } }>('/api/projects/:id/machines/available', async (req, reply) => {
    const p = member(req, req.params.id)
    if (!p) return nf(reply)
    const linked = new Set(p.machines.filter((machine) => machine.sharedWithProject).map((machine) => machine.agentId))
    return db.listAgents(uid(req))
      .filter((agent) => !linked.has(agent.id))
      .map((agent) => ({ id: agent.id, name: agent.name }))
  })

  app.post<{ Params: { id: string }; Body: { agentId?: string } }>(
    '/api/projects/:id/machines',
    async (req, reply) => {
      const p = member(req, req.params.id)
      if (!p) return nf(reply)
        const agentId = (req.body?.agentId ?? '').trim()
      if (!agentId) return badReq(reply, 'agentId required')
      if (db.isMachineSharedWithProject(req.params.id, agentId)) {
        return reply.code(409).send({ error: 'machine already shared' })
      }
      try {
        return withMachineStatus(db.linkMachine(uid(req), req.params.id, agentId)) ?? nf(reply)
      } catch (err) {
        return badReq(reply, errMessage(err))
      }
    }
  )

  app.delete<{ Params: { id: string; agentId: string } }>(
    '/api/projects/:id/machines/:agentId',
    async (req, reply) => {
      const p = member(req, req.params.id)
      if (!p) return nf(reply)
        return withMachineStatus(db.unlinkMachine(uid(req), req.params.id, req.params.agentId)) ?? nf(reply)
    }
  )

  // Папка проекта на конкретной машине.
  app.patch<{ Params: { id: string; agentId: string }; Body: { path?: string; reposRoot?: string; sshHost?: string; sshUser?: string } }>(
    '/api/projects/:id/machines/:agentId',
    async (req, reply) => {
      const p = member(req, req.params.id)
      if (!p) return nf(reply)
      if (req.body?.sshHost !== undefined || req.body?.sshUser !== undefined) {
        return withMachineStatus(db.setProjectMachineSsh(uid(req), req.params.id, req.params.agentId, req.body?.sshHost ?? '', req.body?.sshUser ?? '')) ?? nf(reply)
      }
      return req.body?.reposRoot !== undefined
        ? withMachineStatus(db.setProjectMachineReposRoot(uid(req), req.params.id, req.params.agentId, req.body.reposRoot)) ?? nf(reply)
        : withMachineStatus(db.setProjectMachinePath(uid(req), req.params.id, req.params.agentId, req.body?.path ?? '')) ?? nf(reply)
    }
  )

  // Машина проекта по умолчанию.
  app.post<{ Params: { id: string }; Body: { agentId?: string } }>(
    '/api/projects/:id/default-machine',
    async (req, reply) => {
      const p = member(req, req.params.id)
      if (!p) return nf(reply)
        const agentId = (req.body?.agentId ?? '').trim()
      if (!agentId) return badReq(reply, 'agentId required')
      try {
        return withMachineStatus(db.setProjectDefaultMachine(uid(req), req.params.id, agentId)) ?? nf(reply)
      } catch (err) {
        return badReq(reply, errMessage(err))
      }
    }
  )

  // --- Доска -----------------------------------------------------------

  // includeCompleted=1 — вместе с давно завершёнными задачами (по умолчанию их
  // на доске нет, см. настройку проекта «сколько держать завершённые»).
  app.get<{ Params: { id: string }; Querystring: { includeCompleted?: string } }>(
    '/api/projects/:id/board',
    async (req, reply): Promise<Board | FastifyReply> => {
      const board = db.getBoard(uid(req), req.params.id, { includeCompleted: queryFlag(req.query.includeCompleted) })
      return board ?? nf(reply)
    }
  )

  // --- Использование базы знаний по всем чатам проекта ------------------

  if (kbUsage) {
    app.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/api/projects/:id/kb-usage', async (req, reply) => {
      // Гейт как у доски: не участник → 404, а не пустой агрегат.
      const report = db.kbUsageProjectReport(uid(req), req.params.id, Number(req.query.limit) || undefined)
      return report ? { ...report, ...kbUsageFlags(kbUsage.kb, kbUsage.toolEnabled) } : nf(reply)
    })
  }

  // --- Колонки (любой участник) ----------------------------------------

  app.post<{ Params: { id: string }; Body: { name?: string } }>(
    '/api/projects/:id/columns',
    async (req, reply): Promise<KanbanColumn | FastifyReply> => {
      const name = (req.body?.name ?? '').trim()
      if (!name) return badReq(reply, 'name required')
      const col = db.createColumn(uid(req), req.params.id, name)
      if (!col) return nf(reply)
      boardHub.emit(req.params.id)
      return col
    }
  )

  // Статический под-роут раньше :columnId (Fastify всё равно отдаёт приоритет статике).
  app.post<{ Params: { id: string }; Body: { order?: string[] } }>(
    '/api/projects/:id/columns/reorder',
    async (req, reply) => {
      const order = req.body?.order
      if (!Array.isArray(order)) return badReq(reply, 'order required')
      if (!db.reorderColumns(uid(req), req.params.id, order)) return nf(reply)
      boardHub.emit(req.params.id)
      return { ok: true }
    }
  )

  app.patch<{ Params: { id: string; columnId: string }; Body: { name?: string; wipLimit?: number | null } }>(
    '/api/projects/:id/columns/:columnId',
    async (req, reply) => {
      const b = req.body ?? {}
      const fields: { name?: string; wipLimit?: number | null } = {}
      if (b.name !== undefined) {
        const name = b.name.trim()
        if (!name) return badReq(reply, 'name required')
        fields.name = name
      }
      if (b.wipLimit !== undefined) fields.wipLimit = b.wipLimit
      if (fields.name === undefined && fields.wipLimit === undefined) return badReq(reply, 'nothing to update')
      if (!db.updateColumn(uid(req), req.params.id, req.params.columnId, fields)) return nf(reply)
      boardHub.emit(req.params.id)
      return { ok: true }
    }
  )

  app.post<{ Params: { id: string; columnId: string }; Body: { hidden?: boolean } }>(
    '/api/projects/:id/columns/:columnId/hidden',
    async (req, reply) => {
      const hidden = Boolean(req.body?.hidden)
      if (!db.setColumnHidden(uid(req), req.params.id, req.params.columnId, hidden)) return nf(reply)
      boardHub.emit(req.params.id)
      return { ok: true }
    }
  )

  app.delete<{ Params: { id: string; columnId: string } }>(
    '/api/projects/:id/columns/:columnId',
    async (req, reply) => {
      if (!db.deleteColumn(uid(req), req.params.id, req.params.columnId)) return nf(reply)
      boardHub.emit(req.params.id)
      return { ok: true }
    }
  )

  // --- Задачи (любой участник) -----------------------------------------

  app.post<{
    Params: { id: string }
    Body: { columnId?: string; title?: string; description?: string; acceptanceCriteria?: string; type?: 'epic' | 'story' | 'task'; parentId?: string | null; priority?: TaskPriority; assignee?: string | null; agentId?: string | null; labels?: string[]; skills?: string[]; storyPoints?: number | null; dueDate?: number | null }
  }>('/api/projects/:id/tasks', taskCreateGuard, async (req, reply): Promise<Task | FastifyReply> => {
    const b = req.body ?? {}
    const title = (b.title ?? '').trim()
    if (!b.columnId || !title) return badReq(reply, 'columnId and title required')
    try {
      const task = db.createTask(uid(req), req.params.id, {
        columnId: b.columnId,
        title,
        description: b.description,
        acceptanceCriteria: b.acceptanceCriteria === undefined ? undefined : normalizeAcceptanceCriteria(b.acceptanceCriteria),
        type: b.type,
        parentId: b.parentId,
        priority: b.priority,
        assignee: b.assignee ?? null,
        agentId: b.agentId,
        labels: b.labels,
        skills: b.skills,
        storyPoints: b.storyPoints,
        dueDate: b.dueDate
      })

      if (!task) return nf(reply)
      boardHub.emit(req.params.id)
      return task
    } catch (err) {
      return badReq(reply, errMessage(err))
    }
  })

  app.patch<{
    Params: { id: string; taskId: string }
    Body: { title?: string; description?: string; acceptanceCriteria?: string; type?: 'epic' | 'story' | 'task'; parentId?: string | null; priority?: TaskPriority; assignee?: string | null; agentId?: string | null; labels?: string[]; skills?: string[]; storyPoints?: number | null; dueDate?: number | null; flagged?: boolean }
  }>('/api/projects/:id/tasks/:taskId', taskUpdateGuard, async (req, reply): Promise<Task | FastifyReply> => {

    try {
      const body = req.body ?? {}
      const task = db.updateTask(uid(req), req.params.id, req.params.taskId, {
        ...body,
        acceptanceCriteria: body.acceptanceCriteria === undefined ? undefined : normalizeAcceptanceCriteria(body.acceptanceCriteria)
      })
      if (!task) return nf(reply)
      boardHub.emit(req.params.id)
      return task
    } catch (err) {
      return badReq(reply, errMessage(err))
    }
  })

  app.post<{
    Params: { id: string; taskId: string }
    Body: { columnId?: string; fromColumnId?: string | null; afterId?: string | null; beforeId?: string | null }
  }>('/api/projects/:id/tasks/:taskId/move', async (req, reply): Promise<Task | FastifyReply> => {
    const columnId = req.body?.columnId
    if (!columnId) return badReq(reply, 'columnId required')
    // Возврат из разработки в TODO для активного рана — не обычный перенос:
    // queued надо синхронно исключить из очереди, а уже начавшийся ран нельзя
    // оставить работать с карточкой в TODO. `dequeue` не содержит await, поэтому
    // между проверкой статуса и отменой его не обгоняет исполнитель.
    const board = db.getBoard(uid(req), req.params.id)
    const taskBeforeMove = board?.tasks.find((task) => task.id === req.params.taskId)
    const from = taskBeforeMove && board?.columns.find((column) => column.id === taskBeforeMove.columnId)
    const requestedFrom = req.body?.fromColumnId
      ? board?.columns.find((column) => column.id === req.body.fromColumnId)
      : from
    const to = board?.columns.find((column) => column.id === columnId)
    if (ci && from?.semanticType === 'development' && to?.semanticType === 'backlog') {
      const latestRun = db.latestCiRunSummary(req.params.taskId)
      if (latestRun?.status === 'queued' || latestRun?.status === 'running' || latestRun?.status === 'awaiting_input') {
        const removal = ci.dequeue(uid(req), latestRun.id)
        if (removal.status !== 'removed') {
          const error = removal.status === 'running'
            ? 'Ран уже выполняется: сначала остановите его в ленте рана'
            : 'Не удалось исключить ран из очереди: обновите доску и повторите перенос'
          return reply.code(409).send({ error })
        }
      }
    }
    // Ready for Development → Development — единственный drag&drop-переход,
    // который автоматически ставит обычный development-run в FIFO-очередь.
    // Менеджер сначала создаёт (либо находит) активный ран и только затем двигает
    // карточку; при ошибке колонка остаётся ready.
    if (requestedFrom?.semanticType === 'ready' && to?.semanticType === 'development' && (from?.semanticType === 'ready' || from?.semanticType === 'development')) {
      if (!ci) {
        req.log.error({ projectId: req.params.id, taskId: req.params.taskId }, 'development transition rejected: CI manager unavailable')
        return reply.code(503).send({ error: 'Сервис запуска development-run временно недоступен' })
      }
      const result = ci.startForDevelopmentTransition(uid(req), req.params.id, req.params.taskId, from?.semanticType === 'ready')
      if ('error' in result) {
        req.log.warn({ projectId: req.params.id, taskId: req.params.taskId, reason: result.error }, 'development transition rejected')
        return reply.code(409).send({ error: result.error })
      }
      // start() уже переносит карточку после INSERT; повторный move применяет
      // только запрошенную drag&drop-позицию и нужен также при reuse активного рана.
      const moved = db.moveTask(uid(req), req.params.id, req.params.taskId, {
        columnId,
        afterId: req.body?.afterId ?? null,
        beforeId: req.body?.beforeId ?? null
      })
      if (!moved) return nf(reply)
      reply.header('x-ci-run-id', result.run.id)
      req.log.info({ projectId: req.params.id, taskId: req.params.taskId, runId: result.run.id, existing: result.existing }, 'development transition linked to run')
      boardHub.emit(req.params.id)
      return moved
    }
    // TODO → Подготовка — это запуск отдельного preparation-run, а не простой
    // визуальный перенос. Менеджер атомарно создаёт ран и переводит карточку.
    if ((from?.semanticType === 'backlog' || from?.semanticType === 'preparation') && to?.semanticType === 'preparation' && startTaskPreparation) {
      try {
        startTaskPreparation(uid(req), req.params.id, req.params.taskId)
        boardHub.emit(req.params.id)
        return db.getBoard(uid(req), req.params.id)?.tasks.find((item) => item.id === req.params.taskId) ?? nf(reply)
      } catch (error) {
        return reply.code(409).send({ error: errMessage(error) })
      }
    }
    const task = db.moveTask(uid(req), req.params.id, req.params.taskId, {
      columnId,
      afterId: req.body?.afterId ?? null,
      beforeId: req.body?.beforeId ?? null
    })
    if (!task) return nf(reply)
    // Ручное закрытие задачи чистит её копии репозиториев так же, как успешный merge.
    if (to?.semanticType === 'done') void merge?.releaseTaskRepositories({ taskId: req.params.taskId }).catch(() => {})
    boardHub.emit(req.params.id)
    return task
  })

  app.delete<{ Params: { id: string; taskId: string } }>(
    '/api/projects/:id/tasks/:taskId',
    async (req, reply) => {
      if (!db.deleteTask(uid(req), req.params.id, req.params.taskId)) return nf(reply)
      boardHub.emit(req.params.id)
      return { ok: true }
    }
  )

  // Отдельный merge-ран: сервер сам берёт подготовленную ветку и main; машина —
  // по умолчанию машина workspace, agentId в теле выбирает другую машину проекта.
  app.post<{ Params: { id: string; taskId: string }; Body: { agentId?: string } }>(
    '/api/projects/:id/tasks/:taskId/merge',
    mergeGuard,
    async (req, reply) => {
      const project = member(req, req.params.id)
      if (!project) return nf(reply)
      try {
        const run = db.startMergeRun(uid(req), req.params.id, req.params.taskId, req.body?.agentId ?? null)
        merge?.start(run)
        boardHub.emit(req.params.id)
        return run
      } catch (err) {
        const message = errMessage(err)
        const conflict = message.includes('awaiting_merge') || message.includes('active')
        return reply.code(conflict ? 409 : 400).send({ error: message })
      }
    }
  )

  app.get<{ Params: { runId: string } }>('/api/merge/runs/:runId', async (req, reply) =>
    db.getMergeRun(uid(req), req.params.runId) ?? nf(reply)
  )

  app.delete<{ Params: { runId: string } }>('/api/merge/runs/:runId', async (req, reply) => {
    try {
      const run = merge?.cancel(req.params.runId, uid(req))
      if (!run) return nf(reply)
      boardHub.emit(run.projectId)
      return run
    } catch (error) {
      return reply.code(409).send({ error: errMessage(error) })
    }
  })

  app.post<{ Params: { runId: string }; Body: { agentId?: string; unpin?: boolean } }>('/api/merge/runs/:runId/retry', mergeGuard, async (req, reply) => {
    try {
      const run = db.retryMergeRun(uid(req), req.params.runId, req.body?.agentId ?? null, req.body?.unpin === true)
      merge?.start(run)
      boardHub.emit(run.projectId)
      return run
    } catch (error) {
      return reply.code(409).send({ error: errMessage(error) })
    }
  })

  // История merge-попыток задачи (для вкладки Merge).
  app.get<{ Params: { id: string; taskId: string } }>(
    '/api/projects/:id/tasks/:taskId/merge/runs',
    async (req, reply) => {
      if (!member(req, req.params.id)) return nf(reply)
      return db.listMergeRuns(uid(req), req.params.id, req.params.taskId)
    }
  )

  // Копии репозиториев задачи по машинам (dev-workspace и merge-клоны).
  app.get<{ Params: { id: string; taskId: string } }>(
    '/api/projects/:id/tasks/:taskId/repositories',
    async (req, reply) => {
      if (!member(req, req.params.id)) return nf(reply)
      return db.listTaskRepositories(uid(req), req.params.id, req.params.taskId)
    }
  )

  // Открыть/создать связанный с задачей чат текущего пользователя.
  app.post<{ Params: { id: string; taskId: string } }>(
    '/api/projects/:id/tasks/:taskId/chat',
    async (req, reply) => {
      const conv = db.openOrCreateTaskChat(uid(req), req.params.id, req.params.taskId)
      return conv ?? nf(reply)
    }
  )

  // --- Универсальный инструментальный шлюз виджетов --------------------
  // Адаптеры перечислены кодом: запрос не может подставить URL или произвольный backend.
  const widgetIdempotency = new Map<string, unknown>()
  const widgetScope = (userId: string, body: WidgetToolQueryRequest): boolean => {
    if (body.version !== WIDGET_TOOL_CONTRACT_VERSION || body.widgetKind !== 'kanban' || body.widgetInstanceId !== body.projectId) return false
    const conversation = db.getConversation(userId, body.conversationId)
    const turnOwned = db.listMessages(userId, body.conversationId).some((message) => message.id === body.turnId)
    return Boolean(conversation?.projectId === body.projectId && (conversation.assistantKind === null || conversation.assistantKind === 'kanban') && turnOwned && db.getBoard(userId, body.projectId))
  }
  const revision = (tasks: Task[]): string => String(Math.max(0, ...tasks.map((task) => task.updatedAt)))

  app.post<{ Body: WidgetToolQueryRequest }>('/api/widget-tools/describe', async (req, reply) => {
    if (!widgetScope(uid(req), req.body)) return nf(reply)
    return {
      version: WIDGET_TOOL_CONTRACT_VERSION,
      widgetKind: 'kanban',
      capabilities: [
        { operation: 'query', name: 'kanban.items.query', confirmation: 'never' },
        { operation: 'get', name: 'kanban.item.get', confirmation: 'never' },
        { operation: 'action', name: 'kanban.task.create', confirmation: 'required' },
        { operation: 'action', name: 'kanban.task.update', confirmation: 'required' }
      ]
    }
  })

  app.post<{ Body: WidgetToolQueryRequest }>('/api/widget-tools/query', async (req, reply) => {
    const userId = uid(req)
    if (!widgetScope(userId, req.body)) return nf(reply)
    if (req.body.ui?.items.length) {
      return { source: 'ui', revision: req.body.ui.revision, items: queryWidgetItems(req.body.ui.items, req.body.text, req.body.kinds, req.body.limit) }
    }
    const board = db.getBoard(userId, req.body.projectId)!
    return { source: 'api', revision: revision(board.tasks), items: queryWidgetItems(board.tasks.map(taskWidgetItem), req.body.text, req.body.kinds, req.body.limit) }
  })

  app.post<{ Body: WidgetToolGetRequest }>('/api/widget-tools/get', async (req, reply) => {
    if (!widgetScope(uid(req), req.body)) return nf(reply)
    const board = db.getBoard(uid(req), req.body.projectId)!
    const task = board.tasks.find((item) => item.id === req.body.itemId)
    return task ? { revision: revision(board.tasks), item: taskWidgetItem(task) } : nf(reply)
  })

  app.post<{ Body: WidgetToolActionRequest }>('/api/widget-tools/action', async (req, reply) => {
    const body = req.body
    const userId = uid(req)
    if (!widgetScope(userId, body)) return nf(reply)
    if (!body.confirmation?.confirmed || body.confirmation.proposalId !== body.turnId || !body.idempotencyKey) return badReq(reply, 'confirmation for current turn and idempotencyKey required')
    const idemKey = [userId, body.projectId, body.conversationId, body.idempotencyKey].join(':')
    const replay = widgetIdempotency.get(idemKey)
    if (replay) return { ...(replay as object), replayed: true }
    const action = body.action
    try {
      let item: Task
      if (action.name === 'kanban.task.create') {
        const created = db.createTask(userId, body.projectId, action.input)
        if (!created) return nf(reply)
        item = created
      } else if (action.name === 'kanban.task.update') {
        const board = db.getBoard(userId, body.projectId)!
        const current = board.tasks.find((task) => task.id === action.taskId)
        if (!current) return nf(reply)
        if (String(current.updatedAt) !== action.expectedVersion) return reply.code(409).send({ error: 'stale item version' })
        const patch = { ...action.patch }
        const columnId = patch.columnId
        delete patch.columnId
        if (columnId && columnId !== current.columnId && !db.moveTask(userId, body.projectId, current.id, { columnId, afterId: null, beforeId: null })) return badReq(reply, 'invalid column')
        if (Object.keys(patch).length && !db.updateTask(userId, body.projectId, current.id, patch)) return nf(reply)
        item = db.getBoard(userId, body.projectId)!.tasks.find((task) => task.id === current.id)!
      } else return badReq(reply, 'unsupported action')
      boardHub.emit(body.projectId)
      const nextBoard = db.getBoard(userId, body.projectId)!
      const result = { applied: true, replayed: false, revision: revision(nextBoard.tasks), item: taskWidgetItem(item) }
      widgetIdempotency.set(idemKey, result)
      req.log.info({ event: 'widget.action', userId, projectId: body.projectId, conversationId: body.conversationId, widgetInstanceId: body.widgetInstanceId, proposalId: body.confirmation.proposalId, idempotencyKey: body.idempotencyKey, action: action.name, taskId: item.id }, 'widget action applied')
      return result
    } catch (error) {
      return badReq(reply, error instanceof Error ? error.message : 'invalid action')
    }
  })

}

