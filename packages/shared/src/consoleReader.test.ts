import { describe, expect, it } from 'vitest'
import { CONSOLE_READER_KIND, consolePtyId, isConsoleReaderConversation, isPlaywrightReaderConversation } from './types'

describe('console reader helpers', () => {
  it('consolePtyId детерминирован и с префиксом console:', () => {
    expect(consolePtyId('abc')).toBe('console:abc')
    expect(consolePtyId('abc')).toBe(consolePtyId('abc'))
  })

  it('isConsoleReaderConversation распознаёт только свой kind', () => {
    expect(isConsoleReaderConversation({ assistantKind: CONSOLE_READER_KIND })).toBe(true)
    expect(isConsoleReaderConversation({ assistantKind: 'playwright-reader' })).toBe(false)
    expect(isConsoleReaderConversation({ assistantKind: null })).toBe(false)
    // Списки reader/console не пересекаются.
    expect(isPlaywrightReaderConversation({ assistantKind: CONSOLE_READER_KIND })).toBe(false)
  })
})
