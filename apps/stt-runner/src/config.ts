import { homedir } from 'node:os'
import { join } from 'node:path'

export interface SttRunnerConfig {
  host: string
  port: number
  token: string
  whisperCli: string
  modelsDir: string
  tempDir: string
  maxConcurrentRuns: number
  maxQueueSize: number
  maxSessionMs: number
  maxPcmBytes: number
  maxPcmBufferBytes: number
  idleTimeoutMs: number
  whisperTimeoutMs: number
  orphanTimeoutMs: number
  killGraceMs: number
  partialIntervalMs: number
}
function positive(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]
  if (raw === undefined) return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${key} должен быть целым положительным числом`)
  return n
}
export function loadSttRunnerConfig(env: NodeJS.ProcessEnv = process.env): SttRunnerConfig {
  const data = env.VC_DATA_DIR ?? join(homedir(), '.voicechat-stt-runner')
  return {
    host: env.HOST ?? '0.0.0.0',
    port: positive(env, 'PORT', 8791),
    token: env.VC_STT_RUNNER_TOKEN ?? '',
    whisperCli: env.VC_WHISPER_CLI ?? 'whisper-cli',
    modelsDir: env.VC_MODELS_DIR ?? join(data, 'models'),
    tempDir: env.VC_STT_TEMP_DIR ?? join(data, 'tmp'),
    maxConcurrentRuns: positive(env, 'VC_STT_MAX_CONCURRENT_RUNS', 2),
    maxQueueSize: positive(env, 'VC_STT_MAX_QUEUE_SIZE', 4),
    maxSessionMs: positive(env, 'VC_STT_MAX_SESSION_MS', 300000),
    maxPcmBytes: positive(env, 'VC_STT_MAX_PCM_BYTES', 9600000),
    maxPcmBufferBytes: positive(env, 'VC_STT_MAX_PCM_BUFFER_BYTES', 524288),
    idleTimeoutMs: positive(env, 'VC_STT_IDLE_TIMEOUT_MS', 15000),
    whisperTimeoutMs: positive(env, 'VC_STT_WHISPER_TIMEOUT_MS', 120000),
    orphanTimeoutMs: positive(env, 'VC_STT_ORPHAN_TIMEOUT_MS', 30000),
    killGraceMs: positive(env, 'VC_STT_KILL_GRACE_MS', 5000),
    partialIntervalMs: positive(env, 'VC_STT_PARTIAL_INTERVAL_MS', 2500)
  }
}
