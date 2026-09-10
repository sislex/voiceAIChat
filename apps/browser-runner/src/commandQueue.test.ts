import { describe, expect, it } from 'vitest'
import { BrowserCommandQueue } from './commandQueue'

describe('очередь Chromium', () => {
  it('сохраняет порядок и продолжает после ошибки', async () => {
    const queue = new BrowserCommandQueue(), log: number[] = []
    const first = queue.enqueue('assistant', async () => { await new Promise(r => setTimeout(r, 15)); log.push(1); throw new Error('fail') })
    const second = queue.enqueue('user', async () => { log.push(2) })
    await expect(first).rejects.toThrow('fail')
    await second
    expect(log).toEqual([1, 2])
    expect(queue.size).toBe(0)
  })
  it('передача человеку отменяет очередь, дожидаясь уже начатого действия', async () => {
    const queue = new BrowserCommandQueue(), log: string[] = []
    let finish!: () => void
    const active = queue.enqueue('assistant', () => new Promise<void>(r => { finish = () => { log.push('active'); r() } }))
    await Promise.resolve()
    const stale = queue.enqueue('assistant', async () => { log.push('stale') })
    const failure = expect(stale).rejects.toThrow('command_cancelled')
    queue.control('user')
    const user = queue.enqueue('user', async () => { log.push('user') })
    finish()
    await Promise.all([active, failure, user])
    expect(log).toEqual(['active', 'user'])
    expect(queue.size).toBe(0)
    await expect(queue.enqueue('assistant', async () => 1)).rejects.toThrow('human_control')
    expect(await queue.enqueue('assistant', async () => 2, true)).toBe(2)
    queue.control('shared')
    expect(await queue.enqueue('assistant', async () => 3)).toBe(3)
  })
})
