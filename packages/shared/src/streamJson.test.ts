import { describe, it, expect } from 'vitest'
import { createUsageAccumulator, parseStreamJsonActivity, parseStreamJsonLine } from './streamJson'

describe('parseStreamJsonLine', () => {
  it('извлекает session_id из system/init', () => {
    const line = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-123' })
    expect(parseStreamJsonLine(line)).toMatchObject({ kind: 'session', sessionId: 'sess-123' })
  })

  it('извлекает окружение хода (инструменты/навыки/mcp) из system/init', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: 'sess-1',
      model: 'claude-opus',
      cwd: '/repo',
      permissionMode: 'acceptEdits',
      tools: ['Bash', 'Read', 'Edit'],
      slash_commands: ['review', 'init'],
      mcp_servers: [{ name: 'remote', status: 'connected' }, 'fs']
    })
    const ev = parseStreamJsonLine(line)
    expect(ev).toMatchObject({ kind: 'session', sessionId: 'sess-1' })
    expect(ev && 'init' in ev ? ev.init : undefined).toEqual({
      model: 'claude-opus',
      cwd: '/repo',
      permissionMode: 'acceptEdits',
      tools: ['Bash', 'Read', 'Edit'],
      slashCommands: ['review', 'init'],
      mcpServers: ['remote', 'fs']
    })
  })

  it('парсит кэш-токены из usage в result', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'ok',
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 5
      }
    })
    const ev = parseStreamJsonLine(line)
    expect(ev && ev.kind === 'result' ? ev.meta : undefined).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 80,
      cacheCreationTokens: 5
    })
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
      isError: false,
      meta: {}
    })
  })

  it('помечает result как ошибочный при is_error', () => {
    const line = JSON.stringify({ type: 'result', is_error: true, result: '' })
    expect(parseStreamJsonLine(line)).toMatchObject({ kind: 'result', isError: true })
  })

  it('извлекает мету хода из result (длительность/ходы/стоимость/токены)', () => {
    const line = JSON.stringify({
      type: 'result',
      is_error: false,
      result: 'ок',
      duration_ms: 7200,
      num_turns: 2,
      total_cost_usd: 0.0131,
      usage: { input_tokens: 1234, output_tokens: 456 }
    })
    const ev = parseStreamJsonLine(line)
    expect(ev).toMatchObject({
      kind: 'result',
      meta: { durationMs: 7200, numTurns: 2, costUsd: 0.0131, inputTokens: 1234, outputTokens: 456 }
    })
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

  it('assistant tool_use (mcp__remote__bash) → короткое имя и команда', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'mcp__remote__bash', input: { command: 'df -h' } }]
      }
    })
    const e = parseStreamJsonActivity(line)!
    expect(e.kind).toBe('tool_use')
    expect(e.summary).toBe('remote:bash: df -h')
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

describe('usage-события (живой счётчик токенов)', () => {
  it('message_start даёт usage с message id', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'message_start',
        message: {
          id: 'msg_1',
          usage: { input_tokens: 4, output_tokens: 1, cache_read_input_tokens: 100, cache_creation_input_tokens: 7 }
        }
      }
    })
    expect(parseStreamJsonLine(line)).toEqual({
      kind: 'usage',
      messageId: 'msg_1',
      usage: { inputTokens: 4, outputTokens: 1, cacheReadTokens: 100, cacheCreationTokens: 7 }
    })
  })

  it('message_delta даёт кумулятивный выход без id', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 42 } }
    })
    expect(parseStreamJsonLine(line)).toEqual({ kind: 'usage', usage: { outputTokens: 42 } })
  })

  it('assistant-сообщение даёт полный usage с id', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { id: 'msg_2', content: [{ type: 'text', text: 'привет' }], usage: { input_tokens: 10, output_tokens: 5 } }
    })
    expect(parseStreamJsonLine(line)).toEqual({
      kind: 'usage',
      messageId: 'msg_2',
      usage: { inputTokens: 10, outputTokens: 5 }
    })
  })

  it('события без usage остаются ignore', () => {
    expect(parseStreamJsonLine(JSON.stringify({ type: 'assistant', message: { content: [] } })))
      .toEqual({ kind: 'ignore' })
    expect(parseStreamJsonLine(JSON.stringify({ type: 'stream_event', event: { type: 'message_stop' } })))
      .toEqual({ kind: 'ignore' })
  })
})

describe('createUsageAccumulator', () => {
  it('суммирует последние снапшоты разных сообщений', () => {
    const acc = createUsageAccumulator()
    acc.add({ messageId: 'a', usage: { inputTokens: 10, outputTokens: 1, cacheReadTokens: 100 } })
    acc.add({ messageId: 'a', usage: { outputTokens: 20 } }) // финал сообщения a
    acc.add({ messageId: 'b', usage: { inputTokens: 15, outputTokens: 2 } })
    expect(acc.add({ messageId: 'b', usage: { outputTokens: 30 } })).toEqual({
      inputTokens: 25,
      outputTokens: 50,
      cacheReadTokens: 100
    })
  })

  it('событие без id относится к последнему сообщению (message_delta)', () => {
    const acc = createUsageAccumulator()
    acc.add({ messageId: 'a', usage: { inputTokens: 5, outputTokens: 1 } })
    expect(acc.add({ usage: { outputTokens: 9 } })).toEqual({ inputTokens: 5, outputTokens: 9 })
  })

  it('повтор одинакового снапшота не меняет итог (дубли assistant по блокам)', () => {
    const acc = createUsageAccumulator()
    const first = acc.add({ messageId: 'a', usage: { inputTokens: 3, outputTokens: 7 } })
    const second = acc.add({ messageId: 'a', usage: { inputTokens: 3, outputTokens: 7 } })
    expect(second).toEqual(first)
  })
})
