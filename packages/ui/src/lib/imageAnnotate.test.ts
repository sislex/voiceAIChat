import { describe, expect, it } from 'vitest'
import { arrowHead } from './imageAnnotate'

describe('arrowHead', () => {
  it('усы наконечника симметричны и лежат позади острия', () => {
    const [left, right] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 10)
    // Стрелка вправо: усы уходят назад (x < 100) и симметричны по y.
    expect(left.x).toBeCloseTo(right.x, 5)
    expect(left.x).toBeLessThan(100)
    expect(left.y).toBeCloseTo(-right.y, 5)
    expect(Math.hypot(100 - left.x, left.y)).toBeCloseTo(10, 5)
  })
})
