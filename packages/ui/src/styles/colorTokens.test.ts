// Сторож цвета в `app.css`.
//
// Два класса ошибок, которые не видит ни typecheck, ни jsdom (там нет каскада),
// ни `cssTokens.test.ts` (он ловит только `var(--x)` **без** фолбэка):
//
// 1. `var(--неизвестная, #fff)` — переменная не объявлена нигде, поэтому фолбэк
//    срабатывает всегда, и поверхность не следует теме. Так жили `--card-bg`
//    (семь мест: меню карточки, попапы фильтров, диалог автоматизации оставались
//    белыми в тёмной теме), `--bg-soft`, `--text-soft`, `--hover`, `--fg`, `--mono`.
// 2. `rgba(128, 128, 128, …)` и `rgba(127, 127, 127, …)` — «серый на глазок»
//    вместо токена. На светлом фоне он читается, на тёмном почти исчезает:
//    подзадача переставала выглядеть строкой списка, рамка панели деталей
//    пропадала, а разделители секций проекта исчезали вовсе.
//
// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP_CSS = fileURLToPath(new URL('./app.css', import.meta.url))
const css = readFileSync(APP_CSS, 'utf8')
const stylesDir = fileURLToPath(new URL('.', import.meta.url))
const uiKitDir = fileURLToPath(new URL('../../../ui-kit/src', import.meta.url))
const uiSrc = fileURLToPath(new URL('..', import.meta.url))

/** Всё, что объявлено в CSS или ставится из JS (в том числе из ui-kit). */
function declaredNames(): Set<string> {
  const names = new Set<string>()
  const addCss = (file: string): void => {
    for (const match of readFileSync(file, 'utf8').matchAll(/(--[a-z0-9-]+)\s*:/g)) names.add(match[1])
  }
  for (const name of readdirSync(stylesDir)) if (name.endsWith('.css')) addCss(join(stylesDir, name))
  addCss(join(uiKitDir, 'styles.css'))
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
  walk(uiKitDir)
  return names
}

/** Селекторы канбана и карточки задачи. */
const KANBAN = /\bjmodal|\bjcard|\bjlabel|\bjcol|\bjboard|\bjswimlane|\bjlane|\bjfilter|\bjautomation|\bjprio|\bjavatar|\bjcompose|\bjquick|\bkanban-/

function offendingLines(pattern: RegExp, scope?: RegExp): string[] {
  return css.split('\n')
    .map((line, index) => ({ line, at: index + 1 }))
    .filter(({ line }) => pattern.test(line) && (!scope || scope.test(line)))
    .map(({ line, at }) => `${at}: ${line.trim().slice(0, 120)}`)
}

describe('цвет в app.css', () => {
  it('не тянет неизвестную переменную, прикрывшись фолбэком', () => {
    const declared = declaredNames()
    const missing: string[] = []
    css.split('\n').forEach((line, index) => {
      for (const match of line.matchAll(/var\(\s*(--[a-z0-9-]+)\s*,/g)) {
        if (!declared.has(match[1])) missing.push(`${index + 1}: ${match[1]}`)
      }
    })
    expect(missing).toEqual([])
  })

  it('не красит серым «на глазок» вместо токенов темы', () => {
    expect(offendingLines(/rgba\(\s*12[78]\s*,\s*12[78]\s*,\s*12[78]/)).toEqual([])
  })

  // Правила канбана держали 35 hex-цветов и 22 парных `[data-theme='dark']`
  // переопределения к ним — ровно то, что AGENTS.md пакета запрещает: «не хватает
  // токена — добавь его в `:root` и в тёмную тему, а не хардкодь цвет в правиле».
  // Пара «светлый hex + тёмный hex» вдобавок разъезжается: правят одну половину.
  it('канбан и карточка задачи не хардкодят hex-цвет', () => {
    expect(offendingLines(/#[0-9a-fA-F]{3,8}\b/, KANBAN)).toEqual([])
  })

  it('канбан и карточка задачи не переопределяют цвет под тёмную тему', () => {
    expect(offendingLines(/data-theme/, KANBAN)).toEqual([])
  })
})
