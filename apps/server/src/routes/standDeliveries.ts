import type { FastifyInstance, FastifyReply } from 'fastify'
import { uid } from '@sislexa/identity/server/users/auth'
import { GitError } from '../git/workspaceService.js'
import type { StandDeliveries } from '../makeBridge/standDeliveries.js'

export function registerStandDeliveryRoutes(app: FastifyInstance, service: StandDeliveries) {
  type Params = { id: string; standId: string }
  const base = '/api/projects/:id/dev-stands/:standId'
  async function handle(reply: FastifyReply, work: () => Promise<unknown>) {
    try { return await work() } catch (error) {
      if (error instanceof GitError) return reply.code(error.status).send({ error: error.code })
      const status = (error as { statusCode?: number }).statusCode
      if (status && status >= 400 && status < 600) return reply.code(status).send({ error: (error as Error).message })
      return reply.code(503).send({ error: 'stand_delivery_unavailable' })
    }
  }
  app.get<{ Params: Params }>(base + '/deliveries', (req, reply) =>
    handle(reply, () => service.list(uid(req), req.params.id, req.params.standId)))
  app.post<{ Params: Params }>(base + '/deliveries', (req, reply) =>
    handle(reply, () => service.submit(uid(req), req.params.id, req.params.standId, req.body)))
  app.post<{ Params: Params }>(base + '/sync-dev', (req, reply) =>
    handle(reply, () => service.sync(uid(req), req.params.id, req.params.standId)))
}
