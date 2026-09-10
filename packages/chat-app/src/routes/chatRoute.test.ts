import { describe, expect, it } from 'vitest'
import { buildChatRoute, parseChatRoute } from './chatRoute'

describe('chat routes', () => {
  // @testCase TC-REG-01
  it('parses canonical settings routes and the legacy context redirect', () => {
    expect(parseChatRoute('/')).toEqual({ kind: 'new-chat' })
    expect(parseChatRoute('/new-chat')).toEqual({ kind: 'new-chat' })
    expect(parseChatRoute('/chat/a%20b')).toEqual({ kind: 'chat', conversationId: 'a b' })
    expect(parseChatRoute('/chat/c%2F1/settings/general')).toEqual({ kind: 'settings', conversationId: 'c/1', tab: 'general' })
    expect(parseChatRoute('/chat/c/settings/context')).toEqual({ kind: 'settings', conversationId: 'c', tab: 'context' })
    expect(parseChatRoute('/chat/c/context')).toEqual({ kind: 'legacy-context', conversationId: 'c' })
  })
  it('rejects malformed routes and builds encoded routes', () => {
    expect(parseChatRoute('/chat')).toBeNull()
    expect(parseChatRoute('/chat/a/extra')).toBeNull()
    expect(buildChatRoute({ kind: 'settings', conversationId: 'a b', tab: 'context' })).toBe('/chat/a%20b/settings/context')
  })

  it('терпит хвостовой слеш и форму с решёткой — оба приходят из адресной строки', () => {
    expect(parseChatRoute('#/chat/a/')).toEqual({ kind: 'chat', conversationId: 'a' })
    expect(parseChatRoute('#/')).toEqual({ kind: 'new-chat' })
    expect(parseChatRoute('')).toEqual({ kind: 'new-chat' })
  })

  it('битый percent-encoding не роняет разбор, а даёт null', () => {
    // decodeURIComponent на '%' бросает — маршрут обязан вернуть null, а не упасть.
    expect(parseChatRoute('/chat/%')).toBeNull()
    expect(parseChatRoute('/chat/ok/settings/%E0%A4%A')).toBeNull()
  })

  it('чужой первый сегмент и неизвестная форма из четырёх частей отбрасываются', () => {
    expect(parseChatRoute('/settings/a')).toBeNull()
    expect(parseChatRoute('/chat/a/unknown/b')).toBeNull()
  })

  it('новый чат собирается в корень', () => {
    expect(buildChatRoute({ kind: 'new-chat' })).toBe('/')
    expect(buildChatRoute({ kind: 'chat', conversationId: 'a b' })).toBe('/chat/a%20b')
  })

  it('разбор и сборка обратны друг другу для канонических settings URL', () => {
    for (const route of [
      { kind: 'new-chat' } as const,
      { kind: 'chat', conversationId: 'дом/1' } as const,
      { kind: 'settings', conversationId: 'дом/1', tab: 'general' } as const,
      { kind: 'settings', conversationId: 'дом/1', tab: 'context' } as const
    ]) expect(parseChatRoute(buildChatRoute(route))).toEqual(route)
    expect(parseChatRoute('/chat/c1/settings/unknown')).toBeNull()
  })
})
