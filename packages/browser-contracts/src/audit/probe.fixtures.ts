import type { PreviewProbeResult } from '@voicechat/shared'

type Probe = PreviewProbeResult['probe']
export interface ProbeExpectation {
  state?: Partial<Probe['state']>
  visibility?: Partial<Omit<Probe['visibility'], 'rectangles'>>
  pointer?: Pick<Probe['pointer'], 'status'>
  reasons?: string[]
  absentReasons?: string[]
  minRectangles?: number
  mixedPoints?: boolean
  hitSelectors?: string[]
}
export interface ProbeScene { html: string; expect: ProbeExpectation }
export interface ProbeFixture { name: string; condition: ProbeScene; comparison: ProbeScene }

const document = (body: string) => '<!doctype html><html lang="en"><head><title>Control probe fixture</title><style>body{margin:20px;background:white;font:16px Arial,sans-serif}button{width:160px;height:40px}</style></head><body>'+body+'</body></html>'
const normal = '<button id="target">Save</button>'
const clear: ProbeExpectation = { pointer: { status: 'reachable' }, visibility: { visibleByBrowser: true }, state: { nativeDisabled: false, inert: false, nativeReadOnly: false } }
const pair = (name: string, body: string, expected: ProbeExpectation, comparison = normal, comparisonExpected = clear): ProbeFixture => ({ name, condition: { html: document(body), expect: expected }, comparison: { html: document(comparison), expect: comparisonExpected } })
const fixedButton = '<button id="target" style="position:fixed;left:20px;top:20px">Save</button>'

