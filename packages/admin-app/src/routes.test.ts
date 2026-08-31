import { describe, expect, it } from 'vitest'
import { buildAdminRoute, parseAdminRoute } from './routes'

describe('admin routes', () => {
  it.each(['#/users', '#/users/alice', '#/users/alice/overview', '#/users/alice/access', '#/users/alice/machines', '#/users/alice/usage', '#/users/alice/history', '#/users/engines', '#/users/prices', '#/users/project-types', '#/users/system'])(
    'round trips %s',
    (hash) => {
      const route = parseAdminRoute(hash)
      expect(route).not.toBeNull()
      expect(buildAdminRoute(route!)).toBe(hash)
    }
  )
  it('фильтр списка живёт в адресе и переживает round trip', () => {
    const hash = '#/users?q=мар&role=developer&state=online&sort=spend&asc=1'
    const route = parseAdminRoute(hash)
    expect(route).toMatchObject({ page: 'users', list: { query: 'мар', role: 'developer', state: 'online', sort: 'spend', asc: true } })
    expect(parseAdminRoute(buildAdminRoute(route!))).toEqual(route)
  })

  it('фильтр не мешает разбирать вкладку и не тащит значения по умолчанию', () => {
    expect(parseAdminRoute('#/users/alice/usage?q=bob')).toMatchObject({ page: 'users', userName: 'alice', tab: 'usage', list: { query: 'bob' } })
    // `role=all` и `sort=activity` — значения по умолчанию: в адрес не пишутся.
    expect(buildAdminRoute({ page: 'users', list: { role: 'all', sort: 'activity' } })).toBe('#/users')
  })

  it('мусор в строке запроса игнорируется, а не ломает адрес', () => {
    expect(parseAdminRoute('#/users?state=nonsense&sort=bogus')).toEqual({ page: 'users' })
  })

  it('rejects malformed and unrelated routes', () => {
    expect(parseAdminRoute('#/projects')).toBeNull()
    expect(parseAdminRoute('#/users/a/console')).toBeNull()
    expect(parseAdminRoute('#/users/%E0%A4%A')).toBeNull()
  })
})
