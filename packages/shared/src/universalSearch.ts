/** Search contains display projections only; source objects keep their own API contracts. */
export const SEARCH_SOURCES = ['chats', 'messages', 'projects', 'tasks', 'files', 'kb'] as const
export type SearchSource = typeof SEARCH_SOURCES[number]
export const SEARCH_LABELS: Record<SearchSource, string> = {
  chats: 'Беседы', messages: 'Сообщения', projects: 'Проекты', tasks: 'Задачи', files: 'Make files', kb: 'База знаний'
}
export type SearchTarget =
  | { source: 'chats'; conversationId: string; route: string; projectId?: string }
  | { source: 'messages'; conversationId: string; messageId: string; route: string; projectId?: string }
  | { source: 'projects'; projectId: string }
  | { source: 'tasks'; projectId: string; taskId: string }
  | { source: 'files'; conversationId: string; path: string }
  | { source: 'kb'; documentId: string }
export interface SearchHit {
  id: string
  source: SearchSource
  title: string
  snippet: string
  target: SearchTarget
  href: string
}
export interface UniversalSearchRequest {
  query: string
  limit?: number
  cursor?: string | null
  /** Stable keys only; the server resolves and authorizes them again. */
  recent?: string[]
}
export interface UniversalSearchResult {
  groups: Array<{ source: SearchSource; hits: SearchHit[]; status: 'ok' | 'unavailable' }>
  nextCursor: string | null
}
export function searchHref(target: SearchTarget): string {
  const e = encodeURIComponent
  switch (target.source) {
    case 'chats':
    case 'messages': {
      const query = new URLSearchParams()
      if (target.route === 'kanban' && target.projectId) { query.set('scope', 'kanban'); query.set('project', target.projectId) }
      if (target.source === 'messages') query.set('message', target.messageId)
      return '#/' + (target.route === 'kanban' ? 'chat' : target.route) + '/' + e(target.conversationId) + (query.size ? '?' + query.toString() : '')
    }
    case 'projects': return '#/projects/' + e(target.projectId)
    case 'tasks': return '#/projects/' + e(target.projectId) + '/task/' + e(target.taskId)
    case 'files': return '#/make/' + e(target.conversationId) + '?file=' + e(target.path)
    case 'kb': return '#/kb/' + e(target.documentId)
  }
}

/** Drop sensitive lines before matching: a query must not act as a secret oracle. */
export function searchText(value: string): string {
  return value.replace(/-----BEGIN[\s\S]*?-----END[^\n]*-----/g, '')
    .replace(/<(script|style|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .split(/\r?\n/)
    .filter(line => !/(?:secret|password|passwd|api[_ -]?key|access[_ -]?token|token|authorization|bearer|private[_ -]?key|credential)["']?\s*[:=]|\bbearer\s+\S+|-----BEGIN|\b(?:sk-|gh[pousr]_|github_pat_|AKIA)[a-zA-Z0-9_-]+|\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.|:\/\/[^\s/]+:[^\s/]+@/i.test(line))
    .map(line => line.replace(/<[^>]*>/g, '').replace(/(?:javascript|data|vbscript):\S*/gi, ''))
    .join(' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
}
