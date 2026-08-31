import { buildProjectsRoute, parseProjectsRoute, type ProjectsRoute } from './projectsRoute'

const routes: ProjectsRoute[] = [
  { kind: 'index' },
  { kind: 'board', projectId: 'p 1' },
  { kind: 'settings', projectId: 'p1' },
  { kind: 'releases', projectId: 'p1' },
  { kind: 'code', projectId: 'p1' },
  { kind: 'code', projectId: 'p1', workspaceId: 'ws:ws 1' },
  { kind: 'assistant', projectId: 'p1' },
  { kind: 'task', projectId: 'p1', taskId: 't/1' },
  { kind: 'task-preparation', projectId: 'p1', taskId: 't1' },
  { kind: 'task-chat', projectId: 'p1', taskId: 't1', conversationId: 'c1' }
]
describe('projects route', () => {
  it.each(routes)('round-trips $kind', (route) => expect(parseProjectsRoute(buildProjectsRoute(route))).toEqual(route))
  it('accepts hashes and rejects non-project and excess routes', () => {
    expect(parseProjectsRoute('#/projects/p1/task/t1')).toEqual({ kind: 'task', projectId: 'p1', taskId: 't1' })
    expect(parseProjectsRoute('/chat/c1')).toBeNull()
    expect(parseProjectsRoute('/projects/p1/settings/nope')).toBeNull()
    // У раздела «Код» второй сегмент — id рабочей копии; третьего сегмента нет.
    expect(parseProjectsRoute('/projects/p1/code')).toEqual({ kind: 'code', projectId: 'p1' })
    expect(parseProjectsRoute('/projects/p1/code/ws%3Aws-1')).toEqual({ kind: 'code', projectId: 'p1', workspaceId: 'ws:ws-1' })
    expect(parseProjectsRoute('/projects/p1/code/ws-1/extra')).toBeNull()
  })
})
