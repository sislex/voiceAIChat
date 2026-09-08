import { describe, expect, it, vi } from 'vitest'
import { createChunkSink } from './chunkSink.js'

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('createChunkSink', () => {
  it('склеивает чанки в одну запись по интервалу и держит не больше одной записи в полёте', async () => {
    const writes: string[] = []
    let release: () => void = () => {}
    const write = vi.fn(async (data: string) => { writes.push(data); await new Promise<void>((r) => { release = r }) })
    const sink = createChunkSink(write, { intervalMs: 10 })
    sink.push('a'); sink.push('b')
    expect(write).not.toHaveBeenCalled()
    await tick(20)
    expect(writes).toEqual(['ab'])
    // Пока первая запись в полёте, новые чанки копятся, а не пишутся.
    sink.push('c'); sink.push('d')
    await tick(20)
    expect(writes).toEqual(['ab'])
    release()
    await tick(5)
    expect(writes).toEqual(['ab', 'cd'])
    release()
    await sink.flush()
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('большой буфер пишется сразу; flush дописывает хвост и поднимает ошибку записи', async () => {
    const writes: string[] = []
    const sink = createChunkSink(async (data) => { writes.push(data); if (data.includes('boom')) throw new Error('disk') }, { intervalMs: 1_000, maxBytes: 4 })
    sink.push('12345')
    await tick(1)
    expect(writes).toEqual(['12345'])
    sink.push('boom')
    await expect(sink.flush()).rejects.toThrow('disk')
    expect(writes).toEqual(['12345', 'boom'])
    sink.push('tail')
    await sink.flush()
    expect(writes.at(-1)).toBe('tail')
  })
})
