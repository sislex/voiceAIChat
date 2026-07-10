import { describe, it, expect } from 'vitest'
import { parseSayVoices, sayVoiceName } from './sayVoices'

describe('sayVoiceName', () => {
  it('возвращает имя голоса; пустой → Milena', () => {
    expect(sayVoiceName('Milena')).toBe('Milena')
    expect(sayVoiceName('Yuri')).toBe('Yuri')
    expect(sayVoiceName('')).toBe('Milena')
  })
})

describe('parseSayVoices', () => {
  const SAMPLE = [
    'Milena              ru_RU    # Здравствуйте! Меня зовут Милена.',
    'Yuri                ru_RU    # Здравствуйте!',
    'Samantha            en_US    # Hello!',
    'Grandma (English)   en_US    # Hi',
    'мусорная строка'
  ].join('\n')

  it('парсит русские голоса с именем и меткой', () => {
    const voices = parseSayVoices(SAMPLE, ['ru'])
    expect(voices).toEqual([
      { id: 'Milena', label: 'Milena — русский' },
      { id: 'Yuri', label: 'Yuri — русский' }
    ])
  })

  it('фильтрует по языку и корректно берёт имя с пробелами', () => {
    const en = parseSayVoices(SAMPLE, ['en'])
    expect(en.map((v) => v.id)).toEqual(['Samantha', 'Grandma (English)'])
  })
})
