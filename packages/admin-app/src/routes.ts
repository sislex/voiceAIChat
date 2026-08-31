export type AdminTab = 'overview' | 'access' | 'machines' | 'usage' | 'history'

export type AdminRoute =
  | { page: 'users'; userName?: string; tab?: AdminTab }
  | { page: 'engines' }
  | { page: 'prices' }
  | { page: 'projectTypes' }
  /** Системные метрики: диск, машины, ролевые правила команд. В карточке
   *  человека им не место — это состояние установки, а не пользователя. */
  | { page: 'system' }

const tabs = new Set<AdminTab>(['overview', 'access', 'machines', 'usage', 'history'])

export function parseAdminRoute(hash: string): AdminRoute | null {
  const raw = hash.replace(/^#/, '').replace(/^\//, '').split('?')[0]
  const parts = raw.split('/').filter(Boolean)
  try {
    if (parts[0] !== 'users') return null
    if (parts.length === 1) return { page: 'users' }
    if (parts[1] === 'engines' && parts.length === 2) return { page: 'engines' }
    if (parts[1] === 'prices' && parts.length === 2) return { page: 'prices' }
    if (parts[1] === 'project-types' && parts.length === 2) return { page: 'projectTypes' }
    if (parts[1] === 'system' && parts.length === 2) return { page: 'system' }
    const userName = decodeURIComponent(parts[1] ?? '')
    if (!userName) return null
    if (parts.length === 2) return { page: 'users', userName }
    const tab = parts[2] as AdminTab
    return parts.length === 3 && tabs.has(tab) ? { page: 'users', userName, tab } : null
  } catch {
    return null
  }
}
export function buildAdminRoute(route: AdminRoute): string {
  if (route.page === 'engines') return '#/users/engines'
  if (route.page === 'prices') return '#/users/prices'
  if (route.page === 'projectTypes') return '#/users/project-types'
  if (route.page === 'system') return '#/users/system'
  const user = route.userName ? `/${encodeURIComponent(route.userName)}` : ''
  return `#/users${user}${route.tab ? `/${route.tab}` : ''}`
}
export function createAdminNavigationModel(hash: string) {
  const active = parseAdminRoute(hash)
  return {
    active,
    items: [
      { label: 'Пользователи', route: '#/users', active: active?.page === 'users' },
      { label: 'LLM engines', route: '#/users/engines', active: active?.page === 'engines' },
      { label: 'Model prices', route: '#/users/prices', active: active?.page === 'prices' },
      { label: 'Типы проектов', route: '#/users/project-types', active: active?.page === 'projectTypes' },
      { label: 'Система', route: '#/users/system', active: active?.page === 'system' }
    ]
  }
}
