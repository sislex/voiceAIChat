import { randomUUID } from 'node:crypto'
import type { AutomationJob, AutomationTerminalResult } from '@voicechat/shared'
import type { AutomationExecutor, CancellableExecution } from './ports.js'
import { AutomationStore } from './store.js'

export class DurableQueue {
  private readonly active=new Map<string,{controller:AbortController;execution:CancellableExecution<AutomationTerminalResult>}>()
  private pumping=false
  constructor(private readonly store:AutomationStore,private readonly executor:AutomationExecutor,private readonly concurrency=1,private readonly cancelGraceMs=10_000){}
  start():void { void this.pump() }
  activeCount():number{return this.active.size}
  async close():Promise<void>{ await Promise.all([...this.active.values()].map(async x=>{x.controller.abort();await x.execution.forceCancel()})) }
  async cancel(jobId:string):Promise<boolean>{
    const job=this.store.get(jobId)
    if(!job||['succeeded','failed','cancelled'].includes(job.state)) return false
    if(['queued','waiting_for_questions','waiting_for_plan_approval'].includes(job.state)){
      return this.store.finish(jobId,{resultId:randomUUID(),jobId,outcome:'cancelled',details:{},createdAt:new Date().toISOString()},'cancelled')
    }
    if(!this.store.transition(jobId,['running'],'cancelling')) return job.state==='cancelling'
    const running=this.active.get(jobId)
    if(running){
      running.controller.abort()
      await running.execution.cancel()
      const timer=setTimeout(()=>void running.execution.forceCancel(),this.cancelGraceMs)
      timer.unref()
    }
    return true
  }
  private async pump():Promise<void>{
    if(this.pumping)return
    this.pumping=true
    try{
      while(this.active.size<this.concurrency){
        const job=this.store.next()
        if(!job||!this.store.transition(job.id,['queued'],'running'))break
        this.run(this.store.get(job.id)!)
      }
    }finally{this.pumping=false}
  }
  private run(job:AutomationJob):void{
    const controller=new AbortController()
    const execution=this.executor.execute(job,controller.signal)
    this.active.set(job.id,{controller,execution})
    void execution.result.then(result=>{
      const current=this.store.get(job.id)
      if(current?.state==='cancelling'||current?.state==='cancelled') {
        this.store.appendEvent(job.id,'executor.late_result',{resultId:result.resultId})
        this.store.finish(job.id,{resultId:randomUUID(),jobId:job.id,outcome:'cancelled',details:{},createdAt:new Date().toISOString()},'cancelled')
        return
      }
      const state=result.outcome==='succeeded'||result.outcome==='success'?'succeeded':result.outcome==='cancelled'?'cancelled':'failed'
      this.store.finish(job.id,result,state)
    },error=>{
      const current=this.store.get(job.id)
      const cancelled=current?.state==='cancelling'||current?.state==='cancelled'
      this.store.finish(job.id,{resultId:randomUUID(),jobId:job.id,outcome:cancelled?'cancelled':'failed',details:{message:error instanceof Error?error.message:'executor error'},createdAt:new Date().toISOString()},cancelled?'cancelled':'failed')
    }).finally(()=>{this.active.delete(job.id);void this.pump()})
  }
}
