// Пробелы базы знаний: разбор блока `kb-gaps` и формулировки правила. Чистые
// функции — ни CLI, ни сервера здесь нет.

import { describe, it, expect } from 'vitest'
import { KB_GAPS_FENCE, KB_GAPS_HINT, KB_GAP_RULE, MAX_KB_GAPS, parseKbGaps } from './kbGaps'

/** Так блок выглядит в ответе модели: текст, потом fenced-блок в конце. */
function answer(json: string): string {
  return ['Сделал правку в runManager.', '```' + KB_GAPS_FENCE, json, '```'].join('\n')
}

describe('parseKbGaps', () => {
  it('разбирает пробел с вопросом, ответом и темой', () => {
    const gaps = parseKbGaps(answer('[{"question":"где живёт fix-loop","answer":"в ci/modelHooks.ts, хук attemptFix","topic":"ci-runner"}]'))
    expect(gaps).toEqual([{ question: 'где живёт fix-loop', answer: 'в ci/modelHooks.ts, хук attemptFix', topic: 'ci-runner' }])
  })

  it('блока нет, JSON битый или не массив — пробелов не сообщали', () => {
    expect(parseKbGaps('обычный ответ без блока')).toEqual([])
    expect(parseKbGaps(answer('[{сломано'))).toEqual([])
    expect(parseKbGaps(answer('{"question":"x","answer":"y"}'))).toEqual([])
  })

  it('пробел без ответа отбрасывается: жалоба на базу — не знание', () => {
    const gaps = parseKbGaps(answer('[{"question":"а","answer":""},{"question":"","answer":"б"},{"question":"в","answer":"г"},"мусор"]'))
    expect(gaps.map((g) => g.question)).toEqual(['в'])
  })

  it('один вопрос — одна запись даже при дублях в блоке', () => {
    const gaps = parseKbGaps(answer('[{"question":"Где хук","answer":"первый"},{"question":"где хук","answer":"второй"}]'))
    expect(gaps).toHaveLength(1)
    expect(gaps[0].answer).toBe('первый')
  })

  it('число пробелов и длина полей капнуты: промпт шага не должен распухать', () => {
    const many = Array.from({ length: MAX_KB_GAPS + 5 }, (_, i) => ({ question: `в${i}`, answer: 'ответ' }))
    expect(parseKbGaps(answer(JSON.stringify(many)))).toHaveLength(MAX_KB_GAPS)
    const long = parseKbGaps(answer(JSON.stringify([{ question: 'в', answer: 'я'.repeat(4000) }])))
    expect(long[0].answer.length).toBeLessThan(2000)
  })

  it('перевод строки внутри ответа схлопывается: пункт списка остаётся пунктом', () => {
    const gaps = parseKbGaps(answer('[{"question":"в","answer":"первая строка\\nвторая строка"}]'))
    expect(gaps[0].answer).toBe('первая строка вторая строка')
  })
})

describe('правило про пробел базы знаний', () => {
  it('требует занести найденное и запрещает догадки и дубли', () => {
    expect(KB_GAP_RULE).toContain('неполным ответом')
    expect(KB_GAP_RULE).toContain('дополни существующий раздел')
    expect(KB_GAP_RULE).toContain('только проверенное по коду')
  })

  it('хинт задаёт формат блока и адресата записи', () => {
    expect(KB_GAPS_HINT).toContain('```' + KB_GAPS_FENCE)
    expect(KB_GAPS_HINT).toContain('"question"')
    expect(KB_GAPS_HINT).toContain('Актуализировать базу знаний')
    // Формат из хинта разбирается тем же парсером — иначе блок уедет в пустоту.
    const sample = parseKbGaps(KB_GAPS_HINT)
    expect(sample).toHaveLength(1)
    expect(sample[0].topic).toBe('ci-runner')
  })
})
