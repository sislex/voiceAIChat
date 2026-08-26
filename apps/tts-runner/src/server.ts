import { createReadStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import Fastify,{type FastifyInstance} from 'fastify'
import { TTS_RUNNER,validateTtsSynthesisRequest,type TtsRunnerHealth,type TtsSynthesisRequest } from '@voicechat/shared'
import { registerTtsAuth } from './auth.js'
import type { TtsRunnerConfig } from './config.js'
import { seedVoices } from './engines/seedVoices.js'
import { TtsEngines } from './engines/ttsEngine.js'
import { TtsRunManager } from './run/runManager.js'
export interface BuildTtsRunnerOptions {config:TtsRunnerConfig;runs?:TtsRunManager;engines?:TtsEngines}
const statusFor=(code:string)=>code==='busy'?429:code==='invalid_request'?400:code==='voice_not_found'?404:code==='insufficient_resources'?507:503
export async function buildTtsRunner(opts:BuildTtsRunnerOptions):Promise<FastifyInstance>{
 const {config}=opts;if(!config.token)throw new Error('TTS runner requires VC_TTS_RUNNER_TOKEN')
 const app=Fastify({logger:false,bodyLimit:64*1024});registerTtsAuth(app,config.token)
 const seeded=await seedVoices(config.voicesDir,config.seedVoicesDir);if(seeded.length)console.log(`[tts-runner] голоса по умолчанию скопированы: ${seeded.join(', ')}`)
 const engines=opts.engines??new TtsEngines(config)
 const runs=opts.runs??new TtsRunManager({engines,tempDir:config.tempDir,maxActive:config.maxActive,maxQueue:config.maxQueue,maxWavBytes:config.maxWavBytes,processTimeoutMs:config.processTimeoutMs,orphanMs:config.orphanMs})
 await runs.init()
 app.post<{Body:TtsSynthesisRequest}>(TTS_RUNNER.runs,async(req,reply)=>{const checked=validateTtsSynthesisRequest(req.body,config.maxTextLength);if(!checked.ok)return reply.code(400).send({error:checked.error});try{return reply.code(202).send(runs.create(checked.value!))}catch(cause){const code=String((cause as {code?:unknown}).code??'synthesis_failed');return reply.code(statusFor(code)).send({error:{code,message:cause instanceof Error?cause.message:String(cause)}})}})
 app.get<{Params:{runId:string}}>(`${TTS_RUNNER.runs}/:runId`,async(req,reply)=>runs.get(req.params.runId)??reply.code(404).send({error:{code:'invalid_request',message:'Run not found'}}))
 app.delete<{Params:{runId:string}}>(`${TTS_RUNNER.runs}/:runId`,async(req)=>({stopped:runs.cancel(req.params.runId)}))
 app.get<{Params:{runId:string}}>(`${TTS_RUNNER.runs}/:runId/audio`,async(req,reply)=>{const run=runs.get(req.params.runId);if(!run)return reply.code(404).send({error:{code:'invalid_request',message:'Run not found'}});const path=runs.audioPath(req.params.runId);if(!path)return reply.code(run.status==='failed'||run.status==='cancelled'?410:425).send(run);reply.header('content-type','audio/wav').header('cache-control','no-store');const stream=createReadStream(path);stream.once('close',()=>runs.consume(req.params.runId));return reply.send(stream)})
 app.get(TTS_RUNNER.voices,async()=>engines.listVoices())
 app.delete<{Params:{voiceId:string}}>(`${TTS_RUNNER.voices}/:voiceId`,async(req,reply)=>{if(!/^[A-Za-z0-9_.-]{1,160}$/.test(req.params.voiceId))return reply.code(400).send({error:{code:'invalid_request',message:'Invalid voice'}});await Promise.all([rm(join(config.voicesDir,`${req.params.voiceId}.onnx`),{force:true}),rm(join(config.voicesDir,`${req.params.voiceId}.onnx.json`),{force:true})]);return {ok:true}})
 app.get(TTS_RUNNER.health,async():Promise<TtsRunnerHealth>=>{const a=await engines.availability(),voices=await engines.piperVoices();return {ok:a.piper||a.say,engines:{piper:{available:a.piper},say:{available:a.say}},voices:voices.length,queue:{active:runs.activeCount,waiting:runs.waitingCount,maxActive:config.maxActive,maxWaiting:config.maxQueue}}})
 app.addHook('onClose',async()=>runs.cancelAll());return app
}
