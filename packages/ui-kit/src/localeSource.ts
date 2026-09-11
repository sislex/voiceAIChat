import { useSyncExternalStore } from 'react'

/** Optional application-owned locale store for messages rendered in host portals. */
export interface UiLocaleSource {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => string
  translate: (text: string) => string
}

const emptySubscribe = (): (() => void) => () => undefined
const emptySnapshot = (): string => ''

export function useLocaleSource(source?: UiLocaleSource, fallbackLang?: string): { lang?: string; translate: (text: string) => string } {
  const locale = useSyncExternalStore(source?.subscribe ?? emptySubscribe, source?.getSnapshot ?? emptySnapshot, emptySnapshot)
  return { lang: locale || fallbackLang, translate: (text) => source?.translate(text) ?? text }
}
