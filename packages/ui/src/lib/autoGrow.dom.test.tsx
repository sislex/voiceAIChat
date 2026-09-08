import { StrictMode } from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoGrow } from './autoGrow'

class WidthObserver {
  static active = new Set<WidthObserver>()
  target: Element | null = null
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element): void { this.target = target; WidthObserver.active.add(this) }
  disconnect(): void { WidthObserver.active.delete(this) }
  unobserve(): void { this.disconnect() }
  resize(width: number): void {
    this.callback([{ target: this.target, contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
}

function Field({ visible = true, overflow = (_value: boolean) => {} }: {
  visible?: boolean
  overflow?: (value: boolean) => void
}): JSX.Element | null {
  const ref = useAutoGrow('', 1, 4, overflow)
  return visible ? <textarea aria-label="Текст" ref={ref} style={{ lineHeight: '20px', padding: '4px 0', border: 0 }} /> : null
}

describe('useAutoGrow при изменении ширины', () => {
  beforeEach(() => { vi.stubGlobal('ResizeObserver', WidthObserver) })
  afterEach(() => { vi.unstubAllGlobals(); WidthObserver.active.clear() })

  it('переносит неизменённый текст при сужении и уменьшает поле при расширении', () => {
    const overflow = vi.fn()
    const { unmount } = render(<StrictMode><Field overflow={overflow} /></StrictMode>)
    const input = screen.getByRole('textbox')
    let contentHeight = 48
    Object.defineProperty(input, 'scrollHeight', { get: () => contentHeight })
    const observer = [...WidthObserver.active][0]
    expect(WidthObserver.active.size).toBe(1)
    act(() => observer.resize(240))
    expect(input.style.height).toBe('48px')

    contentHeight = 128
    act(() => observer.resize(100))
    expect(input.style.height).toBe('88px')
    expect(overflow).toHaveBeenLastCalledWith(true)

    contentHeight = 28
    act(() => observer.resize(240))
    expect(input.style.height).toBe('28px')
    expect(overflow).toHaveBeenLastCalledWith(false)
    unmount()
    expect(WidthObserver.active.size).toBe(0)
  })

  it('не реагирует на собственную высоту и пересчитывает поле после скрытой вкладки', () => {
    const overflow = vi.fn()
    render(<Field overflow={overflow} />)
    const input = screen.getByRole('textbox')
    let contentHeight = 48
    Object.defineProperty(input, 'scrollHeight', { get: () => contentHeight })
    const observer = [...WidthObserver.active][0]
    act(() => observer.resize(240))
    overflow.mockClear()
    contentHeight = 68
    act(() => observer.resize(240))
    act(() => observer.resize(0))
    expect(input.style.height).toBe('48px')
    expect(overflow).not.toHaveBeenCalled()
    act(() => observer.resize(120))
    expect(input.style.height).toBe('68px')
  })

  it('наблюдает новый DOM-узел после сворачивания редактора', () => {
    const { rerender } = render(<Field />)
    const previous = screen.getByRole('textbox')
    rerender(<Field visible={false} />)
    expect(WidthObserver.active.size).toBe(0)
    rerender(<Field />)
    const input = screen.getByRole('textbox')
    expect(input).not.toBe(previous)
    expect(WidthObserver.active.size).toBe(1)
    expect([...WidthObserver.active][0].target).toBe(input)
  })
})
