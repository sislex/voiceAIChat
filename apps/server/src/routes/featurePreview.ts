import type { FastifyInstance } from 'fastify'
import type { PreviewOperation } from '@voicechat/shared'
import type { FeaturePreviewManager } from '../preview/manager.js'
import { uid } from '../users/auth.js'

export function registerFeaturePreviewRoutes(app: FastifyInstance, previews: FeaturePreviewManager): void {
  const base = '/api/projects/:projectId/tasks/:taskId/preview'
  app.get<{ Params: { projectId: string; taskId: string } }>(base, async (req, reply) => {
    const env = previews.get(uid(req), req.params.projectId, req.params.taskId)
    return env ?? reply.code(404).send({ error: 'preview not created' })
  })
  app.post<{
    Params: { projectId: string; taskId: string }
    Body: { operation?: PreviewOperation; idempotencyKey?: string; scenario?: string }
  }>(`${base}/operations`, async (req, reply) => {
    const operation = req.body?.operation
    if (!operation || !['start','rebuild','stop','seed','reset','health_check','remove'].includes(operation)) {
      return reply.code(400).send({ error: 'invalid preview operation' })
    }
    try {
      return await previews.operate(uid(req), req.params.projectId, req.params.taskId, operation, {
        idempotencyKey: req.body?.idempotencyKey,
        scenario: req.body?.scenario
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const status = /нет доступа|не найден/.test(message) ? 404 : /выполняется/.test(message) ? 409 : 400
      return reply.code(status).send({ error: message })
    }
  })
  app.post<{ Params: { projectId: string; taskId: string } }>(`${base}/cancel`, async (req, reply) =>
    previews.cancel(uid(req), req.params.projectId, req.params.taskId)
      ? { cancelled: true }
      : reply.code(409).send({ error: 'active operation not found' })
  )
  app.get<{ Params: { projectId: string; taskId: string }; Querystring: { sha?: string } }>(`${base}/playwright-target`, async (req, reply) => {
    const env = previews.get(uid(req), req.params.projectId, req.params.taskId)
    if (!env) return reply.code(404).send({ error: 'preview not created' })
    const sha = req.query.sha?.trim()
    if (!sha || env.state === 'stale' || env.state !== 'running' || env.healthStatus !== 'healthy' || env.builtCommitSha !== sha || env.currentCommitSha !== sha || !env.dataReady || !env.appUrl) {
      return reply.code(409).send({ error: 'preview is not ready for requested SHA' })
    }
    return { url: env.appUrl, commitSha: sha, seedScenario: env.selectedSeedScenario }
  })
  app.get<{ Params: { projectId: string; taskId: string; runId: string } }>(`${base}/runs/:runId/log`, async (req, reply) => {
    const env = previews.get(uid(req), req.params.projectId, req.params.taskId)
    const run = env?.runs.find((item) => item.id === req.params.runId)
    return run ? { runId: run.id, log: run.log } : reply.code(404).send({ error: 'run not found' })
  })
}
