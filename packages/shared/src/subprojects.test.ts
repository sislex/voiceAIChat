import { describe, expect, expectTypeOf, it } from 'vitest'
import { IPC_CHANNELS, type IpcArg, type IpcResult } from './ipc'
import { REST } from './protocol'
import { subprojectColumnFor, type Board, type KanbanColumn, type Project, type ProjectSummary, type ProjectSubprojectSummary, type Task } from './projects'

const column = (id: string, semanticType: KanbanColumn['semanticType'], hidden = false): KanbanColumn => ({
  id, semanticType, hidden, projectId: 'parent', name: id, position: 0, wipLimit: null, createdAt: 0
})

describe('subproject columns', () => {
  it('prefers the first semantic match, including a hidden match', () => {
    const columns = [column('fallback', 'backlog'), column('match', 'development', true), column('later', 'development')]
    expect(subprojectColumnFor('development', columns)).toBe(columns[1])
  })

  it('falls back to the first visible column in supplied board order without mutation', () => {
    const columns = Object.freeze([Object.freeze(column('hidden', 'custom', true)), Object.freeze(column('first', 'ready')), Object.freeze(column('second', 'backlog'))])
    expect(subprojectColumnFor('development', columns)).toBe(columns[1])
  })

  it('returns undefined when neither a match nor a visible fallback exists', () => {
    expect(subprojectColumnFor('done', [])).toBeUndefined()
    expect(subprojectColumnFor('done', [column('hidden', 'custom', true)])).toBeUndefined()
  })
})

describe('subproject transport contracts', () => {
  it('encodes the subprojects route and registers its IPC channel exactly once', () => {
    expect(REST.subprojects('parent /')).toBe('/api/projects/parent%20%2F/subprojects')
    expect(IPC_CHANNELS.filter(channel => channel === 'projects:subprojects')).toHaveLength(1)
    expectTypeOf<IpcResult<'projects:subprojects'>>().toEqualTypeOf<ProjectSubprojectSummary[]>()
    expectTypeOf<Project['parentProjectId']>().toEqualTypeOf<string | null>()
    expectTypeOf<ProjectSummary['subprojectCount']>().toEqualTypeOf<number>()
    expectTypeOf<IpcArg<'projects:update'>['parentProjectId']>().toEqualTypeOf<string | null | undefined>()
    expectTypeOf<Task['displayColumnId']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<Board['projects']>().toEqualTypeOf<{ id: string; name: string }[]>()
    expectTypeOf<IpcArg<'board:get'>>().toEqualTypeOf<IpcArg<'board:getStatuses'>>()
  })

  it('serializes the same selection for both loading phases and the board alias', () => {
    for (const [build, suffix] of [[REST.board, ''], [REST.projectBoard, ''], [REST.projectBoardStatuses, '/statuses']] as const) {
      const base = '/api/projects/p%2F1/board' + suffix
      expect(build('p/1')).toBe(base)
      expect(build('p/1', { projects: ['a', 'b'] })).toBe(base + '?projects=a,b')
      expect(build('p/1', { projects: ['p/1'] })).toBe(base + '?projects=p%2F1')
      expect(build('p/1', { projects: [] })).toBe(base + '?projects=')
      expect(build('p/1', { includeCompleted: true, projects: ['a&b', 'c #'] })).toBe(base + '?includeCompleted=1&projects=a%26b,c%20%23')
    }
  })

  it('preserves legacy boolean includeCompleted calls', () => {
    expect(REST.projectBoard('p', true)).toBe('/api/projects/p/board?includeCompleted=1')
    expect(REST.projectBoardStatuses('p', true)).toBe('/api/projects/p/board/statuses?includeCompleted=1')
    expect(REST.projectBoard('p', false)).toBe('/api/projects/p/board')
  })
})
