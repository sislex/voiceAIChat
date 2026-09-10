import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  applicationBuildPaths,
  createApplicationBuildContext
} from './application-build.mjs'
test('Make получает только собственный код, контракты и shared-замыкание', () => {
  assert.deepEqual(applicationBuildPaths('make'), [
    'apps/make',
    'packages/make-contracts',
    'packages/sessions-core',
    'packages/shared'
  ])
})
test('контекст Make не содержит ядро и веб-сборку', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vc-context-test-'))
  try {
    createApplicationBuildContext('make', dir, {
      version: '1.1.0',
      commit: 'a'.repeat(40)
    })
    assert.equal(existsSync(join(dir, 'apps/server')), false)
    assert.equal(existsSync(join(dir, 'apps/web')), false)
    const lock = JSON.parse(
      readFileSync(join(dir, 'package-lock.json'), 'utf8')
    )
    assert.equal(lock.packages['node_modules/react'], undefined)
    assert.equal(lock.packages['node_modules/better-sqlite3'], undefined)
    const docker = readFileSync(join(dir, 'Dockerfile'), 'utf8')
    assert.doesNotMatch(docker, /storybook|whisper|@voicechat\/web/)
    assert.match(docker, /VC_APPLICATION_VERSION=1.1.0/)
    assert.deepEqual(
      JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).workspaces,
      applicationBuildPaths('make')
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
test('неизвестное приложение и небезопасная версия отклоняются до сборки', () => {
  assert.throws(() => applicationBuildPaths('unknown'))
  assert.throws(() =>
    createApplicationBuildContext('make', '/unused', {
      version: '1.0.0\nRUN bad',
      commit: 'a'.repeat(40)
    })
  )
})
test('baseline ядра имеет собственный полный SHA и не подменяет готовность отдельного deploy', async () => {
  const { coreBaselineBuildArgs } = await import('./application-build.mjs')
  const metadata = {
    applicationId: 'core',
    version: '1.4.0',
    apiVersion: '1.0.0',
    dataVersion: '1.0.0',
    commit: 'b'.repeat(40)
  }
  const args = coreBaselineBuildArgs(metadata)
  assert.ok(args.includes('VC_APPLICATION_COMMIT=' + metadata.commit))
  assert.ok(
    args.includes('VC_APPLICATION_METADATA=' + JSON.stringify(metadata))
  )
  assert.throws(() =>
    coreBaselineBuildArgs({ ...metadata, applicationId: 'make' })
  )
  const { APPLICATION_CATALOG } = await import(
    '../packages/shared/src/applicationCatalog.ts'
  )
  assert.equal(
    APPLICATION_CATALOG.find((app) => app.id === 'core').isolation.deploy,
    false
  )
})

test('Reader API собираются без ядра и реализации Chromium', () => {
  for (const id of ['web-reader','playwright-reader']) {
    const paths = applicationBuildPaths(id)
    assert.ok(paths.includes('packages/browser-contracts'))
    for (const forbidden of ['apps/server','apps/browser-runner','apps/web','packages/ui']) assert.ok(!paths.includes(forbidden), `${id}: ${forbidden}`)
    assert.equal(paths.includes('apps/web-recorder'), id === 'web-reader')
    if (id === 'web-reader') assert.ok(!paths.includes('apps/playwright-reader'))
  }
})
