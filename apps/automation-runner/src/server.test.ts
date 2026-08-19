import { randomUUID } from 'node:crypto'
import { mkdtempSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach,describe,expect,it } from 'vitest'
import { AUTOMATION_PROTOCOL_VERSION,type AutomationJobRequest,type AutomationTerminalResult } from '@voicechat/shared'
import type { AutomationExecutor,CancellableExecution } from './ports.js'
import { buildAutomationRunner } from './server.js'
import { AutomationStore } from './store.js'

const dirs:string[]=[]
const body:AutomationJobRequest={
  protocolVersion:AUTOMATION_PROTOCOL_VERSION,idempotencyKey:'dispatch-1',type:'development',
  snapshot:{projectId:'p',taskId:'t',userId:'u',machineId:'m',repository:'r',workspace:'/w',sourceBranch:'feature/t',sourceSha:'abc',targetBranch:'main',stages:['development'],readiness:{},acceptanceCriteria:['works'],model:{provider:'codex',model:'x'}}
}
function deferredExecutor():{executor:AutomationExecutor;finish:(value:AutomationTerminalResult)=>void}{
  let finish!:(value:AutomationTerminalResult)=>void
  const result=new Promise<AutomationTerminalResult>(resolve=>finish=resolve)
  return {finish,executor:{execute():CancellableExecution<AutomationTerminalResult>{return {result,async cancel(){},async forceCancel(){}}}}}
}
async function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'automation-runner-'));dirs.push(dir)
  const store=new AutomationStore(join(dir,'db.sqlite'))
  const d=deferredExecutor()
  const app=await buildAutomationRunner({token:'secret',store,executor:d.executor,machine:{available:async()=>true},llm:{available:async()=>true}})
  return {app,store,...d}
}
afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true})})
describe('automation runner',()=>{
  it('protects every v1 route and reports redacted capabilities/health',async()=>{
    const {app}=await fixture()
    expect((await app.inject({method:'GET',url:'/v1/health'})).statusCode).toBe(401)
    const health=await app.inject({method:'GET',url:'/v1/health',headers:{authorization:'Bearer secret'}})
    expect(health.statusCode).toBe(200)
    expect(health.body).not.toContain('acceptanceCriteria')
    await app.close()
  })
  it('creates idempotently and replays ordered stable events',async()=>{
    const {app}=await fixture(),headers={authorization:'Bearer secret'}
    const first=await app.inject({method:'POST',url:'/v1/jobs',headers,payload:body})
    const second=await app.inject({method:'POST',url:'/v1/jobs',headers,payload:body})
    expect(first.statusCode).toBe(202);expect(second.statusCode).toBe(200)
    expect(first.json().id).toBe(second.json().id)
    const events=await app.inject({method:'GET',url:`/v1/jobs/${first.json().id}/events?after=0`,headers})
    const values=events.json().events
    expect(values.map((x:{position:number})=>x.position)).toEqual([...values.map((x:{position:number})=>x.position)].sort((a,b)=>a-b))
    expect(new Set(values.map((x:{eventId:string})=>x.eventId)).size).toBe(values.length)
    await app.close()
  })
  it('persists a pause, accepts one answer, and recovers it after reopen',()=>{
    const dir=mkdtempSync(join(tmpdir(),'automation-store-'));dirs.push(dir);const path=join(dir,'db.sqlite')
    const store=new AutomationStore(path),job=store.create({...body,idempotencyKey:'pause'}).job
    store.transition(job.id,['queued'],'running')
    const pause=store.pause(job.id,'questions',{q:'?'},'session')
    store.close()
    const reopened=new AutomationStore(path)
    expect(reopened.get(job.id)?.state).toBe('waiting_for_questions')
    expect(reopened.resume(job.id,pause.id,{answer:'yes'})).toBe(true)
    expect(reopened.resume(job.id,pause.id,{answer:'again'})).toBe(false)
    reopened.close()
  })
  it('cancels queued work without invoking executor',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'automation-cancel-'));dirs.push(dir)
    const store=new AutomationStore(join(dir,'db.sqlite'));let calls=0
    const executor:AutomationExecutor={execute(){calls++;return {result:new Promise(()=>{}),async cancel(){},async forceCancel(){}}}}
    const app=await buildAutomationRunner({token:'secret',store,executor,machine:{available:async()=>true},llm:{available:async()=>true},concurrency:1})
    await app.inject({method:'POST',url:'/v1/jobs',headers:{authorization:'Bearer secret'},payload:{...body,idempotencyKey:'occupy-slot'}})
    const job=store.create({...body,idempotencyKey:randomUUID()}).job
    const response=await app.inject({method:'DELETE',url:`/v1/jobs/${job.id}`,headers:{authorization:'Bearer secret'}})
    expect(response.json()).toEqual({stopped:true});expect(store.get(job.id)?.state).toBe('cancelled');expect(calls).toBe(1)
    await app.close()
  })
})
