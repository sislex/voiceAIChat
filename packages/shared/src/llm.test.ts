import { describe, it, expect } from 'vitest'
import { parseLlmRunFrame } from './llm'

describe('parseLlmRunFrame: разбор NDJSON-потока исполнителя', () => {
  it('читает конверты out/err/exit', () => {
    expect(parseLlmRunFrame('{"t":"out","s":"строка"}')).toEqual({ t: 'out', s: 'строка' })
    expect(parseLlmRunFrame('{"t":"err","s":"stderr"}')).toEqual({ t: 'err', s: 'stderr' })
    expect(parseLlmRunFrame('{"t":"exit","code":0}')).toEqual({ t: 'exit', code: 0 })
    // Убит сигналом — кода нет, и это не мусор: ход надо закрыть.
    expect(parseLlmRunFrame('{"t":"exit"}')).toEqual({ t: 'exit', code: null })
  })

  it('мусор даёт null, а не исключение: одна битая строка не должна ронять ход', () => {
    for (const line of ['', '   ', 'не json', '{"t":"keepalive"}', '{"t":"out"}', 'null', '42', '"строка"']) {
      expect(parseLlmRunFrame(line)).toBeNull()
    }
  })
})
