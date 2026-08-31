// Правило переходов состояний экрана. Тест держит именно те две болезни, из-за
// которых правило появилось: мигание скелетона поверх уже показанных данных и
// «пусто вместо сломалось». Таблицей — потому что важна каждая пара
// (status, hasData), а не отдельные случаи.

import { describe, expect, it } from 'vitest'
import { loadView, type LoadStatus, type ViewState } from './loadState'

describe('loadView', () => {
  const cases: Array<[LoadStatus, boolean, ViewState, boolean, boolean]> = [
    // status      hasData  state       refreshing staleError
    ['idle', false, 'skeleton', false, false],
    ['loading', false, 'skeleton', false, false],
    ['error', false, 'error', false, false],
    ['ready', false, 'empty', false, false],
    ['idle', true, 'data', false, false],
    ['loading', true, 'data', true, false],
    ['ready', true, 'data', false, false],
    ['error', true, 'data', false, true]
  ]

  it.each(cases)('%s + данные=%s → %s (refreshing=%s, staleError=%s)', (status, hasData, state, refreshing, staleError) => {
    expect(loadView(status, hasData)).toEqual({ state, refreshing, staleError })
  })

  it('повторная загрузка уже показанных данных не подменяет их скелетоном', () => {
    // Первая болезнь, из-за которой правило и появилось.
    expect(loadView('loading', true).state).toBe('data')
    expect(loadView('loading', true).refreshing).toBe(true)
  })

  it('ошибка при показанных данных — баннер над содержимым, а не вместо него', () => {
    // Вторая болезнь: раньше ошибка нигде не показывалась.
    expect(loadView('error', true)).toEqual({ state: 'data', refreshing: false, staleError: true })
  })

  it('idle без данных — скелетон, а не «Пусто»: запрос уходит в эффекте при монтировании', () => {
    expect(loadView('idle', false).state).toBe('skeleton')
  })

  it('«Пусто» показывается только когда запрос действительно завершился', () => {
    expect(loadView('ready', false).state).toBe('empty')
    expect(loadView('loading', false).state).not.toBe('empty')
  })
})
