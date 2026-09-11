import { createMakeTextTranslator, type MakeMessageCatalog } from '@voicechat/make-contracts/localization'
import catalog from '../i18n/monaco.ru.json'
import { getMakeLocale } from '../i18n'

const messages: MakeMessageCatalog = Object.fromEntries(Object.entries(catalog.messages).map(([en, ru], index) => [
  String(index), { en: en.replace(/\{(\d+)\}/g, '{p$1}'), ru: ru.replace(/\{(\d+)\}/g, '{p$1}') }
]))
const translate = createMakeTextTranslator(messages)
const chromeSelector = '.find-widget, .findOptionsWidget, .suggest-widget .message, .suggest-widget .details-label, .monaco-hover .status-bar'
const excluded = '.view-lines, .view-line, .monaco-tokenized-source, textarea, script, style, [contenteditable="true"]'

/** Monaco's ESM build caches English labels. Adapt only its controls, preserving models and undo history. */
export function localizeMonacoChrome(root: HTMLElement): { refresh: () => void; dispose: () => void } {
  const textOriginals = new WeakMap<Text, { original: string; rendered: string }>()
  const attributeOriginals = new WeakMap<Element, Map<string, { original: string; rendered: string }>>()
  let active = root.contains(document.activeElement)
  const localized = (text: string): string => {
    const match = /^(\s*)(.*?)(\s*)$/s.exec(text)!
    const content = match[2]
    const keybinding = /^(.*?)(\s+\((?:Alt|Ctrl|Control|Shift|Cmd|⌘|⌥)[^)]*\))$/.exec(content)
    return match[1] + (keybinding ? translate(keybinding[1], getMakeLocale()) + keybinding[2] : translate(content, getMakeLocale())) + match[3]
  }
  const refresh = (): void => {
    const areas: Element[] = [...root.querySelectorAll(chromeSelector)]
    if (active) areas.push(...document.querySelectorAll('.context-view .monaco-menu'))
    for (const area of areas) {
      const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        if (node.parentElement?.closest(excluded)) continue
        const previous = textOriginals.get(node)
        const original = previous?.rendered === node.data ? previous.original : node.data
        const rendered = localized(original)
        textOriginals.set(node, { original, rendered })
        if (node.data !== rendered) node.data = rendered
      }
    }
    const elements = new Set([...root.querySelectorAll('[title], [aria-label], [placeholder]'), ...areas.flatMap((area) => [area, ...area.querySelectorAll('[title], [aria-label], [placeholder]')])])
    for (const element of elements) {
      if (element.closest('.view-lines, .view-line, .monaco-tokenized-source')) continue
      let values = attributeOriginals.get(element)
      if (!values) { values = new Map(); attributeOriginals.set(element, values) }
      for (const name of ['title', 'aria-label', 'placeholder']) {
        const value = element.getAttribute(name)
        if (value === null) continue
        const previous = values.get(name)
        const original = previous?.rendered === value ? previous.original : value
        const rendered = localized(original)
        values.set(name, { original, rendered })
        if (rendered !== value) element.setAttribute(name, rendered)
      }
    }
  }
  const focus = (event: FocusEvent): void => {
    if (event.target instanceof Node && root.contains(event.target)) active = true
    else if (event.target instanceof Element && !event.target.closest('.context-view')) active = false
  }
  const observer = new MutationObserver(refresh)
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder'] })
  const menus = new MutationObserver(() => { if (active) refresh() })
  menus.observe(document.body, { childList: true, subtree: true })
  document.addEventListener('focusin', focus)
  refresh()
  return { refresh, dispose: () => { observer.disconnect(); menus.disconnect(); document.removeEventListener('focusin', focus) } }
}
