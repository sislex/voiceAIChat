// Разбор ANSI-раскраски в строке лога.
//
// npm, vitest и tsc печатают цвет escape-последовательностями SGR
// (`ESC[32m…ESC[0m`). Лента шага и консоль машины показывали их как есть, и
// каждая строка теста выглядела как `ESC[1mESC[32m✓ESC[0m src/…` — цвет пропадал, а
// мусор оставался. Разбор живёт здесь, а не в компоненте: он чистый, покрыт
// тестами и нужен сразу нескольким экранам.
//
// Мы намеренно поддерживаем только SGR (`ESC[…m`): цвета, яркость, жирный,
// курсив, подчёркивание и сброс. Всё остальное (перемещение курсора, очистка
// экрана, OSC-ссылки) из вывода просто вырезается — в статичном логе этим
// командам всё равно нечего делать, а показывать их как текст нельзя.

/** Базовые цвета SGR 30–37 / 90–97. Названия — ключи темы, не hex. */
export type AnsiColor =
  | 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white'

export interface AnsiStyle {
  color?: AnsiColor
  background?: AnsiColor
  /** Яркий вариант цвета (SGR 90–97 или `bold` + базовый цвет у части терминалов). */
  bright?: boolean
  bold?: boolean
  italic?: boolean
  underline?: boolean
  /** SGR 7: поменять местами текст и фон. */
  inverse?: boolean
}

export interface AnsiSegment extends AnsiStyle {
  text: string
}

const COLORS: AnsiColor[] = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']

// eslint-disable-next-line no-control-regex -- разбираем именно управляющие последовательности
const SGR = /\u001b\[([0-9;]*)m/g
// CSI без `m` (курсор, очистка), OSC (`ESC]…BEL|ESC\`) и одиночные ESC-команды.
// eslint-disable-next-line no-control-regex
const OTHER_ESCAPES = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b\[[0-9;?]*[A-Za-z]|\u001b[@-Z\\-_]/g

/** Убрать всю ANSI-разметку: для копирования, поиска и подписей. */
export function stripAnsi(input: string): string {
  return input.replace(SGR, '').replace(OTHER_ESCAPES, '')
}

function applySgr(style: AnsiStyle, code: number): AnsiStyle {
  if (code === 0) return {}
  const next: AnsiStyle = { ...style }
  if (code === 1) next.bold = true
  else if (code === 3) next.italic = true
  else if (code === 4) next.underline = true
  else if (code === 7) next.inverse = true
  else if (code === 22) delete next.bold
  else if (code === 23) delete next.italic
  else if (code === 24) delete next.underline
  else if (code === 27) delete next.inverse
  else if (code >= 30 && code <= 37) { next.color = COLORS[code - 30]; next.bright = false }
  else if (code === 39) { delete next.color; delete next.bright }
  else if (code >= 40 && code <= 47) next.background = COLORS[code - 40]
  else if (code === 49) delete next.background
  else if (code >= 90 && code <= 97) { next.color = COLORS[code - 90]; next.bright = true }
  else if (code >= 100 && code <= 107) next.background = COLORS[code - 100]
  return next
}

/**
 * Разбирает строку на отрезки с одинаковым оформлением. Пустые отрезки
 * отбрасываются: иначе на каждую последовательность приходился бы пустой `span`.
 * Нераспознанные escape-последовательности вырезаются вместе с их параметрами.
 */
export function parseAnsi(input: string): AnsiSegment[] {
  const segments: AnsiSegment[] = []
  let style: AnsiStyle = {}
  let index = 0
  // Своя копия регулярки: `stripAnsi` ниже по циклу вызывает `replace` с той же
  // глобальной, а `replace` обнуляет её `lastIndex` — общий экземпляр
  // отправлял `exec` обратно в начало строки и вешал разбор навсегда.
  const sgr = new RegExp(SGR.source, 'g')
  for (let match = sgr.exec(input); match; match = sgr.exec(input)) {
    const text = stripAnsi(input.slice(index, match.index))
    if (text) segments.push({ ...style, text })
    // `ESC[m` без параметров равен `ESC[0m` — полный сброс.
    const codes = match[1] === '' ? [0] : match[1].split(';').map((part) => Number(part) || 0)
    for (const code of codes) style = applySgr(style, code)
    index = match.index + match[0].length
  }
  const tail = stripAnsi(input.slice(index))
  if (tail) segments.push({ ...style, text: tail })
  return segments
}

/** Есть ли в строке хоть одна escape-последовательность (дешёвая проверка). */
export function hasAnsi(input: string): boolean {
  return input.includes('\u001b')
}
