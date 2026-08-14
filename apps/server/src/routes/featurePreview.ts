import type { FastifyInstance } from 'fastify'
import { createHash } from 'node:crypto'
import type { PreviewAccessResult, PreviewOperation, PreviewServiceKind } from '@voicechat/shared'
import type { FeaturePreviewManager } from '../preview/manager.js'
import type { VoiceChatDb } from '../db/database.js'
import type { AgentRegistry } from '../agents/registry.js'
import { uid } from '../users/auth.js'

export function registerFeaturePreviewRoutes(app: FastifyInstance, previews: FeaturePreviewManager, db: VoiceChatDb, agents: AgentRegistry): void {
  const base = '/api/projects/:projectId/tasks/:taskId/preview'
  app.get<{ Params: { projectId: string; taskId: string } }>(base, async (req, reply) => {
    const env = previews.get(uid(req), req.params.projectId, req.params.taskId)
    return env ?? reply.code(404).send({ error: 'preview not created' })
  })
  app.post<{
    Params: { projectId: string; taskId: string }
    Body: { operation?: PreviewOperation; idempotencyKey?: string; scenario?: string; agentId?: string }
  }>(`${base}/operations`, async (req, reply) => {
    const operation = req.body?.operation
    if (!operation || !['start','rebuild','stop','seed','reset','health_check','remove','docker_start','docker_install'].includes(operation)) {
      return reply.code(400).send({ error: 'invalid preview operation' })
    }
    try {
      return await previews.operate(uid(req), req.params.projectId, req.params.taskId, operation, {
        idempotencyKey: req.body?.idempotencyKey,
        scenario: req.body?.scenario,
        agentId: req.body?.agentId
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const status = /нет доступа|не найден/.test(message) ? 404 : /выполняется/.test(message) ? 409 : 400
      return reply.code(status).send({ error: message })
    }
  })
  app.post<{ Params: { projectId: string; taskId: string }; Body: { service?: PreviewServiceKind } }>(`${base}/open`, async (req, reply) => {
    const userId = uid(req)
    const env = previews.get(userId, req.params.projectId, req.params.taskId)
    if (!env) return reply.code(404).send({ error: 'preview not created or access denied' })
    if (env.state !== 'running' || env.healthStatus !== 'healthy') return reply.code(409).send({ error: 'preview is not ready' })
    const kind = req.body?.service === 'storybook' ? 'storybook' : 'app'
    const service = env.services.find((item) => item.name === kind)
    const internalUrl = kind === 'storybook' ? env.storybookUrl : env.appUrl
    if (!service || !internalUrl || service.healthStatus !== 'healthy') return reply.code(409).send({ error: 'preview service is not ready' })
    if (!agents.isOnline(env.agentId)) return reply.code(409).send({ error: 'Preview-машина недоступна' })
    const health = await agents.exec(env.agentId, `curl --fail --silent --show-error --max-time 5 http://127.0.0.1:${service.hostPort}/ >/dev/null`, 8_000).catch(() => null)
    if (!health || health.exitCode !== 0 || health.timedOut) return reply.code(502).send({ error: 'Сервис preview не отвечает' })
    const loopback = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/i.test(internalUrl)
    if (!loopback) {
      const result: PreviewAccessResult = { connectionType: 'direct', state: 'connected', url: internalUrl, tunnelId: null, manualCommand: null, internalUrl, localAgentId: null, error: null }
      db.addPreviewAudit(userId, req.params.projectId, req.params.taskId, 'preview.open.direct', { environmentId: env.id, service: kind })
      return result
    }
    const localAgent = db.listAgents(userId).find((agent) => agent.id !== env.agentId && agents.isOnline(agent.id))
    const manualCommand = `ssh -N -L 18000:127.0.0.1:${service.hostPort} ${env.agentId}`
    if (!localAgent) {
      const result: PreviewAccessResult = { connectionType: 'manual', state: 'agent_required', url: null, tunnelId: null, manualCommand, internalUrl, localAgentId: null, error: 'Для автоматического подключения нужен локальный агент ChatAI' }
      return reply.code(409).send(result)
    }
    const tunnelId = createHash('sha256').update(`${userId}:${env.id}:${env.builtCommitSha}:${kind}`).digest('hex').slice(0, 32)
    try {
      const port = await agents.createTunnel(tunnelId, localAgent.id, env.agentId, service.hostPort, () => Boolean(previews.get(userId, req.params.projectId, req.params.taskId)), () => db.addPreviewAudit(userId, req.params.projectId, req.params.taskId, 'preview.tunnel.close', { environmentId: env.id, tunnelId }))
      const result: PreviewAccessResult = { connectionType: 'tunnel', state: 'connected', url: `http://127.0.0.1:${port}`, tunnelId, manualCommand, internalUrl, localAgentId: localAgent.id, error: null }
      db.addPreviewAudit(userId, req.params.projectId, req.params.taskId, 'preview.tunnel.open', { environmentId: env.id, service: kind, tunnelId, localAgentId: localAgent.id })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const result: PreviewAccessResult = { connectionType: 'manual', state: 'failed', url: null, tunnelId, manualCommand, internalUrl, localAgentId: localAgent.id, error: message }
      return reply.code(502).send(result)
    }
  })
  app.delete<{ Params: { projectId: string; taskId: string; tunnelId: string } }>(`${base}/tunnels/:tunnelId`, async (req, reply) => {
    const userId = uid(req)
    const env = previews.get(userId, req.params.projectId, req.params.taskId)
    if (!env) return reply.code(404).send({ error: 'preview not created or access denied' })
    const expected = ['app', 'storybook'].map((kind) => createHash('sha256').update(`${userId}:${env.id}:${env.builtCommitSha}:${kind}`).digest('hex').slice(0, 32))
    if (!expected.includes(req.params.tunnelId)) return reply.code(404).send({ error: 'tunnel not found' })
    const closed = agents.closeTunnel(req.params.tunnelId)
    // close callback records explicit and automatic shutdowns in the same audit stream.
    return { closed }
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
