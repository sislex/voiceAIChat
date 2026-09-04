import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { getRunStatus, startRun } from './long-run.mjs'

const delay = (ms) => new Promise((done) => setTimeout(done, ms))
const makeEnv = () => ({ ...process.env, VC_LONG_RUN_DIR: mkdtempSync(join(tmpdir(), 'voicechat-long-run-')) })

async function waitFor(runId, env, wanted = ['succeeded', 'failed']) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const status = await getRunStatus(runId, env)
    if (wanted.includes(status.state)) return status
    await delay(20)
  }
  throw new Error(`timed out waiting for ${runId}`)
}

test('successful run preserves argv, stdout/stderr and read-only repeatable status', async () => {
  const env = makeEnv()
  const marker = 'value with spaces & $special'
  const run = await startRun([process.execPath, '-e', "console.log(process.argv[1]); console.error('from-stderr'); setTimeout(() => {}, 200)", marker], env)
  assert.equal((await getRunStatus(run.runId, env)).state, 'running')
  const done = await waitFor(run.runId, env)
  assert.equal(done.state, 'succeeded')
  assert.equal(done.exitCode, 0)
  assert.deepEqual(done.command.at(-1), marker)
  const log = readFileSync(done.logPath, 'utf8')
  assert.match(log, /value with spaces & \$special/)
  assert.match(log, /from-stderr/)
  const before = statSync(done.statusPath).mtimeMs
  assert.deepEqual(await getRunStatus(run.runId, env), done)
  assert.equal(statSync(done.statusPath).mtimeMs, before)
})

test('failed run preserves its exact exit code and diagnostics', async () => {
  const env = makeEnv()
  const run = await startRun([process.execPath, '-e', "console.error('failure-marker'); process.exit(23)"], env)
  const done = await waitFor(run.runId, env)
  assert.equal(done.state, 'failed')
  assert.equal(done.exitCode, 23)
  assert.match(readFileSync(done.logPath, 'utf8'), /failure-marker/)
})

test('parallel runs keep separate identifiers, paths, logs and exit codes', async () => {
  const env = makeEnv()
  const [one, two] = await Promise.all([
    startRun([process.execPath, '-e', "console.log('only-one'); setTimeout(() => process.exit(7), 100)"], env),
    startRun([process.execPath, '-e', "console.log('only-two'); setTimeout(() => {}, 100)"], env)
  ])
  assert.notEqual(one.runId, two.runId)
  assert.notEqual(one.logPath, two.logPath)
  assert.notEqual(one.pid, two.pid)
  const [first, second] = await Promise.all([waitFor(one.runId, env), waitFor(two.runId, env)])
  assert.equal(first.exitCode, 7)
  assert.equal(second.exitCode, 0)
  assert.match(readFileSync(first.logPath, 'utf8'), /only-one/)
  assert.doesNotMatch(readFileSync(first.logPath, 'utf8'), /only-two/)
})

test('missing worker is lost and malformed or unknown statuses are errors', async () => {
  const env = makeEnv()
  const lostId = 'lost-run'
  const lostPath = join(env.VC_LONG_RUN_DIR, `${lostId}.json`)
  writeFileSync(lostPath, JSON.stringify({
    version: 1,
    runId: lostId,
    pid: 2147483647,
    startedAt: new Date().toISOString(),
    command: ['not-run'],
    state: 'running'
  }))
  assert.equal((await getRunStatus(lostId, env)).state, 'lost')
  assert.equal(statSync(lostPath).size, statSync(lostPath).size)
  await assert.rejects(getRunStatus('missing-run', env), /unknown runId/)
  writeFileSync(join(env.VC_LONG_RUN_DIR, 'malformed-run.json'), '{')
  await assert.rejects(getRunStatus('malformed-run', env), /malformed status/)
})

test('empty command fails before creating a run', async () => {
  const env = makeEnv()
  await assert.rejects(startRun([], env), /usage/)
  const result = spawnSync(process.execPath, ['scripts/long-run.mjs', 'status', 'missing-run'], { cwd: join(import.meta.dirname, '..'), env, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /unknown runId/)
})

test('the complete repository artifact directory is ignored by git', () => {
  const repository = join(import.meta.dirname, '..')
  const artifactDir = join(repository, '.long-runs')
  mkdirSync(artifactDir, { recursive: true })
  const prefix = `ignore-check-${process.pid}-${Date.now()}`
  const paths = [`${prefix}.log`, `${prefix}.json`, `${prefix}.json.tmp`]
  try {
    for (const path of paths) writeFileSync(join(artifactDir, path), path)
    const result = spawnSync('git', ['check-ignore', ...paths.map((path) => join('.long-runs', path))], { cwd: repository, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim().split('\n').length, paths.length)
  } finally {
    for (const path of paths) rmSync(join(artifactDir, path), { force: true })
  }
})
