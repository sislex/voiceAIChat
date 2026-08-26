// Шина событий Make: изменения файлов проекта (REST-редактор пользователя или
// MCP-инструменты ассистента) уходят WS-кадром `make.changed` всем сокетам
// владельца разговора — панель перезагружает превью и дерево файлов. Сессия
// подписывается по имени пользователя (как relay превью), а владельца разговора
// для MCP-вызова (там есть только `conv`) даёт `ownerOf` из БД.

import type { ServerMessage } from '@voicechat/shared'

type Sink = (m: ServerMessage) => void

export class MakeHub {
  private readonly sinks = new Map<string, Set<Sink>>()

  subscribe(userId: string, sink: Sink): () => void {
    const set = this.sinks.get(userId) ?? new Set<Sink>()
    set.add(sink)
    this.sinks.set(userId, set)
    return () => {
      set.delete(sink)
      if (set.size === 0) this.sinks.delete(userId)
    }
  }

  changed(userId: string, conversationId: string, rev: number, paths: string[]): void {
    const set = this.sinks.get(userId)
    if (!set) return
    const message: ServerMessage = { t: 'make.changed', conversationId, rev, paths }
    for (const sink of [...set]) sink(message)
  }
}
