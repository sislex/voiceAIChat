// Браузерный аудио-контроллер: связывает AudioCapture с мостом window.audio.
// Именно этот объект инжектится в стор как AudioController (Шаг 6).

import type { RendererAudioBridge } from '@shared/ipc'
import { AudioCapture } from './audioCapture'
import { rms } from '../lib/vad'

/** Контракт, который ожидает стор для запуска/остановки записи. */
export interface AudioController {
  start(opts: { deviceId: string | null; onEnergy?: (rms: number) => void }): Promise<void>
  stop(): Promise<void>
  /**
   * Мониторинг энергии микрофона БЕЗ отправки в STT (для barge-in во время
   * озвучки). Возвращает функцию остановки. Может отсутствовать (headless).
   */
  monitor?(deviceId: string | null, onEnergy: (rms: number) => void): Promise<() => void>
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
    async start({ deviceId, onEnergy }): Promise<void> {
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
          onEnergy?.(rms(chunk)) // энергия для hands-free VAD (авто-пауза по тишине)
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
    },

    // Отдельный захват только для энергии: чанки НЕ уходят в main (STT не слышит TTS).
    async monitor(deviceId, onEnergy): Promise<() => void> {
      const mon = new AudioCapture({
        deviceId,
        workletUrl: workletUrl(),
        onChunk: (chunk) => onEnergy(rms(chunk))
      })
      await mon.start()
      return () => void mon.stop().catch(() => {})
    }
  }
}
