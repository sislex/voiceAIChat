import { afterEach, expect, it, vi } from 'vitest'
import { startProcessMemoryLogger } from './processMemory.js'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

it('logs MiB every five minutes with an unreferenced, stoppable interval', () => {
  vi.useFakeTimers()
  const interval = vi.spyOn(globalThis, 'setInterval')
  const log = vi.fn()
  const stop = startProcessMemoryLogger(log, () => ({
    rss: 10 * 1024 ** 2, heapUsed: 2 * 1024 ** 2, heapTotal: 4 * 1024 ** 2,
    external: 1024 ** 2, arrayBuffers: 512 * 1024,
  }))
  expect(interval.mock.results[0]!.value.hasRef()).toBe(false)
  vi.advanceTimersByTime(299_999)
  expect(log).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(JSON.parse(log.mock.calls[0]![0])).toEqual({
    event: 'process_memory', rss: 10, heapUsed: 2, heapTotal: 4, external: 1, arrayBuffers: 0.5,
  })
  stop()
  vi.advanceTimersByTime(600_000)
  expect(log).toHaveBeenCalledOnce()
})
