import { afterEach, expect, it, vi } from 'vitest'
import { createScenarioRunner } from './scenarioRunner'
const steps = [{ kind: 'click' as const, selector: '#go', text: '', sensitive: false }]
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
afterEach(() => vi.useRealTimers())
function setup(extra: Partial<Parameters<typeof createScenarioRunner>[0]> = {}) {
  const send = vi.fn(), onProgress = vi.fn(); const runner = createScenarioRunner({ send, onProgress, newId: () => 'same', settleMs: 0, timeoutMs: 100, ...extra }); runner.setReady(true)
  return { runner, send, onProgress }
}
it.each([null, {}, 'steps'])('rejects malformed input list %s without rejection', async value => {
  const { runner, send } = setup(); expect(await runner.run(value as never, {})).toMatchObject({ ok: false }); expect(send).not.toHaveBeenCalled()
})
it.each([null, { ...steps[0], kind: 'unknown' }, { ...steps[0], selector: 4 }])('rejects malformed steps before any action', async value => {
  const { runner, send } = setup(); expect(await runner.run([steps[0], value] as never, {})).toMatchObject({ ok: false, error: expect.stringContaining('Шаг 2') }); expect(send).not.toHaveBeenCalled()
})
it('enforces the count limit before reading step contents', async () => {
  const list = Array(201).fill(null); Object.defineProperty(list, 0, { get() { throw new Error('must not traverse') } })
  expect(await setup().runner.run(list, {})).toMatchObject({ ok: false, error: expect.stringContaining('200') })
})
it('rejects non-string runtime secret values', async () => {
  const { runner, send } = setup(); expect(await runner.run([{ ...steps[0], kind: 'type', sensitive: true }], { 0: 123 } as never)).toMatchObject({ ok: false, error: expect.stringContaining('строкой') }); expect(send).not.toHaveBeenCalled()
})
it('never lets late replies from repeated injected IDs settle a new run', async () => {
  const { runner, send } = setup(); const first = runner.run(steps, {}); await tick(); const oldId = send.mock.calls[0][0]; runner.cancel(); await first
  const second = runner.run(steps, {}); await tick(); expect(send.mock.calls[1][0]).not.toBe(oldId); expect(runner.receive(oldId, { ok: true })).toBe(false); runner.cancel(); await second
})
it.each([NaN, Infinity, -1, 0])('defaults invalid timeout %s', async timeoutMs => {
  vi.useFakeTimers(); const { runner } = setup({ timeoutMs }); const run = runner.run(steps, {}); await vi.advanceTimersByTimeAsync(11999); expect(runner.isRunning()).toBe(true)
  await vi.advanceTimersByTimeAsync(1); expect(await run).toMatchObject({ ok: false }); expect(vi.getTimerCount()).toBe(0)
})
it('caps an excessive timeout at two minutes', async () => {
  vi.useFakeTimers(); const { runner } = setup({ timeoutMs: 1e10 }); const run = runner.run(steps, {}); await vi.advanceTimersByTimeAsync(120000); expect(await run).toMatchObject({ ok: false })
})
it.each([NaN, Infinity, -1, 1e10])('normalizes settling delay %s below the action timeout', async settleMs => {
  vi.useFakeTimers(); const { runner, send } = setup({ settleMs }); const run = runner.run(steps, {}); await tick(); runner.receive(send.mock.calls[0][0], { ok: true }); await vi.advanceTimersByTimeAsync(99)
  expect(await run).toEqual({ ok: true }); expect(vi.getTimerCount()).toBe(0)
})
it('ignores malformed replies until a valid outcome arrives', async () => {
  vi.useFakeTimers(); const { runner, send } = setup(); const run = runner.run(steps, {}); await tick(); const id = send.mock.calls[0][0]
  expect(runner.receive(id, { ok: 'yes' } as never)).toBe(false); expect(runner.receive(id, { ok: false, error: 1 } as never)).toBe(false)
  expect(runner.receive(id, { ok: true })).toBe(true); await vi.advanceTimersByTimeAsync(1); expect(await run).toEqual({ ok: true })
})
it('contains throwing progress observers and remains reusable', async () => {
  vi.useFakeTimers(); const { runner, send } = setup({ onProgress: () => { throw new Error('observer') } })
  const run = runner.run(steps, {}); await tick(); runner.receive(send.mock.calls[0][0], { ok: true }); await vi.advanceTimersByTimeAsync(1); expect(await run).toEqual({ ok: true }); expect(runner.isRunning()).toBe(false)
  const next = runner.run(steps, {}); runner.cancel(); expect(await next).toMatchObject({ ok: false }); expect(vi.getTimerCount()).toBe(0)
})
