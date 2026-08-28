// Лёгкий линтер проекта Make (roadmap-4 п.12): предупреждения по JSX/TS и CSS без внешних зависимостей.
// Это не eslint/stylelint — набор дешёвых эвристик на типичные огрехи сгенерированного кода;
// ошибки компиляции ловит esbuild (`compile-error`), линтер даёт только `warning`.

export interface MakeLintIssue {
  line: number
  column?: number
  rule: string
  message: string
}

const CSS_HEX = /#([0-9a-f]{3,8})\b/gi

function lintScript(lines: string[]): MakeLintIssue[] {
  const out: MakeLintIssue[] = []
  lines.forEach((text, i) => {
    const line = i + 1
    const code = text.replace(/\/\/.*$/, '')
    if (/^\s*\/\//.test(text) || /^\s*\*/.test(text)) return
    if (/\bconsole\.(log|debug)\(/.test(code)) out.push({ line, rule: 'no-console', message: 'Отладочный console.log — уберите перед публикацией' })
    if (/\bdebugger\b/.test(code)) out.push({ line, rule: 'no-debugger', message: 'Оставлен debugger' })
    if (/\bvar\s+[A-Za-z_$]/.test(code)) out.push({ line, rule: 'no-var', message: 'Используйте const/let вместо var' })
    if (/[^=!<>]==[^=]|!=[^=]/.test(code) && !/['"`].*==.*['"`]/.test(code)) out.push({ line, rule: 'eqeqeq', message: 'Нестрогое сравнение — используйте === / !==' })
    if (/dangerouslySetInnerHTML/.test(code)) out.push({ line, rule: 'no-danger', message: 'dangerouslySetInnerHTML — риск XSS, проверьте источник разметки' })
    if (/<img\b(?![^>]*\balt=)[^>]*>/i.test(code)) out.push({ line, rule: 'img-alt', message: 'У <img> нет alt' })
    if (/\.map\(\s*\(?[^)]*\)?\s*=>\s*(\(\s*)?<[A-Za-z]/.test(code) && !/\bkey=/.test(code) && !/\bkey=/.test(lines[i + 1] ?? '')) out.push({ line, rule: 'jsx-key', message: 'Элемент в .map без key' })
  })
  return out
}

function lintCss(lines: string[]): MakeLintIssue[] {
  const out: MakeLintIssue[] = []
  let block: Map<string, number> | null = null
  let blockStart = 0
  let blockHasDecl = false
  lines.forEach((text, i) => {
    const line = i + 1
    const code = text.replace(/\/\*.*?\*\//g, '')
    if (/!important/.test(code)) out.push({ line, rule: 'no-important', message: '!important — лучше поднять специфичность селектора' })
    for (const m of code.matchAll(CSS_HEX)) {
      const len = m[1]!.length
      if (![3, 4, 6, 8].includes(len)) out.push({ line, column: (m.index ?? 0) + 1, rule: 'color-hex', message: `Некорректный цвет ${m[0]}` })
    }
    if (code.includes('{')) { block = new Map(); blockStart = line; blockHasDecl = false }
    if (block) {
      const decl = /^\s*([a-z-]+)\s*:/i.exec(code)
      if (decl && !code.includes('{')) {
        blockHasDecl = true
        const prop = decl[1]!.toLowerCase()
        if (block.has(prop)) out.push({ line, rule: 'no-duplicate-property', message: `Свойство ${prop} повторяется в блоке (строка ${block.get(prop)})` })
        else block.set(prop, line)
      }
    }
    if (code.includes('}')) {
      if (block && !blockHasDecl && !/@/.test(lines[blockStart - 1] ?? '') && !/\{\s*\}\s*$/.test('') && blockStart === line ? /\{\s*\}/.test(code) : block && !blockHasDecl && blockStart < line) out.push({ line: blockStart, rule: 'no-empty-block', message: 'Пустое правило' })
      block = null
    }
  })
  return out
}

/** Предупреждения по одному файлу; неподдерживаемые расширения — пусто. */
export function lintMakeFile(path: string, content: string): MakeLintIssue[] {
  const lines = content.split('\n')
  if (/\.(tsx?|jsx?|mjs)$/i.test(path)) return lintScript(lines)
  if (/\.css$/i.test(path)) return lintCss(lines)
  return []
}
