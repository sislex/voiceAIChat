import fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { isPreviewProbeResult, type PreviewAction, type PreviewActionResultMessage, type PreviewAuditOptions, type PreviewAuditResult } from '@voicechat/shared'
import { registerPreviewProxy } from '../apps/web-reader/src/routes/previewProxy.js'
import { auditFixtures, probeFixtures, probeExpectationFailures, formConstraintExamples, formReadOnlyScene, formReadOnlySetup, formReadOnlyState, focusComparisonExamples, focusReadOnlyScene, focusReadOnlySetup, focusReadOnlyState, focusOrderScene, type FormFixtureEdit } from '@voicechat/browser-contracts/audit/fixtures'

let app: FastifyInstance, browser: Browser, page: Page, base: string, source = ''
async function open(html: string) {
  source = html
  await page.goto(base + '/host')
  await page.frameLocator('iframe').locator('#voicechat-preview-inspector').waitFor({ state: 'attached' })
}
async function editFixture(edit?: FormFixtureEdit) {
  if (!edit) return
  await page.frameLocator('iframe').locator(edit.selector).focus()
  await page.keyboard.type(edit.text)
  if (edit.after) await page.frames().find(frame => frame.url().includes('/api/preview?'))!.evaluate(edit.after)
}
async function perform(action: PreviewAction) {
  const message = await page.evaluate(action => new Promise<PreviewActionResultMessage>((resolve, reject) => {
    const frame = document.querySelector('iframe')!.contentWindow!, requestId = crypto.randomUUID()
    const timer = setTimeout(() => { removeEventListener('message', receive); reject(new Error('Audit reply timed out')) }, 5000)
    const receive = (event: MessageEvent) => {
      if (event.source !== frame || event.origin !== location.origin || event.data?.requestId !== requestId || event.data.type !== 'voicechat.preview.action-result.v1') return
      clearTimeout(timer); removeEventListener('message', receive); resolve(event.data)
    }
    addEventListener('message', receive)
    frame.postMessage({ type: 'voicechat.preview.action.v1', requestId, action }, location.origin)
  }), action)
  if (!message.ok) throw new Error(message.error)
  return message.result
}
async function audit(options: PreviewAuditOptions = {}): Promise<PreviewAuditResult['audit']> {
  return ((await perform({ kind: 'audit', ...options })) as PreviewAuditResult).audit
}
async function probe(selector = '#target') {
  const result = await perform({ kind: 'probe', selector })
  if (!isPreviewProbeResult(result)) throw new Error('Invalid proxy probe result: '+JSON.stringify(result))
  expect(result.probe.surface).toBe('proxy')
  return result.probe
}

