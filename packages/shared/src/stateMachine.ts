import type { VoiceState } from './types'

/**
 * События, управляющие голосовым пайплайном.
 *
 * - `mic_press`      — нажатие микрофона: старт записи из idle; barge-in из speaking.
 * - `stop_listening` — пользователь нажал «стоп» (или авто-пауза) во время записи.
 * - `transcribed`    — распознавание/диаризация завершены, сегменты готовы.
 * - `reply_ready`    — Claude вернул ответ, начинаем озвучку.
 * - `speaking_done`  — озвучка доиграла сама.
 * - `stop_speaking`  — пользователь прервал озвучку кнопкой «стоп».
 * - `submit_text`    — отправка текста из инпута (в обход записи).
 * - `reset`          — сброс к idle (новый разговор, переключение).
 * - `error`          — ошибка в пайплайне, возвращаемся в idle.
 */
export type VoiceEvent =
  | 'mic_press'
  | 'stop_listening'
  | 'transcribed'
  | 'reply_ready'
  | 'speaking_done'
  | 'stop_speaking'
  | 'submit_text'
  | 'reset'
  | 'error'

export const INITIAL_STATE: VoiceState = 'idle'

/**
 * Таблица допустимых переходов: state → (event → nextState).
 * Отсутствие записи означает недопустимый переход.
 */
const TRANSITIONS: Record<VoiceState, Partial<Record<VoiceEvent, VoiceState>>> = {
  idle: {
    mic_press: 'listening',
    submit_text: 'thinking'
  },
  listening: {
    stop_listening: 'transcribing',
    reset: 'idle',
    error: 'idle'
  },
  transcribing: {
    transcribed: 'thinking',
    reset: 'idle',
    error: 'idle'
  },
  thinking: {
    reply_ready: 'speaking',
    reset: 'idle',
    error: 'idle'
  },
  speaking: {
    speaking_done: 'idle',
    stop_speaking: 'idle',
    mic_press: 'listening', // barge-in: новое нажатие микрофона прерывает озвучку
    reset: 'idle',
    error: 'idle'
  }
}

/** Результат перехода. `ok=false` — переход недопустим, состояние не меняется. */
export interface TransitionResult {
  state: VoiceState
  ok: boolean
}

/**
 * Чистая функция перехода машины состояний.
 * Не мутирует вход, детерминирована.
 */
export function transition(state: VoiceState, event: VoiceEvent): TransitionResult {
  const next = TRANSITIONS[state]?.[event]
  if (next === undefined) {
    return { state, ok: false }
  }
  return { state: next, ok: true }
}

/** Проверка, допустимо ли событие в текущем состоянии. */
export function canTransition(state: VoiceState, event: VoiceEvent): boolean {
  return TRANSITIONS[state]?.[event] !== undefined
}

/** Список допустимых событий из состояния (удобно для UI/тестов). */
export function allowedEvents(state: VoiceState): VoiceEvent[] {
  return Object.keys(TRANSITIONS[state] ?? {}) as VoiceEvent[]
}
