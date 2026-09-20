import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { cssRules } from '@voicechat/ui-foundation/test/cssRules'

const kit = readFileSync(fileURLToPath(new URL('../../../ui-kit/src/styles.css', import.meta.url)), 'utf8')
const app = readFileSync(fileURLToPath(new URL('./app.css', import.meta.url)), 'utf8')
it('disables all CSS motion, including pseudo-elements, on reduced-motion devices', () => {
  const reduced = cssRules(kit).atRuleBodies('@media (prefers-reduced-motion: reduce)').join('\n')
  expect(reduced).toContain('*, *::before, *::after')
  expect(reduced).toContain('animation:none !important')
  expect(reduced).toContain('transition:none !important')
  expect(reduced).toContain('scroll-behavior:auto !important')
})
it('keeps a visible keyboard ring and 40px touch targets in the shared kit', () => {
  expect(kit).toContain(':focus-visible { outline:2px solid var(--accent) !important;outline-offset:2px }')
  const mobile = cssRules(kit).atRuleBodies('@media (max-width: 720px)').join('\n')
  expect(mobile).toContain('min-height:40px !important;min-width:40px !important')
})
it.each(['./app.css', '../../../ui-kit/src/styles.css', '../../../admin-app/src/styles.css', '../../../profile-app/src/styles.css', '../../../sessions-app/src/styles.css'])('%s uses the shared 720px mobile boundary', path => {
  const external = /\.\.\/\.\.\/\.\.\/(profile-app|sessions-app)\//.exec(path)?.[1]
  const css = readFileSync(external ? require.resolve('@sislexa/identity/'+external+'/styles.css') : fileURLToPath(new URL(path, import.meta.url)), 'utf8')
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
