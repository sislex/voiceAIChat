import { describe, expect, it } from 'vitest'
import { buildGitWorkspaceId, parseGitWorkspaceId } from './gitWorkspace'
const uuid = '11111111-1111-4111-8111-111111111111'
const standId = 'dev-5b9d0ce6-61b'
describe('stand workspace ids', () => {
  it('round trips two UUIDs and a Kanban stand id', () => {
    const ref = { kind: 'make-stand' as const, conversationId: uuid, hostProjectId: uuid, standId }
    expect(parseGitWorkspaceId(buildGitWorkspaceId(ref))).toEqual(ref)
  })
  it.each(['', uuid, uuid + '/' + uuid, [uuid, uuid, uuid, uuid].join('/'), [uuid, '..', uuid].join('/'), [uuid, uuid, standId + '\n'].join('/'), [uuid, uuid, '.hidden'].join('/'), [uuid, uuid, 'a/b'].join('/'), [uuid, 'dev-1', standId].join('/'), [uuid, uuid, 'x'.repeat(65)].join('/')])('rejects malformed suffix %s', value => {
    expect(parseGitWorkspaceId('stand:' + value)).toBeNull()
  })
  it('rejects malformed builder input', () => {
    expect(() => buildGitWorkspaceId({ kind: 'make-stand', conversationId: '', hostProjectId: uuid, standId: uuid })).toThrow()
  })
})

