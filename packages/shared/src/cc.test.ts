import { describe, it, expect } from 'vitest'
import { ccResumeMessages, ccResumeTitle, ccTimeLabel, type CcItem } from './cc'

describe('продолжение сессии', () => {
  const items: CcItem[] = [
    { kind: 'user', text: 'Сделай фичу', ts: 1_700_000_000_000 },
    { kind: 'thinking', text: 'думаю' },
    { kind: 'tool_use', text: 'Bash: ls' },
    { kind: 'tool_result', text: 'ok' },
    { kind: 'assistant', text: 'Готово' }
  ]

  it('ccResumeMessages берёт только user/assistant с ролями u1/ai', () => {
    expect(ccResumeMessages(items)).toEqual([
      { role: 'u1', text: 'Сделай фичу', ts: 1_700_000_000_000 },
      { role: 'ai', text: 'Готово', ts: undefined }
    ])
  })

  it('ccResumeTitle — первая реплика пользователя', () => {
    expect(ccResumeTitle(items)).toBe('Сделай фичу')
    expect(ccResumeTitle([{ kind: 'assistant', text: 'привет' }])).toBe('Продолжение сессии')
  })

  it('ccTimeLabel форматирует HH:MM (ts или fallback)', () => {
    expect(/^\d{2}:\d{2}$/.test(ccTimeLabel(undefined, 1_700_000_000_000))).toBe(true)
    expect(/^\d{2}:\d{2}$/.test(ccTimeLabel(1_700_000_000_000, 0))).toBe(true)
  })
})
