import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectPreviews } from './projectPreview.js'
import { UserStands, externalUserStandId, userStandId } from './userStand.js'
import { StandProxy } from '../standProxy.js'

const freePort = () => new Promise<number>(resolve => {
  const server = createServer().listen(0, '127.0.0.1', () => { const port = (server.address() as { port: number }).port; server.close(() => resolve(port)) })
})
let home = ''
afterEach(() => { if (home) rmSync(home, { recursive: true, force: true }) })

function stands(access: Array<{ agentId: string; name: string; access: 'owner' | 'full' | 'read' }> = [{ agentId: 'm1', name: 'Mac', access: 'owner' }], extra: { gate?: (input: { command: string }) => Promise<{ allowed: boolean }>; releaseAccess?: (user: string, stand: string) => Promise<void>; previewAccess?: (user: string, stand: string) => Promise<{ url: string }> } = {}) {
  home = mkdtempSync(path.join(tmpdir(), 'us-'))
  const folder = path.join(home, 'stand')
  mkdirSync(folder, { recursive: true })
  const machines = {
    isOnline: () => true,
    policyOf: () => undefined,
    exec: (_agent: string, command: string) => new Promise<{ exitCode: number | null; output: string; timedOut: boolean }>(resolve => {
      execFile('sh', ['-c', command], { env: { ...process.env, HOME: home } }, (error, stdout) =>
        resolve({ exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0, output: stdout, timedOut: false }))
    }),
    fsList: async () => ({ root: '/', cwd: '', entries: [] }),
    fsRead: async (_agent: string, file: string) => ({ root: '/', cwd: '', dataBase64: readFileSync(file).toString('base64') }),
    fsWrite: async (_agent: string, file: string, data: string) => { writeFileSync(file, Buffer.from(data, 'base64')); return { root: '/', cwd: '' } }
  }
  const previews = new ProjectPreviews({ db: {} as never, machines: machines as never, gate: async () => ({ allowed: true }) as never, reservedPorts: [] })
  const locks = new Set<string>()
  const db = { machines: {
    listUserMachineAccess: async () => access,
    acquireGitWorkspaceLock: async (agent: string, root: string) => locks.has(agent + root) ? null : (locks.add(agent + root), { expiresAt: 1 }),
    releaseGitWorkspaceLock: async (agent: string, root: string) => { locks.delete(agent + root) }
  } }
  return { folder, stands: new UserStands({ db: db as never, machines: machines as never, previews, reservedPorts: [], ...(extra as object) }) }
}

