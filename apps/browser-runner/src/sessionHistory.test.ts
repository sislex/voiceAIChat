// Круг 5: лента сессии. Раннер — единственное место, где видны обе стороны:
// человек в панели и модель через MCP. Без ленты вопрос «что модель только что
// сделала» не имел ответа: состояние страницы о порядке событий не говорит.

import { describe, expect, it } from 'vitest'
import { describeCommand, SessionHistory } from './sessionHistory'

describe('лента сессии', () => {
  it('отдаёт хвост: начало длинной сессии человеку не нужно', () => {
    const history = new SessionHistory()
    for (let index = 0; index < 50; index++) history.record({ at: index, actor: 'user', title: `шаг ${index}`, kind: 'click', ok: true })
    const listed = history.list({ limit: 3 })
    expect(listed.total).toBe(50)
    expect(listed.entries.map((entry) => entry.title)).toEqual(['шаг 47', 'шаг 48', 'шаг 49'])
  })

  it('фильтрует по стороне: «что успел человек» — отдельный вопрос', () => {
    const history = new SessionHistory()
    history.record({ at: 1, actor: 'user', title: 'клик', kind: 'click', ok: true })
    history.record({ at: 2, actor: 'assistant', title: 'переход', kind: 'navigate', ok: true })
    expect(history.list({ actor: 'assistant' }).entries.map((entry) => entry.title)).toEqual(['переход'])
  })

  it('не растёт бесконечно', () => {
    const history = new SessionHistory()
    for (let index = 0; index < 500; index++) history.record({ at: index, actor: 'user', title: 'шаг', kind: 'click', ok: true })
    expect(history.list({ limit: 200 }).entries.length).toBe(200)
    expect(history.list({ limit: 200 }).total).toBe(200)
  })

  it('очистка убирает всё', () => {
    const history = new SessionHistory()
    history.record({ at: 1, actor: 'user', title: 'клик', kind: 'click', ok: true })
    history.clear()
    expect(history.list().total).toBe(0)
  })
})

describe('человеческое имя команды', () => {
  it('называет действия так, как назвал бы человек', () => {
    expect(describeCommand({ type: 'navigate', url: 'https://a.b/' })).toMatchObject({ title: 'переход на https://a.b/', kind: 'navigate' })
    expect(describeCommand({ type: 'input', action: { type: 'press', key: 'Enter' } })).toMatchObject({ title: 'клавиша Enter' })
    expect(describeCommand({ type: 'input', action: { type: 'hotkey', key: 'a', modifiers: ['ControlOrMeta'] } })).toMatchObject({ title: 'сочетание ControlOrMeta+a' })
    expect(describeCommand({ type: 'selector', action: { kind: 'click', selector: '#save' } })).toMatchObject({ title: 'клик: #save', selector: '#save' })
    expect(describeCommand({ type: 'selector', action: { kind: 'click', text: 'Войти' } })).toMatchObject({ title: 'клик: «Войти»' })
  })

  it('чтение в ленту не попадает: иначе она превращается в поток «прочитал»', () => {
    for (const kind of ['read', 'find', 'metrics', 'measure', 'count', 'table', 'list', 'formState', 'validity', 'options', 'a11y', 'copy'] as const) {
      expect(describeCommand({ type: 'selector', action: { kind, selector: '#x' } as never })).toBeNull()
    }
    expect(describeCommand({ type: 'status' })).toBeNull()
    expect(describeCommand({ type: 'screenshot' })).toBeNull()
  })

  it('смена среды и cookies остаются в ленте: они меняют условия проверки', () => {
    expect(describeCommand({ type: 'environment', colorScheme: 'dark' })).toMatchObject({ kind: 'environment' })
    expect(describeCommand({ type: 'cookies', action: 'clear' })).toMatchObject({ title: 'cookies: clear' })
  })
})
