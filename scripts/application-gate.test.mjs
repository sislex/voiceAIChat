import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  planApplicationChecks,
  lockChangedApplications
} from './application-gate.mjs'
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
test('каталог владеет каждым workspace и знает реальные внутренние зависимости', async () => {
  const { readFileSync, existsSync } = await import('node:fs')
  const { APPLICATION_CATALOG, applicationForPath } = await import(
    '../packages/shared/src/applicationCatalog.ts'
  )
  const lock = JSON.parse(
    readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')
  )
  const workspaces = new Map(
    Object.keys(lock.packages)
      .filter(
        (path) =>
          /^(apps|packages)\//.test(path) &&
          !path.includes('/node_modules/') &&
          existsSync(new URL('../' + path + '/package.json', import.meta.url))
      )
      .map((path) => [
        JSON.parse(
          readFileSync(
            new URL('../' + path + '/package.json', import.meta.url),
            'utf8'
          )
        ).name,
        path
      ])
  )
  for (const [name, path] of workspaces) {
    const owner = applicationForPath(path)
    assert.ok(owner, `Нет владельца ${path}`)
    assert.ok(
      owner.workspaces.includes(name),
      `${name} не принадлежит ${owner.id}`
    )
  }
  for (const app of APPLICATION_CATALOG)
    for (const name of app.workspaces) {
      const path = workspaces.get(name)
      assert.ok(path, `Нет workspace ${name}`)
      const pkg = JSON.parse(
        readFileSync(
          new URL('../' + path + '/package.json', import.meta.url),
          'utf8'
        )
      )
      for (const dependency of Object.keys({
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      })) {
        const owner = workspaces.has(dependency)
          ? applicationForPath(workspaces.get(dependency))
          : null
        if (owner && owner.id !== app.id)
          assert.ok(
            app.buildDependencies.includes(owner.id),
            `${app.id} не учитывает сборочную зависимость ${owner.id}`
          )
      }
    }
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
