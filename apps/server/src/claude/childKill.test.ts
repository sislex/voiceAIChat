import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { killCliChild } from './childKill.js'

/** Минимальный «процесс CLI»: помнит сигналы и умеет закрыться. */
function fakeChild(): ChildProcess & { signals: string[]; close: () => void } {
  const em = new EventEmitter() as unknown as ChildProcess & { signals: string[]; close: () => void }
  const signals: string[] = []
  Object.assign(em, {
    signals,
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill: (s: NodeJS.Signals) => {
      signals.push(s)
      return true
    },
    close: () => {
      ;(em as { exitCode: number | null }).exitCode = 0
      em.emit('close', 0)
    }
  })
  return em
}

afterEach(() => vi.useRealTimers())

describe('killCliChild', () => {
  it('SIGTERM сразу, SIGKILL — если процесс не завершился', () => {
    vi.useFakeTimers()
    const child = fakeChild()
    killCliChild(child, 5000)
    expect(child.signals).toEqual(['SIGTERM'])
    vi.advanceTimersByTime(5000)
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('мок процесса без exitCode/signalCode всё равно получает сигнал', () => {
    // Так выглядят фейковые дети в claudeCli.test.ts/codexCli.test.ts.
    const signals: string[] = []
    const bare = Object.assign(new EventEmitter(), { kill: (s: NodeJS.Signals) => signals.push(s) }) as unknown as ChildProcess
    killCliChild(bare, 5000)()
    expect(signals).toEqual(['SIGTERM'])
  })

  it('завершившийся процесс SIGKILL не получает', () => {
    vi.useFakeTimers()
    const child = fakeChild()
    killCliChild(child, 5000)
    child.close()
    vi.advanceTimersByTime(5000)
    expect(child.signals).toEqual(['SIGTERM'])
  })
})
