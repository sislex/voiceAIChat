import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  applicationBuildPaths,
  copyDependencyArchives,
  createApplicationBuildContext
} from './application-build.mjs'


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



test('archive closure copies only pinned regular vendor archives', () => {
  const repo = mkdtempSync(join(tmpdir(), 'vc-archive-test-'))
  const output = mkdtempSync(join(tmpdir(), 'vc-archive-output-'))
  try {
    mkdirSync(join(repo, 'vendor'))
    writeFileSync(join(repo, 'vendor/tool-1.0.0.tgz'), 'archive')
    const lock = path => ({ packages: { 'node_modules/tool': { resolved: 'file:' + path } } })
    copyDependencyArchives(lock('vendor/tool-1.0.0.tgz'), repo, output)
    assert.equal(readFileSync(join(output, 'vendor/tool-1.0.0.tgz'), 'utf8'), 'archive')
    assert.throws(() => copyDependencyArchives(lock('../secret.tgz'), repo, output))
    symlinkSync(join(repo, 'vendor/tool-1.0.0.tgz'), join(repo, 'vendor/link.tgz'))
    assert.throws(() => copyDependencyArchives(lock('vendor/link.tgz'), repo, output))
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(output, { recursive: true, force: true })
  }
})







// Billing can be distributed without copying Identity's implementation or the UI.


test('external library build requests identify the independent owner', () => {
  for (const id of ['platform-sdk', 'ui-kit', 'ui-foundation']) {
    assert.throws(() => applicationBuildPaths(id), /is owned by https:\/\/github.com\/sislex\//)
  }
})


test('Core build closure contains no extracted application workspace', () => {
  const paths = applicationBuildPaths('core')
  assert.ok(paths.includes('apps/server'))
  for (const path of ['apps/llm-runner','apps/make','apps/identity','apps/image-studio','apps/web-reader','apps/web-recorder','apps/playwright-reader','apps/stt-runner','apps/tts-runner','apps/billing','packages/make-contracts','packages/browser-contracts','packages/ui-kit','packages/ui-foundation','packages/platform-sdk']) {
    assert.equal(paths.includes(path), false, path)
    assert.equal(existsSync(path), false, path)
  }
})
test('external applications cannot be rebuilt from a Core checkout', () => {
  for (const id of ['llm-runner','make','image-studio','web-reader','playwright-reader','identity','billing','stt-runner','tts-runner','make-ui','image-studio-ui','web-reader-ui','playwright-reader-ui']) {
    assert.throws(() => applicationBuildPaths(id), /is owned by https:\/\/github.com\/sislex\//)
  }
})
