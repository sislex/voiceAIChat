import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { archiveFiles } from './shared-chat-artifacts.mjs'

const root = new URL('..', import.meta.url).pathname
const readJson = path => JSON.parse(readFileSync(join(root, path)))
const manifest = readJson('deploy/s3-provider-artifacts.json')
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
  for (const [tool, name] of [['identity', '@sislexa/identity'], ['billing', '@sislexa/billing'], ['llm-runner', '@sislex/llm-runner']]) {
    const row = manifest.providers.find(item => item.name === name)
    assert.equal(tools[tool].commit, row.commit)
    assert.equal(tools[tool].version, row.version)
  }
})
