export type AdminTab = 'overview' | 'access' | 'machines' | 'usage' | 'history'

/** Что видно в списке людей. Живёт в адресе: ссылкой на отфильтрованный список
 *  можно поделиться, а возврат «назад» не теряет выборку. */
export interface AdminUsersQuery {
  query?: string
  role?: string
  state?: 'online' | 'blocked'
  sort?: 'activity' | 'name' | 'spend'
  /** Обратный порядок: по умолчанию свежие и дорогие сверху. */
  asc?: boolean
}

export type AdminRoute =
  | { page: 'users'; userName?: string; tab?: AdminTab; list?: AdminUsersQuery }
  | { page: 'engines' }
  | { page: 'prices' }
  | { page: 'projectTypes' }
  /** Системные метрики: диск, машины, ролевые правила команд. В карточке
   *  человека им не место — это состояние установки, а не пользователя. */
  | { page: 'system' }

const tabs = new Set<AdminTab>(['overview', 'access', 'machines', 'usage', 'history'])

/** Разбор строки запроса списка; неизвестные значения игнорируются, а не ломают адрес. */
function parseList(search: string): AdminUsersQuery {
  const params = new URLSearchParams(search)
  const state = params.get('state')
  const sort = params.get('sort')
  return {
    ...(params.get('q') ? { query: params.get('q')! } : {}),
    ...(params.get('role') ? { role: params.get('role')! } : {}),
    ...(state === 'online' || state === 'blocked' ? { state } : {}),
    ...(sort === 'activity' || sort === 'name' || sort === 'spend' ? { sort } : {}),
    ...(params.get('asc') === '1' ? { asc: true } : {})
  }
}

function buildList(list: AdminUsersQuery | undefined): string {
  if (!list) return ''
  const params = new URLSearchParams()
  if (list.query) params.set('q', list.query)
  if (list.role && list.role !== 'all') params.set('role', list.role)
  if (list.state) params.set('state', list.state)
  if (list.sort && list.sort !== 'activity') params.set('sort', list.sort)
  if (list.asc) params.set('asc', '1')
  const text = params.toString()
  return text ? `?${text}` : ''
}

export function parseAdminRoute(hash: string): AdminRoute | null {
  const [path, search = ''] = hash.replace(/^#/, '').replace(/^\//, '').split('?')
  const raw = path
  const parts = raw.split('/').filter(Boolean)
  const list = parseList(search)
  const withList = <T extends { page: 'users' }>(route: T): T & { list?: AdminUsersQuery } =>
    Object.keys(list).length > 0 ? { ...route, list } : route
  try {
    if (parts[0] !== 'users') return null
    if (parts.length === 1) return withList({ page: 'users' })
    if (parts[1] === 'engines' && parts.length === 2) return { page: 'engines' }
    if (parts[1] === 'prices' && parts.length === 2) return { page: 'prices' }
    if (parts[1] === 'project-types' && parts.length === 2) return { page: 'projectTypes' }
    if (parts[1] === 'system' && parts.length === 2) return { page: 'system' }
    const userName = decodeURIComponent(parts[1] ?? '')
    if (!userName) return null
    if (parts.length === 2) return withList({ page: 'users', userName })
    const tab = parts[2] as AdminTab
    return parts.length === 3 && tabs.has(tab) ? withList({ page: 'users', userName, tab }) : null
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
  return `#/users${user}${route.tab ? `/${route.tab}` : ''}${buildList(route.list)}`
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
