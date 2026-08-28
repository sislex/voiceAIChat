import { describe, expect, it } from 'vitest'
import { hasProjectPermission, projectPermissionForRequest, type ProjectPermission } from './auth'

// Матрица прав размазана по двум чистым функциям, и её легко сломать порядком правил:
// URL `/api/projects` попадает и под создание, и под общее «настройки проекта».
describe('матрица проектных полномочий', () => {
  it('создание своего проекта разрешено любой роли, остальное — по матрице', () => {
    for (const role of ['admin', 'developer', 'tester', 'observer'] as const) {
      expect(hasProjectPermission(role, 'project:create'), `${role} создаёт свой проект`).toBe(true)
    }
    expect(hasProjectPermission('developer', 'project:settings')).toBe(false)
    expect(hasProjectPermission('tester', 'task:create')).toBe(false)
    expect(hasProjectPermission('developer', 'task:create')).toBe(true)
    expect(hasProjectPermission('admin', 'production:deploy')).toBe(true)
  })

  it('POST /api/projects классифицируется как создание, а не как настройки', () => {
    const cases: Array<[string, string, ProjectPermission | null]> = [
      ['POST', '/api/projects', 'project:create'],
      // Тот же URL другими методами и вложенные пути остаются настройками владельца.
      ['PATCH', '/api/projects/p1', 'project:settings'],
      ['DELETE', '/api/projects/p1', 'project:settings'],
      ['POST', '/api/projects/p1/members', 'project:settings'],
      ['GET', '/api/projects', null],
      ['GET', '/api/projects/p1', null],
      ['POST', '/api/projects/p1/releases/deploy', 'production:deploy'],
      ['POST', '/api/projects/p1/releases/branches', 'release:prepare'],
      ['POST', '/api/projects/p1/tasks', 'task:create'],
      ['PATCH', '/api/projects/p1/tasks/t1', 'task:update'],
      ['POST', '/api/projects/p1/tasks/t1/merge', 'task:merge'],
      ['POST', '/api/projects/p1/tasks/t1/ci/run', 'workflow:start'],
      ['POST', '/api/admin/users', 'users:manage'],
      ['GET', '/api/projects/p1/machines/available', 'project:settings']
    ]
    for (const [method, url, expected] of cases) {
      expect(projectPermissionForRequest(method, url), `${method} ${url}`).toBe(expected)
    }
  })

  it('создание не путается с похожими путями', () => {
    // Ровно `/api/projects` и только POST. Любой другой метод по тому же адресу
    // остаётся настройками, а вложенный путь — своим правилом.
    expect(projectPermissionForRequest('PUT', '/api/projects')).toBe('project:settings')
    expect(projectPermissionForRequest('POST', '/api/projects/p1')).toBe('project:settings')
    // `/api/projects/` (слеш в конце) не классифицируется — и это безопасно:
    // Fastify поднят без ignoreTrailingSlash (server.ts:220), поэтому такой URL
    // не совпадает ни с одним роутом и отвечает 404 до всякой авторизации.
    // Проверка самого 404 — в routes/projects.test.ts.
    expect(projectPermissionForRequest('POST', '/api/projects/')).toBeNull()
  })
})
