import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useHotkeys, type HotkeyBinding, type HotkeyHandlers } from './useHotkeys'

function Harness(props: Partial<HotkeyHandlers>): JSX.Element {
  useHotkeys({
    onPushStart: props.onPushStart ?? (() => {}),
    onPushEnd: props.onPushEnd ?? (() => {}),
    onEscape: props.onEscape ?? (() => {}),
    ...(props.bindings ? { bindings: props.bindings } : {}),
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

  it('автоповтор без флага repeat тоже не рестартует запись', () => {
    const onPushStart = vi.fn()
    const onPushEnd = vi.fn()
    render(<Harness onPushStart={onPushStart} onPushEnd={onPushEnd} />)

    // Некоторые окружения не ставят repeat — защита держится на «клавиша зажата».
    fireEvent.keyDown(window, { code: 'Space' })
    fireEvent.keyDown(window, { code: 'Space' })
    fireEvent.keyUp(window, { code: 'Space' })

    expect(onPushStart).toHaveBeenCalledTimes(1)
    expect(onPushEnd).toHaveBeenCalledTimes(1)
  })

  it('отпускание без нажатия ничего не завершает', () => {
    const onPushEnd = vi.fn()
    render(<Harness onPushEnd={onPushEnd} />)
    fireEvent.keyUp(window, { code: 'Space' })
    expect(onPushEnd).not.toHaveBeenCalled()
  })

  it('пробел работает с зажатым модификатором — как до карты биндингов', () => {
    const onPushStart = vi.fn()
    render(<Harness onPushStart={onPushStart} />)
    fireEvent.keyDown(window, { code: 'Space', ctrlKey: true })
    expect(onPushStart).toHaveBeenCalledTimes(1)
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

  it('Escape в текстовом поле не перехватываем', () => {
    const onEscape = vi.fn()
    const { getByLabelText } = render(<Harness onEscape={onEscape} />)
    ;(getByLabelText('ввод') as HTMLTextAreaElement).focus()
    fireEvent.keyDown(window, { code: 'Escape' })
    expect(onEscape).not.toHaveBeenCalled()
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

  describe('карта биндингов', () => {
    it('mod+k срабатывает и на Cmd, и на Ctrl', () => {
      const onDown = vi.fn()
      render(<Harness bindings={[{ combo: 'mod+k', onDown }]} />)
      fireEvent.keyDown(window, { key: 'k', metaKey: true })
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
      expect(onDown).toHaveBeenCalledTimes(2)
    })

    it('комбинация с модификатором работает и в поле ввода', () => {
      const onDown = vi.fn()
      const { getByLabelText } = render(<Harness bindings={[{ combo: 'mod+k', inInput: true, onDown }]} />)
      ;(getByLabelText('ввод') as HTMLTextAreaElement).focus()
      fireEvent.keyDown(window, { key: 'k', metaKey: true })
      expect(onDown).toHaveBeenCalledTimes(1)
    })

    it('клавиша без модификатора в поле ввода не перехватывается', () => {
      const onDown = vi.fn()
      const { getByLabelText } = render(<Harness bindings={[{ combo: '?', onDown }]} />)
      ;(getByLabelText('ввод') as HTMLTextAreaElement).focus()
      fireEvent.keyDown(window, { key: '?' })
      expect(onDown).not.toHaveBeenCalled()
      ;(getByLabelText('ввод') as HTMLTextAreaElement).blur()
      fireEvent.keyDown(window, { key: '?' })
      expect(onDown).toHaveBeenCalledTimes(1)
    })

    it('enabled биндинга проверяется в момент нажатия', () => {
      const onDown = vi.fn()
      let allowed = false
      const bindings: HotkeyBinding[] = [{ combo: 'mod+k', enabled: () => allowed, onDown }]
      render(<Harness bindings={bindings} />)
      fireEvent.keyDown(window, { key: 'k', metaKey: true })
      expect(onDown).not.toHaveBeenCalled()
      allowed = true
      fireEvent.keyDown(window, { key: 'k', metaKey: true })
      expect(onDown).toHaveBeenCalledTimes(1)
    })

    it('общий enabled=false гасит только голосовые клавиши', () => {
      const onDown = vi.fn()
      const onEscape = vi.fn()
      render(<Harness enabled={false} onEscape={onEscape} bindings={[{ combo: 'mod+k', onDown }]} />)
      fireEvent.keyDown(window, { code: 'Escape' })
      fireEvent.keyDown(window, { key: 'k', metaKey: true })
      expect(onEscape).not.toHaveBeenCalled()
      expect(onDown).toHaveBeenCalledTimes(1)
    })

    it('колбэки берутся свежими, без переподписки слушателей', () => {
      const first = vi.fn()
      const second = vi.fn()
      const { rerender } = render(<Harness bindings={[{ combo: 'mod+k', onDown: first }]} />)
      rerender(<Harness bindings={[{ combo: 'mod+k', onDown: second }]} />)
      fireEvent.keyDown(window, { key: 'k', metaKey: true })
      expect(first).not.toHaveBeenCalled()
      expect(second).toHaveBeenCalledTimes(1)
    })

    it('чужая комбинация не мешает пробелу', () => {
      const onPushStart = vi.fn()
      const onDown = vi.fn()
      render(<Harness onPushStart={onPushStart} bindings={[{ combo: 'mod+k', onDown }]} />)
      fireEvent.keyDown(window, { code: 'Space' })
      expect(onPushStart).toHaveBeenCalledTimes(1)
      expect(onDown).not.toHaveBeenCalled()
    })
  })
})
