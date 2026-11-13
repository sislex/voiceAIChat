import { afterEach, expect, it, vi } from 'vitest'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { processCommand, processTaskRoot, stopTaskProcessesCommand } from './runProcesses.js'
const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'"

const dirs: string[] = []
const children: number[] = []
afterEach(() => {
  for (const pid of children.splice(0)) { try { process.kill(pid, 'SIGKILL') } catch {} }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'run-process-'))); dirs.push(dir)
  const root = join(dir, 'projects', 'p', 'tasks', 't')
  const cwd = join(root, 'repository'); mkdirSync(cwd, { recursive: true })
  return { root, cwd }
}
function run(command: string) {
  const child = spawn('/bin/bash', ['-c', command], { stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child.pid!)
  let output = ''
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { output += data })
  const done = new Promise<{ code: number | null; output: string }>(resolve => child.on('close', code => resolve({ code, output })))
  return { child, done }
}
const alive = (pid: number) => {
  try {
    const state = execFileSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' }).trim()
    return !!state && !state.startsWith('Z')
  } catch { return false }
}
function records(root: string): Array<{ pid: number; pgid: number; cwd: string; ports: number[]; start: string }> {
  const data = JSON.parse(readFileSync(join(root, '.process-run'), 'utf8'))
  return Object.values(data.scopes).flatMap((scope: any) => scope.processes)
}
const server = `${shellQuote(process.execPath)} -e 'require("net").createServer().listen(0,"127.0.0.1")' >server.log 2>&1 &`

it('registers a Storybook-like server, cwd and listening port and stops it at command stage end', async () => {
  const f = fixture()
  const job = run(processCommand(server + '\nsleep 3', f.cwd, {}, 20_000, { root: f.root, runId: 'run', stage: 'component_qa' }))
  await vi.waitFor(() => expect(records(f.root).some(r => r.ports.length > 0)).toBe(true), { timeout: 15_000 })
  const owned = records(f.root).filter(r => r.ports.length)
  expect(owned[0].cwd).toBe(f.cwd)
  expect(owned[0].pgid).toBeGreaterThan(1)
  expect(await job.done).toMatchObject({ code: 0 })
  expect(owned.every(r => !alive(r.pid))).toBe(true)
}, 30_000)

it('keeps model background processes until the stage boundary and frees their ports on sweep', async () => {
  const f = fixture()
  const job = run(processCommand(server + '\nsleep 2', f.cwd, {}, 20_000, { root: f.root, runId: 'run', stage: 'model', retain: true }))
  expect(await job.done).toMatchObject({ code: 0 })
  const owned = records(f.root).filter(r => r.ports.length)
  expect(owned.length).toBeGreaterThan(0)
  children.push(...owned.map(r => r.pid))
  expect(owned.some(r => alive(r.pid))).toBe(true)
  expect(await run(stopTaskProcessesCommand(f.root, { runId: 'run' })).done).toMatchObject({ code: 0 })
  expect(owned.every(r => !alive(r.pid))).toBe(true)
}, 30_000)

it('cancellation kills the process group while an unrelated process survives', async () => {
  const f = fixture()
  const foreign = spawn('sleep', ['60'], { cwd: tmpdir() }); children.push(foreign.pid!)
  const job = run(processCommand(server + '\nwait', f.cwd, {}, 30_000, { root: f.root, runId: 'run', stage: 'qa' }))
  await vi.waitFor(() => expect(records(f.root).some(r => r.ports.length)).toBe(true), { timeout: 15_000 })
  const owned = records(f.root)
  job.child.kill('SIGTERM')
  await job.done
  expect(owned.every(r => !alive(r.pid))).toBe(true)
  expect(alive(foreign.pid!)).toBe(true)
}, 30_000)

