// REST CI-раннера: справочник команд, глобальные настройки, слот-конфиг проекта/
// задачи, запуск/отмена/повтор ранов, деталь+лог, метрики, предложения, отчёт по месту.
// Права: правки команд/настроек проекта — владелец проекта (CI-админ); глобальные
// команды и глобальные настройки — глобальный admin; запуск — любой участник проекта.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { CiCommandInput, CiGlobalSettings, CiLlmConfig, CiSlot, CiRunMode, CiPlanDecision, CiUsageKind, CiStageLlmSelection, CiTaskMachines } from '@voicechat/shared'
import { CI_USAGE_KINDS } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import type { CiRunManager } from '../ci/runManager.js'
import { requireProjectPermission, uid } from '../users/auth.js'

const nf = (reply: FastifyReply): FastifyReply => reply.code(404).send({ error: 'not found' })
const forbid = (reply: FastifyReply): FastifyReply => reply.code(403).send({ error: 'forbidden' })
const bad = (reply: FastifyReply, error: unknown): FastifyReply => reply.code(400).send({ error: error instanceof Error ? error.message : String(error) })

export function registerCiRoutes(
  app: FastifyInstance, db: VoiceChatDb, ci: CiRunManager, agents?: { isOnline(id: string): boolean }, boardChanged?: (projectId: string) => void,
  /** Запуск подготовки задачи (server.ts `launchTaskPreparation`): нужен кнопке «Создать и подготовить» очереди улучшений. */
  startPreparation?: (userId: string, projectId: string, taskId: string) => unknown,
  /** Адресная инвалидация очереди «Улучшения»: панель перечитывает список только по ней. */
  improvementsChanged?: (projectId: string) => void
): void {
  const isOwner = (req: FastifyRequest, projectId: string): boolean => db.projects.getProject(uid(req), projectId)?.role === 'owner'
  const isAdmin = (req: FastifyRequest): boolean => req.user?.role === 'admin'
  const workflowGuard = { preHandler: requireProjectPermission('workflow:start') }

  // --- Справочник команд ---
  app.get<{ Querystring: { projectId?: string } }>('/api/ci/commands', async (req) => db.ci.listCiCommands(uid(req), req.query.projectId))

  app.get<{ Params: { id: string } }>('/api/ci/commands/:id', async (req, reply) => db.ci.getCiCommand(uid(req), req.params.id) ?? nf(reply))

  app.post<{ Body: CiCommandInput }>('/api/ci/commands', async (req, reply) => {
    const body = req.body ?? {}
    const scope = body.scope === 'global' ? 'global' : 'project'
    if (scope === 'global' && !isAdmin(req)) return forbid(reply)
    if (scope === 'project') {
      if (!body.projectId || !isOwner(req, body.projectId)) return forbid(reply)
    }
    try {
      return db.ci.createCiCommand(uid(req), body)
    } catch (e) {
      return bad(reply, e)
    }
  })

  app.patch<{ Params: { id: string }; Body: CiCommandInput }>('/api/ci/commands/:id', async (req, reply) => {
    const cur = db.ci.getCiCommand(uid(req), req.params.id)
    if (!cur) return nf(reply)
    if (cur.scope === 'global' ? !isAdmin(req) : !isOwner(req, cur.projectId!)) return forbid(reply)
    try {
      return db.ci.updateCiCommand(uid(req), req.params.id, req.body ?? {}) ?? nf(reply)
    } catch (e) {
      return bad(reply, e)
    }
  })

  app.delete<{ Params: { id: string } }>('/api/ci/commands/:id', async (req, reply) => {
    const cur = db.ci.getCiCommand(uid(req), req.params.id)
    if (!cur) return nf(reply)
    if (cur.scope === 'global' ? !isAdmin(req) : !isOwner(req, cur.projectId!)) return forbid(reply)
    return { ok: db.ci.softDeleteCiCommand(uid(req), req.params.id) }
  })

  app.get<{ Params: { id: string } }>('/api/ci/commands/:id/usage', async (req, reply) => {
    if (!db.ci.getCiCommand(uid(req), req.params.id)) return nf(reply)
    return db.ci.ciCommandUsage(req.params.id)
  })

  // --- Глобальные настройки CI (чтение — любой; правка — глобальный admin) ---
  app.get('/api/ci/settings', async () => db.ci.getCiSettings())
  app.put('/api/ci/settings', async (req, reply) => {
    if (!isAdmin(req)) return forbid(reply)
    // Настройка стадий приходит объектом и чистится в `updateCiSettings`
    // (`normCiStageModels`): чужие ключи и не-строки в БД не попадают.
    return db.ci.updateCiSettings((req.body ?? {}) as Partial<CiGlobalSettings>)
  })

  // --- Слот-конфиг проекта (дефолты) ---
  app.get<{ Params: { id: string } }>('/api/projects/:id/ci', async (req, reply) => {
    if (!db.projects.getProject(uid(req), req.params.id)) return nf(reply)
    return db.ci.getCiSlotConfig('project', req.params.id)
  })
  app.put<{ Params: { id: string }; Body: { beforeModel?: string[]; afterModel?: string[] } }>('/api/projects/:id/ci', async (req, reply) => {
    if (!isOwner(req, req.params.id)) return forbid(reply)
    const b = req.body ?? {}
    if (b.beforeModel) db.ci.setCiSlotCommands('project', req.params.id, 'before_model', b.beforeModel)
    if (b.afterModel) db.ci.setCiSlotCommands('project', req.params.id, 'after_model', b.afterModel)
    return db.ci.getCiSlotConfig('project', req.params.id)
  })

  // --- Движок/модель проекта и задачи (с наследованием) ---
  const projectLlmView = (userId: string, projectId: string) => {
    const inherited = db.ci.ciLlmDefaultsForUser(userId)
    const own = db.ci.getCiLlmConfig('project', projectId)
    return { config: own ?? inherited, inherited, overridden: own !== null }
  }
  app.get<{ Params: { id: string } }>('/api/projects/:id/ci/llm', async (req, reply) => {
    if (!db.projects.getProject(uid(req), req.params.id)) return nf(reply)
    return projectLlmView(uid(req), req.params.id)
  })
  app.put<{ Params: { id: string }; Body: CiLlmConfig }>('/api/projects/:id/ci/llm', async (req, reply) => {
    if (!isOwner(req, req.params.id)) return forbid(reply)
    db.ci.setCiLlmConfig('project', req.params.id, req.body)
    return projectLlmView(uid(req), req.params.id)
  })
  app.delete<{ Params: { id: string } }>('/api/projects/:id/ci/llm', async (req, reply) => {
    if (!isOwner(req, req.params.id)) return forbid(reply)
    db.ci.clearCiLlmConfig('project', req.params.id)
    return projectLlmView(uid(req), req.params.id)
  })
  const taskLlmView = (userId: string, projectId: string, taskId: string): { config: CiLlmConfig; overridden: boolean; projectDefault: CiLlmConfig } => ({
    config: db.ci.resolveTaskLlmConfig(projectId, taskId, userId),
    overridden: db.ci.getCiLlmConfig('task', taskId) !== null,
    projectDefault: db.ci.getCiLlmConfig('project', projectId) ?? db.ci.ciLlmDefaultsForUser(userId)
  })
  app.get<{ Params: { id: string; taskId: string } }>('/api/projects/:id/tasks/:taskId/ci/llm', async (req, reply) => {
    if (!db.tasks.getCiTask(uid(req), req.params.id, req.params.taskId)) return nf(reply)
    return taskLlmView(uid(req), req.params.id, req.params.taskId)
  })
  app.put<{ Params: { id: string; taskId: string }; Body: CiLlmConfig }>('/api/projects/:id/tasks/:taskId/ci/llm', async (req, reply) => {
    if (!db.tasks.getCiTask(uid(req), req.params.id, req.params.taskId)) return nf(reply)
    return db.ci.setCiLlmConfig('task', req.params.taskId, req.body)
  })
  // Снять переопределение: задача снова наследует движок/модель проекта.
  app.delete<{ Params: { id: string; taskId: string } }>('/api/projects/:id/tasks/:taskId/ci/llm', async (req, reply) => {
    if (!db.tasks.getCiTask(uid(req), req.params.id, req.params.taskId)) return nf(reply)
    db.ci.clearCiLlmConfig('task', req.params.taskId)
    return taskLlmView(uid(req), req.params.id, req.params.taskId)
  })

  // --- Выбор LLM по самостоятельным этапам workflow ---
  const validStage = (value: string): value is CiUsageKind => CI_USAGE_KINDS.includes(value as CiUsageKind)
  const userStageFallback = (userId: string) => {
    const llm = db.ci.ciLlmDefaultsForUser(userId)
    return { llmEngineId: llm.llmEngineId ?? null, provider: llm.provider, model: llm.model }
  }

  app.get<{ Params: { id: string; stage: string } }>('/api/projects/:id/ci/stages/:stage/llm', async (req, reply) => {
    if (!db.projects.getProject(uid(req), req.params.id)) return nf(reply)
    if (!validStage(req.params.stage)) return bad(reply, 'Неизвестный этап workflow')
    return {
      override: db.ci.getCiStageLlmConfig('project', req.params.id, req.params.stage),
      effective: db.ci.resolveTaskStageLlmConfig(req.params.id, '', req.params.stage, userStageFallback(uid(req)))
    }
  })
  app.put<{ Params: { id: string; stage: string }; Body: CiStageLlmSelection }>('/api/projects/:id/ci/stages/:stage/llm', async (req, reply) => {
    if (!isOwner(req, req.params.id)) return forbid(reply)
    if (!validStage(req.params.stage)) return bad(reply, 'Неизвестный этап workflow')
    return db.ci.setCiStageLlmConfig('project', req.params.id, req.params.stage, req.body ?? {})
  })
  app.delete<{ Params: { id: string; stage: string } }>('/api/projects/:id/ci/stages/:stage/llm', async (req, reply) => {
    if (!isOwner(req, req.params.id)) return forbid(reply)
    if (!validStage(req.params.stage)) return bad(reply, 'Неизвестный этап workflow')
    db.ci.clearCiStageLlmConfig('project', req.params.id, req.params.stage)
    return { effective: db.ci.resolveTaskStageLlmConfig(req.params.id, '', req.params.stage, userStageFallback(uid(req))) }
  })

  app.get<{ Params: { id: string; taskId: string; stage: string } }>('/api/projects/:id/tasks/:taskId/ci/stages/:stage/llm', async (req, reply) => {
    if (!db.tasks.getCiTask(uid(req), req.params.id, req.params.taskId)) return nf(reply)
    if (!validStage(req.params.stage)) return bad(reply, 'Неизвестный этап workflow')
    return {
      override: db.ci.getCiStageLlmConfig('task', req.params.taskId, req.params.stage),
      projectDefault: db.ci.getCiStageLlmConfig('project', req.params.id, req.params.stage),
      effective: db.ci.resolveTaskStageLlmConfig(req.params.id, req.params.taskId, req.params.stage, userStageFallback(uid(req)))
    }
  })
  app.put<{ Params: { id: string; taskId: string; stage: string }; Body: CiStageLlmSelection }>('/api/projects/:id/tasks/:taskId/ci/stages/:stage/llm', async (req, reply) => {
    if (!isOwner(req, req.params.id)) return forbid(reply)
    if (!db.tasks.getCiTask(uid(req), req.params.id, req.params.taskId)) return nf(reply)
    if (!validStage(req.params.stage)) return bad(reply, 'Неизвестный этап workflow')
    db.ci.setCiStageLlmConfig('task', req.params.taskId, req.params.stage, req.body ?? {})
    return { effective: db.ci.resolveTaskStageLlmConfig(req.params.id, req.params.taskId, req.params.stage, userStageFallback(uid(req))) }
  })
  app.delete<{ Params: { id: string; taskId: string; stage: string } }>('/api/projects/:id/tasks/:taskId/ci/stages/:stage/llm', async (req, reply) => {
    if (!isOwner(req, req.params.id)) return forbid(reply)
    if (!validStage(req.params.stage)) return bad(reply, 'Неизвестный этап workflow')
    db.ci.clearCiStageLlmConfig('task', req.params.taskId, req.params.stage)
    return { effective: db.ci.resolveTaskStageLlmConfig(req.params.id, req.params.taskId, req.params.stage, userStageFallback(uid(req))) }
  })

  // --- Машины выполнения задачи: личные + проектные, без дублей ---
  app.get<{ Params: { id: string; taskId: string } }>('/api/projects/:id/tasks/:taskId/ci/machines', async (req, reply): Promise<CiTaskMachines | FastifyReply> => {
    const userId = uid(req)
    const project = db.projects.getProject(userId, req.params.id)
    const task = db.tasks.getCiTask(userId, req.params.id, req.params.taskId)
    if (!project || !task) return nf(reply)
    const personalIds = new Set(db.machines.listAgents(userId).map((agent) => agent.id))
    const usable = db.machines.listUsableAgents(userId, project.id)
    const myDefault = db.machines.getUserProjectDefaultMachine(userId, project.id)
    const load = db.ci.countActiveCiRunsByAgent()
    const machines = usable.map((agent) => {
      const personal = personalIds.has(agent.id)
      const shared = db.machines.isMachineSharedWithProject(project.id, agent.id)
      const online = agents?.isOnline(agent.id) ?? false
      return {
        agentId: agent.id,
        name: agent.name,
        owner: agent.userId ?? 'неизвестно',
        ownership: personal ? 'mine' as const : 'other' as const,
        online,
        sharedWithProject: shared,
        isMyDefault: myDefault === agent.id,
        canUse: online,
        unavailableReason: online ? null : 'offline' as const,
        load: load[agent.id] ?? 0,
        personal,
        project: shared,
        projectDefault: project.defaultAgentId === agent.id
      }
    })
    const selectedAvailable = task.agentId == null || machines.some((machine) => machine.agentId === task.agentId)
    const effectiveAgentId = task.agentId ?? project.defaultAgentId ?? null
    const effectiveMachine = effectiveAgentId ? machines.find((machine) => machine.agentId === effectiveAgentId) : undefined
    return {
      machines,
      selectedAgentId: task.agentId ?? null,
      unavailableSelection: selectedAvailable || !task.agentId ? null : { agentId: task.agentId, name: db.machines.agentName(task.agentId) ?? null },
      inheritanceSource: task.agentId ? 'explicit' : 'project_default',
      effectiveAgentId,
      effectiveMachineName: effectiveMachine?.name ?? (effectiveAgentId ? db.machines.agentName(effectiveAgentId) ?? null : null)
    }
  })

  // --- Слот-конфиг задачи (переопределение + метка наследования) ---
  app.get<{ Params: { id: string; taskId: string } }>('/api/projects/:id/tasks/:taskId/ci', async (req, reply) => {
    if (!db.tasks.getCiTask(uid(req), req.params.id, req.params.taskId)) return nf(reply)
    return {
      config: db.ci.resolveTaskSlots(req.params.id, req.params.taskId),
      overridden: db.ci.hasCiSlotConfig('task', req.params.taskId),
      projectDefault: db.ci.getCiSlotConfig('project', req.params.id),
      enabledStages: db.ci.getTaskProcessStages(req.params.taskId),
      browserCheck: db.ci.getTaskBrowserCheck(req.params.taskId)
    }
  })
  app.put<{ Params: { id: string; taskId: string }; Body: { beforeModel?: string[]; afterModel?: string[]; enabledStages?: unknown; browserCheck?: unknown } }>('/api/projects/:id/tasks/:taskId/ci', async (req, reply) => {
    if (!db.tasks.getCiTask(uid(req), req.params.id, req.params.taskId)) return nf(reply)
    const b = req.body ?? {}
    const slots: Array<[CiSlot, string[] | undefined]> = [['before_model', b.beforeModel], ['after_model', b.afterModel]]
    for (const [slot, ids] of slots) if (ids) db.ci.setCiSlotCommands('task', req.params.taskId, slot, ids)
    const enabledStages = b.enabledStages === undefined ? db.ci.getTaskProcessStages(req.params.taskId) : db.ci.setTaskProcessStages(req.params.taskId, b.enabledStages)
    const browserCheck = b.browserCheck === undefined ? db.ci.getTaskBrowserCheck(req.params.taskId) : db.ci.setTaskBrowserCheck(req.params.taskId, b.browserCheck)
    return { ...db.ci.resolveTaskSlots(req.params.id, req.params.taskId), enabledStages, browserCheck }
  })

  // --- Запуск / отмена / повтор рана ---
  app.post<{ Params: { id: string; taskId: string }; Body: { mode?: CiRunMode; provider?: string; model?: string; launch?: string; agentId?: string } | undefined }>('/api/projects/:id/tasks/:taskId/ci/run', workflowGuard, async (req, reply) => {
    const mode = req.body?.mode === 'plan' || req.body?.mode === 'development' ? req.body.mode : undefined
    const provider = req.body?.provider === 'claude' || req.body?.provider === 'codex' ? req.body.provider : undefined
    const model = provider && typeof req.body?.model === 'string' ? req.body.model : undefined
    const launch = req.body?.launch === 'parallel' ? 'parallel' : undefined
    const agentId = typeof req.body?.agentId === 'string' && req.body.agentId.trim() ? req.body.agentId.trim() : undefined
    const res = ci.start(uid(req), req.params.id, req.params.taskId, { mode, provider, model, launch, agentId })
    if ('error' in res) return reply.code(409).send({ error: res.error })
    return reply.code(202).send(res.run)
  })
  // Принудительный запуск на явно указанной машине (из настроек задачи):
  // ран из очереди продвигается мимо неё, а не отменяется.
  app.post<{ Params: { id: string; taskId: string }; Body: { agentId?: string } | undefined }>('/api/projects/:id/tasks/:taskId/ci/run-on-machine', workflowGuard, async (req, reply) => {
    const agentId = typeof req.body?.agentId === 'string' ? req.body.agentId.trim() : ''
    if (!agentId) return reply.code(400).send({ error: 'Не указана машина запуска' })
    const res = ci.forceStartOnMachine(uid(req), req.params.id, req.params.taskId, agentId)
    if ('error' in res) return reply.code(409).send({ error: res.error })
    return reply.code(202).send(res.run)
  })
  // Ответ на паузу рана: уточняющий вопрос модели или решение по плану.
  // Ответить можно и отсюда (лента), и из связанного чата — первый победил.
  app.post<{ Params: { runId: string; interactionId: string }; Body: { text?: string; decision?: CiPlanDecision } | undefined }>(
    '/api/ci/runs/:runId/interactions/:interactionId',
    async (req, reply) => {
      const body = req.body ?? {}
      const decision = body.decision === 'approved' || body.decision === 'rework' ? body.decision : undefined
      const res = ci.answerInteraction(uid(req), req.params.runId, req.params.interactionId, { text: body.text, decision })
      if ('error' in res) return reply.code(409).send({ error: res.error })
      return res.interaction
    }
  )
  app.get<{ Params: { runId: string } }>('/api/ci/runs/:runId', async (req, reply) => db.ci.getCiRun(uid(req), req.params.runId) ?? nf(reply))
  app.get<{ Params: { runId: string }; Querystring: { limit?: string } }>('/api/ci/runs/:runId/log', async (req, reply) => {
    if (!db.ci.getCiRun(uid(req), req.params.runId)) return nf(reply)
    // Полный лог длинного рана не помещается в память процесса, поэтому отдаём
    // хвост; `limit` позволяет попросить больше в пределах серверного потолка.
    return db.ci.getCiRunLog(uid(req), req.params.runId, Number(req.query.limit) || undefined)
  })
  // Использование базы знаний моделью: по одному рану (лента) и по всем ранам
  // задачи (модалка). Гейт — членство в проекте: чужому 404, а не пустой отчёт.
  app.get<{ Params: { runId: string }; Querystring: { limit?: string } }>('/api/ci/runs/:runId/kb-usage', async (req, reply) => {
    const report = db.kb.kbUsageRunReport(uid(req), req.params.runId, Number(req.query.limit) || undefined)
    return report ?? nf(reply)
  })
  app.get<{ Params: { id: string; taskId: string }; Querystring: { limit?: string } }>(
    '/api/projects/:id/tasks/:taskId/kb-usage',
    async (req, reply) => {
      const report = db.kb.kbUsageTaskReport(uid(req), req.params.id, req.params.taskId, Number(req.query.limit) || undefined)
      return report ?? nf(reply)
    }
  )

  // Отчёт по расходу модели: один ран (лента) и все раны задачи (карточка).
  // Гейт тот же, что у kb-usage: чужому 404, а не пустой отчёт.
  app.get<{ Params: { runId: string } }>('/api/ci/runs/:runId/report', async (req, reply) =>
    db.ci.ciRunReport(uid(req), req.params.runId) ?? nf(reply)
  )
  app.get<{ Params: { id: string; taskId: string } }>('/api/projects/:id/tasks/:taskId/report', async (req, reply) =>
    db.ci.ciTaskReport(uid(req), req.params.id, req.params.taskId) ?? nf(reply)
  )
  app.get<{ Params: { id: string; taskId: string } }>('/api/projects/:id/tasks/:taskId/timeline', async (req, reply) =>
    db.tasks.taskTimeline(uid(req), req.params.id, req.params.taskId) ?? nf(reply)
  )
  app.get<{ Params: { id: string; taskId: string } }>('/api/projects/:id/tasks/:taskId/improvements', async (req) =>
    db.tasks.listTaskImprovements(uid(req), req.params.id, req.params.taskId)
  )
  app.get<{ Params: { id: string } }>('/api/projects/:id/improvements/tasks', async (req) =>
    db.tasks.listProjectImprovementTaskIds(uid(req), req.params.id)
  )
  app.get<{ Params: { id: string } }>('/api/projects/:id/improvements', async (req) =>
    db.tasks.listProjectImprovements(uid(req), req.params.id)
  )
  app.delete<{ Params: { id: string } }>('/api/improvements/:id', async (req, reply) => {
    const projectId = db.tasks.improvementProjectId(req.params.id)
    if (!db.tasks.deleteTaskImprovement(uid(req), req.params.id)) return nf(reply)
    if (projectId) { boardChanged?.(projectId); improvementsChanged?.(projectId) }
    return { ok: true }
  })
  app.patch<{ Params: { id: string }; Body: { status?: string } }>('/api/improvements/:id', async (req, reply) => {
    const status = req.body?.status
    if (status !== 'new' && status !== 'accepted' && status !== 'rejected' && status !== 'implemented') return reply.code(400).send({ error: 'Некорректный статус предложения' })
    try {
      const projectId = db.tasks.improvementProjectId(req.params.id)
      const updated = db.tasks.updateTaskImprovementStatus(uid(req), req.params.id, status)
      if (updated && projectId) improvementsChanged?.(projectId)
      return updated ?? nf(reply)
    }
    catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) }) }
  })
  app.post<{ Params: { id: string }; Body: import('@voicechat/shared').CreateTaskFromImprovementInput | undefined }>('/api/improvements/:id/create-task', async (req, reply) => {
    const body = req.body ?? {}
    // Все поля необязательны (значения берутся из предложения), но переданные должны быть строками.
    for (const key of ['columnId', 'title', 'description', 'acceptanceCriteria'] as const) {
      if (body[key] !== undefined && typeof body[key] !== 'string') return reply.code(400).send({ error: `${key} must be a string` })
    }
    if (body.title !== undefined && !body.title.trim()) return reply.code(400).send({ error: 'title must not be empty' })
    let created: NonNullable<ReturnType<VoiceChatDb['tasks']['createTaskFromImprovement']>>
    try {
      const result = db.tasks.createTaskFromImprovement(uid(req), req.params.id, body)
      if (!result) return nf(reply)
      created = result
    }
    catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) }) }
    // Подготовка — отдельный шаг после успешного создания: её отказ (нет машины,
    // модель недоступна) не должен откатывать уже созданную задачу.
    let preparationStarted = false
    let preparationError: string | null = null
    if (body.startPreparation && created.created) {
      if (!startPreparation) preparationError = 'Запуск подготовки недоступен на этом сервере'
      else {
        try { await startPreparation(uid(req), created.task.projectId, created.task.id); preparationStarted = true }
        catch (error) { preparationError = error instanceof Error ? error.message : String(error) }
      }
    }
    boardChanged?.(created.task.projectId)
    // Предложение стало задачей — карточка уходит из очереди улучшений.
    improvementsChanged?.(created.task.projectId)
    const task = db.tasks.getCiTask(uid(req), created.task.projectId, created.task.id) ?? created.task
    return { ...created, task, preparationStarted, preparationError }
  })

  app.post<{ Params: { runId: string } }>('/api/ci/runs/:runId/cancel', async (req, _reply) => ({ ok: ci.cancel(uid(req), req.params.runId) }))
  app.post<{ Params: { runId: string } }>('/api/ci/runs/:runId/dequeue', async (req, reply) => {
    const result = ci.dequeue(uid(req), req.params.runId)
    if (result.status === 'not_found') return nf(reply)
    return result
  })
  app.post<{ Params: { runId: string } }>('/api/ci/runs/:runId/retry', workflowGuard, async (req, reply) => {
    const detail = db.ci.getCiRun(uid(req), req.params.runId)
    if (!detail) return nf(reply)
    const res = ci.start(uid(req), detail.run.projectId, detail.run.taskId)
    if ('error' in res) return reply.code(409).send({ error: res.error })
    return reply.code(202).send(res.run)
  })
  app.post<{ Params: { runId: string }; Body: { provider?: 'claude' | 'codex'; model?: string; llmEngineId?: string | null } }>('/api/ci/runs/:runId/retry-from-step', workflowGuard, async (req, reply) => {
    const selection = req.body?.provider && req.body.model !== undefined ? { provider: req.body.provider, model: req.body.model, llmEngineId: req.body.llmEngineId ?? null } : undefined
    const res = ci.retryFromFailed(uid(req), req.params.runId, selection)
    if ('error' in res) return reply.code(409).send({ error: res.error })
    return reply.code(202).send(res.run)
  })

  app.post<{ Params: { runId: string } }>('/api/ci/runs/:runId/discard-and-retry', workflowGuard, async (req, reply) => {
    const res = await ci.discardChangesAndRetry(uid(req), req.params.runId)
    if ('error' in res) return reply.code(409).send({ error: res.error })
    return reply.code(202).send(res.run)
  })

  // --- Метрики ---
  app.get<{ Params: { id: string } }>('/api/projects/:id/ci/metrics', async (req, reply) => {
    if (!db.projects.getProject(uid(req), req.params.id)) return nf(reply)
    return { commands: db.ci.ciCommandMetrics(uid(req), req.params.id), modelWork: db.ci.ciModelWorkMetric(uid(req), req.params.id) }
  })

  // --- Предложения модели по правке команд ---
  app.get<{ Querystring: { projectId?: string } }>('/api/ci/suggestions', async (req) => db.ci.listCiSuggestions(uid(req), req.query.projectId))
  app.post<{ Params: { id: string }; Body: { accept?: boolean } }>('/api/ci/suggestions/:id', async (req, reply) => {
    // Принять/отклонить может владелец проекта команды (или глобальный admin для global).
    const res = db.ci.resolveCiSuggestion(uid(req), req.params.id, req.body?.accept === true)
    return res ?? nf(reply)
  })

  // --- Диагностическая консоль рана (US-6) ---
  app.post<{ Params: { runId: string }; Body: { command?: string; editMode?: boolean } }>('/api/ci/runs/:runId/console', async (req, reply) => {
    const command = (req.body?.command ?? '').trim()
    if (!command) return bad(reply, new Error('Пустая команда'))
    return ci.consoleExec(uid(req), req.params.runId, command, req.body?.editMode === true)
  })

  // --- Отчёт по занятому месту ---
  app.get<{ Querystring: { projectId?: string } }>('/api/ci/workspaces', async (req) => db.ci.listCiWorkspaceReport(uid(req), req.query.projectId))
}
