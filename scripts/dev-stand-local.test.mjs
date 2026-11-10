import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, access, chmod, realpath, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { STAND_BASE_PORT_OFFSETS as BASE_PORT_OFFSETS, STAND_DERIVED_PORT_OFFSETS as DERIVED_PORT_OFFSETS } from './dev-stand-local-ports.mjs'

const STAND_BASE_PORT_OFFSETS = { ...BASE_PORT_OFFSETS, storage: 799 }
const STAND_DERIVED_PORT_OFFSETS = [...DERIVED_PORT_OFFSETS, 799]
const script = resolve('scripts/dev-stand-local.mjs')
async function freePort() {
  const server = createServer()
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  await new Promise(r => server.close(r))
  return port
}
async function freeBase() {
  for (;;) {
    const candidate = await freePort() - STAND_BASE_PORT_OFFSETS.core
    if (candidate < 1024 || candidate + Math.max(...STAND_DERIVED_PORT_OFFSETS) > 65535) continue
    const reservations = STAND_DERIVED_PORT_OFFSETS.map(() => createServer())
    let available
    try {
      available = await Promise.all(reservations.map((server, index) => new Promise(resolve => {
        server.once('error', () => resolve(false))
        server.listen(candidate + STAND_DERIVED_PORT_OFFSETS[index], '127.0.0.1', () => resolve(true))
      })))
    } finally {
      await Promise.all(reservations.map(server => server.listening
        ? new Promise(resolve => server.close(resolve))
        : undefined))
    }
    if (available.every(Boolean)) return candidate
  }
}
async function until(check) {
  for (let n = 0; n < 600; n++) {
    if (await check()) return
    await delay(100)
  }
  throw Error('timed out')
}
function alive(pid) { try { process.kill(pid, 0); return true } catch { return false } }
async function fixture(t, external = false, command = 'run', full = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'local-stand-')))
  const home = join(root, 'stand'), core = join(root, 'conversation'), shared = join(root, 'shared'), bin = join(root, 'bin')
  const write = async (path, data) => { await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, data) }
  // Real processes and HTTP readiness, without installing or booting product services.
  const service = join(root, 'service.cjs')
  await write(service, `const fs = require('node:fs'); const http = require('node:http');
fs.writeFileSync(process.cwd() + (process.env.VC_APPLICATION_ID === 'make-ui' ? '/frontend.json' : '/started.json'), JSON.stringify({ cwd: process.cwd(), pid: process.pid, api: process.env.VC_APPLICATION_API_VERSION, version: process.env.VC_APPLICATION_VERSION, commit: process.env.VC_APPLICATION_COMMIT, dev: process.env.VC_APPLICATION_DEV }));
if (process.env.PORT) fs.writeFileSync(process.cwd() + '/probe-' + process.env.PORT + '.json', JSON.stringify(Object.fromEntries(['VC_KANBAN_BACKGROUND', 'VC_CORE_URL', 'VC_DB_URL', 'VC_LLM_RUNNER_CODEX_URL', 'BILLING_DATA_DIR', 'ANALYTICS_DATA_DIR', 'STORAGE_DB_URL', 'VC_FILE_STORAGE_NODES'].map(key => [key, process.env[key]]))));
if (/\\/packages\\/[^/]+-app$/.test(process.cwd())) { fs.mkdirSync('dist', {recursive:true}); fs.writeFileSync('dist/manifest.json', JSON.stringify({ version: '9.8.7', commit: 'manifest-commit', apiVersion: '2.0.0' })); setInterval(() => {}, 1000); }
else if (!process.env.PORT && !process.env.VC_WEB_PORT) setInterval(() => {}, 1000);
else http.createServer((req,res) => res.end('ok')).listen(Number(process.env.PORT || process.env.VC_WEB_PORT), '127.0.0.1');
`)
  for (const command of ['npm', 'npx', ...(full ? ['node'] : [])]) {
    await write(join(bin, command), '#!/bin/sh\nexec "' + process.execPath + '" "' + service + '"\n')
    await chmod(join(bin, command), 0o755)
  }
  const extraRepos = full ? ['sislexa-kanban', 'identity', 'billing', 'analytics', 'webreader', 'playwrightreader', 'image-studio', 'voice', 'storage'] : []
  for (const repo of [core, join(shared, 'make'), join(shared, 'sislexa-core-ui'), ...extraRepos.map(repo => join(shared, repo))]) {
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
  if (full) {
    for (const [repo, pkg] of [['webreader', 'web-reader'], ['playwrightreader', 'playwright-reader'], ['image-studio', 'image-studio']]) {
      await write(join(shared, repo, 'packages', pkg + '-app', 'package.json'), '{"version":"1.0.0"}')
    }
    await mkdir(join(shared, 'webreader', 'apps', 'web-recorder'), { recursive: true })
    for (const id of ['identity', 'billing', 'analytics', 'kanban', 'reader', 'playwright-reader', 'browser-runner', 'image-studio', 'tts', 'stt', 'automation', 'storage'])
      await write(join(shared, 'env', id + '.env'), [
        'VC_CORE_URL=http://localhost:2', 'VC_DB_URL=postgres://localhost/shared',
        'VC_DATA_DIR=' + join(shared, 'data', id), 'STORAGE_DB_URL=sqlite:/shared/storage.sqlite',
        'BILLING_DATA_DIR=/shared/billing', 'ANALYTICS_DATA_DIR=/shared/analytics',
        'VC_AUTOMATION_DATA_DIR=/shared/automation', 'VC_LLM_RUNNER_CODEX_URL=http://shared-runner:9000',
        'VC_FILE_STORAGE_NODES=[{"id":"shared-node","url":"http://shared-node:9001"}]'
      ].join('\n'))
  }
  const base = await freeBase()
  let uiPort
  do { uiPort = await freePort() } while ([0, 8, 9, 10].some(uiOffset => STAND_DERIVED_PORT_OFFSETS.some(offset => uiPort + uiOffset === base + offset)))
  let output = ''
  const launchEnv = { ...process.env, PATH: bin + ':' + process.env.PATH,
    // Core UI is configured through VC_WEB_PORT. An ambient PORT (for example
    // from a parallel gate worker) would make the fake service listen elsewhere.
    PORT: '', SISLEXA_STAND_SERVICES: full ? 'all' : 'core',
    ...Object.fromEntries(extraRepos.map(repo => ['SISLEXA_STAND_' + ({ 'sislexa-kanban': 'KANBAN', webreader: 'WEB_READER', playwrightreader: 'PLAYWRIGHT_READER', 'image-studio': 'IMAGE_STUDIO' }[repo] ?? repo.toUpperCase()) + '_SOURCE', join(shared, repo)])),
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
  try { await until(() => { if (output.includes('UI:')) return true; if (child.exitCode !== null) throw Error('launcher exited'); return false }) } catch (e) { throw Error(e.message + '\n' + output) }
  const pids = {}
  for (const id of ['core', 'make', 'core-ui']) pids[id] = Number(await readFile(join(home, 'run', id + '.pid'), 'utf8'))
  assert.equal(JSON.parse(await readFile(join(core, 'started.json'), 'utf8')).cwd, core)
  await assert.rejects(access(join(home, 'src', 'voiceAIChat')))
  if (external) for (const repo of ['make', 'sislexa-core-ui']) {
    assert.equal(JSON.parse(await readFile(join(shared, repo, 'started.json'), 'utf8')).cwd, join(shared, repo))
    await assert.rejects(access(join(home, 'src', repo)))
  }
  return { child, exited, pids, home, shared, root, launchEnv, base }
}
test('full shared mode runs all services from prepared sources and retains shared data', { timeout: 120000 }, async t => {
  const f = await fixture(t, true, 'run', true)
  const probe = async (repo, offset) => JSON.parse(await readFile(join(f.shared, repo, 'probe-' + (f.base + offset) + '.json'), 'utf8'))
  const kanban = await probe('sislexa-kanban', STAND_BASE_PORT_OFFSETS.kanban)
  assert.equal(kanban.VC_KANBAN_BACKGROUND, 'off')
  assert.equal(kanban.VC_CORE_URL, 'http://127.0.0.1:' + (f.base + STAND_BASE_PORT_OFFSETS.core))
  assert.equal(kanban.VC_DB_URL, 'postgres://localhost/shared')
  assert.equal(kanban.VC_LLM_RUNNER_CODEX_URL, 'http://shared-runner:9000')
  assert.equal((await probe('billing', STAND_BASE_PORT_OFFSETS.billing)).BILLING_DATA_DIR, '/shared/billing')
  assert.equal((await probe('analytics', STAND_BASE_PORT_OFFSETS.analytics)).ANALYTICS_DATA_DIR, '/shared/analytics')
  const storage = await probe('storage', STAND_BASE_PORT_OFFSETS.storage)
  assert.equal(storage.STORAGE_DB_URL, 'sqlite:/shared/storage.sqlite')
  assert.equal(JSON.parse(storage.VC_FILE_STORAGE_NODES)[0].url, 'http://shared-node:9001')
  for (const id of ['identity', 'billing', 'analytics', 'reader', 'playwright-reader', 'browser-runner', 'image-studio', 'tts', 'stt', 'automation', 'storage'])
    assert.ok(Number(await readFile(join(f.home, 'run', id + '.pid'), 'utf8')))
  // Every service is supervised, including secondary components.
  process.kill(Number(await readFile(join(f.home, 'run', 'kanban.pid'), 'utf8')), 'SIGTERM')
  assert.deepEqual(await f.exited, { code: 1, signal: null })
})

test('runs all three prepared conversation checkouts without creating stand worktrees', { timeout: 60000 }, async t => {
  const f = await fixture(t, true)
  const meta = JSON.parse(await readFile(join(f.shared, 'make', 'started.json'), 'utf8'))
  // The API and frontend share a cwd; the frontend writes a separate probe below.
  const frontend = JSON.parse(await readFile(join(f.shared, 'make', 'frontend.json'), 'utf8'))
  assert.equal(frontend.api, '2.0.0')
  assert.equal(frontend.version, '9.8.7')
  assert.equal(frontend.commit, 'manifest-commit')
  assert.equal(frontend.dev, '1')
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

test('reports the failed frontend log without waiting for the readiness deadline', { timeout: 60000 }, async t => {
  const f = await fixture(t, true, 'start')
  await f.exited
  execFileSync(process.execPath, [script, 'stop'], { env: f.launchEnv })
  await writeFile(join(f.shared, 'make', 'scripts', 'application-frontend-server.mjs'), "throw new Error('frontend metadata mismatch probe')\n")
  assert.throws(() => execFileSync(process.execPath, [script, 'start'], { env: f.launchEnv, timeout: 15000, stdio: 'pipe' }),
    error => error.status === 1 && error.stderr.toString().includes('make-ui.log') && error.stderr.toString().includes('frontend metadata mismatch probe'))
})
test('rotates oversized service logs while the supervised stand runs', { timeout: 60000 }, async t => {
  const f = await fixture(t)
  const log = join(f.home, 'logs', 'core-ui.log')
  await writeFile(log, 'x'.repeat(9 * 1024 * 1024) + '\nws proxy error: socket hang up\n')
  await until(async () => { try { return (await stat(log)).size < 8192 && (await readFile(log + '.1', 'utf8')).includes('socket hang up') } catch { return false } })
})

for (const signal of ['SIGTERM', 'SIGINT']) test('run stops its processes on ' + signal + ' and uses the supplied Core checkout', { timeout: 60000 }, async t => {
  const f = await fixture(t)
  f.child.kill(signal)
  assert.deepEqual(await f.exited, { code: 0, signal: null })
  for (const pid of Object.values(f.pids)) assert.equal(alive(pid), false)
})
for (const id of ['core', 'core-ui']) test('run fails and stops the remaining processes when ' + id + ' exits', { timeout: 60000 }, async t => {
  const f = await fixture(t)
  process.kill(f.pids[id], 'SIGTERM')
  assert.deepEqual(await f.exited, { code: 1, signal: null })
  for (const pid of Object.values(f.pids)) assert.equal(alive(pid), false)
})
