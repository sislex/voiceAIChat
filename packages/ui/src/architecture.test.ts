// Архитектурные границы состояния (CHAT-236).
//
// Правила проверяются автоматически, потому что нарушить их легко и незаметно:
// один «удобный» импорт соседнего домена возвращает связность, ради избавления
// от которой и разбирался глобальный стор.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')
const DOMAINS = join(SRC, 'store', 'domains')

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!['.ts', '.tsx'].includes(extname(entry.name))) return []
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx') || entry.name.endsWith('.stories.tsx')) return []
    return [path]
  })
}

/** Только доменные хранилища (без их тестов). */
function domainStores(): string[] {
  return sourceFiles(DOMAINS)
}

function read(file: string): string {
  return readFileSync(file, 'utf8')
}

/** Импортируемые модули файла (`import ... from '<path>'` и `import('<path>')`). */
function imports(source: string): string[] {
  return [...source.matchAll(/from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
    (m) => m[1] ?? m[2]
  )
}

const DOMAIN_NAMES = [
  'shellStore',
  'sessionStore',
  'settingsStore',
  'chatStore',
  'voiceStore',
  'operationsStore',
  'projectsStore'
]

describe('границы доменных хранилищ', () => {
  it('перечисленные домены существуют и других файлов в каталоге нет', () => {
    const found = domainStores().map((f) => relative(DOMAINS, f).replace(/\.ts$/, ''))
    expect([...found].sort()).toEqual([...DOMAIN_NAMES].sort())
  })

  it('хранилища не импортируют друг друга', () => {
    const violations: string[] = []
    for (const file of domainStores()) {
      const self = relative(DOMAINS, file).replace(/\.ts$/, '')
      for (const spec of imports(read(file))) {
        const other = DOMAIN_NAMES.find((name) => name !== self && spec.endsWith(name))
        if (other) violations.push(`${relative(SRC, file)} → ${spec}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('хранилища не знают ни React, ни транспорта, ни window', () => {
    const forbidden: Array<[RegExp, string]> = [
      [/from\s+['"]react(?:-dom)?['"]/, 'React'],
      [/\bwindow\s*\./, 'window.*'],
      [/\bfetch\s*\(/, 'fetch'],
      [/\bnew\s+WebSocket\b/, 'WebSocket'],
      [/\bEventSource\s*\(/, 'EventSource'],
      [/from\s+['"]electron['"]/, 'electron'],
      [/\blocalStorage\b/, 'localStorage'],
      [/\bdocument\s*\./, 'document']
    ]
    const violations: string[] = []
    for (const file of [...domainStores(), join(SRC, 'store', 'createStore.ts')]) {
      const source = read(file)
      for (const [pattern, label] of forbidden) {
        if (pattern.test(source)) violations.push(`${relative(SRC, file)}: ${label}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('доменные клиенты не импортируют UI-компоненты', () => {
    const violations: string[] = []
    for (const file of sourceFiles(join(SRC, 'clients'))) {
      for (const spec of imports(read(file))) {
        if (/components\//.test(spec) || /@voicechat\/ui-kit/.test(spec)) {
          violations.push(`${relative(SRC, file)} → ${spec}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('AppRuntime не хранит доменных данных и не даёт универсального setState', () => {
    const source = read(join(SRC, 'runtime', 'appRuntime.ts'))
    expect(source).not.toMatch(/createStoreCore/)
    expect(source).not.toMatch(/setState\s*[(:]/)
  })

  it('компоненты не лезут во внутренности хранилищ', () => {
    const violations: string[] = []
    for (const file of sourceFiles(join(SRC, 'components'))) {
      for (const spec of imports(read(file))) {
        if (/store\/(domains|createStore)/.test(spec)) violations.push(`${relative(SRC, file)} → ${spec}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('глобальный voiceStore и временный legacy-фасад удалены', () => {
    expect(existsSync(join(SRC, 'store', 'voiceStore.ts'))).toBe(false)
    expect(existsSync(join(SRC, 'store', 'useVoiceStore.ts'))).toBe(false)
    const violations: string[] = []
    for (const file of sourceFiles(SRC)) {
      // Тестовый харнесс живёт в src/test и в приложение не попадает.
      if (relative(SRC, file).startsWith('test/')) continue
      const source = read(file)
      if (/useVoiceStore|legacyVoiceStoreFacade/.test(source)) violations.push(relative(SRC, file))
    }
    expect(violations).toEqual([])
  })

  it('между доменами нет циклов через runtime-порты', () => {
    // Домен разговаривает с соседом только через порт, который выдаёт runtime:
    // ни один store не импортирует ни runtime, ни React-биндинг.
    const violations: string[] = []
    for (const file of domainStores()) {
      for (const spec of imports(read(file))) {
        if (/runtime\//.test(spec) || /store\/react/.test(spec)) violations.push(`${relative(SRC, file)} → ${spec}`)
      }
    }
    expect(violations).toEqual([])
  })
})

