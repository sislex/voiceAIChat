// REST CI-раннера: справочник команд, глобальные настройки, слот-конфиг проекта/
// задачи, запуск/отмена/повтор ранов, деталь+лог, метрики, предложения, отчёт по месту.
// Права: правки команд/настроек проекта — владелец проекта (CI-админ); глобальные
// команды и глобальные настройки — глобальный admin; запуск — любой участник проекта.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { CiCommandInput, CiSlot } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import type { CiRunManager } from '../ci/runManager.js'
import { uid } from '../users/auth.js'

const nf = (reply: FastifyReply): FastifyReply => reply.code(404).send({ error: 'not found' })
const forbid = (reply: FastifyReply): FastifyReply => reply.code(403).send({ error: 'forbidden' })
const bad = (reply: FastifyReply, error: unknown): FastifyReply => reply.code(400).send({ error: error instanceof Error ? error.message : String(error) })

export function registerCiRoutes(app: FastifyInstance, db: VoiceChatDb, ci: CiRunManager): void {
  const isOwner = (req: FastifyRequest, projectId: string): boolean => db.getProject(uid(req), projectId)?.role === 'owner'
  const isAdmin = (req: FastifyRequest): boolean => req.user?.role === 'admin'

  // --- Справочник команд ---
  app.get<{ Querystring: { projectId?: string } }>('/api/ci/commands', async (req) => db.listCiCommands(uid(req), req.query.projectId))

  app.get<{ Params: { id: string } }>('/api/ci/commands/:id', async (req, reply) => db.getCiCommand(uid(req), req.params.id) ?? nf(reply))

  app.post<{ Body: CiCommandInput }>('/api/ci/commands', async (req, reply) => {
    const body = req.body ?? {}
    const scope = body.scope === 'global' ? 'global' : 'project'
    if (scope === 'global' && !isAdmin(req)) return forbid(reply)
    if (scope === 'project') {
      if (!body.projectId || !isOwner(req, body.projectId)) return forbid(reply)
    }
    try {
      return db.createCiCommand(uid(req), body)
    } catch (e) {
      return bad(reply, e)
    }
  })

  app.patch<{ Params: { id: string }; Body: CiCommandInput }>('/api/ci/commands/:id', async (req, reply) => {
    const cur = db.getCiCommand(uid(req), req.params.id)
    if (!cur) return nf(reply)
    if (cur.scope === 'global' ? !isAdmin(req) : !isOwner(req, cur.projectId!)) return forbid(reply)
    try {
      return db.updateCiCommand(uid(req), req.params.id, req.body ?? {}) ?? nf(reply)
    } catch (e) {
      return bad(reply, e)
    }
  })

  app.delete<{ Params: { id: string } }>('/api/ci/commands/:id', async (req, reply) => {
    const cur = db.getCiCommand(uid(req), req.params.id)
    if (!cur) return nf(reply)
    if (cur.scope === 'global' ? !isAdmin(req) : !isOwner(req, cur.projectId!)) return forbid(reply)
    return { ok: db.softDeleteCiCommand(uid(req), req.params.id) }
  })

  app.get<{ Params: { id: string } }>('/api/ci/commands/:id/usage', async (req, reply) => {
    if (!db.getCiCommand(uid(req), req.params.id)) return nf(reply)
    return db.ciCommandUsage(req.params.id)
  })

  // --- Глобальные настройки CI (чтение — любой; правка — глобальный admin) ---
  app.get('/api/ci/settings', async () => db.getCiSettings())
  app.put('/api/ci/settings', async (req, reply) => {
    if (!isAdmin(req)) return forbid(reply)
    return db.updateCiSettings((req.body ?? {}) as Record<string, number>)
  })

  // --- Слот-конфиг проекта (дефолты) ---
  app.get<{ Params: { id: string } }>('/api/projects/:id/ci', async (req, reply) => {
    if (!db.getProject(uid(req), req.params.id)) return nf(reply)
    return db.getCiSlotConfig('project', req.params.id)
  })
  app.put<{ Params: { id: string }; Body: { beforeModel?: string[]; afterModel?: string[] } }>('/api/projects/:id/ci', async (req, reply) => {
    if (!isOwner(req, req.params.id)) return forbid(reply)
    const b = req.body ?? {}
    if (b.beforeModel) db.setCiSlotCommands('project', req.params.id, 'before_model', b.beforeModel)
    if (b.afterModel) db.setCiSlotCommands('project', req.params.id, 'after_model', b.afterModel)
    return db.getCiSlotConfig('project', req.params.id)
  })

  // --- Слот-конфиг задачи (переопределение + метка наследования) ---
  app.get<{ Params: { id: string; taskId: string } }>('/api/projects/:id/tasks/:taskId/ci', async (req, reply) => {
    if (!db.getCiTask(uid(req), req.params.id, req.params.taskId)) return nf(reply)
    return {
      config: db.resolveTaskSlots(req.params.id, req.params.taskId),
      overridden: db.hasCiSlotConfig('task', req.params.taskId),
      projectDefault: db.getCiSlotConfig('project', req.params.id)
    }
  })
  app.put<{ Params: { id: string; taskId: string }; Body: { beforeModel?: string[]; afterModel?: string[] } }>('/api/projects/:id/tasks/:taskId/ci', async (req, reply) => {
    if (!db.getCiTask(uid(req), req.params.id, req.params.taskId)) return nf(reply)
    const b = req.body ?? {}
    const slots: Array<[CiSlot, string[] | undefined]> = [['before_model', b.beforeModel], ['after_model', b.afterModel]]
    for (const [slot, ids] of slots) if (ids) db.setCiSlotCommands('task', req.params.taskId, slot, ids)
    return db.resolveTaskSlots(req.params.id, req.params.taskId)
  })

  // --- Запуск / отмена / повтор рана ---
  app.post<{ Params: { id: string; taskId: string } }>('/api/projects/:id/tasks/:taskId/ci/run', async (req, reply) => {
    const res = ci.start(uid(req), req.params.id, req.params.taskId)
    if ('error' in res) return reply.code(409).send({ error: res.error })
    return reply.code(202).send(res.run)
  })
  app.get<{ Params: { runId: string } }>('/api/ci/runs/:runId', async (req, reply) => db.getCiRun(uid(req), req.params.runId) ?? nf(reply))
  app.get<{ Params: { runId: string } }>('/api/ci/runs/:runId/log', async (req, reply) => {
    if (!db.getCiRun(uid(req), req.params.runId)) return nf(reply)
    return db.getCiRunLog(uid(req), req.params.runId)
  })
  app.post<{ Params: { runId: string } }>('/api/ci/runs/:runId/cancel', async (req, reply) => ({ ok: ci.cancel(uid(req), req.params.runId) }))
  app.post<{ Params: { runId: string } }>('/api/ci/runs/:runId/retry', async (req, reply) => {
    const detail = db.getCiRun(uid(req), req.params.runId)
    if (!detail) return nf(reply)
    const res = ci.start(uid(req), detail.run.projectId, detail.run.taskId)
    if ('error' in res) return reply.code(409).send({ error: res.error })
    return reply.code(202).send(res.run)
  })
  app.post<{ Params: { runId: string } }>('/api/ci/runs/:runId/retry-from-step', async (req, reply) => {
    const res = ci.retryFromFailed(uid(req), req.params.runId)
    if ('error' in res) return reply.code(409).send({ error: res.error })
    return reply.code(202).send(res.run)
  })

  // --- Метрики ---
  app.get<{ Params: { id: string } }>('/api/projects/:id/ci/metrics', async (req, reply) => {
    if (!db.getProject(uid(req), req.params.id)) return nf(reply)
    return { commands: db.ciCommandMetrics(uid(req), req.params.id), modelWork: db.ciModelWorkMetric(uid(req), req.params.id) }
  })

  // --- Предложения модели по правке команд ---
  app.get<{ Querystring: { projectId?: string } }>('/api/ci/suggestions', async (req) => db.listCiSuggestions(uid(req), req.query.projectId))
  app.post<{ Params: { id: string }; Body: { accept?: boolean } }>('/api/ci/suggestions/:id', async (req, reply) => {
    // Принять/отклонить может владелец проекта команды (или глобальный admin для global).
    const res = db.resolveCiSuggestion(uid(req), req.params.id, req.body?.accept === true)
    return res ?? nf(reply)
  })

  // --- Диагностическая консоль рана (US-6) ---
  app.post<{ Params: { runId: string }; Body: { command?: string; editMode?: boolean } }>('/api/ci/runs/:runId/console', async (req, reply) => {
    const command = (req.body?.command ?? '').trim()
    if (!command) return bad(reply, new Error('Пустая команда'))
    return ci.consoleExec(uid(req), req.params.runId, command, req.body?.editMode === true)
  })

  // --- Отчёт по занятому месту ---
  app.get<{ Querystring: { projectId?: string } }>('/api/ci/workspaces', async (req) => db.listCiWorkspaceReport(uid(req), req.query.projectId))
}
