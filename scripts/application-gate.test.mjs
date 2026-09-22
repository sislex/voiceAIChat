import { readdirSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { main, planApplicationChecks, lockChangedApplications, validateApplicationDependencies, applicationCommands, applicationPlanCommands, executeApplicationPlan } from './application-gate.mjs'
import { FRONTEND_E2E_FILES, remainingBrowserFiles } from './full-gate.mjs'
import { integrationBrowserFiles } from './browser-gate.mjs'
import { PACKAGES } from './affected-check.mjs'
import { APPLICATION_CATALOG } from '../packages/shared/src/applicationCatalog.ts'

test('missing local workspace edges fail before a dry run can report success', async () => {
  const app = PACKAGES.find(pkg => pkg.id === 'server')
  const previous = app.dependsOn
  try {
    app.dependsOn = previous.filter(id => id !== 'shared')
    for (const args of [['core'], ['core', '--dry-run'], ['--worktree', '--dry-run']])
      await assert.rejects(main(args), /Missing workspace dependencies.*server -> shared/)
  } finally { app.dependsOn = previous }
})
test('missing local catalog edges fail before executing commands', async () => {
  const app = APPLICATION_CATALOG.find(app => app.id === 'core')
  const previous = app.buildDependencies
  try {
    app.buildDependencies = previous.filter(id => id !== 'shared')
    await assert.rejects(main(['core', '--dry-run']), /Missing build dependency.*core -> shared/)
  } finally { app.buildDependencies = previous }
})
test('catalog owns every current workspace and every local dependency', () => {
  assert.doesNotThrow(() => validateApplicationDependencies())
})
test('external requests identify their owner and cannot invoke internal suites', async () => {
  for (const app of APPLICATION_CATALOG.filter(app => app.external)) {
    assert.deepEqual(app.paths, [], app.id)
    assert.deepEqual(app.workspaces, [], app.id)
    assert.deepEqual(applicationCommands(app), [], app.id)
    await assert.rejects(main([app.id, '--dry-run']), /owned by https:\/\/github.com\/sislex\//)
  }
})
test('unknown, retired source paths and root configuration cannot produce empty success', () => {
  for (const path of ['apps/new/src/index.ts','apps/make/src/routes.ts','packages/ui-kit/src/index.ts','Dockerfile','package.json'])
    assert.equal(planApplicationChecks([path]).full, true, path)
})
test('documentation-only diffs need no application commands', () => {
  const plan = planApplicationChecks(['docs/plans/extraction-completion.md'])
  assert.equal(plan.full, false)
  assert.deepEqual(plan.applications, [])
})
test('lock changes select actual consumers of an installed dependency', () => {
  const before = { lockfileVersion: 3, packages: {
    'apps/server': { dependencies: { special: '1' } },
    'node_modules/special': { version: '1' },
    'apps/web': { dependencies: { other: '1' } },
    'node_modules/other': { version: '1' }
  }}
  const after = structuredClone(before)
  after.packages['node_modules/special'].version = '2'
  assert.deepEqual(lockChangedApplications(before, after), ['core'])
  assert.equal(lockChangedApplications({}, after), null)
})
test('root or unowned lock changes expand the consumer gate', () => {
  for (const packages of [{ '': { name: 'new' } }, { 'node_modules/orphan': { version: '1' } }])
    assert.equal(lockChangedApplications({lockfileVersion:3,packages:{}},{lockfileVersion:3,packages}),null)
})
test('Core Reader/browser scenarios remain executable in the full fallback', () => {
  const plan = planApplicationChecks(['Dockerfile'])
  for (const file of ['e2e/make.e2e.test.ts','e2e/webReaderNative.e2e.test.ts'])
    assert.ok(plan.e2eFiles.includes(file), file)
  assert.ok(!plan.e2eFiles.includes('e2e/webReaderAudit.e2e.test.ts'))
})
test('an explicitly changed integration scenario remains selected', () => {
  assert.deepEqual(planApplicationChecks(['e2e/make.e2e.test.ts']).e2eFiles,['e2e/make.e2e.test.ts'])
})

// Removing an external catalog entry must not orphan retained host integration
// suites. Route-budget/lazy-boundary cases already run in frontend:route-gates.
test('every retained Core browser suite has a full-gate owner', () => {
  const plan = planApplicationChecks(['Dockerfile'])
  const scheduled = [...FRONTEND_E2E_FILES, ...integrationBrowserFiles()]
  assert.deepEqual(remainingBrowserFiles(plan.e2eFiles, true), [])
  for (const file of plan.e2eFiles) assert.ok(scheduled.includes(file))
  assert.equal(new Set(scheduled).size, scheduled.length, 'Full gate repeats browser files')
  for (const file of readdirSync(new URL('../e2e/', import.meta.url))) {
    if (!file.endsWith('.e2e.test.ts')) continue
    assert.ok(scheduled.includes('e2e/' + file), `Unscheduled Core browser suite: ${file}`)
  }
})


test('every known browser test selects its complete suite without unrelated application tests', () => {
  const all = new Set([...FRONTEND_E2E_FILES, ...APPLICATION_CATALOG.flatMap(app => app.e2eFiles)])
  for (const file of all) {
    const plan = planApplicationChecks([file])
    assert.equal(plan.full, false, file)
    assert.deepEqual(plan.e2eFiles, [file])
    assert.deepEqual(plan.applications, [])
    const commands = applicationPlanCommands(plan)
    assert.ok(commands.some(([, args]) => args.includes('scripts/browser-gate.mjs') && args.includes(file)))
    assert.ok(!commands.some(([, args]) => args.includes('gate:all') || args.includes('test')))
  }
})
test('browser configuration covers every suite including performance but does not select server units', () => {
  const plan = planApplicationChecks(['e2e/vitest.config.ts'])
  assert.equal(plan.full, false)
  assert.deepEqual(new Set(plan.e2eFiles), new Set([...FRONTEND_E2E_FILES, ...APPLICATION_CATALOG.flatMap(app => app.e2eFiles)]))
  assert.deepEqual(plan.applications, [])
  assert.equal(plan.tooling, true)
})
test('budget edits preserve real Web/Electron measurements and tooling regressions', () => {
  const plan = planApplicationChecks(['frontend-quality/route-budgets.json'])
  assert.equal(plan.full, false)
  assert.deepEqual(plan.e2eFiles, FRONTEND_E2E_FILES)
  assert.equal(plan.tooling, true)
  assert.equal(applicationPlanCommands(plan).filter(([, args]) => args.includes('test:tooling')).length, 1)
})
test('narrow tooling scope never hides another changed critical file', () => {
  for (const file of ['scripts/core-ui-artifact.mjs', 'scripts/long-run.mjs', 'scripts/long-run.test.mjs']) {
    const plan = planApplicationChecks([file])
    assert.equal(plan.full, false)
    assert.equal(plan.tooling, true)
    for (const critical of ['Dockerfile', 'scripts/application-gate.mjs', 'scripts/new-tool.mjs', 'e2e/new.e2e.test.ts'])
      assert.equal(planApplicationChecks([file, critical]).full, true)
  }
})
test('mixed application and browser edits retain the entire application suite', () => {
  const plan = planApplicationChecks(['e2e/projects.e2e.test.ts', 'apps/server/src/routes/rest.ts'])
  assert.deepEqual(plan.applications.map(a => a.id), ['core'])
  assert.deepEqual(plan.e2eFiles, ['e2e/projects.e2e.test.ts'])
  const commands = applicationPlanCommands(plan)
  assert.ok(commands.some(([, args]) => args.join(' ') === 'run -w @voicechat/server test'))
  assert.ok(commands.some(([, args]) => args.includes('e2e/projects.e2e.test.ts')))
})
test('contract consumers typecheck once and combine full declared contract suites', () => {
  const plan = { applications: [], contracts: [
    { workspace: '@voicechat/server', files: ['src/server.test.ts'] },
    { workspace: '@voicechat/server', files: ['src/routes/rest.admin.test.ts'] }
  ] }
  const commands = applicationPlanCommands(plan)
  assert.equal(commands.filter(([, args]) => args.includes('typecheck')).length, 1)
  assert.equal(commands.filter(([, args]) => args.includes('test')).length, 1)
  assert.deepEqual(commands[1][1].slice(-2), ['src/server.test.ts', 'src/routes/rest.admin.test.ts'])
})
test('execution stops after a failing command rather than reporting later stages successful', () => {
  const calls = []
  const plan = planApplicationChecks(['e2e/projects.e2e.test.ts'])
  assert.throws(() => executeApplicationPlan(plan, (command, args) => {
    calls.push(args); throw Object.assign(Error('fixture failure'), { exitCode: 19 })
  }, 'failure-fixture'), /fixture failure/)
  assert.equal(calls.length, 1)
})
