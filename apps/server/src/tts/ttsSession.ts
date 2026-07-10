// TTS per-connection (сервер): FIFO-очередь синтеза. Каждый tts.speak добавляет
// чанк; синтез идёт по одному; аудио (WAV) отправляется base64-кадром tts.audio.

import type { ServerMessage } from '@voicechat/shared'
import type { TtsEngine } from './types.js'

export interface TtsSessionDeps {
  engine: TtsEngine
  send: (msg: ServerMessage) => void
}

export interface TtsSession {
  speak(text: string, voice: string): void
  cancel(): void
  dispose(): void
}

export function createTtsSession(deps: TtsSessionDeps): TtsSession {
  let queue: { text: string; voice: string }[] = []
  let processing = false
  let generation = 0

  async function pump(): Promise<void> {
    if (processing) return
    processing = true
    const gen = generation
    while (queue.length > 0 && gen === generation) {
      const item = queue.shift() as { text: string; voice: string }
      try {
        const result = await deps.engine.synthesize(item.text, { voice: item.voice })
        if (gen !== generation) break
        const audio = Buffer.from(result.audio).toString('base64')
        deps.send({ t: 'tts.audio', audio })
      } catch (err) {
        if (gen !== generation) break
        deps.send({ t: 'tts.error', message: err instanceof Error ? err.message : String(err) })
      }
    }
    processing = false
  }

  return {
    speak(text, voice) {
      queue.push({ text, voice })
      void pump()
    },
    cancel() {
      generation++
      queue = []
      deps.engine.cancel()
    },
    dispose() {
      generation++
      queue = []
      deps.engine.cancel()
    }
  }
}
