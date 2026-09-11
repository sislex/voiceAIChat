import { describe, expect, it } from 'vitest'
import { planModelAction } from './browserActions'
import { isPreviewAction } from './previewActions'
import {
  isPreviewAccessibilityOptions, isPreviewAccessibilityResult,
  type PreviewAccessibilityResult
} from './previewAccessibility'

const report = (): PreviewAccessibilityResult => ({
  page: { url: 'https://example.test/', title: 'Example' },
  accessibility: {
    version: 1, surface: 'chromium', source: 'chromium-accessibility', selector: '#field',
    node: {
      role: 'combobox', name: 'Choice', description: 'Instructions', ignored: false,
      properties: [
        { name: 'focusable', value: true },
        { name: 'expanded', value: false },
        { name: 'controls', related: [{ selector: '#popup', idref: 'popup' }] }
      ],
      nameSources: [{ type: 'relatedElement', attribute: 'aria-labelledby', related: [{ selector: '#label', idref: 'label' }] }],
      ignoredReasons: []
    },
    truncated: false, elapsedMs: 1.25,
    limitations: ['One native node is not a complete assistive-technology scenario.']
  }
})

describe('native accessibility contract', () => {
  it.each([null, [], {}, { selector: '' }, { selector: ' ' }, { selector: 3 }, { selector: 'x'.repeat(1001) }, { selector: '#x', frame: '#child' }, { selector: '#x', code: 'secret()' }])('rejects invalid options %j', value => {
    expect(isPreviewAccessibilityOptions(value)).toBe(false)
  })

  it('accepts a bounded target and routes a read-only native inspection', () => {
    const action = { kind: 'accessibility' as const, selector: '#field', diagnostic: true }
    expect(isPreviewAction(action)).toBe(true)
    expect(planModelAction(action)).toEqual({ kind: 'command', command: { type: 'inspect', action: { kind: 'accessibility', selector: '#field' } } })
    expect(isPreviewAccessibilityOptions({ selector: 'x'.repeat(1000) })).toBe(true)
  })

  it('accepts whitelisted scalars, absent states and bounded relationships', () => {
    expect(isPreviewAccessibilityResult(report())).toBe(true)
    const absent = report()
    absent.accessibility.node.properties = []
    absent.accessibility.node.nameSources = []
    absent.accessibility.node.ignoredReasons = [{ reason: 'notRendered', related: [{ selector: '#parent' }] }]
    absent.accessibility.truncated = true
    expect(isPreviewAccessibilityResult(absent)).toBe(true)
  })

  it.each([
    (r: PreviewAccessibilityResult) => { (r.accessibility as unknown as Record<string, unknown>).value = 'secret' },
    (r: PreviewAccessibilityResult) => { (r.accessibility.node as unknown as Record<string, unknown>).value = 'secret' },
    (r: PreviewAccessibilityResult) => { (r.accessibility.node.nameSources[0] as unknown as Record<string, unknown>).attributeValue = 'secret' },
    (r: PreviewAccessibilityResult) => { r.accessibility.node.properties[0].name = 'password' as never },
    (r: PreviewAccessibilityResult) => { r.accessibility.node.properties.push({ name: 'focusable', value: false }) },
    (r: PreviewAccessibilityResult) => { r.accessibility.node.properties[0].value = Number.NaN },
    (r: PreviewAccessibilityResult) => { r.accessibility.node.properties[2] = { name: 'controls' } },
    (r: PreviewAccessibilityResult) => { r.accessibility.node.nameSources = Array(13).fill(r.accessibility.node.nameSources[0]) },
    (r: PreviewAccessibilityResult) => { r.accessibility.node.ignoredReasons = Array(17).fill({ reason: 'hidden' }) },
    (r: PreviewAccessibilityResult) => { r.accessibility.node.properties[2].related![0].selector = 'x'.repeat(501) },
    (r: PreviewAccessibilityResult) => { r.accessibility.elapsedMs = -1 }
  ])('rejects unsupported, duplicate, unsafe or unbounded evidence (%#)', mutate => {
    const value = report(); mutate(value)
    expect(isPreviewAccessibilityResult(value)).toBe(false)
  })

  it('rejects partial, cyclic and oversized evidence', () => {
    expect(isPreviewAccessibilityResult({ accessibility: { version: 1 } })).toBe(false)
    const oversized = report(); oversized.accessibility.node.name = 'x'.repeat(1001)
    expect(isPreviewAccessibilityResult(oversized)).toBe(false)
    const cyclic = report() as PreviewAccessibilityResult & { cycle?: unknown }; cyclic.cycle = cyclic
    expect(isPreviewAccessibilityResult(cyclic)).toBe(false)
  })
})
