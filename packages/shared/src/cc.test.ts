import { describe, it, expect } from 'vitest'
import { parseCcLine, parseCcTranscript, ccSessionTitle, ccCwdFromHead } from './cc'

const userStr = JSON.stringify({
  type: 'user',
  timestamp: '2026-07-08T12:41:04.000Z',
  cwd: '/Users/x/proj',
  message: { content: 'Сделай фичу' }
})
const assistantMulti = JSON.stringify({
  type: 'assistant',
  message: {
    content: [
      { type: 'text', text: 'Сейчас сделаю' },
      { type: 'thinking', thinking: 'надо прочитать файл', signature: 's' },
      { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls -la' } },
      { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/a/b.ts' } }
    ]
  }
})
const userToolResult = JSON.stringify({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ошибка', is_error: true }] }
})
const noise = JSON.stringify({ type: 'queue-operation' })

describe('parseCcLine', () => {
  it('user-строка → одна запись user', () => {
    expect(parseCcLine(userStr)).toEqual([
      { kind: 'user', text: 'Сделай фичу', ts: Date.parse('2026-07-08T12:41:04.000Z') }
    ])
  })

  it('assistant с text+thinking+2×tool_use → 4 записи по порядку', () => {
    const items = parseCcLine(assistantMulti)
    expect(items.map((i) => i.kind)).toEqual(['assistant', 'thinking', 'tool_use', 'tool_use'])
    expect(items[2].text).toBe('Bash: ls -la')
    expect(items[3].text).toBe('Read: /a/b.ts')
  })

  it('user tool_result помечается ошибкой', () => {
    const [item] = parseCcLine(userToolResult)
    expect(item.kind).toBe('tool_result')
    expect(item.isError).toBe(true)
    expect(item.text).toContain('ошибка')
  })

  it('служебные и битые строки → пропуск', () => {
    expect(parseCcLine(noise)).toEqual([])
    expect(parseCcLine('{не json')).toEqual([])
    expect(parseCcLine('   ')).toEqual([])
  })
})

describe('parseCcTranscript', () => {
  it('плоский список по всем строкам', () => {
    const text = [userStr, assistantMulti, userToolResult, noise].join('\n')
    const items = parseCcTranscript(text)
    expect(items.map((i) => i.kind)).toEqual([
      'user',
      'assistant',
      'thinking',
      'tool_use',
      'tool_use',
      'tool_result'
    ])
  })
})

describe('ccSessionTitle / ccCwdFromHead', () => {
  it('заголовок = первая реплика пользователя', () => {
    expect(ccSessionTitle([assistantMulti, userStr].join('\n'))).toBe('Сделай фичу')
  })
  it('нет реплик → «Без названия»', () => {
    expect(ccSessionTitle(noise)).toBe('Без названия')
  })
  it('cwd берётся из головы', () => {
    expect(ccCwdFromHead([noise, userStr].join('\n'))).toBe('/Users/x/proj')
  })
})
