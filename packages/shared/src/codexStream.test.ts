import { describe, it, expect } from 'vitest'
import { parseCodexLine, parseCodexActivity } from './codexStream'

describe('parseCodexLine', () => {
  it('thread.started → session', () => {
    expect(parseCodexLine(JSON.stringify({ type: 'thread.started', thread_id: 't1' }))).toEqual({
      kind: 'session',
      sessionId: 't1'
    })
  })

  it('item.completed agent_message → message с текстом', () => {
    const line = JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_0', type: 'agent_message', text: 'Привет' }
    })
    expect(parseCodexLine(line)).toEqual({ kind: 'message', text: 'Привет' })
  })

  it('turn.completed → result с токенами', () => {
    const line = JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 100, output_tokens: 5 }
    })
    const ev = parseCodexLine(line)
    expect(ev).toMatchObject({ kind: 'result', isError: false })
    expect(ev && ev.kind === 'result' && ev.meta).toMatchObject({ inputTokens: 100, outputTokens: 5 })
  })

  it('error / turn.failed → error с сообщением', () => {
    expect(parseCodexLine(JSON.stringify({ type: 'error', message: 'oops' }))).toEqual({
      kind: 'error',
      message: 'oops'
    })
    expect(
      parseCodexLine(JSON.stringify({ type: 'turn.failed', error: { message: 'boom' } }))
    ).toEqual({ kind: 'error', message: 'boom' })
  })

  it('мусор / незначимое → null или ignore', () => {
    expect(parseCodexLine('не json')).toBeNull()
    expect(parseCodexLine(JSON.stringify({ type: 'turn.started' }))).toEqual({ kind: 'ignore' })
  })
})

describe('parseCodexActivity', () => {
  it('agent_message → null (ответ не дублируем)', () => {
    const line = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'x' } })
    expect(parseCodexActivity(line)).toBeNull()
  })

  it('command_execution → tool_use с командой', () => {
    const line = JSON.stringify({
      type: 'item.completed',
      item: { type: 'command_execution', command: 'ls -la', aggregated_output: 'a\nb' }
    })
    const e = parseCodexActivity(line)!
    expect(e.kind).toBe('tool_use')
    expect(e.summary).toContain('ls -la')
  })

  it('reasoning → thinking', () => {
    const line = JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', text: 'думаю' } })
    expect(parseCodexActivity(line)!.kind).toBe('thinking')
  })

  it('turn.completed → result', () => {
    expect(parseCodexActivity(JSON.stringify({ type: 'turn.completed' }))!.kind).toBe('result')
  })
})
