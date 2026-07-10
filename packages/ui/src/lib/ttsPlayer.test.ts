import { describe, it, expect, vi } from 'vitest'
import { enqueueTtsAudio, stopTts } from './ttsPlayer'

describe('ttsPlayer', () => {
  it('без AudioContext (jsdom) сразу зовёт onEnded для клипа', async () => {
    const onEnded = vi.fn()
    enqueueTtsAudio(new ArrayBuffer(8), onEnded)
    await new Promise((r) => setTimeout(r, 0))
    expect(onEnded).toHaveBeenCalledOnce()
  })

  it('очередь: несколько клипов проигрываются по очереди (onEnded у каждого)', async () => {
    const a = vi.fn()
    const b = vi.fn()
    enqueueTtsAudio(new ArrayBuffer(4), a)
    enqueueTtsAudio(new ArrayBuffer(4), b)
    await new Promise((r) => setTimeout(r, 0))
    expect(a).toHaveBeenCalledOnce()
    expect(b).toHaveBeenCalledOnce()
  })

  it('stopTts безопасен, когда ничего не играет', () => {
    expect(() => stopTts()).not.toThrow()
  })
})
