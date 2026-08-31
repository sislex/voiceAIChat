export type ChatRoute =
  | { kind: 'new-chat' }
  | { kind: 'chat'; conversationId: string }
  /** Вкладка «Контекст и инструкции» без выбранного источника. */
  | { kind: 'context-tab'; conversationId: string }
  | { kind: 'context-item'; conversationId: string; itemId: string }

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
  // `/chat/:id/context` и `/chat/:id/context/` — сама вкладка контекста.
  // Раньше такой адрес не разбирался вовсе, и ссылка «на вкладку» открывала
  // обычный чат: окно настроек открывается по маршруту, а не отдельным флагом.
  if (parts.length === 3 && parts[2] === 'context') return { kind: 'context-tab', conversationId }
  if (parts.length === 4 && parts[2] === 'context') {
    const itemId = decode(parts[3])
    return itemId ? { kind: 'context-item', conversationId, itemId } : null
  }
  return null
}

export function buildChatRoute(route: ChatRoute): string {
  if (route.kind === 'new-chat') return '/'
  const base = '/chat/' + encodeURIComponent(route.conversationId)
  if (route.kind === 'context-item') return base + '/context/' + encodeURIComponent(route.itemId)
  return route.kind === 'context-tab' ? base + '/context' : base
}
