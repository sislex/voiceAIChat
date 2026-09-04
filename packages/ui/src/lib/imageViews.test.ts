import { describe, expect, it } from 'vitest'
import { decodeStudioView, encodeStudioView, isEmptyView, pixelsOf, shapeOf, viewSummary, type StudioView } from './imageViews'

describe('viewSummary', () => {
  it('перечисляет условия и порядок, пустой вид называет прямо', () => {
    expect(viewSummary({ kind: 'png', order: 'name' })).toBe('PNG · по имени')
    expect(viewSummary({ query: 'кот', mark: 'ready', starsOnly: true })).toBe('«кот» · готовые · только избранные')
    expect(viewSummary({})).toBe('без условий')
    expect(viewSummary({ shape: 'portrait' })).toBe('портрет')
  })
})

describe('encode/decodeStudioView', () => {
  it('полный вид переживает круг через ссылку', () => {
    const view: StudioView = { query: 'кот в шляпе', origin: 'ai', mark: 'ready', set: 'обложки', kind: 'png', shape: 'square', order: 'pixels', grouped: true, starsOnly: true }
    expect(decodeStudioView(encodeStudioView(view))).toEqual(view)
  })

  it('порядок «new» и пустые условия в ссылку не попадают', () => {
    expect(encodeStudioView({ order: 'new', origin: '', mark: '', query: '' })).toBe('')
    expect(decodeStudioView('')).toEqual({})
  })

  it('неизвестные значения отбрасываются: ссылка приходит извне', () => {
    expect(decodeStudioView('order=rm -rf&mark=что-то&from=hack&shape=oval')).toEqual({})
    // Расширение — только буквы и цифры, иначе это не тип файла.
    expect(decodeStudioView('kind=../../etc')).toEqual({})
    expect(decodeStudioView('kind=PNG')).toEqual({ kind: 'png' })
  })
})

describe('isEmptyView', () => {
  it('пустым считается вид без условий, а не без полей', () => {
    expect(isEmptyView({})).toBe(true)
    expect(isEmptyView({ query: '', origin: '', grouped: false })).toBe(true)
    expect(isEmptyView({ kind: 'png' })).toBe(false)
    expect(isEmptyView({ grouped: true })).toBe(false)
  })
})

describe('shapeOf и pixelsOf', () => {
  it('ориентация с допуском в пять процентов', () => {
    expect(shapeOf('1024×1024')).toBe('square')
    expect(shapeOf('1024×1000')).toBe('square')
    expect(shapeOf('1200×630')).toBe('landscape')
    expect(shapeOf('1080×1920')).toBe('portrait')
    expect(shapeOf(undefined)).toBeNull()
    expect(shapeOf('битая строка')).toBeNull()
  })

  it('площадь: неизвестный размер даёт ноль и уходит в конец сортировки', () => {
    expect(pixelsOf('100×50')).toBe(5000)
    expect(pixelsOf(undefined)).toBe(0)
    expect(pixelsOf('512')).toBe(0)
  })
})
