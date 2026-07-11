// Простой энергетический VAD (voice activity detection) для barge-in и hands-free.
// Работает по кадрам PCM: RMS-энергия → пороговый детектор с гистерезисом по числу
// подряд идущих «речевых»/«тихих» кадров. Чистая логика — тестируется синтетикой.

/** Среднеквадратичная громкость кадра Int16 PCM, нормированная в [0, 1]. */
export function rms(frame: Int16Array): number {
  if (frame.length === 0) return 0
  let sum = 0
  for (let i = 0; i < frame.length; i++) {
    const s = frame[i] / 32768
    sum += s * s
  }
  return Math.sqrt(sum / frame.length)
}

export interface VadConfig {
  /** Порог энергии (0..1), выше которого кадр считается речью. */
  threshold: number
  /** Сколько подряд речевых кадров = начало речи. */
  minSpeechFrames: number
  /** Сколько подряд тихих кадров = конец речи (пауза). */
  minSilenceFrames: number
}

// Пороги подобраны на живом замере (кадр = 250 мс):
// фон/тишина RMS ≈ 0.0001–0.0015, речь ≈ 0.02–0.13 (провалы между словами ~0.005).
// threshold 0.015 — ~10× над фоном и надёжно ниже речи; minSpeechFrames 2 = 500 мс
// (отзывчивый barge-in), minSilenceFrames 8 = 2 с тишины (авто-пауза hands-free).
export const DEFAULT_VAD: VadConfig = {
  threshold: 0.015,
  minSpeechFrames: 2,
  minSilenceFrames: 8
}

export type VadEvent = 'speech-start' | 'speech-end' | null

/**
 * Пороговый детектор с гистерезисом. `push(energy)` возвращает 'speech-start'
 * ровно раз при переходе тишина→речь и 'speech-end' раз при речь→тишина.
 */
export class VadDetector {
  private cfg: VadConfig
  private speaking = false
  private run = 0 // длина текущей серии (речевых при !speaking, тихих при speaking)

  constructor(cfg: Partial<VadConfig> = {}) {
    this.cfg = { ...DEFAULT_VAD, ...cfg }
  }

  reset(): void {
    this.speaking = false
    this.run = 0
  }

  /** Активна ли сейчас речь (после последнего push). */
  get isSpeaking(): boolean {
    return this.speaking
  }

  push(energy: number): VadEvent {
    const loud = energy >= this.cfg.threshold
    if (!this.speaking) {
      // Ждём серию речевых кадров.
      this.run = loud ? this.run + 1 : 0
      if (this.run >= this.cfg.minSpeechFrames) {
        this.speaking = true
        this.run = 0
        return 'speech-start'
      }
      return null
    }
    // Говорим — ждём серию тихих кадров.
    this.run = loud ? 0 : this.run + 1
    if (this.run >= this.cfg.minSilenceFrames) {
      this.speaking = false
      this.run = 0
      return 'speech-end'
    }
    return null
  }
}
