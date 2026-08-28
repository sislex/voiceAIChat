import { describe, expect, it } from 'vitest'
import { pixelDiff } from './pixelDiff'

const img = (w: number, h: number, fill: [number, number, number, number]) => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set(fill, i * 4)
  return { width: w, height: h, data }
}

describe('pixelDiff', () => {
  it('одинаковые буферы — 0 отличий, карта серая полупрозрачная', () => {
    const r = pixelDiff(img(2, 2, [200, 200, 200, 255]), img(2, 2, [210, 200, 200, 255]))
    expect(r.differing).toBe(0)
    expect(r.mismatch).toBe(0)
    expect(Array.from(r.diff.slice(0, 4))).toEqual([200, 200, 200, 64])
  })
  it('считает отличающиеся пиксели и красит их красным', () => {
    const a = img(2, 1, [0, 0, 0, 255]), b = img(2, 1, [0, 0, 0, 255])
    b.data.set([255, 255, 255, 255], 4)
    const r = pixelDiff(a, b)
    expect(r.differing).toBe(1)
    expect(r.mismatch).toBe(0.5)
    expect(Array.from(r.diff.slice(4, 8))).toEqual([255, 40, 40, 255])
  })
  it('разные размеры: лишняя область — отличие', () => {
    const r = pixelDiff(img(2, 2, [0, 0, 0, 255]), img(3, 2, [0, 0, 0, 255]))
    expect(r.width).toBe(3)
    expect(r.differing).toBe(2)
  })
})
