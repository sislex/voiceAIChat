// Ядро стора. Тест появился после мутационной проверки: снятие охраны `disposed`
// в `setState` не роняло ни один тест стора Operations — там до `setState` дело
// не доходит, потому что раньше срабатывает охрана контроллера. То есть охрана в
// ядре — вторая линия обороны, и проверять её надо здесь, напрямую.

import { describe, expect, it, vi } from 'vitest'
import { createStoreCore } from './core'

interface State { value: number; label: string }
const make = () => createStoreCore<State>({ value: 0, label: 'начало' })

describe('createStoreCore', () => {
  it('патч сливается с состоянием, а не заменяет его', () => {
    const core = make()
    core.setState({ value: 1 })
    expect(core.getState()).toEqual({ value: 1, label: 'начало' })
  })

  it('патч-функция получает текущее состояние', () => {
    const core = make()
    core.setState({ value: 5 })
    core.setState((state) => ({ value: state.value + 1 }))
    expect(core.getState().value).toBe(6)
  })

  it('подписчики получают уведомление на каждое изменение', () => {
    const core = make()
    const listener = vi.fn()
    core.subscribe(listener)
    core.setState({ value: 1 })
    core.setState({ value: 2 })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('отписка перестаёт уведомлять и не мешает остальным', () => {
    const core = make()
    const a = vi.fn(); const b = vi.fn()
    const off = core.subscribe(a); core.subscribe(b)
    off()
    core.setState({ value: 1 })
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('после dispose состояние заморожено — это вторая линия обороны', () => {
    // Именно этот случай мутация вскрыла: в сторе до setState дело не доходит,
    // а здесь доходит.
    const core = make()
    core.dispose()
    core.setState({ value: 99 })
    expect(core.getState().value).toBe(0)
  })

  it('после dispose подписчиков не уведомляют и подписаться больше нельзя', () => {
    const core = make()
    const before = vi.fn()
    core.subscribe(before)
    core.dispose()
    const after = vi.fn()
    const off = core.subscribe(after)
    core.setState({ value: 1 })
    expect(before).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
    expect(() => off()).not.toThrow()
  })

  it('dispose выполняет накопленные очистки ровно один раз', () => {
    const core = make()
    const cleanup = vi.fn()
    core.onDispose(cleanup)
    core.dispose()
    core.dispose()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('очистка, добавленная после dispose, выполняется сразу — иначе ресурс утечёт', () => {
    const core = make()
    core.dispose()
    const late = vi.fn()
    core.onDispose(late)
    expect(late).toHaveBeenCalledTimes(1)
  })

  it('isDisposed отражает состояние ядра', () => {
    const core = make()
    expect(core.isDisposed()).toBe(false)
    core.dispose()
    expect(core.isDisposed()).toBe(true)
  })
})
