import type { LlmProvider, MessageRole, TurnMeta, VoiceState } from '@shared/types'

export const ACCENT = '#3D64C8'

/** Строка live-транскрипта во время записи. */
export interface LiveSegment {
  speakerId: number
  text: string
}

/** Номер спикера из роли `u1`/`u2`/… (или null для Claude). */
export function speakerNumber(role: MessageRole): number | null {
  if (role === 'ai') return null
  const n = Number(role.slice(1))
  return Number.isFinite(n) ? n : 1
}

/**
 * CSS-класс chip для роли (учитывает выключенную диаризацию). Для ответов ИИ
 * цвет зависит от движка: Claude — `spa`, Codex — `spx` (разные цвета, чтобы
 * сразу видеть, кто ответил).
 */
export function chipClass(role: MessageRole, diarization = true, engine?: LlmProvider): string {
  if (role === 'ai') return engine === 'codex' ? 'chip spx' : 'chip spa'
  if (!diarization) return 'chip sp1'
  const n = speakerNumber(role) ?? 1
  const idx = ((n - 1) % 4) + 1 // sp1..sp4, дальше по кругу
  return `chip sp${idx}`
}

/**
 * Подпись движка по значению, запечённому в сообщение. Отсутствие (старые
 * сообщения, созданные до появления поля) → «Claude» (исторический дефолт).
 */
export function engineLabel(engine?: LlmProvider): string {
  return engine === 'codex' ? 'Codex' : 'Claude'
}

/** Подпись спикера (учитывает выключенную диаризацию). aiLabel — имя движка. */
export function speakerName(role: MessageRole, diarization = true, aiLabel = 'Claude'): string {
  if (role === 'ai') return aiLabel
  if (!diarization) return 'Вы'
  return `Спикер ${speakerNumber(role) ?? 1}`
}

/** Текст бейджа статуса в шапке. aiLabel — имя движка (для «… думает»). */
export function statusBadge(state: VoiceState, aiLabel = 'Claude'): string {
  switch (state) {
    case 'idle':
      return 'Готов'
    case 'listening':
      return '● Запись'
    case 'transcribing':
      return 'Распознавание'
    case 'thinking':
      return `${aiLabel} думает`
    case 'speaking':
      return 'Озвучка'
  }
}

/** Строка статуса под голосовой панелью. aiLabel — имя движка ответа. */
export function statusLine(state: VoiceState, aiLabel = 'Claude'): string {
  switch (state) {
    case 'idle':
      return `Пробел — говорить · Esc — стоп · распознавание и озвучка локально, ответы через ${aiLabel}`
    case 'listening':
      return 'Говорите… Whisper распознаёт речь на устройстве'
    case 'transcribing':
      return 'Финализируем транскрипт и делим по говорящим'
    case 'thinking':
      return `Текст передан движку ${aiLabel}`
    case 'speaking':
      return 'Воспроизведение ответа'
  }
}

/** Компактная строка меты хода: «7.2с · 2 хода · $0.013 · 1.2k→0.4k ток.». */
export function formatTurnMeta(meta: TurnMeta): string {
  const parts: string[] = []
  if (typeof meta.durationMs === 'number') parts.push(`${(meta.durationMs / 1000).toFixed(1)}с`)
  if (typeof meta.numTurns === 'number') parts.push(`${meta.numTurns} ${pluralTurns(meta.numTurns)}`)
  if (typeof meta.costUsd === 'number') parts.push(`$${meta.costUsd.toFixed(meta.costUsd < 0.1 ? 4 : 2)}`)
  if (typeof meta.inputTokens === 'number' && typeof meta.outputTokens === 'number') {
    parts.push(`${kilo(meta.inputTokens)}→${kilo(meta.outputTokens)} ток.`)
  }
  return parts.join(' · ')
}

function kilo(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function pluralTurns(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'ход'
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'хода'
  return 'ходов'
}
