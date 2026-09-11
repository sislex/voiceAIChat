import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  main,
  planApplicationChecks,
  lockChangedApplications,
  validateApplicationDependencies
} from './application-gate.mjs'
import { PACKAGES } from './affected-check.mjs'
import { APPLICATION_CATALOG } from '../packages/shared/src/applicationCatalog.ts'

test('application gates reject missing manifest edges before running checks or a dry run', async () => {
  const panel = PACKAGES.find((pkg) => pkg.id === 'make-app')
  const dependencies = panel.dependsOn
  try {
    panel.dependsOn = dependencies.filter((id) => id !== 'make-contracts')
    for (const args of [['make'], ['make', '--dry-run'], ['--worktree', '--dry-run']]) {
      await assert.rejects(main(args), /Missing workspace dependencies.*make-app -> make-contracts/)
    }
  } finally {
    panel.dependsOn = dependencies
  }
})

test('application gates reject missing catalog edges before running checks or a dry run', async () => {
  const panel = APPLICATION_CATALOG.find((app) => app.id === 'make-ui')
  const dependencies = panel.buildDependencies
  try {
    panel.buildDependencies = dependencies.filter((id) => id !== 'make-contracts')
    for (const args of [['make'], ['make', '--dry-run'], ['--worktree', '--dry-run']]) {
      await assert.rejects(main(args), /Missing build dependency.*make-ui -> make-contracts/)
    }
  } finally {
    panel.buildDependencies = dependencies
  }
})

test('внутренний Make не втягивает сервер или UI', () => {
  const p = planApplicationChecks(['apps/make/src/workspace.ts'])
  assert.equal(p.full, false)
  assert.deepEqual(
    p.applications.map((a) => a.id),
    ['make']
  )
  assert.deepEqual(p.contracts, [])
})
test('контракт Make добавляет адресные мосты', () => {
  const p = planApplicationChecks(['apps/make/src/service.ts'])
  assert.equal(p.contracts[0].workspace, '@voicechat/server')
  assert.deepEqual(p.contracts[0].files, ['src/makeBridge'])
})
test('вынесенный контракт проверяет потребителей', () => {
  const p = planApplicationChecks(['packages/make-contracts/src/core.ts'])
  assert.ok(p.applications.some((a) => a.id === 'make'))
  assert.ok(p.applications.some((a) => a.id === 'core'))
  assert.ok(p.applications.some((a) => a.id === 'make-ui'))
})
test('неизвестные пути и root конфиг не дают пустой успех', () => {
  for (const file of ['apps/new/src/index.ts', 'Dockerfile', 'package.json'])
    assert.equal(planApplicationChecks([file]).full, true)
})
test('документация не запускает приложения, удаление и перенос проверяют обе стороны', () => {
  assert.deepEqual(
    planApplicationChecks(['docs/plans/test.md']).applications,
    []
  )
  assert.deepEqual(
    planApplicationChecks([
      'apps/make/src/deleted.ts',
      'apps/image-studio/src/moved.ts'
    ]).applications.map((a) => a.id),
    ['make', 'image-studio']
  )
})
test('lock diff учитывает только владельцев изменённых зависимостей', () => {
  const before = {
    lockfileVersion: 3,
    packages: {
      'apps/make': { dependencies: { special: '1' } },
      'node_modules/special': { version: '1' },
      'apps/image-studio': { dependencies: { other: '1' } },
      'node_modules/other': { version: '1' }
    }
  }
  const after = structuredClone(before)
  after.packages['node_modules/special'].version = '2'
  assert.deepEqual(lockChangedApplications(before, after), ['make'])
  assert.equal(lockChangedApplications({}, after), null)
})
test('root lock и неизвестные изменения зависимостей расширяют гейт', () => {
  assert.equal(
    lockChangedApplications(
      { lockfileVersion: 3, packages: {} },
      { lockfileVersion: 3, packages: { '': { name: 'new' } } }
    ),
    null
  )
  assert.equal(
    lockChangedApplications(
      { lockfileVersion: 3, packages: {} },
      {
        lockfileVersion: 3,
        packages: { 'node_modules/orphan': { version: '1' } }
      }
    ),
    null
  )
})
test('каталог владеет каждым workspace и знает реальные внутренние зависимости', () => {
  assert.doesNotThrow(() => validateApplicationDependencies())
})
test('изменение браузерного поведения и сам E2E включают исполняемый браузерный набор', () => {
  assert.deepEqual(
    planApplicationChecks(['apps/make/src/transpile.ts']).e2eFiles,
    ['e2e/make.e2e.test.ts']
  )
  assert.deepEqual(planApplicationChecks(['e2e/make.e2e.test.ts']).e2eFiles, [
    'e2e/make.e2e.test.ts'
  ])
})
test('панель Make проверяется самостоятельно без сборки host', () => {
  const p = planApplicationChecks([
    'packages/make-app/src/components/MakePane.tsx'
  ])
  assert.equal(p.full, false)
  assert.deepEqual(
    p.applications.map((app) => app.id),
    ['make-ui']
  )
  assert.deepEqual(p.contracts, [])
  assert.deepEqual(p.e2eFiles, ['e2e/applicationFrontend.e2e.test.ts'])
})
test('публичный контракт панели проверяет загрузчик host', () => {
  const p = planApplicationChecks(['packages/make-app/src/panelContract.ts'])
  assert.deepEqual(p.contracts, [
    {
      workspace: '@voicechat/ui',
      files: ['src/runtime/applicationHost.dom.test.tsx']
    }
  ])
})
test('полный fallback сохраняет реальные браузерные проверки', () => {
  const p = planApplicationChecks(['Dockerfile'])
  assert.ok(p.e2eFiles.includes('e2e/make.e2e.test.ts'))
  assert.ok(p.e2eFiles.includes('e2e/applicationFrontend.e2e.test.ts'))
  assert.ok(p.e2eFiles.includes('e2e/applicationReleases.e2e.test.ts'))
})

test('изменение Reader не запускает наборы core и других приложений', () => {
  for (const file of ['apps/web-reader/src/routes/previewCookies.ts','apps/web-recorder/src/scenarioRunner.ts','apps/playwright-reader/src/routes.ts']) {
    const plan = planApplicationChecks([file])
    assert.equal(plan.full, false)
    assert.deepEqual(plan.applications.map(app=>app.id), [file.includes('playwright-reader') ? 'playwright-reader' : 'web-reader'])
  }
})
