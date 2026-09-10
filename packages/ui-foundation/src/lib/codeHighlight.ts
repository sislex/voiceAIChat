// Подсветка кода для редактора Make: highlight.js уже в зависимостях (Markdown), берём
// ядро + нужные языки, а не автоопределение — по расширению файла язык известен точно.
// Возвращаем HTML со спанами `hljs-*`; экранирование делает сам highlight.js.
import hljs from 'highlight.js/lib/core'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import typescript from 'highlight.js/lib/languages/typescript'

hljs.registerLanguage('xml', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('typescript', typescript)

const BY_EXT: Record<string, string> = {
  html: 'xml', htm: 'xml', svg: 'xml', xml: 'xml',
  css: 'css',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  json: 'json', webmanifest: 'json',
  md: 'markdown', markdown: 'markdown'
}

/** Больше — подсвечивать дорого на каждом нажатии; редактор покажет обычный текст. */
export const HIGHLIGHT_MAX_CHARS = 120_000

export function languageForPath(path: string): string | null {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return BY_EXT[ext] ?? null
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** HTML подсветки; для неизвестного языка или очень длинного текста — просто экранированный текст. */
export function highlightCode(code: string, path: string): string {
  const language = languageForPath(path)
  // Хвостовой перенос: без него последняя пустая строка textarea не совпадёт по высоте с pre.
  const source = code.endsWith('\n') ? code + ' ' : code
  if (!language || source.length > HIGHLIGHT_MAX_CHARS) return escapeHtml(source)
  try {
    return hljs.highlight(source, { language, ignoreIllegals: true }).value
  } catch {
    return escapeHtml(source)
  }
}
