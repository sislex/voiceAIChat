import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import Fastify from 'fastify'
import { registerBrowserUi } from '../apps/server/src/browserUi/routes.ts'
import { main } from './browser-ui-release.mjs'

function fixture(root) {
  const id = '1.0.0-' + 'a'.repeat(40), directory = join(root, 'candidate')
  mkdirSync(join(directory, 'assets'), { recursive: true })
  const files = { 'index.html': `<script src="/ui/releases/${id}/assets/main.js"></script>`, 'assets/main.js': 'console.log("candidate")' }
  for (const [path, value] of Object.entries(files)) writeFileSync(join(directory, path), value)
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: 1, repository: 'https://github.com/sislex/sislexa-core-ui', version: '1.0.0', commit: 'a'.repeat(40), id, dirty: false, requires: { coreApi: { min: '1.0.0', maxExclusive: '2.0.0' }, applicationHost: { min: '1.1.0', maxExclusive: '2.0.0' } }, files: Object.fromEntries(Object.entries(files).map(([path, value]) => [path, createHash('sha256').update(value).digest('hex')])) }))
  return { id, directory }
}
test('deployment command preflights live Core, activates and rolls back on the same server', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ui-command-')), bundled = join(root, 'bundled'), releases = join(root, 'installed')
  mkdirSync(bundled); writeFileSync(join(bundled, 'index.html'), 'bundled')
  const candidate = fixture(root), app = Fastify()
  try {
    await registerBrowserUi(app, bundled, releases)
    const origin = await app.listen({ host: '127.0.0.1', port: 0 })
    const flags = ['--root', releases, '--core', origin, '--actor', 'release test']
    const before = app.server.address()
    const contract = await main(['describe'])
    assert.equal(contract.version, 2); assert.equal(contract.intentBoundGeneration, true)
    const rawManifestHash = createHash('sha256').update(readFileSync(join(candidate.directory, 'manifest.json'))).digest('hex')
    const controlled = ['--expected-generation', 'null', '--expected-active', 'null', '--manifest-sha256', rawManifestHash, '--target-release', candidate.id]
    await assert.rejects(main(['install', '--directory', candidate.directory, ...flags, '--expected-generation', JSON.stringify('stale')]), /expected generation/)
    await assert.rejects(main(['install', '--directory', candidate.directory, ...flags, '--manifest-sha256', '0'.repeat(64)]), /manifest bytes/)
    await assert.rejects(main(['install', '--directory', candidate.directory, ...flags, '--target-release', 'wrong']), /target release/)
    await main(['install', '--directory', candidate.directory, ...flags, ...controlled])
    assert.match(await (await fetch(origin)).text(), new RegExp(candidate.id))
    assert.equal((await main(['status', ...flags])).active, candidate.id)
    const inspected = await main(['inspect', ...flags])
    assert.equal(inspected.activation.active, candidate.id)
    assert.equal(inspected.installed[0].id, candidate.id)
    await assert.rejects(main(['activate', '--release', 'bundled', ...flags, ...controlled]), /expected generation/)
    await main(['rollback', ...flags])
    assert.equal(await (await fetch(origin)).text(), 'bundled')
    assert.match(await (await fetch(`${origin}/ui/releases/${candidate.id}/assets/main.js`)).text(), /candidate/)
    assert.deepEqual(app.server.address(), before)
    await assert.rejects(main(['activate', '--release', 'bad-id', ...flags]), /Invalid/)
    assert.equal(await (await fetch(origin)).text(), 'bundled')
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }) }
})

