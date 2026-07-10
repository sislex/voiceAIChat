import { describe, it, expect } from 'vitest'
import {
  transition,
  canTransition,
  allowedEvents,
  INITIAL_STATE,
  type VoiceEvent
} from './stateMachine'
import type { VoiceState } from './types'

describe('stateMachine — начальное состояние', () => {
  it('стартует из idle', () => {
    expect(INITIAL_STATE).toBe('idle')
  })
})

describe('stateMachine — полный успешный цикл', () => {
  it('idle → listening → transcribing → thinking → speaking → idle', () => {
    let s: VoiceState = INITIAL_STATE
    const path: Array<[VoiceEvent, VoiceState]> = [
      ['mic_press', 'listening'],
      ['stop_listening', 'transcribing'],
      ['transcribed', 'thinking'],
      ['reply_ready', 'speaking'],
      ['speaking_done', 'idle']
    ]
    for (const [event, expected] of path) {
      const r = transition(s, event)
      expect(r.ok).toBe(true)
      expect(r.state).toBe(expected)
      s = r.state
    }
  })
})

describe('stateMachine — текстовый ввод', () => {
  it('idle → thinking по submit_text (в обход записи)', () => {
    expect(transition('idle', 'submit_text')).toEqual({ state: 'thinking', ok: true })
  })
})

describe('stateMachine — barge-in', () => {
  it('speaking → listening по mic_press', () => {
    expect(transition('speaking', 'mic_press')).toEqual({ state: 'listening', ok: true })
  })

  it('speaking → idle по stop_speaking', () => {
    expect(transition('speaking', 'stop_speaking')).toEqual({ state: 'idle', ok: true })
  })
})

describe('stateMachine — reset и error возвращают в idle из активных состояний', () => {
  const active: VoiceState[] = ['listening', 'transcribing', 'thinking', 'speaking']
  for (const s of active) {
    it(`${s} → idle по reset`, () => {
      expect(transition(s, 'reset')).toEqual({ state: 'idle', ok: true })
    })
    it(`${s} → idle по error`, () => {
      expect(transition(s, 'error')).toEqual({ state: 'idle', ok: true })
    })
  }
})

describe('stateMachine — недопустимые переходы не меняют состояние', () => {
  const invalid: Array<[VoiceState, VoiceEvent]> = [
    ['idle', 'stop_listening'],
    ['idle', 'transcribed'],
    ['idle', 'reply_ready'],
    ['idle', 'speaking_done'],
    ['idle', 'reset'],
    ['listening', 'mic_press'],
    ['listening', 'reply_ready'],
    ['transcribing', 'mic_press'],
    ['thinking', 'mic_press'],
    ['thinking', 'stop_listening'],
    ['speaking', 'submit_text'],
    ['speaking', 'transcribed']
  ]
  for (const [state, event] of invalid) {
    it(`${state} + ${event} → отклонено`, () => {
      const r = transition(state, event)
      expect(r.ok).toBe(false)
      expect(r.state).toBe(state)
    })
  }
})

describe('stateMachine — вспомогательные функции', () => {
  it('canTransition согласован с transition', () => {
    expect(canTransition('idle', 'mic_press')).toBe(true)
    expect(canTransition('idle', 'reply_ready')).toBe(false)
  })

  it('allowedEvents перечисляет только валидные события', () => {
    expect(allowedEvents('idle').sort()).toEqual(['mic_press', 'submit_text'])
    expect(allowedEvents('listening').sort()).toEqual(['error', 'reset', 'stop_listening'])
  })

  it('transition не мутирует и детерминирована', () => {
    const first = transition('idle', 'mic_press')
    const second = transition('idle', 'mic_press')
    expect(first).toEqual(second)
  })
})
