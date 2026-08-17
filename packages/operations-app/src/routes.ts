export type OperationsRoute = { page: 'machines' } | { page: 'history'; engine: 'claude'|'codex' } | { page: 'knowledge'; documentId?: string } | { page: 'ci' }
export function parseOperationsRoute(hash: string): OperationsRoute | null {
  const value = hash.replace(/^#/, '').replace(/\/+$/, '') || '/'
  if (value === '/machines') return { page: 'machines' }
  if (value === '/claude-code') return { page: 'history', engine: 'claude' }
  if (value === '/codex') return { page: 'history', engine: 'codex' }
  if (value === '/ci') return { page: 'ci' }
  if (value === '/kb') return { page: 'knowledge' }
  const match = value.match(/^\/kb\/([^/]+)$/)
  if (match) { try { return { page: 'knowledge', documentId: decodeURIComponent(match[1]!) } } catch { return null } }
  return null
}
export function buildOperationsRoute(route: OperationsRoute): string {
  if (route.page === 'machines') return '#/machines'
  if (route.page === 'history') return route.engine === 'claude' ? '#/claude-code' : '#/codex'
  if (route.page === 'ci') return '#/ci'
  return route.documentId ? `#/kb/${encodeURIComponent(route.documentId)}` : '#/kb'
}
