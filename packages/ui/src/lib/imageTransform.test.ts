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
