import { describe, it, expect } from 'vitest'
import { collageLayout, fitInside } from './imageCollage'

describe('collageLayout', () => {
  it('стремится к квадрату: четыре картинки — 2×2, пять — 3×2', () => {
    expect(collageLayout(4, 100, 10)).toMatchObject({ columns: 2, rows: 2 })
    expect(collageLayout(5, 100, 10)).toMatchObject({ columns: 3, rows: 2 })
    expect(collageLayout(1, 100, 10)).toMatchObject({ columns: 1, rows: 1 })
  })

  it('лист вмещает все ячейки с полями по краям', () => {
    const layout = collageLayout(4, 100, 10)
    expect(layout).toMatchObject({ width: 10 + 2 * 110, height: 10 + 2 * 110 })
    expect(layout.cells).toEqual([
      { x: 10, y: 10 }, { x: 120, y: 10 },
      { x: 10, y: 120 }, { x: 120, y: 120 }
    ])
    // Последняя ячейка не выходит за лист — иначе картинку обрежет край.
    const last = layout.cells[layout.cells.length - 1]!
    expect(last.x + 100 + 10).toBeLessThanOrEqual(layout.width)
    expect(last.y + 100 + 10).toBeLessThanOrEqual(layout.height)
  })

  it('заданное число колонок уважается, но не больше числа картинок', () => {
    expect(collageLayout(6, 100, 10, 3)).toMatchObject({ columns: 3, rows: 2 })
    expect(collageLayout(2, 100, 10, 5)).toMatchObject({ columns: 2, rows: 1 })
    expect(collageLayout(3, 100, 10, 0)).toMatchObject({ columns: 1, rows: 3 })
  })

  it('пустой список всё равно даёт лист на одну ячейку, а не нулевой canvas', () => {
    expect(collageLayout(0, 100, 10)).toMatchObject({ columns: 1, rows: 1, cells: [{ x: 10, y: 10 }] })
  })
})

describe('fitInside', () => {
  it('вписывает без искажения и центрирует по короткой стороне', () => {
    expect(fitInside(200, 100, 100)).toEqual({ width: 100, height: 50, dx: 0, dy: 25 })
    expect(fitInside(100, 200, 100)).toEqual({ width: 50, height: 100, dx: 25, dy: 0 })
    expect(fitInside(50, 50, 100)).toEqual({ width: 100, height: 100, dx: 0, dy: 0 })
  })

  it('нулевые размеры не роняют деление', () => {
    expect(fitInside(0, 0, 100)).toEqual({ width: 1, height: 1, dx: 50, dy: 50 })
  })
})
