import { describe, expect, it } from 'vitest'
import { IMAGE_TRANSFORMS, transformName } from './imageTransform'

describe('imageTransform', () => {
  it('имя результата — суффикс и .png, занятые имена получают номер', () => {
    expect(transformName('кот.png', 'повёрнуто', new Set())).toBe('кот-повёрнуто.png')
    // jpg-исходник тоже даёт .png: canvas отдаёт PNG.
    expect(transformName('фото.jpg', '512', new Set())).toBe('фото-512.png')
    const taken = new Set(['кот-зеркало.png', 'кот-зеркало-2.png'])
    expect(transformName('кот.png', 'зеркало', taken)).toBe('кот-зеркало-3.png')
    // Конверсии задают расширение явно — оно обещает формат содержимого.
    expect(transformName('кот.png', 'jpeg', new Set(), 'jpg')).toBe('кот-jpeg.jpg')
    expect(transformName('кот.png', 'webp', new Set(), 'webp')).toBe('кот-webp.webp')
  })

  it('в наборе есть все три поворота и обе конверсии, суффиксы не повторяются', () => {
    const kinds = IMAGE_TRANSFORMS.map((item) => item.kind)
    expect(kinds).toContain('rotate90')
    expect(kinds).toContain('rotate180')
    expect(kinds).toContain('rotate270')
    expect(IMAGE_TRANSFORMS.find((item) => item.kind === 'toWebp')?.ext).toBe('webp')
    expect(IMAGE_TRANSFORMS.find((item) => item.kind === 'toJpeg')?.ext).toBe('jpg')
    // Одинаковый суффикс у двух обработок склеил бы их результаты в одно имя.
    const suffixes = IMAGE_TRANSFORMS.map((item) => item.suffix)
    expect(new Set(suffixes).size).toBe(suffixes.length)
  })
})

import { coverRect, trimBox } from './imageTransform'

describe('trimBox', () => {
  /** Пиксели RGBA построчно: alpha=0 — пустое поле. */
  const build = (rows: number[][]): number[] => rows.flatMap((row) => row.flatMap((alpha) => [255, 0, 0, alpha]))

  it('находит рамку содержимого внутри прозрачных полей', () => {
    // 4×3, содержимое — один пиксель в центре.
    expect(trimBox(build([[0, 0, 0, 0], [0, 0, 255, 0], [0, 0, 0, 0]]), 4, 3)).toEqual({ x: 2, y: 1, w: 1, h: 1 })
  })

  it('содержимое во всю картинку даёт рамку по размеру', () => {
    expect(trimBox(build([[255, 255], [255, 255]]), 2, 2)).toEqual({ x: 0, y: 0, w: 2, h: 2 })
  })

  it('полностью прозрачная картинка — null, обрезать нечего', () => {
    expect(trimBox(build([[0, 0], [0, 0]]), 2, 2)).toBeNull()
  })

  it('почти прозрачные пиксели считаются полем: порог настраивается', () => {
    expect(trimBox(build([[4, 4], [4, 200]]), 2, 2)).toEqual({ x: 1, y: 1, w: 1, h: 1 })
    expect(trimBox(build([[4, 4], [4, 200]]), 2, 2, 2)).toEqual({ x: 0, y: 0, w: 2, h: 2 })
  })
})

describe('coverRect', () => {
  it('широкую картинку под OG режет по бокам, а не сверху', () => {
    const area = coverRect(2000, 1000, 1200, 630)
    expect(area.h).toBe(1000)
    expect(area.w).toBeLessThan(2000)
    // Обрезка симметрична: слева и справа срезано одинаково.
    expect(area.x).toBe(Math.round((2000 - area.w) / 2))
    expect(area.y).toBe(0)
  })

  it('высокую картинку под квадрат режет сверху и снизу', () => {
    const area = coverRect(500, 1500, 1080, 1080)
    expect(area).toEqual({ x: 0, y: 500, w: 500, h: 500 })
  })

  it('область не выходит за исходник даже при мелкой картинке', () => {
    const area = coverRect(100, 100, 1200, 630)
    expect(area.w).toBeLessThanOrEqual(100)
    expect(area.h).toBeLessThanOrEqual(100)
    expect(area.x).toBeGreaterThanOrEqual(0)
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
