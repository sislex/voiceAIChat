import { describe, expect, it, vi } from 'vitest'
import { retryOnDeadlock } from './database.js'

const deadlock = () => Object.assign(new Error('deadlock detected'), { code: '40P01' })

describe('retryOnDeadlock', () => {
  it('retries an operation that lost a deadlock and returns its result', async () => {
    const operation = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(deadlock())
      .mockRejectedValueOnce(deadlock())
      .mockResolvedValue('ok')
    await expect(retryOnDeadlock(operation, 5, 0)).resolves.toBe('ok')
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('gives up after the attempt limit and passes other errors through at once', async () => {
    const always = vi.fn<() => Promise<never>>().mockRejectedValue(deadlock())
    await expect(retryOnDeadlock(always, 3, 0)).rejects.toMatchObject({ code: '40P01' })
    expect(always).toHaveBeenCalledTimes(3)
    const other = vi.fn<() => Promise<never>>().mockRejectedValue(Object.assign(new Error('boom'), { code: '42P01' }))
    await expect(retryOnDeadlock(other, 5, 0)).rejects.toThrow('boom')
    expect(other).toHaveBeenCalledTimes(1)
  })
})
