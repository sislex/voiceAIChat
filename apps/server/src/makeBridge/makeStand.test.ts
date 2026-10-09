import { describe, expect, it, vi } from 'vitest'
import { makeStandResultSchema, validateMakeStandResult, type MakeStandOperation } from '@voicechat/make-contracts'
import type { VoiceChatDb } from '../db/database.js'
import { GitError, type GitWorkspaceService } from '../git/workspaceService.js'
import { MakeProjectAdapters } from './projectAdapters.js'
import { MakeRequestAuthority } from './requestAuthority.js'
import type { StandMachines } from './standWorkspace.js'

const root = '/work/make-worktrees/conversation'
const identity = { standId: 'stand', hostProjectId: 'host' }
function fixture() {
  const user = { name: 'alice', role: 'developer', blocked: false }
  const project = { id: 'project', name: 'UI', gitUrl: 'git@github.com:sislex/sislexa-core-ui.git', ciBaseBranch: 'dev',
    machines: [{ agentId: 'agent', name: 'Mac', canUse: true, path: '/work/ui' }] }
  const host = { ...project, id: 'host', name: 'Sislexa', gitUrl: 'sislex/voiceAIChat' }
  const other = { ...host, id: 'other' }
  const projects = [project, host, other]
  const base = { id: 'base', mode: 'managed', state: 'ready', machines: ['agent'] }
  const stand = { standId: 'stand', machineId: 'agent', status: 'running', gateway: { urls: ['http://stand.test/'] },
    components: { 'core-ui': { repository: 'sislex/sislexa-core-ui', source: 'base', sha: 'abc' } },
    live: [] as Array<{ component: string; workingCopyPath: string; branch: string; head: string; status?: string; error?: string }>,
    operation: undefined as { status: string; phase?: string; error?: string } | undefined }
  const db = {
    identity: { getUser: vi.fn(async () => user) },
    chat: { conversationOwner: vi.fn(async () => 'alice'), getConversation: vi.fn(async () => ({ assistantKind: 'make', title: 'New UI' })), makeConversationProject: vi.fn(async () => 'project') },
    projects: { listProjects: vi.fn(async () => projects), getProject: vi.fn(async (_u, id) => projects.find(p => p.id === id) ?? null) },
    environments: { listEnvironments: vi.fn(async (_u, id) => id === 'host' ? [base] : []) }
  }
  const git = {
    resolve: vi.fn(async () => ({ agentId: 'agent', path: '/work/ui' })),
    status: vi.fn(async () => ({ branch: 'make/test', changes: [{ path: 'a.ts', staged: false }], ahead: 1, behind: 0 })),
    branches: vi.fn(async () => ({ current: 'make/test', branches: [{ name: 'make/test', remote: false }] })),
    pull: vi.fn(async () => ({ pulled: 1 })), commit: vi.fn(async () => ({ sha: 'sha' })),
    push: vi.fn(async () => ({ branch: 'make/test', sha: 'sha' })), createBranch: vi.fn(async () => ({})),
    atWorkingCopy: vi.fn()
  }
  git.atWorkingCopy.mockReturnValue(git)
  const fsResult = { root, cwd: '' }
  const machines = {
    isOnline: vi.fn(() => true), nameOf: vi.fn(() => 'Live Mac'),
    exec: vi.fn(async (_agent: string, command: string) => {
      const payload = command.match(/'([A-Za-z0-9+/=]+)'$/)![1]!
      const args = JSON.parse(Buffer.from(payload, 'base64').toString())
      return { exitCode: 0, timedOut: false, output: JSON.stringify({ root, target: args.relative === '.' ? root : root + '/' + args.relative,
        directory: args.relative === '.', branch: args.branch ?? args.newBranch ?? args.defaultBranch }) }
    }),
    fsList: vi.fn(async () => ({ ...fsResult, entries: [{ name: 'a.ts', kind: 'file' }, { name: '.git', kind: 'file' }, { name: 'src', kind: 'dir' }, { name: 'escape', kind: 'link' }] })),
    fsRead: vi.fn(async () => ({ ...fsResult, dataBase64: Buffer.from('hello').toString('base64'), truncated: false })),
    fsWrite: vi.fn(async () => fsResult), fsDeleteFileSafe: vi.fn(async () => fsResult), fsRename: vi.fn(async () => fsResult)
  }
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input)).pathname
    if (init?.method === 'POST' || init?.method === 'DELETE') return Response.json({ standId: 'created', operationId: 'operation' }, { status: 202 })
    if (url === '/api/projects/host/dev-stands') return Response.json([stand])
    if (url === '/api/projects/host/dev-stands/stand') return Response.json(stand)
    if (url === '/api/projects/other/dev-stands') return Response.json([{ ...stand, components: { core: { repository: 'sislex/voiceAIChat', source: 'base', sha: 'def' } } }])
    if (url.endsWith('/dev-stands')) return Response.json([])
    return Response.json({ error: 'stand_not_found' }, { status: 404 })
  })
  const previewAccess = vi.fn(async () => ({ url: 'http://core.test:24032/' }))
  const deps = { db: db as unknown as VoiceChatDb, git: git as unknown as GitWorkspaceService, machines: machines as unknown as StandMachines,
    kanbanUrl: 'http://kanban.test', authority: new MakeRequestAuthority(async () => user as never), fetchImpl,
    readDesignFile: vi.fn(), boardChanged: vi.fn(), previewAccess: undefined as typeof previewAccess | undefined }
  const adapter = new MakeProjectAdapters(deps)
  const call = async (op: MakeStandOperation) => {
    const result = await adapter.makeStand('alice', 'conversation', op)
    makeStandResultSchema.parse(result); validateMakeStandResult(op, result)
    return result
  }
  const bind = () => stand.live.push({ component: 'core-ui', workingCopyPath: root, branch: 'make/test', head: 'live-sha' })
  return { call, bind, adapter, db, git, machines, fetchImpl, project, host, base, stand, user, deps, previewAccess }
}

