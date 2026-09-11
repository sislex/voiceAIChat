import fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { PreviewActionResultMessage, PreviewAuditOptions, PreviewAuditResult } from '@voicechat/shared'
import { registerPreviewProxy } from '../apps/web-reader/src/routes/previewProxy.js'
import { auditFixtures } from '@voicechat/browser-contracts/audit/fixtures'

let app: FastifyInstance, browser: Browser, page: Page, base: string, source = ''
async function open(html: string) {
  source = html
  await page.goto(base + '/host')
  await page.frameLocator('iframe').locator('#voicechat-preview-inspector').waitFor({ state: 'attached' })
}
async function audit(options: PreviewAuditOptions = {}): Promise<PreviewAuditResult['audit']> {
  const message = await page.evaluate(options => new Promise<PreviewActionResultMessage>((resolve, reject) => {
    const frame = document.querySelector('iframe')!.contentWindow!, requestId = crypto.randomUUID()
    const timer = setTimeout(() => { removeEventListener('message', receive); reject(new Error('Audit reply timed out')) }, 5000)
    const receive = (event: MessageEvent) => {
      if (event.source !== frame || event.origin !== location.origin || event.data?.requestId !== requestId || event.data.type !== 'voicechat.preview.action-result.v1') return
      clearTimeout(timer); removeEventListener('message', receive); resolve(event.data)
    }
    addEventListener('message', receive)
    frame.postMessage({ type: 'voicechat.preview.action.v1', requestId, action: { kind: 'audit', ...options } }, location.origin)
  }), options)
  if (!message.ok) throw new Error(message.error)
  return (message.result as PreviewAuditResult).audit
}

describe('Web Reader markup audit in Chromium', () => {
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

  for (const fixture of auditFixtures) {
    it(`detects ${fixture.name ?? fixture.rule}`, async () => {
      await open(fixture.broken)
      if (fixture.ready) await page.frames().find(frame => frame.url().includes('/api/preview?'))!.waitForFunction(fixture.ready)
      const report = await audit({ group: fixture.group, rules: [fixture.rule] })
      expect(report.checkedRules).toBe(1)
      expect(report.findings.length).toBeGreaterThan(0)
      expect(report.findings.every(f => f.id === fixture.rule && f.selector && f.evidence)).toBe(true)
    })
    it(`clears ${fixture.name ?? fixture.rule} after repair`, async () => {
      await open(fixture.fixed)
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
    for (const group of ['markup', 'layout', 'typography', 'color']) {
      const report = JSON.stringify(await audit({ group }))
      expect(report).not.toContain('never-report-this')
      expect(report).not.toContain('nor-this')
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
