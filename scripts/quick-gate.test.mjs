import test from 'node:test'
import assert from 'node:assert/strict'
import { planApplicationChecks, scriptReferences } from './application-gate.mjs'
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
test('a root package.json that only edits npm scripts runs the newly referenced tooling tests', () => {
  const rootScripts = [
    { name: 'test:tooling', before: 'node --test scripts/long-run.test.mjs', after: 'node --test scripts/long-run.test.mjs scripts/dev-stand-local.test.mjs' },
    { name: 'dev:stand:run', before: null, after: 'node scripts/dev-stand-local.mjs run' }]
  assert.deepEqual(scriptReferences(rootScripts), ['scripts/dev-stand-local.mjs', 'scripts/dev-stand-local.test.mjs'])
  const pins = { packages: [], tools: [], images: false, archives: [], rootScripts }
  const files = ['package.json', 'scripts/dev-stand-local.mjs', 'scripts/dev-stand-local.test.mjs']
  const narrowed = planApplicationChecks(files, { pins })
  assert.equal(narrowed.full, false)
  assert.equal(narrowed.pinChecks, false)
  assert.equal(narrowed.onlyPins, false)
  const steps = quickPlanCommands(narrowed, files)
  assert.ok(!steps.some(step => step.args?.join(' ') === 'run gate:all'))
  assert.deepEqual(steps.flatMap(step => step.files ?? []), ['scripts/dev-stand-local.test.mjs'])
  // Archive replacements and unproven package.json edits keep the full fallback.
  assert.deepEqual(quickPlanCommands(planApplicationChecks(['package.json'], { pins: { unproven: 'package.json: x' } }), ['package.json']), [{ command: 'npm', args: ['run', 'gate:all'] }])
  const replaced = planApplicationChecks(['package.json'], { pins: { packages: ['@sislexa/make'], tools: [], images: false, archives: [], rootScripts: [] } })
  assert.equal(replaced.rootScriptPaths, undefined)
  assert.deepEqual(quickPlanCommands(replaced, ['package.json']), [{ command: 'npm', args: ['run', 'gate:all'] }])
})
test('a script run as a child process selects its sibling test', () => {
  assert.ok(relatedTooling(['scripts/dev-stand-local.mjs']).includes('scripts/dev-stand-local.test.mjs'))
})
