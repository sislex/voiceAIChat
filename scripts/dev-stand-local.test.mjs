import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, access, chmod, realpath, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'

const script = resolve('scripts/dev-stand-local.mjs')
async function freePort() {
  const server = createServer()
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  await new Promise(r => server.close(r))
  return port
}
async function until(check) {
  for (let n = 0; n < 150; n++) {
    if (await check()) return
    await delay(100)
  }
  throw Error('timed out')
}
function alive(pid) { try { process.kill(pid, 0); return true } catch { return false } }
async function fixture(t, external = false, command = 'run') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'local-stand-')))
  const home = join(root, 'stand'), core = join(root, 'conversation'), shared = join(root, 'shared'), bin = join(root, 'bin')
  const write = async (path, data) => { await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, data) }
  // Real processes and HTTP readiness, without installing or booting product services.
  const service = join(root, 'service.cjs')
  await write(service, `const fs = require('node:fs'); const http = require('node:http');
fs.writeFileSync(process.cwd() + (process.env.VC_APPLICATION_ID === 'make-ui' ? '/frontend.json' : '/started.json'), JSON.stringify({ cwd: process.cwd(), pid: process.pid, api: process.env.VC_APPLICATION_API_VERSION, version: process.env.VC_APPLICATION_VERSION, commit: process.env.VC_APPLICATION_COMMIT }));
if (process.cwd().endsWith('/packages/make-app')) { fs.mkdirSync('dist', {recursive:true}); fs.writeFileSync('dist/manifest.json', JSON.stringify({ version: '9.8.7', commit: 'manifest-commit', apiVersion: '2.0.0' })); setInterval(() => {}, 1000); }
else http.createServer((req,res) => res.end('ok')).listen(Number(process.env.PORT || process.env.VC_WEB_PORT), '127.0.0.1');
`)
  for (const command of ['npm', 'npx']) {
    await write(join(bin, command), '#!/bin/sh\nexec "' + process.execPath + '" "' + service + '"\n')
    await chmod(join(bin, command), 0o755)
  }
  for (const repo of [core, join(shared, 'make'), join(shared, 'sislexa-core-ui')]) {
    await mkdir(join(repo, 'node_modules'), { recursive: true })
    execFileSync('git', ['init', '-q', repo])
    await write(join(repo, 'package.json'), '{"version":"1.0.0"}')
    await write(join(repo, 'package-lock.json'), '{}')
    execFileSync('git', ['-C', repo, 'add', 'package.json', 'package-lock.json'])
    execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture'])
  }
  await write(join(shared, 'make', 'packages', 'make-app', 'package.json'), '{"version":"1.0.0"}')
  await write(join(shared, 'make', 'scripts', 'application-frontend-server.mjs'), "import '" + service + "'\n")
  await write(join(shared, 'env', 'secrets.env'), 'VC_INTERNAL_TOKEN=test\n')
  await write(join(shared, 'env', 'core.env'), [
    'VC_DB_URL=postgres://localhost/shared',
    'VC_DATA_DIR=' + join(shared, 'data'),
    'SISLEXA_COMPONENT_CONFIG=' + join(shared, 'components', 'core', 'config.json'),
    'VC_MAKE_URL=http://localhost:1'
  ].join('\n'))
  await write(join(shared, 'env', 'make.env'), 'VC_CORE_URL=http://localhost:2')
  for (const id of ['core', 'make']) await write(join(shared, 'components', id, 'config.json'), '{}')
  await write(join(shared, 'data', 'session.secret'), 'fixture-secret')
  let base
  for (;;) {
    const port = await freePort()
    const probe = createServer()
    try { await new Promise((r, reject) => { probe.once('error', reject); probe.listen(port + 1, '127.0.0.1', r) }); base = port - 787 }
    catch { continue }
    finally { if (probe.listening) await new Promise(r => probe.close(r)) }
    break
  }
  let uiPort
  do { uiPort = await freePort() } while ([base + 787, base + 788].includes(uiPort))
  let output = ''
  const launchEnv = { ...process.env, PATH: bin + ':' + process.env.PATH,
    SISLEXA_STAND_REF: 'HEAD', SISLEXA_STAND_SOURCES: '', SISLEXA_STAND_NAME: 'test', SISLEXA_STAND_HOME: home, SISLEXA_STAND_SHARE: shared,
    SISLEXA_STAND_MAKE_SOURCE: external ? join(shared, 'make') : '', SISLEXA_STAND_CORE_UI_SOURCE: external ? join(shared, 'sislexa-core-ui') : '',
    SISLEXA_STAND_CORE_SOURCE: core, SISLEXA_STAND_PORT_BASE: String(base), SISLEXA_STAND_UI_PORT: String(uiPort) }
  const child = spawn(process.execPath, [script, command], { env: launchEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', b => { output += b }); child.stderr.on('data', b => { output += b })
  const exited = new Promise(r => child.once('exit', (code, signal) => r({ code, signal })))
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    await exited
    execFileSync(process.execPath, [script, 'stop'], { env: launchEnv })
    for (const id of ['core', 'make', 'core-ui', 'make-ui', 'make-ui-build']) {
      try { const pid = Number(await readFile(join(home, 'run', id + '.pid'), 'utf8')); process.kill(-pid, 'SIGKILL') } catch {}
    }
    await rm(root, { recursive: true, force: true })
  })
  try { await until(() => output.includes('UI:')) } catch (e) { throw Error(e.message + '\n' + output) }
  const pids = {}
  for (const id of ['core', 'make', 'core-ui']) pids[id] = Number(await readFile(join(home, 'run', id + '.pid'), 'utf8'))
  assert.equal(JSON.parse(await readFile(join(core, 'started.json'), 'utf8')).cwd, core)
  await assert.rejects(access(join(home, 'src', 'voiceAIChat')))
  if (external) for (const repo of ['make', 'sislexa-core-ui']) {
    assert.equal(JSON.parse(await readFile(join(shared, repo, 'started.json'), 'utf8')).cwd, join(shared, repo))
    await assert.rejects(access(join(home, 'src', repo)))
  }
  return { child, exited, pids, home, shared, root, launchEnv }
}
test('runs all three prepared conversation checkouts without creating stand worktrees', { timeout: 30000 }, async t => {
  const f = await fixture(t, true)
  const meta = JSON.parse(await readFile(join(f.shared, 'make', 'started.json'), 'utf8'))
  // The API and frontend share a cwd; the frontend writes a separate probe below.
  const frontend = JSON.parse(await readFile(join(f.shared, 'make', 'frontend.json'), 'utf8'))
  assert.equal(frontend.api, '2.0.0')
  assert.equal(frontend.version, '9.8.7')
  assert.equal(frontend.commit, 'manifest-commit')
  assert.ok(meta.pid)
  const uiPids = await Promise.all(['make-ui', 'make-ui-build'].map(async id => Number(await readFile(join(f.home, 'run', id + '.pid'), 'utf8'))))
  f.child.kill('SIGTERM')
  assert.deepEqual(await f.exited, { code: 0, signal: null })
  for (const pid of uiPids) assert.equal(alive(pid), false)
})
test('restarts changed Make/Core UI sources, reuses unchanged processes and detaches frontend watchers', { timeout: 60000 }, async t => {
  const f = await fixture(t, false, 'start')
  assert.deepEqual(await f.exited, { code: 0, signal: null })
  const start = env => execFileSync(process.execPath, [script, 'start'], { env, timeout: 30000 })
  const pid = async id => Number(await readFile(join(f.home, 'run', id + '.pid'), 'utf8'))
  start(f.launchEnv)
  assert.equal(await pid('make'), f.pids.make)
  assert.equal(await pid('core-ui'), f.pids['core-ui'])
  const attached = { ...f.launchEnv, SISLEXA_STAND_MAKE_SOURCE: join(f.shared, 'make'), SISLEXA_STAND_CORE_UI_SOURCE: join(f.shared, 'sislexa-core-ui') }
  start(attached)
  for (const id of ['make', 'core-ui']) {
    assert.notEqual(await pid(id), f.pids[id])
    assert.equal(alive(f.pids[id]), false)
  }
  for (const repo of ['make', 'sislexa-core-ui'])
    assert.equal(JSON.parse(await readFile(join(f.shared, repo, 'started.json'), 'utf8')).cwd, join(f.shared, repo))
  const frontendPid = await pid('make-ui'), watcherPid = await pid('make-ui-build')
  start(f.launchEnv)
  for (const repo of ['make', 'sislexa-core-ui'])
    assert.equal(JSON.parse(await readFile(join(f.home, 'src', repo, 'started.json'), 'utf8')).cwd, join(f.home, 'src', repo))
  assert.equal(alive(frontendPid), false)
  assert.equal(alive(watcherPid), false)
})

