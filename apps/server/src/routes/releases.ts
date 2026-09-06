import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { VoiceChatDb } from '../db/database.js'
import { uid } from '../users/auth.js'
import { randomUUID } from 'node:crypto'
import { ManagedEnvironmentResolver } from '../releases/managedEnvironmentResolver.js'
import type { ProductionTarget, ReleaseManager, ReleaseProjectTarget } from '../releases/releaseManager.js'
import type { AgentRegistry } from '../agents/registry.js'
import { materializeProjectMachine } from '../projects/materialize.js'
import { releaseCiTarget, releaseProductionTarget } from '../releases/targets.js'

const DEFAULT_PRODUCTION_DEPLOY_COMMAND = '/usr/local/bin/voicechat-deploy'
const DEFAULT_PRODUCTION_HEALTH_CHECK_COMMAND = 'curl -fsS --max-time 10 http://127.0.0.1:8787/api/health'

const nf=(reply:FastifyReply):FastifyReply=>reply.code(404).send({error:'not found'})
const forbidden=(reply:FastifyReply):FastifyReply=>reply.code(403).send({error:'forbidden'})
const bad=(reply:FastifyReply,error:unknown):FastifyReply=>reply.code(400).send({error:error instanceof Error?error.message:String(error)})

export function registerReleaseRoutes(app:FastifyInstance,db:VoiceChatDb,releases:ReleaseManager,resolver?:ManagedEnvironmentResolver,agents?:AgentRegistry):void {
  const managed=resolver??new ManagedEnvironmentResolver(db,releases)
  const confirmations=new Map<string,{projectId:string;expiresAt:number}>()
  const project=(req:FastifyRequest,projectId:string)=>db.projects.getProject(uid(req),projectId)
  // Правила «куда выпускать» общие с инструментами ассистента (releases/targets.ts).
  const ciTarget=(req:FastifyRequest,projectId:string):ReleaseProjectTarget=>releaseCiTarget(db,releases,uid(req),projectId)
  const productionTarget=(req:FastifyRequest,projectId:string):ProductionTarget|null=>releaseProductionTarget(db,managed,uid(req),projectId)
  const owner=(req:FastifyRequest,projectId:string):boolean=>db.projects.isProjectOwner(uid(req),projectId)
  const prepareGuard={preHandler:async(req:FastifyRequest,reply:FastifyReply)=>{
    const projectId=(req.params as {id?:string}).id
    if(!projectId||!owner(req,projectId))await forbidden(reply)
  }}
  const deployGuard={preHandler:async(req:FastifyRequest,reply:FastifyReply)=>{
    const params=req.params as {id?:string;runId?:string}
    const projectId=params.id??(params.runId?db.ci.getMergeRun(uid(req),params.runId)?.projectId:undefined)
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
      return db.projects.updateProject(uid(req),req.params.id,{productionEnvironmentMode:'managed'})??nf(reply)
    }catch(error){return bad(reply,error)}
  })

  // Авто-подготовка прод-машины одним запросом: storage → привязка+каталоги →
  // дефолтные deploy/health-команды → default-машина (если валидной нет) → managed
  // preflight+confirm. Цель: после выбора новой прод-машины прод/merge/таски/чаты
  // работают сразу, а руками остаётся только `claude/codex login` на машине.
  app.post<{Params:{id:string};Body:{agentId?:string;storageId?:string;deployCommand?:string;healthCheckCommand?:string}}>('/api/projects/:id/production/bootstrap',deployGuard,async(req,reply)=>{
    const userId=uid(req), projectId=req.params.id
    try{
      const current=project(req,projectId)
      if(!current)return nf(reply)
      if(!agents)return bad(reply,'Реестр машин недоступен на этом сервере')
      const agentId=req.body?.agentId
      if(!agentId)return bad(reply,'Не выбрана машина для production')
      if(!current.gitUrl)return bad(reply,'Для проекта не задан gitUrl — задайте его в настройках проекта')
      if(!db.machines.canUseAgent(userId,agentId,projectId))return bad(reply,'Нет доступа к выбранной машине')
      if(!releases.isOnline(agentId))return bad(reply,'Машина не в сети — подключите агента и повторите')
      // 1. Storage: берём указанный или первый у машины (создание storage требует
      //    root-путь и делается разово при добавлении машины).
      const storages=db.machines.listMachineStorages(userId,agentId)
      const storage=req.body?.storageId?storages.find(s=>s.id===req.body!.storageId):storages[0]
      if(!storage)return bad(reply,'У машины нет хранилища (MachineStorage) — создайте его в настройках машины и повторите')
      // 2. Привязка к проекту + канонические каталоги окружений.
      db.machines.linkMachine(userId,projectId,agentId,storage.id)
      await materializeProjectMachine(db,agents,userId,projectId,agentId,storage.id)
      // 3. Production-поля: машина + дефолтные команды (существующие не затираем).
      db.projects.updateProject(userId,projectId,{
        productionAgentId:agentId,
        productionDeployCommand:current.productionDeployCommand?.trim()||req.body?.deployCommand?.trim()||DEFAULT_PRODUCTION_DEPLOY_COMMAND,
        productionHealthCheckCommand:current.productionHealthCheckCommand?.trim()||req.body?.healthCheckCommand?.trim()||DEFAULT_PRODUCTION_HEALTH_CHECK_COMMAND
      })
      // 4. Default-машина для CI/merge/тасков, если валидной ещё нет.
      const defaultMachineSet=!db.machines.getUserProjectDefaultMachine(userId,projectId)
      if(defaultMachineSet)db.machines.setUserProjectDefaultMachine(userId,projectId,agentId)
      // 5. Managed preflight → при успехе включаем managed-режим (как confirm).
      const preflight=await managed.preflight(userId,projectId,'production')
      if(preflight.ok)db.projects.updateProject(userId,projectId,{productionEnvironmentMode:'managed'})
      const mode=(db.projects.getProject(userId,projectId)?.productionEnvironmentMode==='managed')?'managed' as const:'legacy' as const
      return {ok:preflight.ok,mode,defaultMachineSet,preflight,cliLoginHint:'Остался один ручной шаг: выполните `claude login` и/или `codex login` на новой прод-машине (в контейнере runner-work), иначе таски и merge не смогут вызывать модель.'}
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
    return db.releases.listProjectReleaseSummaries(uid(req),req.params.id)
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
    db.releases.getProjectRelease(uid(req),req.params.id,req.params.releaseId)??nf(reply)
  )

  // Деплой из ленты merge-рана: штатный release-механизм по ветке main,
  // идентификатор и статус выпуска сохраняются в снимке рана.
  app.post<{Params:{runId:string}}>('/api/merge/runs/:runId/deploy',deployGuard,async(req,reply)=>{
    const run=db.ci.getMergeRun(uid(req),req.params.runId)
    if(!run)return nf(reply)
    if(run.status!=='success')return bad(reply,'Деплой доступен только после успешного merge')
    const production=productionTarget(req,run.projectId)
    if(!production)return bad(reply,'Production-машина, checkout, deploy-команда или health-check не настроены')
    try{
      if(production.mode==='managed'){const check=await managed.preflight(uid(req),run.projectId,'production');if(!check.ok)return reply.code(400).send(check)}
      const release=await releases.start(uid(req),ciTarget(req,run.projectId),production,run.targetBranch)
      db.ci.updateMergeRun(run.id,{deployId:release.id,deployVersion:release.version||release.branch,productionStatus:release.status})
      return reply.code(202).send(db.ci.getMergeRun(uid(req),run.id))
    }catch(error){return bad(reply,error)}
  })
}
