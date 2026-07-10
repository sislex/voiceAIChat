import { describe, it, expect } from 'vitest'
import { StubDiarizationEngine } from './stubDiarization'
import type { SttSegment } from '../stt/types'

describe('StubDiarizationEngine (контракт заглушки)', () => {
  const engine = new StubDiarizationEngine()
  const pcm = new Int16Array(1600)
  const segments: SttSegment[] = [
    { speakerId: 7, text: 'Первый', start: 0, end: 1 },
    { speakerId: 3, text: 'Второй', start: 1, end: 2 }
  ]

  it('относит всё к одному спикеру, сохраняя текст и таймкоды', async () => {
    const out = await engine.diarize(pcm, 16_000, segments, { maxSpeakers: 4 })
    expect(out).toHaveLength(2)
    expect(out.every((s) => s.speakerId === 1)).toBe(true)
    expect(out.map((s) => s.text)).toEqual(['Первый', 'Второй'])
    expect(out[0]).toMatchObject({ start: 0, end: 1 })
  })

  it('не мутирует входные сегменты', async () => {
    await engine.diarize(pcm, 16_000, segments, { maxSpeakers: 4 })
    expect(segments[0].speakerId).toBe(7) // исходные не тронуты
  })

  it('пустой ввод → пустой вывод', async () => {
    expect(await engine.diarize(pcm, 16_000, [], { maxSpeakers: 4 })).toEqual([])
  })
})
