import type { MessageRole, VoiceState } from '@shared/types'

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

/** CSS-класс chip для роли (учитывает выключенную диаризацию). */
export function chipClass(role: MessageRole, diarization = true): string {
  if (role === 'ai') return 'chip spa'
  if (!diarization) return 'chip sp1'
  const n = speakerNumber(role) ?? 1
  const idx = ((n - 1) % 4) + 1 // sp1..sp4, дальше по кругу
  return `chip sp${idx}`
}

/** Подпись спикера (учитывает выключенную диаризацию). */
export function speakerName(role: MessageRole, diarization = true): string {
  if (role === 'ai') return 'Claude'
  if (!diarization) return 'Вы'
  return `Спикер ${speakerNumber(role) ?? 1}`
}

/** Текст бейджа статуса в шапке. */
export function statusBadge(state: VoiceState): string {
  switch (state) {
    case 'idle':
      return 'Готов'
    case 'listening':
      return '● Запись'
    case 'transcribing':
      return 'Распознавание'
    case 'thinking':
      return 'Claude думает'
    case 'speaking':
      return 'Озвучка'
  }
}

/** Строка статуса под голосовой панелью. */
export function statusLine(state: VoiceState): string {
  switch (state) {
    case 'idle':
      return 'Пробел — говорить · Esc — стоп · STT/TTS локально, ответы через Claude'
    case 'listening':
      return 'Говорите… Whisper распознаёт речь на устройстве'
    case 'transcribing':
      return 'Финализируем транскрипт и делим по говорящим'
    case 'thinking':
      return 'Текст передан в Claude Console'
    case 'speaking':
      return 'Воспроизведение ответа'
  }
}
