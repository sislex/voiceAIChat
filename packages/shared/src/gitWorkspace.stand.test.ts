import { describe, expect, it } from 'vitest'
import { buildGitWorkspaceId, parseGitWorkspaceId } from './gitWorkspace'
const uuid = '11111111-1111-4111-8111-111111111111'
describe('stand workspace ids', () => {
  it('round trips three UUIDs', () => {
    const ref = { kind: 'make-stand' as const, conversationId: uuid, hostProjectId: uuid, standId: uuid }
    expect(parseGitWorkspaceId(buildGitWorkspaceId(ref))).toEqual(ref)
  })
  it.each(['', uuid, uuid + '/' + uuid, [uuid, uuid, uuid, uuid].join('/'), [uuid, '..', uuid].join('/'), [uuid, uuid, uuid + '\n'].join('/'), [uuid, uuid, 'x'].join('/')])('rejects malformed suffix %s', value => {
    expect(parseGitWorkspaceId('stand:' + value)).toBeNull()
  })
  it('rejects malformed builder input', () => {
    expect(() => buildGitWorkspaceId({ kind: 'make-stand', conversationId: '', hostProjectId: uuid, standId: uuid })).toThrow()
  })
})

