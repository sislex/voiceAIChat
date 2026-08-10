import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { VoiceChatDb } from '../db/database.js'
import { uid } from '../users/auth.js'
import type { ReleaseManager, ReleaseProjectTarget } from '../releases/releaseManager.js'

const nf=(reply:FastifyReply):FastifyReply=>reply.code(404).send({error:'not found'})
const forbidden=(reply:FastifyReply):FastifyReply=>reply.code(403).send({error:'forbidden'})
const bad=(reply:FastifyReply,error:unknown):FastifyReply=>reply.code(400).send({error:error instanceof Error?error.message:String(error)})

export function registerReleaseRoutes(app:FastifyInstance,db:VoiceChatDb,releases:ReleaseManager):void {
  const target=(req:FastifyRequest,projectId:string):ReleaseProjectTarget|null=>{
    const project=db.getProject(uid(req),projectId)
    if(!project)return null
    const agentId=project.defaultAgentId
    const machine=agentId?project.machines.find(item=>item.agentId===agentId):undefined
    if(!agentId||!machine?.path)return null
    return {projectId,agentId,path:machine.path,baseBranch:project.ciBaseBranch||'main'}
  }
  const owner=(req:FastifyRequest,projectId:string):boolean=>db.getProject(uid(req),projectId)?.role==='owner'

  app.get<{Params:{id:string}}>('/api/projects/:id/releases/branches',async(req,reply)=>{
    const value=target(req,req.params.id)
    if(!value)return nf(reply)
    try{return await releases.listBranches(value)}catch(error){return bad(reply,error)}
  })
  app.post<{Params:{id:string};Body:{branch?:string;baseBranch?:string}}>('/api/projects/:id/releases/branches',async(req,reply)=>{
    if(!owner(req,req.params.id))return forbidden(reply)
    const value=target(req,req.params.id)
    if(!value)return nf(reply)
    try{return reply.code(201).send(await releases.createBranch(value,req.body?.branch??'',req.body?.baseBranch??value.baseBranch))}catch(error){return bad(reply,error)}
  })
  app.get<{Params:{id:string}}>('/api/projects/:id/releases',async(req,reply)=>{
    if(!db.getProject(uid(req),req.params.id))return nf(reply)
    return db.listProjectReleases(uid(req),req.params.id)
  })
  app.post<{Params:{id:string};Body:{branch?:string;models?:Record<string,string>;previousReleaseId?:string}}>('/api/projects/:id/releases/deploy',async(req,reply)=>{
    if(!owner(req,req.params.id))return forbidden(reply)
    const value=target(req,req.params.id)
    if(!value)return nf(reply)
    try{
      const release=await releases.start(uid(req),value,req.body?.branch??'',req.body?.models,req.body?.previousReleaseId)
      return reply.code(202).send(release)
    }catch(error){return bad(reply,error)}
  })
  app.get<{Params:{id:string;releaseId:string}}>('/api/projects/:id/releases/:releaseId',async(req,reply)=>
    db.getProjectRelease(uid(req),req.params.id,req.params.releaseId)??nf(reply)
  )
}
