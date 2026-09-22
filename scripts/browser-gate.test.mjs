import { test } from 'node:test'
import assert from 'node:assert/strict'
import { browserWorkers, browserBatches, browserArgs, runBrowserBatches } from './browser-gate.mjs'

test('performance and native input stay isolated while reviewed functional suites share two workers', () => {
  const files = ['e2e/projects.e2e.test.ts', 'e2e/routeResources.e2e.test.ts', 'e2e/settings.e2e.test.ts', 'e2e/routeBudgets.e2e.test.ts', 'e2e/make.e2e.test.ts']
  const batches = browserBatches([...files, files[0]], 2)
  assert.deepEqual(batches.map(b => b.workers), [1, 1, 1, 2])
  assert.deepEqual(new Set(batches.flatMap(b => b.files)), new Set(files))
  assert.equal(batches.flatMap(b => b.files).length, files.length)
  assert.deepEqual(batches.at(-1).files, [files[0], files[4]])
  assert.ok(browserArgs(batches[0]).includes('--no-file-parallelism'))
  assert.ok(browserArgs(batches.at(-1)).includes('--maxWorkers=2'))
})
test('new suites default to isolation and small machines stay serial', () => {
  assert.equal(browserWorkers(undefined, 2), 1)
  assert.equal(browserWorkers(undefined, 8), 2)
  assert.equal(browserWorkers('1', 8), 1)
  assert.throws(() => browserWorkers('0'), /must be 1 or 2/)
  assert.deepEqual(browserBatches(['e2e/new.e2e.test.ts'], 2), [{ files: ['e2e/new.e2e.test.ts'], workers: 1 }])
  assert.throws(() => browserBatches([]), /explicit browser/)
  assert.throws(() => browserBatches(['--passWithNoTests']), /explicit browser/)
})
test('a failed or signalled browser batch stops the gate and preserves its evidence', () => {
  for (const failure of [{ status: 17 }, { status: null, signal: 'SIGTERM' }]) {
    const records = [], calls = []
    assert.throws(() => runBrowserBatches(browserBatches(['e2e/settings.e2e.test.ts', 'e2e/make.e2e.test.ts'], 2), (command, args) => {
      calls.push(args); return failure
    }, rows => records.push(structuredClone(rows))), e => e.exitCode === (failure.status ?? 1))
    assert.equal(calls.length, 1)
    assert.equal(records[0][0].exitCode, failure.status ?? 1)
  }
})
