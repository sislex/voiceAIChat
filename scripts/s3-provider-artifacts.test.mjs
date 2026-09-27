import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { archiveFiles } from './shared-chat-artifacts.mjs'

const root = new URL('..', import.meta.url).pathname
const readJson = path => JSON.parse(readFileSync(join(root, path)))
const manifest = readJson('deploy/s3-provider-artifacts.json')
const s4 = readJson('deploy/s4-report-provider-artifacts.json')
const s4Identity = readJson('deploy/s4-identity-provider-artifact.json')
const superseded = new Set([...s4.providers, ...s4Identity.providers].map(row => row.name))
const inventory = readJson('vendor/owner-artifacts.json')
const tools = readJson('deploy/tools.lock.json').tools
const lock = readJson('package-lock.json')
const packageFiles = ['package.json', 'apps/server/package.json', 'packages/shared/package.json']

test('S3 provider pins have verified source, bytes and consumer lock entries', async () => {
  assert.equal(manifest.runId, 'shared-chat-v1')
  assert.equal(manifest.stage, 3)
  assert.deepEqual(new Set(manifest.providers.map(row => row.name)).size, 4)
  for (const row of manifest.providers) {
    assert.match(row.asset, /^[\w.-]+\.tgz$/)
    assert.match(row.commit, /^[a-f0-9]{40}$/)
    const bytes = readFileSync(join(root, 'vendor', row.asset))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256)
    assert.equal('sha512-' + createHash('sha512').update(bytes).digest('base64'), row.integrity)
    const files = await archiveFiles(bytes)
    const pkg = JSON.parse(files.get('package.json'))
    const source = JSON.parse(files.get('release-source.json'))
    assert.equal(pkg.name, row.name)
    assert.equal(pkg.version, row.version)
    assert.equal(source.repository, row.repository)
    assert.equal(source.commit, row.commit)
    assert.equal(source.version, row.version)
    if (!superseded.has(row.name)) {
      const pinned = inventory.packages.find(item => item.name === row.name)
      assert.equal(pinned?.asset, row.asset)
      assert.equal(pinned?.sha256, row.sha256)
      assert.equal(pinned?.commit, row.commit)
      const installed = lock.packages['node_modules/' + row.name]
      assert.equal(installed?.resolved, 'file:vendor/' + row.asset)
      assert.equal(installed?.integrity, row.integrity)
      assert.equal(installed?.version, row.version)
      assert(packageFiles.some(file => Object.values(readJson(file).dependencies ?? {}).concat(Object.values(readJson(file).devDependencies ?? {})).includes('file:' + (file === 'package.json' ? 'vendor/' : '../../vendor/') + row.asset)))
    }
  }
  for (const [tool, name] of [['identity', '@sislexa/identity'], ['billing', '@sislexa/billing'], ['llm-runner', '@sislex/llm-runner']]) {
    const row = manifest.providers.find(item => item.name === name)
    if (!superseded.has(name)) {
      assert.equal(tools[tool].commit, row.commit)
      assert.equal(tools[tool].version, row.version)
    }
  }
})

test('S4 report providers replace only Billing and Analytics with verified current pins', async () => {
  assert.equal(s4.runId, 'shared-chat-v1')
  assert.equal(s4.stage, 4)
  assert.deepEqual(s4.providers.map(row => row.name).sort(), ['@sislexa/analytics', '@sislexa/billing'])
  for (const row of s4.providers) {
    const bytes = readFileSync(join(root, 'vendor', row.asset))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256)
    assert.equal('sha512-' + createHash('sha512').update(bytes).digest('base64'), row.integrity)
    const files = await archiveFiles(bytes)
    const pkg = JSON.parse(files.get('package.json'))
    const source = JSON.parse(files.get('release-source.json'))
    assert.equal(pkg.name, row.name)
    assert.equal(pkg.version, row.version)
    assert.equal(source.commit, row.commit)
    assert.equal(source.repository, row.repository)
    const pinned = inventory.packages.find(item => item.name === row.name)
    assert.equal(pinned?.asset, row.asset)
    assert.equal(pinned?.sha256, row.sha256)
    assert.equal(pinned?.commit, row.commit)
    const installed = lock.packages['node_modules/' + row.name]
    assert.equal(installed?.resolved, 'file:vendor/' + row.asset)
    assert.equal(installed?.integrity, row.integrity)
    assert.equal(installed?.version, row.version)
    assert(packageFiles.some(file => Object.values(readJson(file).dependencies ?? {}).concat(Object.values(readJson(file).devDependencies ?? {})).includes('file:' + (file === 'package.json' ? 'vendor/' : '../../vendor/') + row.asset)))
    assert.equal(tools[row.name.split('/')[1]].commit, row.commit)
  }
  const dependencies = readJson('apps/server/component-contract.json').dependencies
  assert.equal(dependencies.find(row => row.applicationId === 'billing').minApiVersion, '1.2.0')
  assert.equal(dependencies.find(row => row.applicationId === 'analytics').minApiVersion, '1.2.0')
})

test('S4 Identity public-client provider has verified source and current consumer pins', async () => {
  assert.equal(s4Identity.runId, 'shared-chat-v1')
  assert.equal(s4Identity.stage, 4)
  assert.deepEqual(s4Identity.providers.map(row => row.name), ['@sislexa/identity'])
  const row = s4Identity.providers[0]
  const bytes = readFileSync(join(root, 'vendor', row.asset))
  assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256)
  assert.equal('sha512-' + createHash('sha512').update(bytes).digest('base64'), row.integrity)
  const files = await archiveFiles(bytes)
  const pkg = JSON.parse(files.get('package.json'))
  const source = JSON.parse(files.get('release-source.json'))
  assert.equal(pkg.name, row.name)
  assert.equal(pkg.version, row.version)
  assert.equal(source.commit, row.commit)
  assert.equal(source.repository, row.repository)
  assert.equal(files.has('packages/client/src/publicClient.ts'), true)
  assert.equal(files.has('packages/contracts/src/publicClient.ts'), true)
  const pinned = inventory.packages.find(item => item.name === row.name)
  assert.equal(pinned?.asset, row.asset)
  assert.equal(pinned?.sha256, row.sha256)
  assert.equal(pinned?.commit, row.commit)
  const installed = lock.packages['node_modules/' + row.name]
  assert.equal(installed?.resolved, 'file:vendor/' + row.asset)
  assert.equal(installed?.integrity, row.integrity)
  assert.equal(installed?.version, row.version)
  assert.equal(tools.identity.commit, row.commit)
})
