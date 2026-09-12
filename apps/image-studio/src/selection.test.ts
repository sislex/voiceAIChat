import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { extractImageStudioSelection, placeImageStudioObject, prepareImageStudioSelection, retouchImageStudioSelection } from './selection.js'

async function fixture(): Promise<Buffer> {
  return sharp({ create: { width: 6, height: 4, channels: 4, background: '#0000ffff' } })
    .composite([{ input: Buffer.from('<svg width="2" height="2"><rect width="2" height="2" fill="red"/></svg>'), left: 2, top: 1 }])
    .png().toBuffer()
}

describe('image studio selections', () => {
  it('extracts a rectangular object with its original placement', async () => {
    const result = await extractImageStudioSelection(await fixture(), { kind: 'rectangle', x: 2, y: 1, width: 2, height: 2 })
    expect(result.bounds).toEqual({ kind: 'rectangle', x: 2, y: 1, width: 2, height: 2 })
    expect(await sharp(result.image).metadata()).toMatchObject({ width: 2, height: 2, format: 'png' })
  })

  it('keeps pixels outside a retouch selection unchanged', async () => {
    const original = await fixture()
    const result = await retouchImageStudioSelection({
      original,
      selection: { kind: 'rectangle', x: 2, y: 1, width: 2, height: 2 },
      prompt: 'green',
      generate: async ({ width, height }) => sharp({ create: { width, height, channels: 4, background: '#00ff00ff' } }).png().toBuffer()
    })
    const before = await sharp(original).ensureAlpha().raw().toBuffer()
    const after = await sharp(result.image).ensureAlpha().raw().toBuffer()
    expect(after.subarray(0, 4).equals(before.subarray(0, 4))).toBe(true)
    expect([...after.subarray((1 * 6 + 2) * 4, (1 * 6 + 2) * 4 + 3)]).toEqual([0, 255, 0])
  })

  it('round-trips an extracted object onto its base', async () => {
    const base = await fixture()
    const extracted = await extractImageStudioSelection(base, { kind: 'rectangle', x: 2, y: 1, width: 2, height: 2 })
    const placed = await placeImageStudioObject({ base, object: extracted.image, x: 0, y: 0 })
    const raw = await sharp(placed).ensureAlpha().raw().toBuffer()
    expect([...raw.subarray(0, 3)]).toEqual([255, 0, 0])
  })

  it('rejects a magic-wand mask with a different size', async () => {
    const mask = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ffffffff' } }).png().toBuffer()
    await expect(prepareImageStudioSelection(await fixture(), { kind: 'mask', width: 1, height: 1, dataBase64: mask.toString('base64') })).rejects.toThrow(/Размер маски/)
  })
})
