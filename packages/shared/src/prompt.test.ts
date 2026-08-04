import { describe, it, expect } from 'vitest'
import {
  appendChangeAuthorizationHint,
  buildConversationPrompt,
  buildPrompt,
  CHANGE_AUTHORIZATION_HINT,
  claudeModelAlias,
  parseTaskLaunchRequest
} from './prompt'

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
  it('маппит настройки в алиасы CLI (в т.ч. новые модели и старые значения)', () => {
    // Пункты меню уходят в `claude --model` как есть, включая суффикс окна 1M.
    expect(claudeModelAlias('default')).toBe('default')
    expect(claudeModelAlias('opus[1m]')).toBe('opus[1m]')
    expect(claudeModelAlias('sonnet')).toBe('sonnet')
    expect(claudeModelAlias('fable')).toBe('fable')
    expect(claudeModelAlias('haiku')).toBe('haiku')
    // Старые значения из БД (до перехода на алиасы) тоже понимаются.
    expect(claudeModelAlias('sonnet-4.5')).toBe('sonnet')
    expect(claudeModelAlias('opus-4.5')).toBe('opus[1m]')
    // Неизвестное → пункт «Default (recommended)», модель выбирает сам CLI.
    expect(claudeModelAlias('что-то')).toBe('default')
  })
})

describe('appendChangeAuthorizationHint', () => {
  it('добавляет выбор способа работы к непустому промпту', () => {
    const prompt = appendChangeAuthorizationHint('Исправь ошибку')
    expect(prompt).toBe(`Исправь ошибку\n\n${CHANGE_AUTHORIZATION_HINT}`)
    expect(prompt).toContain('TODO')
    expect(prompt).toContain('InProgress')
  })

  it('пустой промпт не меняет', () => {
    expect(appendChangeAuthorizationHint('  ')).toBe('  ')
  })
})

describe('parseTaskLaunchRequest', () => {
  it('принимает только структурированный сигнал и убирает его из видимого ответа', () => {
    const parsed = parseTaskLaunchRequest('Нужен ваш выбор.\n```task-launch\n{"title":"Исправить форму","description":"Описание","acceptanceCriteria":"Тест проходит"}\n```')
    expect(parsed).toEqual({
      text: 'Нужен ваш выбор.',
      request: { title: 'Исправить форму', description: 'Описание', acceptanceCriteria: 'Тест проходит' }
    })
  })

  it('не считает обычный текст запросом запуска', () => {
    expect(parseTaskLaunchRequest('Давайте создадим задачу и исправим разработку.')).toEqual({ text: 'Давайте создадим задачу и исправим разработку.' })
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

  it('не отправляет служебный image-блок AI-ответа в историю', () => {
    const p = buildConversationPrompt([
      { role: 'u1', text: 'Нарисуй кота' },
      {
        role: 'ai',
        text: 'Готово.\n\n```image\n{"path":"/tmp/cat.png","caption":"Кот"}\n```'
      },
      { role: 'u1', text: 'Сделай его синим' }
    ])
    expect(p).toContain('Ассистент: Готово.')
    expect(p).not.toContain('```image')
    expect(p).not.toContain('/tmp/cat.png')
  })

  it('добавляет пути вложений', () => {
    const p = buildConversationPrompt([{ role: 'u1', text: 'смотри' }], ['/data/a.png'])
    expect(p).toContain('/data/a.png')
  })
})
