import { describe, expect, it, vi } from 'vitest'
import type { VoiceChatDb } from '../db/database.js'
import { GitError, type GitWorkspaceService } from '../git/workspaceService.js'
import { MakeProjectAdapters } from './projectAdapters.js'
import { MakeRequestAuthority } from './requestAuthority.js'

const args = { targetProjectId: 'p', targetRepository: 'core-ui' as const, title: 'New button', files: ['src/Button.tsx'], designConversationId: 'design' }
function fixture() {
  const user = { name: 'alice', role: 'developer' as const, blocked: false }
  const project = { id: 'p', gitUrl: 'git@github.com:sislex/sislexa-core-ui.git', defaultAgentId: 'agent',
    machines: [{ agentId: 'agent', canUse: true, path: '/old', directories: { projectWorkdir: { path: '/work/core-ui' } } }] }
  const db = {
    identity: { getUser: vi.fn(async () => user) },
    projects: { getProject: vi.fn(async () => project) },
    environments: { listEnvironments: vi.fn(async () => [{ id: 'base', machines: ['agent'] }]) },
    chat: { getConversation: vi.fn(async () => ({ assistantKind: 'make' })), conversationOwner: vi.fn(async () => 'alice') },
    tasks: { getBoard: vi.fn(async () => ({ columns: [{ id: 'merge', semanticType: 'awaiting_merge' }, { id: 'backlog', semanticType: 'backlog' }] })),
      createTask: vi.fn(async () => ({ id: 'task' })), linkTaskDesign: vi.fn(async () => []), moveTask: vi.fn(async () => ({ id: 'task' })) },
    ci: { createCiWorkspace: vi.fn(async () => ({ id: 'ci' })), updateCiWorkspaceRevision: vi.fn() }
  }
  const git = { resolve: vi.fn(async () => ({ agentId: 'agent', path: '/work/core-ui' })),
    status: vi.fn(async () => ({ problem: null, branch: 'main', changes: [] as unknown[] })),
    createBranch: vi.fn(), saveFile: vi.fn(), commit: vi.fn(async () => ({ sha: 'commit' })),
    push: vi.fn(async () => ({ sha: 'pushed' })), checkout: vi.fn() }
  const stand = { standId: 'stand', machineId: 'agent', gateway: { urls: ['http://stand.test'] } }
  const authority = new MakeRequestAuthority(async () => user)
  const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
    expect(init?.redirect).toBe('error')
    return Response.json(stand)
  })
  const readDesignFile = vi.fn(async () => 'export const Button = () => null')
  const boardChanged = vi.fn()
  const adapter = new MakeProjectAdapters({ db: db as unknown as VoiceChatDb, git: git as unknown as GitWorkspaceService,
    kanbanUrl: 'http://kanban.test', authority, fetchImpl, readDesignFile, boardChanged })
  return { adapter, db, git, stand, project, user, authority, fetchImpl, readDesignFile, boardChanged }
}

