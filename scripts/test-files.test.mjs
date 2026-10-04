import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import * as requireFs from 'node:fs'
import { writeFileSync } from 'node:fs'
import { root, mapTestFiles, runTests, vitestFailures } from './test-files.mjs'
import reporter from './test-failure-reporter.mjs'
test('maps and deduplicates test paths to their actual runners', () => {
  assert.deepEqual(mapTestFiles(['scripts/long-run.test.mjs', 'packages/shared/src/environmentV4.test.ts', 'scripts/long-run.test.mjs']), [
    { path: '.', runner: 'node', files: ['scripts/long-run.test.mjs'] },
    { path: 'packages/shared', runner: 'vitest', files: ['packages/shared/src/environmentV4.test.ts'] }
  ])
  for (const files of [[], ['../outside.test.ts'], ['/outside.test.ts'], ['package.json'], ['scripts/missing.test.mjs']])
    assert.throws(() => mapTestFiles(files))
})
test('Vitest reports only failed repository-relative suites', () => {
  assert.deepEqual(vitestFailures({ testResults: [
    { name: resolve(root, 'packages/shared/src/example.test.ts'), status: 'failed' },
    { name: resolve(root, 'packages/shared/src/pass.test.ts'), status: 'passed' }
  ] }), ['packages/shared/src/example.test.ts'])
})
test('runner adapter keeps workspace cwd, related arguments, and failure status', () => {
  assert.throws(() => runTests({ path: 'packages/shared', runner: 'vitest', related: true, files: ['packages/shared/src/example.ts'] }, {
    spawn(command, args, options) {
      assert.equal(options.cwd, resolve(root, 'packages/shared'))
      assert.ok(args.includes('related'))
      assert.ok(args.includes('src/example.ts'))
      writeFileSync(options.env.GATE_TEST_REPORT, JSON.stringify({ testResults: [
        { name: resolve(root, 'packages/shared/src/example.test.ts'), status: 'failed' }
      ] }))
      return { status: 1 }
    }
  }), error => error.exitCode === 1 && error.failedTests[0] === 'packages/shared/src/example.test.ts')
})
test('node reporter collects actual failure events and preserves diagnostic output', async () => {
  const previous = { report: process.env.GATE_TEST_REPORT, root: process.env.GATE_REPOSITORY_ROOT }
  const { mkdtempSync, rmSync, readFileSync } = await import('node:fs')
  requireFs.mkdirSync(resolve(root, 'artifacts/gate-quick'), { recursive: true })
  const directory = mkdtempSync(resolve(root, 'artifacts/gate-quick/reporter-'))
  process.env.GATE_TEST_REPORT = resolve(directory, 'report.json')
  process.env.GATE_REPOSITORY_ROOT = root
  try {
    async function* events() {
      yield { type: 'test:fail', data: { file: resolve(root, 'scripts/example.test.mjs'), name: 'failure', details: { error: Error('expected failure') } } }
    }
    let output = ''
    for await (const chunk of reporter(events())) output += chunk
    assert.match(output, /expected failure/)
    assert.deepEqual(JSON.parse(readFileSync(process.env.GATE_TEST_REPORT)), ['scripts/example.test.mjs'])
  } finally {
    rmSync(directory, { recursive: true, force: true })
    for (const [name, value] of [['GATE_TEST_REPORT', previous.report], ['GATE_REPOSITORY_ROOT', previous.root]])
      if (value === undefined) delete process.env[name]; else process.env[name] = value
  }
})

for (const runner of ['node', 'vitest']) {
  test(`real ${runner} failures preserve the failing file`, () => {
    const { mkdtempSync, mkdirSync, rmSync, symlinkSync } = requireFs
    mkdirSync(resolve(root, 'artifacts/gate-quick'), { recursive: true })
    const repository = mkdtempSync(resolve(root, 'artifacts/gate-quick/fixture-'))
    try {
      symlinkSync(resolve(root, 'node_modules'), resolve(repository, 'node_modules'), 'dir')
      const path = runner === 'node' ? '.' : 'workspace'
      mkdirSync(resolve(repository, path), { recursive: true })
      const file = runner === 'node' ? 'failure.test.mjs' : 'workspace/failure.test.js'
      writeFileSync(resolve(repository, 'package.json'), JSON.stringify({ type: 'module' }))
      writeFileSync(resolve(repository, file), runner === 'node'
        ? "import test from 'node:test'; import assert from 'node:assert/strict'; test('failure', () => assert.equal(1, 2))"
        : "import { test, expect } from 'vitest'; test('failure', () => expect(1).toBe(2))")
      assert.throws(() => runTests({ path, runner, files: [file] }, { repository }),
        error => error.exitCode === 1 && error.failedTests?.[0] === file)
    } finally { rmSync(repository, { recursive: true, force: true }) }
  })
}
