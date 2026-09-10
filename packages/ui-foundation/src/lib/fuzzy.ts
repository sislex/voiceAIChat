// Нечёткий поиск по коротким строкам (названия команд, бесед, задач): совпадением
// считается подпоследовательность запроса в тексте, а вес даётся за то, где именно
// буквы совпали. Нужен и сам факт совпадения, и индексы совпавших букв — палитра
// их подсвечивает, поэтому «нашлось/не нашлось» через indexOf не годится.
//
// Оценка считается динамическим программированием (подход fzy): жадный проход
// слева направо выбирает первое совпадение, а не лучшее, и «кп» в «Командная
// палитра» подсветилось бы как «Ко…мандная» вместо «Командная Палитра».
// Строки здесь короткие (десятки символов), поэтому таблица n×m дешевле, чем
// объяснять пользователю, почему подсветка прыгает.

/** Совпадение запроса с текстом: вес для сортировки и индексы букв для подсветки. */
export interface FuzzyMatch {
  /** Чем больше, тем лучше совпадение. Величина имеет смысл только при сравнении. */
  score: number
  /** Индексы совпавших символов в тексте, по возрастанию. */
  indices: number[]
}

// Веса. Совпадение в начале слова весит почти как продолжение уже начатого
// совпадения: «сп» должно найти «Создать Проект» раньше, чем «расПиСание».
const BONUS_CONSECUTIVE = 1
const BONUS_START = 0.9
const BONUS_WORD = 0.8
const BONUS_CAPITAL = 0.7
// Пропуски дешёвые и лишь слегка сдвигают равные варианты: совпадение ближе к
// началу строки лучше, чем такое же в конце.
const GAP_LEADING = -0.005
const GAP_INNER = -0.01
/** «Совпадения нет»: реальные оценки лежат рядом с нулём, так что порог с запасом. */
const NO_MATCH = -1e9
const NO_MATCH_LIMIT = -1e6
/** Длиннее не считаем: подсвечивать хвост всё равно не нужно, а таблица растёт как n×m. */
const MAX_TEXT = 200

/** Символ — часть слова (буква или цифра любого алфавита). */
function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch)
}

/** Вес совпадения в позиции i: начало строки, начало слова, «горб» camelCase. */
function charBonus(text: string, i: number): number {
  if (i === 0) return BONUS_START
  const prev = text[i - 1]!
  if (!isWordChar(prev)) return BONUS_WORD
  const ch = text[i]!
  if (prev === prev.toLowerCase() && prev !== prev.toUpperCase() && ch === ch.toUpperCase() && ch !== ch.toLowerCase()) {
    return BONUS_CAPITAL
  }
  return 0
}

/**
 * Ищет запрос в тексте как подпоследовательность. Регистр не важен. Пустой
 * запрос совпадает со всем (нулевой вес, без подсветки), несовпадение — `null`.
 */
export function fuzzyMatch(text: string, query: string): FuzzyMatch | null {
  if (query === '') return { score: 0, indices: [] }
  const src = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text
  const t = src.toLowerCase()
  const q = query.toLowerCase()
  const n = t.length
  const m = q.length
  if (m > n) return null

  // Отбраковка до таблицы: если букв запроса нет по порядку — считать нечего.
  // Это отсекает почти весь список бесед на каждом нажатии клавиши.
  let scan = 0
  for (let j = 0; j < m; j += 1) {
    scan = t.indexOf(q[j]!, scan)
    if (scan < 0) return null
    scan += 1
  }

  const bonus = new Float64Array(n)
  for (let i = 0; i < n; i += 1) bonus[i] = charBonus(src, i)

  // D[j][i] — лучший вес, если q[j] совпала именно в позиции i.
  // M[j][i] — лучший вес совпадения q[0..j] в t[0..i] (с возможным пропуском).
  const D = new Float64Array(n * m)
  const M = new Float64Array(n * m)
  for (let j = 0; j < m; j += 1) {
    const qc = q[j]!
    const gap = j === m - 1 ? GAP_LEADING : GAP_INNER
    const row = j * n
    const prevRow = row - n
    let prevM = NO_MATCH
    for (let i = 0; i < n; i += 1) {
      let d = NO_MATCH
      if (t[i] === qc) {
        if (j === 0) d = i * GAP_LEADING + bonus[i]!
        else if (i > 0) {
          d = Math.max(D[prevRow + i - 1]! + BONUS_CONSECUTIVE, M[prevRow + i - 1]! + bonus[i]!)
        }
      }
      const best = Math.max(d, prevM + gap)
      D[row + i] = d
      M[row + i] = best
      prevM = best
    }
  }

  const score = M[m * n - 1]!
  if (score < NO_MATCH_LIMIT) return null

  // Обратный проход: совпадение стояло в позиции i, если лучший вес строки
  // достигается именно совпадением, а не пропуском.
  const indices: number[] = []
  let j = m - 1
  for (let i = n - 1; i >= 0 && j >= 0; i -= 1) {
    const d = D[j * n + i]!
    if (d > NO_MATCH_LIMIT && d === M[j * n + i]) {
      indices.push(i)
      j -= 1
    }
  }
  indices.reverse()
  return { score, indices }
}
