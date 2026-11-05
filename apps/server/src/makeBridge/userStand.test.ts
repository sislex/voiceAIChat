import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectPreviews } from './projectPreview.js'
import { UserStands, userStandId } from './userStand.js'
import { StandProxy } from '../standProxy.js'

const freePort = () => new Promise<number>(resolve => {
  const server = createServer().listen(0, '127.0.0.1', () => { const port = (server.address() as { port: number }).port; server.close(() => resolve(port)) })
})
let home = ''
afterEach(() => { if (home) rmSync(home, { recursive: true, force: true }) })

function stands(access: Array<{ agentId: string; name: string; access: 'owner' | 'full' | 'read' }> = [{ agentId: 'm1', name: 'Mac', access: 'owner' }]) {
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
  const db = { machines: { listUserMachineAccess: async () => access } }
  return { folder, stands: new UserStands({ db: db as never, machines: machines as never, previews, reservedPorts: [] }) }
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
})
