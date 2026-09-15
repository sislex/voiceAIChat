import { afterEach, expect, it, vi } from 'vitest'
import { prepareReaderPreview } from './preparePreview'
afterEach(() => vi.useRealTimers())
it('converts a synchronous throw into preparation failure', async () => {
  await expect(prepareReaderPreview(() => { throw new Error('offline') }, new AbortController().signal)).resolves.toBe(false)
})
it('bounds preparation that never settles', async () => {
  vi.useFakeTimers()
  const result = prepareReaderPreview(() => new Promise(() => {}), new AbortController().signal)
  await vi.advanceTimersByTimeAsync(15_000); await expect(result).resolves.toBe(false)
  expect(vi.getTimerCount()).toBe(0)
})
it('cancels an active preparation and releases its timer', async () => {
  vi.useFakeTimers(); const controller = new AbortController()
  const result = prepareReaderPreview(() => new Promise(() => {}), controller.signal)
  controller.abort(); await expect(result).resolves.toBe(false); expect(vi.getTimerCount()).toBe(0)
})
it('does not start preparation after cancellation and cleans up success', async () => {
  vi.useFakeTimers(); const controller = new AbortController(), ensure = vi.fn(async () => true)
  controller.abort(); await expect(prepareReaderPreview(ensure, controller.signal)).resolves.toBe(false)
  expect(ensure).not.toHaveBeenCalled()
  await expect(prepareReaderPreview(ensure, new AbortController().signal)).resolves.toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})
