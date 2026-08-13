export interface TextChange {
  start: number
  end: number
  lines: string[]
}

export type TextMergeResult =
  | { ok: true; classification: 'independent-ranges' | 'same-anchor-independent-insert' | 'identical-insert'; rule: string; oursChanges: number; theirsChanges: number; content: string }
  | { ok: false; classification: 'ambiguous' | 'invalid-text'; reason: string; oursChanges: number; theirsChanges: number }

function splitText(value: string): { lines: string[]; trailingNewline: boolean } {
  const trailingNewline = value.endsWith('\n')
  const lines = value.split('\n')
  if (trailingNewline) lines.pop()
  return { lines, trailingNewline }
}

function changesFromBase(base: string[], side: string[]): TextChange[] | null {
  const n = base.length, m = side.length
  const lengths = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  const counts = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1))
  for (let i = n; i >= 0; i--) for (let j = m; j >= 0; j--) {
    if (i === n || j === m) counts[i][j] = 1
    else if (base[i] === side[j]) {
      lengths[i][j] = 1 + lengths[i + 1][j + 1]
      counts[i][j] = counts[i + 1][j + 1]
    } else {
      const down = lengths[i + 1][j], right = lengths[i][j + 1]
      lengths[i][j] = Math.max(down, right)
      counts[i][j] = down === right ? Math.min(2, counts[i + 1][j] + counts[i][j + 1]) : down > right ? counts[i + 1][j] : counts[i][j + 1]
    }
  }
  const baseCounts = new Map<string, number>()
  const sideCounts = new Map<string, number>()
  for (const line of base) baseCounts.set(line, (baseCounts.get(line) ?? 0) + 1)
  for (const line of side) sideCounts.set(line, (sideCounts.get(line) ?? 0) + 1)
  if ([...baseCounts].some(([line,count]) => count > 1 && sideCounts.get(line) !== count)) return null
  const result: TextChange[] = []
  let i = 0, j = 0, start = -1, removedEnd = -1, added: string[] = []
  const flush = (): void => {
    if (start >= 0) result.push({ start, end: removedEnd, lines: added })
    start = -1; removedEnd = -1; added = []
  }
  while (i < n || j < m) {
    if (i < n && j < m && base[i] === side[j]) { flush(); i++; j++ }
    else if (j < m && (i === n || lengths[i][j + 1] > lengths[i + 1][j])) {
      if (start < 0) { start = i; removedEnd = i }
      added.push(side[j++])
    } else {
      if (start < 0) { start = i; removedEnd = i }
      i++; removedEnd = i
    }
  }
  flush()
  return result
}

const isInsert = (change: TextChange): boolean => change.start === change.end
const touchesAnchor = (change: TextChange, anchor: number): boolean => !isInsert(change) && (change.start === anchor || change.end === anchor)

export function mergeIndependentText(baseText: string, oursText: string, theirsText: string): TextMergeResult {
  if ([baseText, oursText, theirsText].some(value => value.includes('\0'))) return { ok: false, classification: 'invalid-text', reason: 'обнаружено бинарное содержимое', oursChanges: 0, theirsChanges: 0 }
  const base = splitText(baseText), ours = splitText(oursText), theirs = splitText(theirsText)
  if (base.trailingNewline !== ours.trailingNewline || base.trailingNewline !== theirs.trailingNewline) return { ok: false, classification: 'ambiguous', reason: 'стороны неодинаково изменили завершающий перевод строки', oursChanges: 0, theirsChanges: 0 }
  const oursChanges = changesFromBase(base.lines, ours.lines), theirsChanges = changesFromBase(base.lines, theirs.lines)
  if (!oursChanges || !theirsChanges) return { ok: false, classification: 'ambiguous', reason: 'невозможно однозначно сопоставить строки base с версиями сторон', oursChanges: oursChanges?.length ?? 0, theirsChanges: theirsChanges?.length ?? 0 }

  for (const a of oursChanges) for (const b of theirsChanges) {
    if (!isInsert(a) && !isInsert(b) && Math.max(a.start, b.start) < Math.min(a.end, b.end)) return { ok: false, classification: 'ambiguous', reason: 'обе стороны заменяют или удаляют общие строки base', oursChanges: oursChanges.length, theirsChanges: theirsChanges.length }
    if (isInsert(a) && !isInsert(b) && a.start > b.start && a.start < b.end || !isInsert(a) && isInsert(b) && b.start > a.start && b.start < a.end) return { ok: false, classification: 'ambiguous', reason: 'вставка попадает внутрь заменённого диапазона другой стороны', oursChanges: oursChanges.length, theirsChanges: theirsChanges.length }
    if (isInsert(a) && !isInsert(b) && (a.start === b.start || a.start === b.end) || !isInsert(a) && isInsert(b) && (b.start === a.start || b.start === a.end)) return { ok: false, classification: 'ambiguous', reason: 'общий якорь вставки прилегает к изменённому базовому фрагменту', oursChanges: oursChanges.length, theirsChanges: theirsChanges.length }
  }

  const sameAnchors = oursChanges.filter(isInsert).flatMap(a => theirsChanges.filter(b => isInsert(b) && b.start === a.start).map(b => ({ a, b })))
  for (const { a } of sameAnchors) if ([...oursChanges, ...theirsChanges].some(change => change !== a && !isInsert(change) && touchesAnchor(change, a.start))) return { ok: false, classification: 'ambiguous', reason: 'общий якорь вставки прилегает к изменённому базовому фрагменту', oursChanges: oursChanges.length, theirsChanges: theirsChanges.length }

  const byStart = new Map<number, { end: number; lines: string[] }>()
  const add = (change: TextChange): boolean => {
    const current = byStart.get(change.start)
    if (!current) { byStart.set(change.start, { end: change.end, lines: [...change.lines] }); return true }
    if (isInsert(change) && current.end === change.start) {
      if (current.lines.join('\n') !== change.lines.join('\n')) current.lines.push(...change.lines)
      return true
    }
    return current.end === change.end && current.lines.join('\n') === change.lines.join('\n')
  }
  if (![...oursChanges, ...theirsChanges].every(add)) return { ok: false, classification: 'ambiguous', reason: 'изменения нельзя упорядочить однозначно', oursChanges: oursChanges.length, theirsChanges: theirsChanges.length }

  const output: string[] = []
  let cursor = 0
  for (const [start, change] of [...byStart.entries()].sort((a, b) => a[0] - b[0])) {
    output.push(...base.lines.slice(cursor, start), ...change.lines)
    cursor = change.end
  }
  output.push(...base.lines.slice(cursor))
  const content = output.join('\n') + (base.trailingNewline ? '\n' : '')
  if (/^(<<<<<<<|=======|>>>>>>>)( |$)/m.test(content)) return { ok: false, classification: 'invalid-text', reason: 'сформированный результат содержит маркеры конфликта', oursChanges: oursChanges.length, theirsChanges: theirsChanges.length }
  const identical = sameAnchors.length > 0 && sameAnchors.every(({ a, b }) => a.lines.join('\n') === b.lines.join('\n'))
  return { ok: true, classification: identical ? 'identical-insert' : sameAnchors.length ? 'same-anchor-independent-insert' : 'independent-ranges', rule: identical ? 'deduplicate-identical-insert' : sameAnchors.length ? 'same-anchor-ours-then-theirs' : 'apply-disjoint-base-ranges', oursChanges: oursChanges.length, theirsChanges: theirsChanges.length, content }
}
