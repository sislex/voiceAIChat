import type { FastifyInstance } from 'fastify'
import { uid } from '@sislexa/identity/server/users/auth'
import type { VoiceChatDb } from '../db/database.js'
import type { ProjectPreviews } from '../makeBridge/projectPreview.js'

/** Owner-configured preview stand command of an ordinary web project (Core-only storage). */
export function registerProjectStandPreviewRoutes(app: FastifyInstance, db: VoiceChatDb, previews: ProjectPreviews): void {
  const path = '/api/projects/:id/stand-preview'
  app.get<{ Params: { id: string } }>(path, async (req, reply) => {
    if (!await db.projects.isProjectMember(uid(req), req.params.id)) return reply.code(403).send({ error: 'project_access_denied' })
    return { config: await previews.config(req.params.id) }
  })
  app.put<{ Params: { id: string }; Body: unknown }>(path, async (req, reply) => {
    if (!await db.projects.isProjectOwner(uid(req), req.params.id)) return reply.code(403).send({ error: 'project_owner_required' })
    const body = req.body ?? null
    const config = body === null ? null : previews.parse(body)
    if (body !== null && !config) return reply.code(400).send({ error: 'invalid_stand_preview' })
    await db.projects.setProjectStandPreview(req.params.id, config, uid(req))
    return { config }
  })
}
