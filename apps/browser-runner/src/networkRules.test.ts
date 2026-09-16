// Круг 11: сеть под контролем. Человек делает это в devtools за минуту — «а если
// запрос вернёт 500», «а как без аналитики», «а если медленно». Модель умела
// только смотреть журнал постфактум.

import { describe, expect, it } from 'vitest'
import { NetworkRules, planRoute, RULE_BODY_LIMIT } from './networkRules'

describe('правила сети', () => {
  it('правило с тем же шаблоном заменяется, а не копится вторым', () => {
    const rules = new NetworkRules()
    rules.add({ url: '**/api/cart', action: 'mock', body: '[]' })
    const list = rules.add({ url: '**/api/cart', action: 'mock', body: '[{"id":1}]' })
    expect(list.total).toBe(1)
  })

  it('шаблон сопоставляется как в ожидании по URL', () => {
    const rules = new NetworkRules()
    rules.add({ url: 'https://a.b/api/*', action: 'block' })
    expect(rules.match('https://a.b/api/cart')?.action).toBe('block')
    expect(rules.match('https://a.b/page')).toBeNull()
  })

  it('снятие без адреса убирает все правила', () => {
    const rules = new NetworkRules()
    rules.add({ url: '**/a', action: 'block' })
    rules.add({ url: '**/b', action: 'block' })
    expect(rules.remove().total).toBe(0)
  })

  it('пустой шаблон, огромное тело и невозможная задержка отвергаются', () => {
    const rules = new NetworkRules()
    expect(() => rules.add({ url: '  ', action: 'block' })).toThrow('шаблон')
    expect(() => rules.add({ url: '**/a', action: 'mock', body: 'x'.repeat(RULE_BODY_LIMIT + 1) })).toThrow('256 КБ')
    expect(() => rules.add({ url: '**/a', action: 'delay', delayMs: 60_001 })).toThrow('Задержка')
  })

  it('список не тащит тело целиком: оно может быть в сотни килобайт', () => {
    const rules = new NetworkRules()
    rules.add({ url: '**/a', action: 'mock', body: 'y'.repeat(1_000) })
    expect(rules.list().rules[0].body?.length).toBeLessThan(220)
  })

  it('правил не бесконечно много', () => {
    const rules = new NetworkRules()
    for (let index = 0; index < 20; index++) rules.add({ url: `**/a${index}`, action: 'block' })
    expect(() => rules.add({ url: '**/over', action: 'block' })).toThrow('правил сети')
  })
})

describe('план перехвата', () => {
  it('без правила запрос идёт как был', () => {
    expect(planRoute(null)).toEqual({ action: 'continue' })
  })

  it('подмена по умолчанию отдаётся как JSON: страницы подменяют ответ API', () => {
    expect(planRoute({ url: '**/a', action: 'mock', body: '[]' })).toMatchObject({
      action: 'fulfill', status: 200, body: '[]', contentType: 'application/json; charset=utf-8'
    })
  })

  it('блокировка и задержка различаются: задержанный запрос всё-таки уходит', () => {
    expect(planRoute({ url: '**/a', action: 'block' })).toMatchObject({ action: 'abort' })
    expect(planRoute({ url: '**/a', action: 'delay', delayMs: 2_000 })).toEqual({ action: 'continue', delayMs: 2_000 })
  })

  it('код ответа и тип берутся из правила, когда они заданы', () => {
    expect(planRoute({ url: '**/a', action: 'mock', status: 500, body: 'boom', contentType: 'text/plain' }))
      .toMatchObject({ status: 500, body: 'boom', contentType: 'text/plain' })
  })
})
