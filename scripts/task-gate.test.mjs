import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { taskPlan, executeTask, changedFiles, main } from './task-gate.mjs'
import reporter from './task-test-reporter.mjs'

test('task selection narrows Core to changed workspace and explicit test files', () => {
  const steps = taskPlan(['apps/server/src/identityBridge.ts', 'apps/server/src/identityBridge.test.ts'])
  assert.deepEqual(steps, [
    { command: 'npm', args: ['run', '-w', '@voicechat/server', 'typecheck'] },
    { path: 'apps/server', runner: 'vitest',
      files: ['apps/server/src/identityBridge.test.ts'] }
  ])
  assert.deepEqual(taskPlan(['packages/shared/src/devStand.ts'])[0].args,
    ['run', '-w', '@voicechat/shared', 'typecheck'])
})

test('root/config changes never escalate; browser/system/owner suites are excluded', () => {
  assert.deepEqual(taskPlan(['package.json', 'package-lock.json', 'unknown.config',
    'e2e/settings.e2e.test.ts', 'system-tests/owners.json']), [])
  const steps = taskPlan(['apps/server/vitest.config.ts'])
  assert.equal(steps.length, 1)
  assert.equal(steps[0].args.at(-1), 'typecheck')
  assert.ok(steps.every(step => !step.args?.includes('gate:all')))
  const tooling = taskPlan(['scripts/task-gate.mjs'])
  assert.ok(tooling.some(step => step.files?.includes('scripts/task-gate.test.mjs')))
})

test('docs-only and empty diffs execute only kb:check and report zero tests', () => {
  for (const files of [[], ['docs/kb/testing-operations.md', 'AGENTS.md']]) {
    const steps = taskPlan(files), calls = [], output = []
    assert.deepEqual(steps, [{ command: 'npm', args: ['run', 'kb:check'] }])
    executeTask(steps, { spawn: (command, args) => { calls.push([command, args]); return { status: 0 } },
      log: line => output.push(line), now: () => 0 })
    assert.equal(calls.length, 1)
    assert.equal(output.at(-1), 'GATE-TASK: tests=0 seconds=0.000')
  }
})

function reportedRun(count, { status = 0, elapsed = 10, error } = {}) {
  const output = [], calls = []
  let time = 0
  const run = () => executeTask([{ path: 'packages/shared', runner: 'vitest', files: ['packages/shared/src/sample.test.ts'] }], {
    now: () => time, log: line => output.push(line),
    spawn(command, args, options) {
      calls.push({ command, args, options })
      const report = args.find(arg => arg.startsWith('--outputFile.json=')).split('=')[1]
      writeFileSync(report, JSON.stringify({ numTotalTests: count, testResults: [
        { name: 'sample.test.ts', assertionResults: [{ fullName: 'slow case', duration: elapsed }] }
      ] }))
      time = elapsed
      return { status, error }
    }
  })
  return { run, output, calls }
}

test('Vitest reports count cases, accept the boundary and preserve failures', () => {
  const passing = reportedRun(1000)
  passing.run()
  assert.equal(passing.output.at(-1), 'GATE-TASK: tests=1000 seconds=0.010')
  assert.equal(passing.calls[0].options.timeout, 60000)
  assert.ok(passing.calls[0].args.includes('--maxWorkers=4'))
  assert.ok(passing.calls[0].args.includes('--fileParallelism'))
  assert.ok(!passing.calls[0].args.includes('related'))
  assert.ok(passing.output.some(line => line.startsWith('GATE-TASK-CASE:')))
  assert.throws(reportedRun(1, { status: 1 }).run, /Check exited 1/)
})

test('count and wall-time breaches exit 2 with slow-test evidence and summary', () => {
  for (const fixture of [reportedRun(1001), reportedRun(1, { elapsed: 60001 }),
    reportedRun(1, { error: { code: 'ETIMEDOUT' } })]) {
    assert.throws(fixture.run, error => error.exitCode === 2)
    assert.ok(fixture.output.some(line => line.includes('sample.test.ts: slow case')))
    assert.match(fixture.output.at(-1), /^GATE-TASK: tests=\d+ seconds=/)
  }
})

