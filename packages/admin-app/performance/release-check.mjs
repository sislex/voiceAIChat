import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { verifyPerformanceRelease } from '../src/store/releaseVerification.ts'
const healthUrl=process.env.RELEASE_HEALTH_URL
if(!healthUrl) throw new Error('RELEASE_HEALTH_URL is required; this command never deploys')
await verifyPerformanceRelease({
  expectedCommit:process.env.RELEASE_COMMIT ?? '',
  gate:()=>new Promise((resolve,reject)=>{
    const child=spawn('npm',['run','gate:fast'],{cwd:fileURLToPath(new URL('../../../',import.meta.url)),stdio:'inherit'})
    child.once('error',reject)
    child.once('exit',code=>code===0?resolve():reject(new Error('gate:fast exited '+code)))
  }),
  health:async()=>{
    const response=await fetch(healthUrl,{signal:AbortSignal.timeout(10000)})
    if(!response.ok) throw new Error('Production health HTTP '+response.status)
    return response.json()
  }
})
console.log('Gate and exact production release health verified')
