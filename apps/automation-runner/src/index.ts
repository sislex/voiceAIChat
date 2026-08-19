import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AutomationExecutor, CancellableExecution } from './ports.js'
import type { AutomationJob, AutomationTerminalResult } from '@voicechat/shared'
import { buildAutomationRunner } from './server.js'
import { loadConfig } from './config.js'
import { AutomationStore } from './store.js'

const config=loadConfig()
if(!config.token)throw new Error('VC_AUTOMATION_RUNNER_TOKEN is required')
mkdirSync(config.dataDir,{recursive:true})

const dependency=(url:string|undefined)=>({
  async available(){if(!url)return false;try{return (await fetch(url,{signal:AbortSignal.timeout(3000)})).ok}catch{return false}}
})
const executor:AutomationExecutor={
  execute(job:AutomationJob,signal:AbortSignal):CancellableExecution<AutomationTerminalResult>{
    const controller=new AbortController()
    signal.addEventListener('abort',()=>controller.abort(),{once:true})
    const result=Promise.resolve({
      resultId:randomUUID(),jobId:job.id,outcome:'failed' as const,
      details:{code:'executor_adapter_not_configured'},createdAt:new Date().toISOString()
    })
    return {result,async cancel(){controller.abort()},async forceCancel(){controller.abort()}}
  }
}
const machine=dependency(process.env.VC_MACHINE_EXECUTION_HEALTH_URL)
const llm=dependency(process.env.VC_LLM_RUNNER_HEALTH_URL)
const store=new AutomationStore(join(config.dataDir,'automation.sqlite'))
const app=await buildAutomationRunner({token:config.token,store,executor,machine,llm,concurrency:config.concurrency,cancelGraceMs:config.cancelGraceMs})
await app.listen({host:config.host,port:config.port})
