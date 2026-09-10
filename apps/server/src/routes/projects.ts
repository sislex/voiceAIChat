// REST для проектов и канбан-доски. Все маршруты под Bearer-защитой; доступ
// определяется членством в проекте (см. VoiceChatDb: isProjectMember/Owner).
// После мутаций доски зовём boardHub.emit → живой board.changed подписчикам.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AutomatedQaCheckResult } from '@voicechat/shared'
import {
  REST,
  type Board,
  type BoardStatuses,
  type KanbanColumn,
  type ProjectDetail,
  type ProjectSummary,
  type ProjectQuota,
  DEFAULT_OWNED_PROJECT_LIMIT,
  type ProjectMachineDirectoryAssignments,
  type ProjectMachineDirectoryKind,
  PROJECT_MACHINE_DIRECTORY_KINDS,
  type Task,
  type TaskPriority,
  type TaskLaunchResult,
  type TaskPreparationLlmSelection,
  type TaskPreparationRun,
  type WorkItemDefaultSkills,
  type CiReuseStrategy,
  type KbContextMode,
  WIDGET_TOOL_CONTRACT_VERSION,
  queryWidgetItems,
  normalizeAcceptanceCriteria,
  taskWidgetItem,
  type WidgetToolActionRequest,
  type WidgetToolGetRequest,
  type WidgetToolQueryRequest,
  sanitizeBoardView
} from '@voicechat/shared'

