// Чистая часть настроек редактора — без импорта Monaco, чтобы тестировать в vitest
// (у пакета monaco-editor нет node-entry) и переиспользовать в фолбэке.

/** Язык Monaco по расширению файла проекта. */
export function monacoLanguageFor(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  switch (ext) {
    case 'html': case 'htm': return 'html'
    case 'css': return 'css'
    case 'js': case 'mjs': case 'cjs': case 'jsx': return 'javascript'
    case 'ts': case 'tsx': return 'typescript'
    case 'json': case 'webmanifest': return 'json'
    case 'md': case 'markdown': return 'markdown'
    case 'svg': case 'xml': return 'xml'
    case 'yml': case 'yaml': return 'yaml'
    default: return 'plaintext'
  }
}

/**
 * Автозакрытие JSX-тегов: у Monaco оно есть для HTML, а для javascript/typescript закрывающий
 * тег в VS Code добавляет TS-сервер, которого в браузере нет. Поэтому — сами: после набора `>`
 * у открывающего тега `<Tag …>` (не самозакрывающегося, не закрывающего) вставляем `</Tag>`.
 */
export function jsxClosingTagFor(textBeforeCursor: string): string | null {
  const m = textBeforeCursor.match(/<([A-Za-z][\w.:-]*)(\s[^<>]*)?>$/)
  if (!m) return null
  if (m[2]?.trimEnd().endsWith('/')) return null
  // Сравнения/стрелки вроде `a > b` или `=>` до регулярки не доходят: нужен `<Имя` перед `>`.
  return `</${m[1]}>`
}

