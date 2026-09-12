import { describe, expect, it } from 'vitest'
import { detectImageObjects, magicWandMask, selectionBounds } from './imageSelection'

function pixels(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data.set(paint(x, y), (y * width + x) * 4)
  return data
}

describe('image selection', () => {
  it('magic wand selects only the connected color island', () => {
    const data = pixels(4, 2, (x) => x === 0 || x === 3 ? [250, 0, 0, 255] : [0, 0, 0, 255])
    expect([...magicWandMask(data, 4, 2, 0, 0, 10)]).toEqual([255, 0, 0, 0, 255, 0, 0, 0])
  })

  it('detects foreground objects against corner background', () => {
    const data = pixels(20, 20, (x, y) => x >= 5 && x < 12 && y >= 6 && y < 14 ? [255, 0, 0, 255] : [255, 255, 255, 255])
    expect(detectImageObjects(data, 20, 20, 40)[0]).toMatchObject({ x: 5, y: 6, width: 7, height: 8 })
  })

  it('calculates lasso bounds', () => {
    expect(selectionBounds([{ x: 4, y: 2 }, { x: 10, y: 8 }, { x: 6, y: 12 }])).toEqual({ x: 4, y: 2, width: 6, height: 10 })
  })
})
