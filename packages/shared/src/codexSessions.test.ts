import { describe, it, expect } from 'vitest'
import { cxResumeMessages, cxResumeTitle, type CxItem } from './codexSessions'

describe('Core Codex conversation-resume mapping', () => {
  const items: CxItem[] = [
    { kind: 'user', text: 'вопрос', ts: 1 },
    { kind: 'thinking', text: 'думаю', ts: 2 },
    { kind: 'other', text: 'комментарий', ts: 3 },
    { kind: 'assistant', text: 'финальный ответ', ts: 4 }
  ]
  it('cxResumeMessages берёт только user + assistant (final)', () => {
    const msgs = cxResumeMessages(items)
    expect(msgs).toEqual([
      { role: 'u1', text: 'вопрос', ts: expect.any(Number) },
      { role: 'ai', text: 'финальный ответ', ts: expect.any(Number) }
    ])
  })

  it('cxResumeTitle — первая реплика пользователя', () => {
    expect(cxResumeTitle(items)).toBe('вопрос')
  })
})
