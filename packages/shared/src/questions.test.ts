import { describe, it, expect } from 'vitest'
import {
  appendQuestionsHint,
  formatAnswers,
  parseQuestions,
  QUESTIONS_HINT
} from './questions'

describe('parseQuestions', () => {
  it('вырезает блок и разбирает вопросы', () => {
    const text = [
      'Могу сделать двумя способами.',
      '',
      '```questions',
      '[{"q":"Какую БД использовать?","options":["SQLite","Postgres"]},',
      ' {"q":"Что включить?","options":["Тесты","Логи"],"multi":true}]',
      '```'
    ].join('\n')
    const parsed = parseQuestions(text)
    expect(parsed).not.toBeNull()
    expect(parsed!.body).toBe('Могу сделать двумя способами.')
    expect(parsed!.questions).toHaveLength(2)
    expect(parsed!.questions[0]).toEqual({
      q: 'Какую БД использовать?',
      options: ['SQLite', 'Postgres']
    })
    expect(parsed!.questions[1].multi).toBe(true)
  })

  it('блок в середине текста: тело склеивается без него', () => {
    const text = 'До.\n```questions\n[{"q":"В?","options":["а"]}]\n```\nПосле.'
    const parsed = parseQuestions(text)
    expect(parsed!.body).toBe('До.\n\nПосле.')
    expect(parsed!.questions[0].options).toEqual(['а'])
  })

  it('нет блока → null', () => {
    expect(parseQuestions('Обычный ответ с ```js\ncode\n```')).toBeNull()
  })

  it('битый JSON → null', () => {
    expect(parseQuestions('```questions\n[{"q": незакрыто\n```')).toBeNull()
  })

  it('пустой массив или вопросы без вариантов → null', () => {
    expect(parseQuestions('```questions\n[]\n```')).toBeNull()
    expect(parseQuestions('```questions\n[{"q":"В?","options":[]}]\n```')).toBeNull()
  })

  it('мусорные элементы отбрасываются, валидные остаются', () => {
    const text = '```questions\n[{"q":"В?","options":["а",42,""]}, "мусор", {"options":["б"]}]\n```'
    const parsed = parseQuestions(text)
    expect(parsed!.questions).toEqual([{ q: 'В?', options: ['а'] }])
  })
})

describe('appendQuestionsHint', () => {
  it('дописывает хинт к непустому промпту', () => {
    const out = appendQuestionsHint('Привет')
    expect(out.startsWith('Привет\n\n')).toBe(true)
    expect(out).toContain(QUESTIONS_HINT)
  })

  it('пустой промпт не трогает', () => {
    expect(appendQuestionsHint('')).toBe('')
    expect(appendQuestionsHint('  ')).toBe('  ')
  })

  it('хинт содержит пример блока', () => {
    expect(QUESTIONS_HINT).toContain('```questions')
  })
})

describe('formatAnswers', () => {
  it('один вопрос → просто ответ', () => {
    expect(formatAnswers([{ q: 'Какую БД?', answer: 'SQLite' }])).toBe('SQLite')
  })

  it('несколько вопросов → нумерованный список «вопрос — ответ»', () => {
    const out = formatAnswers([
      { q: 'Какую БД?', answer: 'SQLite' },
      { q: 'Что включить?', answer: 'Тесты; Логи' }
    ])
    expect(out).toBe('1. Какую БД? — SQLite\n2. Что включить? — Тесты; Логи')
  })

  it('пустые ответы отбрасываются', () => {
    expect(formatAnswers([{ q: 'В?', answer: '  ' }])).toBe('')
  })
})
