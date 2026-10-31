import { test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { FRONTEND_E2E_FILES, FULL_GATE_STAGES, collectTestReports, main, reportFullGateFailure, runReportedTask, remainingBrowserFiles, runStages, runTestTasks, testConcurrency, testTasks, toolingCommand } from './full-gate.mjs'
import { browserArgs } from './browser-gate.mjs'

function fixture(t) {
  const parent = fileURLToPath(new URL('../artifacts/', import.meta.url))
  mkdirSync(parent, { recursive: true })
  const root = mkdtempSync(resolve(parent, 'full-gate-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(resolve(root, 'packages/example'), { recursive: true })
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({ workspaces: ['packages/example'], scripts: {
    'test:tooling': 'npm test --prefix packages/example && node --import tsx --test scripts/a.test.mjs && node --test scripts/b.test.mjs && npm run gate:a07 && npm run other-check',
    'gate:a07': 'node --import tsx --test scripts/a07-acceptance.test.mjs',
    'other-check': 'python3 check.py'
  } }))
  writeFileSync(resolve(root, 'packages/example/package.json'), JSON.stringify({ name: 'example', scripts: { test: 'node --test *.test.mjs' } }))
  return root
}

test('reports merge node and Vitest failures, deduplicate paths and tolerate incomplete reports', t => {
  const root = fixture(t), reports = resolve(root, 'reports')
  mkdirSync(reports)
  writeFileSync(resolve(reports, 'node.json'), JSON.stringify(['scripts/a.test.mjs', '../outside.test.mjs', 'README.md']))
  writeFileSync(resolve(reports, 'vitest.json'), JSON.stringify({ testResults: [
    { status: 'failed', name: resolve(root, 'scripts/a.test.mjs') },
    { status: 'passed', name: resolve(root, 'scripts/pass.test.mjs') },
    { status: 'failed', name: resolve(root, 'packages/example/fail.test.ts') }
  ] }))
  writeFileSync(resolve(reports, 'broken.json'), '{')
  assert.deepEqual(collectTestReports(reports, root), ['scripts/a.test.mjs', 'packages/example/fail.test.ts'])
})

test('tooling instruments every node runner including prefixed tests without dropping other commands', t => {
  const root = fixture(t), report = resolve(root, 'report.json')
  const command = toolingCommand(root, report)
  assert.equal(command.match(/--test-reporter /g).length, 4)
  for (let index = 0; index < 4; index++) assert.ok(command.includes(`${report}.${index}.json`))
  assert.ok(command.includes("(cd 'packages/example' && GATE_TEST_REPORT="))
  assert.ok(command.includes('node --import tsx --test --test-reporter'))
  assert.ok(command.includes('scripts/a07-acceptance.test.mjs)'))
  assert.ok(command.endsWith('&& npm run other-check'))
})

test('workspace runner passes reporter options and cleans its report on signals and thrown spawn errors', async t => {
  const root = fixture(t)
  for (const throws of [false, true]) {
    let directory
    const result = await runReportedTask('workspace', ['run', 'test', '-w', 'example'], { root, execute: (_command, args, options) => {
      assert.equal(options.env.GATE_REPOSITORY_ROOT, root)
      assert.equal(options.env.NODE_TEST_CONTEXT, undefined)
      assert.deepEqual(args.slice(-4), ['--', '--reporter=default', '--reporter=json', `--outputFile.json=${options.env.GATE_TEST_REPORT}`])
      directory = dirname(options.env.GATE_TEST_REPORT)
      writeFileSync(options.env.GATE_TEST_REPORT, JSON.stringify({ testResults: [{ status: 'failed', name: resolve(root, 'packages/example/a.test.ts') }] }))
      if (throws) throw Error('spawn failed')
      return { status: null, signal: 'SIGTERM' }
    } })
    assert.deepEqual(result.failedTests, ['packages/example/a.test.ts'])
    assert.notEqual(result.status, 0)
    assert.equal(existsSync(directory), false)
  }
})

test('full gate aggregates parallel failures and ends with exactly the two failure markers', async t => {
  const root = fixture(t), logs = [], reports = new Set()
  t.mock.method(console, 'log', line => logs.push(line))
  await assert.rejects(main({ root, routes: false, execute: async (command, args, { env }) => {
    reports.add(env.GATE_TEST_REPORT)
    if (args.includes('typecheck')) return { status: 0 }
    if (command === 'sh') {
      writeFileSync(`${env.GATE_TEST_REPORT}.0.json`, JSON.stringify(['scripts/a.test.mjs']))
      await new Promise(resolve => setTimeout(resolve, 10))
      return { status: 7, output: 'tooling failure' }
    }
    assert.ok(args.includes('-w'))
    writeFileSync(env.GATE_TEST_REPORT, JSON.stringify({ testResults: [{ status: 'failed', name: resolve(root, 'packages/example/a.test.ts') }] }))
    return { status: 9, output: 'workspace failure' }
  } }), error => {
    assert.equal(error.exitCode, 7)
    reportFullGateFailure(error)
    return true
  })
  assert.equal(reports.size, 3)
  assert.deepEqual(logs.slice(-2), ['GATE-FAILED-STAGE: tests', 'GATE-FAILED-TESTS: ["scripts/a.test.mjs","packages/example/a.test.ts"]'])
  assert.equal(logs.filter(line => line.startsWith('GATE-FAILED-')).length, 2)
  assert.deepEqual(readdirSync(resolve(root, 'artifacts/gate-timings')), ['full.json'])
})

test('non-test failures have an empty array; successful gates emit no failure markers', async t => {
  const root = fixture(t), logs = []
  t.mock.method(console, 'log', line => logs.push(line))
  for (const stage of ['typecheck', 'build:frontends', 'verify:core-ui']) {
    await assert.rejects(main({ root, routes: false, execute: (_command, args) => ({ status: args.includes(stage) ? 3 : 0 }) }), error => {
      assert.deepEqual(error.failedTests, [])
      reportFullGateFailure(error)
      assert.deepEqual(logs.slice(-2), [`GATE-FAILED-STAGE: ${stage === 'build:frontends' ? 'frontends' : stage === 'verify:core-ui' ? 'core-ui-artifact' : stage}`, 'GATE-FAILED-TESTS: []'])
      return true
    })
  }
  logs.length = 0
  await main({ root, routes: false, execute: () => ({ status: 0 }) })
  assert.equal(logs.some(line => line.startsWith('GATE-FAILED-')), false)
})

test('browser and route stage reports reach the final failure markers', async t => {
  const root = fixture(t)
  t.mock.method(console, 'log', () => {})
  for (const routes of [false, true]) {
    await assert.rejects(main({ root, routes, execute: (_command, args, { env }) => {
      if (!routes && !args.includes('test:browser')) return { status: 0 }
      if (routes) assert.ok(args.includes(`--outputFile.json=${env.GATE_TEST_REPORT}`))
      writeFileSync(env.GATE_TEST_REPORT, JSON.stringify({ testResults: [{ status: 'failed', name: resolve(root, 'e2e/example.e2e.test.ts') }] }))
      return { status: 1 }
    } }), error => error.stage === (routes ? 'frontend-browser' : 'browser-integration') && error.failedTests[0] === 'e2e/example.e2e.test.ts')
  }
})

test('browser batches forward the optional full gate report to Vitest', t => {
  const previous = process.env.GATE_TEST_REPORT
  t.after(() => { if (previous === undefined) delete process.env.GATE_TEST_REPORT; else process.env.GATE_TEST_REPORT = previous })
  process.env.GATE_TEST_REPORT = '/report/results.json'
  assert.deepEqual(browserArgs({ workers: 1, files: ['e2e/example.e2e.test.ts'] }).slice(-3), ['--reporter=default', '--reporter=json', '--outputFile.json=/report/results.json'])
})

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
    '@sislexa/file-storage',
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
