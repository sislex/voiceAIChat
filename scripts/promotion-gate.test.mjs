import test from 'node:test'
import assert from 'node:assert/strict'
import { promotionGate } from './promotion-gate.mjs'
const sha = 'a'.repeat(40)
test('promotion publishes only after gate:all succeeds on the same clean commit', () => {
  const calls = []
  promotionGate((command, args) => {
    calls.push([command, args])
    return args[0] === 'rev-parse' ? sha : ''
  }, commit => { assert.equal(commit, sha); calls.push(['mark']) })
  assert.deepEqual(calls, [
    ['git', ['rev-parse', 'HEAD']], ['git', ['status', '--porcelain']],
    ['npm', ['run', 'gate:all']], ['git', ['rev-parse', 'HEAD']],
    ['git', ['status', '--porcelain']], ['mark']
  ])
})
test('failed gates, changed HEAD and dirty inputs cannot produce attestations', () => {
  for (const failure of ['gate', 'head', 'dirty-before', 'dirty-after']) {
    let passed = false
    assert.throws(() => promotionGate((command, args) => {
      if (command === 'npm') { if (failure === 'gate') throw Error('failed'); passed = true; return '' }
      if (args[0] === 'rev-parse') return passed && failure === 'head' ? 'b'.repeat(40) : sha
      return (failure === 'dirty-before' || (passed && failure === 'dirty-after')) ? ' M source.ts' : ''
    }, () => assert.fail('must not attest')))
  }
})
