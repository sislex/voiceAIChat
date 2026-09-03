import { describe, expect, it } from 'vitest'
import { transformName } from './imageTransform'

describe('imageTransform', () => {
  it('имя результата — суффикс и .png, занятые имена получают номер', () => {
    expect(transformName('кот.png', 'повёрнуто', new Set())).toBe('кот-повёрнуто.png')
    // jpg-исходник тоже даёт .png: canvas отдаёт PNG.
    expect(transformName('фото.jpg', '512', new Set())).toBe('фото-512.png')
    const taken = new Set(['кот-зеркало.png', 'кот-зеркало-2.png'])
    expect(transformName('кот.png', 'зеркало', taken)).toBe('кот-зеркало-3.png')
  })
})

import { clampCrop } from './imageTransform'

describe('clampCrop', () => {
  it('прижимает рамку к границам и отбрасывает слишком мелкую', () => {
    expect(clampCrop({ x: -10, y: -10, w: 50, h: 50 }, 100, 100)).toEqual({ x: 0, y: 0, w: 50, h: 50 })
    expect(clampCrop({ x: 80, y: 90, w: 50, h: 50 }, 100, 100)).toEqual({ x: 80, y: 90, w: 20, h: 10 })
    expect(clampCrop({ x: 10, y: 10, w: 4, h: 40 }, 100, 100)).toBeNull()
    expect(clampCrop({ x: 99, y: 0, w: 50, h: 50 }, 100, 100)).toBeNull()
  })
})
