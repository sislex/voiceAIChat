import assert from 'node:assert/strict'
import test from 'node:test'
import { planMergeGate } from './merge-gate.mjs'

test('selects only changed feature regressions and owner typechecks', () => {
  const files = [
    'packages/shared/src/chatContract.ts',
    'packages/shared/src/chatContract.test.ts',
    'apps/server/src/db/repos/chat.ts',
    'apps/server/src/routes/rest.conversations.test.ts',
    'scripts/route-gate.mjs',
    'scripts/prod/release_retention.py',
    'docs/kb/ui.md'
  ]
  const plan = planMergeGate(files, () => true)
  assert.equal(plan.focused, true)
  assert.deepEqual(plan.owners.map(owner => [owner.workspace, owner.tests]), [
    ['@voicechat/shared', ['src/chatContract.test.ts']],
    ['@voicechat/server', ['src/routes/rest.conversations.test.ts']]
  ])
  assert.deepEqual(plan.rootTests, ['scripts/route-budgets.test.mjs', 'scripts/prod/release_retention_test.py'])
})

test('falls back when a changed source has no changed regression test', () => {
  const plan = planMergeGate(['apps/server/src/db/repos/chat.ts'], () => true)
  assert.equal(plan.focused, false)
  assert.match(plan.reason, /No changed regression suite/)
})

test('requires a server consumer regression for shared contracts', () => {
  const plan = planMergeGate(['packages/shared/src/chatContract.ts', 'packages/shared/src/chatContract.test.ts'], () => true)
  assert.equal(plan.focused, false)
  assert.match(plan.reason, /server consumer/)
})

test('does not narrow unknown configuration or missing test files', () => {
  assert.equal(planMergeGate(['package.json'], () => true).focused, false)
  assert.equal(planMergeGate(['apps/server/src/routes/rest.test.ts'], () => false).focused, false)
})
