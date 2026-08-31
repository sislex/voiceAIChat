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

  it('терпит хвостовой слеш и форму с решёткой — оба приходят из адресной строки', () => {
    expect(parseChatRoute('#/chat/a/')).toEqual({ kind: 'chat', conversationId: 'a' })
    expect(parseChatRoute('#/')).toEqual({ kind: 'new-chat' })
    expect(parseChatRoute('')).toEqual({ kind: 'new-chat' })
  })

  it('битый percent-encoding не роняет разбор, а даёт null', () => {
    // decodeURIComponent на '%' бросает — маршрут обязан вернуть null, а не упасть.
    expect(parseChatRoute('/chat/%')).toBeNull()
    expect(parseChatRoute('/chat/ok/context/%E0%A4%A')).toBeNull()
  })

  it('чужой первый сегмент и неизвестная форма из четырёх частей отбрасываются', () => {
    expect(parseChatRoute('/settings/a')).toBeNull()
    expect(parseChatRoute('/chat/a/unknown/b')).toBeNull()
  })

  it('новый чат собирается в корень', () => {
    expect(buildChatRoute({ kind: 'new-chat' })).toBe('/')
    expect(buildChatRoute({ kind: 'chat', conversationId: 'a b' })).toBe('/chat/a%20b')
  })

  it('разбор и сборка обратны друг другу', () => {
    for (const route of [
      { kind: 'new-chat' } as const,
      { kind: 'chat', conversationId: 'дом/1' } as const,
      { kind: 'context-item', conversationId: 'дом/1', itemId: 'п 2' } as const
    ]) {
      expect(parseChatRoute(buildChatRoute(route))).toEqual(route)
    }
  })
  it('адрес вкладки контекста разбирается и собирается: раньше ссылка вела в обычный чат', () => {
    // `/chat/:id/context` (и с хвостовым слэшем) — сама вкладка «Контекст и
    // инструкции». До этого такой адрес не разбирался вовсе: скопированная
    // ссылка «на вкладку» открывала чат, а не экран, о котором шла речь.
    expect(parseChatRoute('/chat/c1/context')).toEqual({ kind: 'context-tab', conversationId: 'c1' })
    expect(parseChatRoute('/chat/c1/context/')).toEqual({ kind: 'context-tab', conversationId: 'c1' })
    expect(parseChatRoute('#/chat/c1/context')).toEqual({ kind: 'context-tab', conversationId: 'c1' })
    expect(buildChatRoute({ kind: 'context-tab', conversationId: 'c1' })).toBe('/chat/c1/context')
    // Конкретный источник по-прежнему свой вид маршрута.
    expect(parseChatRoute('/chat/c1/context/personalization')).toEqual({ kind: 'context-item', conversationId: 'c1', itemId: 'personalization' })
  })
})
