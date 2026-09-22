import { readdirSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { main, planApplicationChecks, lockChangedApplications, validateApplicationDependencies, applicationCommands } from './application-gate.mjs'
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
  for (const file of ['e2e/make.e2e.test.ts','e2e/applicationFrontend.e2e.test.ts','e2e/applicationReleases.e2e.test.ts','e2e/webReaderNative.e2e.test.ts'])
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
  const routeGateFiles = new Set(['lazyBoundary.e2e.test.ts', 'routeBudgets.e2e.test.ts'])
  for (const file of readdirSync(new URL('../e2e/', import.meta.url))) {
    if (!file.endsWith('.e2e.test.ts') || routeGateFiles.has(file)) continue
    assert.ok(plan.e2eFiles.includes('e2e/' + file), `Unscheduled Core browser suite: ${file}`)
  }
})
