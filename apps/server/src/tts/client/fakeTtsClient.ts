import type { TtsRunResource,TtsSynthesisRequest,TtsVoiceInfo } from '@voicechat/shared'
import type { TtsClient } from './types.js'
export class FakeTtsClient implements TtsClient {
 readonly requests:TtsSynthesisRequest[]=[];readonly cancelled:string[]=[];private n=0
 constructor(private readonly wav:ArrayBuffer=new ArrayBuffer(44),private readonly voices:TtsVoiceInfo[]=[]){}
 async create(request:TtsSynthesisRequest):Promise<TtsRunResource>{this.requests.push(request);const now=new Date().toISOString();return {version:1,runId:`fake-${++this.n}`,status:'succeeded',engine:'piper',voice:request.voice,createdAt:now,startedAt:now,finishedAt:now,error:null,audioReady:true}}
 async status(id:string):Promise<TtsRunResource>{const now=new Date().toISOString();return {version:1,runId:id,status:'succeeded',engine:'piper',voice:'fake',createdAt:now,startedAt:now,finishedAt:now,error:null,audioReady:true}}
 async audio():Promise<ArrayBuffer>{return this.wav}
 async cancel(id:string):Promise<void>{this.cancelled.push(id)}
 async listVoices():Promise<TtsVoiceInfo[]>{return this.voices}
}
