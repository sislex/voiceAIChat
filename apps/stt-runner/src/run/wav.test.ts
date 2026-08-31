// WAV-заголовок исполнителя STT. Проверяется побайтово, потому что смысл этого
// кода — попасть в валидатор nodejs-whisper: он смотрит именно 'RIFF' и
// sampleRate === 16000, и любая ошибка в раскладке 44 байт означает не «кривой
// звук», а конвертацию через ffmpeg или отказ файла целиком.

import { describe, expect, it } from 'vitest'
import { encodeWav } from './wav'

describe('encodeWav', () => {
  it('раскладка 44-байтного заголовка PCM 16-bit mono @16 kHz', () => {
    const pcm = new Int16Array([0, 1, -1, 32767, -32768])
    const wav = encodeWav(pcm, 16_000)
    const dataSize = pcm.length * 2

    expect(wav.length).toBe(44 + dataSize)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.readUInt32LE(4)).toBe(36 + dataSize)
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ')
    expect(wav.readUInt32LE(16)).toBe(16)
    expect(wav.readUInt16LE(20)).toBe(1) // PCM без сжатия
    expect(wav.readUInt16LE(22)).toBe(1) // mono
    expect(wav.readUInt32LE(24)).toBe(16_000)
    expect(wav.readUInt32LE(28)).toBe(32_000) // byteRate = sampleRate * blockAlign
    expect(wav.readUInt16LE(32)).toBe(2) // blockAlign = channels * bytesPerSample
    expect(wav.readUInt16LE(34)).toBe(16)
    expect(wav.toString('ascii', 36, 40)).toBe('data')
    expect(wav.readUInt32LE(40)).toBe(dataSize)
  })

  it('сэмплы кладутся little-endian и переживают крайние значения Int16', () => {
    const pcm = new Int16Array([0, 1, -1, 32767, -32768])
    const wav = encodeWav(pcm, 16_000)
    const back = Array.from({ length: pcm.length }, (_, i) => wav.readInt16LE(44 + i * 2))
    expect(back).toEqual([...pcm])
  })

  it('пустой сигнал даёт валидный заголовок без данных, а не пустой буфер', () => {
    const wav = encodeWav(new Int16Array([]), 16_000)
    expect(wav.length).toBe(44)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.readUInt32LE(40)).toBe(0)
    expect(wav.readUInt32LE(4)).toBe(36)
  })

  it('частота дискретизации не зашита: byteRate пересчитывается', () => {
    const wav = encodeWav(new Int16Array([1, 2]), 8_000)
    expect(wav.readUInt32LE(24)).toBe(8_000)
    expect(wav.readUInt32LE(28)).toBe(16_000)
  })
})
