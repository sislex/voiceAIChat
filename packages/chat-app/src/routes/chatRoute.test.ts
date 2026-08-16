import { describe, expect, it } from 'vitest'
import { buildChatRoute, parseChatRoute } from './chatRoute'

describe('chat routes', () => {
  it('parses new, chat and context deep links', () => {
    expect(parseChatRoute('/')).toEqual({ kind: 'new-chat' })
    expect(parseChatRoute('/new-chat')).toEqual({ kind: 'new-chat' })
    expect(parseChatRoute('/chat/a%20b')).toEqual({ kind: 'chat', conversationId: 'a b' })
    expect(parseChatRoute('/chat/c/context/item%2F1')).toEqual({ kind: 'context-item', conversationId: 'c', itemId: 'item/1' })
  })
  it('rejects malformed routes and builds encoded routes', () => {
    expect(parseChatRoute('/chat')).toBeNull()
    expect(parseChatRoute('/chat/a/extra')).toBeNull()
    expect(buildChatRoute({ kind: 'context-item', conversationId: 'a b', itemId: 'x/y' })).toBe('/chat/a%20b/context/x%2Fy')
  })
})
