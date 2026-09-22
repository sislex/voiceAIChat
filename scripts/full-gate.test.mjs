import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { FRONTEND_E2E_FILES, FULL_GATE_STAGES, remainingBrowserFiles, runStages } from './full-gate.mjs'

test('frontend work is removed only after a full successful gate', () => {
  const files = [...FRONTEND_E2E_FILES, 'e2e/settings.e2e.test.ts']
  assert.deepEqual(remainingBrowserFiles(files, false), files)
  assert.deepEqual(remainingBrowserFiles(files, true), FRONTEND_E2E_FILES)
  assert.deepEqual(remainingBrowserFiles([...files, files[0]], false), files)
})
test('full gate fails immediately, preserves exit status and records the failed stage', () => {
  const calls = [], records = []
  assert.throws(() => runStages(FULL_GATE_STAGES, (command, args) => {
    calls.push(args); return { status: calls.length === 2 ? 17 : 0 }
  }, rows => records.push(structuredClone(rows))), error => error.exitCode === 17)
  assert.equal(calls.length, 2)
  assert.equal(records.at(-1).at(-1).exitCode, 17)
})
test('signals and missing executables cannot report success', () => {
  for (const result of [{ status: null, signal: 'SIGTERM' }, { status: null, error: Error('ENOENT') }])
    assert.throws(() => runStages([['test', ['test']]], () => result), error => error.exitCode === 1)
})
test('Core gate verifies artifacts and consumer integration; performance is a release stage', () => {
  const calls = []
  const result = runStages(FULL_GATE_STAGES, (command, args) => { calls.push(args.join(' ')); return { status: 0 } })
  assert.deepEqual(calls, ['run typecheck','run test','run build:frontends','run verify:core-ui','run test:browser'])
  assert.equal(result.length, 5)
  assert.ok(result.every(row => row.exitCode === 0 && row.seconds >= 0))
})

test('release command retains performance and owner system acceptance outside the Core gate', () => {
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).scripts
  assert.equal(scripts['gate:release'], 'npm run gate:all && npm run gate:performance && npm run gate:system')
  assert.equal(scripts['gate:performance'], 'npm run frontend:route-gates')
  assert.equal(scripts['gate:system'], 'node scripts/system-gate.mjs')
  assert.ok(!FULL_GATE_STAGES.some(([, args]) => args.includes('frontend:route-gates') || args.includes('gate:system')))
})
