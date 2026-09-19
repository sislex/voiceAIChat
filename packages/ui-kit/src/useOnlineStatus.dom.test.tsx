import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useOnlineStatus, type OnlineStatusSource } from './useOnlineStatus'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('reads browser connectivity and follows offline and online transitions', () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  const hook = renderHook(() => useOnlineStatus())
  expect(hook.result.current).toBe(true)
  act(() => { online.mockReturnValue(false); window.dispatchEvent(new Event('offline')) })
  expect(hook.result.current).toBe(false)
  act(() => { online.mockReturnValue(true); window.dispatchEvent(new Event('online')) })
  expect(hook.result.current).toBe(true)
})

it('removes the same browser listeners on unmount', () => {
  const add = vi.spyOn(window, 'addEventListener')
  const remove = vi.spyOn(window, 'removeEventListener')
  const { unmount } = renderHook(() => useOnlineStatus())
  const listeners = add.mock.calls.filter(([event]) => event === 'online' || event === 'offline')
  expect(listeners).toHaveLength(2)
  unmount()
  for (const [event, listener] of listeners) expect(remove).toHaveBeenCalledWith(event, listener)
})

it('uses an injected host source and releases it when the source changes', () => {
  let current: boolean | null = null
  let notify = () => {}
  const release = vi.fn()
  const source: OnlineStatusSource = {
    getSnapshot: () => current,
    subscribe: (listener) => { notify = listener; return release },
  }
  const replacement: OnlineStatusSource = { getSnapshot: () => true, subscribe: () => () => {} }
  const hook = renderHook(({ value }) => useOnlineStatus(value), { initialProps: { value: source } })
  expect(hook.result.current).toBeNull()
  act(() => { current = false; notify() })
  expect(hook.result.current).toBe(false)
  hook.rerender({ value: replacement })
  expect(hook.result.current).toBe(true)
  expect(release).toHaveBeenCalledOnce()
})
