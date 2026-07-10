import { describe, it, expect } from 'vitest'
import { CODE_SPEECH, flushSpeakable, splitSentences, splitSpeakable } from './sentences'

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
