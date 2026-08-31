import { describe, expect, it } from 'vitest'
import { STRONG_SIMILARITY, rankSimilarTasks, significantWords } from './kanbanSimilarity'

describe('significantWords', () => {
  it('чистит пунктуацию, регистр, стоп-слова и короткие токены', () => {
    expect([...significantWords('Починить корзину: не сохраняются товары!')].sort())
      .toEqual(['корзину', 'сохраняются', 'товары'])
  })
})

describe('rankSimilarTasks', () => {
  const cart = { id: 't1', title: 'Корзина теряет товары после перезагрузки', labels: ['bug'] }
  const login = { id: 't2', title: 'Вход по email не работает на телефоне' }
  const cartUi = { id: 't3', title: 'Оформление заказа: кнопка «Купить»', description: 'Корзина показывает товары неправильно' }

  it('ставит выше задачу с совпадением в заголовке', () => {
    const hits = rankSimilarTasks({ id: 'new', title: 'Корзина теряет товары' }, [login, cartUi, cart])
    expect(hits[0]!.id).toBe('t1')
    expect(hits[0]!.score).toBeGreaterThanOrEqual(STRONG_SIMILARITY)
    expect(hits[0]!.overlap.sort()).toEqual(['корзина', 'теряет', 'товары'])
  })

  it('совпадение только в описании кандидата весит меньше заголовка', () => {
    const hits = rankSimilarTasks({ id: 'new', title: 'Корзина теряет товары' }, [cartUi, cart])
    expect(hits.map((hit) => hit.id)).toEqual(['t1', 't3'])
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score)
  })

  it('несвязанная задача в выдачу не попадает', () => {
    expect(rankSimilarTasks({ id: 'new', title: 'Корзина теряет товары' }, [login])).toEqual([])
  })

  it('метки и навыки добавляют вес совпадению', () => {
    const withLabel = rankSimilarTasks({ id: 'new', title: 'Корзина теряет товары', labels: ['bug'] }, [cart])[0]!
    const without = rankSimilarTasks({ id: 'new', title: 'Корзина теряет товары' }, [cart])[0]!
    expect(withLabel.overlap).toContain('bug')
    expect(withLabel.score).toBeGreaterThanOrEqual(without.score * 0.9)
  })

  it('саму себя не считает похожей и не падает на пустом запросе', () => {
    expect(rankSimilarTasks({ id: 't1', title: 'Корзина теряет товары' }, [cart])).toEqual([])
    expect(rankSimilarTasks({ id: 'new', title: 'и не в' }, [cart])).toEqual([])
  })
})
