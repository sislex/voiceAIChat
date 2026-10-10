import { describe, expect, it, vi } from 'vitest'
import { DEV_COMPONENT_IDS, DEV_COMPONENT_REGISTRY } from '@voicechat/shared'
import { GitWorkspaceService } from './workspaceService.js'
const conversationId = '11111111-1111-4111-8111-111111111111'
const hostProjectId = '22222222-2222-4222-8222-222222222222'
const standId = '33333333-3333-4333-8333-333333333333'
const workspace = 'stand:' + [conversationId, hostProjectId, standId].join('/')
function fixture() {
  const component = DEV_COMPONENT_IDS[0]!
  const chat = { getConversation: vi.fn(async () => ({ assistantKind: 'make' })), conversationOwner: vi.fn(async () => 'alice'), makeConversationProject: vi.fn(async () => 'project') }
  const canUseAgent = vi.fn(async (_user: string, _machine: string, _project: string) => true)
  const getStand = vi.fn(async () => ({ standId, machineId: 'machine', live: [{ component, workingCopyPath: '/live/conversation', branch: 'make/story' }] }))
  const service = new GitWorkspaceService({
    db: { chat, projects: { getProject: async (_user: string, id: string) => ({ id, gitUrl: 'https://github.com/' + DEV_COMPONENT_REGISTRY[component].repository + '.git', machines: [] }) },
      identity: { getUser: async () => ({ role: 'developer' }) },
      machines: { canUseAgent, canWriteAgent: async () => true } } as never,
    runtime: { isOnline: () => true, nameOf: () => 'Machine', policyOf: () => ({ allowWrite: true }) } as never,
    getStand
  })
  return { chat, getStand, canUseAgent, resolve: (write = false) => service.resolve('alice', 'project', workspace, { write }) }
}
describe('Make stand workspace resolution', () => {
  it('resolves the live repository using the user and host project', async () => {
    const f = fixture()
    expect(await f.resolve(true)).toMatchObject({ kind: 'project-worktree', conversationId, projectId: 'project', path: '/live/conversation', expectedBranch: 'make/story', agentId: 'machine', online: true, writable: true })
    expect(f.getStand).toHaveBeenCalledWith('alice', hostProjectId, standId)
  })
  it.each(['owner', 'project', 'missing'] as const)('hides %s mismatch before Kanban', async mismatch => {
    const f = fixture()
    if (mismatch === 'owner') f.chat.conversationOwner.mockResolvedValue('bob')
    if (mismatch === 'project') f.chat.makeConversationProject.mockResolvedValue('other')
    if (mismatch === 'missing') f.chat.getConversation.mockResolvedValue(null as never)
    await expect(f.resolve()).rejects.toMatchObject({ status: 404, code: 'workspace_not_found' })
    expect(f.getStand).not.toHaveBeenCalled()
  })
  it('rejects a stand without the matching live entry', async () => {
    const f = fixture(); f.getStand.mockResolvedValue({ standId, machineId: 'machine', live: [] })
    await expect(f.resolve()).rejects.toMatchObject({ status: 409, code: 'stand_not_live' })
  })
  it('maps Kanban 404', async () => {
    const f = fixture(); f.getStand.mockRejectedValue(Object.assign(new Error('missing'), { statusCode: 404 }))
    await expect(f.resolve()).rejects.toMatchObject({ status: 404, code: 'workspace_not_found' })
  })
  it('falls back to host machine access', async () => {
    const f = fixture(); f.canUseAgent.mockImplementation(async (_u, _m, project) => project === hostProjectId)
    expect(await f.resolve(true)).toMatchObject({ writable: true })
  })
})

