// Браузерный аудио-контроллер: связывает AudioCapture с мостом window.audio.
// Именно этот объект инжектится в стор как AudioController (Шаг 6).

import type { RendererAudioBridge } from '@shared/ipc'
import { AudioCapture } from './audioCapture'

/** Контракт, который ожидает стор для запуска/остановки записи. */
export interface AudioController {
  start(opts: { deviceId: string | null }): Promise<void>
  stop(): Promise<void>
}

import { PCM_WORKLET_SOURCE } from './pcmWorkletSource'

// Исходник worklet превращаем в blob:-URL при первом старте записи. Надёжно работает
// в web и в Electron (file://), не зависит от эмита ассетов (см. pcmWorkletSource.ts).
let workletUrlCache: string | null = null
function workletUrl(): string {
  if (!workletUrlCache) {
    const blob = new Blob([PCM_WORKLET_SOURCE], { type: 'text/javascript' })
    workletUrlCache = URL.createObjectURL(blob)
  }
  return workletUrlCache
}

/**
 * Создаёт контроллер, отправляющий чанки в main через мост `bridge`.
 * Возвращает null, если Web Audio/getUserMedia недоступны (тесты, headless).
 */
export function createBrowserAudioController(
  bridge: RendererAudioBridge
): AudioController | null {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return null
  }

  let capture: AudioCapture | null = null
  let active = false // идёт ли сейчас сессия записи (для баланса start/stop)

  return {
    async start({ deviceId }): Promise<void> {
      if (capture) await capture.stop()
      let seq = 0
      capture = new AudioCapture({
        deviceId,
        workletUrl: workletUrl(),
        onChunk: (chunk, sampleRate) => {
          // Копируем в отдельный ArrayBuffer точного размера для structured-clone.
          const pcm = new ArrayBuffer(chunk.byteLength)
          new Int16Array(pcm).set(chunk)
          bridge.audioChunk({ seq: seq++, sampleRate, pcm })
        }
      })
      active = true
      bridge.audioStart({ conversationId: null, sampleRate: capture.sampleRate })
      await capture.start()
    },
    async stop(): Promise<void> {
      if (!active) return // не было записи — не шлём холостой stop
      active = false
      if (capture) {
        await capture.stop()
        capture = null
      }
      bridge.audioStop()
    }
  }
}