test('timeout without a report identifies unfinished files; missing report fails closed', () => {
  const steps = [{ path: '.', runner: 'node', files: ['scripts/task-gate.test.mjs'] }]
  const output = []
  assert.throws(() => executeTask(steps, { log: line => output.push(line),
    spawn: () => ({ error: { code: 'ETIMEDOUT' } }) }), error => error.exitCode === 2)
  assert.ok(output.some(line => line.includes('scripts/task-gate.test.mjs')))
  assert.throws(() => executeTask(steps, { log() {}, spawn: () => ({ status: 0 }) }), /Missing task test report/)
  assert.throws(() => executeTask(steps, { log() {}, spawn(command, args) {
    assert.ok(args.includes('--test-concurrency=4'))
    return { status: 0 }
  } }), /Missing task test report/)
})

test('typechecking consumes the same wall-time budget and timeout stops the plan', () => {
  let time = 0, calls = 0
  const output = []
  assert.throws(() => executeTask([
    { command: 'npm', args: ['run', '-w', '@voicechat/shared', 'typecheck'] },
    { command: 'npm', args: ['run', 'should-not-run'] }
  ], { now: () => time, log: line => output.push(line), spawn() {
    calls++
    time = 60001
    return { status: 0 }
  } }), error => error.exitCode === 2)
  assert.equal(calls, 1)
  assert.equal(output.at(-1), 'GATE-TASK: tests=0 seconds=60.001')
})

test('Node report counts leaf cases without counting describe suites twice', async () => {
  const directory = resolve('artifacts/gate-task-fixtures')
  mkdirSync(directory, { recursive: true })
  const fixture = mkdtempSync(resolve(directory, 'report-'))
  const previous = process.env.GATE_TASK_REPORT
  process.env.GATE_TASK_REPORT = resolve(fixture, 'results.json')
  try {
    const events = [
      { type: 'test:pass', data: { name: 'case', file: 'test.mjs', details: { type: 'test', duration_ms: 1 } } },
      { type: 'test:pass', data: { name: 'suite', details: { type: 'suite' } } }
    ]
    for await (const _line of reporter(events)) { /* Consume the reporter. */ }
    const { readFileSync } = await import('node:fs')
    assert.equal(JSON.parse(readFileSync(process.env.GATE_TASK_REPORT, 'utf8')).numTotalTests, 1)
  } finally {
    if (previous === undefined) delete process.env.GATE_TASK_REPORT
    else process.env.GATE_TASK_REPORT = previous
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('diff includes tracked and untracked files and never hides git errors', () => {
  const results = ['abc\n', 'a.ts\0b.ts\0', 'b.ts\0c.ts\0']
  assert.deepEqual(changedFiles('base', '.', () => ({ status: 0, stdout: results.shift() })), ['a.ts', 'b.ts', 'c.ts'])
  assert.throws(() => changedFiles('base', '.', () => ({ status: 1, stderr: 'git denied' })), /git denied/)
  for (const args of [[], ['--base'], ['core'], ['--base', '--dry-run']]) assert.throws(() => main(args), /--base/)
})

test('real Node and Vitest adapters produce counted reports', () => {
  const directory = resolve('artifacts/gate-task-fixtures')
  mkdirSync(directory, { recursive: true })
  const fixture = mkdtempSync(resolve(directory, 'case-'))
  const output = []
  try {
    writeFileSync(resolve(fixture, 'node.test.mjs'), "import test from 'node:test'; test('adapter', () => {});\n")
    writeFileSync(resolve(fixture, 'vitest.test.mjs'), "import { test } from 'vitest'; test('adapter', () => {});\n")
    writeFileSync(resolve(fixture, 'vitest.config.mjs'), 'export default { test: { include: ["vitest.test.mjs"], pool: "threads", poolOptions: { threads: { singleThread: true } } } };\n')
    executeTask([
      { path: '.', runner: 'node', files: [resolve(fixture, 'node.test.mjs')] },
      { path: fixture, runner: 'vitest', files: [resolve(fixture, 'vitest.test.mjs')] }
    ], { log: line => output.push(line) })
    assert.match(output.at(-1), /^GATE-TASK: tests=2 seconds=/)
  } finally { rmSync(fixture, { recursive: true, force: true }) }
})
