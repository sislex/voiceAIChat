import { describe, it, expect } from 'vitest'
import { estimateKbTokens, isKbScope, kbToolHint, KB_SCOPES, KB_SCOPE_LABELS } from './kb'
import { KB_GAP_RULE } from './kbGaps'

describe('оценка токенов базы знаний', () => {
  it('ceil(chars/4) — одна формула для сервера и UI', () => {
    expect(estimateKbTokens(0)).toBe(0)
    expect(estimateKbTokens(1)).toBe(1)
    expect(estimateKbTokens(4)).toBe(1)
    expect(estimateKbTokens(5)).toBe(2)
    expect(estimateKbTokens(4000)).toBe(1000)
  })

  it('отрицательная длина не даёт отрицательных токенов', () => {
    expect(estimateKbTokens(-10)).toBe(0)
  })
})

describe('разделы базы знаний', () => {
  it('три раздела, у каждого подпись для UI', () => {
    expect(KB_SCOPES).toEqual(['usage', 'user', 'project'])
    expect(KB_SCOPES.map((scope) => KB_SCOPE_LABELS[scope])).toEqual([
      'Использование',
      'Настройки пользователя',
      'Разработка проекта'
    ])
  })

  it('isKbScope отсекает чужие значения (сервер разбирает ими query-строку)', () => {
    expect(isKbScope('project')).toBe(true)
    expect(isKbScope('admin')).toBe(false)
    expect(isKbScope(undefined)).toBe(false)
  })
})

// Хинт уходит в системный промпт КАЖДОГО хода с инструментами БЗ — и в чате, и
// во всех фазах CI-рана. Поэтому обязанность пополнить базу после её молчания
// живёт именно здесь: отдельного места, которое видят все ходы, больше нет.
describe('политика базы знаний в системном промпте', () => {
  it('оба режима требуют идти в базу первой и закрывать её пробелы записью', () => {
    for (const mode of ['auto', 'manual'] as const) {
      expect(kbToolHint(mode)).toContain('в первую очередь')
      expect(kbToolHint(mode)).toContain(KB_GAP_RULE)
    }
  })
})
