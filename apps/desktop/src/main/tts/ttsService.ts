// Сервис TTS (стриминг): очередь синтеза (FIFO) — озвучиваем ответ по предложениям
// по мере поступления. Каждый tts:speak добавляет чанк в очередь; синтез идёт по
// одному, tts:audio эмитятся в порядке очереди. tts:cancel очищает очередь.

import { ipcMain } from 'electron'
import type { IpcEventChannel, IpcEventPayload, IpcSendPayload } from '@shared/ipc'
import type { TtsEngine } from './types'

export interface TtsServiceDeps {
  engine: TtsEngine
  send: <C extends IpcEventChannel>(channel: C, payload: IpcEventPayload<C>) => void
}

export interface TtsService {
  dispose(): void
}

export function createTtsService(deps: TtsServiceDeps): TtsService {
  let queue: IpcSendPayload<'tts:speak'>[] = []
  let processing = false
  let generation = 0

  async function pump(): Promise<void> {
    if (processing) return
    processing = true
    const gen = generation
    while (queue.length > 0 && gen === generation) {
      const item = queue.shift() as IpcSendPayload<'tts:speak'>
      try {
        const result = await deps.engine.synthesize(item.text, { voice: item.voice })
        if (gen !== generation) break // отменено во время синтеза
        deps.send('tts:audio', { audio: result.audio })
      } catch (err) {
        if (gen !== generation) break
        deps.send('tts:error', { message: err instanceof Error ? err.message : String(err) })
      }
    }
    processing = false
  }

  const onSpeak = (_e: unknown, payload: IpcSendPayload<'tts:speak'>): void => {
    queue.push(payload)
    void pump()
  }

  const onCancel = (): void => {
    generation++ // инвалидируем текущий синтез и цикл
    queue = []
    deps.engine.cancel()
  }

  ipcMain.on('tts:speak', onSpeak)
  ipcMain.on('tts:cancel', onCancel)

  return {
    dispose(): void {
      generation++
      queue = []
      deps.engine.cancel()
      ipcMain.removeListener('tts:speak', onSpeak)
      ipcMain.removeListener('tts:cancel', onCancel)
    }
  }
}