describe('Web Reader built-in diagnostics in Chromium', () => {
  beforeAll(async () => {
    app = fastify()
    app.addHook('onRequest', async req => { (req as unknown as { user: object }).user = { name: 'audit-e2e', role: 'user' } })
    app.get('/host', async (_req, reply) => reply.type('text/html').send('<!doctype html><title>Web Reader audit fixture</title><iframe style="width:1100px;height:700px;border:0" src="/api/preview?url=http%3A%2F%2Faudit.machine.internal%3A5173%2F"></iframe>'))
    registerPreviewProxy(app, { machines: { canUse: async () => true, bridge: { isOnline: () => true, http: async () => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, bodyBase64: Buffer.from(source).toString('base64') }) } } })
    base = await app.listen({ host: '127.0.0.1', port: 0 })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    page.setDefaultTimeout(5000)
  })
  afterAll(async () => { await browser?.close(); await app?.close() })

  for (const fixture of probeFixtures) for (const state of ['condition', 'comparison'] as const) {
    it(`probes ${fixture.name}: ${state}`, async () => {
      await open(fixture[state].html)
      const report = await probe()
      expect(probeExpectationFailures(report, fixture[state].expect)).toEqual([])
    })
  }
  it.each([
    '<button id="target" hidden style="display:block" onclick="this.dataset.clicked=\'yes\'"></button>',
    '<section style="visibility:hidden"><button id="target" style="visibility:visible" onclick="this.dataset.clicked=\'yes\'"></button></section>'
  ])('reads and activates controls made visible by CSS overrides (%#)', async body => {
    await open('<!doctype html>'+body)
    expect((await audit({ rules: ['button-name-missing'] })).total).toBe(1)
    await perform({ kind: 'click', selector: '#target' })
    expect(await page.frameLocator('iframe').locator('#target').getAttribute('data-clicked')).toBe('yes')
  })
  it('still excludes hidden and fully transparent controls from semantic audit names', async () => {
    await open('<!doctype html><button hidden></button><section style="opacity:0"><button style="opacity:1"></button></section>')
    expect((await audit({ rules: ['button-name-missing'] })).total).toBe(0)
  })
  it('refreshes control state and pointer blockers without changing the page', async () => {
    await open('<!doctype html><button id="target" disabled>Save</button>')
    expect((await probe()).state.nativeDisabled).toBe(true)
    await page.frameLocator('iframe').locator('#target').evaluate(el => { (el as HTMLButtonElement).disabled = false; (el as HTMLElement).style.pointerEvents = 'none' })
    const report = await probe()
    expect(report.state.nativeDisabled).toBe(false)
    expect(report.pointer.status).toBe('blocked')
    expect(report.reasons.map(reason => reason.code)).toContain('pointer-events-none')
  })
  it('attributes nested fieldset disabling to the actual outer cause', async () => {
    await open('<!doctype html><fieldset id="outer" disabled><fieldset id="inner" disabled><legend><button id="target">Save</button></legend></fieldset></fieldset>')
    const report = await probe()
    expect(report.state.nativeDisabled).toBe(true)
    expect(report.reasons.find(reason => reason.code === 'disabled-fieldset')?.selector).toBe('#outer')
  })
  it('keeps samples for fixed descendants that escape an overflow ancestor', async () => {
    await open('<!doctype html><div style="overflow:hidden;width:20px;height:20px"><button id="target" style="position:fixed;left:200px;top:200px">Save</button></div>')
    expect((await probe()).pointer.status).toBe('reachable')
  })
  it('rejects missing, ambiguous and malformed probe selectors', async () => {
    await open('<!doctype html><button>One</button><button>Two</button>')
    await expect(probe('#missing')).rejects.toThrow('exactly one')
    await expect(probe('button')).rejects.toThrow('exactly one')
    await expect(probe('[')).rejects.toThrow()
  })
  it('reports bounded incomplete probe geometry, ancestors and source selectors', async () => {
    await open('<!doctype html><section style="opacity:0">'+'<div>'.repeat(150)+'<button id="target">Save</button>'+'</div>'.repeat(150)+'</section>')
    const deep = await probe()
    expect(deep.truncated).toBe(true)
    expect(deep.visibility.effectiveOpacity).toBe(null)
    expect(deep.visibility.visibleByBrowser).toBe(false)
    await open('<!doctype html><div style="width:25px"><a id="target" href="#">'+'word '.repeat(100)+'</a></div>')
    const wrapped = await probe()
    expect(wrapped.truncated).toBe(true)
    expect(wrapped.visibility.rectangles).toHaveLength(8)
    expect(wrapped.pointer.points.length).toBeLessThanOrEqual(40)
    await open('<!doctype html><section inert id="'+'X'.repeat(650)+'"><button id="target">Save</button></section>')
    const long = await probe()
    expect(long.truncated).toBe(true)
    expect(long.reasons.every(reason => (reason.selector?.length ?? 0) <= 500)).toBe(true)
    expect(JSON.stringify(long).length).toBeLessThan(26000)
  })
  it('probes preserve focus, text selection, DOM, scroll and sensitive values', async () => {
    await open('<!doctype html><style>body{height:1600px}</style><input id="target" type="password" value="probe-secret"><p id="text">Selected text</p>')
    const frame = page.frames().find(frame => frame.url().includes('/api/preview?'))!
    await frame.evaluate(() => { document.querySelector<HTMLInputElement>('#target')!.focus(); const range = document.createRange(); range.selectNodeContents(document.querySelector('#text')!); getSelection()!.removeAllRanges(); getSelection()!.addRange(range); scrollTo(0, 100) })
    const snapshot = () => frame.evaluate(() => ({ html: document.documentElement.outerHTML, focus: document.activeElement?.id, selection: getSelection()?.toString(), scrollY, value: document.querySelector<HTMLInputElement>('#target')!.value }))
    const before = await snapshot(), report = await probe()
    expect(JSON.stringify(report)).not.toContain('probe-secret')
    expect(await snapshot()).toEqual(before)
  })
  it('captures a visible control whose pointer input is intercepted', async () => {
    await open('<!doctype html><html lang="en"><head><title>Control probe evidence</title><style>body{font:18px/1.5 system-ui;background:#edf2f8;padding:32px}main{background:white;border-radius:16px;padding:32px;max-width:760px}section{border-top:1px solid #dce4ee;padding:20px 0}button{width:220px;height:52px;font:inherit;border:1px solid #5276ad;border-radius:8px;background:#e7efff}.stack{position:relative;width:220px;height:52px}#overlay{position:absolute;inset:0;background:rgba(180,35,50,.22);border:2px dashed #ae2434;display:grid;place-items:center;color:#831b29;font-weight:bold}</style></head><body><main><h1>Control probe: interaction evidence</h1><section><h2>Visible but intercepted</h2><div class="stack"><button id="blocked">Save changes</button><div id="overlay">Overlay intercepts input</div></div><p>The probe identifies the element receiving pointer input.</p></section><section><h2>Reachable control</h2><button id="ready">Save changes</button><p>Pointer reachability is separate from disabled or read-only state.</p></section></main></body></html>')
    const blocked = await probe('#blocked'), ready = await probe('#ready')
    expect(blocked.visibility.visibleByBrowser).toBe(true)
    expect(blocked.pointer.status).toBe('blocked')
    expect(blocked.pointer.hitTargets.map(hit => hit.selector)).toContain('#overlay')
    expect(ready.pointer.status).toBe('reachable')
    if (process.env.VC_VISUAL_ARTIFACTS) {
      await mkdir(process.env.VC_VISUAL_ARTIFACTS, { recursive: true })
      await page.screenshot({ path: resolve(process.env.VC_VISUAL_ARTIFACTS, 'cycle-05-probe.png'), fullPage: true })
    }
  })

  it.each(formConstraintExamples)('preserves form semantics: $name', async example => {
    await open('<!doctype html>'+example.html)
    expect((await audit({ group: 'forms', rules: [example.rule] })).total).toBe(example.total)
  })
  it('reports bounded form inspection rather than rejecting oversized patterns', async () => {
    await open('<!doctype html><input pattern="'+'a'.repeat(4097)+'">')
    const report = await audit({ group: 'forms', rules: ['pattern-syntax-invalid'] })
    expect(report.total).toBe(0)
    expect(report.truncated).toBe(true)
    expect(report.limitations).toContain('Form constraint inspection stopped at 4096 attribute characters.')
  })
  it('discovers 30 form checks and classifies validity as observed state', async () => {
    await open('<!doctype html><input required>')
    const catalog = await audit({ group: 'forms', mode: 'list', limit: 30 })
    expect(catalog.rules).toHaveLength(30)
    const validity = catalog.rules.filter(rule => rule.id.startsWith('validity-'))
    expect(validity).toHaveLength(10)
    expect(validity.every(rule => rule.severity === 'info' && rule.confidence === 'observed')).toBe(true)
  })
  it.each(focusComparisonExamples)('preserves focus semantics: %s', async (_name, html, rule, total) => {
    await open('<!doctype html>'+html)
    expect((await audit({ group: 'focus', rules: [rule] })).total).toBe(total)
  })
  it('discovers 26 focus reports and makes their heuristic status explicit', async () => {
    await open('<!doctype html><input>')
    const report = await audit({ group: 'focus', mode: 'list', limit: 30 })
    expect(report.rules).toHaveLength(26)
    expect(report.rules.every(rule => rule.confidence === 'heuristic')).toBe(true)
  })
  it('bounds focus metadata inspection without declaring a malformed value', async () => {
    await open('<!doctype html><input tabindex="'+'1'.repeat(1025)+'">')
    const report = await audit({ group: 'focus', rules: ['tabindex-syntax-invalid'] })
    expect(report.total).toBe(0)
    expect(report.truncated).toBe(true)
    expect(report.limitations).toContain('Focus metadata inspection stopped at 1024 attribute characters.')
  })
  it('excludes radio groups from order estimates and explains incomplete traversal', async () => {
    await open('<!doctype html><div style="display:flex;flex-direction:row-reverse"><input type="radio" name="choice"><input type="radio" name="choice"></div>')
    const report = await audit({ group: 'focus', rules: ['focus-flex-order-reversed'] })
    expect(report.total).toBe(0)
    expect(report.truncated).toBe(true)
    expect(report.limitations).toContain('Focus order estimates exclude native radio-group traversal; run a keyboard scenario.')
  })
  it('reports depth, order and relationship inspection limits', async () => {
    await open('<!doctype html>'+'<div>'.repeat(150)+'<input id="target">'+'</div>'.repeat(150)+'<script>document.querySelector("#target").focus()</script>')
    const opacity = await audit({ group: 'focus', rules: ['focused-opacity-zero'] })
    expect(opacity.truncated).toBe(true)
    expect(opacity.limitations).toContain('Focus opacity inspection stopped at 128 ancestors.')
    await open('<!doctype html><div style="display:flex">'+'<button>Action</button>'.repeat(101)+'</div>')
    const order = await audit({ group: 'focus', rules: ['focus-flex-order-reversed'] })
    expect(order.truncated).toBe(true)
    expect(order.limitations).toContain('Focus order inspection stopped at 100 direct children.')
    await open('<!doctype html><input id="target" aria-activedescendant="option" aria-controls="'+'missing '.repeat(65)+'"><div id="option">Choice</div><script>document.querySelector("#target").focus()</script>')
    const relation = await audit({ group: 'focus', rules: ['active-descendant-unrelated'] })
    expect(relation.truncated).toBe(true)
    expect(relation.limitations).toContain('Focus relationship inspection stopped at 64 ID references.')
  })
  for (const fixture of auditFixtures) {
    it(`detects ${fixture.name ?? fixture.rule}`, async () => {
      await open(fixture.broken)
      await editFixture(fixture.edit?.broken)
      if (fixture.ready) await page.frames().find(frame => frame.url().includes('/api/preview?'))!.waitForFunction(fixture.ready)
      const report = await audit({ group: fixture.group, rules: [fixture.rule] })
      expect(report.checkedRules).toBe(1)
      expect(report.findings.length).toBeGreaterThan(0)
      expect(report.findings.every(f => f.id === fixture.rule && f.selector && f.evidence)).toBe(true)
    })
    it(`clears ${fixture.name ?? fixture.rule} after repair`, async () => {
      await open(fixture.fixed)
      await editFixture(fixture.edit?.fixed)
      if (fixture.ready) await page.frames().find(frame => frame.url().includes('/api/preview?'))!.waitForFunction(fixture.ready)
      expect((await audit({ group: fixture.group, rules: [fixture.rule] })).findings).toEqual([])
    })
  }
  it('discovers all 30 rules and paginates findings without losing their total', async () => {
    await open('<!doctype html><body><main>' + '<button></button>'.repeat(35) + '</main></body>')
    const catalog = await audit({ mode: 'list', limit: 30 })
    expect(catalog.rules).toHaveLength(30)
    expect(catalog.groups).toContain('markup')
    expect(new Set(catalog.rules.map(r => r.id)).size).toBe(30)
    const first = await audit({ rules: ['button-name-missing'], limit: 10 })
    const second = await audit({ rules: ['button-name-missing'], limit: 10, offset: first.nextOffset })
    expect(first.total).toBe(35)
    expect(second.nextOffset).toBe(20)
    expect(new Set([...first.findings, ...second.findings].map(f => f.selector)).size).toBe(20)
    expect(first.surface).toBe('proxy')
    expect(first.limitations.length).toBeGreaterThan(0)
  })
  it('scopes findings and rejects ambiguous scope and unknown checks', async () => {
    await open('<!doctype html><body><section id="clean"><button>Named</button></section><section><button></button></section></body>')
    expect((await audit({ selector: '#clean', rules: ['button-name-missing'] })).total).toBe(0)
    await expect(audit({ selector: 'section' })).rejects.toThrow('exactly one')
    await expect(audit({ rules: ['made-up-rule'] })).rejects.toThrow('Unknown')
  })
  it('identifies each duplicate-ID sibling with an unambiguous selector', async () => {
    await open('<!doctype html><body><button id="same">One</button><button id="same">Two</button></body>')
    const report = await audit({ rules: ['duplicate-id'] })
    expect(new Set(report.findings.map(f => f.selector)).size).toBe(2)
    for (const finding of report.findings) expect(await page.frameLocator('iframe').locator(finding.selector).count()).toBe(1)
  })
  it('discovers 30 layout checks and captures visible clipping evidence', async () => {
    await open('<!doctype html><html lang="en"><head><title>Layout audit evidence</title><style>body{font:18px system-ui;background:#edf2f8;padding:32px}main{background:white;border-radius:16px;padding:32px;max-width:760px}.card{width:240px;height:100px;overflow:hidden;border:2px solid #b45309;padding:12px}.wide{width:440px;background:#fef3c7;padding:16px}.fixed{margin-top:20px;width:440px;max-width:100%;border:2px solid #15803d;padding:16px}</style></head><body><main><h1>Layout audit: visible evidence</h1><h2>Clipped content</h2><div class="card" id="clipped"><div class="wide">This content extends beyond the card edge.</div></div><h2>Repaired container</h2><div class="fixed">This content fits within its container.</div></main></body></html>')
    expect((await audit({ group: 'layout', mode: 'list', limit: 30 })).rules).toHaveLength(30)
    expect((await audit({ group: 'layout', rules: ['clipped-horizontal-content'] })).findings.map(f=>f.selector)).toContain('#clipped')
    if (process.env.VC_VISUAL_ARTIFACTS) {
      await mkdir(process.env.VC_VISUAL_ARTIFACTS, { recursive: true })
      await page.screenshot({ path: resolve(process.env.VC_VISUAL_ARTIFACTS, 'cycle-02-layout.png'), fullPage: true })
    }
  })
  it('reports incomplete scans and keeps returned payload bounded', async () => {
    await open('<!doctype html><body>' + '<button></button>'.repeat(3100) + '</body>')
    const report = await audit({ rules: ['button-name-missing'], limit: 30 })
    expect(report.scannedElements).toBe(3000)
    expect(report.truncated).toBe(true)
    expect(JSON.stringify(report).length).toBeLessThan(27000)
  })
  it('does not include sensitive field values in audit evidence', async () => {
    await open('<!doctype html><body><input type="password" value="never-report-this"><input name="token" value="nor-this"></body>')
    for (const group of ['markup', 'layout', 'typography', 'color', 'forms', 'focus']) {
      const report = JSON.stringify(await audit({ group }))
      expect(report).not.toContain('never-report-this')
      expect(report).not.toContain('nor-this')
    }
  })
  it('observes form validity without reading values, firing invalid or changing the page', async () => {
    await open(formReadOnlyScene)
    const frame = page.frames().find(candidate => candidate.url().includes('/api/preview?'))!
    await frame.evaluate(formReadOnlySetup)
    const before = await frame.evaluate(formReadOnlyState)
    const report = await audit({ group: 'forms', limit: 30 })
    expect(report.findings.map(f => f.id)).toContain('validity-custom-error')
    expect(JSON.stringify(report)).not.toContain('PRIVATE_')
    expect(await frame.evaluate(formReadOnlyState)).toEqual(before)
  })
  it('refreshes validity after the application clears a custom error', async () => {
    await open(formReadOnlyScene)
    const options = { group: 'forms', rules: ['validity-custom-error'] }
    expect((await audit(options)).total).toBe(1)
    await page.frameLocator('iframe').locator('#target').evaluate(el => (el as HTMLInputElement).setCustomValidity(''))
    expect((await audit(options)).total).toBe(0)
  })
  it('observes focus without value reads, focus events or page mutations', async () => {
    await open(focusReadOnlyScene)
    const frame = page.frames().find(candidate => candidate.url().includes('/api/preview?'))!
    await frame.evaluate(focusReadOnlySetup)
    const before = await frame.evaluate(focusReadOnlyState)
    const report = await audit({ group: 'focus', limit: 30 })
    expect(report.findings.map(f => f.id)).toContain('focused-caret-transparent')
    expect(JSON.stringify(report)).not.toContain('PRIVATE_')
    expect(await frame.evaluate(focusReadOnlyState)).toEqual(before)
  })
  it('reports when active-element findings belong to an unfocused frame', async () => {
    await open(focusReadOnlyScene)
    const frame = page.frames().find(candidate => candidate.url().includes('/api/preview?'))!
    await frame.locator('#target').focus()
    await page.evaluate(() => { const hostInput = document.createElement('input'); document.body.append(hostInput); hostInput.focus() })
    expect(await frame.evaluate(() => document.hasFocus())).toBe(false)
    expect((await audit({ group: 'focus' })).limitations).toContain('This document does not currently own keyboard focus; active-element findings describe its retained focus target.')
  })
  it('compares estimated visual order with actual Tab navigation and a repair', async () => {
    await open(focusOrderScene)
    const options = { group: 'focus', rules: ['focus-flex-order-reversed'] }
    const frame = page.frames().find(candidate => candidate.url().includes('/api/preview?'))!
    expect((await audit(options)).total).toBe(1)
    await frame.locator('#first').focus()
    await page.keyboard.press('Tab')
    expect(await frame.evaluate(() => document.activeElement?.id)).toBe('second')
    await page.keyboard.press('Shift+Tab')
    expect(await frame.evaluate(() => document.activeElement?.id)).toBe('first')
    await frame.locator('#row').evaluate(el => { (el as HTMLElement).style.flexDirection = 'row' })
    expect((await audit(options)).total).toBe(0)
  })
  it('captures current keyboard focus and verifies the same live repair', async () => {
    await open('<!doctype html><html lang="en"><head><title>Focus audit evidence</title><style>body{font:16px/1.4 system-ui;background:#edf2f8;padding:20px;color:#172033}main{background:white;border-radius:16px;padding:28px;max-width:760px}h1{font-size:28px;margin:0 0 20px}h2{font-size:20px;margin:0 0 12px}section{border-top:1px solid #dce4ee;padding:20px 0}input{display:block;width:320px;padding:12px;margin:12px 0;font:inherit;border:1px solid #8b99ae;border-radius:6px}button{padding:12px;font:inherit;border:1px solid #8b99ae;background:#edf2f8;border-radius:6px}#row{display:flex;flex-direction:row-reverse;gap:12px;justify-content:flex-end}</style></head><body><main><h1>Focus audit: current keyboard state</h1><section><h2>Focused text field</h2><label>Project name<input id="target" value="Reader QA" style="outline:none;caret-color:transparent"></label><p>The audit inspects the current focus outline and caret color.</p></section><section><h2>Visual order and keyboard order</h2><div id="row"><button>First in DOM</button><button>Second in DOM</button></div><p>Compare the displayed sequence with actual Tab navigation.</p></section></main></body></html>')
    const frame = page.frames().find(candidate => candidate.url().includes('/api/preview?'))!
    await frame.locator('#target').focus()
    const options = { group: 'focus', rules: ['focus-paint-needs-review', 'focused-caret-transparent', 'focus-flex-order-reversed'] }
    expect((await audit(options)).findings.map(f => f.id)).toEqual(options.rules)
    if (process.env.VC_VISUAL_ARTIFACTS) {
      await mkdir(process.env.VC_VISUAL_ARTIFACTS, { recursive: true })
      await page.screenshot({ path: resolve(process.env.VC_VISUAL_ARTIFACTS, 'cycle-07-focus-before.png'), fullPage: true })
    }
    await frame.locator('#target').evaluate(el => { (el as HTMLElement).style.outline = '3px solid #225dcc'; (el as HTMLElement).style.caretColor = 'black' })
    await frame.locator('#row').evaluate(el => { (el as HTMLElement).style.flexDirection = 'row' })
    expect((await audit(options)).total).toBe(0)
    expect(await frame.evaluate(() => document.activeElement?.id)).toBe('target')
    if (process.env.VC_VISUAL_ARTIFACTS) await page.screenshot({ path: resolve(process.env.VC_VISUAL_ARTIFACTS, 'cycle-07-focus-after.png'), fullPage: true })
  })
  it('captures form configuration and native validation evidence', async () => {
    await open('<!doctype html><html lang="en"><head><title>Form audit evidence</title><style>body{font:16px/1.4 system-ui;background:#edf2f8;padding:20px;color:#172033}main{background:white;border-radius:16px;padding:24px;max-width:760px}h1{font-size:28px;margin:0 0 20px}h2{font-size:20px;margin:0 0 8px}p{margin:8px 0}section{border-top:1px solid #dce4ee;padding:12px 0}input{display:block;width:200px;padding:8px;margin-top:4px;font:inherit;border:1px solid #5276ad;border-radius:8px}.error{color:#a31c2f}code{background:#edf2f8;padding:2px 6px}</style></head><body><main><h1>Form audit: state and configuration</h1><section><h2>Conflicting configuration</h2><label>Quantity<input id="reversed" type="number" min="10" max="2"></label><p class="error">Minimum 10 exceeds maximum 2.</p></section><section><h2>Current validation state</h2><label>Email<input id="invalid" type="email" value="not-an-email" aria-invalid="true"></label><p>The browser reports <code>typeMismatch</code>; review the application error flow.</p></section><section><h2>Repaired configuration</h2><label>Quantity<input id="repaired" type="number" min="2" max="10" value="4"></label></section></main></body></html>')
    expect((await audit({ group: 'forms', rules: ['range-constraints-reversed'] })).findings.map(f => f.selector)).toEqual(['#reversed'])
    expect((await audit({ group: 'forms', rules: ['validity-type-mismatch'] })).findings.map(f => f.selector)).toEqual(['#invalid'])
    if (process.env.VC_VISUAL_ARTIFACTS) {
      await mkdir(process.env.VC_VISUAL_ARTIFACTS, { recursive: true })
      await page.screenshot({ path: resolve(process.env.VC_VISUAL_ARTIFACTS, 'cycle-06-forms.png'), fullPage: true })
    }
  })
  it('reads changed text and styles without reusing a previous audit snapshot', async () => {
    await open('<!doctype html><p id="live" style="font-size:8px">Hello {{ user.name }}</p>')
    const options = { group: 'typography', rules: ['small-font-text', 'raw-template-expression'] }
    expect((await audit(options)).total).toBe(2)
    await page.frameLocator('iframe').locator('#live').evaluate(el => { el.textContent = 'Hello Alex'; (el as HTMLElement).style.fontSize = '16px' })
    expect((await audit(options)).findings).toEqual([])
  })
  it.each([
    ['"My, serif, Demo"', 1],
    ['"My, serif, Demo", sans-serif', 0],
    ['"sans-serif"', 1],
    ['"My \\"quoted\\", serif, Family"', 1],
    ['Arial, ui-sans-serif', 0]
  ])('parses the rendered font stack %s', async (font, count) => {
    await open('<!doctype html><p id="font">Font stack</p>')
    const accepted = await page.frameLocator('iframe').locator('#font').evaluate((el, value) => { (el as HTMLElement).style.fontFamily = value; return (el as HTMLElement).style.fontFamily }, String(font))
    expect(accepted).not.toBe('')
    expect((await audit({ group: 'typography', selector: '#font', rules: ['font-generic-fallback-missing'] })).total).toBe(count)
  })
  it('marks oversized font stacks incomplete without guessing their fallback', async () => {
    await open('<!doctype html><p id="font">Font stack</p>')
    await page.frameLocator('iframe').locator('#font').evaluate(el => { (el as HTMLElement).style.fontFamily = 'F'.repeat(4200)+', sans-serif' })
    const report = await audit({ group: 'typography', selector: '#font', rules: ['font-generic-fallback-missing'] })
    expect(report.truncated).toBe(true)
    expect(report.limitations).toContain('Font stack inspection stopped at 4096 characters.')
    expect(report.findings).toEqual([])
  })
  it('reports typography scan limits instead of claiming a complete result', async () => {
    await open('<!doctype html><p>'+'a'.repeat(4200)+'</p><p>'+'<!-- spacer -->'.repeat(300)+'{{ missed }}</p>')
    const report = await audit({ group: 'typography', rules: ['raw-template-expression'] })
    expect(report.truncated).toBe(true)
    expect(report.limitations).toContain('Text scan stopped at 4096 direct characters on an element.')
    expect(report.limitations).toContain('Text scan stopped at 256 child nodes on an element.')
  })
  it('discovers typography checks and captures unreadable and repaired text', async () => {
    await open('<!doctype html><html lang="en"><head><title>Typography audit evidence</title><style>body{font:18px/1.5 system-ui;background:#edf2f8;padding:32px}main{background:white;border-radius:16px;padding:32px;max-width:760px}.broken{font-size:8px;letter-spacing:-1px;width:240px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.fixed{font-size:18px;max-width:600px}section{border-top:1px solid #dce4ee;padding:16px 0}</style></head><body><main><h1>Typography audit: visible evidence</h1><section><h2>Unreadable text</h2><p class="broken">This deliberately tiny and tightly spaced text is difficult to read and loses its meaning when clipped.</p></section><section><h2>Repaired text</h2><p class="fixed">This text uses readable sizing, natural spacing, and wrapping within its container.</p></section></main></body></html>')
    expect((await audit({ group: 'typography', mode: 'list', limit: 30 })).rules).toHaveLength(30)
    expect((await audit({ group: 'typography', rules: ['small-font-text'] })).findings).toHaveLength(1)
    if (process.env.VC_VISUAL_ARTIFACTS) {
      await mkdir(process.env.VC_VISUAL_ARTIFACTS, { recursive: true })
      await page.screenshot({ path: resolve(process.env.VC_VISUAL_ARTIFACTS, 'cycle-03-typography.png'), fullPage: true })
    }
  })
  it.each(['x-private', 'i-klingon', 'en-GB-oed', 'zh-min-nan'])('accepts valid legacy or private-use language %s', async lang => {
    await open('<!doctype html><html lang="' + lang + '"><head><title>Language fixture</title></head><body></body></html>')
    expect((await audit({ rules: ['document-language-invalid'] })).findings).toEqual([])
  })
  it('recognizes browser-provided submit and reset labels', async () => {
    await open('<!doctype html><body><input type="submit"><input type="reset"></body>')
    expect((await audit({ rules: ['button-name-missing'] })).findings).toEqual([])
  })
  it('captures a visible fixture with detected and repaired controls', async () => {
    await open('<!doctype html><html lang="en"><head><title>Markup audit evidence</title><style>body{font:18px system-ui;background:#edf2f8;padding:36px;color:#172033}main{max-width:760px;background:white;border-radius:16px;padding:32px}button{padding:12px 22px;min-width:80px;min-height:44px;border:1px solid #5276ad;border-radius:8px;background:#e7efff}section{padding:20px 0;border-top:1px solid #dce4ee}input{padding:12px;border:1px solid #5276ad;border-radius:8px}h1{margin-top:0}</style></head><body><main><h1>Markup audit: visible evidence</h1><section><h2>Missing button name</h2><button id="unnamed"></button><p>The audit identifies this selector and its missing name.</p></section><section><h2>Repaired control</h2><label for="name">Display name</label> <input id="name"><button>Save profile</button></section></main></body></html>')
    const report = await audit({ rules: ['button-name-missing'] })
    expect(report.findings.map(f => f.selector)).toEqual(['#unnamed'])
    if (process.env.VC_VISUAL_ARTIFACTS) {
      await mkdir(process.env.VC_VISUAL_ARTIFACTS, { recursive: true })
      await page.screenshot({ path: resolve(process.env.VC_VISUAL_ARTIFACTS, 'cycle-01-markup.png'), fullPage: true })
    }
  })
  it.each(['input', 'textarea', 'button'])('observes live configured %s colors without reading field values', async tag => {
    await open('<!doctype html><style>body{background:white}input,textarea,button{background:white}</style><'+tag+' id="target" style="color:#ccc">'+(tag==='input'?'':'Sample</'+tag+'>'))
    const options = { group: 'color', selector: '#target', rules: ['text-contrast-low'] }
    expect((await audit(options)).total).toBe(1)
    await page.frameLocator('iframe').locator('#target').evaluate(el => { (el as HTMLElement).style.color = 'black' })
    expect((await audit(options)).total).toBe(0)
  })
  it('reports unknown generated-text paint even when only the incomplete rule is selected', async () => {
    await open('<!doctype html><style>body{background:white}.sample::before{content:"Generated";background:linear-gradient(white,black)}</style><div class="sample"></div>')
    const report = await audit({ group: 'color', rules: ['color-inspection-incomplete'] })
    expect(report.findings[0].evidence).toMatch(/::before:.*gradient/)
  })
  it('composes custom selection colors through ancestor opacity', async () => {
    await open('<!doctype html><style>body{background:white}::selection{background:white;color:black}</style><section style="opacity:.3"><p>Selection</p></section>')
    expect((await audit({ group: 'color', rules: ['selection-contrast-low'] })).total).toBe(1)
  })
  it('does not reuse one SVG shape opacity for another shape with the same fill', async () => {
    await open('<!doctype html><style>body{background:white}</style><svg role="img" aria-label="Status" width="100" height="40"><rect id="faint" width="40" height="40" fill="black" fill-opacity=".2"/><rect id="solid" x="50" width="40" height="40" fill="black"/></svg>')
    expect((await audit({ group: 'color', rules: ['svg-icon-contrast-low'] })).findings.map(f => f.selector)).toEqual(['#faint'])
  })
  it('marks limited paint and text discovery incomplete', async () => {
    await open('<!doctype html><style>body{background:white}</style>'+'<section>'.repeat(70)+'<p id="deep">Deep text</p>'+'</section>'.repeat(70))
    const deep = await audit({ group: 'color', selector: '#deep', rules: ['color-inspection-incomplete'] })
    expect(deep.truncated).toBe(true)
    expect(deep.findings[0].evidence).toContain('64 layers')
    await open('<!doctype html><style>body{background:white}</style><p>'+' '.repeat(4200)+'Hidden suffix</p><p>'+'<!-- spacer -->'.repeat(300)+'Later text</p>')
    const text = await audit({ group: 'color', rules: ['text-contrast-low'] })
    expect(text.truncated).toBe(true)
    expect(text.limitations).toContain('Color text discovery inspected only the first 4096 characters of a text node.')
    expect(text.limitations).toContain('Color text discovery stopped after 256 child nodes on an element.')
  })
  it('does not change focus, selection, scroll or DOM while estimating colors', async () => {
    await open('<!doctype html><style>body{background:white;height:1600px}</style><button id="focus">Focus</button><p id="text" style="color:#ccc">Low contrast</p>')
    const frame = page.frames().find(frame => frame.url().includes('/api/preview?'))!
    await frame.evaluate(() => {
      document.querySelector<HTMLButtonElement>('#focus')!.focus()
      const range = document.createRange(); range.selectNodeContents(document.querySelector('#text')!)
      getSelection()!.removeAllRanges(); getSelection()!.addRange(range)
      scrollTo(0, 100)
    })
    const observe = () => frame.evaluate(() => ({ html: document.documentElement.outerHTML, focus: document.activeElement?.id, selection: getSelection()?.toString(), scrollY }))
    const before = await observe()
    await audit({ group: 'color' })
    expect(await observe()).toEqual(before)
  })
  it('discovers color report types and captures contrast evidence', async () => {
    await open('<!doctype html><html lang="en"><head><title>Contrast audit evidence</title><style>body{font:18px/1.5 system-ui;background:#edf2f8;padding:32px}main{background:white;border-radius:16px;padding:32px;max-width:760px}section{border-top:1px solid #dce4ee;padding:16px 0}.low{color:#c4c4c4}.good{color:#172033}.unknown{background:linear-gradient(90deg,#edf2f8,#5276ad);color:#222;padding:20px}</style></head><body><main><h1>Contrast audit: paint evidence</h1><section><h2>Low contrast</h2><p class="low" id="low">This pale text is difficult to read on white.</p></section><section><h2>Repaired contrast</h2><p class="good">This dark text has strong contrast on white.</p></section><section><h2>Needs pixel review</h2><p class="unknown" id="unknown">A gradient needs more than one flat color estimate.</p></section></main></body></html>')
    const catalog = await audit({ group: 'color', mode: 'list', limit: 30 })
    expect(catalog.rules).toHaveLength(9)
    expect(catalog.limitations.join(' ')).toContain('8-bit sRGB')
    expect((await audit({ group: 'color', rules: ['text-contrast-low'] })).findings.map(f => f.selector)).toContain('#low')
    expect((await audit({ group: 'color', rules: ['color-inspection-incomplete'] })).findings.map(f => f.selector)).toContain('#unknown')
    if (process.env.VC_VISUAL_ARTIFACTS) {
      await mkdir(process.env.VC_VISUAL_ARTIFACTS, { recursive: true })
      await page.screenshot({ path: resolve(process.env.VC_VISUAL_ARTIFACTS, 'cycle-04-color.png'), fullPage: true })
    }
  })
})
