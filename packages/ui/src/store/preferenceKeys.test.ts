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
import { PREFERENCE_KEYS } from './contracts'

const SRC = join(process.cwd(), 'src')
const CONTRACTS = join(SRC, 'store', 'contracts.ts')

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
  it('уникальны и живут под своим префиксом', () => {
    expect(new Set(PREFERENCE_KEYS).size).toBe(PREFERENCE_KEYS.length)
    for (const key of PREFERENCE_KEYS) expect(key).toMatch(/^(vc[.:]|voicechat\.)/)
  })

  it('не задаются литералом мимо contracts.ts', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      if (file === CONTRACTS) continue
      const source = readFileSync(file, 'utf8')
      // Литерал ключа рядом с обращением к хранилищу: именно он теряется молча.
      for (const match of source.matchAll(/(?:getItem|setItem|removeItem)\(\s*['"`]((?:vc[.:]|voicechat\.)[^'"`]*)/g)) {
        offenders.push(`${relative(SRC, file)}: ${match[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
