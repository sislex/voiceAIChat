import Fastify, { type FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { auditFixtures, probeFixtures, probeExpectationFailures, formConstraintExamples, formReadOnlyScene, formReadOnlySetup, formReadOnlyState, type FormFixtureEdit } from '@voicechat/browser-contracts/audit/fixtures'
import { isPreviewProbeResult } from '@voicechat/shared'
import type { BrowserCommand, BrowserInspectResult, BrowserSelectorResult, BrowserSessionMetadata, PreviewAuditOptions } from '@voicechat/shared'
import { BrowserSessionManager } from './sessionManager.js'

let site: FastifyInstance, manager: BrowserSessionManager, session: BrowserSessionMetadata, root: string, source = ''
const target = 'http://audit.reader.test/'
const send = (command: BrowserCommand, actor: 'user' | 'assistant' = 'assistant') => manager.command(session.id, { requestId: randomUUID(), incarnation: session.incarnation, actor, command })
const open = async (html: string) => { source = html; await send({ type: 'navigate', url: target }) }
const editFixture = async (edit?: FormFixtureEdit) => {
  if (!edit) return
  expect(await send({ type: 'selector', action: { kind: 'click', selector: edit.selector } })).toMatchObject({ ok: true })
  expect(await send({ type: 'input', action: { type: 'type', text: edit.text } })).toMatchObject({ state: 'ready' })
  if (edit.after) expect(await send({ type: 'inspect', action: { kind: 'evaluate', code: edit.after } })).toMatchObject({ ok: true })
}
const audit = async (options: PreviewAuditOptions = {}) => {
  const result = await send({ type: 'inspect', action: { kind: 'audit', ...options } }) as BrowserInspectResult
  expect(result.ok, result.error).toBe(true)
  expect(result.audit?.surface).toBe('chromium')
  expect(result.page?.url).toBe(target)
  return result.audit!
}
const probe = async (selector = '#target') => {
  const result = await send({ type: 'inspect', action: { kind: 'probe', selector } }) as BrowserInspectResult
  expect(result.ok, result.error).toBe(true)
  const payload = { page: result.page, probe: result.probe }
  if (!isPreviewProbeResult(payload)) throw new Error('Invalid native probe result: '+JSON.stringify(payload))
  expect(payload.page.url).toBe(target)
  expect(payload.probe.surface).toBe('chromium')
  return payload.probe
}

describe('Native Reader built-in audits', () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'vc-native-audit-'))
    site = Fastify()
    site.get('/', async (_req, reply) => reply.header('cache-control', 'no-store').header('content-security-policy', "frame-ancestors 'none'").type('text/html; charset=utf-8').send(source))
    const origin = await site.listen({ host: '127.0.0.1', port: 0 })
    manager = new BrowserSessionManager(root, new Map([['audit.reader.test', new URL(origin).host]]))
    session = await manager.start({ sessionId: randomUUID(), userKey: 'audit-test', conversationKey: randomUUID(), profileMode: 'ephemeral' })
  })
  afterAll(async () => { await manager?.close(); await site?.close(); if (root) await rm(root, { recursive: true, force: true }) })
  for (const fixture of probeFixtures) for (const state of ['condition', 'comparison'] as const) {
    it(`probes ${fixture.name}: ${state}`, async () => {
      await open(fixture[state].html)
      const report = await probe()
      expect(probeExpectationFailures(report, fixture[state].expect)).toEqual([])
    })
  }
  it.each([
    '<button hidden style="display:block"></button>',
    '<section style="visibility:hidden"><button style="visibility:visible"></button></section>'
  ])('semantic audits include CSS-visible controls (%#)', async body => {
    await open('<!doctype html>'+body)
    expect((await audit({ rules: ['button-name-missing'] })).total).toBe(1)
  })
  it('rejects missing or ambiguous probe targets and unsupported frames', async () => {
    await open('<!doctype html><button>One</button><button>Two</button>')
    for (const selector of ['', '#missing', 'button', '[']) expect(await send({ type: 'inspect', action: { kind: 'probe', selector } })).toMatchObject({ ok: false })
    await expect(send({ type: 'inspect', action: { kind: 'probe', selector: 'button' }, frame: '#child' })).rejects.toThrow('frame')
  })
  it('returns a valid partial probe when source inspection reaches its bounds', async () => {
    await open('<!doctype html>'+'<div>'.repeat(150)+'<button id="target">Save</button>'+'</div>'.repeat(150))
    const report = await probe()
    expect(report.truncated).toBe(true)
    expect(report.state.inert).toBe(null)
    expect(report.visibility.effectiveOpacity).toBe(null)
  })
  it('probes find references but rejects a replacement DOM clone', async () => {
    await open('<!doctype html><button id="target">Save</button>')
    const found = await send({ type: 'selector', action: { kind: 'find', selector: '#target' } }) as BrowserSelectorResult
    const selector = found.matches![0].selector
    expect((await probe(selector)).pointer.status).toBe('reachable')
    await send({ type: 'inspect', action: { kind: 'evaluate', code: 'const target=document.querySelector("#target");target.replaceWith(target.cloneNode(true))' } })
    expect(await send({ type: 'inspect', action: { kind: 'probe', selector } })).toMatchObject({ ok: false, error: expect.stringContaining('stale_element_ref') })
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
  for (const fixture of auditFixtures) {
    it(`detects ${fixture.name ?? fixture.rule} at the original origin`, async () => {
      await open(fixture.broken)
      await editFixture(fixture.edit?.broken)
      if (fixture.ready) expect(await send({ type: 'selector', action: { kind: 'wait', predicate: fixture.ready } })).toMatchObject({ ok: true })
      const report = await audit({ group: fixture.group, rules: [fixture.rule] })
      expect(report.findings.length).toBeGreaterThan(0)
      expect(report.checkedRules).toBe(1)
    })
    it(`clears ${fixture.name ?? fixture.rule} after repair`, async () => {
      await open(fixture.fixed)
      await editFixture(fixture.edit?.fixed)
      if (fixture.ready) expect(await send({ type: 'selector', action: { kind: 'wait', predicate: fixture.ready } })).toMatchObject({ ok: true })
      expect((await audit({ group: fixture.group, rules: [fixture.rule] })).findings).toEqual([])
    })
  }
  it('keeps human ownership and last actor while observing', async () => {
    await open('<!doctype html><button></button>')
    await send({ type: 'input', action: { type: 'press', key: 'Tab' } }, 'user')
    await send({ type: 'control', owner: 'user' }, 'user')
    try {
      expect((await audit({ rules: ['button-name-missing'] })).total).toBe(1)
      const metadata = await send({ type: 'status' }) as BrowserSessionMetadata
      expect(metadata.lastActor).toBe('user')
      await expect(send({ type: 'selector', action: { kind: 'click', selector: 'button' } })).rejects.toThrow('human_control')
    } finally { await send({ type: 'control', owner: 'shared' }, 'user') }
  })
  it('observes form validity under human control without events, value reads or mutations', async () => {
    await open(formReadOnlyScene)
    const evaluate = async (code: string) => (await send({ type: 'inspect', action: { kind: 'evaluate', code } }, 'user') as BrowserInspectResult).value
    await evaluate(formReadOnlySetup)
    await send({ type: 'control', owner: 'user' }, 'user')
    try {
      const before = await evaluate(formReadOnlyState)
      const report = await audit({ group: 'forms', limit: 30 })
      expect(report.findings.map(f => f.id)).toContain('validity-custom-error')
      expect(JSON.stringify(report)).not.toContain('PRIVATE_')
      expect(await send({ type: 'status' })).toMatchObject({ lastActor: 'user' })
      expect(await evaluate(formReadOnlyState)).toEqual(before)
    } finally { await send({ type: 'control', owner: 'shared' }, 'user') }
  })
  it('refreshes validity after the application clears a custom error', async () => {
    await open(formReadOnlyScene)
    const options = { group: 'forms', rules: ['validity-custom-error'] }
    expect((await audit(options)).total).toBe(1)
    await send({ type: 'inspect', action: { kind: 'evaluate', code: 'document.querySelector("#target").setCustomValidity("")' } })
    expect((await audit(options)).total).toBe(0)
  })
  it('does not mutate the inspected DOM and returns exact duplicate-ID selectors', async () => {
    await open('<!doctype html><button id="same">One</button><button id="same">Two</button>')
    const evaluate = async (code: string) => (await send({ type: 'inspect', action: { kind: 'evaluate', code } }) as BrowserInspectResult).value
    const before = await evaluate('document.documentElement.outerHTML')
    const report = await audit({ rules: ['duplicate-id'] })
    expect(new Set(report.findings.map(f => f.selector)).size).toBe(2)
    for (const finding of report.findings) expect(await evaluate('document.querySelectorAll('+JSON.stringify(finding.selector)+').length')).toBe(1)
    expect(await evaluate('document.documentElement.outerHTML')).toBe(before)
  })
  it('rejects invalid and unsupported scopes without silently switching surfaces', async () => {
    await open('<!doctype html><main><section></section><section></section></main>')
    for (const options of [{ limit: 31 }, { selector: 'section' }, { group: 'unknown' }, { rules: ['unknown'] }]) {
      expect(await send({ type: 'inspect', action: { kind: 'audit', ...options } })).toMatchObject({ ok: false, error: expect.any(String) })
    }
    await expect(send({ type: 'inspect', action: { kind: 'audit' }, frame: '#child' })).rejects.toThrow('frame')
  })
  it('discovers both rule groups and reports bounded incomplete scans', async () => {
    await open('<!doctype html><main>'+'<button></button>'.repeat(3100)+'</main>')
    expect((await audit({ group: 'layout', mode: 'list', limit: 30 })).rules).toHaveLength(30)
    const report = await audit({ rules: ['button-name-missing'], limit: 30 })
    expect(report.groups).toEqual(['markup', 'layout', 'typography', 'color', 'forms'])
    expect(report.scannedElements).toBe(3000)
    expect(report.truncated).toBe(true)
    expect(report.findings).toHaveLength(30)
    expect(JSON.stringify(report).length).toBeLessThan(27000)
  })
  it('keeps sensitive field values out of evidence', async () => {
    await open('<!doctype html><input type="password" value="native-private"><textarea name="token">native-token</textarea>')
    for (const group of ['markup', 'layout', 'typography', 'color', 'forms']) {
      const report = JSON.stringify(await audit({ group }))
      expect(report).not.toContain('native-private')
      expect(report).not.toContain('native-token')
    }
  })
  it('bounds large font catalogs and reports incomplete inspection', async () => {
    await open('<!doctype html><script>for(let i=0;i<1001;i++)document.fonts.add(new FontFace("Fixture"+i,"url(data:font/woff;base64,AAAA)"))</script><p>Font catalog</p>')
    const report = await audit({ group: 'typography', rules: ['font-face-load-error'] })
    expect(report.truncated).toBe(true)
    expect(report.limitations).toContain('Font status scan stopped at 1000 declared faces.')
    expect((await send({ type: 'inspect', action: { kind: 'evaluate', code: 'document.fonts.size' } }) as BrowserInspectResult).value).toBe(1001)
  })
  it('does not mistake quoted font-name fragments for generic fallbacks', async () => {
    await open('<!doctype html><p id="font" style="font-family:&quot;My, serif, Demo&quot;">Font stack</p>')
    expect((await audit({ group: 'typography', rules: ['font-generic-fallback-missing'] })).total).toBe(1)
    await send({ type: 'inspect', action: { kind: 'evaluate', code: 'document.querySelector("#font").style.fontFamily=\'"My, serif, Demo", sans-serif\'' } })
    expect((await audit({ group: 'typography', rules: ['font-generic-fallback-missing'] })).total).toBe(0)
  })
  it('keeps color observations read-only while the human owns control', async () => {
    await open('<!doctype html><style>body{background:white}</style><button id="focus" style="color:#ccc;background:white">Focus</button>')
    await send({ type: 'input', action: { type: 'press', key: 'Tab' } }, 'user')
    const evaluate = async (code: string) => (await send({ type: 'inspect', action: { kind: 'evaluate', code } }, 'user') as BrowserInspectResult).value
    const state = 'JSON.stringify({html:document.documentElement.outerHTML,focus:document.activeElement.id,selection:getSelection().toString(),scrollY})'
    const before = await evaluate(state)
    await send({ type: 'control', owner: 'user' }, 'user')
    try {
      expect((await audit({ group: 'color', rules: ['text-contrast-low'] })).total).toBe(1)
      expect((await send({ type: 'status' }) as BrowserSessionMetadata).lastActor).toBe('user')
      expect(await evaluate(state)).toBe(before)
    } finally { await send({ type: 'control', owner: 'shared' }, 'user') }
  })
  it('recomputes colors after a live style repair', async () => {
    await open('<!doctype html><style>body{background:white}</style><p id="live" style="color:#ccc">Text</p>')
    const options = { group: 'color', selector: '#live', rules: ['text-contrast-low'] }
    expect((await audit(options)).total).toBe(1)
    await send({ type: 'inspect', action: { kind: 'evaluate', code: 'document.querySelector("#live").style.color="black"' } })
    expect((await audit(options)).total).toBe(0)
  })
})
