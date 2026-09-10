// Make event hub: REST editor and assistant MCP file changes reach the conversation owner's sockets
// as make.changed so panels refresh previews and file trees. Sessions subscribe by username; MCP
// has only conv, so ownerOf resolves ownership from the database.

import type { MakePresenceClient, ServerMessage } from '@voicechat/shared'

/** Treat tabs without a heartbeat for this long as closed; heartbeats arrive every 15 seconds. */
export const PRESENCE_TTL_MS = 45_000

type Sink = (m: ServerMessage) => void

/**
 * Portable hub events: standalone Make sends them to core, which replays them with apply because
 * core owns user sockets.
 */
export type MakeHubEvent =
  | { kind: 'changed'; userId: string; conversationId: string; rev: number; paths: string[] }
  | { kind: 'presence'; userId: string; conversationId: string; clients: MakePresenceClient[] }
  | { kind: 'turnSnapshot'; turn: string; snapshotId: string }

export class MakeHub {
  private readonly sinks = new Map<string, Set<Sink>>()
  /** Pre-edit snapshot keyed by turn ID (roadmap-2, item 2): the turn adds it to response metadata so chat can offer restoration. */
  private readonly turnSnapshots = new Map<string, string>()
  private listener: ((event: MakeHubEvent) => void) | null = null

  /** Event relay, using HTTP to core in standalone mode. apply bypasses it to prevent loops. */
  setListener(listener: ((event: MakeHubEvent) => void) | null): void { this.listener = listener }

  /** Replay an event received from another process. */
  apply(event: MakeHubEvent): void {
    if (event.kind === 'changed') this.emitChanged(event.userId, event.conversationId, event.rev, event.paths)
    else if (event.kind === 'presence') this.emitPresence(event.userId, event.conversationId, event.clients)
    else this.storeTurnSnapshot(event.turn, event.snapshotId)
  }

  rememberTurnSnapshot(turn: string, snapshotId: string): void {
    this.storeTurnSnapshot(turn, snapshotId)
    this.listener?.({ kind: 'turnSnapshot', turn, snapshotId })
  }

  private storeTurnSnapshot(turn: string, snapshotId: string): void {
    if (this.turnSnapshots.size > 5_000) this.turnSnapshots.clear()
    this.turnSnapshots.set(turn, snapshotId)
  }

  turnSnapshot(turn: string): string | undefined {
    return this.turnSnapshots.get(turn)
  }

  /** Presence (roadmap-2, item 14): active tabs per conversation, retained for PRESENCE_TTL_MS after their latest heartbeat. */
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
    this.emitPresence(userId, conversationId, clients)
    this.listener?.({ kind: 'presence', userId, conversationId, clients })
  }

  private emitPresence(userId: string, conversationId: string, clients: MakePresenceClient[]): void {
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
    this.emitChanged(userId, conversationId, rev, paths)
    this.listener?.({ kind: 'changed', userId, conversationId, rev, paths })
  }

  private emitChanged(userId: string, conversationId: string, rev: number, paths: string[]): void {
    const set = this.sinks.get(userId)
    if (!set) return
    const message: ServerMessage = { t: 'make.changed', conversationId, rev, paths }
    for (const sink of [...set]) sink(message)
  }
}
