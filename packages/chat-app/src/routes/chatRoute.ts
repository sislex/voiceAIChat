export type ChatRoute =
  | { kind: 'new-chat' }
  | { kind: 'chat'; conversationId: string }
  | { kind: 'settings'; conversationId: string; tab: 'general' | 'context' }
  /** Старый адрес контекста; App заменяет его каноническим settings/context. */
  | { kind: 'legacy-context'; conversationId: string }

function decode(value: string): string | null {
  try { return decodeURIComponent(value) } catch { return null }
}

export function parseChatRoute(path: string): ChatRoute | null {
  const clean = path.replace(/^#?\/?/, '').replace(/\/$/, '')
  const parts = clean ? clean.split('/') : []
  if (parts.length === 0 || (parts.length === 1 && parts[0] === 'new-chat')) return { kind: 'new-chat' }
  if (parts[0] !== 'chat') return null
  const conversationId = parts[1] ? decode(parts[1]) : null
  if (!conversationId) return null
  if (parts.length === 2) return { kind: 'chat', conversationId }
  if (parts.length === 3 && parts[2] === 'context') return { kind: 'legacy-context', conversationId }
  if (parts.length === 4 && parts[2] === 'settings' && (parts[3] === 'general' || parts[3] === 'context')) return { kind: 'settings', conversationId, tab: parts[3] }
  return null
}

export function buildChatRoute(route: ChatRoute): string {
  if (route.kind === 'new-chat') return '/'
  const base = '/chat/' + encodeURIComponent(route.conversationId)
  if (route.kind === 'settings') return base + '/settings/' + route.tab
  return route.kind === 'legacy-context' ? base + '/context' : base
}