test('reports the failed frontend log without waiting for the readiness deadline', { timeout: 30000 }, async t => {
  const f = await fixture(t, true, 'start')
  await f.exited
  execFileSync(process.execPath, [script, 'stop'], { env: f.launchEnv })
  await writeFile(join(f.shared, 'make', 'scripts', 'application-frontend-server.mjs'), "throw new Error('frontend metadata mismatch probe')\n")
  assert.throws(() => execFileSync(process.execPath, [script, 'start'], { env: f.launchEnv, timeout: 15000, stdio: 'pipe' }),
    error => error.status === 1 && error.stderr.toString().includes('make-ui.log') && error.stderr.toString().includes('frontend metadata mismatch probe'))
})
test('rotates oversized service logs while the supervised stand runs', { timeout: 30000 }, async t => {
  const f = await fixture(t)
  const log = join(f.home, 'logs', 'core-ui.log')
  await writeFile(log, 'x'.repeat(9 * 1024 * 1024) + '\nws proxy error: socket hang up\n')
  await until(async () => { try { return (await stat(log)).size < 8192 && (await readFile(log + '.1', 'utf8')).includes('socket hang up') } catch { return false } })
})

for (const signal of ['SIGTERM', 'SIGINT']) test('run stops its processes on ' + signal + ' and uses the supplied Core checkout', { timeout: 30000 }, async t => {
  const f = await fixture(t)
  f.child.kill(signal)
  assert.deepEqual(await f.exited, { code: 0, signal: null })
  for (const pid of Object.values(f.pids)) assert.equal(alive(pid), false)
})
for (const id of ['core', 'core-ui']) test('run fails and stops the remaining processes when ' + id + ' exits', { timeout: 30000 }, async t => {
  const f = await fixture(t)
  process.kill(f.pids[id], 'SIGTERM')
  assert.deepEqual(await f.exited, { code: 1, signal: null })
  for (const pid of Object.values(f.pids)) assert.equal(alive(pid), false)
})
