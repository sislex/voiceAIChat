import type { FastifyInstance, FastifyReply } from 'fastify'
import { REST, type FeatureStatus } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import { uid } from '../users/auth.js'
import type { FeatureCoordinator } from '../features/coordinator.js'
import type { BoardHub } from '../projects/boardHub.js'

const nf = (reply: FastifyReply): FastifyReply => reply.code(404).send({ error: 'not found' })
const bad = (reply: FastifyReply, error: unknown): FastifyReply => reply.code(409).send({ error: error instanceof Error ? error.message : String(error) })

export function registerFeatureRoutes(app: FastifyInstance, db: VoiceChatDb, boardHub: BoardHub, coordinator: FeatureCoordinator): void {
  app.get<{ Params: { id: string } }>(REST.projectFeatures(':id').replace('%3Aid', ':id'), async (req, reply) => db.listFeatures(uid(req), req.params.id) ?? nf(reply))
  app.get<{ Params: { id: string } }>(REST.feature(':id').replace('%3Aid', ':id'), async (req, reply) => db.getFeature(uid(req), req.params.id) ?? nf(reply))

  app.post<{ Params: { id: string; taskId: string }; Body: { autoMerge?: boolean; autoDeployProduction?: boolean } }>('/api/projects/:id/tasks/:taskId/feature', async (req, reply) => {
    try {
      const feature = db.createFeatureFromTask(uid(req), req.params.id, req.params.taskId, req.body ?? {})
      if (!feature) return nf(reply)
      boardHub.emit(req.params.id)
      void coordinator.prepare(uid(req), feature)
      return reply.code(202).send(feature)
    } catch (err) { return bad(reply, err) }
  })

  app.post<{ Params: { id: string; storyId: string }; Body: { autoMerge?: boolean; autoDeployProduction?: boolean } }>('/api/projects/:id/stories/:storyId/feature', async (req, reply) => {
    try {
      const feature = db.createFeatureFromStory(uid(req), req.params.id, req.params.storyId, req.body ?? {})
      if (!feature) return nf(reply)
      boardHub.emit(req.params.id)
      void coordinator.prepare(uid(req), feature)
      return reply.code(202).send(feature)
    } catch (err) { return bad(reply, err) }
  })

  app.patch<{ Params: { id: string }; Body: { autoMerge?: boolean; autoDeployProduction?: boolean } }>('/api/features/:id/automation', async (req, reply) => db.updateFeatureAutomation(uid(req), req.params.id, req.body ?? {}) ?? nf(reply))
  app.post<{ Params: { id: string }; Body: { status?: FeatureStatus; expectedVersion?: number } }>('/api/features/:id/transition', async (req, reply) => {
    if (!req.body?.status) return reply.code(400).send({ error: 'status required' })
    try {
      const current = db.getFeature(uid(req), req.params.id)
      if (!current) return nf(reply)
      if (req.body.status === 'testing') {
        void coordinator.finishDevelopment(uid(req), current.id, current.status === 'awaiting_commit').catch(() => {})
        return reply.code(202).send(current)
      }
      if (req.body.status === 'merging') {
        void coordinator.merge(uid(req), current.id).catch(() => {})
        return reply.code(202).send(current)
      }
      if (req.body.status === 'cancelled') {
        void coordinator.cancel(uid(req), current.id).catch(() => {})
        return reply.code(202).send(current)
      }
      const feature = db.transitionFeature(uid(req), req.params.id, req.body.status, req.body.expectedVersion)
      if (!feature) return nf(reply)
      boardHub.emit(feature.projectId)
      return feature
    } catch (err) { return bad(reply, err) }
  })

  app.get<{ Params: { id: string } }>('/api/features/:id/deployments', async (req, reply) => db.listFeatureDeployments(uid(req), req.params.id) ?? nf(reply))

  app.post<{ Params: { id: string } }>('/api/features/:id/deploy', async (req, reply) => {
    const feature = db.getFeature(uid(req), req.params.id)
    if (!feature) return nf(reply)
    db.setFeatureDeployStatus(uid(req), feature.id, 'queued')
    void coordinator.deploy(uid(req), feature.id).catch(() => {})
    return reply.code(202).send(db.getFeature(uid(req), feature.id))
  })

  app.get<{ Params: { id: string } }>('/api/features/:id/agent-tasks', async (req, reply) => db.listAgentTasks(uid(req), req.params.id) ?? nf(reply))
  app.post<{ Params: { id: string }; Body: { title?: string; description?: string; kind?: import('@voicechat/shared').AgentTask['kind']; dependsOn?: string[] } }>('/api/features/:id/agent-tasks', async (req, reply) => {
    const title = req.body?.title?.trim()
    if (!title) return reply.code(400).send({ error: 'title required' })
    return db.createAgentTask(uid(req), req.params.id, { ...req.body, title }) ?? nf(reply)
  })
}
