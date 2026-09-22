// Страж реестра ключей предпочтений.
//
// Настройки взгляда (тема-зеркало, ширина сайдбара, вид доски) живут в
// предпочтениях браузера, и ломаются они тихо: совпавший ключ у двух фич
// затирает чужое значение, а ключ-литерал внутри компонента не находится при
// переименовании и просто перестаёт читаться — со стороны это «настройка
// сбросилась». Поэтому ключи объявляются в `contracts.ts`, а тест следит, что
// правило соблюдено.

import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!['.ts', '.tsx'].includes(extname(entry.name))) return []
    if (/\.(test|stories)\.tsx?$/.test(entry.name)) return []
    return [path]
  })
}

describe('ключи предпочтений', () => {
  it('не задаются литералом мимо contracts.ts', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, 'utf8')
      // Литерал ключа рядом с обращением к хранилищу: именно он теряется молча.
      for (const match of source.matchAll(/(?:getItem|setItem|removeItem)\(\s*['"`]((?:vc[.:]|voicechat\.)[^'"`]*)/g)) {
        offenders.push(`${relative(SRC, file)}: ${match[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
