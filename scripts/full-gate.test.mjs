import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { FRONTEND_E2E_FILES, FULL_GATE_STAGES, remainingBrowserFiles, runStages, runTestTasks, testConcurrency, testTasks } from './full-gate.mjs'

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
  assert.deepEqual(calls, ['run typecheck', 'run test', 'run build:frontends', 'run verify:core-ui', 'run test:browser'])
  assert.equal(result.length, 5)
  assert.ok(result.every(row => row.exitCode === 0 && row.seconds >= 0))
})

test('parallel test output is printed in task order and all failures are reported', async () => {
  const logs = []
  const tasks = [
    { name: 'slow-first', args: ['first'] },
    { name: 'failed-second', args: ['second'] },
    { name: 'failed-third', args: ['third'] }
  ]
  await assert.rejects(runTestTasks(tasks, async (_command, [name]) => {
    if (name === 'first') await new Promise(resolve => setTimeout(resolve, 15))
    return { status: name === 'first' ? 0 : name === 'second' ? 7 : 9, output: `${name} output` }
  }, { concurrency: 3, log: line => logs.push(line) }), error => {
    assert.match(error.message, /failed-second, failed-third/)
    assert.equal(error.results.length, 3)
    return true
  })
  assert.deepEqual(logs.filter(line => line.startsWith('[gate:tests]')), [
    '[gate:tests] slow-first', '[gate:tests] failed-second', '[gate:tests] failed-third'
  ])
  assert.deepEqual(logs.filter(line => line.endsWith('output')), [
    'first output', 'second output', 'third output'
  ])
})

test('parallel test runner respects its concurrency bound', async () => {
  let active = 0, maximum = 0
  const tasks = Array.from({ length: 7 }, (_, index) => ({ name: `workspace-${index}`, args: [] }))
  await runTestTasks(tasks, async () => {
    active++
    maximum = Math.max(maximum, active)
    await new Promise(resolve => setTimeout(resolve, 5))
    active--
    return { status: 0 }
  }, { concurrency: 2, log: () => {} })
  assert.equal(maximum, 2)
})

test('test concurrency defaults to three and rejects invalid overrides', () => {
  assert.equal(testConcurrency(undefined), 3)
  assert.equal(testConcurrency('4'), 4)
  for (const value of ['0', '-1', '1.5', 'many']) assert.throws(() => testConcurrency(value), /positive integer/)
})

test('full gate creates one process per test-bearing workspace without changing local npm test', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  assert.deepEqual(testTasks(root).map(task => task.name), [
    'tooling',
    '@voicechat/shared',
    '@voicechat/knowledge',
    '@sislexa/component-runtime',
    '@voicechat/automation-runner',
    '@voicechat/server'
  ])
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).scripts
  assert.equal(scripts.test, 'npm run test:tooling && npm run test --workspaces --if-present')
})

test('release command retains performance and owner system acceptance outside the Core gate', () => {
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).scripts
  // gate:release narrows proven owner-archive replacements; its fallback stays the full chain.
  assert.equal(scripts['gate:release'], 'node --import tsx scripts/release-gate.mjs')
  assert.equal(scripts['gate:release:full'], 'npm run gate:all && npm run gate:performance && npm run gate:system')
  assert.equal(scripts['gate:performance'], 'npm run frontend:route-gates')
  assert.equal(scripts['gate:system'], 'node scripts/system-gate.mjs')
  assert.ok(!FULL_GATE_STAGES.some(([, args]) => args.includes('frontend:route-gates') || args.includes('gate:system')))
})