/** Each pair distinguishes a browser mechanism from a useful comparison state. */
export const probeFixtures: ProbeFixture[] = [
  pair('pointer interception and blocker selector', fixedButton+'<div id="cover" style="position:fixed;left:20px;top:20px;width:160px;height:40px;background:white;z-index:10"></div>', { pointer: { status: 'blocked' }, reasons: ['pointer-intercepted'], hitSelectors: ['#cover'] }, fixedButton),
  pair('reachable samples around a covered center', fixedButton+'<div style="position:fixed;left:90px;top:20px;width:20px;height:40px;background:white;z-index:10"></div>', { pointer: { status: 'reachable' }, mixedPoints: true }, fixedButton, { ...clear, mixedPoints: false }),
  pair('clipped target sample region', '<div style="width:40px;height:40px;overflow:hidden"><button id="target" style="margin-left:35px">Save</button></div>', { pointer: { status: 'reachable' }, mixedPoints: true }),
  pair('partially offscreen usable portion', '<button id="target" style="position:fixed;left:-120px;top:20px">Save</button>', { pointer: { status: 'reachable' }, visibility: { inViewport: true } }, '<button id="target" style="position:fixed;left:-200px;top:20px">Save</button>', { pointer: { status: 'offscreen' }, visibility: { inViewport: false } }),
  pair('wrapped inline link rectangles', '<div style="width:80px"><a id="target" href="#">First second third fourth</a></div>', { pointer: { status: 'reachable' }, minRectangles: 2 }, '<a id="target" href="#">First second third fourth</a>'),
  pair('target pointer events disabled', '<button id="target" style="pointer-events:none">Save</button>', { pointer: { status: 'blocked' }, reasons: ['pointer-events-none'] }),
  pair('descendant restores pointer events', '<section style="pointer-events:none"><button id="target" style="pointer-events:auto">Save</button></section>', { pointer: { status: 'reachable' }, reasons: ['pointer-events-restored'] }, '<section style="pointer-events:none">'+normal+'</section>', { pointer: { status: 'blocked' }, reasons: ['pointer-events-none'] }),
  pair('direct native disabled state', '<button id="target" disabled>Save</button>', { state: { nativeDisabled: true }, reasons: ['native-disabled'] }),
  pair('disabled fieldset inheritance', '<fieldset disabled>'+normal+'</fieldset>', { state: { nativeDisabled: true }, reasons: ['disabled-fieldset'] }, '<fieldset>'+normal+'</fieldset>'),
  pair('first legend exemption', '<fieldset disabled><legend>'+normal+'</legend></fieldset>', { state: { nativeDisabled: false }, reasons: ['first-legend-exemption'] }, '<fieldset disabled><legend>Legend</legend>'+normal+'</fieldset>', { state: { nativeDisabled: true }, reasons: ['disabled-fieldset'] }),
  pair('declared ARIA disabled is distinct from native state', '<button id="target" aria-disabled="true">Save</button>', { state: { ariaDisabled: true, nativeDisabled: false }, reasons: ['aria-disabled-declared'] }, normal, { ...clear, state: { ariaDisabled: false, nativeDisabled: false } }),
  pair('inert ancestor source', '<section inert>'+normal+'</section>', { state: { inert: true }, pointer: { status: 'blocked' }, reasons: ['inert-ancestor'] }),
  pair('modal blocks the background document', normal+'<dialog>Modal</dialog><script>document.querySelector("dialog").showModal()</script>', { state: { inert: true }, pointer: { status: 'blocked' }, reasons: ['modal-background-blocked'] }),
  pair('modal escapes ancestor inertness', '<section inert><dialog>'+normal+'</dialog></section><script>document.querySelector("dialog").showModal()</script>', { state: { inert: false }, pointer: { status: 'reachable' }, reasons: ['modal-escapes-inert'] }, '<section inert>'+normal+'</section>', { state: { inert: true }, pointer: { status: 'blocked' } }),
  pair('readonly text input', '<input id="target" readonly>', { state: { nativeReadOnly: true }, reasons: ['native-readonly'] }, '<input id="target">'),
  pair('readonly textarea', '<textarea id="target" readonly>Content</textarea>', { state: { nativeReadOnly: true }, reasons: ['native-readonly'] }, '<textarea id="target">Content</textarea>'),
  pair('readonly ignored on an incompatible input type', '<input id="target" type="checkbox" readonly>', { state: { ignoredReadOnly: true, nativeReadOnly: false }, reasons: ['readonly-attribute-ignored'] }, '<input id="target" type="text" readonly>', { state: { ignoredReadOnly: false, nativeReadOnly: true }, reasons: ['native-readonly'] }),
  pair('inherited contenteditable state', '<div contenteditable><p id="target">Content</p></div>', { state: { contentEditable: true }, reasons: ['contenteditable-inherited'] }, '<div><p id="target">Content</p></div>', { state: { contentEditable: false } }),
  pair('non-editable island', '<div contenteditable><p id="target" contenteditable="false">Content</p></div>', { state: { contentEditable: false }, reasons: ['contenteditable-false-island'] }, '<div contenteditable><p id="target">Content</p></div>', { state: { contentEditable: true } }),
  pair('display suppression', '<section style="display:none">'+normal+'</section>', { visibility: { visibleByBrowser: false, hasBox: false }, reasons: ['display-none'] }),
  pair('computed hidden visibility', '<button id="target" style="visibility:hidden">Save</button>', { visibility: { visibleByBrowser: false }, reasons: ['visibility-hidden'] }),
  pair('visible descendant of hidden ancestor', '<section style="visibility:hidden"><button id="target" style="visibility:visible">Save</button></section>', { visibility: { visibleByBrowser: true }, pointer: { status: 'reachable' }, reasons: ['visibility-overridden'] }, '<section style="visibility:hidden">'+normal+'</section>', { visibility: { visibleByBrowser: false } }),
  pair('zero ancestor opacity', '<section style="opacity:0">'+normal+'</section>', { visibility: { visibleByBrowser: false, effectiveOpacity: 0 }, reasons: ['transparent-ancestor'] }),
  pair('low effective opacity stays distinct from hidden', '<section style="opacity:.1">'+normal+'</section>', { visibility: { visibleByBrowser: true, effectiveOpacity: .1 }, reasons: ['low-effective-opacity'] }),
  pair('content visibility suppression', '<section style="content-visibility:hidden">'+normal+'</section>', { visibility: { visibleByBrowser: false }, reasons: ['content-visibility-hidden'] }),
  pair('skipped automatic content rendering', '<section style="content-visibility:auto;contain-intrinsic-size:200px;margin-top:5000px">'+normal+'</section>', { visibility: { visibleByBrowser: false }, reasons: ['content-visibility-auto-skipped'] }, '<section style="content-visibility:auto;contain-intrinsic-size:200px">'+normal+'</section>'),
  pair('closed details hides its content', '<details><summary>Expand</summary>'+normal+'</details>', { visibility: { visibleByBrowser: false }, reasons: ['closed-details-content'] }, '<details open><summary>Expand</summary>'+normal+'</details>'),
  pair('closed details keeps its first summary usable', '<details><summary id="target">Expand</summary><p>Content</p></details>', { pointer: { status: 'reachable' }, visibility: { visibleByBrowser: true }, reasons: ['closed-details-summary'] }, '<details><summary>Expand</summary>'+normal+'</details>', { visibility: { visibleByBrowser: false }, reasons: ['closed-details-content'] }),
  pair('closed dialog rendering', '<dialog>'+normal+'</dialog>', { visibility: { visibleByBrowser: false }, reasons: ['closed-dialog'] }, '<dialog open>'+normal+'</dialog>'),
  pair('CSS overrides the HTML hidden attribute', '<button id="target" hidden style="display:block">Save</button>', { visibility: { visibleByBrowser: true }, pointer: { status: 'reachable' }, reasons: ['hidden-attribute-overridden'] }, '<button id="target" hidden>Save</button>', { visibility: { visibleByBrowser: false }, absentReasons: ['hidden-attribute-overridden'] })
]

