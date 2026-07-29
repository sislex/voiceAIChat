import { describe, it, expect } from 'vitest'
import { dueState, epicColor, initials, issueKey, projectKey } from './kanbanMeta'

describe('kanbanMeta', () => {
  it('projectKey: латиница из инициалов слов, кириллица транслитерируется', () => {
    expect(projectKey('Voice Chat')).toBe('VC')
    expect(projectKey('ChatAI')).toBe('CHAT')
    expect(projectKey('Голос Чат')).toBe('GC')
    expect(projectKey('')).toBe('PRJ')
    expect(projectKey('!!!')).toBe('PRJ')
  })

  it('issueKey соединяет ключ проекта и номер', () => {
    expect(issueKey('Voice Chat', { seq: 42 })).toBe('VC-42')
    expect(issueKey('Voice Chat', { seq: 0 })).toBe('VC-?')
  })

  it('dueState: просрочен / скоро / ок', () => {
    const now = new Date(2026, 6, 28, 12).getTime()
    const day = 24 * 60 * 60 * 1000
    expect(dueState(now - 2 * day, now)).toBe('overdue')
    expect(dueState(now + day / 2, now)).toBe('soon')
    expect(dueState(now + 10 * day, now)).toBe('ok')
  })

  it('инициалы и стабильные цвета', () => {
    expect(initials('alex')).toBe('AL')
    expect(initials('alex.rozhnov')).toBe('AR')
    expect(epicColor('e1')).toBe(epicColor('e1'))
  })
})
