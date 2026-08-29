// Сторож объявленных переменных: `var(--x)` без фолбэка, у которого нет
// объявления, браузер отбрасывает вместе со всем свойством — молча.
//
// Круг 8 нашёл 111 таких мест: пропавшие тени карточек, подложки предупреждений,
// границы панели БЗ, подсветка активной вкладки настроек. Ни одно не видно ни
// в typecheck, ни в jsdom-тестах: там нет каскада и вычисления var().
//
// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesDir = fileURLToPath(new URL('.', import.meta.url))
const uiKitStyles = fileURLToPath(new URL('../../../ui-kit/src/styles.css', import.meta.url))
const uiSrc = fileURLToPath(new URL('..', import.meta.url))

function cssSources(): string[] {
  const files = readdirSync(stylesDir).filter((name) => name.endsWith('.css')).map((name) => join(stylesDir, name))
  return [...files, uiKitStyles].map((file) => readFileSync(file, 'utf8'))
}

/**
 * Переменные, объявленные в CSS (`--x: …`) и из JS. Из JS их ставят двумя
 * способами: `setProperty('--x', …)` и inline-стилем `{ '--x': … }` — второй
 * даёт, например, `--preview-width` у раздвижного чата.
 */
function declaredNames(): Set<string> {
  const names = new Set<string>()
  for (const css of cssSources()) for (const match of css.matchAll(/(--[a-z0-9-]+)\s*:/g)) names.add(match[1])
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(path) }
      else if (/\.tsx?$/.test(entry.name)) {
        const source = readFileSync(path, 'utf8')
        for (const match of source.matchAll(/setProperty\(\s*['"](--[a-z0-9-]+)['"]/g)) names.add(match[1])
        for (const match of source.matchAll(/['"](--[a-z0-9-]+)['"]\s*:/g)) names.add(match[1])
      }
    }
  }
  walk(uiSrc)
  return names
}

/** Использования без фолбэка: `var(--x)`, но не `var(--x, …)`. */
function bareUsages(css: string): Map<string, number[]> {
  const found = new Map<string, number[]>()
  css.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/g)) {
      const lines = found.get(match[1]) ?? []
      lines.push(index + 1)
      found.set(match[1], lines)
    }
  })
  return found
}

describe('переменные темы', () => {
  const declared = declaredNames()
  for (const file of ['app.css', 'global.css']) {
    it(`${file}: каждое var(--…) без фолбэка объявлено`, () => {
      const missing = [...bareUsages(readFileSync(join(stylesDir, file), 'utf8'))]
        .filter(([name]) => !declared.has(name))
        .map(([name, lines]) => `${name} (строки ${lines.slice(0, 5).join(', ')}${lines.length > 5 ? '…' : ''})`)
      expect(missing, 'Необъявленная переменная без фолбэка отбрасывает всё объявление').toEqual([])
    })
  }
})
