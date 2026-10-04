import test from 'node:test'
import assert from 'node:assert/strict'
import { planApplicationChecks } from './application-gate.mjs'
import { quickPlanCommands, relatedTooling } from './quick-gate.mjs'
const plan = files => quickPlanCommands(planApplicationChecks(files), files)
test('source edits select typecheck, build and workspace-local related tests', () => {
  const steps = plan(['apps/server/src/identityBridge.ts'])
  assert.ok(steps.some(step => step.args?.join(' ') === 'run -w @voicechat/server typecheck'))
  assert.ok(steps.some(step => step.args?.join(' ') === 'run -w @voicechat/server build'))
  assert.deepEqual(steps.find(step => step.related), {
    path: 'apps/server', runner: 'vitest', related: true, files: ['apps/server/src/identityBridge.ts']
  })
  assert.ok(!steps.some(step => step.args?.includes('test')))
})
test('changed tests run explicitly and documentation does not select tests', () => {
  const steps = plan(['scripts/long-run.test.mjs'])
  assert.deepEqual(steps.at(-1).files, ['scripts/long-run.test.mjs'])
  assert.deepEqual(plan(['docs/kb/testing-operations.md']), [])
})
test('unknown root, gate scripts, lock and workspace configuration retain full fallback', () => {
  for (const file of ['unknown.config', 'package-lock.json', 'scripts/quick-gate.mjs', 'apps/server/vitest.config.ts'])
    assert.deepEqual(plan([file]), [{ command: 'npm', args: ['run', 'gate:all'] }])
})
test('tooling imports select consumers, and contracts run even in selected applications', () => {
  assert.ok(relatedTooling(['scripts/application-gate.mjs']).includes('scripts/quick-gate.test.mjs'))
  const base = planApplicationChecks(['apps/server/src/identityBridge.ts'])
  base.contracts = [{ workspace: '@voicechat/server', files: ['src/identityBridge.test.ts'] }]
  const steps = quickPlanCommands(base, ['apps/server/src/identityBridge.ts'])
  assert.ok(steps.some(step => step.files?.includes('apps/server/src/identityBridge.test.ts')))
})
test('quick CLI requires a base and rejects application shortcuts', async () => {
  const { main } = await import('./quick-gate.mjs')
  await assert.rejects(main([]), /--base/)
  await assert.rejects(main(['--base']), /--base/)
  await assert.rejects(main(['core']), /Unknown argument/)
})
