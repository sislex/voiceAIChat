import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WEB_RECORDER_MESSAGE_TYPE as type, WEB_RECORDER_PROTOCOL_VERSION as protocolVersion, type WebRecorderHostMessage } from '@shared/webRecorder'
import { createReaderHostBridge, type ReaderHostBridgeOptions } from './hostBridge'

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
function harness(options: Partial<ReaderHostBridgeOptions> = {}) {
  const sent: WebRecorderHostMessage[] = []
  const registrations = vi.fn()
  const bridge = createReaderHostBridge({ conversationId: 'c', newId: () => 'fixed', send: m => sent.push(m), onRegistration: registrations, ...options })
  const boot = () => bridge.receive({ type, kind: 'ready', protocolVersion, conversationId: null, registrationId: null, capabilities: [] })
  const from = (message: object) => bridge.receive({ type, conversationId: 'c', registrationId: bridge.registrationId(), ...message })
  const commands = () => sent.filter(m => m.kind === 'command')
  boot(); from({ kind: 'page-status', status: 'ready', url: 'https://page.test/' })
  return { bridge, sent, registrations, boot, from, commands }
}
it('rejects invalid actions before sending anything', async () => {
  const h = harness(), before = h.sent.length
  await expect(h.bridge.run({ kind: 'unsupported' } as never)).resolves.toMatchObject({ ok: false })
  expect(h.sent).toHaveLength(before); h.bridge.dispose()
})
it('snapshots actions queued during navigation', async () => {
  const h = harness(); h.from({ kind: 'page-status', status: 'loading', url: 'https://page.test/' })
  const action = { kind: 'click' as const, selector: '#original' }, pending = h.bridge.run(action)
  action.selector = '#different'; h.from({ kind: 'page-status', status: 'ready', url: 'https://page.test/' })
  expect(h.commands()[0]).toMatchObject({ action: { selector: '#original' } }); h.bridge.dispose(); await pending
})
it('bounds pending commands and releases capacity after completion', async () => {
  const h = harness(), pending = Array.from({ length: 64 }, () => h.bridge.run({ kind: 'read' }))
  await expect(h.bridge.run({ kind: 'read' })).resolves.toMatchObject({ ok: false, error: expect.stringContaining('много') })
  h.from({ kind: 'result', requestId: h.commands()[0].requestId, ok: true, result: { url: 'https://page.test/' } })
  pending.push(h.bridge.run({ kind: 'read' })); expect(h.commands()).toHaveLength(65)
  h.bridge.dispose(); await Promise.all(pending)
})
it('keeps request IDs distinct with a repeated injected identifier', async () => {
  const h = harness(), a = h.bridge.run({ kind: 'read' }), b = h.bridge.run({ kind: 'read' })
  const ids = h.commands().map(m => m.requestId); expect(new Set(ids).size).toBe(2)
  h.bridge.dispose(); await expect(a).resolves.toMatchObject({ ok: false }); await b
})
it.each([NaN, -1, 0, Infinity])('uses the default timeout for %s', async timeoutMs => {
  const h = harness({ timeoutMs }), pending = h.bridge.run({ kind: 'read' }); let settled = false
  void pending.then(() => { settled = true }); await vi.advanceTimersByTimeAsync(9999); expect(settled).toBe(false)
  await vi.advanceTimersByTimeAsync(1); await expect(pending).resolves.toMatchObject({ ok: false }); h.bridge.dispose()
})
it('does not execute an open microtask after its request expires', async () => {
  const microtasks: VoidFunction[] = []; vi.spyOn(globalThis, 'queueMicrotask').mockImplementation(fn => { microtasks.push(fn) })
  const h = harness({ timeoutMs: 1 }), pending = h.bridge.run({ kind: 'open', url: 'https://late.test/' })
  await vi.advanceTimersByTimeAsync(1); await pending; microtasks.forEach(fn => fn())
  expect(h.sent.some(m => m.kind === 'set-url' && m.url === 'https://late.test/')).toBe(false); h.bridge.dispose()
})
it('ignores a result for a command still waiting for page readiness', async () => {
  const h = harness(); h.from({ kind: 'page-status', status: 'loading', url: 'https://page.test/' })
  const pending = h.bridge.run({ kind: 'read' }); let settled = false; void pending.then(() => { settled = true })
  h.from({ kind: 'result', requestId: 'wr-fixed-1', ok: true, result: { url: 'https://wrong.test/' } })
  await Promise.resolve(); expect(settled).toBe(false)
  h.bridge.dispose(); await pending
})
it('restores active diagnostics across shell boots but respects end', () => {
  const h = harness(); h.bridge.beginDiagnostics(); h.sent.length = 0; h.boot()
  expect(h.sent).toContainEqual(expect.objectContaining({ kind: 'diagnostics-start', active: true }))
  h.bridge.endDiagnostics(); h.sent.length = 0; h.boot()
  expect(h.sent.some(m => m.kind === 'diagnostics-start')).toBe(false); h.bridge.dispose()
})
it('does not publish a registration if restored mode delivery fails', () => {
  let broken = false
  const h = harness({ send: m => { if (broken && m.kind === 'inspector-state') throw new Error('closed') } })
  h.bridge.setInspector(true); h.registrations.mockClear(); broken = true; h.boot()
  expect(h.registrations).not.toHaveBeenCalled(); expect(h.bridge.getStatus()).toBe('error'); h.bridge.dispose()
})
it('treats an unchanged approved URL as a no-op', () => {
  const h = harness(), count = h.sent.length; h.bridge.setUrl('https://page.test/')
  expect(h.sent).toHaveLength(count); expect(h.bridge.getStatus()).toBe('page-ready'); h.bridge.dispose()
})
