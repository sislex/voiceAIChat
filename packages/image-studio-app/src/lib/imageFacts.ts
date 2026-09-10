// Факты о картинке, которые не видны из списка файлов: настоящий тип по
// первым байтам, наличие прозрачности, приблизительное число цветов и
// человеческое дерево версий. Всё — чистые функции над данными: тип по
// байтам, остальное по массиву пикселей, поэтому проверяется без canvas.
import type { ImageStudioFile } from '@shared/imageStudio'

/** Настоящий тип файла по сигнатуре; null — сигнатура незнакомая. */
export function sniffImageType(bytes: Uint8Array | number[]): 'png' | 'jpg' | 'gif' | 'webp' | 'svg' | null {
  const at = (index: number): number => Number(bytes[index] ?? -1)
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'png'
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'jpg'
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return 'gif'
  // RIFF….WEBP: четыре байта размера между сигнатурами.
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return 'webp'
  // SVG — текст: ищем «<svg» или xml-пролог в первых байтах.
  const head = Array.from({ length: Math.min(64, bytes.length) }, (_, index) => String.fromCharCode(at(index))).join('').toLowerCase()
  if (head.includes('<svg') || (head.includes('<?xml') && head.includes('svg'))) return 'svg'
  return null
}

/**
 * Совпадает ли расширение с содержимым. Расхождение бывает после ручного
 * переименования и ломает всё, что читает файл по расширению (публикация,
 * вставка в вёрстку), поэтому о нём стоит предупреждать.
 */
export function extensionMismatch(path: string, actual: 'png' | 'jpg' | 'gif' | 'webp' | 'svg' | null): string | null {
  if (!actual) return null
  const ext = path.toLowerCase().split('.').pop() ?? ''
  // jpeg и jpg — одно и то же, остальное сверяем как есть.
  const normalized = ext === 'jpeg' ? 'jpg' : ext
  return normalized === actual ? null : `Файл на самом деле ${actual.toUpperCase()}, а расширение «.${ext}»`
}

/** Есть ли в картинке полупрозрачные пиксели: от этого зависит выбор формата. */
export function hasAlphaPixels(pixels: Uint8ClampedArray | number[]): boolean {
  for (let index = 3; index < pixels.length; index += 4) {
    if (Number(pixels[index]) < 250) return true
  }
  return false
}

/**
 * Сколько примерно уникальных цветов: считаем по огрублённым до 4 бит на
 * канал значениям (4096 корзин). Точное число цветов ничего не говорит, а
 * «12 цветов» против «трёх тысяч» — это разница между флэт-иллюстрацией и
 * фотографией, и она видна даже на грубой сетке.
 */
export function approxColorCount(pixels: Uint8ClampedArray | number[]): number {
  const seen = new Set<number>()
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (Number(pixels[index + 3]) < 8) continue
    const r = Number(pixels[index]) >> 4
    const g = Number(pixels[index + 1]) >> 4
    const b = Number(pixels[index + 2]) >> 4
    seen.add((r << 8) | (g << 4) | b)
  }
  return seen.size
}

/**
 * Дерево версий: файл, его правки и правки правок — с уровнем вложенности.
 * `versionFamily` отвечает «кто родня», а дерево показывает, что от чего
 * произошло: на четырёх ветвях список имён этого уже не объясняет.
 */
export function versionTree(files: ImageStudioFile[], path: string): Array<{ path: string; depth: number }> {
  const byPath = new Map(files.map((file) => [file.path, file]))
  if (!byPath.has(path)) return []
  const seenUp = new Set<string>([path])
  let root = path
  for (;;) {
    const source = byPath.get(root)?.source
    if (!source || !byPath.has(source) || seenUp.has(source)) break
    seenUp.add(source)
    root = source
  }
  const out: Array<{ path: string; depth: number }> = []
  const seen = new Set<string>()
  const walk = (current: string, depth: number): void => {
    if (seen.has(current)) return
    seen.add(current)
    out.push({ path: current, depth })
    for (const child of files.filter((file) => file.source === current).sort((a, b) => a.updatedAt - b.updatedAt)) {
      walk(child.path, depth + 1)
    }
  }
  walk(root, 0)
  return out
}

/** Заметки списком в Markdown: забрать их из галереи текстом. */
export function notesMarkdown(notes: Record<string, string>): string {
  const lines = Object.entries(notes)
    .filter(([, text]) => text.trim())
    .sort(([left], [right]) => left.localeCompare(right, 'ru'))
    .map(([path, text]) => `- **${path}** — ${text.trim()}`)
  return lines.length ? `# Заметки галереи\n\n${lines.join('\n')}\n` : ''
}
