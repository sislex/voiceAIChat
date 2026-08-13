import type { FastifyInstance, FastifyReply } from 'fastify'
import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import type { AcceptanceCriterionSnapshot } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import type { UploadStore } from '../uploads.js'
import type { CiRunManager } from '../ci/runManager.js'
import { uid } from '../users/auth.js'

type TaskParams = { projectId: string; taskId: string }
function qaError(reply: FastifyReply, error: unknown): FastifyReply {
  const message = error instanceof Error ? error.message : String(error)
  const status = /not found|нет доступа/.test(message) ? 404 : /permission/.test(message) ? 403 : /conflict|already|stale|incomplete|does not match/.test(message) ? 409 : 400
  return reply.code(status).send({ error: message })
}

export function registerQaRoutes(app: FastifyInstance, db: VoiceChatDb, uploads: UploadStore, ci: CiRunManager): void {
  const base = '/api/projects/:projectId/tasks/:taskId/qa'
  app.get<{ Params: TaskParams }>(`${base}`, async (req, reply) => {
    const state = db.getQaTaskState(uid(req), req.params.projectId, req.params.taskId)
    return state ?? reply.code(404).send({ error: 'task not found' })
  })
  app.post<{ Params: TaskParams; Body: AcceptanceCriterionSnapshot & { order?: number } }>(
    `${base}/criteria`,
    async (req, reply) => {
      try {
        const criterion = db.createAcceptanceCriterion(uid(req), req.params.projectId, req.params.taskId, req.body)
        return criterion ?? reply.code(404).send({ error: 'task not found' })
      } catch (error) { return qaError(reply, error) }
    }
  )
  app.put<{ Params: TaskParams & { criterionId: string }; Body: AcceptanceCriterionSnapshot & { reason: string; semanticChange?: boolean } }>(
    `${base}/criteria/:criterionId`,
    async (req, reply) => {
      try {
        const criterion = db.reviseAcceptanceCriterion(uid(req), req.params.projectId, req.params.taskId, req.params.criterionId, req.body)
        return criterion ?? reply.code(404).send({ error: 'criterion not found' })
      } catch (error) { return qaError(reply, error) }
    }
  )
  app.post<{ Params: TaskParams }>(`${base}/preparation/complete`, async (req, reply) => {
    try {
      return db.completeQaPreparation(uid(req), req.params.projectId, req.params.taskId)
        ?? reply.code(404).send({ error: 'task not found' })
    } catch (error) { return qaError(reply, error) }
  })
  app.post<{ Params: TaskParams; Body: { branch: string; commitSha: string; testRunId: string; previewId?: string | null; previewSha?: string | null; appUrl?: string | null; storybookUrl?: string | null; testDataScenario?: string; testerId?: string | null } }>(
    `${base}/sessions`,
    async (req, reply) => {
      try {
        const session = db.startQaSession(uid(req), { projectId: req.params.projectId, taskId: req.params.taskId, ...req.body })
        return session ?? reply.code(404).send({ error: 'task not found' })
      } catch (error) { return qaError(reply, error) }
    }
  )
  app.patch<{ Params: TaskParams & { resultId: string }; Body: { revision: number; patch: Parameters<VoiceChatDb['saveQaResult']>[5] } }>(
    `${base}/results/:resultId`,
    async (req, reply) => {
      try {
        return db.saveQaResult(uid(req), req.params.projectId, req.params.taskId, req.params.resultId, req.body.revision, req.body.patch)
      } catch (error) { return qaError(reply, error) }
    }
  )
  app.post<{ Params: TaskParams & { sessionId: string } }>(`${base}/sessions/:sessionId/fix`, async (req, reply) => {
    try {
      const state = db.getQaTaskState(uid(req), req.params.projectId, req.params.taskId)
      const session = state?.sessions.find((item) => item.id === req.params.sessionId)
      if (!session) throw new Error('QA session not found')
      const failed = session.results.filter((result) => result.status === 'failed')
      const linked = failed.map((result) => result.issue?.linkedFixRunId).find(Boolean)
      if (linked) return db.getCiRun(uid(req), linked) ?? reply.code(409).send({ error: 'Связанный ран не найден' })
      if (state?.activeSession?.id !== session.id) throw new Error('QA session is stale or closed')
      if (!failed.length) throw new Error('Нет неработающих тестов')
      if (failed.some((result) => !result.comment.trim())) throw new Error('Для каждого неработающего теста нужен комментарий')
      const started = ci.start(uid(req), req.params.projectId, req.params.taskId, { mode: 'development' })
      if ('error' in started) return reply.code(409).send({ error: started.error })
      db.linkQaFixRun(uid(req), req.params.projectId, req.params.taskId, session.id, started.run.id)
      return reply.code(202).send(started.run)
    } catch (error) { return qaError(reply, error) }
  })
  app.post<{ Params: TaskParams & { sessionId: string }; Body: { summary?: string } }>(
    `${base}/sessions/:sessionId/complete`,
    async (req, reply) => {
      try {
        return db.completeQaSession(uid(req), req.params.projectId, req.params.taskId, req.params.sessionId, req.body?.summary ?? '')
      } catch (error) { return qaError(reply, error) }
    }
  )
  app.post<{ Params: TaskParams & { resultId: string }; Body: { uploadId?: string; caption?: string } }>(
    `${base}/results/:resultId/attachments`,
    async (req, reply) => {
      try {
        const upload = req.body?.uploadId ? uploads.get(req.body.uploadId) : undefined
        if (!upload || upload.agentId) return reply.code(400).send({ error: 'local upload not found' })
        if (upload.size > 10 * 1024 * 1024) return reply.code(413).send({ error: 'QA screenshot too large' })
        const bytes = readFileSync(upload.path)
        const detected = detectImageMime(bytes)
        const extension = extname(upload.name).toLowerCase()
        const expectedExtension = detected === 'image/png' ? '.png' : detected === 'image/jpeg' ? ['.jpg', '.jpeg'].includes(extension) : extension === '.webp'
        if (!detected || detected !== upload.mimeType || !expectedExtension) return reply.code(400).send({ error: 'invalid screenshot format' })
        return db.addQaAttachment(uid(req), req.params.projectId, req.params.taskId, req.params.resultId, {
          uploadId: upload.id, name: basename(upload.name), mimeType: detected, size: bytes.byteLength, caption: req.body.caption
        })
      } catch (error) { return qaError(reply, error) }
    }
  )
  app.get<{ Params: { attachmentId: string } }>('/api/qa/attachments/:attachmentId', async (req, reply) => {
    const attachment = db.getQaAttachment(uid(req), req.params.attachmentId)
    if (!attachment) return reply.code(404).send({ error: 'attachment not found' })
    const upload = uploads.get(attachment.uploadId)
    if (!upload || upload.agentId) return reply.code(404).send({ error: 'attachment file not found' })
    reply.header('content-disposition', `inline; filename="${basename(attachment.name).replace(/["\\]/g, '_')}"`)
    return reply.type(attachment.mimeType).send(readFileSync(upload.path))
  })
}

function detectImageMime(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return null
}
