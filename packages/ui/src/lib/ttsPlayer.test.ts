import { describe, it, expect, vi } from 'vitest'
import { enqueueTtsAudio, stopTts } from './ttsPlayer'

import { UiPerformance } from './uiPerformance'
// @testCase T1
// @testCase T2
it('records audio only after a running output clock advances, and never after cancellation', async () => {
  vi.useFakeTimers()
  const mark=vi.spyOn(UiPerformance.prototype,'mark').mockImplementation(()=>{})
  const source={buffer:null,connect:vi.fn(),start:vi.fn(),stop:vi.fn(),onended:null}
  const context={currentTime:0,state:'suspended',destination:{},resume:vi.fn(async()=>{}),decodeAudioData:vi.fn(async()=>({})),createBufferSource:()=>source}
  vi.stubGlobal('AudioContext',class {constructor(){return context}})
  vi.stubGlobal('window',{api:undefined})
  vi.stubGlobal('navigator',{onLine:true,userAgent:'test'})
  try {
    enqueueTtsAudio(new ArrayBuffer(8),()=>{})
    await vi.advanceTimersByTimeAsync(40)
    expect(source.start).toHaveBeenCalledOnce()
    expect(mark).not.toHaveBeenCalled()
    context.state='running';context.currentTime=.1
    await vi.advanceTimersByTimeAsync(20)
    expect(mark).toHaveBeenCalledWith('message','message_first_audio')
    mark.mockClear();stopTts()
    enqueueTtsAudio(new ArrayBuffer(8),()=>{})
    await vi.advanceTimersByTimeAsync(0);stopTts();context.currentTime=.2
    await vi.advanceTimersByTimeAsync(100)
    expect(mark).not.toHaveBeenCalled()
  } finally {stopTts();mark.mockRestore();vi.unstubAllGlobals();vi.useRealTimers()}
})

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
