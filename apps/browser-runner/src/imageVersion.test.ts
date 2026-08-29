// Версия пакета `playwright` и тег образа в Dockerfile обязаны совпадать точно.
//
// Образ Playwright приносит сборку браузера под свою версию. Пакет с диапазоном
// `^1.54.2` разъехался до 1.62.1 и стал искать `chromium_headless_shell-1234`,
// тогда как в образе лежал `-1181`: сборка проходила, контейнер стартовал,
// health отвечал «ок», а первая же сессия падала с «Executable doesn't exist».
// Прод-релиз 0.1.189 встал именно на этом.
//
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
const dockerfile = readFileSync(fileURLToPath(new URL('../../../Dockerfile', import.meta.url)), 'utf8')

describe('образ браузерного раннера', () => {
  const declared = pkg.dependencies?.playwright ?? pkg.devDependencies?.playwright ?? ''

  it('версия playwright закреплена точно, без диапазона', () => {
    expect(declared).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('тег образа совпадает с версией пакета', () => {
    const tag = /mcr\.microsoft\.com\/playwright:v([\d.]+)-\w+/.exec(dockerfile)?.[1]
    expect(tag).toBe(declared)
  })
})
