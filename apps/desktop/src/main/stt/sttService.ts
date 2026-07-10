// STT-сервис (Шаг 7): потребляет поток аудио из renderer, распознаёт и шлёт
// результаты обратно. nodejs-whisper — батчевый, поэтому «частичные гипотезы»
// эмулируем периодической ре-транскрипцией накопленного буфера; финал — по стопу.

import { ipcMain } from 'electron'
import type {
  AudioChunkMessage,
  IpcEventChannel,
  IpcEventPayload,
  IpcSendPayload
} from '@shared/ipc'
import type { SttEngine } from './types'
import type { DiarizationEngine } from '../diarization/types'

export interface SttServiceDeps {
  engine: SttEngine
  /** Отправка события в renderer (webContents.send). */
  send: <C extends IpcEventChannel>(channel: C, payload: IpcEventPayload<C>) => void
  language?: string
  /** Интервал частичного распознавания (мс). */
  partialIntervalMs?: number
  /** Минимум сэмплов для первого частичного прогона (не гоняем на «тишине»). */
  minPartialSamples?: number
  /** Движок диаризации (заглушка/sherpa-onnx). Применяется к финальному результату. */
  diarization?: DiarizationEngine
  /** Включена ли диаризация (из настроек). */
  isDiarizationEnabled?: () => boolean
}

export interface SttService {
  dispose(): void
}

export function createSttService(deps: SttServiceDeps): SttService {
  const language = deps.language ?? 'ru'
  const partialIntervalMs = deps.partialIntervalMs ?? 2500
  const minPartialSamples = deps.minPartialSamples ?? 16_000 // ~1 c при 16 kHz

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
        if (final) deps.send('stt:final', { segments: [], text: '' })
        return
      }
      const buffer = combined()
      const result = await deps.engine.transcribe(buffer, sampleRate, { language, final })
      let segments = result.segments
      // Диаризацию применяем только к финалу и только если включена.
      if (final && deps.diarization && deps.isDiarizationEnabled?.() && segments.length > 0) {
        segments = await deps.diarization.diarize(buffer, sampleRate, segments, { maxSpeakers: 4 })
      }
      deps.send(final ? 'stt:final' : 'stt:partial', { segments, text: result.text })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (final) {
        deps.send('stt:error', { message })
        deps.send('stt:final', { segments: [], text: '' }) // разблокируем UX-цикл
      } else {
        console.warn('[stt] частичное распознавание не удалось:', message)
      }
    } finally {
      running = false
      if (pendingFinal) {
        pendingFinal = false
        void transcribe(true)
      }
    }
  }

  function onStart(_e: unknown, payload: IpcSendPayload<'audio:start'>): void {
    chunks = []
    totalSamples = 0
    sampleRate = payload.sampleRate || 16_000
    recording = true
    pendingFinal = false
    if (timer) clearInterval(timer)
    timer = setInterval(() => {
      if (recording) void transcribe(false)
    }, partialIntervalMs)
  }

  function onChunk(_e: unknown, msg: AudioChunkMessage): void {
    if (!recording) return
    const pcm = new Int16Array(msg.pcm)
    chunks.push(pcm)
    totalSamples += pcm.length
  }

  function onStop(): void {
    recording = false
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    void transcribe(true)
  }

  ipcMain.on('audio:start', onStart)
  ipcMain.on('audio:chunk', onChunk)
  ipcMain.on('audio:stop', onStop)

  return {
    dispose(): void {
      if (timer) clearInterval(timer)
      ipcMain.removeListener('audio:start', onStart)
      ipcMain.removeListener('audio:chunk', onChunk)
      ipcMain.removeListener('audio:stop', onStop)
    }
  }
}
