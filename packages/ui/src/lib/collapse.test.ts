import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { COMPOSER_COLLAPSE_KEY, readCollapsed, useCollapsed } from './collapse'

describe('свёрнутость панелей чата', () => {
  beforeEach(() => localStorage.clear())

  it('по умолчанию панель раскрыта', () => {
    const { result } = renderHook(() => useCollapsed(COMPOSER_COLLAPSE_KEY))
    expect(result.current[0]).toBe(false)
  })

  it('переключение сохраняется и читается следующим монтированием', () => {
    const { result, unmount } = renderHook(() => useCollapsed(COMPOSER_COLLAPSE_KEY))
    act(() => result.current[1]())
    expect(result.current[0]).toBe(true)
    expect(readCollapsed(COMPOSER_COLLAPSE_KEY)).toBe(true)
    unmount()

    const again = renderHook(() => useCollapsed(COMPOSER_COLLAPSE_KEY))
    expect(again.result.current[0]).toBe(true)
    act(() => again.result.current[1]())
    expect(readCollapsed(COMPOSER_COLLAPSE_KEY)).toBe(false)
  })

  it('мусор в ключе читается как «раскрыта»', () => {
    localStorage.setItem(COMPOSER_COLLAPSE_KEY, 'да')
    expect(readCollapsed(COMPOSER_COLLAPSE_KEY)).toBe(false)
  })
})