import type { VoiceChatDb } from '../db/database.js'
import { requireProjectPermission, uid } from '../users/auth.js'
import type { BoardHub } from '../projects/boardHub.js'
import type { KnowledgeBaseService } from '../kb/types.js'
import { kbUsageFlags } from '../kb/routes.js'
import type { CiRunManager } from '../ci/runManager.js'
import type { KanbanMachines } from '../kanban/core.js'
import { materializeProjectMachine as materialize } from '../projects/materialize.js'
import type { MergeRunManager } from '../merge/runManager.js'
import type { MakeService } from '@voicechat/make-contracts'
import type { KanbanUploads } from '../kanban/core.js'

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
  agents?: KanbanMachines,
  merge?: MergeRunManager,
  startTaskPreparation?: (userId: string, projectId: string, taskId: string, selection?: TaskPreparationLlmSelection) => Promise<TaskPreparationRun>,
  membershipChanged?: (projectId: string, affectedUserId?: string) => void,
  autoPilotChanged?: (projectId: string) => void,
  /**
   * Разовый прогон набора сценариев Automated QA. Без него набор проверялся
   * только задачей на доске: записал сценарий — и жди следующего рана, чтобы
   * узнать, работает ли он вообще.
   */
  checkAutomatedQa?: (userId: string, projectId: string, scenarioIndex?: number) => Promise<AutomatedQaCheckResult[]>,
  /** Оркестратор планов ассистента: отмена должна ещё и снять его таймер. */
  orchestration?: { cancel(owner: string, planId: string): Promise<import('@voicechat/shared').Orchestration | null> },
  /** Список файлов Make-проекта — проверка путей `makeSources` цикла доработки (make/service.ts). */
  make?: Pick<MakeService, 'listFiles'>,
  uploads?: KanbanUploads
): void {
  // Гейт участника: проект есть и текущий пользователь — участник; иначе null.
  const withMachineStatus = async (project: ProjectDetail | null, userId: string): Promise<ProjectDetail | null> => {
    if (!project) return null
    if (agents) {
      project.machines = project.machines.map((machine) => {
        const online = agents.isOnline(machine.agentId)
        return {
          ...machine,
          online,
          storage: machine.storage ? { ...machine.storage, status: online ? machine.storage.status : 'offline' } : machine.storage,
          availableStorages: machine.availableStorages?.map((storage) => ({ ...storage, status: online ? storage.status : 'offline' }))
        }
      })
      const eligible = project.machines
        .filter((machine) => (machine.ownership === 'mine' || machine.sharedWithProject) && machine.canUse !== false && machine.online === true)
        .map((machine) => machine.agentId)
      const current = project.machines.find((machine) => machine.isMyDefault)
      if (!current || !eligible.includes(current.agentId)) {
        await db.machines.setUserProjectDefaultMachine(userId, project.id, eligible[0] ?? null)
        project.machines = project.machines.map((machine) => ({ ...machine, isMyDefault: machine.agentId === eligible[0] }))
      }
    }
    return project
  }
  const member = async (req: FastifyRequest, id: string): Promise<ProjectDetail | null> =>
    withMachineStatus(await db.projects.getProject(uid(req), id), uid(req))

  const materializeProjectMachine = async (userId: string, projectId: string, agentId: string, storageId: string, directories?: ProjectMachineDirectoryAssignments): Promise<void> => {
    if (!agents) return
    await materialize(db, agents, userId, projectId, agentId, storageId, directories)
  }

  const taskCreateGuard = { preHandler: requireProjectPermission('task:create') }
  const taskUpdateGuard = { preHandler: requireProjectPermission('task:update') }
  const mergeGuard = { preHandler: requireProjectPermission('task:merge') }
  // Создание проекта — не настройка чужого проекта: доступно любой роли, создатель садится
  // владельцем. Остальные настроечные роуты гейтит глобальный hook через
  // projectPermissionForRequest → isProjectOwner, поэтому своего preHandler им не нужно.
  const createGuard = { preHandler: requireProjectPermission('project:create') }

  // --- Проекты ---------------------------------------------------------

  app.get(REST.projects, async (req): Promise<ProjectSummary[]> => await db.projects.listProjects(uid(req)))

  const projectQuota = async (req: FastifyRequest): Promise<ProjectQuota> => {
    const userId = uid(req)
    const unlimited = (await db.identity.getUser(userId))?.role === 'admin'
    const configured = Number(await db.settings.getAppConfig('projects.ownedLimit'))
    const limit = Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_OWNED_PROJECT_LIMIT
    return { owned: await db.projects.countOwnedProjects(userId), limit, unlimited }
  }
  app.get(REST.projectsQuota, async (req): Promise<ProjectQuota> => projectQuota(req))

  app.post<{
    Body: { name?: string; typeId?: string; description?: string; gitUrl?: string; technologies?: string[]; skills?: string[]; defaultSkills?: Partial<WorkItemDefaultSkills>; commitPolicy?: 'agent_commits' | 'final_system_commit' | 'manual_user_confirmation'; mergeTransport?: 'local' | 'github_pull_request'; agentPlanApprovalMode?: 'manual' | 'automatic' }
  }>(REST.projects, createGuard, async (req, reply): Promise<ProjectDetail | FastifyReply> => {
    const b = req.body ?? {}
    const quota = await projectQuota(req)
    if (!quota.unlimited && quota.owned >= quota.limit) {
      return reply.code(409).send({ error: `Достигнут лимит собственных проектов: ${quota.limit}. Удалите ненужный проект или обратитесь к администратору.` })
    }
    const name = (b.name ?? '').trim()
    if (!name) return badReq(reply, 'name required')
    // Тип берётся только из каталога, видимого этому пользователю: чужой личный
    // узел нельзя назначить, даже зная его id.
    if (b.typeId !== undefined && !(await db.projects.listProjectTypes(uid(req))).some((t) => t.id === b.typeId)) {
      return badReq(reply, 'Тип проекта недоступен')
    }
    return await db.projects.createProject(uid(req), {
      name,
      typeId: b.typeId,
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
    const p = await member(req, req.params.id)
    return p ?? nf(reply)
  })

  app.patch<{
    Params: { id: string }
    Body: {
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
      automatedQaMode?: import('@voicechat/shared').AutomatedQaMode
      automatedQaScenario?: import('@voicechat/shared').AutomatedQaScenario
      autoPilotDefault?: boolean
      autoPilotRequiresManualQa?: boolean
      autoPilotFixLimit?: number
      productionDeployCommand?: string
      productionAgentId?: string | null
      productionEnvironmentMode?: 'legacy' | 'managed'
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
      /** Политика команд проекта (machines-roadmap п.10). */
      commandPolicy?: import('@voicechat/shared').ProjectCommandPolicy
      /** Узел дерева типов; меняет живые возможности, но не трогает доску. */
      typeId?: string
    }
  }>('/api/projects/:id', async (req, reply) => {

    const p = await member(req, req.params.id)
    if (!p) return nf(reply)
    const body = { ...(req.body ?? {}) }
    if (body.productionEnvironmentMode === 'managed') return badReq(reply, 'Managed mode requires successful preflight and explicit confirmation')
    if (body.previewUrl !== undefined) {
      const previewUrl = normalizePreviewUrl(body.previewUrl)
      if (previewUrl === undefined) return badReq(reply, 'previewUrl must be an http/https URL')
      body.previewUrl = previewUrl
    }
    if (body.testUsers !== undefined) {
      try { const { sanitizeProjectTestUsers } = await import('@voicechat/shared'); body.testUsers = sanitizeProjectTestUsers(body.testUsers) } catch (error) { return badReq(reply, errMessage(error)) }
    }
    if (body.doneRetentionDays !== undefined) body.doneRetentionDays = normRetentionDays(body.doneRetentionDays)
    // Политика команд приходит из формы: чистим мусорные паттерны тем же парсером, что читает БД.
    if (body.commandPolicy !== undefined) { const { parseProjectCommandPolicy } = await import('@voicechat/shared'); body.commandPolicy = parseProjectCommandPolicy(JSON.stringify(body.commandPolicy)) }
    if (body.ciTestFixCycleLimit !== undefined && (!Number.isInteger(body.ciTestFixCycleLimit) || body.ciTestFixCycleLimit < 0)) return badReq(reply, 'ciTestFixCycleLimit must be a non-negative integer')
    if (body.autoPilotFixLimit !== undefined && (!Number.isInteger(body.autoPilotFixLimit) || body.autoPilotFixLimit < 0)) return badReq(reply, 'autoPilotFixLimit must be a non-negative integer')
    if (body.automatedQaMode !== undefined) {
      const { AUTOMATED_QA_MODES } = await import('@voicechat/shared')
      if (!AUTOMATED_QA_MODES.includes(body.automatedQaMode)) return badReq(reply, 'automatedQaMode must be command or playwright')
    }
    if (body.releaseTimeouts !== undefined) { try { const { validateReleaseTimeouts } = await import('@voicechat/shared'); validateReleaseTimeouts(body.releaseTimeouts) } catch(error) { return badReq(reply,errMessage(error)) } }
    // Тип — только из видимого пользователю каталога (см. POST выше).
    if (body.typeId !== undefined && !(await db.projects.listProjectTypes(uid(req))).some((t) => t.id === body.typeId)) {
      return badReq(reply, 'Тип проекта недоступен')
    }
    try {
      return await db.projects.updateProject(uid(req), req.params.id, body) ?? nf(reply)
    } catch (error) {
      return badReq(reply, errMessage(error))
    }
  })

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const p = await member(req, req.params.id)
    if (!p) return nf(reply)
    await db.projects.deleteProject(uid(req), req.params.id)
    return { ok: true }
  })

  // --- Участники (только владелец) -------------------------------------

  app.post<{ Params: { id: string }; Body: { username?: string } }>(
    '/api/projects/:id/members',
    async (req, reply) => {
      const p = await member(req, req.params.id)
      if (!p) return nf(reply)
        const username = (req.body?.username ?? '').trim()
      if (!username) return badReq(reply, 'username required')
      try {
        const detail = await db.projects.addMember(uid(req), req.params.id, username) ?? nf(reply)
        membershipChanged?.(req.params.id)
        return detail
      } catch (err) {
        return badReq(reply, errMessage(err))
      }
    }
  )

  app.patch<{ Params: { id: string; username: string }; Body: { role?: 'owner' | 'member' } }>(
    '/api/projects/:id/members/:username',
    async (req, reply) => {
      const p = await member(req, req.params.id)
      if (!p) return nf(reply)
      const role = req.body?.role
      if (role !== 'owner' && role !== 'member') return badReq(reply, 'role must be owner or member')
      try {
        const detail = await db.projects.updateMemberRole(uid(req), req.params.id, req.params.username, role) ?? nf(reply)
        membershipChanged?.(req.params.id)
        return detail
      } catch (err) {
        return badReq(reply, errMessage(err))
      }
    }
  )

  app.delete<{ Params: { id: string; username: string } }>(
    '/api/projects/:id/members/:username',
    async (req, reply) => {
      const p = await member(req, req.params.id)
      if (!p) return nf(reply)
      try {
        const detail = await db.projects.removeMember(uid(req), req.params.id, req.params.username)
        boardHub.emit(req.params.id) // снятые назначения меняют доску
        if (detail) membershipChanged?.(req.params.id, req.params.username)
        return detail ?? nf(reply)
      } catch (err) {
        return badReq(reply, errMessage(err))
      }
    }
  )

  // --- Машины проекта ----------------------------------------------------

  app.put<{ Params: { id: string; agentId: string }; Body: { shared?: boolean; access?: 'full' | 'read' } }>(
    '/api/projects/:id/machines/:agentId/share',
    async (req, reply) => {
      if (!await member(req, req.params.id)) return nf(reply)
      if (typeof req.body?.shared !== 'boolean') return badReq(reply, 'shared must be boolean')
      if (req.body.access !== undefined && req.body.access !== 'full' && req.body.access !== 'read') return badReq(reply, "access must be 'full' or 'read'")
      try {
        await db.machines.setMachineSharedWithProject(uid(req), req.params.id, req.params.agentId, req.body.shared, req.body.access ?? 'full')
        return await withMachineStatus(await db.projects.getProject(uid(req), req.params.id), uid(req)) ?? nf(reply)
      } catch (err) {
        return reply.code(403).send({ error: errMessage(err) })
      }
    }
  )

  // Вид доски — личная настройка участника, поэтому и права проверяются как у
  // участника, и запись адресуется его логином, а не проектом целиком.
  app.get<{ Params: { id: string } }>('/api/projects/:id/board/view', async (req, reply) => {
    if (!await member(req, req.params.id)) return nf(reply)
    return await db.projects.getBoardView(uid(req), req.params.id)
  })

  app.put<{ Params: { id: string }; Body: unknown }>('/api/projects/:id/board/view', async (req, reply) => {
    if (!await member(req, req.params.id)) return nf(reply)
    return await db.projects.saveBoardView(uid(req), req.params.id, sanitizeBoardView(req.body))
  })

  app.put<{ Params: { id: string }; Body: { agentId?: string | null } }>(
    '/api/projects/:id/machines/default',
    async (req, reply) => {
      if (!await member(req, req.params.id)) return nf(reply)
      const agentId = req.body?.agentId
      if (agentId !== null && typeof agentId !== 'string') return badReq(reply, 'agentId must be string or null')
      try {
        await db.machines.setUserProjectDefaultMachine(uid(req), req.params.id, agentId)
        return await withMachineStatus(await db.projects.getProject(uid(req), req.params.id), uid(req)) ?? nf(reply)
      } catch (err) {
        return badReq(reply, errMessage(err))
      }
    }
  )

  app.get<{ Params: { id: string } }>('/api/projects/:id/machines/audit', async (req, reply) => {
    if (!await db.projects.isProjectOwner(uid(req), req.params.id)) return forbidden(reply)
    return await db.machines.listMachineShareAudit(req.params.id)
  })

  app.get<{ Params: { id: string } }>('/api/projects/:id/machines', async (req, reply) => {
    const p = await member(req, req.params.id)
    return p ? p.machines : nf(reply)
  })

  app.get<{ Params: { id: string } }>('/api/projects/:id/machines/available', async (req, reply) => {
    const p = await member(req, req.params.id)
    if (!p) return nf(reply)
    const linked = new Set(p.machines.filter((machine) => machine.sharedWithProject).map((machine) => machine.agentId))
    return (await db.machines.listAgents(uid(req)))
      .filter((agent) => !linked.has(agent.id))
      .map((agent) => ({ id: agent.id, name: agent.name }))
  })

  app.post<{ Params: { id: string }; Body: { agentId?: string; storageId?: string } }>(
    '/api/projects/:id/machines',
    async (req, reply) => {
      const p = await member(req, req.params.id)
      if (!p) return nf(reply)
        const agentId = (req.body?.agentId ?? '').trim()
      if (!agentId) return badReq(reply, 'agentId required')
      if (await db.machines.isMachineSharedWithProject(req.params.id, agentId)) {
        return reply.code(409).send({ error: 'machine already shared' })
      }
      try {
        const storageId = req.body?.storageId ?? (await db.machines.listMachineStorages(uid(req), agentId))[0]?.id
        if (storageId) await materializeProjectMachine(uid(req), req.params.id, agentId, storageId)
        return await withMachineStatus(await db.machines.linkMachine(uid(req), req.params.id, agentId, storageId), uid(req)) ?? nf(reply)
      } catch (err) {
        return badReq(reply, errMessage(err))
      }
    }
  )

  app.delete<{ Params: { id: string; agentId: string } }>(
    '/api/projects/:id/machines/:agentId',
    async (req, reply) => {
      const p = await member(req, req.params.id)
      if (!p) return nf(reply)
        return await withMachineStatus(await db.projects.unlinkMachine(uid(req), req.params.id, req.params.agentId), uid(req)) ?? nf(reply)
    }
  )

  // Папка проекта на конкретной машине.
  app.patch<{ Params: { id: string; agentId: string }; Body: { path?: string; reposRoot?: string; sshHost?: string; sshUser?: string; storageId?: string; directories?: ProjectMachineDirectoryAssignments; resetDirectory?: ProjectMachineDirectoryKind } }>(
    '/api/projects/:id/machines/:agentId',
    async (req, reply) => {
      const p = await member(req, req.params.id)
      if (!p) return nf(reply)
      if (req.body?.resetDirectory !== undefined) {
        if (!PROJECT_MACHINE_DIRECTORY_KINDS.includes(req.body.resetDirectory)) return badReq(reply, 'unknown directory assignment')
        try {
          const machine = (await db.projects.getProject(uid(req), req.params.id))?.machines.find((item) => item.agentId === req.params.agentId)
          if (!machine?.storageId || !machine.directories || !machine.recommendations) throw new Error('MachineStorage не настроено')
          const directories = structuredClone(machine.directories)
          directories[req.body.resetDirectory] = { path: machine.recommendations[req.body.resetDirectory], override: false }
          await materializeProjectMachine(uid(req), req.params.id, req.params.agentId, machine.storageId, directories)
          return await withMachineStatus(await db.machines.resetProjectMachineDirectory(uid(req), req.params.id, req.params.agentId, req.body.resetDirectory), uid(req)) ?? nf(reply)
        } catch (err) { return badReq(reply, errMessage(err)) }
      }
      if (req.body?.storageId !== undefined) {
        try {
          await materializeProjectMachine(uid(req), req.params.id, req.params.agentId, req.body.storageId, req.body.directories)
          const platform = agents?.platformOf(req.params.agentId)
          return await withMachineStatus(await db.machines.configureProjectMachineStorage(uid(req), req.params.id, req.params.agentId, req.body.storageId, req.body.directories, platform), uid(req)) ?? nf(reply)
        } catch (err) { return badReq(reply, errMessage(err)) }
      }
      if (req.body?.sshHost !== undefined || req.body?.sshUser !== undefined) {
        return await withMachineStatus(await db.machines.setProjectMachineSsh(uid(req), req.params.id, req.params.agentId, req.body?.sshHost ?? '', req.body?.sshUser ?? ''), uid(req)) ?? nf(reply)
      }
      try {
        return req.body?.reposRoot !== undefined
          ? await withMachineStatus(await db.machines.setProjectMachineReposRoot(uid(req), req.params.id, req.params.agentId, req.body.reposRoot), uid(req)) ?? nf(reply)
          : await withMachineStatus(await db.machines.setProjectMachinePath(uid(req), req.params.id, req.params.agentId, req.body?.path ?? ''), uid(req)) ?? nf(reply)
      } catch (err) { return badReq(reply, errMessage(err)) }
    }
  )

  // Разовая проверка набора сценариев. Синхронный ответ с жёстким бюджетом: это
  // явное действие человека, который ждёт результат, а не фоновая работа —
  // заводить ради него сущность рана значило бы усложнить путь «записал →
  // проверил → поправил» ровно там, где он должен быть коротким.
  app.post<{ Params: { id: string }; Body: { scenarioIndex?: number } | undefined }>('/api/projects/:id/automated-qa/check', async (req, reply) => {
    const p = await member(req, req.params.id)
    if (!p) return nf(reply)
    if (!checkAutomatedQa) return reply.code(501).send({ error: 'browser_runner_unavailable', message: 'Изолированный Chromium не настроен на сервере' })
    const at = req.body?.scenarioIndex
    if (at !== undefined && (!Number.isInteger(at) || at < 0)) return badReq(reply, 'Номер сценария должен быть целым неотрицательным числом')
    try {
      return { results: await checkAutomatedQa(uid(req), req.params.id, at) }
    } catch (err) {
      // Параллельный прогон того же проекта — не ошибка ввода: человек нажал
      // дважды или зашёл со второй вкладки, и ему надо сказать «уже идёт», а не
      // поднимать второй Chromium на тот же набор.
      if (errMessage(err) === 'check_already_running') {
        return reply.code(409).send({ error: 'check_already_running', message: 'Прогон набора уже идёт — дождитесь результата' })
      }
      return badReq(reply, errMessage(err))
    }
  })

  // Машина проекта по умолчанию.
  app.post<{ Params: { id: string }; Body: { agentId?: string } }>(
    '/api/projects/:id/default-machine',
    async (req, reply) => {
      const p = await member(req, req.params.id)
      if (!p) return nf(reply)
        const agentId = (req.body?.agentId ?? '').trim()
      if (!agentId) return badReq(reply, 'agentId required')
      try {
        return await withMachineStatus(await db.projects.setProjectDefaultMachine(uid(req), req.params.id, agentId), uid(req)) ?? nf(reply)
      } catch (err) {
        return badReq(reply, errMessage(err))
      }
    }
  )

  // --- Git-доступ конкретной связки project + machine -------------------
  const gitMachine = async (req: FastifyRequest, reply: FastifyReply, projectId: string, agentId: string, write: boolean): Promise<ProjectDetail | FastifyReply> => {
    const project = await member(req, projectId)
    if (!project || !project.machines.some((machine) => machine.agentId === agentId && (machine.ownership === 'mine' || machine.sharedWithProject))) return nf(reply)
    if (write && project.role !== 'owner') return forbidden(reply)
    if (!agents?.isOnline(agentId)) return reply.code(409).send({ error: 'machine_offline', code: 'machine_offline' })
    return project
  }
  const gitError = (reply: FastifyReply, error: unknown): FastifyReply => {
    const code = errMessage(error) === 'machine_offline' ? 'machine_offline' : 'repository_unavailable'
    return reply.code(409).send({ error: code, code })
  }
  app.get<{ Params: { id: string; agentId: string }; Querystring: { repositoryUrl?: string } }>(
    '/api/projects/:id/machines/:agentId/git-access',
    async (req, reply) => {
      if (!req.query.repositoryUrl) return badReq(reply, 'repositoryUrl required')
      const gate = await gitMachine(req, reply, req.params.id, req.params.agentId, false)
      if ('statusCode' in gate) return gate
      try { return await agents!.gitAccess(req.params.agentId, { operation: 'status', repositoryUrl: req.query.repositoryUrl }) }
      catch (error) { return gitError(reply, error) }
    }
  )
  app.post<{ Params: { id: string; agentId: string }; Body: { repositoryUrl?: string; token?: string } }>(
    '/api/projects/:id/machines/:agentId/git-access/configure',
    async (req, reply) => {
      const repositoryUrl = req.body?.repositoryUrl?.trim(), token = req.body?.token
      if (!token) return reply.code(400).send({ error: 'token_missing', code: 'token_missing' })
      if (!repositoryUrl) return badReq(reply, 'repositoryUrl required')
      const gate = await gitMachine(req, reply, req.params.id, req.params.agentId, true)
      if ('statusCode' in gate) return gate
      try { return await agents!.gitAccess(req.params.agentId, { operation: 'configure', repositoryUrl, token }) }
      catch (error) { return gitError(reply, error) }
    }
  )
  app.post<{ Params: { id: string; agentId: string }; Body: { repositoryUrl?: string; refspec?: string } }>(
    '/api/projects/:id/machines/:agentId/git-access/verify',
    async (req, reply) => {
      const repositoryUrl = req.body?.repositoryUrl?.trim(), refspec = req.body?.refspec?.trim()
      if (!repositoryUrl) return badReq(reply, 'repositoryUrl required')
      if (!refspec || !/^refs\/heads\/[A-Za-z0-9._/-]+:refs\/heads\/[A-Za-z0-9._/-]+$/.test(refspec) || refspec.includes('..')) return badReq(reply, 'invalid refspec')
      const gate = await gitMachine(req, reply, req.params.id, req.params.agentId, true)
      if ('statusCode' in gate) return gate
      try { return await agents!.gitAccess(req.params.agentId, { operation: 'verify', repositoryUrl, refspec }) }
      catch (error) { return gitError(reply, error) }
    }
  )
  app.delete<{ Params: { id: string; agentId: string }; Body: { repositoryUrl?: string } }>(
    '/api/projects/:id/machines/:agentId/git-access',
    async (req, reply) => {
      const repositoryUrl = req.body?.repositoryUrl?.trim()
      if (!repositoryUrl) return badReq(reply, 'repositoryUrl required')
      const gate = await gitMachine(req, reply, req.params.id, req.params.agentId, true)
      if ('statusCode' in gate) return gate
      try { return await agents!.gitAccess(req.params.agentId, { operation: 'delete', repositoryUrl }) }
      catch (error) { return gitError(reply, error) }
    }
  )
  app.get<{ Params: { id: string; agentId: string }; Querystring: { repositoryUrl?: string } }>(
    '/api/projects/:id/machines/:agentId/git-access/diagnostics',
    async (req, reply) => {
      if (!req.query.repositoryUrl) return badReq(reply, 'repositoryUrl required')
      const gate = await gitMachine(req, reply, req.params.id, req.params.agentId, false)
      if ('statusCode' in gate) return gate
      try { return await agents!.gitAccess(req.params.agentId, { operation: 'diagnostics', repositoryUrl: req.query.repositoryUrl }) }
      catch (error) { return gitError(reply, error) }
    }
  )

  // --- Доска -----------------------------------------------------------

  // Первая фаза: колонки и скелет карточек — доска рисуется сразу, состояние
  // процессов клиент забирает следом (`/board/statuses`).
  // includeCompleted=1 — вместе с давно завершёнными задачами (по умолчанию их
  // на доске нет, см. настройку проекта «сколько держать завершённые»).
  app.get<{ Params: { id: string }; Querystring: { includeCompleted?: string } }>(
    '/api/projects/:id/board',
    async (req, reply): Promise<Board | FastifyReply> => {
      const board = await db.tasks.getBoardSkeleton(uid(req), req.params.id, { includeCompleted: queryFlag(req.query.includeCompleted) })
      return board ?? nf(reply)
    }
  )

  // Вторая фаза: чат карточки, merge, подготовка, последний ран и сводки CI.
  // Набор задач тот же, что у первой фазы, — включая фильтр по завершённым.
  app.get<{ Params: { id: string }; Querystring: { includeCompleted?: string } }>(
    '/api/projects/:id/board/statuses',
    async (req, reply): Promise<BoardStatuses | FastifyReply> => {
      const statuses = await db.tasks.getBoardStatuses(uid(req), req.params.id, { includeCompleted: queryFlag(req.query.includeCompleted) })
      return statuses ?? nf(reply)
    }
  )

  // --- Использование базы знаний по всем чатам проекта ------------------

  if (kbUsage) {
    app.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/api/projects/:id/kb-usage', async (req, reply) => {
      // Гейт как у доски: не участник → 404, а не пустой агрегат.
      const report = await db.kb.kbUsageProjectReport(uid(req), req.params.id, Number(req.query.limit) || undefined)
      return report ? { ...report, ...await kbUsageFlags(kbUsage.kb, kbUsage.toolEnabled) } : nf(reply)
    })
  }

  // --- Колонки (любой участник) ----------------------------------------

  app.post<{ Params: { id: string }; Body: { name?: string } }>(
    '/api/projects/:id/columns',
    async (req, reply): Promise<KanbanColumn | FastifyReply> => {
      const name = (req.body?.name ?? '').trim()
      if (!name) return badReq(reply, 'name required')
      const col = await db.projects.createColumn(uid(req), req.params.id, name)
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
      if (!await db.projects.reorderColumns(uid(req), req.params.id, order)) return nf(reply)
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
      if (!await db.projects.updateColumn(uid(req), req.params.id, req.params.columnId, fields)) return nf(reply)
      boardHub.emit(req.params.id)
      return { ok: true }
    }
  )

  app.post<{ Params: { id: string; columnId: string }; Body: { hidden?: boolean } }>(
    '/api/projects/:id/columns/:columnId/hidden',
    async (req, reply) => {
      const hidden = Boolean(req.body?.hidden)
      if (!await db.projects.setColumnHidden(uid(req), req.params.id, req.params.columnId, hidden)) return nf(reply)
      boardHub.emit(req.params.id)
      return { ok: true }
    }
  )

  app.delete<{ Params: { id: string; columnId: string } }>(
    '/api/projects/:id/columns/:columnId',
    async (req, reply) => {
      if (!await db.projects.deleteColumn(uid(req), req.params.id, req.params.columnId)) return nf(reply)
      boardHub.emit(req.params.id)
      return { ok: true }
    }
  )

  // --- Задачи (любой участник) -----------------------------------------

  /**
   * Автосвязь дизайна: задача, созданная из Make-чата, сразу получает
   * whole_project-связь с ним (task_designs). Без связи подготовка и
   * разработка не получают инструменты make_* и файлы макета — модель
   * упирается в недоступный публичный URL и задаёт вопрос про «источник
   * истины». Ошибки глотаются осознанно: источник может быть обычным чатом
   * или Make-проектом чужого проекта — тогда задача создаётся без связи,
   * как и раньше, а связать можно вручную из панели Make.
   */
  const tryLinkMakeDesign = async (userId: string, projectId: string, taskId: string, conversationId?: string): Promise<void> => {
    if (!conversationId?.trim()) return
    try {
      await db.tasks.linkTaskDesign(userId, projectId, taskId, { conversationId })
    } catch {
      // не Make-чат или чат другого проекта — это штатный случай, не ошибка
    }
  }

  app.post<{
    Params: { id: string }
    Body: { columnId?: string; title?: string; description?: string; acceptanceCriteria?: string; sourceConversationId?: string; type?: 'epic' | 'story' | 'task'; parentId?: string | null; priority?: TaskPriority; assignee?: string | null; createdBy?: unknown; agentId?: string | null; labels?: string[]; skills?: string[]; storyPoints?: number | null; dueDate?: number | null }
  }>('/api/projects/:id/tasks', taskCreateGuard, async (req, reply): Promise<Task | FastifyReply> => {
    const b = req.body ?? {}
    const title = (b.title ?? '').trim()
    if (Object.prototype.hasOwnProperty.call(b, 'createdBy')) return badReq(reply, 'createdBy is server-controlled')
    if (!b.columnId || !title) return badReq(reply, 'columnId and title required')
    try {
      const task = await db.tasks.createTask(uid(req), req.params.id, {
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
        dueDate: b.dueDate,
        source: 'rest',
        idempotencyKey: typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined
      })

      if (!task) return nf(reply)
      await tryLinkMakeDesign(uid(req), req.params.id, task.id, b.sourceConversationId)
      boardHub.emit(req.params.id)
      // Задачу отдаём со свежими связями: клиент показывает карточку сразу.
      return await db.tasks.getCiTask(uid(req), req.params.id, task.id) ?? task
    } catch (err) {
      return badReq(reply, errMessage(err))
    }
  })

  // --- Активность карточки: комментарии, ворклог, история (как в Jira) ----
  // История пишется сервером сама (updateTask/moveTask); здесь — чтение снимка
  // тремя лентами и CRUD пользовательского содержимого. Ошибки прав из БД
  // («может править автор, владелец или админ») отдаются как 403 словами.
  const activityError = (reply: FastifyReply, error: unknown): FastifyReply => {
    const message = errMessage(error)
    return reply.code(message.includes('автор, владелец') ? 403 : 400).send({ error: message })
  }

  app.get<{ Params: { id: string; taskId: string } }>('/api/projects/:id/tasks/:taskId/activity', async (req, reply) => {
    const activity = await db.tasks.taskActivity(uid(req), req.params.id, req.params.taskId)
    return activity ?? nf(reply)
  })

  app.post<{ Params: { id: string; taskId: string }; Body: { text?: string } }>('/api/projects/:id/tasks/:taskId/comments', async (req, reply) => {
    try {
      const comment = await db.tasks.addTaskComment(uid(req), req.params.id, req.params.taskId, String(req.body?.text ?? ''))
      if (!comment) return nf(reply)
      boardHub.emit(req.params.id)
      return comment
    } catch (error) { return activityError(reply, error) }
  })

  app.patch<{ Params: { id: string; taskId: string; commentId: string }; Body: { text?: string } }>('/api/projects/:id/tasks/:taskId/comments/:commentId', async (req, reply) => {
    try {
      const comment = await db.tasks.updateTaskComment(uid(req), req.params.id, req.params.commentId, String(req.body?.text ?? ''))
      if (!comment) return nf(reply)
      boardHub.emit(req.params.id)
      return comment
    } catch (error) { return activityError(reply, error) }
  })

  app.delete<{ Params: { id: string; taskId: string; commentId: string } }>('/api/projects/:id/tasks/:taskId/comments/:commentId', async (req, reply) => {
    try {
      if (!await db.tasks.deleteTaskComment(uid(req), req.params.id, req.params.commentId)) return nf(reply)
      boardHub.emit(req.params.id)
      return { ok: true as const }
    } catch (error) { return activityError(reply, error) }
  })

  app.post<{ Params: { id: string; taskId: string }; Body: { minutes?: number; comment?: string; startedAt?: number } }>('/api/projects/:id/tasks/:taskId/worklog', async (req, reply) => {
    try {
      const entry = await db.tasks.addTaskWorklog(uid(req), req.params.id, req.params.taskId, {
        minutes: Number(req.body?.minutes ?? 0),
        ...(req.body?.comment !== undefined ? { comment: String(req.body.comment) } : {}),
        ...(req.body?.startedAt !== undefined ? { startedAt: Number(req.body.startedAt) } : {})
      })
      if (!entry) return nf(reply)
      boardHub.emit(req.params.id)
      return entry
    } catch (error) { return activityError(reply, error) }
  })

  app.patch<{ Params: { id: string; taskId: string; entryId: string }; Body: { minutes?: number; comment?: string; startedAt?: number } }>('/api/projects/:id/tasks/:taskId/worklog/:entryId', async (req, reply) => {
    try {
      const entry = await db.tasks.updateTaskWorklog(uid(req), req.params.id, req.params.entryId, {
        ...(req.body?.minutes !== undefined ? { minutes: Number(req.body.minutes) } : {}),
        ...(req.body?.comment !== undefined ? { comment: String(req.body.comment) } : {}),
        ...(req.body?.startedAt !== undefined ? { startedAt: Number(req.body.startedAt) } : {})
      })
      if (!entry) return nf(reply)
      boardHub.emit(req.params.id)
      return entry
    } catch (error) { return activityError(reply, error) }
  })

  app.delete<{ Params: { id: string; taskId: string; entryId: string } }>('/api/projects/:id/tasks/:taskId/worklog/:entryId', async (req, reply) => {
    try {
      if (!await db.tasks.deleteTaskWorklog(uid(req), req.params.id, req.params.entryId)) return nf(reply)
      boardHub.emit(req.params.id)
      return { ok: true as const }
    } catch (error) { return activityError(reply, error) }
  })

  app.post<{
    Params: { id: string }
    Body: { proposalId?: string; title?: string; description?: string; acceptanceCriteria?: string; sourceConversationId?: string; type?: 'epic' | 'story' | 'task'; parentId?: string | null; priority?: TaskPriority; assignee?: string | null; labels?: string[]; skills?: string[]; storyPoints?: number | null; dueDate?: number | null; selection?: TaskPreparationLlmSelection }
  }>('/api/projects/:id/task-launch/preparation', taskCreateGuard, async (req, reply): Promise<TaskLaunchResult | FastifyReply> => {
    const b = req.body ?? {}
    const proposalId = b.proposalId?.trim(), title = b.title?.trim()
    if (!proposalId || !title) return badReq(reply, 'proposalId and title required')
    if (!startTaskPreparation) return reply.code(503).send({ error: 'Подготовка недоступна' })
    try {
      const result = await db.tasks.createTaskFromProposalInPreparation(uid(req), req.params.id, proposalId, {
        title, description: b.description, acceptanceCriteria: b.acceptanceCriteria === undefined ? undefined : normalizeAcceptanceCriteria(b.acceptanceCriteria),
        type: b.type, parentId: b.parentId, priority: b.priority, assignee: b.assignee ?? null,
        labels: b.labels, skills: b.skills, storyPoints: b.storyPoints, dueDate: b.dueDate,
        source: 'task-launch'
      })
      // Связь с Make — до запуска подготовки: makeSources собираются при старте
      // рана, и связь, созданная позже, в этот ран уже не попадёт.
      await tryLinkMakeDesign(uid(req), req.params.id, result.taskId, b.sourceConversationId)
      if (result.type === 'preparation' && result.status === 'success') {
        const actual = await db.tasks.getTaskPreparationRun(uid(req), result.runId)
        if (actual && (actual.status === 'running' || actual.status === 'success')) return result
      }
      try {
        const run = await startTaskPreparation(uid(req), req.params.id, result.taskId, b.selection)
        await db.tasks.saveTaskLaunchPreparationRun(req.params.id, proposalId, run.id, null)
        boardHub.emit(req.params.id)
        return { type: 'preparation', status: 'success', taskId: result.taskId, runId: run.id }
      } catch (error) {
        const message = errMessage(error)
        await db.tasks.saveTaskLaunchPreparationRun(req.params.id, proposalId, null, message)
        boardHub.emit(req.params.id)
        return reply.code(207).send({ type: 'preparation', status: 'partial', taskId: result.taskId, error: message, canRetry: true })
      }
    } catch (error) {
      return reply.code(409).send({ error: errMessage(error) })
    }
  })

  // Полная задача по id: доска отдаёт лёгкие карточки без тяжёлых текстов, а
  // TaskModal догружает описание/критерии/лог подготовки при открытии карточки.
  app.get<{ Params: { id: string; taskId: string } }>('/api/projects/:id/tasks/:taskId', async (req, reply): Promise<Task | FastifyReply> =>
    await db.tasks.getTaskDetail(uid(req), req.params.id, req.params.taskId) ?? nf(reply)
  )

  app.patch<{
    Params: { id: string; taskId: string }
    Body: { title?: string; description?: string; acceptanceCriteria?: string; type?: 'epic' | 'story' | 'task'; parentId?: string | null; priority?: TaskPriority; assignee?: string | null; agentId?: string | null; labels?: string[]; skills?: string[]; storyPoints?: number | null; dueDate?: number | null; flagged?: boolean; autoPilot?: boolean }
  }>('/api/projects/:id/tasks/:taskId', taskUpdateGuard, async (req, reply): Promise<Task | FastifyReply> => {

    try {
      const body = req.body ?? {}
      const task = await db.tasks.updateTask(uid(req), req.params.id, req.params.taskId, {
        ...body,
        acceptanceCriteria: body.acceptanceCriteria === undefined ? undefined : normalizeAcceptanceCriteria(body.acceptanceCriteria)
      })
      if (!task) return nf(reply)
      boardHub.emit(req.params.id)
      if (task.autoPilot) autoPilotChanged?.(req.params.id)
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
    const board = await db.tasks.getBoard(uid(req), req.params.id)
    const taskBeforeMove = board?.tasks.find((task) => task.id === req.params.taskId)
    const from = taskBeforeMove && board?.columns.find((column) => column.id === taskBeforeMove.columnId)
    const requestedFrom = req.body?.fromColumnId
      ? board?.columns.find((column) => column.id === req.body.fromColumnId)
      : from
    const to = board?.columns.find((column) => column.id === columnId)
    if (ci && from?.semanticType === 'development' && to?.semanticType === 'backlog') {
      const latestRun = await db.ci.latestCiRunSummary(req.params.taskId)
      if (latestRun?.status === 'queued' || latestRun?.status === 'running' || latestRun?.status === 'awaiting_input') {
        const removal = await ci.dequeue(uid(req), latestRun.id)
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
      const result = await ci.startForDevelopmentTransition(uid(req), req.params.id, req.params.taskId, from?.semanticType === 'ready')
      if ('error' in result) {
        req.log.warn({ projectId: req.params.id, taskId: req.params.taskId, reason: result.error }, 'development transition rejected')
        return reply.code(409).send({ error: result.error })
      }
      // start() уже переносит карточку после INSERT; повторный move применяет
      // только запрошенную drag&drop-позицию и нужен также при reuse активного рана.
      const moved = await db.tasks.moveTask(uid(req), req.params.id, req.params.taskId, {
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
        await startTaskPreparation(uid(req), req.params.id, req.params.taskId)
        boardHub.emit(req.params.id)
        return (await db.tasks.getBoard(uid(req), req.params.id))?.tasks.find((item) => item.id === req.params.taskId) ?? nf(reply)
      } catch (error) {
        return reply.code(409).send({ error: errMessage(error) })
      }
    }
    const task = await db.tasks.moveTask(uid(req), req.params.id, req.params.taskId, {
      columnId,
      afterId: req.body?.afterId ?? null,
      beforeId: req.body?.beforeId ?? null
    })
    if (!task) return nf(reply)
    // Ручное закрытие задачи чистит её копии репозиториев так же, как успешный merge.
    if (to?.semanticType === 'done') void merge?.releaseTaskRepositories({ projectId: req.params.id, taskId: req.params.taskId }).catch(() => {})
    boardHub.emit(req.params.id)
    if (task.autoPilot) autoPilotChanged?.(req.params.id)
    return task
  })

  app.delete<{ Params: { id: string; taskId: string } }>(
    '/api/projects/:id/tasks/:taskId',
    async (req, reply) => {
      if (!await db.tasks.deleteTask(uid(req), req.params.id, req.params.taskId)) return nf(reply)
      boardHub.emit(req.params.id)
      return { ok: true }
    }
  )

  app.get<{ Params: { id: string; taskId: string } }>(
    '/api/projects/:id/tasks/:taskId/merge/machines',
    async (req, reply) => {
      const project = await member(req, req.params.id)
      if (!project || !merge) return nf(reply)
      const workspace = await db.ci.findLatestPushedCiWorkspace(req.params.id, req.params.taskId)
      const machines = await Promise.all(project.machines.map(async (machine) => ({
        agentId: machine.agentId,
        name: machine.name ?? machine.agentId,
        readiness: await merge.checkReadiness(uid(req), req.params.id, req.params.taskId, machine.agentId)
      })))
      return { machines, defaultAgentId: workspace?.agentId ?? null }
    }
  )

  // Отдельный merge-ран: сервер сам берёт подготовленную ветку и main; машина —
  // по умолчанию машина workspace, agentId в теле выбирает другую машину проекта.
  app.post<{ Params: { id: string; taskId: string }; Body: { agentId?: string; provider?: 'claude' | 'codex'; model?: string } }>(
    '/api/projects/:id/tasks/:taskId/merge',
    mergeGuard,
    async (req, reply) => {
      const project = await member(req, req.params.id)
      if (!project) return nf(reply)
      try {
        const workspace = await db.ci.findLatestPushedCiWorkspace(req.params.id, req.params.taskId)
        const targetAgentId = req.body?.agentId ?? workspace?.agentId
        if (merge && targetAgentId) {
          const readiness = await merge.checkReadiness(uid(req), req.params.id, req.params.taskId, targetAgentId)
          if (!readiness.ready) throw new Error(readiness.message)
        }
        const run = await db.ci.startMergeRun(uid(req), req.params.id, req.params.taskId, req.body?.agentId ?? null, {
          ...(req.body?.provider ? { provider: req.body.provider } : {}),
          ...(typeof req.body?.model === 'string' ? { model: req.body.model } : {})
        })
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
    await db.ci.getMergeRun(uid(req), req.params.runId) ?? nf(reply)
  )

  app.delete<{ Params: { runId: string } }>('/api/merge/runs/:runId', async (req, reply) => {
    try {
      const run = await merge?.cancel(req.params.runId, uid(req))
      if (!run) return nf(reply)
      boardHub.emit(run.projectId)
      return run
    } catch (error) {
      return reply.code(409).send({ error: errMessage(error) })
    }
  })

  app.post<{ Params: { runId: string }; Body: { agentId?: string; unpin?: boolean } }>('/api/merge/runs/:runId/retry', mergeGuard, async (req, reply) => {
    try {
      const previous = await db.ci.getMergeRun(uid(req), req.params.runId)
      if (!previous) return nf(reply)
      const targetAgentId = req.body?.agentId ?? previous.agentId
      if (merge) {
        const readiness = await merge.checkReadiness(uid(req), previous.projectId, previous.taskId, targetAgentId)
        if (!readiness.ready) throw new Error(readiness.message)
      }
      const run = await db.ci.retryMergeRun(uid(req), req.params.runId, req.body?.agentId ?? null, req.body?.unpin === true)
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
      if (!await member(req, req.params.id)) return nf(reply)
      return await db.ci.listMergeRuns(uid(req), req.params.id, req.params.taskId)
    }
  )

  // Копии репозиториев задачи по машинам (dev-workspace и merge-клоны).
  app.get<{ Params: { id: string; taskId: string } }>(
    '/api/projects/:id/tasks/:taskId/repositories',
    async (req, reply) => {
      if (!await member(req, req.params.id)) return nf(reply)
      return await db.tasks.listTaskRepositories(uid(req), req.params.id, req.params.taskId)
    }
  )

  // Открыть/создать связанный с задачей чат текущего пользователя.
  app.post<{ Params: { id: string; taskId: string } }>(
    '/api/projects/:id/tasks/:taskId/chat',
    async (req, reply) => {
      const conv = await db.chat.openOrCreateTaskChat(uid(req), req.params.id, req.params.taskId)
      return conv ?? nf(reply)
    }
  )

  // --- Неизменяемые циклы ручной доработки и постоянные вложения --------
  app.get<{ Params: { id: string; taskId: string } }>('/api/projects/:id/tasks/:taskId/rework-cycles', async (req, reply) =>
    await db.tasks.taskReworkCycles(uid(req), req.params.id, req.params.taskId) ?? nf(reply)
  )

  app.post<{ Params: { id: string; taskId: string }; Body: { description?: string; criteria?: string[]; makeSources?: Array<{ conversationId: string; title?: string; mode: 'whole_project' | 'files'; paths: string[] }>; attachmentIds?: string[]; makeMode?: 'whole_project' | 'files'; makePaths?: string[]; uploadIds?: string[]; idempotencyKey?: string } }>(
    '/api/projects/:id/tasks/:taskId/rework-cycles',
    async (req, reply) => {
      const body = req.body
      if (body?.idempotencyKey) {
        const userId = uid(req)
        const files: Array<{ id: string; uploadId: string; name: string; mimeType: string; size: number; status: 'ready' }> = []
        for (const uploadId of body.uploadIds ?? []) {
          const upload = await uploads?.get(uploadId)
          if (upload?.ownerId === userId) files.push({ id: upload.id, uploadId: upload.id, name: upload.name, mimeType: upload.mimeType, size: upload.size, status: 'ready' })
        }
        try {
          const cycle = await db.tasks.createTaskReworkCycle(userId, req.params.id, req.params.taskId, {
            description: body.description ?? '', criteria: body.criteria ?? [], makeMode: body.makeMode ?? 'whole_project',
            makePaths: body.makePaths ?? [], makeSources: body.makeSources?.map((source) => ({ ...source, title: source.title ?? source.conversationId, owner: '' })),
            uploadIds: body.uploadIds ?? [], idempotencyKey: body.idempotencyKey
          }, files)
          boardHub.emit(req.params.id)
          return cycle
        } catch (error) {
          const code = errMessage(error)
          if (code === 'not_found') return nf(reply)
          return reply.code(code === 'validation_error' || code === 'invalid_upload' ? 400 : 409).send({ error: code, code })
        }
      }
      const key = String(req.headers['idempotency-key'] ?? '').trim()
      if (!key) return badReq(reply, 'Idempotency-Key required')
      try {
        const replay = await db.tasks.taskReworkCycleByIdempotencyKey(uid(req), req.params.id, req.params.taskId, key)
        if (replay) {
          const task = await db.tasks.getTaskDetail(uid(req), req.params.id, req.params.taskId)
          if (!task) return nf(reply)
          return { cycle: replay, task, replayed: true }
        }
        if ((await db.tasks.latestTaskRunResult(req.params.taskId))?.outcome === 'active') {
          return reply.code(409).send({ error: 'task_active_run', message: 'Создание цикла заблокировано: активный ран продолжает выполняться.' })
        }
        const sources = Array.isArray(req.body?.makeSources) ? req.body.makeSources : []
        for (const source of sources) {
          await db.tasks.assertTaskDesignSource(uid(req), req.params.id, req.params.taskId, source.conversationId)
          if (source.mode === 'files') {
            if (!make) throw new Error('Хранилище Make недоступно')
            const existing = new Set((await make.listFiles(source.conversationId)).map((file) => file.path))
            const missing = source.paths.find((path) => !existing.has(path))
            if (missing) throw new Error(`Make-проект ${source.conversationId}: файл ${missing} не найден`)
          }
        }
        const result = await db.tasks.createPersistentTaskReworkCycle(uid(req), req.params.id, req.params.taskId, key, {
          description: req.body?.description ?? '',
          criteria: Array.isArray(req.body?.criteria) ? req.body.criteria : [],
          makeSources: sources,
          attachmentIds: Array.isArray(req.body?.attachmentIds) ? req.body.attachmentIds : []
        })
        boardHub.emit(req.params.id)
        return result
      } catch (error) {
        const message = errMessage(error)
        if (message === 'TASK_ACTIVE_RUN') return reply.code(409).send({ error: 'task_active_run', message: 'Создание цикла заблокировано: активный ран продолжает выполняться.' })
        return badReq(reply, message)
      }
    }
  )

  // --- Черновики доработок ---------------------------------------------
  // Отдельные маршруты, а не флаг у создания цикла: черновик правится и
  // удаляется, поэтому у него свой жизненный цикл и свои коды ошибок.
  // Вложения приходят через порт ядра (в отдельном процессе — по сети), поэтому по одному и с `await`.
  const draftFiles = async (userId: string, uploadIds: string[]): Promise<Array<{ uploadId: string; name: string; mimeType: string; size: number }>> => {
    const files: Array<{ uploadId: string; name: string; mimeType: string; size: number }> = []
    for (const uploadId of uploadIds) {
      const upload = await uploads?.get(uploadId)
      if (upload?.ownerId === userId) files.push({ uploadId: upload.id, name: upload.name, mimeType: upload.mimeType, size: upload.size })
    }
    return files
  }
  const draftError = (reply: FastifyReply, error: unknown): FastifyReply => {
    const code = errMessage(error)
    if (code === 'not_found') return nf(reply)
    if (code === 'active_run') return reply.code(409).send({ error: 'task_active_run', message: 'Отправка заблокирована: активный ран продолжает выполняться.' })
    if (code === 'invalid_state') return reply.code(409).send({ error: code, code })
    return reply.code(400).send({ error: code, code })
  }
  type DraftBody = { description?: string; criteria?: string[]; makeSources?: Array<{ conversationId: string; title?: string; mode: 'whole_project' | 'files'; paths: string[] }>; uploadIds?: string[] }
  const draftInput = (body: DraftBody | undefined): { description: string; criteria: string[]; makeSources: NonNullable<DraftBody['makeSources']> } => ({
    description: body?.description ?? '',
    criteria: Array.isArray(body?.criteria) ? body.criteria : [],
    makeSources: Array.isArray(body?.makeSources) ? body.makeSources : []
  })

  app.post<{ Params: { id: string; taskId: string }; Body: DraftBody }>(
    '/api/projects/:id/tasks/:taskId/rework-drafts',
    async (req, reply) => {
      const userId = uid(req)
      try {
        const cycle = await db.tasks.createTaskReworkDraft(userId, req.params.id, req.params.taskId, draftInput(req.body), await draftFiles(userId, req.body?.uploadIds ?? []))
        boardHub.emit(req.params.id)
        return cycle
      } catch (error) { return draftError(reply, error) }
    }
  )

  app.patch<{ Params: { id: string; taskId: string; cycleId: string }; Body: DraftBody }>(
    '/api/projects/:id/tasks/:taskId/rework-drafts/:cycleId',
    async (req, reply) => {
      const userId = uid(req)
      try {
        const cycle = await db.tasks.updateTaskReworkDraft(userId, req.params.id, req.params.taskId, req.params.cycleId, draftInput(req.body), await draftFiles(userId, req.body?.uploadIds ?? []))
        boardHub.emit(req.params.id)
        return cycle
      } catch (error) { return draftError(reply, error) }
    }
  )

  app.delete<{ Params: { id: string; taskId: string; cycleId: string } }>(
    '/api/projects/:id/tasks/:taskId/rework-drafts/:cycleId',
    async (req, reply) => {
      try {
        await db.tasks.deleteTaskReworkDraft(uid(req), req.params.id, req.params.taskId, req.params.cycleId)
        boardHub.emit(req.params.id)
        return { deleted: true as const }
      } catch (error) { return draftError(reply, error) }
    }
  )

  app.post<{ Params: { id: string; taskId: string; cycleId: string } }>(
    '/api/projects/:id/tasks/:taskId/rework-drafts/:cycleId/submit',
    async (req, reply) => {
      const userId = uid(req)
      try {
        const cycle = await db.tasks.submitTaskReworkDraft(userId, req.params.id, req.params.taskId, req.params.cycleId)
        const task = await db.tasks.getTaskDetail(userId, req.params.id, req.params.taskId)
        if (!task) return nf(reply)
        boardHub.emit(req.params.id)
        return { cycle, task }
      } catch (error) { return draftError(reply, error) }
    }
  )

  app.get<{ Params: { id: string; taskId: string }; Querystring: { scope?: 'source' | 'rework_draft' } }>(
    '/api/projects/:id/tasks/:taskId/attachments',
    async (req, reply) => await db.tasks.taskAttachments(uid(req), req.params.id, req.params.taskId, req.query.scope ?? 'source') ?? nf(reply)
  )
  app.post<{ Params: { id: string; taskId: string }; Body: { name?: string; mimeType?: string; dataBase64?: string; scope?: 'source' | 'rework_draft' } }>(
    '/api/projects/:id/tasks/:taskId/attachments',
    async (req, reply) => {
      try {
        if (!req.body?.name || !req.body?.dataBase64) return badReq(reply, 'name and dataBase64 required')
        return await db.tasks.createTaskAttachment(uid(req), req.params.id, req.params.taskId, { name: req.body.name, mimeType: req.body.mimeType, dataBase64: req.body.dataBase64, scope: req.body.scope })
      } catch (error) { return badReq(reply, errMessage(error)) }
    }
  )
  // Сам файл вложения: карточка задачи показывает превью картинок, а не только имя.
  app.get<{ Params: { id: string; taskId: string; attachmentId: string } }>(
    '/api/projects/:id/tasks/:taskId/attachments/:attachmentId',
    async (req, reply) => {
      const file = await db.tasks.taskAttachmentContent(uid(req), req.params.id, req.params.taskId, req.params.attachmentId)
      if (!file) return nf(reply)
      return reply
        .header('content-type', file.mimeType)
        .header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`)
        .header('cache-control', 'private, max-age=300')
        .send(file.data)
    }
  )
  app.delete<{ Params: { id: string; taskId: string; attachmentId: string } }>(
    '/api/projects/:id/tasks/:taskId/attachments/:attachmentId',
    async (req, reply) => await db.tasks.deleteTaskAttachment(uid(req), req.params.id, req.params.taskId, req.params.attachmentId) ? { deleted: true } : nf(reply)
  )
  app.get<{ Params: { id: string; taskId: string; conversationId: string } }>(
    '/api/projects/:id/tasks/:taskId/rework-make/:conversationId/files',
    async (req, reply) => {
      try {
        await db.tasks.assertTaskDesignSource(uid(req), req.params.id, req.params.taskId, req.params.conversationId)
        if (!make) throw new Error('Хранилище Make недоступно')
        return await make.listFiles(req.params.conversationId)
      } catch (error) { return badReq(reply, errMessage(error)) }
    }
  )

  // --- Дизайны карточки: связь задачи с проектом Make -------------------
  // Источник ограничен Make-проектами, привязанными к этому же проекту: связь
  // не должна приводить участника к дизайну, которого он не вправе открыть.
  app.get<{ Params: { id: string; taskId: string } }>(
    '/api/projects/:id/tasks/:taskId/designs',
    async (req, reply) => {
      const links = await db.tasks.listTaskDesigns(uid(req), req.params.id, req.params.taskId)
      if (!links) return nf(reply)
      if (!make) return links
      return Promise.all(links.map(async (link) => {
        if (link.mode === 'whole_project') return link
        try {
          const existing = new Set((await make.listFiles(link.conversationId)).map((file) => file.path))
          return { ...link, fileStatuses: link.paths.map((path) => existing.has(path) ? { path, available: true } : { path, available: false, error: `Make-проект «${link.conversationTitle}» (${link.conversationId}): файл ${path} недоступен` }) }
        } catch (error) {
          return { ...link, fileStatuses: link.paths.map((path) => ({ path, available: false, error: `Make-проект «${link.conversationTitle}» (${link.conversationId}), файл ${path}: ${errMessage(error)}` })) }
        }
      }))
    }
  )

  app.post<{ Params: { id: string; taskId: string }; Body: { conversationId?: string; mode?: 'whole_project' | 'files'; paths?: string[]; path?: string; label?: string } }>(
    '/api/projects/:id/tasks/:taskId/designs',
    async (req, reply) => {
      const conversationId = req.body?.conversationId
      if (!conversationId) return badReq(reply, 'conversationId required')
      try {
        const userId = uid(req)
        await db.tasks.assertTaskDesignSource(userId, req.params.id, req.params.taskId, conversationId)
        if (req.body?.mode === 'files') {
          if (!make) throw new Error('Хранилище Make недоступно')
          const requested = req.body.paths ?? []
          const existing = new Set((await make.listFiles(conversationId)).map((file) => file.path))
          const missing = requested.find((path) => !existing.has(path))
          if (missing) throw new Error(`Make-проект ${conversationId}: файл ${missing} не найден`)
        }
        const links = await db.tasks.linkTaskDesign(userId, req.params.id, req.params.taskId, {
          conversationId,
          mode: req.body?.mode,
          paths: req.body?.paths,
          path: req.body?.path,
          label: req.body?.label
        })
        boardHub.emit(req.params.id)
        return links
      } catch (error) {
        return badReq(reply, errMessage(error))
      }
    }
  )

  app.delete<{ Params: { id: string; taskId: string; linkId: string } }>(
    '/api/projects/:id/tasks/:taskId/designs/:linkId',
    async (req, reply) => {
      const links = await db.tasks.unlinkTaskDesign(uid(req), req.params.id, req.params.taskId, req.params.linkId)
      if (!links) return nf(reply)
      boardHub.emit(req.params.id)
      return links
    }
  )

  app.get<{ Params: { id: string } }>(
    '/api/projects/:id/design-sources',
    async (req, reply) => await db.tasks.projectDesignSources(uid(req), req.params.id) ?? nf(reply)
  )

  // --- Планы канбан-ассистента ----------------------------------------
  // Панель прогресса читает их через REST, а живые изменения приходят кадром
  // assistant.orchestration — как у CI-ранов.
  app.get<{ Params: { id: string } }>('/api/projects/:id/orchestrations', async (req, reply) =>
    await db.projects.getProject(uid(req), req.params.id) ? await db.tasks.listOrchestrations(uid(req), req.params.id) : nf(reply)
  )

  app.post<{ Params: { planId: string } }>('/api/orchestrations/:planId/cancel', async (req, reply) =>
    (await orchestration?.cancel(uid(req), req.params.planId)) ?? (await db.tasks.cancelOrchestration(uid(req), req.params.planId)) ?? nf(reply)
  )

  // --- Универсальный инструментальный шлюз виджетов --------------------
  // Адаптеры перечислены кодом: запрос не может подставить URL или произвольный backend.
  const widgetIdempotency = new Map<string, unknown>()
  const widgetScope = async (userId: string, body: WidgetToolQueryRequest): Promise<boolean> => {
    if (body.version !== WIDGET_TOOL_CONTRACT_VERSION || body.widgetKind !== 'kanban' || body.widgetInstanceId !== body.projectId) return false
    const conversation = await db.chat.getConversation(userId, body.conversationId)
    const turnOwned = (await db.chat.listMessages(userId, body.conversationId)).some((message) => message.id === body.turnId)
    return Boolean(conversation?.projectId === body.projectId && (conversation.assistantKind === null || conversation.assistantKind === 'kanban') && turnOwned && await db.tasks.getBoard(userId, body.projectId))
  }
  const revision = (tasks: Task[]): string => String(Math.max(0, ...tasks.map((task) => task.updatedAt)))

  app.post<{ Body: WidgetToolQueryRequest }>('/api/widget-tools/describe', async (req, reply) => {
    if (!await widgetScope(uid(req), req.body)) return nf(reply)
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
    if (!await widgetScope(userId, req.body)) return nf(reply)
    if (req.body.ui?.items.length) {
      return { source: 'ui', revision: req.body.ui.revision, items: queryWidgetItems(req.body.ui.items, req.body.text, req.body.kinds, req.body.limit) }
    }
    const board = (await db.tasks.getBoard(userId, req.body.projectId))!
    return { source: 'api', revision: revision(board.tasks), items: queryWidgetItems(board.tasks.map(taskWidgetItem), req.body.text, req.body.kinds, req.body.limit) }
  })

  app.post<{ Body: WidgetToolGetRequest }>('/api/widget-tools/get', async (req, reply) => {
    if (!await widgetScope(uid(req), req.body)) return nf(reply)
    const board = (await db.tasks.getBoard(uid(req), req.body.projectId))!
    const task = board.tasks.find((item) => item.id === req.body.itemId)
    return task ? { revision: revision(board.tasks), item: taskWidgetItem(task) } : nf(reply)
  })

  app.post<{ Body: WidgetToolActionRequest }>('/api/widget-tools/action', async (req, reply) => {
    const body = req.body
    const userId = uid(req)
    if (!await widgetScope(userId, body)) return nf(reply)
    if (!body.confirmation?.confirmed || body.confirmation.proposalId !== body.turnId || !body.idempotencyKey) return badReq(reply, 'confirmation for current turn and idempotencyKey required')
    const idemKey = [userId, body.projectId, body.conversationId, body.idempotencyKey].join(':')
    const replay = widgetIdempotency.get(idemKey)
    if (replay) return { ...(replay as object), replayed: true }
    const action = body.action
    try {
      let item: Task
      if (action.name === 'kanban.task.create') {
        const created = await db.tasks.createTask(userId, body.projectId, action.input)
        if (!created) return nf(reply)
        item = created
      } else if (action.name === 'kanban.task.update') {
        const board = (await db.tasks.getBoard(userId, body.projectId))!
        const current = board.tasks.find((task) => task.id === action.taskId)
        if (!current) return nf(reply)
        if (String(current.updatedAt) !== action.expectedVersion) return reply.code(409).send({ error: 'stale item version' })
        const patch = { ...action.patch }
        const columnId = patch.columnId
        delete patch.columnId
        if (columnId && columnId !== current.columnId && !await db.tasks.moveTask(userId, body.projectId, current.id, { columnId, afterId: null, beforeId: null })) return badReq(reply, 'invalid column')
        if (Object.keys(patch).length && !await db.tasks.updateTask(userId, body.projectId, current.id, patch)) return nf(reply)
        item = (await db.tasks.getBoard(userId, body.projectId))!.tasks.find((task) => task.id === current.id)!
      } else return badReq(reply, 'unsupported action')
      boardHub.emit(body.projectId)
      const nextBoard = (await db.tasks.getBoard(userId, body.projectId))!
      const result = { applied: true, replayed: false, revision: revision(nextBoard.tasks), item: taskWidgetItem(item) }
      widgetIdempotency.set(idemKey, result)
      req.log.info({ event: 'widget.action', userId, projectId: body.projectId, conversationId: body.conversationId, widgetInstanceId: body.widgetInstanceId, proposalId: body.confirmation.proposalId, idempotencyKey: body.idempotencyKey, action: action.name, taskId: item.id }, 'widget action applied')
      return result
    } catch (error) {
      return badReq(reply, error instanceof Error ? error.message : 'invalid action')
    }
  })

}

