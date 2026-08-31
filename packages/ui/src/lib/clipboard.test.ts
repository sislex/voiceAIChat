// Окружение jsdom вопреки имени файла (без `.dom.`): компоненты здесь не
// рендерятся, но буфер обмена — это navigator.clipboard и fallback через document.
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from './clipboard'

const originalClipboard = navigator.clipboard
const originalExec = document.execCommand

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard })
  Object.defineProperty(document, 'execCommand', { configurable: true, value: originalExec })
  document.querySelectorAll('textarea').forEach((node) => node.remove())
})

describe('copyText', () => {
  it('uses Clipboard API without fallback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const exec = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec })
    expect(await copyText(' exact text ')).toBe(true)
    expect(writeText).toHaveBeenCalledWith(' exact text ')
    expect(exec).not.toHaveBeenCalled()
  })

  it.each(['missing', 'rejected'] as const)('uses textarea fallback when Clipboard API is %s', async (mode) => {
    const exec = vi.fn().mockReturnValue(true)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: mode === 'missing' ? undefined : { writeText: vi.fn().mockRejectedValue(new Error('denied')) }
    })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec })
    expect(await copyText('ssh exact')).toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('returns false when both methods fail and cleans up the field', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => { throw new Error('blocked') }) })
    expect(await copyText('ssh exact')).toBe(false)
    expect(document.querySelector('textarea')).toBeNull()
  })
})
