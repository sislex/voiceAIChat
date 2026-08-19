import Fastify,{type FastifyInstance} from 'fastify'
import {
  AUTOMATION_JOB_STATES,AUTOMATION_JOB_TYPES,AUTOMATION_PROTOCOL_VERSION,AUTOMATION_RUNNER,
  type AutomationCapabilities,type AutomationJobRequest
} from '@voicechat/shared'
import type { AutomationExecutor, LlmRunnerPort, MachineExecutionPort } from './ports.js'
import { DurableQueue } from './queue.js'
import { AutomationStore } from './store.js'

export interface BuildAutomationRunnerOptions {
  token:string; store:AutomationStore; executor:AutomationExecutor
  machine:Pick<MachineExecutionPort,'available'>; llm:Pick<LlmRunnerPort,'available'>
  concurrency?:number; cancelGraceMs?:number
}
function valid(body:unknown):body is AutomationJobRequest{
  if(!body||typeof body!=='object')return false
  const b=body as Partial<AutomationJobRequest>,s=b.snapshot
  return b.protocolVersion===AUTOMATION_PROTOCOL_VERSION&&typeof b.idempotencyKey==='string'&&b.idempotencyKey.length>0&&
    AUTOMATION_JOB_TYPES.includes(b.type as never)&&!!s&&
    [s.projectId,s.taskId,s.userId,s.machineId,s.repository,s.workspace,s.sourceBranch,s.sourceSha,s.targetBranch].every(x=>typeof x==='string'&&x.length>0)&&
    Array.isArray(s.stages)&&Array.isArray(s.acceptanceCriteria)&&!!s.model&&typeof s.model.provider==='string'&&typeof s.model.model==='string'
}
export async function buildAutomationRunner(opts:BuildAutomationRunnerOptions):Promise<FastifyInstance>{
  if(!opts.token)throw new Error('Automation Runner requires VC_AUTOMATION_RUNNER_TOKEN')
  const app=Fastify({logger:false,bodyLimit:4*1024*1024})
  const queue=new DurableQueue(opts.store,opts.executor,opts.concurrency,opts.cancelGraceMs)
  app.addHook('onRequest',async(req,reply)=>{
    if(!req.url.startsWith('/v1/'))return
    if(req.headers.authorization!==`Bearer ${opts.token}`)return reply.code(401).send({error:'unauthorized'})
  })
  app.post<{Body:unknown}>(AUTOMATION_RUNNER.jobs,async(req,reply)=>{
    if(!valid(req.body))return reply.code(400).send({error:'invalid_job_or_protocol'})
    const value=opts.store.create(req.body)
    queue.start()
    return reply.code(value.created?202:200).send(value.job)
  })
  app.get<{Params:{id:string}}>(`${AUTOMATION_RUNNER.jobs}/:id`,async(req,reply)=>{
    const job=opts.store.get(req.params.id)
    return job??reply.code(404).send({error:'job_not_found'})
  })
  app.delete<{Params:{id:string}}>(`${AUTOMATION_RUNNER.jobs}/:id`,async(req)=>({stopped:await queue.cancel(req.params.id)}))
  app.post<{Params:{id:string};Body:{pauseId?:string;answer?:unknown}}>(`${AUTOMATION_RUNNER.jobs}/:id/resume`,async(req,reply)=>{
    if(!req.body?.pauseId)return reply.code(400).send({error:'pause_id_required'})
    return opts.store.resume(req.params.id,req.body.pauseId,req.body.answer)
      ?reply.code(202).send({resumed:true})
      :reply.code(409).send({error:'pause_already_answered_or_closed'})
  })
  app.get<{Params:{id:string};Querystring:{after?:string}}>(`${AUTOMATION_RUNNER.jobs}/:id/events`,async(req,reply)=>{
    if(!opts.store.get(req.params.id))return reply.code(404).send({error:'job_not_found'})
    const after=Number(req.query.after??0)
    if(!Number.isSafeInteger(after)||after<0)return reply.code(400).send({error:'invalid_position'})
    return {events:opts.store.events(req.params.id,after)}
  })
  app.get(AUTOMATION_RUNNER.capabilities,async():Promise<AutomationCapabilities>=>({
    protocolVersions:[AUTOMATION_PROTOCOL_VERSION],jobTypes:AUTOMATION_JOB_TYPES,states:AUTOMATION_JOB_STATES,durable:true
  }))
  app.get(AUTOMATION_RUNNER.health,async()=>{
    const [machineExecution,llmRunner]=await Promise.all([opts.machine.available(),opts.llm.available()])
    return {ok:machineExecution&&llmRunner,protocolVersion:AUTOMATION_PROTOCOL_VERSION,...opts.store.counts(),dependencies:{machineExecution,llmRunner}}
  })
  app.addHook('onReady',async()=>queue.start())
  app.addHook('onClose',async()=>{await queue.close();opts.store.close()})
  return app
}
