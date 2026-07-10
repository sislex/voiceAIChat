// Мок-пайплайн Шага 5: детерминированная имитация роста live-транскрипта и
// ответа Claude — чтобы весь UX-цикл (listening → transcribing → thinking →
// speaking → idle) работал без реального ML. Реальные Whisper/Claude — Шаги 7–8.

import type { LiveSegment } from '../lib/view'

/** Задержки этапов пайплайна (мс). Переопределяются в тестах на малые значения. */
export interface PipelineDelays {
  /** Интервал появления нового «частичного» фрейма транскрипта во время записи. */
  frame: number
  /** Финализация транскрипта после остановки записи (transcribing → thinking). */
  transcribe: number
  /** «Обдумывание» Claude перед ответом (thinking → speaking). */
  think: number
  /** Длительность озвучки ответа (speaking → idle). */
  speak: number
}

export const DEFAULT_DELAYS: PipelineDelays = {
  frame: 650,
  transcribe: 550,
  think: 1300,
  speak: 2600
}

/**
 * Кадры растущего транскрипта при включённой диаризации: два спикера,
 * реплики «доезжают» по словам (имитация частичных гипотез Whisper).
 */
const FRAMES_DIARIZED: LiveSegment[][] = [
  [{ speakerId: 1, text: 'Слушай,' }],
  [{ speakerId: 1, text: 'Слушай, а спроси заодно —' }],
  [{ speakerId: 1, text: 'Слушай, а спроси заодно — что стоит посмотреть за три дня?' }],
  [
    { speakerId: 1, text: 'Слушай, а спроси заодно — что стоит посмотреть за три дня?' },
    { speakerId: 2, text: 'И добавь:' }
  ],
  [
    { speakerId: 1, text: 'Слушай, а спроси заодно — что стоит посмотреть за три дня?' },
    { speakerId: 2, text: 'И добавь: мы будем с ребёнком, лет пять ему.' }
  ]
]

/** Кадры без диаризации: один говорящий, реплика растёт по словам. */
const FRAMES_MONO: LiveSegment[][] = [
  [{ speakerId: 1, text: 'Слушай,' }],
  [{ speakerId: 1, text: 'Слушай, а спроси заодно —' }],
  [{ speakerId: 1, text: 'Слушай, а спроси заодно — что стоит посмотреть за три дня с ребёнком?' }]
]

/** Последовательность кадров live-транскрипта для текущего режима диаризации. */
export function transcriptFrames(diarization: boolean): LiveSegment[][] {
  return diarization ? FRAMES_DIARIZED : FRAMES_MONO
}

/**
 * Мок-ответ «Claude» на реплику пользователя. Детерминирован (без рандома),
 * чтобы тесты были стабильны. Реальный стрим токенов появится на Шаге 8.
 */
export function mockReply(prompt: string): string {
  const trimmed = prompt.trim()
  const echo = trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed
  return (
    `Понял вопрос: «${echo}». ` +
    'Это демонстрационный ответ мок-пайплайна — на Шаге 8 здесь будет реальный ' +
    'стрим от Claude Code CLI.'
  )
}

/** Заголовок нового разговора из первой реплики (обрезка до ~40 символов). */
export function titleFromText(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (!trimmed) return 'Новый разговор'
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed
}

/** Форматирование времени сообщения в HH:MM для отображения в ленте. */
export function formatTime(ms: number): string {
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}
