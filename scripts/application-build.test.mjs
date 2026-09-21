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
test('Make получает только собственный код, контракты и shared-замыкание', () => {
  assert.deepEqual(applicationBuildPaths('make'), [
    'apps/make',
    'packages/component-runtime',
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


test('extracted application workspaces contain only import/export adapters',()=>{
  const roots=['apps/billing','packages/platform-sdk','apps/make','apps/playwright-reader','apps/web-reader','apps/web-recorder','apps/image-studio','apps/stt-runner','apps/tts-runner','apps/identity','packages/make-app','packages/image-studio-app','packages/playwright-reader-app','packages/web-reader-app','packages/voice-browser','packages/profile-app','packages/sessions-app','packages/sessions-core','packages/identity-login','packages/identity-account','packages/identity-client','packages/identity-contracts','packages/storage-sql']
  const walk=directory=>existsSync(directory)?readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(join(directory,entry.name)):[join(directory,entry.name)]):[]
  for(const root of roots){
    assert.ok(JSON.parse(readFileSync(join(root,'package.json'),'utf8')).sislexaExternal,root)
    for(const file of walk(join(root,'src'))){
      if(!/\.(?:ts|tsx|css)$/.test(file))continue
      const source=readFileSync(file,'utf8').trim()
      assert.match(source,/^(?:(?:export (?:\*|\{ default \}) from ["']@sislexa\/[^"']+["']|import ["']@sislexa\/[^"']+["']|@import ["']@sislexa\/[^"']+["'];)[ \t]*;?(?:\r?\n|$))+$/,file)
    }
  }
})


test('Identity release context includes its own native build tools and typecheck dependencies', () => {
  const output = mkdtempSync(join(tmpdir(), 'vc-identity-context-'))
  try {
    createApplicationBuildContext('identity', output, {version:'1.0.0', commit:'a'.repeat(40), development:true})
    const lock = JSON.parse(readFileSync(join(output, 'package-lock.json'), 'utf8'))
    assert.ok(lock.packages['node_modules/@testing-library/jest-dom'])
    assert.ok(lock.packages['node_modules/@types/nodemailer'])
    assert.match(readFileSync(join(output, 'Dockerfile'), 'utf8'), /python3 make g\+\+/)
    assert.equal(existsSync(join(output, 'apps/server')), false)
    assert.equal(existsSync(join(output, 'packages/ui')), false)
  } finally { rmSync(output, {recursive:true, force:true}) }
})

// Billing can be distributed without copying Identity's implementation or the UI.
test('Billing release context contains the ledger and SDK without Core or Identity source', () => {
  const output = mkdtempSync(join(tmpdir(), 'vc-billing-context-'))
  try {
    createApplicationBuildContext('billing', output, { version: '1.0.0', commit: 'a'.repeat(40), development: true })
    const lock = JSON.parse(readFileSync(join(output, 'package-lock.json'), 'utf8'))
    assert.ok(lock.packages['node_modules/@sislexa/billing'])
    assert.ok(lock.packages['node_modules/@sislexa/sdk'])
    for (const path of ['apps/server', 'apps/identity', 'packages/ui']) assert.equal(existsSync(join(output, path)), false)
    assert.equal(lock.packages['node_modules/@sislexa/identity'], undefined)
  } finally { rmSync(output, { recursive: true, force: true }) }
})
