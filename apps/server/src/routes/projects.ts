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
  type KbContextMode
} from '@voicechat/shared'

import type { VoiceChatDb } from '../db/database.js'
import { uid } from '../users/auth.js'
import type { BoardHub } from '../projects/boardHub.js'
import type { KnowledgeBaseService } from '../kb/types.js'
import { kbUsageFlags } from '../kb/routes.js'

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
  kbUsage?: { kb: KnowledgeBaseService; toolEnabled: boolean }
): void {
  // Гейт участника: проект есть и текущий пользователь — участник; иначе null.
  const member = (req: FastifyRequest, id: string): ProjectDetail | null => db.getProject(uid(req), id)

  // --- Проекты ---------------------------------------------------------

  app.get(REST.projects, async (req): Promise<ProjectSummary[]> => db.listProjects(uid(req)))

  app.post<{
    Body: { name?: string; description?: string; gitUrl?: string; technologies?: string[]; skills?: string[]; defaultSkills?: Partial<WorkItemDefaultSkills>; commitPolicy?: 'agent_commits' | 'final_system_commit' | 'manual_user_confirmation'; mergeTransport?: 'local' | 'github_pull_request'; agentPlanApprovalMode?: 'manual' | 'automatic' }
  }>(REST.projects, async (req, reply): Promise<ProjectDetail | FastifyReply> => {
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
      ciBaseBranch?: string
      ciBranchTemplate?: string
      ciReuseStrategy?: CiReuseStrategy
      ciExecAuthRef?: string
      /** Режим базы знаний в ходах модели CI-рана (auto|manual|off). */
      ciKbContextMode?: KbContextMode
      doneRetentionDays?: number | null
    }
  }>('/api/projects/:id', async (req, reply) => {

    const p = member(req, req.params.id)
    if (!p) return nf(reply)
    if (p.role !== 'owner') return forbidden(reply)
    const body = { ...(req.body ?? {}) }
    if (body.previewUrl !== undefined) {
      const previewUrl = normalizePreviewUrl(body.previewUrl)
      if (previewUrl === undefined) return badReq(reply, 'previewUrl must be an http/https URL')
      body.previewUrl = previewUrl
    }
    if (body.doneRetentionDays !== undefined) body.doneRetentionDays = normRetentionDays(body.doneRetentionDays)
    return db.updateProject(uid(req), req.params.id, body) ?? nf(reply)
  })

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const p = member(req, req.params.id)
    if (!p) return nf(reply)
    if (p.role !== 'owner') return forbidden(reply)
    db.deleteProject(uid(req), req.params.id)
    return { ok: true }
  })

  // --- Участники (только владелец) -------------------------------------

  app.post<{ Params: { id: string }; Body: { username?: string } }>(
    '/api/projects/:id/members',
    async (req, reply) => {
      const p = member(req, req.params.id)
      if (!p) return nf(reply)
      if (p.role !== 'owner') return forbidden(reply)
      const username = (req.body?.username ?? '').trim()
      if (!username) return badReq(reply, 'username required')
      try {
        return db.addMember(uid(req), req.params.id, username) ?? nf(reply)
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
      if (p.role !== 'owner') return forbidden(reply)
      const detail = db.removeMember(uid(req), req.params.id, req.params.username)
      boardHub.emit(req.params.id) // снятые назначения меняют доску
      return detail ?? nf(reply)
    }
  )

  // --- Машины проекта (только владелец) --------------------------------

  app.post<{ Params: { id: string }; Body: { agentId?: string } }>(
    '/api/projects/:id/machines',
    async (req, reply) => {
      const p = member(req, req.params.id)
      if (!p) return nf(reply)
      if (p.role !== 'owner') return forbidden(reply)
      const agentId = (req.body?.agentId ?? '').trim()
      if (!agentId) return badReq(reply, 'agentId required')
      try {
        return db.linkMachine(uid(req), req.params.id, agentId) ?? nf(reply)
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
      if (p.role !== 'owner') return forbidden(reply)
      return db.unlinkMachine(uid(req), req.params.id, req.params.agentId) ?? nf(reply)
    }
  )

  // Папка проекта на конкретной машине.
  app.patch<{ Params: { id: string; agentId: string }; Body: { path?: string; reposRoot?: string } }>(
    '/api/projects/:id/machines/:agentId',
    async (req, reply) => {
      const p = member(req, req.params.id)
      if (!p) return nf(reply)
      if (p.role !== 'owner') return forbidden(reply)
      return req.body?.reposRoot !== undefined
        ? db.setProjectMachineReposRoot(uid(req), req.params.id, req.params.agentId, req.body.reposRoot) ?? nf(reply)
        : db.setProjectMachinePath(uid(req), req.params.id, req.params.agentId, req.body?.path ?? '') ?? nf(reply)
    }
  )

  // Машина проекта по умолчанию.
  app.post<{ Params: { id: string }; Body: { agentId?: string } }>(
    '/api/projects/:id/default-machine',
    async (req, reply) => {
      const p = member(req, req.params.id)
      if (!p) return nf(reply)
      if (p.role !== 'owner') return forbidden(reply)
      const agentId = (req.body?.agentId ?? '').trim()
      if (!agentId) return badReq(reply, 'agentId required')
      try {
        return db.setProjectDefaultMachine(uid(req), req.params.id, agentId) ?? nf(reply)
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
  }>('/api/projects/:id/tasks', async (req, reply): Promise<Task | FastifyReply> => {
    const b = req.body ?? {}
    const title = (b.title ?? '').trim()
    if (!b.columnId || !title) return badReq(reply, 'columnId and title required')
    try {
      const task = db.createTask(uid(req), req.params.id, {
        columnId: b.columnId,
        title,
        description: b.description,
        acceptanceCriteria: b.acceptanceCriteria,
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
  }>('/api/projects/:id/tasks/:taskId', async (req, reply): Promise<Task | FastifyReply> => {

    try {
      const task = db.updateTask(uid(req), req.params.id, req.params.taskId, req.body ?? {})
      if (!task) return nf(reply)
      boardHub.emit(req.params.id)
      return task
    } catch (err) {
      return badReq(reply, errMessage(err))
    }
  })

  app.post<{
    Params: { id: string; taskId: string }
    Body: { columnId?: string; afterId?: string | null; beforeId?: string | null }
  }>('/api/projects/:id/tasks/:taskId/move', async (req, reply): Promise<Task | FastifyReply> => {
    const columnId = req.body?.columnId
    if (!columnId) return badReq(reply, 'columnId required')
    const task = db.moveTask(uid(req), req.params.id, req.params.taskId, {
      columnId,
      afterId: req.body?.afterId ?? null,
      beforeId: req.body?.beforeId ?? null
    })
    if (!task) return nf(reply)
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

  // Открыть/создать связанный с задачей чат текущего пользователя.
  app.post<{ Params: { id: string; taskId: string } }>(
    '/api/projects/:id/tasks/:taskId/chat',
    async (req, reply) => {
      const conv = db.openOrCreateTaskChat(uid(req), req.params.id, req.params.taskId)
      return conv ?? nf(reply)
    }
  )
}

