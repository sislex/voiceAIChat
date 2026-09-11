import { makeSystemMessages } from './messages.js'

export { makeSystemMessages } from './messages.js'
export type MakeLocale = 'ru' | 'en'
export type MakeMessageCatalog = Readonly<Record<string, Readonly<Record<MakeLocale, string>>>>
export const MAKE_LOCALE_KEY = 'vc.make.locale'

/** Honor language preferences and quality weights; keep Russian as the migration default. */
export function resolveMakeLocale(value?: string | readonly string[] | null): MakeLocale {
  const preferences = (typeof value === 'string' ? value : value?.join(',') ?? '').split(',')
    .map((entry, index) => {
      const [tag, ...parameters] = entry.trim().split(';')
      const quality = parameters.find((part) => part.trim().startsWith('q='))?.trim().slice(2)
      return { locale: tag.toLowerCase().split('-')[0], quality: quality === undefined ? 1 : Number(quality), index }
    })
    .filter((entry) => (entry.locale === 'ru' || entry.locale === 'en') && entry.quality > 0 && entry.quality <= 1)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)
  return preferences[0]?.locale === 'en' ? 'en' : 'ru'
}

export function formatMakeMessage(template: string, values: Readonly<Record<string, unknown>> = {}): string {
  return template.replace(/\{(p\d+)\}/g, (token, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name] ?? '') : token)
}

type Pattern = { parts: string[]; names: string[]; message: Readonly<Record<MakeLocale, string>>; length: number }

/** Linear matching avoids turning server-provided details into regular expressions. */
function matchMessage(text: string, pattern: Pattern): Record<string, string> | null {
  const { parts, names } = pattern
  if (!text.startsWith(parts[0]) || !text.endsWith(parts[parts.length - 1])) return null
  let offset = parts[0].length
  const values: Record<string, string> = {}
  for (let i = 0; i < names.length; i++) {
    const next = parts[i + 1]
    const end = i === names.length - 1 ? text.length - next.length : next ? text.indexOf(next, offset) : -1
    if (end < offset) return null
    const value = text.slice(offset, end)
    if (names[i] in values && values[names[i]] !== value) return null
    values[names[i]] = value
    offset = end + next.length
  }
  return offset === text.length ? values : null
}

/** Translate known legacy messages without changing user content or protocol identifiers. */
export function createMakeTextTranslator(catalog: MakeMessageCatalog): (text: string, locale: MakeLocale) => string {
  const exact = new Map<string, Readonly<Record<MakeLocale, string>>>()
  const patterns: Pattern[] = []
  for (const message of Object.values(catalog)) {
    for (const locale of ['ru', 'en'] as const) {
      const source = message[locale]
      const names = [...source.matchAll(/\{(p\d+)\}/g)].map((match) => match[1])
      if (!names.length) exact.set(source, message)
      else {
        const parts = source.split(/\{p\d+\}/g)
        if (parts.some(Boolean)) patterns.push({ parts, names, message, length: parts.join('').length })
      }
    }
  }
  patterns.sort((a, b) => b.length - a.length)
  return (text, locale) => {
    const known = exact.get(text)
    if (known) return known[locale]
    if (text.length > 32_768) return text
    for (const pattern of patterns) {
      const values = matchMessage(text, pattern)
      if (values) return formatMakeMessage(pattern.message[locale], values)
    }
    return text
  }
}

export const translateMakeSystemText = createMakeTextTranslator(makeSystemMessages)