describe('Make stand adapter', () => {
  it('reuses a stand on the project machine and returns its gateway', async () => {
    const f = fixture()
    f.fetchImpl.mockResolvedValueOnce(Response.json([f.stand]))
    expect(await f.adapter.standPreview('alice', 'p', { op: 'start', subprojectPath: '.' }))
      .toEqual({ standId: 'stand', status: 'running', url: 'http://stand.test' })
    expect(f.fetchImpl).toHaveBeenCalledTimes(2)
    expect(f.fetchImpl.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  })

  it('creates a stand with the project machine and base environment, on behalf of the user', async () => {
    const f = fixture()
    f.fetchImpl.mockResolvedValueOnce(Response.json([]))
    f.fetchImpl.mockImplementationOnce(async (url, init) => {
      expect(await f.authority.authenticate({ method: 'POST', url: new URL(String(url)).pathname,
        headers: { authorization: new Headers(init?.headers).get('authorization')! } })).toMatchObject({ ok: true, user: { name: 'alice' } })
      expect(JSON.parse(String(init?.body))).toEqual({ machineId: 'agent', baseEnvironmentId: 'base' })
      return Response.json(f.stand, { status: 202 })
    })
    expect(await f.adapter.standPreview('alice', 'p', { op: 'start', subprojectPath: '.' })).toMatchObject({ status: 'starting' })
    expect(f.fetchImpl).toHaveBeenCalledTimes(3)
  })

  it.each(['live_on', 'live_off'] as const)('%s uses the stand machine working copy', async op => {
    const f = fixture()
    await f.adapter.standPreview('alice', 'p', { op, subprojectPath: '.', component: 'core-ui', standId: 'stand' })
    expect(f.fetchImpl).toHaveBeenNthCalledWith(2, 'http://kanban.test/api/projects/p/dev-stands/stand/components/core-ui/live',
      expect.objectContaining({ method: op === 'live_on' ? 'POST' : 'DELETE',
        ...(op === 'live_on' ? { body: JSON.stringify({ workingCopyPath: '/work/core-ui' }) } : {}) }))
  })

  it('does not start a stand when asking for status', async () => {
    const f = fixture(); f.fetchImpl.mockResolvedValueOnce(Response.json([]))
    expect(await f.adapter.standPreview('alice', 'p', { op: 'status', subprojectPath: '.' }))
      .toEqual({ standId: null, status: 'stopped', url: null })
  })

  it.each([403, 404, 409])('preserves Kanban HTTP %s', async status => {
    const f = fixture(); f.fetchImpl.mockResolvedValueOnce(Response.json({ error: 'kanban_error' }, { status }))
    await expect(f.adapter.standPreview('alice', 'p', { op: 'url', subprojectPath: '.' }))
      .rejects.toMatchObject({ statusCode: status, message: 'kanban_error' })
  })

  it('maps offline Kanban to 503', async () => {
    const f = fixture(); f.fetchImpl.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(f.adapter.standPreview('alice', 'p', { op: 'start', subprojectPath: '.' }))
      .rejects.toMatchObject({ statusCode: 503, message: 'stand_preview_unavailable' })
  })

  it('maps an upstream outage and malformed responses without claiming a running stand', async () => {
    const f = fixture()
    f.fetchImpl.mockResolvedValueOnce(Response.json({ error: 'offline' }, { status: 503 }))
    await expect(f.adapter.standPreview('alice', 'p', { op: 'status', subprojectPath: '.' }))
      .rejects.toMatchObject({ statusCode: 503, message: 'stand_preview_unavailable' })
    f.fetchImpl.mockResolvedValueOnce(Response.json({ unexpected: true }))
    await expect(f.adapter.standPreview('alice', 'p', { op: 'status', subprojectPath: '.' }))
      .rejects.toMatchObject({ statusCode: 502, message: 'invalid_stand_response' })
  })

  it('reports an accepted live operation as starting even with an existing gateway', async () => {
    const f = fixture()
    f.fetchImpl.mockResolvedValueOnce(Response.json(f.stand)).mockResolvedValueOnce(Response.json({ operationId: 'op' }, { status: 202 }))
    expect(await f.adapter.standPreview('alice', 'p', { op: 'live_on', standId: 'stand', component: 'core-ui', subprojectPath: '.' }))
      .toMatchObject({ status: 'starting', url: 'http://stand.test' })
  })

  it('rejects a stand on an inaccessible machine', async () => {
    const f = fixture(); f.stand.machineId = 'foreign'
    await expect(f.adapter.standPreview('alice', 'p', { op: 'live_on', subprojectPath: '.', component: 'core-ui', standId: 'stand' }))
      .rejects.toMatchObject({ statusCode: 403 })
    expect(f.fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('Make transfer adapter', () => {
  it.each(['core-ui', 'ui-kit'] as const)('writes, commits and pushes selected files to %s and links the design', async targetRepository => {
    const f = fixture()
    if (targetRepository === 'ui-kit') f.project.gitUrl = 'https://github.com/sislex/sielexa-ui.git'
    const result = await f.adapter.createTransferTask('alice', { ...args, targetRepository })
    expect(result).toMatchObject({ taskId: 'task', projectId: 'p', branch: expect.stringMatching(/^make\/new-button-/),
      branchUrl: expect.stringContaining('/tree/make/'), taskUrl: '#/projects/p/task/task', designUrl: '#/make/design' })
    expect(f.git.resolve).toHaveBeenCalledWith('alice', 'p', expect.any(String), { write: true })
    expect(f.readDesignFile).toHaveBeenCalledWith('alice', 'design', 'src/Button.tsx')
    expect(f.git.saveFile).toHaveBeenCalledWith('alice', 'p', expect.any(String), 'src/Button.tsx', 'export const Button = () => null')
    expect(f.git.commit).toHaveBeenCalledWith('alice', 'p', expect.any(String), { message: 'New button', paths: args.files })
    expect(f.git.push).toHaveBeenCalledWith('alice', 'p', expect.any(String), result.branch)
    expect(f.db.tasks.linkTaskDesign).toHaveBeenCalledWith('alice', 'p', 'task', { conversationId: 'design', mode: 'files', paths: args.files }, { transfer: true })
    expect(f.db.ci.updateCiWorkspaceRevision).toHaveBeenCalledWith('ci', result.branch, 'pushed', true)
    expect(f.db.tasks.moveTask).toHaveBeenCalledWith('alice', 'p', 'task', { columnId: 'merge' })
    expect(f.git.checkout).toHaveBeenCalledWith('alice', 'p', expect.any(String), 'main', false)
    expect(f.boardChanged).toHaveBeenCalledWith('p')
    expect(f.git.createBranch.mock.invocationCallOrder[0]).toBeLessThan(f.git.saveFile.mock.invocationCallOrder[0]!)
  })

  it('checks machine write access before creating a task or reading files', async () => {
    const f = fixture(); f.git.resolve.mockRejectedValueOnce(new GitError(403, 'read_only_machine', 'denied'))
    await expect(f.adapter.createTransferTask('alice', args)).rejects.toMatchObject({ statusCode: 403 })
    expect(f.db.tasks.createTask).not.toHaveBeenCalled(); expect(f.readDesignFile).not.toHaveBeenCalled()
  })

  it('rejects foreign designs, repository mismatches, unsafe files and dirty workspaces', async () => {
    const f = fixture(); f.db.chat.conversationOwner.mockResolvedValueOnce('bob')
    await expect(f.adapter.createTransferTask('alice', args)).rejects.toMatchObject({ statusCode: 403 })
    await expect(f.adapter.createTransferTask('alice', { ...args, targetRepository: 'ui-kit' })).rejects.toMatchObject({ statusCode: 409 })
    await expect(f.adapter.createTransferTask('alice', { ...args, files: ['../secret'] })).rejects.toMatchObject({ statusCode: 400 })
    f.git.status.mockResolvedValueOnce({ problem: null, branch: 'main', changes: [{}] })
    await expect(f.adapter.createTransferTask('alice', args)).rejects.toMatchObject({ statusCode: 409 })
    expect(f.db.tasks.createTask).not.toHaveBeenCalled()
  })

  it('preserves failed writes and does not record a pushed revision', async () => {
    const f = fixture(); f.git.push.mockRejectedValueOnce(new GitError(409, 'git_failed', 'push failed'))
    await expect(f.adapter.createTransferTask('alice', args)).rejects.toMatchObject({ statusCode: 409 })
    expect(f.git.checkout).not.toHaveBeenCalled(); expect(f.db.ci.createCiWorkspace).not.toHaveBeenCalled()
    expect(f.db.tasks.moveTask).not.toHaveBeenCalled()
  })
})

describe('Make project authorization', () => {
  it('rejects inaccessible projects before external effects', async () => {
    const f = fixture(); f.db.projects.getProject.mockResolvedValue(null as never)
    await expect(f.adapter.createTransferTask('alice', args)).rejects.toMatchObject({ statusCode: 404 })
    await expect(f.adapter.standPreview('alice', 'p', { op: 'start', subprojectPath: '.' })).rejects.toMatchObject({ statusCode: 404 })
    expect(f.fetchImpl).not.toHaveBeenCalled(); expect(f.git.resolve).not.toHaveBeenCalled()
  })

  it('rejects read-only users before mutations', async () => {
    const f = fixture(); f.user.role = 'user' as never
    await expect(f.adapter.createTransferTask('alice', args)).rejects.toMatchObject({ statusCode: 403 })
    await expect(f.adapter.standPreview('alice', 'p', { op: 'start', subprojectPath: '.' })).rejects.toMatchObject({ statusCode: 403 })
    expect(f.fetchImpl).not.toHaveBeenCalled(); expect(f.db.tasks.createTask).not.toHaveBeenCalled()
  })

  it('limits request credentials to their method and URL and revokes them after use', async () => {
    const f = fixture(); let credential = ''
    await f.authority.run('alice', 'GET', '/api/projects/p/dev-stands', async authorization => {
      credential = authorization
      for (const [method, url] of [['POST', '/api/projects/p/dev-stands'], ['GET', '/api/projects/other/dev-stands']])
        expect(await f.authority.authenticate({ method, url, headers: { authorization } })).toMatchObject({ ok: false, status: 403 })
    })
    expect(await f.authority.authenticate({ method: 'GET', url: '/api/projects/p/dev-stands', headers: { authorization: credential } }))
      .toMatchObject({ ok: false, status: 403 })
  })
})
