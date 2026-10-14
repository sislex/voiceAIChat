import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { afterEach, expect, it, vi } from 'vitest'
import { StandDeliveries } from '../makeBridge/standDeliveries.js'
import { StandDeliveryCoordinator } from '../makeBridge/standDeliveryCoordinator.js'
import { registerStandDeliveryRoutes } from './standDeliveries.js'
import { GitError } from '../git/workspaceService.js'

afterEach(() => vi.restoreAllMocks())
const sha = 'a'.repeat(40)
const candidate = { repository: 'sislex/sislexa-core-ui', branch: 'make/test', targetBranch: 'dev', headSha: sha, title: 'Change', author: 'alice' }
async function fixture() {
  const fixtureToken = randomUUID()
  const user = { name: 'alice', role: 'developer', blocked: false }
  const project = { gitUrl: 'sislex/sislexa-core-ui', machines: [{ agentId: 'agent', canUse: true, path: '/work/ui', reposRoot: '/work/repos' }] }
  const stand = { standId: 'stand', machineId: 'agent', components: { ui: { repository: candidate.repository, sha, source: 'live' } },
    live: [{ component: 'ui', workingCopyPath: '/work/repos/make-worktrees/conversation', branch: candidate.branch }] }
  const db = { projects: { getProject: vi.fn(async () => project) }, identity: { getUser: vi.fn(async () => user) } }
  const git = { resolve: vi.fn(async () => ({})), atWorkingCopy: vi.fn() }
  git.atWorkingCopy.mockReturnValue(git)
  const machines = { isOnline: vi.fn(() => true), exec: vi.fn(async (_agent: string, command: string) => {
    const args = JSON.parse(Buffer.from(command.match(/'([A-Za-z0-9+/=]+)'$/)![1]!, 'base64').toString())
    return { exitCode: 0, timedOut: false, output: JSON.stringify(args.action === 'head' ? { headSha: sha } : { merged: true, behind: 0, conflicts: [] }) }
  }) }
  const coordinatorApp = Fastify()
  let status: unknown = { tasks: [{ runId: 'stand-delivery', taskId: 'T-1', candidate, createdAt: '2026-10-12T12:00:00Z', state: 'submitted' }] }
  const received: Array<{ url: string; authorization?: string; body: unknown }> = []
  let refusal: { status: number; body: unknown } | undefined
  coordinatorApp.addHook('preHandler', async req => { received.push({ url: req.url, authorization: req.headers.authorization, body: req.body }) })
  coordinatorApp.post('/v1/candidates/branch', async (_req, reply) => refusal
    ? reply.code(refusal.status).send(refusal.body)
    : { runId: 'stand-delivery', taskId: 'T-1' })
  coordinatorApp.get('/v1/status', async () => status)
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const response = await coordinatorApp.inject({ url: new URL(String(input)).pathname,
      method: init?.method === 'POST' ? 'POST' : 'GET', headers: Object.fromEntries(new Headers(init?.headers)),
      ...(init?.body ? { payload: String(init.body) } : {}) })
    return new Response(response.body, { status: response.statusCode, headers: { 'content-type': 'application/json' } })
  })
  const integration = vi.fn((id: string) => id === 'project' ? { url: 'http://coordinator.test', token: fixtureToken } : undefined)
  const coordinator = new StandDeliveryCoordinator(integration, fetchImpl)
  const service = new StandDeliveries({ db: db as never, git: git as never, machines: machines as never,
    stands: { getStand: vi.fn(async () => stand) } as never, coordinator })
  const app = Fastify()
  app.addHook('preHandler', async req => { req.user = user as never })
  registerStandDeliveryRoutes(app, service)
  const url = '/api/projects/project/dev-stands/stand'
  return { app, db, git, user, project, stand, machines, received, fetchImpl, url, fixtureToken,
    setRefusal: (value: { status: number; body: unknown }) => { refusal = value },
    setStatus: (value: unknown) => { status = value }, close: async () => { await app.close(); await coordinatorApp.close() } }
}

it.each([
  [400, { error: 'branch_patch_empty_or_large' }, 400, 'branch_patch_empty_or_large'],
  [403, { error: 'operator_scope_denied' }, 403, 'operator_scope_denied'],
  [409, { error: 'branch_head_changed' }, 409, 'branch_head_changed'],
  [503, { error: 'stand_delivery_paused' }, 503, 'stand_delivery_paused'],
  [400, { error: 'unknown_code' }, 502, 'stand_delivery_request_failed'],
  [409, { error: 'unknown_code' }, 409, 'stand_delivery_request_failed'],
  [400, { error: 'branch_patch_empty_or_large', diagnostics: 'private' }, 502, 'stand_delivery_request_failed']
])('exposes only safe coordinator refusals (%i / %j)', async (status, body, expectedStatus, error) => {
  const f = await fixture()
  try {
    f.setRefusal({ status, body })
    const response = await f.app.inject({ method: 'POST', url: f.url + '/deliveries', payload: { branch: candidate.branch, title: 'Change' } })
    expect(response.statusCode).toBe(expectedStatus)
    expect(response.json()).toEqual({ error })
    expect(f.received).toHaveLength(1)
  } finally { await f.close() }
})

it('forwards the agent HEAD with the project token and authenticated author, without pushing', async () => {
  const f = await fixture()
  try {
    const response = await f.app.inject({ method: 'POST', url: f.url + '/deliveries', payload: { branch: candidate.branch, title: 'Change' } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ runId: 'stand-delivery', taskId: 'T-1' })
    expect(f.received).toEqual([{ url: '/v1/candidates/branch', authorization: `Bearer ${f.fixtureToken}`, body: candidate }])
    expect(f.machines.exec).toHaveBeenCalledTimes(1)
    expect(f.git.resolve).toHaveBeenCalledWith('alice', 'project', expect.any(String), { write: true })
  } finally { await f.close() }
})

