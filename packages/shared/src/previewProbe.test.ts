import { describe, expect, it } from 'vitest'
import { isPreviewAction } from './previewActions'
import { planModelAction } from './browserActions'
import { isPreviewProbeOptions, isPreviewProbeResult, type PreviewProbeResult } from './previewProbe'

const report = (): PreviewProbeResult => ({
  page: { url: 'https://example.test/', title: 'Example' },
  probe: {
    version: 1, surface: 'chromium', selector: '#save', tag: 'button',
    visibility: { hasBox: true, visibleByBrowser: true, effectiveOpacity: 1, inViewport: true, rectangles: [{ left: 10, top: 10, right: 110, bottom: 50 }] },
    state: { nativeDisabled: true, ariaDisabled: false, inert: false, nativeReadOnly: false, ariaReadOnly: false, ignoredReadOnly: false, contentEditable: false },
    pointer: { status: 'reachable', points: [{ x: 60, y: 30, reachesTarget: true, hitIndex: 0 }], hitTargets: [{ selector: '#save', tag: 'button' }] },
    reasons: [{ code: 'native-disabled', selector: '#save' }], truncated: false, elapsedMs: 1, limitations: ['Observation does not activate the control.']
  }
})

describe('control probe contract', () => {
  it.each([null, [], {}, { selector: '' }, { selector: ' ' }, { selector: 3 }, { selector: 'x'.repeat(1001) }])('rejects an invalid target %j', value => {
    expect(isPreviewProbeOptions(value)).toBe(false)
  })
  it('accepts an exact bounded selector and routes a built-in observation', () => {
    const action = { kind: 'probe' as const, selector: '#save', diagnostic: true }
    expect(isPreviewAction(action)).toBe(true)
    expect(planModelAction(action)).toEqual({ kind: 'command', command: { type: 'inspect', action: { kind: 'probe', selector: '#save' } } })
    expect(isPreviewProbeOptions({ selector: 'x'.repeat(1000) })).toBe(true)
    expect(isPreviewAction({ ...action, frame: '#child' })).toBe(false)
    expect(planModelAction({ ...action, frame: '#child' }).kind).toBe('unsupported')
  })
  it('allows a hit-testable disabled control without claiming activation succeeds', () => {
    expect(isPreviewProbeResult(report())).toBe(true)
    const partial = report()
    partial.probe.truncated = true
    partial.probe.visibility.effectiveOpacity = null
    partial.probe.visibility.visibleByBrowser = null
    partial.probe.state.inert = null
    expect(isPreviewProbeResult(partial)).toBe(true)
  })
  it.each([
    (r: PreviewProbeResult) => { r.probe.pointer.points[0].hitIndex = 1 },
    (r: PreviewProbeResult) => { r.probe.pointer.points[0].x = NaN },
    (r: PreviewProbeResult) => { r.probe.visibility.rectangles[0].right = Infinity },
    (r: PreviewProbeResult) => { r.probe.visibility.effectiveOpacity = 2 },
    (r: PreviewProbeResult) => { r.probe.elapsedMs = -1 },
    (r: PreviewProbeResult) => { r.probe.pointer.points = Array(41).fill(r.probe.pointer.points[0]) },
    (r: PreviewProbeResult) => { r.probe.pointer.hitTargets = Array(9).fill(r.probe.pointer.hitTargets[0]) },
    (r: PreviewProbeResult) => { r.probe.reasons = Array(31).fill(r.probe.reasons[0]) },
    (r: PreviewProbeResult) => { r.probe.reasons[0].selector = 'x'.repeat(501) }
  ])('rejects invalid geometry, references or bounds (%#)', mutate => {
    const value = report(); mutate(value)
    expect(isPreviewProbeResult(value)).toBe(false)
  })
  it('rejects partial, coercible, cyclic and oversized reports', () => {
    expect(isPreviewProbeResult({ probe: { version: 1, surface: 'chromium' } })).toBe(false)
    expect(isPreviewProbeResult({ ...report(), probe: { ...report().probe, surface: { toString: () => 'chromium' } } })).toBe(false)
    expect(isPreviewProbeResult({ ...report(), extra: 'x'.repeat(26000) })).toBe(false)
    const cyclic = report() as PreviewProbeResult & { cycle?: unknown }; cyclic.cycle = cyclic
    expect(isPreviewProbeResult(cyclic)).toBe(false)
  })
})
