import { describe, it, expect } from 'vitest'
import { rms, VadDetector } from './vad'

describe('rms', () => {
  it('нулевой сигнал → 0, пустой кадр → 0', () => {
    expect(rms(new Int16Array([0, 0, 0]))).toBe(0)
    expect(rms(new Int16Array([]))).toBe(0)
  })
  it('громкий сигнал даёт заметную энергию', () => {
    expect(rms(new Int16Array([20000, -20000, 20000, -20000]))).toBeGreaterThan(0.5)
  })
})

describe('VadDetector', () => {
  it('speech-start после серии громких кадров (по разу)', () => {
    const vad = new VadDetector({ threshold: 0.1, minSpeechFrames: 3, minSilenceFrames: 3 })
    expect(vad.push(0.2)).toBeNull()
    expect(vad.push(0.2)).toBeNull()
    expect(vad.push(0.2)).toBe('speech-start')
    expect(vad.push(0.2)).toBeNull() // уже говорит — повторно не стартует
    expect(vad.isSpeaking).toBe(true)
  })

  it('speech-end после серии тихих кадров', () => {
    const vad = new VadDetector({ threshold: 0.1, minSpeechFrames: 1, minSilenceFrames: 3 })
    expect(vad.push(0.2)).toBe('speech-start')
    expect(vad.push(0.0)).toBeNull()
    expect(vad.push(0.0)).toBeNull()
    expect(vad.push(0.0)).toBe('speech-end')
    expect(vad.isSpeaking).toBe(false)
  })

  it('одиночный всплеск ниже minSpeechFrames не триггерит', () => {
    const vad = new VadDetector({ threshold: 0.1, minSpeechFrames: 3, minSilenceFrames: 3 })
    expect(vad.push(0.2)).toBeNull()
    expect(vad.push(0.0)).toBeNull() // серия прервана
    expect(vad.push(0.2)).toBeNull()
    expect(vad.isSpeaking).toBe(false)
  })
})
