import { describe, expect, it } from 'vitest'
import { imageRetouchBounds, localizeImageRetouchSelection, scaleImagePoint, validateImageRetouchSelection } from './imageRetouch'

describe('геометрия локальной ретуши', () => {
  it('масштабирует экранные координаты в исходное разрешение', () => {
    expect(scaleImagePoint({ x: 150, y: 100 }, { width: 300, height: 200 }, { width: 1200, height: 800 })).toEqual({ x: 600, y: 400 })
  })

  it('строит минимальный прямоугольник и локализует rectangle', () => {
    const selection = { kind: 'rectangle' as const, x: 10.2, y: 20.7, width: 30.1, height: 40.1 }
    const bounds = imageRetouchBounds(selection, { width: 100, height: 100 })
    expect(bounds).toEqual({ x: 10, y: 20, width: 31, height: 41 })
    expect(localizeImageRetouchSelection(selection, bounds)).toEqual({ kind: 'rectangle', x: 0.1999999999999993, y: 0.6999999999999993, width: 30.1, height: 40.1 })
  })

  it('строит минимальный прямоугольник лассо', () => {
    const selection = { kind: 'lasso' as const, points: [{ x: 9.5, y: 3 }, { x: 40, y: 8 }, { x: 12, y: 50.2 }] }
    expect(imageRetouchBounds(selection, { width: 100, height: 100 })).toEqual({ x: 9, y: 3, width: 31, height: 48 })
    expect(validateImageRetouchSelection(selection, { width: 100, height: 100 })).toBeNull()
  })

  it('отклоняет пустое и выходящее за кадр выделение', () => {
    expect(validateImageRetouchSelection({ kind: 'rectangle', x: 0, y: 0, width: 0, height: 2 }, { width: 10, height: 10 })).toMatch(/пусто/)
    expect(validateImageRetouchSelection({ kind: 'lasso', points: [{ x: 0, y: 0 }, { x: 11, y: 0 }, { x: 0, y: 2 }] }, { width: 10, height: 10 })).toMatch(/границы/)
  })
})
