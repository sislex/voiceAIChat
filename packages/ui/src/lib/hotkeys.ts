// Комбинации клавиш: разбор строки («mod+k», «Space», «?»), сверка с событием и
// подпись для показа человеку. Чистые функции без React — их читают и хук
// (useHotkeys.ts), и шпаргалка (HotkeysCheatSheet), и кнопка «⌘K» в сайдбаре,
// поэтому одна и та же комбинация нигде не описана дважды.
//
// `mod` — «команда платформы»: ⌘ на macOS, Ctrl на остальных. В сверке с
// событием обе клавиши равноправны: браузер на Mac присылает metaKey, на Windows
// ctrlKey, и различать их в биндинге незачем.

/** Разобранная комбинация. */
export interface ParsedCombo {
  /** Клавиша в нижнем регистре: 'k', 'space', 'escape', '?'. */
  key: string
  /** Команда платформы: ⌘ или Ctrl. */
  mod: boolean
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

/** Подписи клавиш, у которых имя события не годится для показа. */
const KEY_LABELS: Record<string, string> = {
  space: 'Пробел',
  escape: 'Esc',
  esc: 'Esc',
  enter: 'Enter',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→'
}

/** Разбирает 'mod+shift+k' в набор флагов и клавишу. */
export function parseCombo(combo: string): ParsedCombo {
  const parts = combo.split('+').map((part) => part.trim()).filter(Boolean)
  const key = (parts.pop() ?? '').toLowerCase()
  const mods = parts.map((part) => part.toLowerCase())
  return {
    key,
    mod: mods.includes('mod'),
    ctrl: mods.includes('ctrl') || mods.includes('control'),
    meta: mods.includes('meta') || mods.includes('cmd'),
    alt: mods.includes('alt') || mods.includes('option'),
    shift: mods.includes('shift')
  }
}

/** Комбинация требует модификатор — значит, её можно ловить и в поле ввода. */
export function hasModifier(combo: ParsedCombo): boolean {
  return combo.mod || combo.ctrl || combo.meta || combo.alt
}

/**
 * Совпала ли клавиша (без модификаторов). Пробел и Esc сверяем по `code`:
 * на нелатинской раскладке `key` у них тот же, а вот у букв — нет, поэтому
 * буквы наоборот сверяются по `key` (⌘K на русской раскладке даёт key 'k').
 */
export function comboKeyMatches(event: Pick<KeyboardEvent, 'key' | 'code'>, combo: ParsedCombo): boolean {
  const key = (event.key ?? '').toLowerCase()
  if (combo.key === 'space') return event.code === 'Space' || key === ' '
  if (combo.key === 'escape' || combo.key === 'esc') return event.code === 'Escape' || key === 'escape'
  return key === combo.key
}

/** Совпало ли событие с комбинацией целиком: клавиша плюс модификаторы. */
export function comboMatches(event: KeyboardEvent, combo: ParsedCombo): boolean {
  if (!comboKeyMatches(event, combo)) return false
  if (combo.mod) {
    if (!event.metaKey && !event.ctrlKey) return false
  } else {
    if (combo.ctrl !== event.ctrlKey) return false
    if (combo.meta !== event.metaKey) return false
  }
  if (combo.alt !== event.altKey) return false
  // Shift не требуем, если комбинация его не объявила: символ вроде «?» сам по
  // себе набирается с Shift, и требовать его отдельно нельзя.
  if (combo.shift && !event.shiftKey) return false
  return true
}

/** macOS/iOS — там `mod` рисуется как ⌘, а модификаторы пишутся без плюсов. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  const platform = data?.platform ?? navigator.platform ?? navigator.userAgent ?? ''
  return /mac|iphone|ipad|ipod/i.test(platform)
}

/** Подпись комбинации: '⌘K' на macOS, 'Ctrl+K' на остальных. */
export function formatCombo(combo: string, apple: boolean = isApplePlatform()): string {
  const parsed = parseCombo(combo)
  const parts: string[] = []
  if (parsed.mod) parts.push(apple ? '⌘' : 'Ctrl')
  if (parsed.ctrl) parts.push(apple ? '⌃' : 'Ctrl')
  if (parsed.meta) parts.push(apple ? '⌘' : 'Win')
  if (parsed.alt) parts.push(apple ? '⌥' : 'Alt')
  if (parsed.shift) parts.push(apple ? '⇧' : 'Shift')
  const key = KEY_LABELS[parsed.key] ?? (parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key)
  parts.push(key)
  return apple ? parts.join('') : parts.join('+')
}
