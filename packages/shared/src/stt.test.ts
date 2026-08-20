import { describe, expect, it } from 'vitest'
import { parseSttControl } from './stt.js'
describe('STT v1 contract', () => {
  it('accepts only fixed mono PCM16 16 kHz input', () => {
    expect(parseSttControl({ t: 'start', schemaVersion: 1, runId: 'r1', format: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 }, model: 'small', language: 'ru' })).toMatchObject({ t: 'start', runId: 'r1' })
    expect(() => parseSttControl({ t: 'start', schemaVersion: 1, runId: 'r1', format: { encoding: 'pcm_s16le', sampleRate: 48000, channels: 1 }, model: 'small', language: 'ru' })).toThrow()
  })
  it('validates cancel and end run ids', () => {
    expect(parseSttControl({ t: 'cancel', runId: 'r1' })).toEqual({ t: 'cancel', runId: 'r1' })
    expect(() => parseSttControl({ t: 'end', runId: '' })).toThrow()
  })
})
