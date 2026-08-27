// Шина событий Make: изменения файлов проекта (REST-редактор пользователя или
// MCP-инструменты ассистента) уходят WS-кадром `make.changed` всем сокетам
// владельца разговора — панель перезагружает превью и дерево файлов. Сессия
// подписывается по имени пользователя (как relay превью), а владельца разговора
// для MCP-вызова (там есть только `conv`) даёт `ownerOf` из БД.

import type { MakePresenceClient, ServerMessage } from '@voicechat/shared'

/** Вкладка без heartbeat дольше этого считается закрытой (heartbeat — раз в 15 с). */
export const PRESENCE_TTL_MS = 45_000

type Sink = (m: ServerMessage) => void

export class MakeHub {
  private readonly sinks = new Map<string, Set<Sink>>()
  /** Снимок «До правок» по id хода (roadmap-2 п.2): ход кладёт его в meta ответа, чат показывает «Откатить правки». */
  private readonly turnSnapshots = new Map<string, string>()

  rememberTurnSnapshot(turn: string, snapshotId: string): void {
    if (this.turnSnapshots.size > 5_000) this.turnSnapshots.clear()
    this.turnSnapshots.set(turn, snapshotId)
  }

  turnSnapshot(turn: string): string | undefined {
    return this.turnSnapshots.get(turn)
  }

  /** Presence (roadmap-2 п.14): живые вкладки по разговору; запись живёт PRESENCE_TTL_MS с последнего heartbeat. */
  private readonly presence = new Map<string, Map<string, MakePresenceClient>>()

  heartbeat(conversationId: string, client: MakePresenceClient, leave = false): MakePresenceClient[] {
    const map = this.presence.get(conversationId) ?? new Map<string, MakePresenceClient>()
    if (leave) map.delete(client.clientId); else map.set(client.clientId, client)
    const now = client.at
    for (const [id, c] of map) if (now - c.at > PRESENCE_TTL_MS) map.delete(id)
    if (map.size === 0) this.presence.delete(conversationId); else this.presence.set(conversationId, map)
    return [...map.values()].sort((a, b) => a.at - b.at)
  }

  broadcastPresence(userId: string, conversationId: string, clients: MakePresenceClient[]): void {
    const set = this.sinks.get(userId)
    if (!set) return
    const message: ServerMessage = { t: 'make.presence', conversationId, clients }
    for (const sink of [...set]) sink(message)
  }

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
