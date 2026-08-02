// Гейт «файл читают инструментом read, а не командой» для remote-bash.
// Директива промпта просит читать файлы через read, но технически cat/sed/head
// оставались доступны, и модель ими пользовалась: в CHAT-70 при 41 вызове read
// был 61 вызов чтения файла внутри bash. Цена не в самом вызове, а в его
// ответе — прочитанный целиком файл лежит в контексте и оплачивается заново на
// каждом следующем запросе хода.
//
// Правило одно: отклоняем ТОЛЬКО команду, у которой нет другого смысла, кроме
// как прочитать файл рабочей копии. Всё, где чтение — часть работы (пайплайн,
// grep -r, подстановка, редирект, чужой каталог), проходит как раньше: ложный
// запрет дороже дыры — модель начнёт обходить его окольными путями.

/** Готовый вызов `read` взамен команды. */
export interface BashReadCall {
  path: string
  offset?: number
  limit?: number
}

export interface BashFileReadVerdict {
  /** Чем заменить команду; всегда непустой список. */
  calls: BashReadCall[]
  /** Команда просила хвост файла (`tail`): номер первой строки окна неизвестен. */
  fromEnd: boolean
}

/** Максимум подсказок в ответе: простыня вызовов сама съедает контекст. */
const MAX_HINTS = 5

/** Команды-«пустышки» внутри цепочки: своего вывода из файлов не дают. */
const NEUTRAL_COMMANDS = new Set(['echo', 'true', ':'])

/**
 * Символы, после которых путь известен только shell: подстановки (\x24, \x60),
 * маски и тильда. В именах файлов они не встречаются, а вот в аргументах вида
 * "$FILE" — сплошь и рядом.
 */
const SHELL_SPECIAL = /[\x24\x60*?[\]{}~]/

/** Символы, при которых команду не разбираем вовсе (см. SHELL_SPECIAL плюс скобки и редиректы). */
const STOP_CHARS = '\x60\x24()<>*?[]{}~!'

/**
 * Разбивает команду на простые сегменты (`&&`, `||`, `;`, перевод строки).
 * `null` — в команде есть то, во что мы не лезем: пайплайн, фоновый `&`,
 * редирект, подстановка, glob, тильда. Кавычки и экранирование учитываются.
 */
function splitSegments(command: string): string[][] | null {
  const segments: string[][] = []
  let words: string[] = []
  let word = ''
  let hasWord = false
  let quote: '"' | "'" | null = null
  const endWord = (): void => {
    if (hasWord) words.push(word)
    word = ''
    hasWord = false
  }
  const endSegment = (): void => {
    endWord()
    if (words.length) segments.push(words)
    words = []
  }
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (quote) {
      if (ch === quote) quote = null
      else word += ch
      continue
    }
    if (ch === '\\') {
      const next = command[i + 1]
      if (next === undefined) return null
      word += next
      hasWord = true
      i++
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      hasWord = true
      continue
    }
    if (ch === '&' || ch === '|') {
      // Одиночные `&` и `|` — фон и пайплайн: чтение там часть работы.
      if (command[i + 1] !== ch) return null
      endSegment()
      i++
      continue
    }
    if (ch === ';' || ch === '\n') {
      endSegment()
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      endWord()
      continue
    }
    if (STOP_CHARS.includes(ch)) return null
    word += ch
    hasWord = true
  }
  if (quote) return null // незакрытая кавычка: команду не разобрали
  endSegment()
  return segments
}

/** Нормализует путь: `a/./b/../c` → `a/c`; `null` — вышли за пределы. */
function normalizeRelative(value: string): string | null {
  const parts: string[] = []
  for (const part of value.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) return null
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}

