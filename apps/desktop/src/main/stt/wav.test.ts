import { describe, it, expect } from 'vitest'
import { encodeWav } from './wav'

describe('encodeWav', () => {
  it('пишет корректный 44-байтный заголовок @16kHz mono 16-bit', () => {
    const pcm = Int16Array.from([0, 1000, -1000, 32767, -32768])
    const wav = encodeWav(pcm, 16_000)

    expect(wav.length).toBe(44 + pcm.length * 2)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ')
    expect(wav.readUInt16LE(20)).toBe(1) // PCM
    expect(wav.readUInt16LE(22)).toBe(1) // mono
    expect(wav.readUInt32LE(24)).toBe(16_000) // sampleRate (валидатор nodejs-whisper это проверяет)
    expect(wav.readUInt16LE(34)).toBe(16) // bits
    expect(wav.toString('ascii', 36, 40)).toBe('data')
    expect(wav.readUInt32LE(40)).toBe(pcm.length * 2)
  })

  it('сохраняет сэмплы без искажений (round-trip)', () => {
    const pcm = Int16Array.from([0, 1000, -1000, 32767, -32768])
    const wav = encodeWav(pcm, 16_000)
    for (let i = 0; i < pcm.length; i++) {
      expect(wav.readInt16LE(44 + i * 2)).toBe(pcm[i])
    }
  })
})
