import { describe, expect, it } from 'vitest'
import { CONSOLE_READER_KIND, isConsoleReaderConversation, isPlaywrightReaderConversation } from './types'

describe('console reader helpers', () => {

  it('isConsoleReaderConversation распознаёт только свой kind', () => {
    expect(isConsoleReaderConversation({ assistantKind: CONSOLE_READER_KIND })).toBe(true)
    expect(isConsoleReaderConversation({ assistantKind: 'playwright-reader' })).toBe(false)
    expect(isConsoleReaderConversation({ assistantKind: null })).toBe(false)
    // Списки reader/console не пересекаются.
    expect(isPlaywrightReaderConversation({ assistantKind: CONSOLE_READER_KIND })).toBe(false)
  })
})