describe('UserStands', () => {
  it('starts the stand command in its folder, reports running and stops it', async () => {
    const port = await freePort()
    const { folder, stands: s } = stands()
    const command = `node -e "require('http').createServer((q,r)=>r.end(process.cwd())).listen(+process.env.PORT,'127.0.0.1')"`
    const op = { machineId: 'm1', folder, command, port }
    expect(await s.userStand('alice', { op: 'machines' })).toEqual({ machines: [{ agentId: 'm1', name: 'Mac', online: true }] })
    expect(await s.userStand('alice', { op: 'start', ...op })).toEqual({ status: 'starting' })
    let status = 'starting'
    for (let i = 0; i < 50 && status !== 'running'; i++) {
      await new Promise(r => setTimeout(r, 100))
      status = (await s.userStand('alice', { op: 'status', ...op }) as { status: string }).status
    }
    expect(status).toBe('running')
    expect(await (await fetch('http://127.0.0.1:' + port + '/')).text()).toBe(realpathSync(folder))
    expect(await s.userStand('alice', { op: 'stop', ...op })).toEqual({ status: 'stopped' })
    await new Promise(r => setTimeout(r, 300))
    expect(await s.userStand('alice', { op: 'status', ...op })).toEqual({ status: 'stopped' })
  }, 20_000)

  it('keeps files inside the stand folder and refuses forbidden machines', async () => {
    const { folder, stands: s } = stands([{ agentId: 'm1', name: 'Mac', access: 'read' }])
    const outside = path.join(home, 'secret.txt')
    writeFileSync(outside, 'secret')
    symlinkSync(outside, path.join(folder, 'link.txt'))
    writeFileSync(path.join(folder, 'a.txt'), 'hello')
    expect(await s.userStand('alice', { op: 'files', machineId: 'm1', folder, action: 'read', path: 'a.txt' })).toEqual({ content: 'hello', encoding: 'utf8' })
    await expect(s.userStand('alice', { op: 'files', machineId: 'm1', folder, action: 'read', path: 'link.txt' })).rejects.toThrow('path_outside_stand')
    await expect(s.userStand('alice', { op: 'files', machineId: 'm1', folder, action: 'read', path: '../secret.txt' })).rejects.toThrow('path_outside_stand')
    await expect(s.userStand('alice', { op: 'files', machineId: 'm1', folder: 'relative', action: 'list', dir: '.' })).rejects.toThrow('path_outside_stand')
    // A read-only share may not write or run commands; an unknown machine is forbidden outright.
    await expect(s.userStand('alice', { op: 'files', machineId: 'm1', folder, action: 'write', path: 'b.txt', content: 'x', encoding: 'utf8' })).rejects.toThrow('machine_forbidden')
    await expect(s.userStand('alice', { op: 'start', machineId: 'm1', folder, command: 'npm start', port: 4200 })).rejects.toThrow('machine_forbidden')
    await expect(s.userStand('alice', { op: 'files', machineId: 'm2', folder, action: 'list', dir: '.' })).rejects.toThrow('machine_forbidden')
  }, 20_000)

  it('registers validated proxy routes on a local preview lease and clears them on release', async () => {
    const released: string[] = []
    const { stands: s } = stands(undefined, {
      previewAccess: async () => ({ url: 'http://core.example:24001/' }),
      releaseAccess: async (_user: string, standId: string) => { released.push(standId) },
    })
    const route = { path: '/api', port: 8080, targetHost: 'localhost:8080', origin: 'http://localhost:4200', stripPrefix: true }
    expect(await s.userStand('alice', { op: 'preview', machineId: 'm1', port: 4200, routes: [route] }))
      .toEqual({ url: 'http://core.example:24001/', interactive: true })
    const id = userStandId('m1', 4200)
    expect(await s.target('alice', id)).toMatchObject({
      machineId: 'm1', gatewayPort: 4200,
      routes: [{ path: '/api', target: { machineId: 'm1', gatewayPort: 8080 }, targetHost: 'localhost:8080', origin: 'http://localhost:4200', stripPrefix: true }],
    })
    expect(await s.userStand('alice', { op: 'release', machineId: 'm1', port: 4200 })).toEqual({ ok: true })
    expect(released).toEqual([id])
    expect(await s.target('alice', id)).not.toHaveProperty('routes')
  })

  it('resolves us- stand ids in StandProxy only for machines the user may use', async () => {
    let access: Array<{ agentId: string; name: string; access: 'owner' }> = [{ agentId: 'm1', name: 'Mac', access: 'owner' }]
    const db = { machines: { listUserMachineAccess: async () => access } }
    const s = new UserStands({ db: db as never, machines: { isOnline: () => true } as never, previews: {} as never, reservedPorts: [] })
    const proxy = new StandProxy({
      secret: 'secret', ports: [await freePort()], member: async () => { throw new Error('member must not be asked for user stands') },
      stand: async () => { throw new Error('project resolver must not be asked') }, userStand: (user, stand) => s.target(user, stand),
      session: async cookie => cookie.includes('vc_session=alice') ? 'alice' : null, connect: () => { throw new Error('no tunnel') }
    })
    try {
      await expect(proxy.access('alice', '', userStandId('m2', 5173), '127.0.0.1:25273')).rejects.toThrow('machine_forbidden')
      await expect(proxy.access('alice', '', userStandId('m1', 5173), '127.0.0.1:25273', 5174)).rejects.toThrow('invalid_stand_access')
      const lease = await proxy.access('alice', 'ignored', userStandId('m1', 5173), '127.0.0.1:25273')
      // Machine access is re-checked per request: once the share is gone, the lease stops answering.
      access = []
      const response = await fetch(lease.url, { headers: { cookie: 'vc_session=alice', connection: 'close' } })
      expect(response.status).toBe(401)
      // Make releases a lease it no longer shows: the port is free at once, other users' leases stay.
      expect(await proxy.release('bob', userStandId('m1', 5173))).toBe(0)
      expect(await proxy.release('alice', userStandId('m1', 5173))).toBe(1)
      await expect(fetch(lease.url, { headers: { cookie: 'vc_session=alice', connection: 'close' } })).rejects.toThrow()
    } finally { await proxy.close() }
  })

  it('previews an external URL through a ue- lease keeping the stand path, and refuses private hosts', async () => {
    const leases: string[] = []
    const s = new UserStands({ db: {} as never, machines: {} as never, previews: {} as never, reservedPorts: [],
      externalGuard: { allowPrivate: false, lookup: async () => [{ address: '93.184.216.34', family: 4 }] },
      previewAccess: async (_user, stand) => { leases.push(stand); return { url: 'http://core.example:24001/' } } })
    expect(await s.userStand('alice', { op: 'preview', url: 'https://stg-02.mrdstaging.com/webapp/?a=1' }))
      .toEqual({ url: 'http://core.example:24001/webapp/?a=1', interactive: true })
    expect(leases[0]).toMatch(/^ue-[a-f0-9]{32}$/)
    expect(await s.target('alice', leases[0]!)).toMatchObject({ kind: 'external', origin: 'https://stg-02.mrdstaging.com', address: '93.184.216.34' })
    await expect(s.userStand('alice', { op: 'preview', url: 'http://10.0.0.1/' })).rejects.toThrow('stand_url_forbidden')
    await expect(s.userStand('alice', { op: 'preview', url: 'ftp://stg.example.com/' })).rejects.toThrow('stand_url_forbidden')
  })

  it('runs Git only at the root of a stand folder, honours the gate and access, and releases leases', async () => {
    const commands: string[] = []
    let allowed = true
    const released: string[] = []
    const { folder, stands: s } = stands(undefined, {
      gate: async ({ command }) => { commands.push(command); return { allowed } },
      releaseAccess: async (_user, stand) => { released.push(stand) }
    })
    const git = (operation: Record<string, unknown>, target = folder) => s.userStand('alice', { op: 'git', machineId: 'm1', folder: target, operation } as never)
    await expect(git({ op: 'status' })).rejects.toThrow('not_a_repository')
    const sh = (command: string) => new Promise<void>((resolve, reject) => execFile('sh', ['-c', command], { cwd: folder }, error => error ? reject(error) : resolve()))
    await sh('git init -q -b main && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && mkdir -p sub && printf x > sub/a.txt')
    expect(await git({ op: 'status' })).toEqual({ git: { op: 'status', ok: true, branch: 'main', files: [{ status: '??', path: 'sub/a.txt' }] } })
    // A subfolder of a repository is not a stand repository: add -A would reach outside it.
    await expect(git({ op: 'status' }, path.join(folder, 'sub'))).rejects.toThrow('not_a_repository')
    expect(await git({ op: 'create_branch', name: 'feat/n' })).toEqual({ git: { op: 'create_branch', ok: true, branch: 'feat/n' } })
    const commit = await git({ op: 'commit', message: 'Add a', files: ['sub/a.txt'] }) as { git: { ok: boolean; commit: string; branch: string } }
    expect(commit.git).toMatchObject({ ok: true, branch: 'feat/n', commit: expect.stringMatching(/^[0-9a-f]{40}$/) })
    expect((await git({ op: 'branches' }) as { git: { branches: unknown } }).git.branches).toEqual([{ name: 'feat/n', current: true }, { name: 'main', current: false }])
    expect(await git({ op: 'checkout', name: 'missing' })).toMatchObject({ git: { op: 'checkout', ok: false } })
    expect((await git({ op: 'commit', message: 'Nothing' }) as { git: { ok: boolean } }).git.ok).toBe(false)
    // Paths outside the folder, option-like branches and .git never reach the machine.
    for (const bad of [{ op: 'commit', message: 'x', files: ['../x'] }, { op: 'commit', message: 'x', files: ['.git/config'] }, { op: 'checkout', name: '--orphan' }, { op: 'push' }])
      await expect(git(bad)).rejects.toThrow('invalid_user_stand')
    // User data travels in environment variables, never in the script text.
    expect(commands.find(command => command.includes('Add a'))).toContain("export VC_GIT_MESSAGE='Add a'")
    allowed = false
    await expect(git({ op: 'status' })).rejects.toThrow('stand_command_forbidden')

    expect(await s.userStand('alice', { op: 'release', machineId: 'm1', port: 5173 })).toEqual({ ok: true })
    expect(await s.userStand('alice', { op: 'release', url: 'https://stg.example.com/app' })).toEqual({ ok: true })
    expect(released).toEqual([userStandId('m1', 5173), externalUserStandId('https://stg.example.com')])
  }, 30_000)

  it('refuses Git mutations on a read-only machine share', async () => {
    const { folder, stands: s } = stands([{ agentId: 'm1', name: 'Mac', access: 'read' }])
    await expect(s.userStand('alice', { op: 'git', machineId: 'm1', folder, operation: { op: 'commit', message: 'x' } })).rejects.toThrow('machine_forbidden')
    await expect(s.userStand('alice', { op: 'git', machineId: 'm1', folder, operation: { op: 'status' } })).rejects.toThrow('not_a_repository')
  })
})
