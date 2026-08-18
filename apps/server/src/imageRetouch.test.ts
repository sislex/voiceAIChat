import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { processImageRetouch, saveRetouchedImage } from './imageRetouch'

async function solid(width: number, height: number, rgba: { r: number; g: number; b: number; alpha?: number }): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: rgba } }).png().toBuffer()
}

describe('saveRetouchedImage', () => {
  it('пишет результат в .generated_images машины-источника', async () => {
    const mkdir = vi.fn(async () => ({}))
    const write = vi.fn(async () => ({}))
    const path = await saveRetouchedImage({
      image: Buffer.from('png'),
      name: 'retouch.png',
      localRoot: '/unused',
      agentId: 'machine-1',
      remote: { root: async () => '/work/project', mkdir, write }
    })
    expect(path).toBe('/work/project/.generated_images/retouch.png')
    expect(mkdir).toHaveBeenCalledWith('/work/project/.generated_images')
    expect(write).toHaveBeenCalledWith(path, Buffer.from('png').toString('base64'))
  })
})

describe('processImageRetouch', () => {
  it('передаёт AI только минимальный crop и маску, меняет только rectangle', async () => {
    const original = await solid(8, 6, { r: 10, g: 20, b: 30, alpha: 0.5 })
    const generate = vi.fn(async ({ width, height }: { width: number; height: number }) => solid(width, height, { r: 100, g: 110, b: 120, alpha: 1 }))
    const result = await processImageRetouch({ original, selection: { kind: 'rectangle', x: 2, y: 1, width: 3, height: 2 }, prompt: 'исправить', generate })
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ width: 3, height: 2 }))
    expect(result.crop).toEqual({ x: 2, y: 1, width: 3, height: 2 })
    const before = await sharp(original).ensureAlpha().raw().toBuffer()
    const after = await sharp(result.image).ensureAlpha().raw().toBuffer()
    for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) {
      const at = (y * 8 + x) * 4
      const inside = x >= 2 && x < 5 && y >= 1 && y < 3
      expect([...after.subarray(at, at + 4)]).toEqual(inside ? [100, 110, 120, 255] : [...before.subarray(at, at + 4)])
    }
  })

  it('сохраняет произвольную форму и прозрачность за лассо', async () => {
    const original = await solid(5, 5, { r: 2, g: 3, b: 4, alpha: 0.25 })
    const result = await processImageRetouch({
      original,
      selection: { kind: 'lasso', points: [{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 1, y: 4 }] },
      prompt: 'цвет',
      generate: ({ width, height }) => solid(width, height, { r: 20, g: 30, b: 40, alpha: 1 })
    })
    const before = await sharp(original).ensureAlpha().raw().toBuffer()
    const after = await sharp(result.image).ensureAlpha().raw().toBuffer()
    expect([...after.subarray(0, 4)]).toEqual([...before.subarray(0, 4)])
  })

  it('оборачивает ошибку AI понятной причиной', async () => {
    await expect(processImageRetouch({
      original: await solid(4, 4, { r: 0, g: 0, b: 0 }),
      selection: { kind: 'rectangle', x: 1, y: 1, width: 2, height: 2 },
      prompt: 'x',
      generate: async () => { throw new Error('генератор недоступен') }
    })).rejects.toThrow('AI не смог выполнить ретушь: генератор недоступен')
  })

  it('отклоняет неверный размер ответа AI', async () => {
    await expect(processImageRetouch({
      original: await solid(4, 4, { r: 0, g: 0, b: 0 }),
      selection: { kind: 'rectangle', x: 1, y: 1, width: 2, height: 2 },
      prompt: 'x',
      generate: async () => solid(3, 2, { r: 2, g: 3, b: 4 })
    })).rejects.toThrow('неверный размер')
  })

  it('отклоняет недопустимый стык', async () => {
    await expect(processImageRetouch({
      original: await solid(6, 6, { r: 0, g: 0, b: 0 }),
      selection: { kind: 'rectangle', x: 1, y: 1, width: 4, height: 4 },
      prompt: 'x',
      generate: async () => solid(4, 4, { r: 255, g: 255, b: 255 })
    })).rejects.toThrow('недопустимый стык')
  })
})
