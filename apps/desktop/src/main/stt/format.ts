// Разбор вывода whisper-cli и формирование результата STT (Шаг 7). Чистые функции.
//
// whisper-cli печатает в stdout строки вида:
//   [00:00:00.000 --> 00:00:02.480]   Привет, как дела?
// Мы парсим таймкоды и текст, чистим служебные пометки и склеиваем в SttResult.

import type { SttResult, SttSegment } from './types'

const LINE_RE =
  /^\s*\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s*(.*)$/

function toSeconds(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000
}

/**
 * Чистит текст сегмента: убирает служебные пометки whisper вида [_BEG_], (музыка),
 * [музыка], аплодисменты и т.п., схлопывает пробелы.
 */
export function cleanSegmentText(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, ' ') // [ ... ]
    .replace(/\([^)]*\)/g, ' ') // ( ... )
    .replace(/\*[^*]*\*/g, ' ') // *...*
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Парсит stdout whisper-cli в сегменты с таймкодами. Строки без валидного
 * таймкода и пустые после чистки — отбрасываются.
 */
export function parseWhisperStdout(stdout: string): SttSegment[] {
  const segments: SttSegment[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const match = LINE_RE.exec(line)
    if (!match) continue
    const text = cleanSegmentText(match[9])
    if (!text) continue
    segments.push({
      speakerId: 1, // диаризация появится на Шаге 10
      text,
      start: toSeconds(match[1], match[2], match[3], match[4]),
      end: toSeconds(match[5], match[6], match[7], match[8])
    })
  }
  return segments
}

/** Склейка текста сегментов в одну строку. */
export function joinSegments(segments: SttSegment[]): string {
  return segments
    .map((s) => s.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Формирует SttResult из вывода whisper-cli. */
export function buildResult(stdout: string, isFinal: boolean): SttResult {
  const segments = parseWhisperStdout(stdout)
  return { segments, text: joinSegments(segments), isFinal }
}
