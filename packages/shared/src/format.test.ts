import { describe, it, expect } from 'vitest'
import {
  buildResult,
  cleanSegmentText,
  joinSegments,
  parseWhisperStdout
} from './format'

const SAMPLE = [
  '[00:00:00.000 --> 00:00:02.480]   Привет, как дела?',
  '[00:00:02.480 --> 00:00:05.000]   [музыка]',
  '[00:00:05.000 --> 00:00:07.320]   Хорошо, спасибо.',
  'whisper_print_timings:     load time =   123.45 ms',
  ''
].join('\n')

describe('parseWhisperStdout', () => {
  it('парсит строки с таймкодами и извлекает текст + границы', () => {
    const segs = parseWhisperStdout(SAMPLE)
    expect(segs).toHaveLength(2) // строка [музыка] чистится в пустую → отброшена
    expect(segs[0]).toMatchObject({ speakerId: 1, text: 'Привет, как дела?', start: 0 })
    expect(segs[0].end).toBeCloseTo(2.48, 3)
    expect(segs[1].text).toBe('Хорошо, спасибо.')
    expect(segs[1].start).toBeCloseTo(5, 3)
  })

  it('игнорирует служебные строки без таймкода', () => {
    expect(parseWhisperStdout('whisper: foo\nrandom text')).toHaveLength(0)
  })
})

describe('cleanSegmentText', () => {
  it('убирает служебные пометки и схлопывает пробелы', () => {
    expect(cleanSegmentText('  [_BEG_] Привет   [музыка] (шум) *вздох* мир  ')).toBe('Привет мир')
  })
  it('пустая строка для чистого шума', () => {
    expect(cleanSegmentText('[музыка]')).toBe('')
  })
})

describe('joinSegments / buildResult', () => {
  it('joinSegments склеивает текст сегментов', () => {
    expect(joinSegments(parseWhisperStdout(SAMPLE))).toBe('Привет, как дела? Хорошо, спасибо.')
  })

  it('buildResult проставляет isFinal и агрегирует текст', () => {
    const res = buildResult(SAMPLE, true)
    expect(res.isFinal).toBe(true)
    expect(res.segments).toHaveLength(2)
    expect(res.text).toContain('Привет')

    expect(buildResult(SAMPLE, false).isFinal).toBe(false)
  })
})
