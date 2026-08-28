import { describe, expect, it } from 'vitest'
import { EMPTY_MAKE_SELECTION, pruneMakeSelection, toggleMakeSelection } from './makeSelection'

const order = ['a.css', 'b.css', 'c.tsx', 'd.tsx']

describe('toggleMakeSelection', () => {
  it('Ctrl-клик переключает файл и ставит якорь', () => {
    const s1 = toggleMakeSelection(EMPTY_MAKE_SELECTION, 'b.css', order, 'toggle')
    expect(s1).toEqual({ paths: ['b.css'], anchor: 'b.css' })
    expect(toggleMakeSelection(s1, 'b.css', order, 'toggle').paths).toEqual([])
  })
  it('Shift-клик добирает диапазон от якоря в любом направлении', () => {
    const s1 = toggleMakeSelection(EMPTY_MAKE_SELECTION, 'c.tsx', order, 'toggle')
    expect(toggleMakeSelection(s1, 'a.css', order, 'range').paths).toEqual(['c.tsx', 'a.css', 'b.css'])
    expect(toggleMakeSelection(s1, 'd.tsx', order, 'range').paths).toEqual(['c.tsx', 'd.tsx'])
  })
  it('Shift без якоря ведёт себя как переключение', () => {
    expect(toggleMakeSelection(EMPTY_MAKE_SELECTION, 'a.css', order, 'range')).toEqual({ paths: ['a.css'], anchor: 'a.css' })
  })
  it('prune убирает исчезнувшие файлы и якорь', () => {
    expect(pruneMakeSelection({ paths: ['a.css', 'x.js'], anchor: 'x.js' }, order)).toEqual({ paths: ['a.css'], anchor: null })
  })
})
