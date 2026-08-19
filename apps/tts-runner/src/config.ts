import { homedir } from 'node:os'
import { join } from 'node:path'
export interface TtsRunnerConfig { host:string; port:number; token:string; piperBin:string; sayBin:string; voicesDir:string; tempDir:string; maxActive:number; maxQueue:number; maxTextLength:number; maxWavBytes:number; processTimeoutMs:number; orphanMs:number; killGraceMs:number }
const positive=(raw:string|undefined,fallback:number)=>{const n=Number(raw);return Number.isFinite(n)&&n>0?Math.floor(n):fallback}
export function loadTtsRunnerConfig(env:NodeJS.ProcessEnv=process.env):TtsRunnerConfig {
 const data=env.VC_TTS_DATA_DIR??join(homedir(),'.voicechat-tts')
 return { host:env.HOST??'0.0.0.0',port:positive(env.PORT,8791),token:env.VC_TTS_RUNNER_TOKEN??'',piperBin:env.VC_PIPER_BIN??'piper',sayBin:env.VC_SAY_BIN??'say',voicesDir:env.VC_PIPER_VOICES_DIR??join(data,'voices'),tempDir:env.VC_TTS_TEMP_DIR??join(data,'tmp'),maxActive:positive(env.VC_TTS_MAX_ACTIVE,1),maxQueue:positive(env.VC_TTS_MAX_QUEUE,16),maxTextLength:positive(env.VC_TTS_MAX_TEXT,8000),maxWavBytes:positive(env.VC_TTS_MAX_WAV_BYTES,32*1024*1024),processTimeoutMs:positive(env.VC_TTS_TIMEOUT_MS,60000),orphanMs:positive(env.VC_TTS_ORPHAN_MS,30000),killGraceMs:positive(env.VC_TTS_KILL_GRACE_MS,1000) }
}
