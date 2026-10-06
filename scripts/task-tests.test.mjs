import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { taskTests } from './task-tests.mjs'
import { taskPlan, executeTask } from './task-gate.mjs'

function fixture(t) {
  const directory = resolve('artifacts/gate-task-fixtures')
  mkdirSync(directory, { recursive: true })
  const repository = mkdtempSync(resolve(directory, 'selection-'))
  t.after(() => rmSync(repository, { recursive: true, force: true }))
  const write = (file, source = '') => {
    mkdirSync(dirname(resolve(repository, file)), { recursive: true })
    writeFileSync(resolve(repository, file), source)
  }
  write('package.json', JSON.stringify({ workspaces: ['packages/sample'] }))
  write('packages/sample/package.json', JSON.stringify({ name: 'sample', scripts: { typecheck: 'tsc', test: 'vitest run' } }))
  write('packages/sample/src/x.ts', 'export const x = 1')
  return { repository, write }
}

test('selects changed tests, named tests in the same package, then only direct importers', t => {
  const { repository, write } = fixture(t)
  write('packages/sample/src/changed.test.ts')
  write('packages/sample/tests/x.test.ts')
  write('packages/sample/tests/x.dom.test.tsx')
  write('scripts/x.test.mjs')
  write('packages/sample/src/direct.test.ts', "import { x } from './x.js'")
  write('packages/sample/src/wrapper.ts', "export { x } from './x.js'")
  write('packages/sample/src/transitive.test.ts', "import { x } from './wrapper.js'")
  const files = ['packages/sample/src/changed.test.ts', 'packages/sample/src/x.ts']
  assert.deepEqual(taskTests(files, repository), { files: [
    'packages/sample/src/changed.test.ts', 'packages/sample/tests/x.dom.test.tsx',
    'packages/sample/tests/x.test.ts', 'packages/sample/src/direct.test.ts'
  ], deferred: 0 })
  const steps = taskPlan(files, repository)
  assert.deepEqual(steps[0].args, ['run', '-w', 'sample', 'typecheck'])
  assert.ok(steps.every(step => !step.related))
})

test('keeps ten other direct importers; defers all eleven while retaining own and changed tests', t => {
  const { repository, write } = fixture(t)
  write('packages/sample/src/x.test.ts', "import './x.js'")
  write('packages/sample/src/changed.test.ts', "import './x.js'")
  const files = ['packages/sample/src/changed.test.ts', 'packages/sample/src/x.ts']
  for (let i = 0; i < 10; i++) write(`packages/sample/src/direct${i}.test.ts`, "import './x.js'")
  assert.equal(taskTests(files, repository).files.length, 12)
  assert.equal(taskTests(files, repository).deferred, 0)
  write('packages/sample/src/direct10.test.ts', "import './x.js'")
  assert.deepEqual(taskTests(files, repository), { files: [
    'packages/sample/src/changed.test.ts', 'packages/sample/src/x.test.ts'
  ], deferred: 11 })
  const output = []
  executeTask(taskPlan(files, repository).filter(step => step.deferred), { now: () => 0, log: line => output.push(line) })
  assert.equal(output[0], 'GATE-TASK-DEFERRED: 11 direct importer file(s) left to the promotion gate')
})

test('changed test files run once and deleted tests are not scheduled', t => {
  const { repository, write } = fixture(t)
  write('packages/sample/src/x.test.ts')
  assert.deepEqual(taskTests(['packages/sample/src/x.test.ts', 'packages/sample/src/deleted.test.ts'], repository), {
    files: ['packages/sample/src/x.test.ts'], deferred: 0
  })
})

test('script selection stops at one import edge too', t => {
  const { repository, write } = fixture(t)
  write('scripts/module.mjs')
  write('scripts/module.test.mjs')
  write('scripts/direct.test.mjs', "import './module.mjs'")
  write('scripts/wrapper.mjs', "import './module.mjs'")
  write('scripts/transitive.test.mjs', "import './wrapper.mjs'")
  assert.deepEqual(taskTests(['scripts/module.mjs'], repository), {
    files: ['scripts/module.test.mjs', 'scripts/direct.test.mjs'], deferred: 0
  })
})
