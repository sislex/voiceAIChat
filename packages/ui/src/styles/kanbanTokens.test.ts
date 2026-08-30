// Сторож цвета в стилях канбана и карточки задачи.
//
// Два класса ошибок, которые не видит ни typecheck, ни jsdom (там нет каскада),
// ни `cssTokens.test.ts` (он ловит только `var(--x)` **без** фолбэка):
//
// 1. `var(--card-bg, #fff)` — переменная `--card-bg` не была объявлена нигде, и
//    фолбэк срабатывал всегда. В тёмной теме меню карточки, попап фильтра и
//    диалог автоматизации оставались белыми.
// 2. `rgba(128, 128, 128, …)` — «серый на глазок» вместо токена. На светлом фоне
//    он читается, на тёмном почти исчезает: подзадача переставала выглядеть
//    строкой списка, а рамка панели деталей пропадала.
//
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const APP_CSS = fileURLToPath(new URL('./app.css', import.meta.url))
/** Селекторы канбана и карточки задачи. */
const KANBAN = /jmodal|jcard|jlabel|jcol|jswimlane|jfilter|jautomation|kanban-card|task-tab|task-preparation|task-timeline|task-improvement|vc-feed/

function offendingLines(pattern: RegExp): string[] {
  return readFileSync(APP_CSS, 'utf8')
    .split('\n')
    .map((line, index) => ({ line, at: index + 1 }))
    .filter(({ line }) => pattern.test(line) && KANBAN.test(line))
    .map(({ line, at }) => `${at}: ${line.trim().slice(0, 120)}`)
}

describe('цвет в стилях канбана и карточки задачи', () => {
  it('не тянет неопределённую переменную с hex-фолбэком', () => {
    // `--card-bg` больше нет ни в одном файле — не только в правилах канбана.
    expect(readFileSync(APP_CSS, 'utf8')).not.toContain('--card-bg')
  })

  it('не красит серым «на глазок» вместо токенов темы', () => {
    expect(offendingLines(/rgba\(\s*128\s*,\s*128\s*,\s*128/)).toEqual([])
  })
})
