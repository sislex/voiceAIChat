// Безопасная сборка локальной AI-ретуши: модель видит только crop и маску,
// а финальные пиксели вне маски копируются из декодированного оригинала.
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { IMAGE_HOST_DIR } from '@voicechat/shared'
import { imageRetouchBounds, localizeImageRetouchSelection, validateImageRetouchSelection, type ImageRetouchSelection, type ImageRect } from '@voicechat/shared'

export interface RetouchGeneratorInput {
  crop: Buffer
  mask: Buffer
  prompt: string
  references: Buffer[]
  width: number
  height: number
}
export type RetouchGenerator = (input: RetouchGeneratorInput) => Promise<Buffer>

export interface ProcessRetouchInput {
  original: Buffer
  selection: ImageRetouchSelection
  prompt: string
  references?: Buffer[]
  generate: RetouchGenerator
}

export interface ProcessRetouchOutput {
  image: Buffer
  crop: ImageRect
  width: number
  height: number
}

function maskSvg(selection: ImageRetouchSelection, width: number, height: number): Buffer {
  const shape = selection.kind === 'rectangle'
    ? `<rect x="${selection.x}" y="${selection.y}" width="${selection.width}" height="${selection.height}" fill="white"/>`
    : `<polygon points="${selection.points.map((p) => `${p.x},${p.y}`).join(' ')}" fill="white"/>`
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="black"/>${shape}</svg>`)
}

function assertGeneratedFormat(info: { width?: number; height?: number; format?: string }, width: number, height: number): void {
  if (!info.format || !['png', 'jpeg', 'webp', 'avif', 'tiff'].includes(info.format)) throw new Error('AI вернул неподдерживаемый формат изображения')
  if (info.width !== width || info.height !== height) throw new Error(`AI вернул неверный размер: ожидался ${width}×${height}, получен ${info.width ?? '?'}×${info.height ?? '?'}`)
}

function verifyOutside(original: Buffer, result: Buffer, mask: Buffer): void {
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 0) continue
    const at = i * 4
    if (original[at] !== result[at] || original[at + 1] !== result[at + 1] || original[at + 2] !== result[at + 2] || original[at + 3] !== result[at + 3]) {
      throw new Error('Проверка безопасности: пиксели за пределами выделения изменились')
    }
  }
}

function assertAcceptableSeam(original: Buffer, generated: Buffer, mask: Buffer, width: number, height: number): void {
  let sum = 0
  let count = 0
  const inside = (x: number, y: number): boolean => mask[y * width + x] > 127
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!inside(x, y)) continue
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1 || (x > 0 && !inside(x - 1, y)) || (x + 1 < width && !inside(x + 1, y)) || (y > 0 && !inside(x, y - 1)) || (y + 1 < height && !inside(x, y + 1))) {
      const at = (y * width + x) * 4
      sum += (Math.abs(original[at] - generated[at]) + Math.abs(original[at + 1] - generated[at + 1]) + Math.abs(original[at + 2] - generated[at + 2])) / 3
      count++
    }
  }
  if (count > 0 && sum / count > 180) throw new Error('Результат отклонён: на границе выделения обнаружен недопустимый стык')
}

export async function saveRetouchedImage(input: {
  image: Buffer
  name: string
  localRoot: string
  agentId?: string
  remote?: {
    root(): Promise<string>
    mkdir(path: string): Promise<unknown>
    write(path: string, dataBase64: string): Promise<unknown>
  }
}): Promise<string> {
  if (input.agentId) {
    if (!input.remote) throw new Error('Машина-источник недоступна для записи результата')
    const root = await input.remote.root()
    const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
    const dir = `${root.replace(/[/\\]$/, '')}${sep}${IMAGE_HOST_DIR}`
    const path = `${dir}${sep}${input.name}`
    await input.remote.mkdir(dir)
    await input.remote.write(path, input.image.toString('base64'))
    return path
  }
  const dir = join(input.localRoot, IMAGE_HOST_DIR)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, input.name)
  writeFileSync(path, input.image)
  return path
}

export async function processImageRetouch(input: ProcessRetouchInput): Promise<ProcessRetouchOutput> {
  if (!input.prompt.trim()) throw new Error('Введите описание ретуши')
  let metadata
  try { metadata = await sharp(input.original).metadata() }
  catch { throw new Error('Исходный файл не является поддерживаемым изображением') }
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  const invalid = validateImageRetouchSelection(input.selection, { width, height })
  if (invalid) throw new Error(invalid)
  const crop = imageRetouchBounds(input.selection, { width, height })
  const local = localizeImageRetouchSelection(input.selection, crop)
  const cropBuffer = await sharp(input.original).extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height }).png().toBuffer()
  const mask = await sharp(maskSvg(local, crop.width, crop.height)).removeAlpha().greyscale().raw().toBuffer()
  const maskPng = await sharp(mask, { raw: { width: crop.width, height: crop.height, channels: 1 } }).png().toBuffer()

  let generated: Buffer
  try {
    generated = await input.generate({ crop: cropBuffer, mask: maskPng, prompt: input.prompt.trim(), references: input.references ?? [], width: crop.width, height: crop.height })
  } catch (cause) {
    throw new Error(`AI не смог выполнить ретушь: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  const generatedInfo = await sharp(generated).metadata().catch(() => ({}))
  assertGeneratedFormat(generatedInfo, crop.width, crop.height)

  const originalRaw = await sharp(input.original).ensureAlpha().raw().toBuffer()
  const generatedRaw = await sharp(generated).ensureAlpha().raw().toBuffer()
  const originalCropRaw = await sharp(cropBuffer).ensureAlpha().raw().toBuffer()
  assertAcceptableSeam(originalCropRaw, generatedRaw, mask, crop.width, crop.height)

  const resultRaw = Buffer.from(originalRaw)
  for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) {
    if (mask[y * crop.width + x] <= 127) continue
    const sourceAt = (y * crop.width + x) * 4
    const targetAt = ((crop.y + y) * width + crop.x + x) * 4
    generatedRaw.copy(resultRaw, targetAt, sourceAt, sourceAt + 4)
  }
  verifyOutside(originalRaw, resultRaw, (() => {
    const full = Buffer.alloc(width * height)
    for (let y = 0; y < crop.height; y++) mask.copy(full, (crop.y + y) * width + crop.x, y * crop.width, (y + 1) * crop.width)
    return full
  })())
  return { image: await sharp(resultRaw, { raw: { width, height, channels: 4 } }).png().toBuffer(), crop, width, height }
}
