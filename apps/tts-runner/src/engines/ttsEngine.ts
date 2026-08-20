import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { access, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { prepareTtsText, type TtsEngineKind, type TtsSynthesisRequest, type TtsVoiceInfo } from '@voicechat/shared'

export type SpawnFn=(command:string,args:string[])=>ChildProcess
export interface EngineConfig { piperBin:string; sayBin:string; voicesDir:string; killGraceMs:number; spawn?:SpawnFn }
export interface EngineExecution { engine:'piper'|'say'; voice:string; child:ChildProcess; done:Promise<void> }

const exists=async(path:string)=>access(path).then(()=>true,()=>false)
const safeId=(id:string)=>/^[A-Za-z0-9_.-]{1,160}$/.test(id)
const languageOf=(id:string)=>/^([a-z]{2})[_-]/i.exec(id)?.[1]?.toLowerCase()

export class TtsEngines {
 private readonly spawnFn:SpawnFn
 constructor(private readonly config:EngineConfig){this.spawnFn=config.spawn??(nodeSpawn as unknown as SpawnFn)}
 async piperVoices():Promise<TtsVoiceInfo[]> {
  let files:string[]=[];try{files=await readdir(this.config.voicesDir)}catch{return []}
  const ids=files.filter(f=>f.endsWith('.onnx')).map(f=>f.slice(0,-5))
  const valid:string[]=[]
  for(const id of ids)if(await exists(join(this.config.voicesDir,`${id}.onnx.json`)))valid.push(id)
  return valid.map(id=>({id,label:id}))
 }
 async availability():Promise<{piper:boolean;say:boolean}> {
  const piper=(await this.piperVoices()).length>0 && await exists(this.config.piperBin)
  const say=process.platform==='darwin' && await exists(this.config.sayBin)
  return {piper,say}
 }
 async listVoices():Promise<TtsVoiceInfo[]> {
  const piper=await this.piperVoices()
  if(piper.length)return piper
  if(process.platform!=='darwin')return []
  return new Promise(resolve=>{let out='';let child:ChildProcess;try{child=this.spawnFn(this.config.sayBin,['-v','?'])}catch{return resolve([])};child.stdout?.on('data',(d:Buffer)=>out+=d);child.once('error',()=>resolve([]));child.once('close',()=>resolve(out.split('\n').map(line=>/^([^\s]+)\s+([a-z]{2})_/i.exec(line)).filter((m):m is RegExpExecArray=>Boolean(m)).map(m=>({id:`say:${m[1]}`,label:m[1]}))))})
 }
 async start(req:TtsSynthesisRequest,wavPath:string):Promise<EngineExecution> {
  if(!safeId(req.voice))throw Object.assign(new Error('Voice not found'),{code:'voice_not_found'})
  const available=await this.availability()
  const wanted:TtsEngineKind=req.engine??'auto'
  let engine:'piper'|'say'
  if(wanted==='piper'||(wanted==='auto'&&available.piper))engine='piper'
  else if(wanted==='say'||(wanted==='auto'&&available.say))engine='say'
  else throw Object.assign(new Error('No TTS engine available'),{code:'engine_unavailable'})
  let args:string[]
  if(engine==='piper'){
   const voices=await this.piperVoices()
   if(!voices.some(v=>v.id===req.voice))throw Object.assign(new Error('Voice not found'),{code:'voice_not_found'})
   args=['-m',join(this.config.voicesDir,`${req.voice}.onnx`),'-f',wavPath]
  }else{
   const name=req.voice.startsWith('say:')?req.voice.slice(4):req.voice
   if(req.language&&languageOf(req.voice)&&languageOf(req.voice)!==req.language.slice(0,2).toLowerCase())throw Object.assign(new Error('Voice language mismatch'),{code:'voice_not_found'})
   args=['-v',name,'--data-format=LEI16@22050','-o',wavPath,'-f','-']
  }
  let child:ChildProcess
  try{child=this.spawnFn(engine==='piper'?this.config.piperBin:this.config.sayBin,args)}catch(cause){throw Object.assign(new Error(String(cause)),{code:'engine_unavailable'})}
  const done=new Promise<void>((resolve,reject)=>{let settled=false;const finish=(err?:Error)=>{if(settled)return;settled=true;err?reject(err):resolve()};child.once('error',e=>finish(e));child.once('close',(code,signal)=>code===0?finish():finish(Object.assign(new Error(`TTS process failed (${code??signal})`),{code:'synthesis_failed'})))})
  child.stdin?.end(prepareTtsText(req.text))
  return {engine,voice:req.voice,child,done}
 }
 async validateWav(path:string,maxBytes:number):Promise<void>{const info=await stat(path);if(info.size<44)throw Object.assign(new Error('Invalid WAV'),{code:'synthesis_failed'});if(info.size>maxBytes)throw Object.assign(new Error('WAV limit exceeded'),{code:'insufficient_resources'})}
 stop(child:ChildProcess):void {if(child.exitCode!==null||child.killed)return;try{child.kill('SIGTERM')}catch{};const timer=setTimeout(()=>{if(child.exitCode===null)try{child.kill('SIGKILL')}catch{}},this.config.killGraceMs);timer.unref()}
}
