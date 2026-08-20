import { describe,expect,it } from 'vitest'
import type { TtsRunResource } from '@voicechat/shared'
import { buildTtsRunner } from './server.js'
import { loadTtsRunnerConfig } from './config.js'
import type { TtsRunManager } from './run/runManager.js'
import type { TtsEngines } from './engines/ttsEngine.js'
const token='secret'
const config=loadTtsRunnerConfig({VC_TTS_RUNNER_TOKEN:token,PORT:'0'})
const resource:TtsRunResource={version:1,runId:'r1',status:'queued',engine:null,voice:null,createdAt:new Date(0).toISOString(),startedAt:null,finishedAt:null,error:null,audioReady:false}
function fakes(){
 const runs={init:async()=>{},create:()=>resource,get:()=>resource,cancel:()=>true,cancelAll:()=>{},get activeCount(){return 0},get waitingCount(){return 0}} as unknown as TtsRunManager
 const engines={listVoices:async()=>[{id:'v',label:'V'}],piperVoices:async()=>[{id:'v',label:'V'}],availability:async()=>({piper:true,say:false})} as unknown as TtsEngines
 return {runs,engines}
}
describe('TTS runner contract',()=>{
 it('rejects every v1 operation before executing it',async()=>{const app=await buildTtsRunner({config,...fakes()});expect((await app.inject({method:'GET',url:'/v1/health'})).statusCode).toBe(401);expect((await app.inject({method:'POST',url:'/v1/runs',payload:{}})).statusCode).toBe(401);await app.close()})
 it('validates create and returns resource',async()=>{const app=await buildTtsRunner({config,...fakes()}),headers={authorization:`Bearer ${token}`};expect((await app.inject({method:'POST',url:'/v1/runs',headers,payload:{}})).statusCode).toBe(400);const res=await app.inject({method:'POST',url:'/v1/runs',headers,payload:{version:1,text:'hello',voice:'v',format:'wav'}});expect(res.statusCode).toBe(202);expect(res.json()).toMatchObject({runId:'r1',status:'queued'});await app.close()})
 it('reports health, voices, status and idempotent cancel',async()=>{const app=await buildTtsRunner({config,...fakes()}),headers={authorization:`Bearer ${token}`};expect((await app.inject({url:'/v1/health',headers})).json()).toMatchObject({ok:true,voices:1});expect((await app.inject({url:'/v1/voices',headers})).json()).toEqual([{id:'v',label:'V'}]);expect((await app.inject({url:'/v1/runs/r1',headers})).json()).toMatchObject({runId:'r1'});expect((await app.inject({method:'DELETE',url:'/v1/runs/r1',headers})).json()).toEqual({stopped:true});await app.close()})
})
