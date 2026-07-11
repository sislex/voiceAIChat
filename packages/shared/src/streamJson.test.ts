import { describe, it, expect } from 'vitest'
import { parseStreamJsonActivity, parseStreamJsonLine } from './streamJson'

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

describe('parseStreamJsonActivity (режим консоли)', () => {
  it('system/init → модель и режим в summary, raw сохранён', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: 's1',
      model: 'claude-sonnet-4-5',
      permissionMode: 'acceptEdits',
      tools: ['Bash', 'Read', 'Edit'],
      cwd: '/proj'
    })
    const e = parseStreamJsonActivity(line)!
    expect(e.kind).toBe('system')
    expect(e.summary).toContain('claude-sonnet-4-5')
    expect(e.summary).toContain('acceptEdits')
    expect(e.summary).toContain('инструментов 3')
    expect(e.detail).toContain('/proj')
    expect(e.raw).toBe(line)
  })

  it('assistant tool_use (Bash) → команда в summary', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] }
    })
    const e = parseStreamJsonActivity(line)!
    expect(e.kind).toBe('tool_use')
    expect(e.summary).toBe('Bash: npm test')
    expect(e.detail).toContain('npm test')
  })

  it('assistant tool_use (Read) → путь файла', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/a/b.ts' } }] }
    })
    expect(parseStreamJsonActivity(line)!.summary).toBe('Read: /a/b.ts')
  })

  it('assistant thinking → размышление', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'thinking', thinking: 'Надо проверить тесты' }] }
    })
    const e = parseStreamJsonActivity(line)!
    expect(e.kind).toBe('thinking')
    expect(e.summary).toContain('Надо проверить тесты')
  })

  it('assistant text → null (ответ не дублируем в консоли)', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Привет' }] }
    })
    expect(parseStreamJsonActivity(line)).toBeNull()
  })

  it('user tool_result → результат с признаком ошибки', () => {
    const ok = JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', content: 'exit 0', is_error: false }] }
    })
    const err = JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', content: 'boom', is_error: true }] }
    })
    expect(parseStreamJsonActivity(ok)!.kind).toBe('tool_result')
    expect(parseStreamJsonActivity(ok)!.summary).toContain('результат')
    expect(parseStreamJsonActivity(err)!.summary).toContain('ошибка')
  })

  it('result → итог; stream_event и мусор → null', () => {
    const res = parseStreamJsonActivity(
      JSON.stringify({ type: 'result', is_error: false, num_turns: 2, duration_ms: 3000 })
    )!
    expect(res.kind).toBe('result')
    expect(res.summary).toContain('Готово')
    expect(parseStreamJsonActivity(JSON.stringify({ type: 'stream_event', event: {} }))).toBeNull()
    expect(parseStreamJsonActivity('')).toBeNull()
    expect(parseStreamJsonActivity('не json')).toBeNull()
  })
})
