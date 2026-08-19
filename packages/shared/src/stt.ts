import type { Segment, WhisperModel, WhisperModelInfo } from './types'

export const STT_SCHEMA_VERSION = 1 as const
export const STT_RUNNER = { transcribe: '/v1/transcribe', health: '/v1/health', models: '/v1/models' } as const

export type SttErrorCode = 'invalid_request' | 'model_unavailable' | 'busy' | 'limit_exceeded' | 'timeout' | 'whisper_failed' | 'storage_exhausted' | 'memory_exhausted' | 'internal'
export interface SttStart {
  t: 'start'
  schemaVersion: typeof STT_SCHEMA_VERSION
  runId: string
  format: { encoding: 'pcm_s16le'; sampleRate: 16000; channels: 1 }
  model: WhisperModel
  language: string
  diarization?: boolean
}
export type SttClientControl = SttStart | { t: 'end'; runId: string } | { t: 'cancel'; runId: string }
export interface SttRunnerSegment { id: string; text: string; startMs: number; endMs: number; speaker: number | null }
export type SttRunnerEvent =
  | { t: 'ready'; runId: string; queued: boolean }
  | { t: 'partial' | 'final'; runId: string; segments: SttRunnerSegment[]; text: string }
  | { t: 'error'; runId: string; code: SttErrorCode; message: string; retryable: boolean; reason?: 'idle' | 'whisper' | 'duration' | 'pcm' | 'buffer' }
  | { t: 'cancelled'; runId: string; reason?: 'client' | 'orphan' }
  | { t: 'completed'; runId: string }
export interface SttRunnerHealth {
  ok: boolean
  whisper: { available: boolean; version: string | null }
  models: WhisperModelInfo[]
  memory: { availableBytes: number | null }
  activeRuns: number
  queuedRuns: number
}

const models = new Set<WhisperModel>(['large-v3-turbo', 'medium', 'small'])
export function parseSttControl(value: unknown): SttClientControl {
  if (!value || typeof value !== 'object') throw new Error('invalid control')
  const v = value as Record<string, unknown>
  if (v.t === 'end' || v.t === 'cancel') {
    if (typeof v.runId !== 'string' || !v.runId) throw new Error('runId required')
    return { t: v.t, runId: v.runId }
  }
  if (v.t !== 'start' || v.schemaVersion !== STT_SCHEMA_VERSION || typeof v.runId !== 'string' || !v.runId) throw new Error('invalid start')
  const f = v.format as Record<string, unknown> | undefined
  if (!f || f.encoding !== 'pcm_s16le' || f.sampleRate !== 16000 || f.channels !== 1) throw new Error('unsupported PCM format')
  if (!models.has(v.model as WhisperModel) || typeof v.language !== 'string' || !/^[a-z]{2,8}$/i.test(v.language)) throw new Error('invalid model or language')
  return { t: 'start', schemaVersion: 1, runId: v.runId, format: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 }, model: v.model as WhisperModel, language: v.language, diarization: v.diarization === true }
}
export function sttSegments(segments: Segment[]): SttRunnerSegment[] {
  return segments.map((s, i) => ({ id: String(i), text: s.text, startMs: Math.round((s.start ?? 0) * 1000), endMs: Math.round((s.end ?? s.start ?? 0) * 1000), speaker: Number.isInteger(s.speakerId) && s.speakerId > 0 ? s.speakerId : null }))
}
