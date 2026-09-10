import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { act } from 'react'
import { usePolling } from './usePolling'

function Probe({ poll, enabled = true }: { poll: () => void; enabled?: boolean }): JSX.Element {
  usePolling(poll, { enabled, intervalMs: 1000 })
  return <div />
}

/** Управляем видимостью документа так же, как её видит браузер. */
function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('usePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
  })
  afterEach(() => {
    vi.useRealTimers()
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
  })

  it('тикает, пока вкладка видна', () => {
    const poll = vi.fn()
    render(<Probe poll={poll} />)
    act(() => { vi.advanceTimersByTime(3000) })
    expect(poll).toHaveBeenCalledTimes(3)
  })

  it('встаёт, когда вкладку спрятали, — карточка не стучит в сервер всю ночь', () => {
    const poll = vi.fn()
    render(<Probe poll={poll} />)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(poll).toHaveBeenCalledTimes(1)

    act(() => { setHidden(true) })
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(poll).toHaveBeenCalledTimes(1)
  })

  it('возврат на вкладку сразу догоняет состояние и снова тикает', () => {
    const poll = vi.fn()
    render(<Probe poll={poll} />)
    act(() => { setHidden(true) })
    act(() => { vi.advanceTimersByTime(5000) })
    expect(poll).toHaveBeenCalledTimes(0)

    act(() => { setHidden(false) })
    // Один внеплановый запрос сразу: иначе на экране висело бы устаревшее.
    expect(poll).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(2000) })
    expect(poll).toHaveBeenCalledTimes(3)
  })

  it('выключенный опрос не тикает вовсе', () => {
    const poll = vi.fn()
    render(<Probe poll={poll} enabled={false} />)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(poll).not.toHaveBeenCalled()
  })

  it('смена колбэка не перезапускает таймер', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Probe poll={first} />)
    act(() => { vi.advanceTimersByTime(1500) })
    rerender(<Probe poll={second} />)
    act(() => { vi.advanceTimersByTime(500) })
    // Второй тик пришёлся на 2000мс от старта — таймер не сбрасывался.
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })
})
