import { describe, it, expect } from 'vitest'
import { conversationToMarkdown, conversationToJson, exportFileName } from './export'
import type { Conversation, Message } from './types'

const conv: Conversation = {
  id: 'c1',
  title: 'Поездка в Лиссабон',
  createdAt: 1000,
  updatedAt: 2000,
  messageCount: 2,
  claudeSessionId: null
}
const messages: Message[] = [
  { id: 'm1', conversationId: 'c1', role: 'u1', text: 'Погода?', time: '10:00', createdAt: 1000 },
  { id: 'm2', conversationId: 'c1', role: 'ai', text: 'Тепло и солнечно.', time: '10:01', createdAt: 1001 }
]

describe('conversationToMarkdown', () => {
  it('содержит заголовок и реплики с подписями ролей в порядке', () => {
    const md = conversationToMarkdown(conv, messages)
    expect(md).toContain('# Поездка в Лиссабон')
    expect(md).toContain('**Пользователь** (10:00)')
    expect(md).toContain('Погода?')
    expect(md).toContain('**Ассистент** (10:01)')
    expect(md.indexOf('Погода?')).toBeLessThan(md.indexOf('Тепло и солнечно.'))
  })

  it('пустой разговор помечается', () => {
    expect(conversationToMarkdown(conv, [])).toContain('Пустой разговор')
  })
})

describe('conversationToJson', () => {
  it('валидный JSON с реплеями и метаданными', () => {
    const parsed = JSON.parse(conversationToJson(conv, messages))
    expect(parsed.title).toBe('Поездка в Лиссабон')
    expect(parsed.messages).toHaveLength(2)
    expect(parsed.messages[0]).toMatchObject({ role: 'u1', text: 'Погода?' })
  })
})

describe('exportFileName', () => {
  it('слаг названия + расширение', () => {
    expect(exportFileName('Поездка в Лиссабон', 'md')).toBe('поездка-в-лиссабон.md')
    expect(exportFileName('  ', 'json')).toBe('разговор.json')
  })
})