/** Share fixture assertions without introducing a test runner into the fixture entry point. */
export function probeExpectationFailures(probe: Probe, expected: ProbeExpectation): string[] {
  const failures: string[] = []
  for (const field of ['state', 'visibility', 'pointer'] as const) {
    for (const [key, value] of Object.entries(expected[field] ?? {})) {
      const actual = (probe[field] as unknown as Record<string, unknown>)[key]
      if (!Object.is(actual, value)) failures.push(`${field}.${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(actual)}`)
    }
  }
  const reasons = probe.reasons.map(reason => reason.code)
  for (const code of expected.reasons ?? []) if (!reasons.includes(code)) failures.push('Missing reason: '+code)
  for (const code of expected.absentReasons ?? []) if (reasons.includes(code)) failures.push('Unexpected reason: '+code)
  for (const selector of expected.hitSelectors ?? []) if (!probe.pointer.hitTargets.some(hit => hit.selector === selector)) failures.push('Missing hit target: '+selector)
  if (expected.minRectangles !== undefined && probe.visibility.rectangles.length < expected.minRectangles) failures.push('Missing inline client rectangles')
  const mixed = probe.pointer.points.some(point => point.reachesTarget) && probe.pointer.points.some(point => !point.reachesTarget)
  if (expected.mixedPoints !== undefined && mixed !== expected.mixedPoints) failures.push('Unexpected mixed pointer reachability: '+mixed)
  return failures
}

/** Small transport fixture; actual browser behavior is exercised by the scene pairs above. */
export function probeResultFixture(surface: 'proxy' | 'chromium' = 'proxy'): PreviewProbeResult {
  return {
    page: { url: 'https://example.test/', title: 'Probe fixture' },
    probe: {
      version: 1, surface, selector: '#target', tag: 'button',
      visibility: { hasBox: true, visibleByBrowser: true, effectiveOpacity: 1, inViewport: true, rectangles: [{ left: 10, top: 10, right: 110, bottom: 50 }] },
      state: { nativeDisabled: false, ariaDisabled: false, inert: false, nativeReadOnly: false, ariaReadOnly: false, ignoredReadOnly: false, contentEditable: false },
      pointer: { status: 'reachable', points: [{ x: 60, y: 30, reachesTarget: true, hitIndex: 0 }], hitTargets: [{ selector: '#target', tag: 'button' }] },
      reasons: [], truncated: false, elapsedMs: 1, limitations: ['This fixture does not execute an interaction.']
    }
  }
}
