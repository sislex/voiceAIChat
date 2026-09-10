import { describe, it, expect, vi } from 'vitest'
import { playStartCue, playStopCue, playThinkingCue } from './cues'

describe('звуковые сигналы (cues)', () => {
  it('без AudioContext (jsdom) не бросают — безопасный no-op', () => {
    expect(() => playStartCue()).not.toThrow()
    expect(() => playStopCue()).not.toThrow()
    expect(() => playThinkingCue()).not.toThrow()
  })

  it('используют AudioContext, если он доступен', () => {
    const stop = vi.fn()
    const osc = { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop }
    const gain = {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn()
    }
    const ctxMock = {
      currentTime: 0,
      resume: vi.fn(),
      destination: {},
      createOscillator: vi.fn(() => osc),
      createGain: vi.fn(() => gain)
    }
    const AudioCtor = vi.fn(() => ctxMock)
    vi.stubGlobal('AudioContext', AudioCtor)
    try {
      playStartCue() // два тона
      expect(ctxMock.createOscillator).toHaveBeenCalledTimes(2)
      expect(osc.start).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
