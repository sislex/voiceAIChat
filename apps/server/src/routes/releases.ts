import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { VoiceChatDb } from '../db/database.js'
import { requireProjectPermission, uid } from '../users/auth.js'
import { DEFAULT_RELEASE_TIMEOUTS } from '@voicechat/shared'
import type { ProductionTarget, ReleaseManager, ReleaseProjectTarget } from '../releases/releaseManager.js'

const nf=(reply:FastifyReply):FastifyReply=>reply.code(404).send({error:'not found'})
const forbidden=(reply:FastifyReply):FastifyReply=>reply.code(403).send({error:'forbidden'})
const bad=(reply:FastifyReply,error:unknown):FastifyReply=>reply.code(400).send({error:error instanceof Error?error.message:String(error)})

export function registerReleaseRoutes(app:FastifyInstance,db:VoiceChatDb,releases:ReleaseManager):void {
  const project=(req:FastifyRequest,projectId:string)=>db.getProject(uid(req),projectId)
  const ciTarget=(req:FastifyRequest,projectId:string,selectedAgentId?:string):ReleaseProjectTarget|null=>{
    const value=project(req,projectId)
    const agentId=selectedAgentId??value?.defaultAgentId
    const machine=agentId?value?.machines.find(item=>item.agentId===agentId):undefined
    return value&&agentId&&machine?.path&&db.canUseAgent(uid(req),agentId,projectId)?{projectId,agentId,path:machine.path,baseBranch:value.ciBaseBranch||'main',testCommand:value.testCommand?.trim()||'npm run typecheck && npm run test',limits:value.releaseTimeouts??DEFAULT_RELEASE_TIMEOUTS}:null
  }
  const productionTarget=(req:FastifyRequest,projectId:string):ProductionTarget|null=>{
    const value=project(req,projectId)
    const agentId=value?.productionAgentId
    const linked=agentId?value?.machines.some(item=>item.agentId===agentId):false
    if(!value||!agentId||!linked||!value.productionCheckoutPath||!value.productionDeployCommand||!value.productionHealthCheckCommand||!value.gitUrl)return null
    return {projectId,agentId,path:value.productionCheckoutPath,baseBranch:value.ciBaseBranch||'main',testCommand:value.testCommand?.trim()||'npm run typecheck && npm run test',deployCommand:value.productionDeployCommand,healthCheckCommand:value.productionHealthCheckCommand,expectedRepository:value.gitUrl,limits:value.releaseTimeouts??DEFAULT_RELEASE_TIMEOUTS}
  }
  const owner=(req:FastifyRequest,projectId:string):boolean=>project(req,projectId)?.role==='owner'
  const prepareGuard={preHandler:requireProjectPermission('release:prepare')}
  const deployGuard={preHandler:requireProjectPermission('production:deploy')}

  app.get<{Params:{id:string}}>('/api/projects/:id/releases/branches',async(req,reply)=>{
    const value=ciTarget(req,req.params.id)
    if(!value)return nf(reply)
    try{return await releases.listBranches(value)}catch(error){return bad(reply,error)}
  })
  app.post<{Params:{id:string};Body:{branch?:string;baseBranch?:string;agentId?:string}}>('/api/projects/:id/releases/branches',prepareGuard,async(req,reply)=>{
    const value=ciTarget(req,req.params.id,req.body?.agentId)
    if(!value)return bad(reply,'Выбранная машина недоступна, offline или не имеет checkout проекта')
    if(!releases.isOnline(value.agentId))return bad(reply,'Выбранная машина offline')
    try{return reply.code(202).send(await releases.createBranch(uid(req),value,req.body?.branch??'',req.body?.baseBranch??value.baseBranch))}catch(error){return bad(reply,error)}
  })
  app.get<{Params:{id:string}}>('/api/projects/:id/releases',async(req,reply)=>{
    if(!project(req,req.params.id))return nf(reply)
    return db.listProjectReleases(uid(req),req.params.id)
  })
  app.post<{Params:{id:string};Body:{branch?:string}}>('/api/projects/:id/releases/deploy',deployGuard,async(req,reply)=>{
    const ci=ciTarget(req,req.params.id)
    const production=productionTarget(req,req.params.id)
    if(!ci)return nf(reply)
    if(!production)return bad(reply,'Production-машина, checkout, deploy-команда или health-check не настроены')
    try{return reply.code(202).send(await releases.start(uid(req),ci,production,req.body?.branch??''))}catch(error){return bad(reply,error)}
  })
  app.delete<{Params:{id:string;releaseId:string};Body:{branch?:string}}>('/api/projects/:id/releases/:releaseId',prepareGuard,async(req,reply)=>{
    const value=ciTarget(req,req.params.id)
    if(!value)return nf(reply)
    try{await releases.deleteBranch(uid(req),value,req.params.releaseId,req.body?.branch??'');return {deleted:true as const}}catch(error){return bad(reply,error)}
  })
  app.get<{Params:{id:string;releaseId:string}}>('/api/projects/:id/releases/:releaseId',async(req,reply)=>
    db.getProjectRelease(uid(req),req.params.id,req.params.releaseId)??nf(reply)
  )

  // Деплой из ленты merge-рана: штатный release-механизм по ветке main,
  // идентификатор и статус выпуска сохраняются в снимке рана.
  app.post<{Params:{runId:string}}>('/api/merge/runs/:runId/deploy',deployGuard,async(req,reply)=>{
    const run=db.getMergeRun(uid(req),req.params.runId)
    if(!run)return nf(reply)
    if(run.status!=='success')return bad(reply,'Деплой доступен только после успешного merge')
    const ci=ciTarget(req,run.projectId)
    const production=productionTarget(req,run.projectId)
    if(!ci)return nf(reply)
    if(!production)return bad(reply,'Production-машина, checkout, deploy-команда или health-check не настроены')
    try{
      const release=await releases.start(uid(req),ci,production,run.targetBranch)
      db.updateMergeRun(run.id,{deployId:release.id,deployVersion:release.version||release.branch,productionStatus:release.status})
      return reply.code(202).send(db.getMergeRun(uid(req),run.id))
    }catch(error){return bad(reply,error)}
  })
}
