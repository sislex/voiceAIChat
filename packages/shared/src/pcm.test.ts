import { describe, it, expect } from 'vitest'
import {
  chunkSamplesForMs,
  floatTo16BitPCM,
  PcmChunker,
  resampleLinear,
  TARGET_SAMPLE_RATE
} from './pcm'

describe('floatTo16BitPCM', () => {
  it('маппит характерные значения и клиппит выход за диапазон', () => {
    const out = floatTo16BitPCM(new Float32Array([0, 1, -1, 0.5, -0.5, 2, -2]))
    expect(out[0]).toBe(0)
    expect(out[1]).toBe(32767) // +1 → 0x7FFF
    expect(out[2]).toBe(-32768) // -1 → -0x8000
    expect(out[3]).toBe(Math.round(0.5 * 0x7fff)) // 16384
    expect(out[4]).toBe(Math.round(-0.5 * 0x8000)) // -16384
    expect(out[5]).toBe(32767) // клиппинг +2
    expect(out[6]).toBe(-32768) // клиппинг -2
  })

  it('возвращает Int16Array той же длины', () => {
    expect(floatTo16BitPCM(new Float32Array(10))).toHaveLength(10)
  })
})

describe('resampleLinear', () => {
  it('при равных частотах возвращает копию (не тот же буфер)', () => {
    const input = new Float32Array([0.1, 0.2, 0.3])
    const out = resampleLinear(input, 16_000, 16_000)
    expect(Array.from(out)).toEqual([0.1, 0.2, 0.3].map((v) => Math.fround(v)))
    expect(out).not.toBe(input)
  })

  it('даунсемпл 48k→16k уменьшает длину втрое', () => {
    const input = new Float32Array(48) // 1 мс при 48k
    const out = resampleLinear(input, 48_000, TARGET_SAMPLE_RATE)
    expect(out.length).toBe(16)
  })

  it('сохраняет постоянный сигнал', () => {
    const input = new Float32Array(48).fill(0.42)
    const out = resampleLinear(input, 48_000, 16_000)
    for (const v of out) expect(v).toBeCloseTo(0.42, 5)
  })

  it('линейно интерполирует между сэмплами (апсемпл 2x)', () => {
    // input @2Гц → output @4Гц: позиции 0, 0.5, 1.0, 1.5
    const input = new Float32Array([0, 1])
    const out = resampleLinear(input, 2, 4)
    expect(out.length).toBe(4)
    expect(out[0]).toBeCloseTo(0, 5)
    expect(out[1]).toBeCloseTo(0.5, 5) // середина между 0 и 1
    expect(out[2]).toBeCloseTo(1, 5)
    expect(out[3]).toBeCloseTo(1, 5) // за пределом — держим последний сэмпл
  })

  it('пустой вход → пустой выход', () => {
    expect(resampleLinear(new Float32Array(0), 48_000, 16_000)).toHaveLength(0)
  })

  it('бросает на некорректной частоте', () => {
    expect(() => resampleLinear(new Float32Array([1]), 0, 16_000)).toThrow()
  })
})

describe('PcmChunker', () => {
  it('нарезает ровные чанки и держит остаток', () => {
    const chunker = new PcmChunker(4)
    const first = chunker.push(Int16Array.from([1, 2, 3]))
    expect(first).toHaveLength(0) // ещё нет полного чанка
    expect(chunker.pending).toBe(3)

    const second = chunker.push(Int16Array.from([4, 5, 6, 7, 8]))
    expect(second).toHaveLength(2) // [1,2,3,4] и [5,6,7,8]
    expect(Array.from(second[0])).toEqual([1, 2, 3, 4])
    expect(Array.from(second[1])).toEqual([5, 6, 7, 8])
    expect(chunker.pending).toBe(0)
  })

  it('flush отдаёт неполный остаток и очищает буфер', () => {
    const chunker = new PcmChunker(4)
    chunker.push(Int16Array.from([1, 2, 3, 4, 5]))
    expect(chunker.pending).toBe(1)
    const tail = chunker.flush()
    expect(tail && Array.from(tail)).toEqual([5])
    expect(chunker.flush()).toBeNull()
  })

  it('бросает при неположительном размере чанка', () => {
    expect(() => new PcmChunker(0)).toThrow()
  })
})

describe('chunkSamplesForMs', () => {
  it('250 мс при 16 kHz = 4000 сэмплов', () => {
    expect(chunkSamplesForMs(CHUNK_MS_250, 16_000)).toBe(4000)
  })
})

const CHUNK_MS_250 = 250
