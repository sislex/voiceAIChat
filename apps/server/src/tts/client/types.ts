import type { TtsRunResource, TtsSynthesisRequest } from '@voicechat/voice-contracts/tts'
import type { TtsVoiceInfo } from '@voicechat/shared'
export interface TtsClient {
 create(request:TtsSynthesisRequest):Promise<TtsRunResource>
 status(runId:string):Promise<TtsRunResource>
 audio(runId:string):Promise<ArrayBuffer>
 cancel(runId:string):Promise<void>
 listVoices():Promise<TtsVoiceInfo[]>
 deleteVoice?(voiceId:string):Promise<void>
}
