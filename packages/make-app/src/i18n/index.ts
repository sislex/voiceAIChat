import { useSyncExternalStore } from 'react'
import { makeMessages } from './messages'
import { commonMakeMessages } from './commonMessages'
import { createMakeTextTranslator, makeSystemMessages, formatMakeMessage, MAKE_LOCALE_KEY } from '@voicechat/make-contracts/localization'
export { MAKE_LOCALE_KEY } from '@voicechat/make-contracts/localization'

export type MakeLocale = 'ru' | 'en'
const messages = { ...makeMessages, ...commonMakeMessages }
export type MakeMessageKey = keyof typeof messages
const localeEvent = 'voicechat:make-locale'
let memoryLocale: MakeLocale = 'ru'
let storageWriteFailed = false

export function getMakeLocale(): MakeLocale {
  if (storageWriteFailed) return memoryLocale
  try {
    const stored = localStorage.getItem(MAKE_LOCALE_KEY)
    return stored === 'en' ? 'en' : 'ru'
  } catch {
    return memoryLocale
  }
}

export function setMakeLocale(locale: MakeLocale): void {
  if (locale !== 'ru' && locale !== 'en') return
  memoryLocale = locale
  try { localStorage.setItem(MAKE_LOCALE_KEY, locale); storageWriteFailed = false } catch { storageWriteFailed = true }
  try { document.cookie = `vc_make_locale=${locale}; Path=/; SameSite=Lax; Max-Age=31536000` } catch { /* Cross-origin and file:// hosts still localize errors in the panel. */ }
  window.dispatchEvent(new Event(localeEvent))
}

export function subscribeMakeLocale(listener: () => void): () => void {
  const storage = (event: StorageEvent): void => {
    if (event.key === null || event.key === MAKE_LOCALE_KEY) { storageWriteFailed = false; listener() }
  }
  window.addEventListener(localeEvent, listener)
  window.addEventListener('storage', storage)
  return () => {
    window.removeEventListener(localeEvent, listener)
    window.removeEventListener('storage', storage)
  }
}

/** Every Make surface subscribes independently, including dialogs rendered through portals. */
export function useMakeLocale(): MakeLocale {
  return useSyncExternalStore(subscribeMakeLocale, getMakeLocale, () => 'ru')
}

export function translateMake(key: MakeMessageKey, locale: MakeLocale, values: Record<string, unknown> = {}): string {
  return formatMakeMessage(messages[key][locale], values)
}

/** Read the current choice at call time so asynchronous actions never capture an old language. */
export function mt(key: MakeMessageKey, values?: Record<string, unknown>): string {
  return translateMake(key, getMakeLocale(), values)
}

export function formatMakeDate(value: number | string): string {
  return new Date(value).toLocaleString(getMakeLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function formatMakeNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(getMakeLocale(), options).format(value)
}

const translateKnownText = createMakeTextTranslator({ ...makeSystemMessages, ...messages })
export function localizeMakeText(text: string): string {
  return translateKnownText(text, getMakeLocale())
}

export function localizeMakeStackLabel(text: string): string {
  return text.split(' · ').map(localizeMakeText).join(' · ')
}

export function makeTurnLabel(count: number): string {
  const category = new Intl.PluralRules(getMakeLocale()).select(count)
  return mt(category === 'one' ? 'turn' : category === 'few' ? 'turns' : 'turns_a632d3')
}

export function describeMakeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const known = localizeMakeText(message)
  if (known !== message) return known
  if (message === 'Load failed' || /Failed to fetch|NetworkError|fetch failed|ECONNREFUSED|ETIMEDOUT/i.test(message)) {
    return mt('connectionFailed')
  }
  return known
}
