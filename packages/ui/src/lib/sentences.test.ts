import { describe, it, expect } from 'vitest'
import {
  CODE_SPEECH,
  TABLE_SPEECH,
  flushSpeakable,
  splitSentences,
  splitSpeakable
} from './sentences'

describe('splitSentences', () => {
  it('выделяет завершённые предложения, хвост оставляет', () => {
    const r = splitSentences('Привет. Как дела? Незаверш')
    expect(r.sentences).toEqual(['Привет.', 'Как дела?'])
    expect(r.rest).toBe(' Незаверш')
  })

  it('перевод строки завершает предложение', () => {
    const r = splitSentences('Пункт один\nПункт два\nхвост')
    expect(r.sentences).toEqual(['Пункт один', 'Пункт два'])
    expect(r.rest).toBe('хвост')
  })

  it('без границ — всё в хвосте', () => {
    const r = splitSentences('ещё пишу')
    expect(r.sentences).toEqual([])
    expect(r.rest).toBe('ещё пишу')
  })

  it('несколько знаков подряд и пустые фрагменты не ломают', () => {
    const r = splitSentences('Да!! Нет...')
    expect(r.sentences).toEqual(['Да!!', 'Нет...'])
    expect(r.rest).toBe('')
  })
})

describe('splitSpeakable (учёт блоков кода)', () => {
  it('завершённый блок кода → фраза-заглушка, код не попадает в чанки', () => {
    const r = splitSpeakable('Вот пример:\n```js\nconst x = 1\n```\nГотово.')
    expect(r.chunks).toContain(CODE_SPEECH)
    expect(r.chunks.join(' ')).not.toContain('const x')
    expect(r.chunks).toContain('Готово.')
  })

  it('незакрытый блок кода держится в rest (стриминг ещё идёт)', () => {
    const r = splitSpeakable('Смотри. ```js\nconst x')
    expect(r.chunks).toContain('Смотри.')
    expect(r.chunks).not.toContain(CODE_SPEECH)
    expect(r.rest).toContain('```') // ждём закрытия
  })

  it('без кода работает как обычное разбиение на предложения', () => {
    const r = splitSpeakable('Раз. Два')
    expect(r.chunks).toEqual(['Раз.'])
    expect(r.rest).toBe(' Два')
  })
})

describe('flushSpeakable (финал)', () => {
  it('закрывает незавершённый блок кода в заглушку', () => {
    const out = flushSpeakable('Текст. ```js\nconst x = 1')
    expect(out).toContain('Текст.')
    expect(out).toContain(CODE_SPEECH)
    expect(out.join(' ')).not.toContain('const x')
  })

  it('озвучивает незавершённое последнее предложение', () => {
    expect(flushSpeakable('Последняя мысль без точки')).toContain('Последняя мысль без точки')
  })
})

describe('таблицы не озвучиваются', () => {
  const TABLE = '| Имя | Возраст |\n| --- | --- |\n| Аня | 30 |\n| Боб | 25 |'

  it('flushSpeakable заменяет таблицу на TABLE_SPEECH, ячейки не читает', () => {
    const out = flushSpeakable(`Вот данные.\n\n${TABLE}\n\nКонец.`)
    expect(out).toContain('Вот данные.')
    expect(out).toContain(TABLE_SPEECH)
    expect(out).toContain('Конец.')
    const joined = out.join(' ')
    expect(joined).not.toContain('Возраст')
    expect(joined).not.toContain('Аня')
  })

  it('splitSpeakable (final) коллапсирует завершённую таблицу', () => {
    const { chunks } = splitSpeakable(`Смотри.\n\n${TABLE}\n\nВсё.`, true)
    expect(chunks).toContain(TABLE_SPEECH)
    expect(chunks.join(' ')).not.toContain('Боб')
  })

  it('в стриминге незавершённая таблица удерживается в rest', () => {
    // заголовок + разделитель + одна строка, продолжение ещё не пришло
    const partial = 'Заголовок.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |'
    const { chunks, rest } = splitSpeakable(partial) // final=false
    expect(chunks).toContain('Заголовок.')
    expect(chunks).not.toContain(TABLE_SPEECH) // ещё не коллапсировали
    expect(rest).toContain('| A | B |') // держим таблицу целиком
  })

  it('обычный текст с одиночным | не считается таблицей', () => {
    const out = flushSpeakable('Выбери a | b по вкусу.')
    expect(out).toContain('Выбери a | b по вкусу.')
    expect(out).not.toContain(TABLE_SPEECH)
  })
})
