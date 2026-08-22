import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { VoiceChatDb } from '../db/database.js'
import { uid } from '../users/auth.js'
import { DEFAULT_RELEASE_TIMEOUTS } from '@voicechat/shared'
import { randomUUID } from 'node:crypto'
import { ManagedEnvironmentResolver } from '../releases/managedEnvironmentResolver.js'
import type { ProductionTarget, ReleaseManager, ReleaseProjectTarget } from '../releases/releaseManager.js'

const nf=(reply:FastifyReply):FastifyReply=>reply.code(404).send({error:'not found'})
const forbidden=(reply:FastifyReply):FastifyReply=>reply.code(403).send({error:'forbidden'})
const bad=(reply:FastifyReply,error:unknown):FastifyReply=>reply.code(400).send({error:error instanceof Error?error.message:String(error)})

export function registerReleaseRoutes(app:FastifyInstance,db:VoiceChatDb,releases:ReleaseManager,resolver?:ManagedEnvironmentResolver):void {
  const managed=resolver??new ManagedEnvironmentResolver(db,releases)
  const confirmations=new Map<string,{projectId:string;expiresAt:number}>()
  const project=(req:FastifyRequest,projectId:string)=>db.getProject(uid(req),projectId)
  const ciTarget=(req:FastifyRequest,projectId:string):ReleaseProjectTarget=>{
    const value=project(req,projectId)
    const agentId=value?.defaultAgentId
    if(!value||!agentId)throw new Error('В настройках проекта не выбрана машина по умолчанию')
    const machine=value.machines.find(item=>item.agentId===agentId)
    if(!machine||!db.canUseAgent(uid(req),agentId,projectId))throw new Error('Нет доступа к машине проекта по умолчанию или она не подключена к проекту')
    if(!releases.isOnline(agentId))throw new Error('Машина проекта по умолчанию offline')
    if(!value.gitUrl)throw new Error('Для проекта не задан gitUrl')
    const existingPath=machine.path?.trim()
    const root=machine.reposRoot?.trim().replace(/[\\/]+$/,'')
    if(!existingPath&&!root)throw new Error('У машины для этого проекта не настроена даже root-директория (repos_root)')
    return {projectId,agentId,path:existingPath||`${root}/.release_repo`,prepareCheckout:!existingPath,gitUrl:value.gitUrl,baseBranch:value.ciBaseBranch||'main',testCommand:value.testCommand?.trim()||'npm run typecheck && npm run test',limits:value.releaseTimeouts??DEFAULT_RELEASE_TIMEOUTS}
  }
  const productionTarget=(req:FastifyRequest,projectId:string):ProductionTarget|null=>{
    const value=project(req,projectId)
    const agentId=value?.productionAgentId
    const linked=agentId?value?.machines.some(item=>item.agentId===agentId):false
    if(!value||!agentId||!linked||!value.productionDeployCommand||!value.productionHealthCheckCommand||!value.gitUrl)return null
    if(value.productionEnvironmentMode==='managed')return managed.resolve(uid(req),projectId,'production').target
    if(!value.productionCheckoutPath)return null
    return {projectId,agentId,path:value.productionCheckoutPath,prepareCheckout:false,gitUrl:value.gitUrl,baseBranch:value.ciBaseBranch||'main',testCommand:value.testCommand?.trim()||'npm run typecheck && npm run test',deployCommand:value.productionDeployCommand,healthCheckCommand:value.productionHealthCheckCommand,expectedRepository:value.gitUrl,limits:value.releaseTimeouts??DEFAULT_RELEASE_TIMEOUTS,mode:'legacy'}
  }
  const owner=(req:FastifyRequest,projectId:string):boolean=>db.isProjectOwner(uid(req),projectId)
  const prepareGuard={preHandler:async(req:FastifyRequest,reply:FastifyReply)=>{
    const projectId=(req.params as {id?:string}).id
    if(!projectId||!owner(req,projectId))await forbidden(reply)
  }}
  const deployGuard={preHandler:async(req:FastifyRequest,reply:FastifyReply)=>{
    const params=req.params as {id?:string;runId?:string}
    const projectId=params.id??(params.runId?db.getMergeRun(uid(req),params.runId)?.projectId:undefined)
    if(!projectId||!owner(req,projectId))await forbidden(reply)
  }}

  app.post<{Params:{id:string};Body:{environment?:'production'|'staging'}}>('/api/projects/:id/releases/managed/preflight',deployGuard,async(req,reply)=>{
    try{
      const result=await managed.preflight(uid(req),req.params.id,req.body?.environment??'production')
      if(!result.ok)return reply.code(400).send(result)
      const confirmationToken=randomUUID()
      confirmations.set(confirmationToken,{projectId:req.params.id,expiresAt:Date.now()+5*60_000})
      return {...result,confirmationToken}
    }catch(error){return bad(reply,error)}
  })
  app.post<{Params:{id:string};Body:{confirmationToken?:string}}>('/api/projects/:id/releases/managed/confirm',deployGuard,async(req,reply)=>{
    const token=req.body?.confirmationToken??''
    const confirmation=confirmations.get(token)
    if(!confirmation||confirmation.projectId!==req.params.id||confirmation.expiresAt<Date.now())return bad(reply,'Managed preflight confirmation недействительно или истекло')
    try{
      const result=await managed.preflight(uid(req),req.params.id,'production')
      if(!result.ok)return reply.code(400).send(result)
      confirmations.delete(token)
      return db.updateProject(uid(req),req.params.id,{productionEnvironmentMode:'managed'})??nf(reply)
    }catch(error){return bad(reply,error)}
  })

  app.get<{Params:{id:string}}>('/api/projects/:id/releases/branches',async(req,reply)=>{
    if(!project(req,req.params.id))return nf(reply)
    try{return await releases.listBranches(ciTarget(req,req.params.id))}catch(error){return bad(reply,error)}
  })
  app.post<{Params:{id:string};Body:{branch?:string;baseBranch?:string}}>('/api/projects/:id/releases/branches',prepareGuard,async(req,reply)=>{
    try{const value=ciTarget(req,req.params.id);return reply.code(202).send(await releases.createBranch(uid(req),value,req.body?.branch??'',req.body?.baseBranch??value.baseBranch))}catch(error){return bad(reply,error)}
  })
  app.get<{Params:{id:string}}>('/api/projects/:id/releases',async(req,reply)=>{
    if(!project(req,req.params.id))return nf(reply)
    return db.listProjectReleaseSummaries(uid(req),req.params.id)
  })
  app.post<{Params:{id:string};Body:{branch?:string}}>('/api/projects/:id/releases/deploy',deployGuard,async(req,reply)=>{
    const production=productionTarget(req,req.params.id)
    if(!production)return bad(reply,'Production-машина, checkout, deploy-команда или health-check не настроены')
    try{if(production.mode==='managed'){const check=await managed.preflight(uid(req),req.params.id,'production');if(!check.ok)return reply.code(400).send(check)}return reply.code(202).send(await releases.start(uid(req),ciTarget(req,req.params.id),production,req.body?.branch??''))}catch(error){return bad(reply,error)}
  })
  app.delete<{Params:{id:string;releaseId:string};Body:{branch?:string}}>('/api/projects/:id/releases/:releaseId',prepareGuard,async(req,reply)=>{
    try{await releases.deleteBranch(uid(req),ciTarget(req,req.params.id),req.params.releaseId,req.body?.branch??'');return {deleted:true as const}}catch(error){return bad(reply,error)}
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
    const production=productionTarget(req,run.projectId)
    if(!production)return bad(reply,'Production-машина, checkout, deploy-команда или health-check не настроены')
    try{
      if(production.mode==='managed'){const check=await managed.preflight(uid(req),run.projectId,'production');if(!check.ok)return reply.code(400).send(check)}
      const release=await releases.start(uid(req),ciTarget(req,run.projectId),production,run.targetBranch)
      db.updateMergeRun(run.id,{deployId:release.id,deployVersion:release.version||release.branch,productionStatus:release.status})
      return reply.code(202).send(db.getMergeRun(uid(req),run.id))
    }catch(error){return bad(reply,error)}
  })
}
