import { describe, expect, it } from 'vitest'
import { createLane } from './lane.js'

const tick = (ms = 2) => new Promise((r) => setTimeout(r, ms))

describe('полоса вызовов', () => {
  it('выполняет вызовы по одному в порядке поступления; первый — синхронно', async () => {
    const lane = createLane()
    const log: string[] = []
    const p1 = lane.run(async () => { log.push('a1'); await tick(); log.push('a2'); return 'a' })
    expect(log).toEqual(['a1']) // тело стартовало до возврата промиса
    const p2 = lane.run(async () => { log.push('b1'); await tick(); log.push('b2'); return 'b' })
    const p3 = lane.run(() => { log.push('c'); return 'c' })
    expect(lane.pending).toBe(3)
    expect(await Promise.all([p1, p2, p3])).toEqual(['a', 'b', 'c'])
    expect(log).toEqual(['a1', 'a2', 'b1', 'b2', 'c'])
    await tick()
    expect(lane.pending).toBe(0)
  })

  it('ошибка одного вызова не ломает очередь; повторный вход из контекста полосы не ждёт', async () => {
    const lane = createLane()
    const failing = lane.run(async () => { await tick(); throw new Error('нет') })
    const nested = lane.run(async () => {
      // Внутри полосы зовём её же — без ожидания, иначе взаимная блокировка.
      const inner = await lane.run(async () => 'inner')
      return `outer:${inner}`
    })
    await expect(failing).rejects.toThrow('нет')
    expect(await nested).toBe('outer:inner')
  })
})
