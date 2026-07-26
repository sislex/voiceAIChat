import { describe, it, expect, vi } from 'vitest'
import { installSignalHandlers, FORCE_EXIT_MS } from './shutdown.js'

/** Ловушка сигналов: отдаёт функцию «прислать сигнал». */
function harness(overrides: { stop?: () => void } = {}) {
  const handlers: Record<string, Array<() => void>> = {}
  const exits: number[] = []
  const timers: Array<{ fn: () => void; ms: number }> = []
  const stop = vi.fn(overrides.stop)
  installSignalHandlers(
    { stop },
    {
      on: (s, h) => {
        handlers[s] ??= []
        handlers[s].push(h)
      },
      exit: (code) => void exits.push(code),
      setTimer: (fn, ms) => void timers.push({ fn, ms }),
      log: () => {}
    }
  )
  return { send: (s: 'SIGTERM' | 'SIGINT') => handlers[s]?.forEach((h) => h()), exits, timers, stop }
}

describe('installSignalHandlers', () => {
  it('вешается и на SIGTERM, и на SIGINT', () => {
    for (const s of ['SIGTERM', 'SIGINT'] as const) {
      const h = harness()
      h.send(s)
      expect(h.stop).toHaveBeenCalledTimes(1)
    }
  })

  it('по сигналу закрывает соединение и планирует принудительный выход', () => {
    const h = harness()
    h.send('SIGTERM')
    expect(h.stop).toHaveBeenCalledTimes(1)
    expect(h.timers).toHaveLength(1)
    expect(h.timers[0].ms).toBe(FORCE_EXIT_MS)
    expect(h.exits).toEqual([]) // сразу не выходим — даём закрыться

    h.timers[0].fn()
    expect(h.exits).toEqual([0])
  })

  it('второй сигнал выходит немедленно и не зовёт stop повторно', () => {
    const h = harness()
    h.send('SIGTERM')
    h.send('SIGTERM')
    expect(h.stop).toHaveBeenCalledTimes(1)
    expect(h.exits).toEqual([1])
  })

  it('падение stop() не мешает выйти', () => {
    const h = harness({
      stop: () => {
        throw new Error('сокет уже закрыт')
      }
    })
    expect(() => h.send('SIGTERM')).not.toThrow()
    h.timers[0].fn()
    expect(h.exits).toEqual([0])
  })
})
