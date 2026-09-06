import type { FastifyInstance } from 'fastify'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'

async function availableLocalPort(preferred = 18_000): Promise<number> {
  const tryPort = (port: number): Promise<number | null> => new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolve(null))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(port)))
  })
  for (let port = preferred; port < preferred + 100; port += 1) {
    const available = await tryPort(port)
    if (available !== null) return available
  }
  throw new Error('Не удалось подобрать свободный локальный порт для SSH-туннеля')
}

export function isLocalPreview(previewAgentId: string, localAgentId: string | null): boolean {
  return localAgentId !== null && previewAgentId === localAgentId
}

export function manualPreviewCommand(localPort: number, remotePort: number, sshUser: string, sshHost: string): string | null {
  const user = sshUser.trim()
  const host = sshHost.trim()
  if (!/^[a-zA-Z0-9._-]+$/.test(user) || !/^(?:[a-zA-Z0-9.-]+|\[[0-9a-fA-F:]+\])$/.test(host)) return null
  return `ssh -N -L ${localPort}:127.0.0.1:${remotePort} ${user}@${host}`
}
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
  app.post<{ Params: { projectId: string; taskId: string }; Body: { service?: PreviewServiceKind; localAgentId?: string | null } }>(`${base}/open`, async (req, reply) => {
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
    const localAgentId = req.body?.localAgentId?.trim() || null
    if (!loopback || isLocalPreview(env.agentId, localAgentId)) {
      const url = loopback ? `http://127.0.0.1:${service.hostPort}` : internalUrl
      const result: PreviewAccessResult = { connectionType: 'direct', state: 'connected', url, tunnelId: null, manualCommand: null, internalUrl, localAgentId, error: null }
      db.qa.addPreviewAudit(userId, req.params.projectId, req.params.taskId, 'preview.open.direct', { environmentId: env.id, service: kind })
      return result
    }

    const project = db.projects.getProject(userId, req.params.projectId)
    const machine = project?.machines.find((item) => item.agentId === env.agentId)
    const missingSshSettings: Array<'hostname' | 'user'> = []
    if (!machine?.sshHost?.trim()) missingSshSettings.push('hostname')
    if (!machine?.sshUser?.trim()) missingSshSettings.push('user')
    const localPort = missingSshSettings.length ? null : await availableLocalPort()
    const manualCommand = localPort === null ? null : manualPreviewCommand(localPort, service.hostPort, machine!.sshUser!, machine!.sshHost!)
    const settingsError = missingSshSettings.length
      ? `Заполните в настройках машины: ${missingSshSettings.includes('hostname') ? 'SSH hostname/IP' : ''}${missingSshSettings.length === 2 ? ' и ' : ''}${missingSshSettings.includes('user') ? 'SSH-пользователя' : ''}`
      : manualCommand ? null : 'SSH hostname/IP или SSH-пользователь имеют недопустимый формат'

    const localAgent = localAgentId && localAgentId !== env.agentId && db.machines.listAgents(userId).some((agent) => agent.id === localAgentId) && agents.isOnline(localAgentId)
      ? { id: localAgentId }
      : null
    if (!localAgent) {
      const result: PreviewAccessResult = { connectionType: 'manual', state: 'agent_required', url: null, tunnelId: null, manualCommand, internalUrl, localAgentId, missingSshSettings, error: settingsError ?? 'Для автоматического подключения нужен локальный агент ChatAI' }
      return reply.code(409).send(result)
    }
    const tunnelId = createHash('sha256').update(`${userId}:${env.id}:${env.builtCommitSha}:${kind}`).digest('hex').slice(0, 32)
    try {
      const port = await agents.createTunnel(tunnelId, localAgent.id, env.agentId, service.hostPort, () => Boolean(previews.get(userId, req.params.projectId, req.params.taskId)), () => db.qa.addPreviewAudit(userId, req.params.projectId, req.params.taskId, 'preview.tunnel.close', { environmentId: env.id, tunnelId }))
      const result: PreviewAccessResult = { connectionType: 'tunnel', state: 'connected', url: `http://127.0.0.1:${port}`, tunnelId, manualCommand: null, internalUrl, localAgentId: localAgent.id, error: null }
      db.qa.addPreviewAudit(userId, req.params.projectId, req.params.taskId, 'preview.tunnel.open', { environmentId: env.id, service: kind, tunnelId, localAgentId: localAgent.id })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const result: PreviewAccessResult = { connectionType: 'manual', state: 'failed', url: null, tunnelId, manualCommand, internalUrl, localAgentId: localAgent.id, missingSshSettings, error: settingsError ?? message }
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
