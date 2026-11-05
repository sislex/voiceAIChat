import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectPreviews } from './projectPreview.js'

const freePort = () => new Promise<number>(resolve => {
  const server = createServer().listen(0, '127.0.0.1', () => { const port = (server.address() as { port: number }).port; server.close(() => resolve(port)) })
})
let home = ''
afterEach(() => { if (home) rmSync(home, { recursive: true, force: true }) })

function previews(config: unknown, gateAllowed = true) {
  home = mkdtempSync(path.join(tmpdir(), 'pp-'))
  const root = path.join(home, 'repo')
  mkdirSync(path.join(root, 'web'), { recursive: true })
  const machines = {
    isOnline: () => true,
    policyOf: () => undefined,
    exec: (_agent: string, command: string) => new Promise<{ exitCode: number | null; output: string; timedOut: boolean }>(resolve => {
      execFile('sh', ['-c', command], { env: { ...process.env, HOME: home } }, (error, stdout) =>
        resolve({ exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0, output: stdout, timedOut: false }))
    })
  }
  const db = { projects: {
    getProjectStandPreview: async () => config,
    getProject: async () => ({ machines: [{ agentId: 'a1', canUse: true, path: root }] })
  } }
  return new ProjectPreviews({ db: db as never, machines: machines as never, gate: async () => gateAllowed ? { allowed: true } : { allowed: false }, reservedPorts: [] })
}

describe('ProjectPreviews', () => {
  it('starts the owner command, reports running and stops its process group', async () => {
    const port = await freePort()
    const command = `node -e "require('http').createServer((q,s)=>s.end('ok')).listen(+process.env.PORT,'127.0.0.1')"`
    const p = previews({ command, port, workdir: 'web' })
    expect(await p.start('u', 'proj', 'a1')).toMatchObject({ standId: 'pp-a1', status: 'starting' })
    let status = 'starting'
    for (let i = 0; i < 50 && status !== 'running'; i++) {
      await new Promise(r => setTimeout(r, 100))
      status = (await p.status('u', 'proj', 'a1')).status
    }
    expect(status).toBe('running')
    expect(await p.target('u', 'proj', 'pp-a1')).toEqual({ machineId: 'a1', gatewayPort: port })
    const dir = path.join(home, '.voicechat', 'project-previews')
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(readFileSync(path.join(dir, 'proj.json'), 'utf8')).not.toContain('createServer')
    expect((await p.stop('u', 'proj', 'a1')).status).toBe('stopped')
    await new Promise(r => setTimeout(r, 300))
    expect((await p.status('u', 'proj', 'a1')).status).toBe('stopped')
    expect(readdirSync(dir)).toEqual(['proj.log'])
  }, 20_000)

  it('refuses a command denied by the command gate', async () => {
    const p = previews({ command: 'npm start', port: 4200 }, false)
    await expect(p.start('u', 'proj', 'a1')).rejects.toThrow('preview_command_forbidden')
  })
})
