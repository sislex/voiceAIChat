import type { FastifyInstance, FastifyReply } from 'fastify'
import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { QA_RUN_STAGES, type AcceptanceCriterionSnapshot, type QaRunStage } from '@voicechat/shared'
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

export function registerQaRoutes(app: FastifyInstance, db: VoiceChatDb, uploads: UploadStore, ci: CiRunManager, retryPreparation?: (args: { userId: string; projectId: string; taskId: string; branch: string; commitSha: string }) => boolean, launchComponentQa?: (runId:string,userId:string)=>void, cancelComponentQa?: (runId:string)=>void, launchIntegrationTests?: (runId:string,userId:string)=>void, cancelIntegrationTests?: (runId:string)=>void, boardChanged?: (projectId:string)=>void): void {
  const base = '/api/projects/:projectId/tasks/:taskId/qa'
  app.get<{ Params: TaskParams }>(`${base}`, async (req, reply) => {
    const state = db.getQaTaskState(uid(req), req.params.projectId, req.params.taskId)
    return state ?? reply.code(404).send({ error: 'task not found' })
  })
  app.get<{ Params: TaskParams }>(`${base}/component`, async (req, reply) => {
    const state=db.getComponentQaTaskState(uid(req),req.params.projectId,req.params.taskId)
    return state ?? reply.code(404).send({error:'task not found'})
  })
  app.post<{ Params: TaskParams }>(`${base}/component/runs`, async (req,reply)=>{
    try {
      const userId=uid(req)
      const run=db.startComponentQaRun(userId,req.params.projectId,req.params.taskId)
      if (run.status==='queued') launchComponentQa?.(run.id,userId)
      boardChanged?.(req.params.projectId)
      return reply.code(run.status==='queued'||run.status==='running'?202:200).send(run)
    } catch(error) { return qaError(reply,error) }
  })
  app.post<{Params:TaskParams&{runId:string}}>(`${base}/component/runs/:runId/cancel`,async(req,reply)=>{
    try { cancelComponentQa?.(req.params.runId); const run=db.cancelComponentQaRun(uid(req),req.params.runId); boardChanged?.(req.params.projectId); return run }
    catch(error) { return qaError(reply,error) }
  })
  app.post<{Params:TaskParams&{runId:string}}>(`${base}/component/runs/:runId/complete`,async(req,reply)=>{
    try { const run=db.completeComponentQaRun(uid(req),req.params.projectId,req.params.taskId,req.params.runId); boardChanged?.(req.params.projectId); return run }
    catch(error) { return qaError(reply,error) }
  })
  app.post<{Params:TaskParams&{runId:string}}>(`${base}/component/runs/:runId/fix`,async(req,reply)=>{
    try {
      const userId=uid(req), run=db.getComponentQaRun(userId,req.params.runId)
      if (!run||run.taskId!==req.params.taskId) throw new Error('component QA run not found')
      if (!['failed','blocked'].includes(run.status)) throw new Error('component QA run must be failed or blocked')
      if (run.linkedFixRunId) return db.getCiRun(userId,run.linkedFixRunId) ?? reply.code(409).send({error:'Связанный ран не найден'})
      const started=ci.start(userId,req.params.projectId,req.params.taskId,{mode:'development'})
      if ('error' in started) return reply.code(409).send({error:started.error})
      db.updateCiRun(started.run.id,{fixContext:{
        stepId:'component_qa:'+run.id,
        logTail:[run.summary,run.log,...run.commands.map((command)=>command.command+'\n'+command.diagnostic+'\n'+command.stdout+'\n'+command.stderr),...run.artifacts.map((artifact)=>artifact.kind+': '+(artifact.url||artifact.path))].filter(Boolean).join('\n').slice(-50000),
        failures:run.scenarios.filter((item)=>item.status==='failed'||item.status==='blocked').map((item)=>({packageName:null,file:null,testName:item.testCase.title,command:run.commands[0]?.command??null,message:item.actualResult||item.diagnostic||item.status})),
        updatedAt:Date.now()
      }})
      db.linkComponentQaFixRun(userId,run.id,started.run.id)
      return reply.code(202).send(started.run)
    } catch(error) { return qaError(reply,error) }
  })

  app.get<{Params:TaskParams}>(`${base}/integration`,async(req,reply)=>
    db.getIntegrationTestTaskState(uid(req),req.params.projectId,req.params.taskId)??reply.code(404).send({error:'task not found'}))
  app.post<{Params:TaskParams}>(`${base}/integration/runs`,async(req,reply)=>{
    try{const userId=uid(req),run=db.startIntegrationTestRun(userId,req.params.projectId,req.params.taskId);if(run.status==='queued')launchIntegrationTests?.(run.id,userId);boardChanged?.(req.params.projectId);return reply.code(run.status==='queued'||run.status==='running'?202:200).send(run)}
    catch(error){return qaError(reply,error)}
  })
  app.post<{Params:TaskParams&{runId:string}}>(`${base}/integration/runs/:runId/cancel`,async(req,reply)=>{
    try{cancelIntegrationTests?.(req.params.runId);const run=db.cancelIntegrationTestRun(uid(req),req.params.runId);boardChanged?.(req.params.projectId);return run}catch(error){return qaError(reply,error)}
  })
  app.post<{Params:TaskParams&{runId:string}}>(`${base}/integration/runs/:runId/complete`,async(req,reply)=>{
    try{const run=db.completeIntegrationTestRun(uid(req),req.params.projectId,req.params.taskId,req.params.runId);boardChanged?.(req.params.projectId);return run}catch(error){return qaError(reply,error)}
  })
  app.post<{Params:TaskParams&{runId:string}}>(`${base}/integration/runs/:runId/fix`,async(req,reply)=>{
    try{
      const userId=uid(req),run=db.getIntegrationTestRun(userId,req.params.runId)
      if(!run||run.taskId!==req.params.taskId)throw new Error('integration test run not found')
      if(!['failed','blocked'].includes(run.status))throw new Error('integration test run must be failed or blocked')
      if(run.linkedFixRunId)return db.getCiRun(userId,run.linkedFixRunId)??reply.code(409).send({error:'Связанный ран не найден'})
      const started=ci.start(userId,req.params.projectId,req.params.taskId,{mode:'development'})
      if('error'in started)return reply.code(409).send({error:started.error})
      db.updateCiRun(started.run.id,{fixContext:{stepId:`integration_tests:${run.id}`,logTail:[run.summary,run.log,...run.commands.map((command)=>command.command+'\n'+command.diagnostic+'\n'+command.stdout+'\n'+command.stderr)].filter(Boolean).join('\n').slice(-50000),failures:run.testCases.filter((item)=>item.required&&item.automatable&&!item.automationLinks.some((link)=>link.commitSha===run.commitSha)).map((item)=>({packageName:null,file:null,testName:item.title,command:run.commands[0]?.command??null,message:'automation missing or failed'})),updatedAt:Date.now()}})
      db.linkIntegrationTestFixRun(userId,run.id,started.run.id)
      return reply.code(202).send(started.run)
    }catch(error){return qaError(reply,error)}
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
  app.post<{ Params: TaskParams }>(`${base}/preparation/retry`, async (req, reply) => {
    try {
      const userId = uid(req)
      const state = db.getQaTaskState(userId, req.params.projectId, req.params.taskId)
      if (!state) return reply.code(404).send({ error: 'task not found' })
      const run = state.preparation
      if (run?.status === 'running') return reply.code(202).send(run)
      if (!run || run.status !== 'failed' || !retryPreparation) return reply.code(409).send({ error: 'Повтор подготовки сейчас недоступен' })
      if (!retryPreparation({ userId, projectId: req.params.projectId, taskId: req.params.taskId, branch: run.branch, commitSha: run.commitSha })) {
        const active = db.getQaTaskState(userId, req.params.projectId, req.params.taskId)?.preparation
        return active?.status === 'running' ? reply.code(202).send(active) : reply.code(409).send({ error: 'Подготовка уже запущена' })
      }
      return reply.code(202).send(db.getQaTaskState(userId, req.params.projectId, req.params.taskId)?.preparation)
    } catch (error) { return qaError(reply, error) }
  })
  app.post<{ Params: TaskParams; Body: { branch: string; commitSha: string; testRunId: string; previewId?: string | null; previewSha?: string | null; appUrl?: string | null; storybookUrl?: string | null; testDataScenario?: string; testerId?: string | null } }>(
    `${base}/sessions`,
    async (req, reply) => {
      try {
        const session = db.startQaSession(uid(req), { projectId: req.params.projectId, taskId: req.params.taskId, ...req.body })
        if (session) boardChanged?.(req.params.projectId)
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
  app.patch<{ Params: TaskParams & { sessionId: string }; Body: { additionalIssues?: string } }>(`${base}/sessions/:sessionId`, async (req, reply) => {
    try { return db.saveQaAdditionalIssues(uid(req), req.params.projectId, req.params.taskId, req.params.sessionId, req.body?.additionalIssues ?? '') }
    catch (error) { return qaError(reply, error) }
  })
  app.post<{ Params: TaskParams & { sessionId: string } }>(`${base}/sessions/:sessionId/fix`, async (req, reply) => {
    try {
      const state = db.getQaTaskState(uid(req), req.params.projectId, req.params.taskId)
      const session = state?.sessions.find((item) => item.id === req.params.sessionId)
      if (!session) throw new Error('QA session not found')
      const failed = session.results.filter((result) => result.status === 'failed')
      const linked = session.linkedFixRunId ?? failed.map((result) => result.issue?.linkedFixRunId).find(Boolean)
      if (linked) return db.getCiRun(uid(req), linked) ?? reply.code(409).send({ error: 'Связанный ран не найден' })
      if (state?.activeSession?.id !== session.id) throw new Error('QA session is stale or closed')
      if (!failed.length && !session.additionalIssues?.trim()) throw new Error('Нет ошибок или дополнительных замечаний')
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
        const session=db.completeQaSession(uid(req), req.params.projectId, req.params.taskId, req.params.sessionId, req.body?.summary ?? '')
        boardChanged?.(req.params.projectId)
        return session
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

  const stageOf = (raw: string): QaRunStage | null => QA_RUN_STAGES.includes(raw as QaRunStage) ? raw as QaRunStage : null
  app.get<{ Params: TaskParams & { stage: string } }>(`${base}/runs/:stage`, async (req, reply) => {
    const stage = stageOf(req.params.stage)
    if (!stage) return reply.code(404).send({ error: 'unknown QA stage' })
    return db.listQaStageRuns(uid(req), req.params.projectId, req.params.taskId, stage)
  })
  app.get<{ Params: TaskParams & { stage: string } }>(`${base}/runs/:stage/current`, async (req, reply) => {
    const stage = stageOf(req.params.stage)
    if (!stage) return reply.code(404).send({ error: 'unknown QA stage' })
    return db.listQaStageRuns(uid(req), req.params.projectId, req.params.taskId, stage)[0] ?? reply.code(404).send({ error: 'run not found' })
  })
  app.post<{ Params: TaskParams & { stage: string } }>(`${base}/runs/:stage`, async (req, reply) => {
    try {
      const stage = stageOf(req.params.stage)
      if (!stage) return reply.code(404).send({ error: 'unknown QA stage' })
      const run=db.startQaStageRun(uid(req), req.params.projectId, req.params.taskId, stage)
      boardChanged?.(req.params.projectId)
      return reply.code(202).send(run)
    } catch (error) { return qaError(reply, error) }
  })
  app.delete<{ Params: { runId: string } }>('/api/qa/runs/:runId', async (req, reply) => {
    try { const run=db.cancelQaStageRun(uid(req), req.params.runId); if(run)boardChanged?.(run.projectId); return run ?? reply.code(404).send({ error: 'run not found' }) }
    catch (error) { return qaError(reply, error) }
  })
  app.post<{ Params: { runId: string } }>('/api/qa/runs/:runId/retry', async (req, reply) => {
    try {
      const run = db.retryQaStageRun(uid(req), req.params.runId)
      if (run) boardChanged?.(run.projectId)
      return run ? reply.code(202).send(run) : reply.code(404).send({ error: 'run not found' })
    } catch (error) { return qaError(reply, error) }
  })
  app.post<{ Params: { runId: string }; Body: { answer?: string } }>('/api/qa/runs/:runId/answer', async (req, reply) => {
    try { const run=db.answerQaStageRun(uid(req), req.params.runId, req.body?.answer ?? ''); if(run)boardChanged?.(run.projectId); return run ?? reply.code(404).send({ error: 'run not found' }) }
    catch (error) { return qaError(reply, error) }
  })
}

function detectImageMime(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return null
}
