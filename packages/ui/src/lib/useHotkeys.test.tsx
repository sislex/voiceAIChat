import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useHotkeys, type HotkeyHandlers } from './useHotkeys'

function Harness(props: Partial<HotkeyHandlers>): JSX.Element {
  useHotkeys({
    onPushStart: props.onPushStart ?? (() => {}),
    onPushEnd: props.onPushEnd ?? (() => {}),
    onEscape: props.onEscape ?? (() => {}),
    enabled: props.enabled
  })
  return <textarea aria-label="ввод" />
}

describe('useHotkeys', () => {
  beforeEach(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })

  it('пробел (down/up) вызывает push start и end по разу', () => {
    const onPushStart = vi.fn()
    const onPushEnd = vi.fn()
    render(<Harness onPushStart={onPushStart} onPushEnd={onPushEnd} />)

    fireEvent.keyDown(window, { code: 'Space' })
    fireEvent.keyDown(window, { code: 'Space', repeat: true }) // автоповтор игнор
    fireEvent.keyUp(window, { code: 'Space' })

    expect(onPushStart).toHaveBeenCalledTimes(1)
    expect(onPushEnd).toHaveBeenCalledTimes(1)
  })

  it('Escape вызывает onEscape', () => {
    const onEscape = vi.fn()
    render(<Harness onEscape={onEscape} />)
    fireEvent.keyDown(window, { code: 'Escape' })
    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('пробел в текстовом поле не триггерит запись', () => {
    const onPushStart = vi.fn()
    const { getByLabelText } = render(<Harness onPushStart={onPushStart} />)
    ;(getByLabelText('ввод') as HTMLTextAreaElement).focus()
    fireEvent.keyDown(window, { code: 'Space' })
    expect(onPushStart).not.toHaveBeenCalled()
  })

  it('enabled=false отключает горячие клавиши', () => {
    const onPushStart = vi.fn()
    const onEscape = vi.fn()
    render(<Harness onPushStart={onPushStart} onEscape={onEscape} enabled={false} />)
    fireEvent.keyDown(window, { code: 'Space' })
    fireEvent.keyDown(window, { code: 'Escape' })
    expect(onPushStart).not.toHaveBeenCalled()
    expect(onEscape).not.toHaveBeenCalled()
  })
})
