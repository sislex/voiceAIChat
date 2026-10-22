import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, stat, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { validateConfig, mutate, observe } from './dev-stand.mjs'

const config = { coreUrl: 'http://127.0.0.1:8799', tokenFile: '/private/token', projectId: 'project', standId: 'stand', component: 'core-ui', workingCopyPath: '/owned/task' }
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dev-stand-cli-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return join(root, 'journal.json')
}
test('configuration rejects unknown components, credentials and relative paths', () => {
  assert.deepEqual(validateConfig(config), config)
  for (const patch of [{ coreUrl: 'https://user:secret@host' }, { coreUrl: 'https://host/path' }, { component: 'other' }, { standId: '../other' }, { workingCopyPath: 'relative' }, { tokenFile: 'relative' }, { token: 'secret' }]) {
    assert.throws(() => validateConfig({ ...config, ...patch }))
  }
})
test('start returns admission immediately and status observes the existing operation', async t => {
  const journal = await fixture(t), calls = []
  const call = async (...args) => { calls.push(args); return { standId: 'stand', operationId: 'job' } }
  const start = await mutate('start', config, journal, 'private-secret', call)
  assert.equal(start.state, 'running')
  assert.deepEqual(calls[0].slice(2), ['/components/core-ui/live', 'POST', { workingCopyPath: '/owned/task' }])
  assert.equal((await stat(journal)).mode & 0o077, 0)
  assert.ok(!(await readFile(journal, 'utf8')).includes('private-secret'))
  assert.equal(calls.length, 1)
  const result = await observe(config, journal, 'private-secret', async (_config, _token, suffix) => {
    assert.ok(['/operations', ''].includes(suffix))
    return suffix ? [{ id: 'other-job', status: 'failed' }, { id: 'job', status: 'succeeded' }] : {
      standId: 'stand', status: 'ready', live: [{ component: 'core-ui', head: 'b'.repeat(40) }], gateway: { health: 'healthy', urls: ['http://localhost:23001', 'http://user:secret@bad'] },
      components: { 'core-ui': { sha: 'a'.repeat(40) } }
    }
  })
  assert.equal(result.state, 'succeeded')
  assert.equal(result.live, true)
  assert.equal(result.sha, 'b'.repeat(40))
  assert.deepEqual(result.urls, ['http://localhost:23001'])
  await assert.rejects(mutate('start', config, journal, 'private-secret', call), { code: 'EEXIST' })
  assert.equal(calls.length, 1)
})
test('a lost response is uncertain and is never retried by status', async t => {
  const journal = await fixture(t)
  const result = await mutate('start', config, journal, 'secret', async () => { throw Error('upstream secret text') })
  assert.equal(result.state, 'uncertain')
  assert.equal(result.error, 'request_outcome_unknown')
  const after = await observe(config, journal, 'secret', async (_config, _token, suffix) => {
    assert.equal(suffix, '')
    return { standId: 'stand' }
  })
  assert.equal(after.state, 'uncertain')
  assert.ok(!(await readFile(journal, 'utf8')).includes('upstream secret text'))
})
test('interrupted request journals and rejected admission remain truthful', async t => {
  const journal = await fixture(t)
  await writeFile(journal, JSON.stringify({ version: 1, action: 'start', target: config, state: 'requesting', operationId: null, startedAt: Date.now() }), { mode: 0o600 })
  const result = await observe(config, journal, 'secret', async () => ({ standId: 'stand' }))
  assert.equal(result.state, 'uncertain')
  const next = journal + '.next'
  assert.equal((await mutate('start', config, next, 'secret', async () => { throw Object.assign(Error('rejected'), { definitive: true, status: 409, safeCode: 'operation_conflict' }) })).state, 'failed')
})
test('stop uses the live reset route and records only safe failure codes', async t => {
  const journal = await fixture(t)
  await mutate('stop', config, journal, 'secret', async (...args) => {
    assert.deepEqual(args.slice(2), ['/components/core-ui/live', 'DELETE', undefined])
    return { standId: 'stand', operationId: 'job' }
  })
  const result = await observe(config, journal, 'secret', async (_config, _token, suffix) => suffix ? [{ id: 'job', status: 'failed', error: 'unsafe output: secret' }] : { standId: 'stand' })
  assert.equal(result.state, 'failed')
  assert.equal(result.error, 'operation_failed')
})
test('status refuses a changed target or non-private journal', async t => {
  const journal = await fixture(t)
  await mutate('start', config, journal, 'secret', async () => ({ standId: 'stand', operationId: 'job' }))
  await assert.rejects(observe({ ...config, component: 'core' }, journal, 'secret'), /journal_target_mismatch/)
  await chmod(journal, 0o644)
  await assert.rejects(observe(config, journal, 'secret'), /private_file_required/)
})
test('CLI uses authenticated HTTP, returns without waiting for readiness and refuses replay', async t => {
  const journal = await fixture(t), requests = []
  const server = createServer((req, res) => {
    requests.push({ path: req.url, auth: req.headers.authorization, method: req.method })
    req.resume()
    res.writeHead(202, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ standId: 'stand', operationId: 'job' }))
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(done => server.close(done)))
  const tokenFile = journal + '.token', configFile = journal + '.config'
  await writeFile(tokenFile, 'private-token\n', { mode: 0o600 })
  await writeFile(configFile, JSON.stringify({ ...config, coreUrl: `http://127.0.0.1:${server.address().port}`, tokenFile }), { mode: 0o600 })
  const run = () => new Promise(done => {
    const child = spawn(process.execPath, [resolve('scripts/dev-stand.mjs'), 'start', '--config', configFile, '--journal', journal])
    let output = ''
    child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
    child.once('exit', code => done({ code, output }))
  })
  const first = await run()
  assert.equal(first.code, 0)
  assert.equal(JSON.parse(first.output).state, 'running')
  assert.equal(requests[0].auth, 'Bearer private-token')
  assert.equal(requests[0].path, '/api/projects/project/dev-stands/stand/components/core-ui/live')
  const replay = await run()
  assert.equal(replay.code, 1)
  assert.match(replay.output, /journal_already_exists_use_status/)
  assert.ok(!first.output.includes('private-token'))
  assert.equal(requests.length, 1)
})

test('temporary observation outages preserve the receipt and terminal failures survive unavailable stand', async t => {
  const journal = await fixture(t)
  await mutate('stop', config, journal, 'secret', async () => ({ standId: 'stand', operationId: 'job' }))
  const unavailable = await observe(config, journal, 'secret', async () => { throw Error('secret network detail') })
  assert.equal(unavailable.state, 'running')
  assert.equal(unavailable.observationError, 'operations_unavailable')
  const final = await observe(config, journal, 'secret', async (_config, _token, suffix) => {
    if (suffix) return [{ id: 'job', status: 'failed', error: 'machine_unavailable' }]
    throw Error('secret network detail')
  })
  assert.equal(final.state, 'failed')
  assert.equal(final.error, 'machine_unavailable')
  assert.equal(final.observationError, 'stand_unavailable')
  const recovered = await observe(config, journal, 'secret', async (_config, _token, suffix) => {
    assert.equal(suffix, '')
    return { standId: 'stand', status: 'ready', live: [] }
  })
  assert.equal(recovered.state, 'failed')
  assert.equal(recovered.live, false)
  assert.ok(!JSON.stringify([unavailable, final, recovered]).includes('secret'))
})
