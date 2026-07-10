// Приём потока аудио из renderer (Шаг 6). Пока только валидирует/логирует формат
// чанков — потребитель (Whisper STT) появится на Шаге 7.

import { ipcMain } from 'electron'
import type { AudioChunkMessage, IpcSendPayload } from '@shared/ipc'

export interface AudioReceiverStats {
  chunks: number
  bytes: number
  sampleRate: number | null
}

/**
 * Регистрирует слушателей audio:start/chunk/stop. Возвращает функцию отписки.
 * `onStats` (опц.) вызывается на stop с итоговой статистикой сессии — удобно для
 * тестов/дальнейшей интеграции.
 */
export function registerAudioReceiver(onStats?: (stats: AudioReceiverStats) => void): () => void {
  let stats: AudioReceiverStats = { chunks: 0, bytes: 0, sampleRate: null }

  const onStart = (_e: unknown, payload: IpcSendPayload<'audio:start'>): void => {
    stats = { chunks: 0, bytes: 0, sampleRate: payload.sampleRate }
    console.log('[audio] start', payload)
  }

  const onChunk = (_e: unknown, msg: AudioChunkMessage): void => {
    stats.chunks += 1
    stats.bytes += msg.pcm.byteLength
    stats.sampleRate = msg.sampleRate
    // Логируем первые несколько и далее раз в 20 чанков, чтобы не засорять консоль.
    if (stats.chunks <= 3 || stats.chunks % 20 === 0) {
      console.log('[audio] chunk', {
        seq: msg.seq,
        sampleRate: msg.sampleRate,
        samples: msg.pcm.byteLength / 2 // Int16 = 2 байта
      })
    }
  }

  const onStop = (): void => {
    console.log('[audio] stop', stats)
    onStats?.(stats)
  }

  ipcMain.on('audio:start', onStart)
  ipcMain.on('audio:chunk', onChunk)
  ipcMain.on('audio:stop', onStop)

  return () => {
    ipcMain.removeListener('audio:start', onStart)
    ipcMain.removeListener('audio:chunk', onChunk)
    ipcMain.removeListener('audio:stop', onStop)
  }
}
