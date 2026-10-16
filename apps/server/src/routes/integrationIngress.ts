import type { FastifyInstance } from 'fastify'
import type { BoardCardActionRequest } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'

type Fetch = typeof fetch

/**
 * Integration ingress outside `/api/` (the session auth guard needs a user, an integration has none).
 * Core checks the token, its project and scope, then forwards to Kanban.
 * Upserts retain the integration credential; snapshots and card actions use internal authorization.
 */
export function registerIntegrationIngress(app: FastifyInstance, db: Pick<VoiceChatDb, 'projects'>, opts: { kanbanUrl?: string; internalToken?: string; fetchImpl?: Fetch; timeoutMs?: number }): void {
  app.get<{ Params: { id: string } }>('/integrations/v1/projects/:id/tasks/state', async (req, reply) => {
    const principal = await db.projects.resolveIntegrationToken(req.headers.authorization)
    if (!principal) return reply.code(401).send({ error: 'unauthorized' })
    if (!principal.projectIds.includes(req.params.id) || !principal.scopes.includes('tasks:read')) return reply.code(403).send({ error: 'integration_access_denied' })
    if (!opts.kanbanUrl || !opts.internalToken) return reply.code(503).send({ error: 'kanban_unavailable' })
    const target = `${opts.kanbanUrl.replace(/\/+$/, '')}/internal/kanban/projects/${encodeURIComponent(req.params.id)}/tasks/state`
    try {
      const response = await (opts.fetchImpl ?? fetch)(target, {
        method: 'GET', headers: { authorization: `Bearer ${opts.internalToken}` },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000)
      })
      const text = await response.text()
      return reply.code(response.status).header('content-type', response.headers.get('content-type') ?? 'application/json').send(text)
    } catch (error) {
      req.log.warn({ err: error }, 'integration ingress: kanban request failed')
      return reply.code(502).send({ error: 'kanban_unreachable' })
    }
  })

  app.post<{ Params: { id: string; taskId: string }; Body: BoardCardActionRequest }>('/integrations/v1/projects/:id/tasks/:taskId/actions', async (req, reply) => {
    const principal = await db.projects.resolveIntegrationToken(req.headers.authorization)
    if (!principal) return reply.code(401).send({ error: 'unauthorized' })
    if (!principal.projectIds.includes(req.params.id) || !principal.scopes.includes('tasks:control')) return reply.code(403).send({ error: 'integration_access_denied' })
    if (!opts.kanbanUrl || !opts.internalToken) return reply.code(503).send({ error: 'kanban_unavailable' })
    const target = `${opts.kanbanUrl.replace(/\/+$/, '')}/internal/kanban/projects/${encodeURIComponent(req.params.id)}/tasks/${encodeURIComponent(req.params.taskId)}/actions`
    try {
      const response = await (opts.fetchImpl ?? fetch)(target, {
        method: 'POST', headers: { authorization: `Bearer ${opts.internalToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(req.body), signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000)
      })
      const text = await response.text()
      return reply.code(response.status).header('content-type', response.headers.get('content-type') ?? 'application/json').send(text)
    } catch (error) {
      req.log.warn({ err: error }, 'integration ingress: kanban request failed')
      return reply.code(502).send({ error: 'kanban_unreachable' })
    }
  })

  app.put<{ Params: { id: string; source: string; externalId: string } }>('/integrations/v1/projects/:id/external-tasks/:source/:externalId', async (req, reply) => {
    const principal = await db.projects.resolveIntegrationToken(req.headers.authorization)
    if (!principal) return reply.code(401).send({ error: 'unauthorized' })
    if (!principal.projectIds.includes(req.params.id) || !principal.scopes.includes('tasks:external')) return reply.code(403).send({ error: 'integration_access_denied' })
    if (!opts.kanbanUrl) return reply.code(503).send({ error: 'kanban_unavailable' })
    const target = `${opts.kanbanUrl.replace(/\/+$/, '')}/api/projects/${encodeURIComponent(req.params.id)}/external-tasks/${encodeURIComponent(req.params.source)}/${encodeURIComponent(req.params.externalId)}`
    try {
      const response = await (opts.fetchImpl ?? fetch)(target, {
        method: 'PUT', headers: { authorization: req.headers.authorization!, 'content-type': 'application/json' },
        body: JSON.stringify(req.body ?? {}), signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000)
      })
      const text = await response.text()
      return reply.code(response.status).header('content-type', response.headers.get('content-type') ?? 'application/json').send(text)
    } catch (error) {
      req.log.warn({ err: error }, 'integration ingress: kanban request failed')
      return reply.code(502).send({ error: 'kanban_unreachable' })
    }
  })
}
