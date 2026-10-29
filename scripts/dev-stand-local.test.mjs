import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, access, chmod, realpath } from 'node:fs/promises'
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
async function fixture(t, external = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'local-stand-')))
  const home = join(root, 'stand'), core = join(root, 'conversation'), shared = join(root, 'shared'), bin = join(root, 'bin')
  const write = async (path, data) => { await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, data) }
  // Real processes and HTTP readiness, without installing or booting product services.
  const service = join(root, 'service.cjs')
  await write(service, `const fs = require('node:fs'); const http = require('node:http');
fs.writeFileSync(process.cwd() + '/started.json', JSON.stringify({ cwd: process.cwd(), pid: process.pid }));
if (process.cwd().endsWith('/packages/make-app')) { fs.mkdirSync('dist', {recursive:true}); fs.writeFileSync('dist/manifest.json', '{}'); setInterval(() => {}, 1000); }
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
  const child = spawn(process.execPath, [script, 'run'], { env: { ...process.env, PATH: bin + ':' + process.env.PATH,
    SISLEXA_STAND_REF: 'HEAD', SISLEXA_STAND_SOURCES: '', SISLEXA_STAND_NAME: 'test', SISLEXA_STAND_HOME: home, SISLEXA_STAND_SHARE: shared,
    SISLEXA_STAND_MAKE_SOURCE: external ? join(shared, 'make') : '', SISLEXA_STAND_CORE_UI_SOURCE: external ? join(shared, 'sislexa-core-ui') : '',
    SISLEXA_STAND_CORE_SOURCE: core, SISLEXA_STAND_PORT_BASE: String(base), SISLEXA_STAND_UI_PORT: String(uiPort) },
    stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', b => { output += b }); child.stderr.on('data', b => { output += b })
  const exited = new Promise(r => child.once('exit', (code, signal) => r({ code, signal })))
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    await exited
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
  return { child, exited, pids }
}
test('runs all three prepared conversation checkouts without creating stand worktrees', { timeout: 30000 }, async t => {
  const f = await fixture(t, true)
  f.child.kill('SIGTERM')
  assert.deepEqual(await f.exited, { code: 0, signal: null })
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
