import { test } from 'node:test'
import assert from 'node:assert/strict'
import { systemPlan, executeSystemPlan } from './system-gate.mjs'
const owner = { repository: 'webreader', commit: 'a'.repeat(40) }
const matrix = { schemaVersion: 1, owners: [owner, { ...owner, repository: 'playwrightreader' }, { ...owner, repository: 'sislexa-core-ui' }] }
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
