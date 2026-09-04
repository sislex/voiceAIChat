// Приём и подготовка картинок студии: безопасное имя загружаемого файла,
// решение «не пора ли уменьшить», шаблоны промптов с переменными и близость
// цветов для отбора «похожих». Всё — чистые функции: панель только применяет
// результат, а правила проверяются без DOM.

/** Предел стороны, после которого картинку разумно уменьшить перед загрузкой. */
export const DOWNSCALE_SIDE = 4000
/** Целевая длинная сторона при уменьшении: хватает и для печати, и для веба. */
export const DOWNSCALE_TARGET = 2000
/** Порог «большой файл»: о нём предупреждаем до загрузки. */
export const BIG_FILE_BYTES = 10 * 1024 * 1024

/**
 * Имя, с которым файл можно положить в галерею: пробелы и разделители путей
 * ломают ссылки и адреса, поэтому их убираем. Русские буквы оставляем — вся
 * студия говорит по-русски, и «кот-в-шляпе.png» читается лучше транслита.
 */
export function safeUploadName(raw: string): string {
  const trimmed = raw.trim().replace(/^.*[\\/]/, '')
  const dot = trimmed.lastIndexOf('.')
  const base = (dot > 0 ? trimmed.slice(0, dot) : trimmed)
    .replace(/\s+/g, '-')
    // Запрещённое в путях и адресах: кавычки, слэши, двоеточия, звёздочки.
    .replace(/["'`?*:<>|#%&{}$!+=]+/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60)
  const ext = (dot > 0 ? trimmed.slice(dot + 1) : '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)
  const name = base || 'изображение'
  return ext ? `${name}.${ext}` : `${name}.png`
}

/** Нужно ли уменьшать картинку такого размера перед загрузкой. */
export function shouldDownscale(width: number, height: number): boolean {
  return Math.max(width, height) > DOWNSCALE_SIDE
}

/**
 * Подстановка переменных в шаблон промпта: `{объект} в стиле акварели` +
 * `{объект: рыжий кот}` → `рыжий кот в стиле акварели`. Незаполненные
 * переменные остаются как есть — так видно, что забыли.
 */
export function promptTemplateFill(template: string, values: Record<string, string>): string {
  return template.replace(/\{([^{}]+)\}/g, (whole, name: string) => {
    const value = values[name.trim()]
    return value?.trim() ? value.trim() : whole
  })
}

/** Имена переменных шаблона по порядку появления, без повторов. */
export function promptTemplateVars(template: string): string[] {
  const found = [...template.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]!.trim()).filter(Boolean)
  return [...new Set(found)]
}

/** Средний цвет по пикселям (прозрачные не считаются): основа «похожих по цвету». */
export function averageColor(pixels: Uint8ClampedArray | number[]): { r: number; g: number; b: number } | null {
  let r = 0
  let g = 0
  let b = 0
  let count = 0
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (Number(pixels[index + 3]) < 8) continue
    r += Number(pixels[index])
    g += Number(pixels[index + 1])
    b += Number(pixels[index + 2])
    count += 1
  }
  if (!count) return null
  return { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) }
}

/** Расстояние между цветами (евклидово в RGB): грубо, но для «похожих» хватает. */
export function colorDistance(left: { r: number; g: number; b: number }, right: { r: number; g: number; b: number }): number {
  return Math.round(Math.sqrt((left.r - right.r) ** 2 + (left.g - right.g) ** 2 + (left.b - right.b) ** 2))
}

/** Оттенок цвета в градусах (0–360): по нему сортируется «по цвету». */
export function colorHue({ r, g, b }: { r: number; g: number; b: number }): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return 0
  const delta = max - min
  const hue = max === r
    ? ((g - b) / delta + (g < b ? 6 : 0))
    : max === g
      ? (b - r) / delta + 2
      : (r - g) / delta + 4
  return Math.round(hue * 60)
}

/** Диапазон индексов между двумя точками включительно — для Shift+стрелок. */
export function rangeBetween(from: number, to: number): number[] {
  const start = Math.min(from, to)
  const end = Math.max(from, to)
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset)
}
