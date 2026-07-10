// STT per-connection: аккумулирует PCM, периодически распознаёт (партиалы),
// финал по стопу; шлёт stt.* через send. Батчевый whisper → партиалы через
// ре-транскрипцию накопленного буфера.

import type { ServerMessage } from '@voicechat/shared'
import type { SttEngine } from './types.js'
import type { DiarizationEngine } from '../diarization/types.js'

export interface SttSessionDeps {
  engine: SttEngine
  send: (msg: ServerMessage) => void
  language?: string
  partialIntervalMs?: number
  minPartialSamples?: number
  diarization?: DiarizationEngine
  isDiarizationEnabled?: () => boolean
}

export interface SttSession {
  start(sampleRate: number): void
  chunk(pcm: Int16Array): void
  stop(): void
  dispose(): void
}

export function createSttSession(deps: SttSessionDeps): SttSession {
  const language = deps.language ?? 'ru'
  const partialIntervalMs = deps.partialIntervalMs ?? 2500
  const minPartialSamples = deps.minPartialSamples ?? 16_000

  let chunks: Int16Array[] = []
  let totalSamples = 0
  let sampleRate = 16_000
  let recording = false
  let running = false
  let pendingFinal = false
  let timer: ReturnType<typeof setInterval> | null = null

  function combined(): Int16Array {
    const out = new Int16Array(totalSamples)
    let offset = 0
    for (const c of chunks) {
      out.set(c, offset)
      offset += c.length
    }
    return out
  }

  async function transcribe(final: boolean): Promise<void> {
    if (running) {
      if (final) pendingFinal = true
      return
    }
    running = true
    try {
      if (!final && totalSamples < minPartialSamples) return
      if (totalSamples === 0) {
        if (final) deps.send({ t: 'stt.final', update: { segments: [], text: '' } })
        return
      }
      const buffer = combined()
      const result = await deps.engine.transcribe(buffer, sampleRate, { language, final })
      let segments = result.segments
      if (final && deps.diarization && deps.isDiarizationEnabled?.() && segments.length > 0) {
        segments = await deps.diarization.diarize(buffer, sampleRate, segments, { maxSpeakers: 4 })
      }
      deps.send({
        t: final ? 'stt.final' : 'stt.partial',
        update: { segments, text: result.text }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (final) {
        deps.send({ t: 'stt.error', message })
        deps.send({ t: 'stt.final', update: { segments: [], text: '' } })
      } else {
        console.warn('[stt] partial failed:', message)
      }
    } finally {
      running = false
      if (pendingFinal) {
        pendingFinal = false
        void transcribe(true)
      }
    }
  }

  function stopTimer(): void {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  return {
    start(rate) {
      chunks = []
      totalSamples = 0
      sampleRate = rate || 16_000
      recording = true
      pendingFinal = false
      stopTimer()
      timer = setInterval(() => {
        if (recording) void transcribe(false)
      }, partialIntervalMs)
    },
    chunk(pcm) {
      if (!recording) return
      chunks.push(pcm)
      totalSamples += pcm.length
    },
    stop() {
      recording = false
      stopTimer()
      void transcribe(true)
    },
    dispose() {
      recording = false
      stopTimer()
    }
  }
}
