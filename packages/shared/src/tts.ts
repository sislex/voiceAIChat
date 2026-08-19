import type { TtsVoiceInfo } from './types'

export const TTS_CONTRACT_VERSION = 1 as const
export const TTS_RUNNER = { runs: '/v1/runs', health: '/v1/health', voices: '/v1/voices', voiceDownloads: '/v1/voice-downloads' } as const
export const TTS_ERROR_CODES = ['engine_unavailable','voice_not_found','invalid_request','busy','timeout','cancelled','synthesis_failed','insufficient_resources'] as const
export type TtsErrorCode = (typeof TTS_ERROR_CODES)[number]
export type TtsRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type TtsEngineKind = 'piper' | 'say' | 'auto'
export interface TtsSynthesisRequest { version: 1; text: string; voice: string; language?: string; engine?: TtsEngineKind; rate?: number; format: 'wav'; ownerId?: string }
export interface TtsRunError { code: TtsErrorCode; message: string }
export interface TtsRunResource { version: 1; runId: string; status: TtsRunStatus; engine: Exclude<TtsEngineKind,'auto'> | null; voice: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null; error: TtsRunError | null; audioReady: boolean }
export interface TtsRunnerHealth { ok: boolean; engines: { piper: { available: boolean }; say: { available: boolean } }; voices: number; queue: { active: number; waiting: number; maxActive: number; maxWaiting: number } }
export interface TtsVoiceCatalogResource { downloadable: boolean; voices: Array<TtsVoiceInfo & { installed?: boolean }> }
export interface TtsValidationResult<T> { ok: boolean; value?: T; error?: TtsRunError }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
export function validateTtsSynthesisRequest(value: unknown, maxTextLength = 8_000): TtsValidationResult<TtsSynthesisRequest> {
  if (!object(value)) return { ok:false, error:{ code:'invalid_request', message:'JSON object required' } }
  const engine=value.engine ?? 'auto'
  if (value.version!==1 || typeof value.text!=='string' || !value.text.trim() || value.text.length>maxTextLength || typeof value.voice!=='string' || value.voice.length>160 || !['auto','piper','say'].includes(String(engine)) || value.format!=='wav' || (value.language!==undefined && typeof value.language!=='string') || (value.rate!==undefined && (typeof value.rate!=='number' || !Number.isFinite(value.rate) || value.rate<0.5 || value.rate>2))) return { ok:false,error:{code:'invalid_request',message:'Invalid TTS request'} }
  return { ok:true, value:{ version:1,text:value.text,voice:value.voice,format:'wav',engine:engine as TtsEngineKind,...(typeof value.language==='string'?{language:value.language}:{}),...(typeof value.rate==='number'?{rate:value.rate}:{}),...(typeof value.ownerId==='string'?{ownerId:value.ownerId}:{}) } }
}
export function isTtsRunResource(value: unknown): value is TtsRunResource {
  if (!object(value)) return false
  return value.version===1 && typeof value.runId==='string' && ['queued','running','succeeded','failed','cancelled'].includes(String(value.status)) && (value.engine===null || value.engine==='piper' || value.engine==='say') && (value.voice===null || typeof value.voice==='string') && typeof value.audioReady==='boolean'
}
export const ttsRunPath=(runId:string):string=>`${TTS_RUNNER.runs}/${encodeURIComponent(runId)}`
export const ttsRunAudioPath=(runId:string):string=>`${ttsRunPath(runId)}/audio`