function posix(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * Путь аргумента → путь для `read` (относительный, внутри cwd) или `null`.
 * `null` значит «read так не умеет», и команду мы не трогаем: файлы вне рабочей
 * директории (логи в /tmp, содержимое node_modules) читать больше нечем.
 */
function toReadPath(base: string, arg: string, cwd: string): string | null {
  const value = posix(arg)
  if (!value || value.startsWith('-') || SHELL_SPECIAL.test(value)) return null
  if (/^\/|^[A-Za-z]:\//.test(value)) {
    const root = posix(cwd)
    if (value === root || !value.startsWith(root + '/')) return null
    return normalizeRelative(value.slice(root.length + 1)) || null
  }
  return normalizeRelative(base ? base + '/' + value : value) || null
}

/** Флаги и операнды простой команды: после `--` всё считается операндом. */
function splitArgs(args: string[]): { flags: string[]; operands: string[] } {
  const flags: string[] = []
  const operands: string[] = []
  let literal = false
  for (const arg of args) {
    if (literal) {
      operands.push(arg)
      continue
    }
    if (arg === '--') {
      literal = true
      continue
    }
    if (arg.length > 1 && arg.startsWith('-')) flags.push(arg)
    else operands.push(arg)
  }
  return { flags, operands }
}

/** Значение флага, записанного отдельным словом (`-n 40`). */
function nextValueOf(args: string[], flag: string): string | null {
  const index = args.indexOf(flag)
  const value = index >= 0 ? args[index + 1] : undefined
  return value === undefined || value.startsWith('-') ? null : value
}

/**
 * Операнды команды. Список флагов, забирающих следующее слово, свой у каждой
 * команды: у `head -n 40` это счётчик строк, а у `sed -n` флаг значения не
 * берёт — там следующее слово и есть скрипт.
 */
function operandsOf(args: string[], valueFlags: string[]): string[] {
  const skip = new Set<number>()
  args.forEach((arg, i) => {
    if (valueFlags.includes(arg)) skip.add(i + 1)
  })
  return splitArgs(args.filter((_, i) => !skip.has(i))).operands
}

/**
 * Сколько строк просит `head`/`tail`: `-n 40`, `-n40`, `-40`, `--lines=40`.
 * `ok: false` — счёт в байтах, слежение за файлом или непонятное значение:
 * такую команду `read` не заменяет, и мы её пропускаем.
 */
function lineCountOf(args: string[]): { count: number | null; fromStart: number | null; ok: boolean } {
  const fail = { count: null, fromStart: null, ok: false }
  let count: number | null = null
  let fromStart: number | null = null
  for (const flag of splitArgs(args).flags) {
    if (/^-(?:c|-bytes|f|-follow)/.test(flag)) return fail
    const inline = flag.match(/^-n(.+)$/) ?? flag.match(/^--lines=(.+)$/)
    const raw = inline
      ? inline[1]
      : flag === '-n' || flag === '--lines'
        ? nextValueOf(args, flag)
        : (flag.match(/^-(\d+)$/)?.[1] ?? null)
    if (raw === null) {
      if (flag === '-n' || flag === '--lines') return fail
      continue
    }
    const plus = raw.startsWith('+')
    const digits = plus ? raw.slice(1) : raw
    if (!/^\d+$/.test(digits) || Number(digits) < 1) return fail
    if (plus) fromStart = Number(digits)
    else count = Number(digits)
  }
  return { count, fromStart, ok: true }
}

/** `1,50p;120p` → окна для read; `null` — скрипт сложнее адресов по номерам. */
function sedWindows(script: string): Array<{ offset: number; limit: number }> | null {
  const windows: Array<{ offset: number; limit: number }> = []
  for (const part of script.split(';')) {
    const chunk = part.trim()
    if (!chunk) continue
    const m = chunk.match(/^(\d+)(?:,(\d+))?p$/)
    if (!m) return null
    const from = Number(m[1])
    const to = m[2] ? Number(m[2]) : from
    if (from < 1 || to < from) return null
    windows.push({ offset: from, limit: to - from + 1 })
  }
  return windows.length ? windows : null
}

interface SegmentResult {
  /** База путей после `cd` — относительно неё считаются следующие сегменты. */
  base: string
  calls: BashReadCall[]
  fromEnd: boolean
}

function mapPaths(operands: string[], base: string, cwd: string): string[] | null {
  const paths: string[] = []
  for (const operand of operands) {
    const path = toReadPath(base, operand, cwd)
    if (!path) return null // файл вне рабочей копии: read туда не дотянется
    paths.push(path)
  }
  return paths
}

function readSegment(name: string, args: string[], base: string, cwd: string): SegmentResult | null {
  if (name === 'sed') {
    const { flags } = splitArgs(args)
    // -n и адреса по номерам строк. Всё прочее (-i, s///, регулярки) — не чтение.
    if (!flags.includes('-n') || flags.some((f) => f !== '-n' && f !== '-e')) return null
    const operands = operandsOf(args, ['-e'])
    const script = flags.includes('-e') ? nextValueOf(args, '-e') : operands.shift()
    if (!script || !operands.length) return null
    const windows = sedWindows(script)
    if (!windows) return null
    const paths = mapPaths(operands, base, cwd)
    if (!paths) return null
    return {
      base,
      calls: paths.flatMap((path) => windows.map((w) => ({ path, offset: w.offset, limit: w.limit }))),
      fromEnd: false
    }
  }
  const operands = operandsOf(args, name === 'cat' ? [] : ['-n', '--lines'])
  if (!operands.length) return null // без файла это stdin, а не чтение файла
  const paths = mapPaths(operands, base, cwd)
  if (!paths) return null
  if (name === 'cat') return { base, calls: paths.map((path) => ({ path })), fromEnd: false }
  const { count, fromStart, ok } = lineCountOf(args)
  if (!ok) return null
  if (name === 'head') {
    const limit = count ?? 10
    return { base, calls: paths.map((path) => ({ path, offset: 1, limit })), fromEnd: false }
  }
  // tail: `-n +N` — обычное окно с N-й строки; иначе это хвост, начало которого
  // известно только после первого read (он покажет «из N строк»).
  if (fromStart != null) return { base, calls: paths.map((path) => ({ path, offset: fromStart })), fromEnd: false }
  return { base, calls: paths.map((path) => ({ path })), fromEnd: true }
}

/**
 * Один сегмент цепочки: `cd`/`echo` нейтральны, `cat`/`head`/`tail`/`sed -n` по
 * файлу внутри cwd — чтение, всё прочее (`null`) снимает вопрос о запрете сразу
 * для всей команды.
 */
function evaluateSegment(words: string[], base: string, cwd: string): SegmentResult | null {
  const name = (words[0] ?? '').replace(/^.*\//, '')
  const args = words.slice(1)
  if (NEUTRAL_COMMANDS.has(name)) return { base, calls: [], fromEnd: false }
  if (name === 'cd') {
    const target = splitArgs(args).operands[0]
    if (!target || target === '-') return null
    if (target === '.') return { base, calls: [], fromEnd: false }
    // Переход в саму рабочую директорию — частый пролог модели: база пустая.
    if (posix(target) === posix(cwd)) return { base: '', calls: [], fromEnd: false }
    const next = toReadPath(base, target, cwd)
    if (next === null) return null // ушли из рабочей копии — дальше не наше дело
    return { base: next, calls: [], fromEnd: false }
  }
  if (name === 'cat' || name === 'head' || name === 'tail' || name === 'sed') {
    return readSegment(name, args, base, cwd)
  }
  return null
}

/**
 * Команда, у которой нет смысла кроме чтения файлов рабочей копии → чем её
 * заменить. `null` — пропускаем; при любой непонятности тоже `null`: гейт не
 * имеет права ни ронять ран, ни мешать работе.
 */
export function evaluateBashFileRead(command: string, cwd: string | undefined): BashFileReadVerdict | null {
  if (!cwd) return null
  const segments = splitSegments(command)
  if (!segments?.length) return null
  let base = ''
  const calls: BashReadCall[] = []
  let fromEnd = false
  for (const words of segments) {
    const result = evaluateSegment(words, base, cwd)
    if (!result) return null // хоть один сегмент делает что-то ещё — команда работает
    base = result.base
    calls.push(...result.calls)
    fromEnd = fromEnd || result.fromEnd
  }
  return calls.length ? { calls, fromEnd } : null
}

function formatCall(call: BashReadCall): string {
  const args: Record<string, string | number> = { path: call.path }
  if (call.offset != null) args.offset = call.offset
  if (call.limit != null) args.limit = call.limit
  return 'read ' + JSON.stringify(args)
}

/** Ответ на отказ: не нотация, а готовые вызовы взамен команды. */
export function bashFileReadRejection(verdict: BashFileReadVerdict): string {
  const shown = verdict.calls.slice(0, MAX_HINTS).map(formatCall)
  const rest = verdict.calls.length - shown.length
  return [
    'Отклонено: это чтение файла, а его делает инструмент read. Вывод cat/sed/head ' +
      'ложится в контекст целиком и оплачивается заново на каждом следующем запросе хода.',
    'Вызови вместо команды:',
    ...shown,
    rest > 0 ? '…и ещё ' + rest + ' таких же вызовов read.' : '',
    verdict.fromEnd ? 'Нужен хвост файла: первый read покажет «из N строк», второй — с offset ближе к N.' : '',
    'Команды, где чтение — часть работы (пайплайн, grep -r, подстановка, файл вне рабочей директории), bash выполняет как обычно.'
  ]
    .filter(Boolean)
    .join('\n')
}
