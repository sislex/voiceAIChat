import Fastify, { type FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { markupAuditFixtures, layoutAuditFixtures } from '@voicechat/browser-contracts/audit'
import type { BrowserCommand, BrowserInspectResult, BrowserSessionMetadata, PreviewAuditOptions } from '@voicechat/shared'
import { BrowserSessionManager } from './sessionManager.js'

let site: FastifyInstance, manager: BrowserSessionManager, session: BrowserSessionMetadata, root: string, source = ''
const target = 'http://audit.reader.test/'
const send = (command: BrowserCommand, actor: 'user' | 'assistant' = 'assistant') => manager.command(session.id, { requestId: randomUUID(), incarnation: session.incarnation, actor, command })
const open = async (html: string) => { source = html; await send({ type: 'navigate', url: target }) }
const audit = async (options: PreviewAuditOptions = {}) => {
  const result = await send({ type: 'inspect', action: { kind: 'audit', ...options } }) as BrowserInspectResult
  expect(result.ok, result.error).toBe(true)
  expect(result.audit?.surface).toBe('chromium')
  expect(result.page?.url).toBe(target)
  return result.audit!
}

describe('Native Reader built-in audits', () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'vc-native-audit-'))
    site = Fastify()
    site.get('/', async (_req, reply) => reply.header('cache-control', 'no-store').header('content-security-policy', "frame-ancestors 'none'").type('text/html').send(source))
    const origin = await site.listen({ host: '127.0.0.1', port: 0 })
    manager = new BrowserSessionManager(root, new Map([['audit.reader.test', new URL(origin).host]]))
    session = await manager.start({ sessionId: randomUUID(), userKey: 'audit-test', conversationKey: randomUUID(), profileMode: 'ephemeral' })
  })
  afterAll(async () => { await manager?.close(); await site?.close(); if (root) await rm(root, { recursive: true, force: true }) })
  for (const fixture of [...markupAuditFixtures.map(f => ({ ...f, group: 'markup' })), ...layoutAuditFixtures.map(f => ({ ...f, group: 'layout' }))]) {
    it(`detects ${fixture.rule} at the original origin`, async () => {
      await open(fixture.broken)
      const report = await audit({ group: fixture.group, rules: [fixture.rule] })
      expect(report.findings.length).toBeGreaterThan(0)
      expect(report.checkedRules).toBe(1)
    })
    it(`clears ${fixture.rule} after repair`, async () => {
      await open(fixture.fixed)
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
    expect(report.groups).toEqual(['markup', 'layout'])
    expect(report.scannedElements).toBe(3000)
    expect(report.truncated).toBe(true)
    expect(report.findings).toHaveLength(30)
    expect(JSON.stringify(report).length).toBeLessThan(27000)
  })
  it('keeps sensitive field values out of evidence', async () => {
    await open('<!doctype html><input type="password" value="native-private"><textarea name="token">native-token</textarea>')
    const report = JSON.stringify(await audit())
    expect(report).not.toContain('native-private')
    expect(report).not.toContain('native-token')
  })
})
