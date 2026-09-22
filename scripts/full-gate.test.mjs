import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FRONTEND_E2E_FILES, FULL_GATE_STAGES, remainingBrowserFiles, runStages } from './full-gate.mjs'

test('frontend work is removed only after a full successful gate', () => {
  const files = [...FRONTEND_E2E_FILES, 'e2e/settings.e2e.test.ts']
  assert.deepEqual(remainingBrowserFiles(files, false), files)
  assert.deepEqual(remainingBrowserFiles(files, true), ['e2e/settings.e2e.test.ts'])
  assert.deepEqual(new Set([...FRONTEND_E2E_FILES, ...remainingBrowserFiles(files, true)]), new Set(files))
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
test('full stage order keeps all original checks and builds before browser measurement', () => {
  const calls = []
  const result = runStages(FULL_GATE_STAGES, (command, args) => { calls.push(args.join(' ')); return { status: 0 } })
  assert.deepEqual(calls, ['run typecheck','run test','run build:frontends','run verify:core-ui','run frontend:route-gates'])
  assert.equal(result.length, 5)
  assert.ok(result.every(row => row.exitCode === 0 && row.seconds >= 0))
})
