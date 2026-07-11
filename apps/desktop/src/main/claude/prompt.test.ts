import { describe, it, expect } from 'vitest'
import { buildPrompt, claudeModelAlias } from './prompt'

describe('buildPrompt', () => {
  it('один говорящий → просто текст без меток', () => {
    expect(buildPrompt([{ speakerId: 1, text: 'Привет, как дела?' }])).toBe('Привет, как дела?')
  })

  it('склеивает несколько сегментов одного спикера пробелом', () => {
    expect(
      buildPrompt([
        { speakerId: 1, text: 'Первое.' },
        { speakerId: 1, text: 'Второе.' }
      ])
    ).toBe('Первое. Второе.')
  })

  it('несколько говорящих → метки [Спикер N]', () => {
    expect(
      buildPrompt([
        { speakerId: 1, text: 'Спроси про погоду' },
        { speakerId: 2, text: 'и про еду' }
      ])
    ).toBe('[Спикер 1]: Спроси про погоду\n[Спикер 2]: и про еду')
  })

  it('отбрасывает пустые сегменты', () => {
    expect(buildPrompt([{ speakerId: 1, text: '  ' }, { speakerId: 1, text: 'ок' }])).toBe('ок')
    expect(buildPrompt([])).toBe('')
  })
})

describe('claudeModelAlias', () => {
  it('маппит настройки в алиасы CLI (в т.ч. новые модели и старые значения)', () => {
    expect(claudeModelAlias('opus')).toBe('opus')
    expect(claudeModelAlias('sonnet')).toBe('sonnet')
    expect(claudeModelAlias('fable')).toBe('fable')
    expect(claudeModelAlias('haiku')).toBe('haiku')
    expect(claudeModelAlias('sonnet-4.5')).toBe('sonnet')
    expect(claudeModelAlias('opus-4.5')).toBe('opus')
    expect(claudeModelAlias('что-то')).toBe('opus')
  })
})
