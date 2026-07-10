// Чистые утилиты обработки PCM для аудиозахвата (Шаг 6).
// Без обращений к Web Audio API — полностью детерминированы и юнит-тестируемы.

/** Целевая частота дискретизации для Whisper. */
export const TARGET_SAMPLE_RATE = 16_000

/** Длительность одного чанка, отправляемого в main (мс). */
export const CHUNK_MS = 250

/** Число сэмплов в чанке для заданных длительности и частоты. */
export function chunkSamplesForMs(ms: number, sampleRate: number): number {
  return Math.round((sampleRate * ms) / 1000)
}

/**
 * Конвертация Float32 [-1, 1] → Int16 [-32768, 32767] с клиппингом.
 * Отрицательные масштабируются на 0x8000, положительные — на 0x7FFF.
 */
export function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
  }
  return out
}

/**
 * Линейный ресемпл Float32-сигнала из inputRate в outputRate.
 * При равных частотах возвращает копию входа. Достаточно для mono-речи;
 * более качественный ресемпл (полифазный) — при необходимости позже.
 */
export function resampleLinear(
  input: Float32Array,
  inputRate: number,
  outputRate: number
): Float32Array {
  if (inputRate <= 0 || outputRate <= 0) {
    throw new Error(`resampleLinear: некорректная частота ${inputRate}→${outputRate}`)
  }
  if (inputRate === outputRate) return input.slice()
  if (input.length === 0) return new Float32Array(0)

  const outLength = Math.max(1, Math.floor((input.length * outputRate) / inputRate))
  const out = new Float32Array(outLength)
  const step = inputRate / outputRate
  for (let i = 0; i < outLength; i++) {
    const pos = i * step
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = pos - i0
    out[i] = input[i0] * (1 - frac) + input[i1] * frac
  }
  return out
}

/**
 * Накапливает Int16-сэмплы и нарезает их на чанки фиксированного размера.
 * `push` возвращает готовые чанки; хвост < размера чанка остаётся в буфере до
 * следующего `push` или до `flush` (который отдаёт остаток).
 */
export class PcmChunker {
  private readonly chunkSize: number
  private acc: number[] = []

  constructor(chunkSize: number) {
    if (chunkSize <= 0) throw new Error(`PcmChunker: chunkSize должен быть > 0, получено ${chunkSize}`)
    this.chunkSize = chunkSize
  }

  push(samples: Int16Array): Int16Array[] {
    const out: Int16Array[] = []
    for (let i = 0; i < samples.length; i++) this.acc.push(samples[i])
    while (this.acc.length >= this.chunkSize) {
      out.push(Int16Array.from(this.acc.splice(0, this.chunkSize)))
    }
    return out
  }

  /** Отдаёт накопленный хвост (может быть короче chunkSize) и очищает буфер. */
  flush(): Int16Array | null {
    if (this.acc.length === 0) return null
    const chunk = Int16Array.from(this.acc)
    this.acc = []
    return chunk
  }

  /** Число сэмплов, ожидающих в буфере. */
  get pending(): number {
    return this.acc.length
  }
}
