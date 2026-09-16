// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { cssRules } from '@voicechat/ui-foundation/test/cssRules'

const kit = readFileSync(fileURLToPath(new URL('../../../ui-kit/src/styles.css', import.meta.url)), 'utf8')
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
  const css = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
  const boundaries = [...css.matchAll(/@media\s*\((min|max)-width:\s*(\d+)px\)/g)]
  expect(boundaries.length).toBeGreaterThan(0)
  for (const [, kind, width] of boundaries) expect(Number(width)).toBe(kind === 'max' ? 720 : 721)
})
