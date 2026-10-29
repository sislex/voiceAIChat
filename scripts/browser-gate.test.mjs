import { test } from 'node:test'
import assert from 'node:assert/strict'
import { browserWorkers, browserBatches, browserArgs, runBrowserBatches, shortTmpdir } from './browser-gate.mjs'

test('performance and native input stay isolated while reviewed functional suites share two workers', () => {
  const files = ['e2e/sessions.e2e.test.ts', 'e2e/routeResources.e2e.test.ts', 'e2e/settings.e2e.test.ts', 'e2e/routeBudgets.e2e.test.ts', 'e2e/toolIntegration.e2e.test.ts']
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
    assert.throws(() => runBrowserBatches(browserBatches(['e2e/settings.e2e.test.ts', 'e2e/toolIntegration.e2e.test.ts'], 2), (command, args) => {
      calls.push(args); return failure
    }, rows => records.push(structuredClone(rows))), e => e.exitCode === (failure.status ?? 1))
    assert.equal(calls.length, 1)
    assert.equal(records[0][0].exitCode, failure.status ?? 1)
  }
})

test('a deep temp root is replaced so tsx IPC socket paths stay under the macOS limit', () => {
  const deep = '/Users/me/ChatAI/projects/e3dea006-b6f7-45ea-8fa3-97502501456d/merge-clones/repository-runs/99f1b333/.merge-process-99f1b333'
  assert.equal(shortTmpdir(deep, () => '/tmp/vc-e2e-x'), '/tmp/vc-e2e-x')
  assert.equal(shortTmpdir('/var/folders/ll/9h3pq9tn/T/', () => assert.fail('short root kept')), null)
})