it('reads coordinator states, isolates branches, limits history, caches for 10 seconds and invalidates after submit', async () => {
  const f = await fixture()
  const now = vi.spyOn(Date, 'now').mockReturnValue(10_000)
  try {
    f.setStatus({ tasks: Array.from({ length: 25 }, (_, i) => ({ runId: 'stand-delivery', taskId: 'T-' + i,
      candidate, createdAt: '2026-10-12T12:00:' + String(i).padStart(2, '0') + 'Z', state: ['submitted', 'gating', 'integrated', 'rejected'][i % 4] })).concat([
      { runId: 'stand-delivery', taskId: 'foreign', candidate: { ...candidate, branch: 'make/other' }, createdAt: '2027', state: 'submitted' }
    ]) })
    const first = await f.app.inject(f.url + '/deliveries')
    expect(first.statusCode).toBe(200)
    expect(first.json()).toHaveLength(20)
    expect(first.json()[0].taskId).toBe('T-24')
    expect(new Set(first.json().map((d: { state: string }) => d.state))).toEqual(new Set(['submitted', 'gating', 'integrated', 'rejected']))
    await f.app.inject(f.url + '/deliveries')
    expect(f.fetchImpl).toHaveBeenCalledTimes(1)
    now.mockReturnValue(20_000)
    await f.app.inject(f.url + '/deliveries')
    expect(f.fetchImpl).toHaveBeenCalledTimes(2)
    await f.app.inject({ method: 'POST', url: f.url + '/deliveries', payload: { branch: candidate.branch, title: 'Change' } })
    await f.app.inject(f.url + '/deliveries')
    expect(f.fetchImpl).toHaveBeenCalledTimes(4)
  } finally { await f.close() }
})

it('preserves conflict results from the agent and does not contact the coordinator for sync', async () => {
  const f = await fixture()
  try {
    const result = { merged: false, behind: 3, conflicts: ['src/a.ts', 'file with spaces'] }
    f.machines.exec.mockResolvedValue({ output: JSON.stringify(result), exitCode: 0, timedOut: false })
    const response = await f.app.inject({ method: 'POST', url: f.url + '/sync-dev' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(result)
    expect(f.fetchImpl).not.toHaveBeenCalled()
  } finally { await f.close() }
})

it('denies invalid branches, forged fields, foreign paths and machine write restrictions before exec', async () => {
  const f = await fixture()
  const post = (payload: unknown) => f.app.inject({ method: 'POST', url: f.url + '/deliveries', payload: payload as never })
  try {
    expect((await post({ branch: '--upload-pack=evil', title: 'x' })).statusCode).toBe(400)
    expect((await post({ branch: candidate.branch, title: 'x', author: 'bob' })).statusCode).toBe(400)
    expect((await post({ branch: 'other', title: 'x' })).statusCode).toBe(409)
    f.stand.live[0]!.workingCopyPath = '/other/worktree'
    expect((await post({ branch: candidate.branch, title: 'x' })).statusCode).toBe(403)
    f.stand.live[0]!.workingCopyPath = '/work/repos/conversation'
    f.git.resolve.mockRejectedValue(new GitError(403, 'read_only_machine', 'denied'))
    expect((await post({ branch: candidate.branch, title: 'x' })).statusCode).toBe(403)
    expect(f.machines.exec).not.toHaveBeenCalled()
    expect(f.fetchImpl).not.toHaveBeenCalled()
  } finally { await f.close() }
})

it('rechecks project access even with cached history and denies blocked users', async () => {
  const f = await fixture()
  try {
    expect((await f.app.inject(f.url + '/deliveries')).statusCode).toBe(200)
    f.user.blocked = true
    expect((await f.app.inject(f.url + '/deliveries')).statusCode).toBe(403)
    f.db.projects.getProject.mockResolvedValue(null as never)
    expect((await f.app.inject(f.url + '/deliveries')).statusCode).toBe(404)
    expect(f.fetchImpl).toHaveBeenCalledTimes(1)
  } finally { await f.close() }
})

it('does not cache coordinator failures or expose upstream diagnostics', async () => {
  const f = await fixture()
  try {
    f.fetchImpl.mockResolvedValueOnce(new Response('private upstream diagnostics', { status: 500 }))
    const response = await f.app.inject(f.url + '/deliveries')
    expect(response.statusCode).toBe(502)
    expect(response.body).not.toContain('private')
    expect((await f.app.inject(f.url + '/deliveries')).statusCode).toBe(200)
  } finally { await f.close() }
})

it.each([
  ['agent timeout', async () => ({ exitCode: -1, timedOut: true, output: '' }), 504, 'stand_agent_timeout'],
  ['dropped agent', async () => { throw new Error('agent_disconnected') }, 409, 'machine_unavailable'],
  ['dirty tree', async () => ({ exitCode: 1, timedOut: false, output: JSON.stringify({ error: 'stand_worktree_dirty' }) }), 409, 'stand_worktree_dirty'],
  ['fetch failure', async () => ({ exitCode: 1, timedOut: false, output: JSON.stringify({ error: 'stand_fetch_failed' }) }), 409, 'stand_fetch_failed']
] as const)('sync-dev reports a %s with a specific code', async (_name, exec, status, error) => {
  const f = await fixture()
  try {
    f.machines.exec.mockImplementationOnce(exec as never)
    const response = await f.app.inject({ method: 'POST', url: f.url + '/sync-dev' })
    expect(response.statusCode).toBe(status)
    expect(response.json()).toEqual({ error })
  } finally { await f.close() }
})
