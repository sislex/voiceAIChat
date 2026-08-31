import { describe, expect, it } from 'vitest'
import { hasProjectPermission, projectFeatureForRequest, projectPermissionForRequest, type ProjectPermission } from './auth'
import type { ProjectFeature } from '@voicechat/shared'

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
      // Свои данные не админские: человек вправе знать о себе то же, что знает о нём админ.
      ['GET', '/api/me/profile', null],
      ['GET', '/api/me/security', null],
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

// Возможности задаёт тип проекта. Карта URL — единственное место, где подсистема
// сопоставляется адресу, поэтому её полнота проверяется таблицей.
describe('карта URL → возможность проекта', () => {
  it('адреса подсистем классифицируются', () => {
    const cases: Array<[string, ProjectFeature | null]> = [
      ['/api/projects/p1/releases', 'releases'],
      ['/api/projects/p1/releases/deploy', 'releases'],
      ['/api/projects/p1/production/bootstrap', 'releases'],
      ['/api/projects/p1/machines', 'machines'],
      ['/api/projects/p1/machines/a1/share', 'machines'],
      ['/api/projects/p1/default-machine', 'machines'],
      ['/api/projects/p1/tasks/t1/merge', 'git'],
      ['/api/projects/p1/tasks/t1/merge/runs', 'git'],
      ['/api/projects/p1/tasks/t1/qa', 'qa'],
      ['/api/projects/p1/tasks/t1/qa/sessions', 'qa'],
      ['/api/projects/p1/tasks/t1/preview', 'preview'],
      ['/api/projects/p1/ci', 'ci'],
      ['/api/projects/p1/ci/llm', 'ci'],
      ['/api/projects/p1/improvements/tasks', 'ci'],
      ['/api/projects/p1/tasks/t1/ci/run', 'ci'],
      ['/api/projects/p1/tasks/t1/improvements', 'ci']
    ]
    for (const [url, expected] of cases) expect(projectFeatureForRequest('POST', url), url).toBe(expected)
  })

  it('доска, задачи, участники и сам проект к возможностям не привязаны', () => {
    for (const url of [
      '/api/projects',
      '/api/projects/p1',
      '/api/projects/p1/board',
      '/api/projects/p1/tasks',
      '/api/projects/p1/tasks/t1',
      '/api/projects/p1/columns',
      '/api/projects/p1/members'
    ]) {
      expect(projectFeatureForRequest('POST', url), url).toBeNull()
    }
  })

  it('адреса без проекта в пути не гейтятся — projectId там взять неоткуда', () => {
    // Их создание перекрыто выше по цепочке, поэтому пропуск безопасен.
    for (const url of ['/api/ci/runs/r1/retry', '/api/merge/runs/r1/retry', '/api/qa/runs/r1', '/api/admin/users']) {
      expect(projectFeatureForRequest('POST', url), url).toBeNull()
    }
  })
})
