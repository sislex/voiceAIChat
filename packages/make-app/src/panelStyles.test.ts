import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { cssRules } from '@voicechat/ui-foundation/test/cssRules'
const { decl, atRuleBodies } = cssRules(
  readFileSync(new URL('./panel.css', import.meta.url), 'utf8')
)
it('ограничивает MakePane split-контейнером и оставляет внутренний скролл', () => {
  expect(decl('.make-pane', 'max-width')).toBe('100%')
  expect(decl('.make-pane', 'min-height')).toBe('0')
  expect(decl('.make-pane', 'height')).toBe('100%')
  expect(decl('.make-pane', 'overflow')).toBe('hidden')
  for (const selector of ['.make-preview', '.make-code', '.make-history']) {
    expect(decl(selector, 'min-width'), selector).toBe('0')
    expect(decl(selector, 'min-height'), selector).toBe('0')
    expect(decl(selector, 'overflow'), selector).toBe('hidden')
  }
  expect(decl('.make-frame-host', 'overflow')).toBe('auto')
  expect(decl('.make-tree', 'overflow')).toBe('auto')
  expect(decl('.make-snapshots', 'overflow')).toBe('auto')
})

it('панель адаптирует минимум ширины на телефоне', () => {
  expect(atRuleBodies('@media (max-width: 768px)').join('\n')).toMatch(
    /\.make-pane\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0/s
  )
})

it('mobile скрывает неактивную панель', () => {
  expect(atRuleBodies('@media (max-width: 768px)').join('\n')).toMatch(
    /\.chat-split--chat \.make-pane\s*\{[^}]*display:\s*none/s
  )
})