it('closed task sweep finds unregistered cwd orphans and journals them', async () => {
  const f = fixture()
  const orphan = spawn('sleep', ['60'], { cwd: f.cwd, detached: true }); children.push(orphan.pid!)
  const result = await run(stopTaskProcessesCommand(f.root)).done
  expect(result.code, result.output).toBe(0)
  expect(alive(orphan.pid!)).toBe(false)
  expect(readFileSync(join(f.root, '.process-cleanup.log'), 'utf8')).toContain(String(orphan.pid))
}, 30_000)

it('sweeps an unregistered process only after the inactive stage age limit', async () => {
  const f = fixture()
  const child = spawn('sleep', ['60'], { cwd: f.cwd, detached: true }); children.push(child.pid!)
  expect((await run(stopTaskProcessesCommand(f.root, { expiredOnly: true, maxAgeMs: 60_000 })).done).code).toBe(0)
  expect(alive(child.pid!)).toBe(true)
  expect((await run(stopTaskProcessesCommand(f.root, { expiredOnly: true, maxAgeMs: 0 })).done).code).toBe(0)
  expect(alive(child.pid!)).toBe(false)
}, 30_000)

it('ignores reused PIDs and nonexpired registrations during inactive-task sweep', async () => {
  const f = fixture()
  const child = spawn('sleep', ['60'], { cwd: f.cwd }); children.push(child.pid!)
  writeFileSync(join(f.root, '.process-run'), JSON.stringify({ version: 1, runId: 'run', scopes: {
    stale: { deadline: 0, processes: [{ pid: child.pid, pgid: child.pid, start: 'stale identity', cwd: f.cwd, ports: [] }] }
  } }))
  expect((await run(stopTaskProcessesCommand(f.root, { expiredOnly: true })).done).code).toBe(0)
  expect(alive(child.pid!)).toBe(true)
}, 30_000)

it('disables Gradle and Kotlin daemons by default, isolates Gradle home and stops its wrapper', async () => {
  const f = fixture()
  writeFileSync(join(f.cwd, 'gradlew'), '#!/bin/bash\nprintf "%s\\n" "$GRADLE_USER_HOME $*" >> gradle-stop.log\n', { mode: 0o700 })
  const script = 'mkdir -p "$GRADLE_USER_HOME"; printf "%s\\n" "$GRADLE_OPTS" "$GRADLE_USER_HOME"'
  const result = await run(processCommand(script, f.cwd, {}, 20_000, { root: f.root, runId: 'run', stage: 'android' })).done
  expect(result.code, result.output).toBe(0)
  expect(result.output).toContain('-Dorg.gradle.daemon=false')
  expect(result.output).toContain('-Dkotlin.compiler.execution.strategy=in-process')
  expect(readFileSync(join(f.cwd, 'gradle-stop.log'), 'utf8')).toContain(f.root + '/.gradle-run --stop')
}, 30_000)

it('escalates an ignored SIGTERM after ten seconds', async () => {
  const f = fixture()
  const script = `${shellQuote(process.execPath)} -e 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)' >ignore.log 2>&1 &\nsleep 2`
  const start = Date.now()
  const job = run(processCommand(script, f.cwd, {}, 30_000, { root: f.root, runId: 'run', stage: 'qa' }))
  await vi.waitFor(() => expect(records(f.root).length).toBeGreaterThan(1), { timeout: 15_000 })
  const owned = records(f.root)
  const result = await job.done
  expect(result.code, result.output).toBe(0)
  expect(Date.now() - start).toBeGreaterThanOrEqual(10_000)
  await vi.waitFor(() => expect(owned.every(r => !alive(r.pid))).toBe(true))
}, 30_000)

it('limits ownership to canonical managed task paths', () => {
  expect(processTaskRoot('/repo/production')).toBeNull()
  expect(processTaskRoot('/a/projects/p/tasks/t/../other')).toBeNull()
  expect(processTaskRoot('/a/projects/p/tasks/t/repository')).toBe('/a/projects/p/tasks/t')
})
