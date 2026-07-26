// Картинки, созданные моделью, — встраивание в сообщение чата.
//
// Договорённость: ai-сообщение может нести fenced-блок ```image с JSON
// {path, agentId?, caption?} — абсолютным путём к файлу на машине, где шёл ход.
// Блок добавляет модель по инструкции IMAGE_HINT. Дополнительно распознаём
// обычную markdown-картинку с локальным путём (![alt](/tmp/out.png)) — модели
// пишут так по привычке, а браузер такой src загрузить не может.
//
// Чистые функции — без DOM, сети и файловой системы.

/** Одна картинка в ответе модели. */
export interface ImageRef {
  /** Абсолютный путь к файлу на машине (или на сервере, если машина не выбрана). */
  path: string
  /** id машины, где лежит файл; нет — берём машину, на которой шёл ход. */
  agentId?: string
  /** Подпись под картинкой. */
  caption?: string
}

/** Результат разбора текста ответа с картинками. */
export interface ParsedImages {
  /** Текст без блоков картинок (для обычного рендера). */
  body: string
  /** Картинки в порядке появления в тексте; пусто — картинок нет. */
  images: ImageRef[]
}

export const IMAGE_FENCE = 'image'

/** Расширения, которые считаем картинкой (браузер их отрисует). */
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'] as const

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif'
}

const FENCE_RE = /```image[^\S\n]*\n([\s\S]*?)```[^\S\n]*/g
// ![alt](путь) и ![alt](путь "title"); путь без пробелов и скобок.
const MD_IMG_RE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g

/** Инструкция модели о формате показа созданной картинки. */
export const IMAGE_HINT = [
  'Если ты создал файл с изображением (png/jpg/gif/webp/svg) и его нужно показать',
  'пользователю, добавь в ответ блок с JSON:',
  '```image',
  '{"path":"/абсолютный/путь/к/файлу.png"}',
  '```',
  'Путь — абсолютный, на той машине, где ты выполнял команды. Можно добавить',
  '"caption" с короткой подписью. Один блок на одну картинку; не описывай блок',
  'словами и не вставляй картинку как markdown — она отрисуется сама.'
].join('\n')

/** Расширение файла в нижнем регистре ('' — нет расширения). */
function extOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? ''
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i + 1).toLowerCase() : ''
}

/** Похож ли путь на картинку (по расширению). */
export function isImagePath(path: string): boolean {
  return (IMAGE_EXT as readonly string[]).includes(extOf(path))
}

/** MIME-тип по расширению пути (неизвестное — application/octet-stream). */
export function imageMime(path: string): string {
  return MIME[extOf(path)] ?? 'application/octet-stream'
}

/** Имя файла из пути (для заголовка рамки и скачивания). */
export function imageName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path
}

/** Локальный ли путь (не http/https/data/blob и не протокол-относительный). */
function isLocalPath(path: string): boolean {
  return !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(path)
}

/** Сериализует блок картинки для вставки в текст сообщения. */
export function imageBlock(image: ImageRef): string {
  return '```image\n' + JSON.stringify(image) + '\n```'
}

/** Разбирает JSON блока ```image; null — если формат не подошёл. */
function parseFenceJson(raw: string): ImageRef | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const o = parsed as { path?: unknown; agentId?: unknown; caption?: unknown }
  if (typeof o.path !== 'string' || !o.path.trim()) return null
  return {
    path: o.path.trim(),
    ...(typeof o.agentId === 'string' ? { agentId: o.agentId } : {}),
    ...(typeof o.caption === 'string' && o.caption.trim() ? { caption: o.caption.trim() } : {})
  }
}

/**
 * Вырезает из текста блоки ```image и markdown-картинки с локальным путём,
 * возвращая оставшийся текст и список картинок в порядке появления.
 * Дубликаты по пути схлопываются (модель любит и блок, и markdown разом).
 */
export function parseImages(text: string): ParsedImages {
  // Куски текста на удаление: [начало, конец) — вырезаем одним проходом в конце,
  // чтобы индексы совпадений обоих регулярок не поехали.
  const cuts: Array<[number, number]> = []
  const found: Array<{ at: number; image: ImageRef }> = []

  for (const m of text.matchAll(FENCE_RE)) {
    const at = m.index ?? 0
    const image = parseFenceJson(m[1])
    // Битый JSON оставляем в тексте как есть — пусть будет видно, что пошло не так.
    if (!image) continue
    cuts.push([at, at + m[0].length])
    found.push({ at, image })
  }

  for (const m of text.matchAll(MD_IMG_RE)) {
    const at = m.index ?? 0
    const path = m[2]
    // Внешние URL и data: оставляем markdown — их браузер покажет сам.
    if (!isLocalPath(path) || !isImagePath(path)) continue
    cuts.push([at, at + m[0].length])
    found.push({ at, image: { path, ...(m[1].trim() ? { caption: m[1].trim() } : {}) } })
  }

  if (found.length === 0) return { body: text, images: [] }

  cuts.sort((a, b) => a[0] - b[0])
  let body = ''
  let pos = 0
  for (const [from, to] of cuts) {
    if (from < pos) continue // перекрытие (блок внутри блока) — пропускаем
    body += text.slice(pos, from)
    pos = to
  }
  body += text.slice(pos)

  found.sort((a, b) => a.at - b.at)
  const images: ImageRef[] = []
  const seen = new Set<string>()
  for (const { image } of found) {
    if (seen.has(image.path)) continue
    seen.add(image.path)
    images.push(image)
  }
  return { body: body.trim(), images }
}

/**
 * URL-ы, по которым машина раздаёт эту картинку. Адрес НЕ хранится в сообщении:
 * IP машины меняется, поэтому список собирается заново из живого `AgentInfo` —
 * после обновления страницы ссылки снова актуальны. Адресов может быть
 * несколько (несколько интерфейсов) — клиент пробует их по очереди.
 */
export function machineImageUrls(
  path: string,
  imageHost: { port: number; hosts: string[] } | undefined
): string[] {
  if (!imageHost || imageHost.hosts.length === 0) return []
  const name = encodeURIComponent(imageName(path))
  return imageHost.hosts.map((h) => `http://${h}:${imageHost.port}/${name}`)
}

/** Дописывает к промпту инструкцию про блок картинки (пустой промпт не трогает). */
export function appendImageHint(prompt: string): string {
  if (!prompt.trim()) return prompt
  return `${prompt}\n\n${IMAGE_HINT}`
}
