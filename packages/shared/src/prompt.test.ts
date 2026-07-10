import { describe, it, expect } from 'vitest'
import { buildConversationPrompt, buildPrompt, claudeModelAlias } from './prompt'

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

  it('добавляет пути вложений с просьбой прочитать', () => {
    const p = buildPrompt([{ speakerId: 1, text: 'посмотри' }], ['/data/a.png', '/data/b.pdf'])
    expect(p).toContain('посмотри')
    expect(p).toContain('/data/a.png')
    expect(p).toContain('/data/b.pdf')
    expect(p.toLowerCase()).toContain('прочитай')
  })

  it('только вложения без текста — промпт из одной пометки', () => {
    const p = buildPrompt([], ['/data/a.png'])
    expect(p).toContain('/data/a.png')
    expect(p).not.toBe('')
  })
})

describe('claudeModelAlias', () => {
  it('маппит настройки в алиасы CLI', () => {
    expect(claudeModelAlias('sonnet-4.5')).toBe('sonnet')
    expect(claudeModelAlias('opus-4.5')).toBe('opus')
    expect(claudeModelAlias('что-то')).toBe('sonnet')
  })
})

describe('buildConversationPrompt (пересбор истории)', () => {
  it('один ход отдаётся как обычный текст (без меток ролей)', () => {
    expect(buildConversationPrompt([{ role: 'u1', text: 'Привет' }])).toBe('Привет')
  })

  it('несколько реплик — транскрипт с ролями Пользователь/Ассистент', () => {
    const p = buildConversationPrompt([
      { role: 'u1', text: 'Столица Франции?' },
      { role: 'ai', text: 'Париж.' },
      { role: 'u1', text: 'А Германии?' }
    ])
    expect(p).toContain('Пользователь: Столица Франции?')
    expect(p).toContain('Ассистент: Париж.')
    expect(p).toContain('Пользователь: А Германии?')
  })

  it('удалённая реплика в историю не попадает', () => {
    // Пользователь удалил своё «секрет 42» — его нет в переданной истории.
    const p = buildConversationPrompt([
      { role: 'ai', text: 'Готов помочь.' },
      { role: 'u1', text: 'Какое было прошлое сообщение?' }
    ])
    expect(p).not.toContain('секрет 42')
    expect(p).toContain('Какое было прошлое сообщение?')
  })

  it('добавляет пути вложений', () => {
    const p = buildConversationPrompt([{ role: 'u1', text: 'смотри' }], ['/data/a.png'])
    expect(p).toContain('/data/a.png')
  })
})
