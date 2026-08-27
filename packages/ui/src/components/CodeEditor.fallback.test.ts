import { describe, expect, it } from 'vitest'
import { PHONE_EDITOR_QUERY, shouldUseFallbackEditor } from './CodeEditor'

describe('выбор редактора (п.34)', () => {
  it('Monaco — только на широком экране вне jsdom', () => {
    expect(shouldUseFallbackEditor(false, false)).toBe(false)
    expect(shouldUseFallbackEditor(true, false)).toBe(true)
    expect(shouldUseFallbackEditor(false, true)).toBe(true)
    expect(PHONE_EDITOR_QUERY).toBe('(max-width: 600px)')
  })
})
