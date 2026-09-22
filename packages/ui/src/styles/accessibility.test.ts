// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const app = readFileSync(fileURLToPath(new URL('./app.css', import.meta.url)), 'utf8')
it.each(['./app.css', '../../../admin-app/src/styles.css'])('%s uses the shared 720px mobile boundary', path => {
  const css = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
  const boundaries = [...css.matchAll(/@media\s*\((min|max)-width:\s*(\d+)px\)/g)]
  expect(boundaries.length).toBeGreaterThan(0)
  for (const [, kind, width] of boundaries) expect(Number(width)).toBe(kind === 'max' ? 720 : 721)
})

// @testCase TC-01
it('keeps one constrained project-settings scroll surface through the application shell', () => {
  const normalized = app.replace(/\s+/g, ' ')
  for (const selector of ['.app-content', '.toolpage', '.widget-assistant', '.widget-assistant-widget', '.project-settings-form']) {
    const body = normalized.match(new RegExp('\\' + selector + '\\s*\\{([^}]*)\\}'))?.[1] ?? ''
    expect(body.replace(/\s+/g, ''), selector).toContain('min-height:0')
  }
  expect(normalized).toContain('.widget-assistant-widget > * { flex: 1 1 auto; min-width: 0; min-height: 0; }')
  expect(normalized).toContain('.project-settings-content { flex: 1 1 auto; min-width: 0; min-height: 0; max-width: 100%; overflow-x: hidden; overflow-y: auto;')
  expect(normalized).toContain('.project-settings-form .proj-detail { flex: 1 1 auto; min-height: 0; overflow: hidden; }')
})

// @testCase TC-08
it('retains the mobile safe area and horizontal tab contract', () => {
  const normalized = app.replace(/\s+/g, ' ')
  expect(normalized).toContain('padding: 2px 4px calc(var(--space-4) + env(safe-area-inset-bottom)) 0')
  expect(normalized).toContain('overflow-x: auto; overflow-y: hidden')
})
