// Круг 13: отчёт о проверке. Модель писала итог своими словами («всё работает»),
// и человек в канбане не мог понять ни что проверялось, ни где проверка
// споткнулась. Всё нужное уже лежит в сессии — отчёт собирает это в один текст.

import { describe, expect, it } from 'vitest'
import { buildSessionReport } from './sessionReport'

const base = {
  url: 'https://a.b/cart',
  startedAt: Date.now() - 5 * 60_000,
  history: [],
  console: [],
  network: [],
  snapshots: []
}

describe('отчёт о проверке', () => {
  it('без замечаний сообщает итог и число действий', () => {
    const report = buildSessionReport({
      ...base,
      history: [{ at: 1, actor: 'assistant', title: 'клик: #save', kind: 'click', ok: true }]
    })
    expect(report.passed).toBe(true)
    expect(report.actions).toBe(1)
    expect(report.markdown).toContain('замечаний нет')
  })

  it('неудачные шаги идут отдельным разделом: по ним человек перепроверяет руками', () => {
    const report = buildSessionReport({
      ...base,
      history: [{ at: 1, actor: 'assistant', title: 'клик: #save', kind: 'click', ok: false, error: 'элемент перекрыт' }]
    })
    expect(report.passed).toBe(false)
    expect(report.markdown).toContain('Что не получилось')
    expect(report.markdown).toContain('элемент перекрыт')
  })

  it('заметки модели становятся разделом «что проверялось»', () => {
    const report = buildSessionReport({
      ...base,
      history: [{ at: 1, actor: 'assistant', title: 'проверяю оформление заказа', kind: 'note', ok: true, note: 'проверяю оформление заказа' }]
    })
    expect(report.markdown).toContain('Что проверялось')
    expect(report.markdown).toContain('проверяю оформление заказа')
    // Заметка — не действие: в счётчике шагов ей не место.
    expect(report.actions).toBe(0)
  })

  it('ошибки консоли и неуспешные запросы делают проверку не пройденной', () => {
    const report = buildSessionReport({
      ...base,
      console: [{ level: 'error', text: 'TypeError: undefined is not a function', at: 1 }],
      network: [{ method: 'GET', url: 'https://a.b/api/cart', status: 500, ok: false, at: 1 }]
    })
    expect(report.passed).toBe(false)
    expect(report.failures).toBe(1)
    expect(report.markdown).toContain('Страница жаловалась')
    expect(report.markdown).toContain('500 GET')
  })

  it('снимки перечисляются по именам: их видно и в панели', () => {
    const report = buildSessionReport({
      ...base,
      snapshots: [{ name: 'до правки', at: 1, url: 'https://a.b/', title: 'Страница', bytes: 1024, textLength: 10 }]
    })
    expect(report.markdown).toContain('до правки')
  })

  it('берётся хвост шагов, а не начало: свежие объясняют итог', () => {
    const history = Array.from({ length: 50 }, (_, index) => ({ at: index, actor: 'assistant' as const, title: `шаг ${index}`, kind: 'click', ok: true }))
    const report = buildSessionReport({ ...base, history })
    expect(report.markdown).toContain('шаг 49')
    expect(report.markdown).not.toContain('шаг 5\n')
  })

  it('длинный отчёт обрезается честно', () => {
    const history = Array.from({ length: 200 }, (_, index) => ({ at: index, actor: 'user' as const, title: `очень длинный шаг номер ${index} `.repeat(10), kind: 'click', ok: true }))
    const report = buildSessionReport({ ...base, history, limit: 1_000 })
    expect(report.truncated).toBe(true)
    expect(report.markdown.length).toBeLessThan(1_100)
    expect(report.markdown).toContain('отчёт обрезан')
  })
})
