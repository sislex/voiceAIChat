import { describe, it, expect } from 'vitest'
import { parseStreamJsonLine } from './streamJson'

describe('parseStreamJsonLine', () => {
  it('извлекает session_id из system/init', () => {
    const line = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-123' })
    expect(parseStreamJsonLine(line)).toEqual({ kind: 'session', sessionId: 'sess-123' })
  })

  it('извлекает текстовую дельту из stream_event/content_block_delta', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Один' } }
    })
    expect(parseStreamJsonLine(line)).toEqual({ kind: 'delta', text: 'Один' })
  })

  it('игнорирует нетекстовые stream_event (message_start и т.п.)', () => {
    const line = JSON.stringify({ type: 'stream_event', event: { type: 'message_start' } })
    expect(parseStreamJsonLine(line)).toEqual({ kind: 'ignore' })
  })

  it('разбирает финальный result с текстом и session_id', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Привет',
      session_id: 'sess-9'
    })
    expect(parseStreamJsonLine(line)).toEqual({
      kind: 'result',
      text: 'Привет',
      sessionId: 'sess-9',
      isError: false
    })
  })

  it('помечает result как ошибочный при is_error', () => {
    const line = JSON.stringify({ type: 'result', is_error: true, result: '' })
    expect(parseStreamJsonLine(line)).toMatchObject({ kind: 'result', isError: true })
  })

  it('пустые строки → null, битый JSON → null', () => {
    expect(parseStreamJsonLine('')).toBeNull()
    expect(parseStreamJsonLine('   ')).toBeNull()
    expect(parseStreamJsonLine('{не json')).toBeNull()
  })

  it('неизвестные типы игнорируются', () => {
    expect(parseStreamJsonLine(JSON.stringify({ type: 'rate_limit_event' }))).toEqual({
      kind: 'ignore'
    })
  })
})
