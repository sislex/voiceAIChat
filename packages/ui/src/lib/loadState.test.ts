import { describe, expect, it } from 'vitest'
import { loadView } from './loadState'

describe('loadView', () => {
  it('первая загрузка — скелетон', () => {
    expect(loadView('loading', false)).toEqual({ state: 'skeleton', refreshing: false, staleError: false })
  })

  it('idle без данных — тоже скелетон, а не «пусто»', () => {
    expect(loadView('idle', false).state).toBe('skeleton')
  })

  it('повторная загрузка при показанных данных не подменяет их скелетоном', () => {
    expect(loadView('loading', true)).toEqual({ state: 'data', refreshing: true, staleError: false })
  })

  it('ответ без элементов — пустота', () => {
    expect(loadView('ready', false).state).toBe('empty')
  })

  it('ошибка без данных — экран ошибки', () => {
    expect(loadView('error', false).state).toBe('error')
  })

  it('ошибка при показанных данных — данные остаются, ошибка баннером', () => {
    expect(loadView('error', true)).toEqual({ state: 'data', refreshing: false, staleError: true })
  })
})
