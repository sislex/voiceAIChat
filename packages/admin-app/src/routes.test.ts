import { describe, expect, it } from 'vitest'
import { buildAdminRoute, parseAdminRoute } from './routes'

describe('admin routes', () => {
  it.each(['#/users', '#/users/alice', '#/users/alice/access', '#/users/alice/machines', '#/users/alice/usage', '#/users/alice/history', '#/users/engines', '#/users/prices'])(
    'round trips %s',
    (hash) => {
      const route = parseAdminRoute(hash)
      expect(route).not.toBeNull()
      expect(buildAdminRoute(route!)).toBe(hash)
    }
  )
  it('rejects malformed and unrelated routes', () => {
    expect(parseAdminRoute('#/projects')).toBeNull()
    expect(parseAdminRoute('#/users/a/console')).toBeNull()
    expect(parseAdminRoute('#/users/%E0%A4%A')).toBeNull()
  })
})
