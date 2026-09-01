import { describe, expect, it, vi } from 'vitest'
import { createMachineRequiredGuard } from './machineRequiredGuard'

describe('machine-required guard', () => {
  it('passes through when a machine is available', () => {
    const blocked = vi.fn(); const action = vi.fn()
    const guard = createMachineRequiredGuard(blocked)
    expect(guard.require(true, action)).toBe(true)
    expect(action).toHaveBeenCalledOnce()
    expect(blocked).not.toHaveBeenCalled()
  })

  it('pauses and resumes the latest action exactly once', () => {
    const blocked = vi.fn(); const first = vi.fn(); const second = vi.fn()
    const guard = createMachineRequiredGuard(blocked)
    guard.require(false, first)
    guard.require(false, second)
    expect(blocked).toHaveBeenCalledTimes(2)
    expect(guard.resume()).toBe(true)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
    expect(guard.resume()).toBe(false)
  })

  it('cancels a deferred action when the dialog closes', () => {
    const action = vi.fn()
    const guard = createMachineRequiredGuard(() => {})
    guard.require(false, action)
    guard.cancel()
    expect(guard.resume()).toBe(false)
    expect(action).not.toHaveBeenCalled()
  })
})
