import { afterEach, expect, it, vi } from 'vitest'
import type { ServerMessage } from '@voicechat/shared'
import { WidgetUiRelay, WIDGET_UI_CONFIRM_TIMEOUT_MS } from './widgetUiRelay.js'

afterEach(() => vi.useRealTimers())

it.each([false, true])('expires confirmations and ignores late acceptance (delayed timer: %s)', async delayedTimer => {
  vi.useFakeTimers()
  const relay = new WidgetUiRelay()
  const frames: ServerMessage[] = []
  relay.subscribe('ann', frame => frames.push(frame))
  const other = vi.fn()
  relay.subscribe('bob', other)
  const pending = relay.request('ann', 'c', 'p', { kind: 'confirm', title: 'Plan', rows: [] })
  const request = frames[0]!
  expect(request).toMatchObject({ t: 'widget.action', expiresAt: Date.now() + WIDGET_UI_CONFIRM_TIMEOUT_MS })
  if (request.t !== 'widget.action') throw new Error('Missing request')
  if (delayedTimer) {
    vi.setSystemTime(Date.now() + WIDGET_UI_CONFIRM_TIMEOUT_MS)
    relay.resolve('ann', request.requestId, { ok: true, result: { surface: null, confirmed: true } }, 'c')
  } else await vi.advanceTimersByTimeAsync(WIDGET_UI_CONFIRM_TIMEOUT_MS)
  expect(await pending).toMatchObject({ ok: false, error: expect.stringContaining('истекло') })
  expect(frames[1]).toEqual({ t: 'widget.action.expired', conversationId: 'c', projectId: 'p', requestId: request.requestId })
  expect(other).not.toHaveBeenCalled()
  relay.resolve('ann', request.requestId, { ok: true, result: { surface: null, confirmed: true } }, 'c')
  expect(relay.pendingCount()).toBe(0)
  expect(frames).toHaveLength(2)
})

it('an explicit rejection settles without an expiration event', async () => {
  vi.useFakeTimers()
  const relay = new WidgetUiRelay()
  const frames: ServerMessage[] = []
  relay.subscribe('ann', frame => frames.push(frame))
  const pending = relay.request('ann', 'c', 'p', { kind: 'confirm', title: 'Plan', rows: [] })
  const request = frames[0]!
  if (request.t !== 'widget.action') throw new Error('Missing request')
  relay.resolve('ann', request.requestId, { ok: true, result: { surface: null, confirmed: false } }, 'c')
  expect(await pending).toMatchObject({ ok: true, result: { confirmed: false } })
  await vi.advanceTimersByTimeAsync(WIDGET_UI_CONFIRM_TIMEOUT_MS)
  expect(frames).toHaveLength(1)
})
