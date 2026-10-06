import { test } from 'node:test'
import assert from 'node:assert/strict'
import { systemPlan, executeSystemPlan, selectSystemOwners } from './system-gate.mjs'
const owner = { repository: 'webreader', commit: 'a'.repeat(40) }
const matrix = { schemaVersion: 1, owners: [owner, { ...owner, repository: 'playwrightreader' }, { ...owner, repository: 'sislexa-core-ui' }] }
test('owner selection preserves exact commits and rejects missing or unknown owners', () => {
  const plan = systemPlan(matrix, 'b'.repeat(40))
  assert.deepEqual(selectSystemOwners(plan, []), plan)
  for (const row of plan) assert.deepEqual(selectSystemOwners(plan, ['--owners', row.repository]), [row])
  assert.deepEqual(selectSystemOwners(plan, ['--owners', 'webreader,sislexa-core-ui']), [plan[0], plan[2]])
  for (const args of [['--owners'], ['--owners', ''], ['--owners', 'unknown']]) assert.throws(() => selectSystemOwners(plan, args))
})
test('release scenarios require pinned, known, unique repositories', () => {
  assert.equal(systemPlan(matrix, 'b'.repeat(40))[0].url, 'https://github.com/sislex/webreader.git')
  assert.throws(() => systemPlan(matrix, 'main'))
  for (const owners of [[], [owner], [owner, owner], [{ ...owner, commit: 'main' }], [{ ...owner, repository: '../core' }]]) assert.throws(() => systemPlan({ ...matrix, owners }, 'b'.repeat(40)))
})
test('one owner failure prevents later system stages', () => {
  const calls = []
  assert.throws(() => executeSystemPlan([owner, owner], row => { calls.push(row); throw Error('browser failed') }), /browser failed/)
  assert.equal(calls.length, 1)
})