describe('makeStand concrete Kanban and agent adapters', () => {
  it('lists stands on offline machines from the stand list without waiting for their details', async () => {
    const f = fixture(); f.machines.isOnline.mockReturnValue(false)
    const result = await f.call({ op: 'options' })
    expect(result.options?.stands).toEqual([{ ...identity, hostProjectName: 'Sislexa', machineId: 'agent', machineName: 'Live Mac', online: false,
      status: 'stopped', componentSource: 'base', branch: null, sha: 'abc' }])
    expect(f.fetchImpl.mock.calls.map(([input]) => new URL(String(input)).pathname)).not.toContain('/api/projects/host/dev-stands/stand')
  })
  it('discovers cross-project stands by repository, live branch and machine names', async () => {
    const f = fixture(); f.bind()
    const result = await f.call({ op: 'options' })
    expect(result.options).toEqual({ component: 'core-ui', repository: 'sislex/sislexa-core-ui',
      stands: [{ ...identity, hostProjectName: 'Sislexa', machineId: 'agent', machineName: 'Live Mac', online: true,
        status: 'running', componentSource: 'live', branch: 'make/test', sha: 'live-sha' }],
      machines: [{ agentId: 'agent', name: 'Live Mac', online: true, canCreate: true }] })
    expect(f.machines.exec).not.toHaveBeenCalled()
  })

  it.each(['https://github.com/sislex/sislexa-core-ui.git', 'ssh://git@github.com/sislex/sislexa-core-ui.git', 'sislex/sislexa-core-ui'])('normalizes repository %s', async repository => {
    const f = fixture(); f.project.gitUrl = repository
    expect((await f.call({ op: 'options' })).component).toBe('core-ui')
  })

  it('does not match an unrelated repository host', async () => {
    const f = fixture(); f.project.gitUrl = 'https://attacker.test/sislex/sislexa-core-ui'
    expect((await f.call({ op: 'options' })).options).toMatchObject({ component: null, stands: [] })
  })

  it.each([{ mode: 'external' }, { state: 'provisioning' }, { machines: ['other', 'agent'] }])('requires a ready managed primary machine: %j', async invalid => {
    const f = fixture(); Object.assign(f.base, invalid)
    expect((await f.call({ op: 'options' })).options?.machines[0]).toMatchObject({ canCreate: false, reason: 'base_environment_missing' })
    expect(await f.call({ op: 'create', agentId: 'agent' })).toMatchObject({ phase: 'failed', error: 'base_environment_missing' })
    expect(f.fetchImpl.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  })

  it('creates on the host environment, not an environment of the conversation project', async () => {
    const f = fixture()
    expect(await f.call({ op: 'create', agentId: 'agent' })).toMatchObject({ phase: 'creating', hostProjectId: 'host', standId: 'created', operationId: 'operation' })
    expect(f.fetchImpl).toHaveBeenCalledWith('http://kanban.test/api/projects/host/dev-stands', expect.objectContaining({ method: 'POST', body: JSON.stringify({ machineId: 'agent', baseEnvironmentId: 'base' }) }))
  })

  it.each([{ newBranch: 'make/new' }, { branch: 'existing' }, {}])('prepares a conversation worktree and enables live with %j', async branch => {
    const f = fixture()
    expect(await f.call({ op: 'attach', ...identity, ...branch })).toMatchObject({ ...identity, phase: 'installing', workingCopyPath: root,
      branch: 'newBranch' in branch ? branch.newBranch : 'branch' in branch ? branch.branch : 'make/new-ui-conversa', previewUrl: null, directUrls: ['http://stand.test/'] })
    expect(f.machines.exec).toHaveBeenCalledWith('agent', expect.stringContaining('node -e'), 300_000, undefined, { source: 'console', userId: 'alice' })
    expect(f.fetchImpl).toHaveBeenCalledWith('http://kanban.test/api/projects/host/dev-stands/stand/components/core-ui/live', expect.objectContaining({ method: 'POST', body: JSON.stringify({ workingCopyPath: root }) }))
    expect(f.git.resolve).toHaveBeenCalledWith('alice', 'project', expect.any(String), { write: true })
  })

  it('uses the lease service only when enabled', async () => {
    const f = fixture(); f.bind()
    expect((await f.call({ op: 'status', ...identity })).previewUrl).toBeNull()
    f.deps.previewAccess = f.previewAccess
    expect(await f.call({ op: 'status', ...identity })).toMatchObject({ phase: 'ready', previewUrl: 'http://core.test:24032/' })
    expect(f.previewAccess).toHaveBeenCalledWith('alice', 'host', 'stand')
    f.previewAccess.mockRejectedValueOnce(new Error('stand_proxy_unavailable'))
    expect(await f.call({ op: 'status', ...identity })).toMatchObject({ phase: 'failed', error: 'stand_proxy_unavailable' })
  })

  it.each(['preparing', 'installing', 'switching'] as const)('reports Kanban phase %s', async phase => {
    const f = fixture(); f.stand.operation = { status: 'running', phase }
    expect((await f.call({ op: 'status', ...identity })).phase).toBe(phase)
  })

  it('reports creation before a component manifest exists and maps failed operations', async () => {
    const f = fixture()
    f.fetchImpl.mockResolvedValueOnce(Response.json({ standId: 'stand', machineId: 'agent', status: 'starting' }))
    expect(await f.call({ op: 'status', ...identity })).toMatchObject({ phase: 'creating' })
    f.stand.operation = { status: 'failed', error: 'dependency_failed' }
    expect(await f.call({ op: 'status', ...identity })).toMatchObject({ phase: 'failed', error: 'operation_conflict' })
  })

  it('detaches without deleting worktrees or disabling another conversation', async () => {
    const f = fixture(); f.bind()
    expect(await f.call({ op: 'detach', ...identity })).toMatchObject({ phase: 'switching', workingCopyPath: root })
    expect(f.fetchImpl).toHaveBeenCalledWith(expect.stringContaining('/live'), expect.objectContaining({ method: 'DELETE' }))
    expect(f.machines.exec).not.toHaveBeenCalled()
    f.stand.live[0]!.workingCopyPath = '/work/someone-else'
    expect(await f.call({ op: 'detach', ...identity })).toMatchObject({ error: 'operation_conflict' })
  })

  it('lists and reads files through agent fs only after containment checks', async () => {
    const f = fixture(); f.bind()
    expect((await f.call({ op: 'files', action: 'list', dir: '.' })).files).toEqual({ action: 'list', entries: [{ path: 'a.ts', kind: 'file' }, { path: 'src', kind: 'directory' }] })
    expect((await f.call({ op: 'files', action: 'read', path: 'a.ts' })).files).toEqual({ action: 'read', content: 'hello' })
    expect(f.machines.fsRead).toHaveBeenCalledWith('agent', root + '/a.ts')
    expect(f.machines.exec.mock.invocationCallOrder[0]).toBeLessThan(f.machines.fsList.mock.invocationCallOrder[0]!)
  })

  it.each([{ op: 'files', action: 'write', path: 'a.ts', content: 'hello' }, { op: 'files', action: 'rename', from: 'a.ts', to: 'b.ts' }, { op: 'files', action: 'delete', path: 'a.ts' }] as const)('executes agent fs $action inside the worktree', async operation => {
    const f = fixture(); f.bind()
    expect((await f.call(operation)).files).toEqual({ action: operation.action })
    if (operation.action === 'write') expect(f.machines.fsWrite).toHaveBeenCalledWith('agent', root + '/a.ts', Buffer.from('hello').toString('base64'))
    if (operation.action === 'rename') expect(f.machines.fsRename).toHaveBeenCalledWith('agent', root + '/a.ts', root + '/b.ts')
    if (operation.action === 'delete') expect(f.machines.fsDeleteFileSafe).toHaveBeenCalledWith('agent', root + '/a.ts')
  })

  it.each(['../secret', '/secret', '.git', 'src/../../secret'])('rejects path %s', async path => {
    const f = fixture(); f.bind()
    try { expect(await f.call({ op: 'files', action: 'read', path })).toMatchObject({ error: 'path_outside_working_copy' }) }
    catch (error) { expect(error).toMatchObject({ statusCode: 400, message: 'path_outside_working_copy' }) }
    expect(f.machines.fsRead).not.toHaveBeenCalled()
  })

  it('refuses symlink escapes reported by the realpath checker, including rename destinations', async () => {
    const f = fixture(); f.bind()
    f.machines.exec.mockResolvedValueOnce({ exitCode: 1, timedOut: false, output: JSON.stringify({ error: 'path_outside_working_copy' }) })
    expect(await f.call({ op: 'files', action: 'write', path: 'escape/new', content: 'secret' })).toMatchObject({ error: 'path_outside_working_copy' })
    expect(f.machines.fsWrite).not.toHaveBeenCalled()
  })

  it('enforces the read limit and rejects truncated contents', async () => {
    const f = fixture(); f.bind()
    f.machines.fsRead.mockResolvedValueOnce({ root, cwd: '', dataBase64: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64'), truncated: false })
    await expect(f.call({ op: 'files', action: 'read', path: 'large' })).rejects.toMatchObject({ statusCode: 413 })
    f.machines.fsRead.mockResolvedValueOnce({ root, cwd: '', dataBase64: '', truncated: true })
    await expect(f.call({ op: 'files', action: 'read', path: 'large' })).rejects.toMatchObject({ statusCode: 413 })
    await expect(f.call({ op: 'files', action: 'write', path: 'large', content: 'é'.repeat(1024 * 1024 + 1) })).rejects.toMatchObject({ statusCode: 413 })
    expect(f.machines.fsWrite).not.toHaveBeenCalled()
  })

  it('reports preparation while the agent is running and rejects overlapping mutations', async () => {
    const f = fixture()
    let release!: () => void
    let started!: () => void
    const waiting = new Promise<void>(resolve => { started = resolve })
    const hold = new Promise<void>(resolve => { release = resolve })
    f.machines.exec.mockImplementationOnce(async () => {
      started(); await hold
      return { exitCode: 0, timedOut: false, output: JSON.stringify({ root, branch: 'make/test' }) }
    })
    const attaching = f.call({ op: 'attach', ...identity })
    await waiting
    expect(await f.call({ op: 'status', ...identity })).toMatchObject({ phase: 'preparing' })
    expect(await f.call({ op: 'attach', ...identity })).toMatchObject({ error: 'operation_conflict' })
    release(); await attaching
    expect(await f.call({ op: 'status', ...identity })).toMatchObject({ phase: 'idle' })
  })

  it('reports offline machines before agent commands', async () => {
    const f = fixture(); f.machines.isOnline.mockReturnValue(false)
    expect((await f.call({ op: 'options' })).options?.machines[0]).toMatchObject({ canCreate: false, reason: 'machine_unavailable' })
    expect(await f.call({ op: 'attach', ...identity })).toMatchObject({ error: 'machine_unavailable' })
    expect(f.machines.exec).not.toHaveBeenCalled()
  })

  it('rejects multiple stands bound to the same conversation copy', async () => {
    const f = fixture(); f.bind()
    f.fetchImpl.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/dev-stands')) return Response.json([f.stand])
      return Response.json(f.stand)
    })
    expect(await f.call({ op: 'files', action: 'read', path: 'a.ts' })).toMatchObject({ error: 'operation_conflict' })
    expect(f.machines.fsRead).not.toHaveBeenCalled()
  })

  it.each([{ op: 'status' }, { op: 'branches' }, { op: 'pull' }, { op: 'commit', message: 'Change', files: ['a.ts'] }, { op: 'push' }, { op: 'branch', name: 'make/next' }] as const)('runs git $op using the scoped projectGit runtime', async operation => {
    const f = fixture(); f.bind()
    const op = { ...operation, ...(operation.files ? { files: [...operation.files] } : {}) } as Extract<MakeStandOperation, { op: 'git' }>['operation']
    expect((await f.call({ op: 'git', operation: op })).git?.op).toBe(op.op)
    expect(f.git.atWorkingCopy).toHaveBeenCalledWith('alice', 'project', expect.any(String), root)
  })

  it.each([['ref_not_found', 404, 'branch_not_found'], ['base_environment_not_found', 404, 'base_environment_missing'], ['unknown_component', 400, 'component_not_in_stand'], ['operation_conflict', 409, 'operation_conflict'], ['stand_not_found', 404, 'stand_not_found'], ['offline', 503, 'machine_unavailable']] as const)('maps Kanban %s', async (error, status, expected) => {
    const f = fixture(); f.fetchImpl.mockResolvedValueOnce(Response.json({ error }, { status }))
    expect(await f.call({ op: 'attach', ...identity })).toMatchObject({ phase: 'failed', error: expected })
  })

  it.each(['branch_exists', 'branch_not_found', 'machine_unavailable', 'operation_conflict'])('maps agent %s and does not enable live', async error => {
    const f = fixture(); f.machines.exec.mockResolvedValueOnce({ exitCode: 1, timedOut: false, output: JSON.stringify({ error }) })
    expect(await f.call({ op: 'attach', ...identity })).toMatchObject({ phase: 'failed', error })
    expect(f.fetchImpl.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  })

  it('checks ownership, host membership and machine permissions before effects', async () => {
    const f = fixture(); f.db.chat.conversationOwner.mockResolvedValueOnce('bob')
    await expect(f.call({ op: 'options' })).rejects.toMatchObject({ statusCode: 403 })
    expect(f.fetchImpl).not.toHaveBeenCalled()
    f.db.projects.getProject.mockImplementationOnce(async () => f.project).mockResolvedValueOnce(null)
    expect(await f.call({ op: 'attach', ...identity })).toMatchObject({ error: 'stand_not_found' })
    f.git.resolve.mockRejectedValueOnce(new GitError(403, 'read_only_machine', 'denied'))
    await expect(f.call({ op: 'attach', ...identity })).rejects.toMatchObject({ statusCode: 403 })
    expect(f.machines.exec).not.toHaveBeenCalled()
  })
})
