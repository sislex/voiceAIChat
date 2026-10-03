import type { FastifyInstance } from 'fastify'
import { uid } from '@sislexa/identity/server/users/auth'
import type { IntegrationTokenScope } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'

export function registerIntegrationTokenRoutes(app: FastifyInstance, db: VoiceChatDb): void {
  const path = '/api/projects/:id/integration-tokens'
  app.get<{ Params: { id: string } }>(path, async (req, reply) => {
    const tokens = await db.projects.listIntegrationTokens(uid(req), req.params.id)
    return tokens ?? reply.code(403).send({ error: 'project_owner_required' })
  })
  app.post<{ Params: { id: string }; Body: { name: string; scopes: IntegrationTokenScope[] } }>(path, async (req, reply) => {
    if (!await db.projects.isProjectOwner(uid(req), req.params.id)) return reply.code(403).send({ error: 'project_owner_required' })
    const { name, scopes } = req.body ?? {}
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 200
      || !Array.isArray(scopes) || !scopes.length || scopes.some(scope => scope !== 'tasks:external')
      || new Set(scopes).size !== scopes.length) return reply.code(400).send({ error: 'invalid_integration_token' })
    const created = await db.projects.createIntegrationToken(uid(req), req.params.id, name, scopes)
    if (!created) return reply.code(403).send({ error: 'project_owner_required' })
    reply.header('cache-control', 'no-store')
    return reply.code(201).send(created)
  })
  // DELETE on the collection accepts the token id; the resource URL is also supported.
  const revoke = async (userId: string, projectId: string, tokenId: unknown, reply: import('fastify').FastifyReply) => {
    if (!await db.projects.isProjectOwner(userId, projectId)) return reply.code(403).send({ error: 'project_owner_required' })
    if (typeof tokenId !== 'string' || !tokenId) return reply.code(400).send({ error: 'token_id_required' })
    if (!await db.projects.revokeIntegrationToken(userId, projectId, tokenId)) return reply.code(404).send({ error: 'not_found' })
    return reply.code(204).send()
  }
  app.delete<{ Params: { id: string }; Body: { id: string } }>(path, (req, reply) =>
    revoke(uid(req), req.params.id, req.body?.id, reply))
  app.delete<{ Params: { id: string; tokenId: string } }>(path + '/:tokenId', (req, reply) =>
    revoke(uid(req), req.params.id, req.params.tokenId, reply))
}
