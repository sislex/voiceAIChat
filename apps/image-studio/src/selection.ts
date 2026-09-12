import sharp from 'sharp'
import {
  IMAGE_STUDIO_LIMITS,
  detectImageObjects,
  imageRetouchBounds,
  magicWandMask,
  validateImageRetouchSelection,
  type ImageStudioSelection,
  type ImageStudioSelectionBounds
} from '@voicechat/shared'

export interface SelectionGeneratorInput {
  crop: Buffer
  mask: Buffer
  prompt: string
  references: Buffer[]
  width: number
  height: number
}

interface PreparedSelection {
  width: number
  height: number
  mask: Buffer
  bounds: ImageStudioSelectionBounds
}

const MAX_PIXELS = 64 * 1024 * 1024
const ANALYSIS_SIDE = 1000

export class ImageStudioSelectionError extends Error {}

async function imageAnalysis(original: Buffer): Promise<{ data: Uint8ClampedArray; width: number; height: number; naturalWidth: number; naturalHeight: number }> {
  const size = await rasterSize(original)
  const scale = Math.min(1, ANALYSIS_SIDE / Math.max(size.width, size.height))
  const { data, info } = await sharp(original, { limitInputPixels: MAX_PIXELS })
    .resize(Math.max(1, Math.round(size.width * scale)), Math.max(1, Math.round(size.height * scale)), { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data: new Uint8ClampedArray(data), width: info.width, height: info.height, naturalWidth: size.width, naturalHeight: size.height }
}

export async function detectImageStudioObjects(original: Buffer, tolerance = 48): Promise<ImageStudioSelectionBounds[]> {
  const analysis = await imageAnalysis(original)
  const scaleX = analysis.naturalWidth / analysis.width
  const scaleY = analysis.naturalHeight / analysis.height
  return detectImageObjects(analysis.data, analysis.width, analysis.height, tolerance).map((box) => ({
    kind: 'rectangle',
    x: Math.round(box.x * scaleX),
    y: Math.round(box.y * scaleY),
    width: Math.max(1, Math.round(box.width * scaleX)),
    height: Math.max(1, Math.round(box.height * scaleY))
  }))
}

export async function magicWandImageStudioSelection(original: Buffer, x: number, y: number, tolerance = 48): Promise<ImageStudioSelection> {
  const analysis = await imageAnalysis(original)
  const scaleX = analysis.naturalWidth / analysis.width
  const scaleY = analysis.naturalHeight / analysis.height
  const mask = magicWandMask(analysis.data, analysis.width, analysis.height, x / scaleX, y / scaleY, tolerance)
  const data = await sharp(Buffer.from(mask), { raw: { width: analysis.width, height: analysis.height, channels: 1 } })
    .resize(analysis.naturalWidth, analysis.naturalHeight, { kernel: 'nearest' })
    .png()
    .toBuffer()
  if (data.length > IMAGE_STUDIO_LIMITS.maxMaskBytes) throw new ImageStudioSelectionError('Маска выделения слишком велика')
  return { kind: 'mask', width: analysis.naturalWidth, height: analysis.naturalHeight, dataBase64: data.toString('base64') }
}

function selectionSvg(selection: Exclude<ImageStudioSelection, { kind: 'mask' }>, width: number, height: number): Buffer {
  const shape = selection.kind === 'rectangle'
    ? `<rect x="${selection.x}" y="${selection.y}" width="${selection.width}" height="${selection.height}" fill="white"/>`
    : `<polygon points="${selection.points.map((point) => `${point.x},${point.y}`).join(' ')}" fill="white"/>`
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="black"/>${shape}</svg>`)
}

function maskBounds(mask: Buffer, width: number, height: number, kind: ImageStudioSelectionBounds['kind']): ImageStudioSelectionBounds {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (mask[y * width + x]! <= 127) continue
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  if (maxX < 0) throw new ImageStudioSelectionError('Выделение пусто')
  return { kind, x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

async function rasterSize(input: Buffer): Promise<{ width: number; height: number }> {
  const metadata = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata().catch(() => null)
  const width = metadata?.width ?? 0
  const height = metadata?.height ?? 0
  if (!width || !height || width * height > MAX_PIXELS) throw new ImageStudioSelectionError('Исходный файл слишком велик или не является изображением')
  return { width, height }
}

export async function prepareImageStudioSelection(original: Buffer, selection: ImageStudioSelection): Promise<PreparedSelection> {
  const size = await rasterSize(original)
  if (selection.kind !== 'mask') {
    const invalid = validateImageRetouchSelection(selection, size)
    if (invalid) throw new ImageStudioSelectionError(invalid)
    const mask = await sharp(selectionSvg(selection, size.width, size.height), { limitInputPixels: MAX_PIXELS }).removeAlpha().greyscale().raw().toBuffer()
    const rect = imageRetouchBounds(selection, size)
    return { ...size, mask, bounds: { kind: selection.kind, ...rect } }
  }
  const encoded = Buffer.from(selection.dataBase64, 'base64')
  if (!encoded.length || encoded.length > IMAGE_STUDIO_LIMITS.maxMaskBytes) throw new ImageStudioSelectionError('Маска выделения пуста или слишком велика')
  const metadata = await sharp(encoded, { limitInputPixels: MAX_PIXELS }).metadata().catch(() => null)
  if (selection.width !== size.width || selection.height !== size.height || metadata?.width !== size.width || metadata.height !== size.height) {
    throw new ImageStudioSelectionError(`Размер маски должен совпадать с изображением ${size.width}×${size.height}`)
  }
  const rgba = await sharp(encoded, { limitInputPixels: MAX_PIXELS }).ensureAlpha().raw().toBuffer()
  const mask = Buffer.alloc(size.width * size.height)
  for (let index = 0; index < mask.length; index += 1) {
    const at = index * 4
    const luminance = (rgba[at]! + rgba[at + 1]! + rgba[at + 2]!) / 3
    mask[index] = Math.round(luminance * rgba[at + 3]! / 255)
  }
  return { ...size, mask, bounds: maskBounds(mask, size.width, size.height, 'mask') }
}

function cropMask(prepared: PreparedSelection): Buffer {
  const { bounds, width, mask } = prepared
  const output = Buffer.alloc(bounds.width * bounds.height)
  for (let y = 0; y < bounds.height; y += 1) {
    mask.copy(output, y * bounds.width, (bounds.y + y) * width + bounds.x, (bounds.y + y) * width + bounds.x + bounds.width)
  }
  return output
}

export async function extractImageStudioSelection(original: Buffer, selection: ImageStudioSelection): Promise<{ image: Buffer; bounds: ImageStudioSelectionBounds }> {
  const prepared = await prepareImageStudioSelection(original, selection)
  const { bounds } = prepared
  const source = await sharp(original, { limitInputPixels: MAX_PIXELS }).ensureAlpha().raw().toBuffer()
  const output = Buffer.alloc(bounds.width * bounds.height * 4)
  for (let y = 0; y < bounds.height; y += 1) for (let x = 0; x < bounds.width; x += 1) {
    const sourceAt = ((bounds.y + y) * prepared.width + bounds.x + x) * 4
    const targetAt = (y * bounds.width + x) * 4
    source.copy(output, targetAt, sourceAt, sourceAt + 4)
    output[targetAt + 3] = Math.round(output[targetAt + 3]! * prepared.mask[(bounds.y + y) * prepared.width + bounds.x + x]! / 255)
  }
  return {
    image: await sharp(output, { raw: { width: bounds.width, height: bounds.height, channels: 4 } }).png().toBuffer(),
    bounds
  }
}

export async function retouchImageStudioSelection(input: {
  original: Buffer
  selection: ImageStudioSelection
  prompt: string
  references?: Buffer[]
  generate: (input: SelectionGeneratorInput) => Promise<Buffer>
}): Promise<{ image: Buffer; bounds: ImageStudioSelectionBounds }> {
  if (!input.prompt.trim()) throw new ImageStudioSelectionError('Введите описание ретуши')
  const prepared = await prepareImageStudioSelection(input.original, input.selection)
  const { bounds } = prepared
  const crop = await sharp(input.original, { limitInputPixels: MAX_PIXELS }).extract({ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }).png().toBuffer()
  const mask = cropMask(prepared)
  const maskPng = await sharp(mask, { raw: { width: bounds.width, height: bounds.height, channels: 1 } }).png().toBuffer()
  const generated = await input.generate({ crop, mask: maskPng, prompt: input.prompt.trim(), references: input.references ?? [], width: bounds.width, height: bounds.height })
  const generatedMeta = await sharp(generated, { limitInputPixels: MAX_PIXELS }).metadata().catch(() => null)
  if (!generatedMeta?.format || generatedMeta.width !== bounds.width || generatedMeta.height !== bounds.height) {
    throw new ImageStudioSelectionError(`AI вернул неверный размер: ожидался ${bounds.width}×${bounds.height}`)
  }
  const originalRaw = await sharp(input.original, { limitInputPixels: MAX_PIXELS }).ensureAlpha().raw().toBuffer()
  const generatedRaw = await sharp(generated, { limitInputPixels: MAX_PIXELS }).ensureAlpha().raw().toBuffer()
  for (let y = 0; y < bounds.height; y += 1) for (let x = 0; x < bounds.width; x += 1) {
    if (mask[y * bounds.width + x]! <= 127) continue
    const sourceAt = (y * bounds.width + x) * 4
    const targetAt = ((bounds.y + y) * prepared.width + bounds.x + x) * 4
    generatedRaw.copy(originalRaw, targetAt, sourceAt, sourceAt + 4)
  }
  return {
    image: await sharp(originalRaw, { raw: { width: prepared.width, height: prepared.height, channels: 4 } }).png().toBuffer(),
    bounds
  }
}

export async function placeImageStudioObject(input: {
  base: Buffer
  object: Buffer
  x: number
  y: number
  width?: number
  height?: number
}): Promise<Buffer> {
  const baseSize = await rasterSize(input.base)
  const objectSize = await rasterSize(input.object)
  const width = Math.max(1, Math.round(input.width ?? objectSize.width))
  const height = Math.max(1, Math.round(input.height ?? objectSize.height))
  const x = Math.round(input.x)
  const y = Math.round(input.y)
  if (x < 0 || y < 0 || x + width > baseSize.width || y + height > baseSize.height) throw new ImageStudioSelectionError('Объект выходит за границы изображения')
  const object = width === objectSize.width && height === objectSize.height
    ? input.object
    : await sharp(input.object, { limitInputPixels: MAX_PIXELS }).resize(width, height, { fit: 'fill' }).png().toBuffer()
  return sharp(input.base, { limitInputPixels: MAX_PIXELS }).composite([{ input: object, left: x, top: y }]).png().toBuffer()
}
