import type { TtsRunResource,TtsSynthesisRequest,TtsVoiceInfo } from '@voicechat/shared'
export interface TtsClient {
 create(request:TtsSynthesisRequest):Promise<TtsRunResource>
 status(runId:string):Promise<TtsRunResource>
 audio(runId:string):Promise<ArrayBuffer>
 cancel(runId:string):Promise<void>
 listVoices():Promise<TtsVoiceInfo[]>
 deleteVoice?(voiceId:string):Promise<void>
}
