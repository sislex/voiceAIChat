// Абстракция TTS (движок синтеза в main). Реализации v1 — Piper и macOS `say`;
// интерфейс движко-независим. Воспроизведение — в renderer.

import type { TtsVoiceInfo } from '@voicechat/shared'

export interface SpeakOptions {
  /** Идентификатор голоса из настроек ('irina' | 'dmitri' | 'amy'). */
  voice: string
}

/** Результат синтеза: байты аудиофайла (WAV) для декодирования в renderer. */
export interface TtsAudio {
  /** Кодированные байты аудио (WAV) — Web Audio их декодирует напрямую. */
  audio: ArrayBuffer
  /** MIME для справки/отладки. */
  mime: string
}

/**
 * Движок синтеза речи. `synthesize` возвращает аудиофайл целиком; `cancel`
 * прерывает текущий синтез (промис отклоняется). Воспроизведение и завершение
 * состояния speaking — на стороне renderer.
 */
export interface TtsEngine {
  synthesize(text: string, opts: SpeakOptions): Promise<TtsAudio>
  cancel(): void
  /** Реальные доступные голоса движка (для меню настроек). */
  listVoices(): Promise<TtsVoiceInfo[]>
}
