import { TTS_RUNNER,isTtsRunResource,ttsRunAudioPath,ttsRunPath,type TtsRunResource,type TtsSynthesisRequest,type TtsVoiceInfo } from '@voicechat/shared'
import type { TtsClient } from './types.js'
export interface RemoteTtsClientOptions {baseUrl:string;token:string;pollMs?:number;fetch?:typeof fetch}
export class RemoteTtsClient implements TtsClient {
 private readonly fetchImpl:typeof fetch;private readonly pollMs:number
 constructor(private readonly opts:RemoteTtsClientOptions){this.fetchImpl=opts.fetch??fetch;this.pollMs=opts.pollMs??25}
 private call(path:string,init:RequestInit={}):Promise<Response>{return this.fetchImpl(new URL(path,this.opts.baseUrl),{...init,headers:{authorization:`Bearer ${this.opts.token}`,...init.headers}})}
 async create(request:TtsSynthesisRequest):Promise<TtsRunResource>{const res=await this.call(TTS_RUNNER.runs,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request)});const json:unknown=await res.json();if(!res.ok||!isTtsRunResource(json))throw new Error(`TTS create failed: ${res.status}`);return json}
 async status(id:string):Promise<TtsRunResource>{const res=await this.call(ttsRunPath(id));const json:unknown=await res.json();if(!res.ok||!isTtsRunResource(json))throw new Error(`TTS status failed: ${res.status}`);return json}
 async wait(id:string):Promise<TtsRunResource>{for(;;){const run=await this.status(id);if(run.status==='succeeded')return run;if(run.status==='failed'||run.status==='cancelled')throw new Error(run.error?.message??run.status);await new Promise(r=>setTimeout(r,this.pollMs))}}
 async audio(id:string):Promise<ArrayBuffer>{await this.wait(id);const res=await this.call(ttsRunAudioPath(id));if(!res.ok)throw new Error(`TTS audio failed: ${res.status}`);return res.arrayBuffer()}
 async cancel(id:string):Promise<void>{await this.call(ttsRunPath(id),{method:'DELETE'}).catch(()=>undefined)}
 async listVoices():Promise<TtsVoiceInfo[]>{const res=await this.call(TTS_RUNNER.voices);if(!res.ok)return [];const value:unknown=await res.json();return Array.isArray(value)?value.filter((v):v is TtsVoiceInfo=>Boolean(v)&&typeof v==='object'&&typeof (v as TtsVoiceInfo).id==='string'&&typeof (v as TtsVoiceInfo).label==='string'):[]}
 async deleteVoice(id:string):Promise<void>{const res=await this.call(`${TTS_RUNNER.voices}/${encodeURIComponent(id)}`,{method:'DELETE'});if(!res.ok)throw new Error(`TTS voice delete failed: ${res.status}`)}
}