test('production launcher only executes the running container, without rebuild/restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'ui-launcher-')), log = join(root, 'commands')
  const docker = join(root, 'docker')
  writeFileSync(docker, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$UI_TEST_LOG"\nif [ "$1" = compose ]; then echo test-container; fi\n', { mode: 0o755 })
  try {
    const result = spawnSync('bash', ['scripts/prod/ui-deploy.sh', 'status'], { encoding: 'utf8', env: { ...process.env, VC_REPO_DIR: root, UI_TEST_LOG: log, PATH: root + ':' + process.env.PATH } })
    assert.equal(result.status, 0, result.stderr)
    const commands = readFileSync(log, 'utf8')
    assert.match(commands, /exec --user node test-container node --import tsx scripts\/browser-ui-release.mjs status/)
    assert.doesNotMatch(commands, /\b(?:up|build|restart|stop|pull)\b/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('controlled UI owner binds generation, live authority and immutable operation recovery', async (t) => {
  const execute = promisify(execFile)
  async function scenario(behavior, check) {
    const root = realpathSync(mkdtempSync(join(homedir(), '.ui-delivery-test-'))), bin = join(root, 'bin')
    mkdirSync(bin, { mode: 0o700 })
    const node = realpathSync(process.execPath), candidate = fixture(root)
    const write = (name, value) => writeFileSync(join(root, name), JSON.stringify(value), { mode: 0o600 })
    write('behavior.json', behavior); write('authority.json', true)
    write('runtime.json', { runtime: { schemaVersion: 1, coreApi: '1.1.0', applicationHost: '1.1.0', active: null, generation: null, configuredGeneration: null }, activation: null })
    writeFileSync(join(bin, 'flock'), '#!/bin/sh\nexec /usr/bin/python3 -c "import fcntl; fcntl.flock(9,fcntl.LOCK_EX|fcntl.LOCK_NB)"\n', { mode: 0o700 })
    writeFileSync(join(bin, 'verify'), `#!${node}
const fs=require('node:fs'),root=${JSON.stringify(root)};let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{
 const lease=JSON.parse(s);fs.appendFileSync(root+'/calls','verify\\n');
 console.log(JSON.stringify(JSON.parse(fs.readFileSync(root+'/authority.json'))?{valid:true,epoch:lease.epoch,leaseId:lease.leaseId}:{valid:false}));
});`, { mode: 0o700 })
    writeFileSync(join(bin, 'docker'), `#!${node}
const fs=require('node:fs'),root=${JSON.stringify(root)},a=process.argv.slice(2),read=n=>JSON.parse(fs.readFileSync(root+'/'+n));
const behavior=read('behavior.json'),state=read('runtime.json'),id=(behavior.changeContainer&&state.activation?'b':'a').repeat(64);
fs.appendFileSync(root+'/calls','docker '+a.join(' ')+'\\n');
if(a[0]==='compose'){console.log(id);process.exit(0)}
if(a[0]==='inspect'){if(behavior.revokeAfterObservation&&state.activation)fs.writeFileSync(root+'/authority.json','false');console.log(id+' sha256:'+'c'.repeat(64)+' 2026-09-25T00:00:00Z true');process.exit(0)}
if(a.includes('rm')&&behavior.failCleanup)process.exit(1);
if(a[0]==='cp'){if(behavior.revokeAfterCopy)fs.writeFileSync(root+'/authority.json','false');process.exit(0)}
if(a.includes('mktemp')){console.log('/tmp/browser-ui.ABCDEFGH');process.exit(0)}
const i=a.indexOf('scripts/browser-ui-release.mjs');if(i<0)process.exit(0);
const command=a[i+1],option=k=>a[a.indexOf(k)+1];
if(command==='describe'){console.log(JSON.stringify({schemaVersion:1,kind:'sislexa-browser-ui-owner',version:behavior.oldOwner?1:2,intentBoundGeneration:true,manifestBytes:true}));process.exit(0)}
if(command==='inspect'){console.log(JSON.stringify(state));process.exit(0)}
if(!['install','activate'].includes(command)||behavior.failActivation)process.exit(1);
if(JSON.parse(option('--expected-generation'))!==state.runtime.generation||JSON.parse(option('--expected-active'))!==state.runtime.active)process.exit(1);
const target=command==='install'?option('--target-release'):option('--release')==='bundled'?null:option('--release');
const next={schemaVersion:1,generation:require('node:crypto').randomUUID(),active:target,previous:state.runtime.active,actor:option('--actor'),activatedAt:new Date().toISOString()};
state.activation=next;Object.assign(state.runtime,{active:target,generation:next.generation,configuredGeneration:next.generation});
fs.writeFileSync(root+'/runtime.json',JSON.stringify(state));fs.appendFileSync(root+'/calls','committed-activation\\n');
if(behavior.lostReply)process.exit(1);console.log(JSON.stringify(next));`, { mode: 0o700 })
    const server = createServer((_req, response) => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ ok: true, application: { applicationId: 'core', commit: 'd'.repeat(40) } })) })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const envelope = { schemaVersion: 1, operation: { id: 'ui-one', manifestHash: 'e'.repeat(64), expectedCoreCommit: 'd'.repeat(40), expectedGeneration: null, expectedActive: null,
      targetRelease: candidate.id, action: 'install', sourceDirectory: candidate.directory, manifestSha256: createHash('sha256').update(readFileSync(join(candidate.directory, 'manifest.json'))).digest('hex') },
      lease: { id: 'ui-one', epoch: 1, leaseId: 'lease-one', expiresAt: Date.now() + 60000, action: 'deploy', runId: 'fixture', environment: 'staging', releaseSetId: 'candidate', manifestHash: 'e'.repeat(64) },
      verifyLeaseCommand: [join(bin, 'verify')], environment: {} }
    write('envelope.json', envelope)
    const env = { ...process.env, PATH: bin + ':' + process.env.PATH, VC_REPO_DIR: root, VC_DEPLOY_LOCK: join(root, 'lock'), VC_UI_DELIVERY_OPERATIONS: join(root, 'operations'), VC_UI_DOCKER: join(bin, 'docker'), VC_HEALTH_URL: 'http://127.0.0.1:' + server.address().port + '/api/health' }
    const run = async (action = 'delivery', arg = join(root, 'envelope.json')) => JSON.parse((await execute('bash', ['scripts/prod/ui-deploy.sh', action, arg], { env, timeout: 15000 })).stdout)
    const renew = () => { envelope.lease.epoch++; envelope.lease.action = 'reconcile'; envelope.lease.leaseId = 'renewed'; write('envelope.json', envelope) }
    const calls = () => { try { return readFileSync(join(root, 'calls'), 'utf8') } catch { return '' } }
    try { await check({ root, run, renew, envelope, write, calls }) }
    finally { await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true, force: true }) }
  }
  await t.test('success, exact replay, cleanup and changed-envelope rejection', () => scenario({}, async x => {
    const result = await x.run(); assert.equal(result.state, 'succeeded'); assert.equal(result.cleanup, 'complete')
    assert.equal((await x.run()).generation, result.generation)
    assert.equal(x.calls().split('committed-activation').length - 1, 1)
    const lines = x.calls().trim().split('\n')
    for (let i = 0; i < lines.length; i++) if (lines[i].startsWith('docker ') && !lines[i].includes(' rm -rf ')) assert.equal(lines[i - 1], 'verify')
    x.envelope.operation.expectedGeneration = 'changed'; x.write('envelope.json', x.envelope)
    await assert.rejects(x.run())
    assert.equal((await x.run('delivery-status', 'ui-one')).state, 'succeeded')
  }))
  await t.test('intent-bound previous generation prevents copying and activation', () => scenario({}, async x => {
    x.envelope.operation.expectedGeneration = 'stale'; x.write('envelope.json', x.envelope)
    await assert.rejects(x.run()); assert.doesNotMatch(x.calls(), /docker cp |committed-activation/)
  }))
  await t.test('old CLI is rejected before effects despite ignoring new options', () => scenario({ oldOwner: true }, async x => {
    await assert.rejects(x.run()); assert.doesNotMatch(x.calls(), /docker cp |committed-activation/)
  }))
  await t.test('revocation after staging blocks activation and recovery observes only', () => scenario({ revokeAfterCopy: true }, async x => {
    await assert.rejects(x.run()); assert.doesNotMatch(x.calls(), /committed-activation/)
    x.write('authority.json', true); x.renew()
    const recovered = await x.run(); assert.equal(recovered.state, 'recovered'); assert.equal(recovered.cleanup, 'complete')
    assert.equal((await x.run()).state, 'recovered'); assert.doesNotMatch(x.calls(), /committed-activation/)
  }))
  await t.test('lost activation reply reconciles the bound actor/generation without reactivation', () => scenario({ lostReply: true }, async x => {
    await assert.rejects(x.run()); x.renew()
    const result = await x.run(); assert.equal(result.state, 'succeeded')
    assert.equal(x.calls().split('committed-activation').length - 1, 1)
    assert.equal((await x.run()).generation, result.generation)
  }))
  await t.test('unknown activation completion retains the barrier for another operation', () => scenario({ failActivation: true }, async x => {
    await assert.rejects(x.run()); x.renew(); assert.equal((await x.run()).state, 'uncertain')
    x.envelope.operation.id = 'another'; x.envelope.lease.id = 'another'; x.envelope.lease.action = 'deploy'; x.envelope.lease.epoch++
    x.write('envelope.json', x.envelope); await assert.rejects(x.run())
  }))
  await t.test('expired authority rejects before Docker and no-op never activates', () => scenario({}, async x => {
    x.envelope.lease.expiresAt = Date.now() - 1; x.write('envelope.json', x.envelope)
    await assert.rejects(x.run()); assert.doesNotMatch(x.calls(), /docker /)
    x.envelope.lease.expiresAt = Date.now() + 60000
    Object.assign(x.envelope.operation, { action: 'activate', targetRelease: null, sourceDirectory: null, manifestSha256: null })
    x.write('envelope.json', x.envelope)
    assert.equal((await x.run()).state, 'noop'); assert.doesNotMatch(x.calls(), /docker cp |committed-activation/)
  }))
  await t.test('changed artifact manifest rejects before copying or activation', () => scenario({}, async x => {
    x.envelope.operation.manifestSha256 = '0'.repeat(64); x.write('envelope.json', x.envelope)
    await assert.rejects(x.run()); assert.doesNotMatch(x.calls(), /docker cp |committed-activation/)
  }))
  await t.test('revocation at terminal observation cannot clear the active barrier', () => scenario({ revokeAfterObservation: true }, async x => {
    await assert.rejects(x.run())
    assert.equal(JSON.parse(readFileSync(join(x.root, 'operations/journal.json'), 'utf8')).active, 'ui-one')
    x.write('behavior.json', {}); x.write('authority.json', true); x.renew()
    assert.equal((await x.run()).state, 'succeeded')
    assert.equal(x.calls().split('committed-activation').length - 1, 1)
  }))
  await t.test('failed staging cleanup remains recorded and reconciliation retries it without activation', () => scenario({ failCleanup: true }, async x => {
    await assert.rejects(x.run())
    const status = await x.run('delivery-status', 'ui-one')
    assert.equal(status.cleanup, 'failed'); assert.equal(status.staging, '/tmp/browser-ui.ABCDEFGH')
    assert.equal(JSON.parse(readFileSync(join(x.root, 'operations/journal.json'), 'utf8')).active, 'ui-one')
    x.write('behavior.json', {}); x.renew()
    const result = await x.run(); assert.equal(result.state, 'succeeded'); assert.equal(result.cleanup, 'complete'); assert.equal(result.staging, undefined)
    assert.equal(x.calls().split('committed-activation').length - 1, 1)
    assert.equal(JSON.parse(readFileSync(join(x.root, 'operations/journal.json'), 'utf8')).active, null)
  }))
  await t.test('Core container replacement cannot become a successful UI-only receipt', () => scenario({ changeContainer: true }, async x => {
    await assert.rejects(x.run()); x.renew(); await assert.rejects(x.run())
    assert.notEqual((await x.run('delivery-status', 'ui-one')).state, 'succeeded')
  }))
})
