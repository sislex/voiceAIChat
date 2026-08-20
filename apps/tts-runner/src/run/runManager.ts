import { randomUUID } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { TtsErrorCode,TtsRunResource,TtsSynthesisRequest } from '@voicechat/shared'
import { TtsEngines } from '../engines/ttsEngine.js'

interface InternalRun { resource:TtsRunResource; request:TtsSynthesisRequest; wavPath:string; child?:ChildProcess; timeout?:NodeJS.Timeout; orphan?:NodeJS.Timeout }
export interface TtsRunManagerOptions { engines:TtsEngines;tempDir:string;maxActive:number;maxQueue:number;maxWavBytes:number;processTimeoutMs:number;orphanMs:number;now?:()=>Date }
const terminal=(s:TtsRunResource['status'])=>s==='succeeded'||s==='failed'||s==='cancelled'
const codeOf=(cause:unknown):TtsErrorCode=>{const c=(cause as {code?:unknown})?.code;return ['engine_unavailable','voice_not_found','invalid_request','busy','timeout','cancelled','synthesis_failed','insufficient_resources'].includes(String(c))?c as TtsErrorCode:'synthesis_failed'}

export class TtsRunManager {
 private readonly runs=new Map<string,InternalRun>();private queue:string[]=[];private active=0;private readonly now:()=>Date
 constructor(private readonly opts:TtsRunManagerOptions){this.now=opts.now??(()=>new Date())}
 get size(){return this.runs.size}
 get activeCount(){return this.active}
 get waitingCount(){return this.queue.length}
 async init():Promise<void>{await mkdir(this.opts.tempDir,{recursive:true});for(const file of await readdir(this.opts.tempDir).catch(()=>[]))if(file.endsWith('.wav')||file.endsWith('.part'))await rm(join(this.opts.tempDir,file),{force:true}).catch(()=>{})}
 create(request:TtsSynthesisRequest):TtsRunResource {
  if(this.active>=this.opts.maxActive&&this.queue.length>=this.opts.maxQueue)throw Object.assign(new Error('TTS queue is full'),{code:'busy'})
  const runId=randomUUID(),createdAt=this.now().toISOString()
  const run:InternalRun={request,wavPath:join(this.opts.tempDir,`${runId}.wav`),resource:{version:1,runId,status:'queued',engine:null,voice:null,createdAt,startedAt:null,finishedAt:null,error:null,audioReady:false}}
  this.runs.set(runId,run);this.queue.push(runId);this.pump();return {...run.resource}
 }
 get(id:string):TtsRunResource|undefined {const r=this.runs.get(id);return r?{...r.resource,error:r.resource.error?{...r.resource.error}:null}:undefined}
 audioPath(id:string):string|undefined {const r=this.runs.get(id);return r?.resource.status==='succeeded'&&r.resource.audioReady?r.wavPath:undefined}
 consume(id:string):void {const r=this.runs.get(id);if(!r)return;clearTimeout(r.orphan);r.orphan=setTimeout(()=>this.cleanup(id),100);r.orphan.unref()}
 cancel(id:string):boolean {const r=this.runs.get(id);if(!r||terminal(r.resource.status))return false;if(r.resource.status==='queued')this.queue=this.queue.filter(x=>x!==id);if(r.child)this.opts.engines.stop(r.child);this.finish(r,'cancelled','cancelled','Cancelled');this.pump();return true}
 cancelOwner(ownerId:string):void {for(const [id,r] of this.runs)if(r.request.ownerId===ownerId&&!terminal(r.resource.status))this.cancel(id)}
 cancelAll():void {for(const id of this.runs.keys())this.cancel(id)}
 private finish(run:InternalRun,status:'succeeded'|'failed'|'cancelled',code?:TtsErrorCode,message?:string):boolean {
  if(terminal(run.resource.status))return false
  const wasRunning=run.resource.status==='running';clearTimeout(run.timeout);run.resource.status=status;run.resource.finishedAt=this.now().toISOString();run.resource.audioReady=status==='succeeded';run.resource.error=code?{code,message:message??code}:null
  if(wasRunning)this.active=Math.max(0,this.active-1)
  if(status!=='succeeded')void rm(run.wavPath,{force:true})
  run.orphan=setTimeout(()=>this.cleanup(run.resource.runId),this.opts.orphanMs);run.orphan.unref();return true
 }
 private cleanup(id:string):void {const r=this.runs.get(id);if(!r||!terminal(r.resource.status))return;clearTimeout(r.orphan);void rm(r.wavPath,{force:true});this.runs.delete(id)}
 private pump():void {while(this.active<this.opts.maxActive&&this.queue.length){const id=this.queue.shift()!,run=this.runs.get(id);if(!run||run.resource.status!=='queued')continue;this.active++;run.resource.status='running';run.resource.startedAt=this.now().toISOString();void this.execute(run)}}
 private async execute(run:InternalRun):Promise<void>{
  try{
   const exec=await this.opts.engines.start(run.request,run.wavPath)
   if(run.resource.status!=='running'){this.opts.engines.stop(exec.child);return}
   run.child=exec.child;run.resource.engine=exec.engine;run.resource.voice=exec.voice
   run.timeout=setTimeout(()=>{if(run.resource.status==='running'){this.opts.engines.stop(exec.child);this.finish(run,'failed','timeout','Synthesis timed out');this.pump()}},this.opts.processTimeoutMs);run.timeout.unref()
   await exec.done
   if(run.resource.status!=='running')return
   await this.opts.engines.validateWav(run.wavPath,this.opts.maxWavBytes)
   this.finish(run,'succeeded')
  }catch(cause){if(run.resource.status==='running')this.finish(run,'failed',codeOf(cause),cause instanceof Error?cause.message:String(cause))}
  finally{run.child=undefined;this.pump()}
 }
}
