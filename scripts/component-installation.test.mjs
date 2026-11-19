import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { initializeComponents } from './component-installation.mjs'
import { createComponentRuntime } from '@sislexa/component-runtime'
const require = createRequire(import.meta.url)

test('installation issues distinct provider-owned tokens and refuses an existing installation', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'sislexa-install-')), directory = join(parent, 'components')
  try {
    const result = await initializeComponents({ directory, environmentId: 'integration', origins: { core: 'http://127.0.0.1:8799' } })
    assert.equal(result.issued.length, 18)
    assert.equal(new Set(result.issued.map(p => p.tokenId)).size, 18)
    const configFile = join(directory, 'make/config.json')
    const config = JSON.parse(readFileSync(configFile, 'utf8'))
    assert.equal(config.dependencies[0].url, 'http://127.0.0.1:8799')
    const runtime = await createComponentRuntime({ configFile, contractFile: require.resolve('@sislexa/make/component-contract'), metadata: { applicationId: 'make', version: null, apiVersion: null, commit: null, dataVersion: null } })
    try {
      const file = join(directory, 'core/outgoing/make.token'), token = readFileSync(file, 'utf8').trim()
      assert.equal(statSync(file).mode & 0o777, 0o600)
      assert.equal(runtime.authorize('Bearer ' + token, 'make.service').ok, true)
      assert.equal(JSON.stringify(result).includes(token), false)
      const before = readFileSync(file, 'utf8')
      await assert.rejects(initializeComponents({ directory, environmentId: 'integration' }))
      assert.equal(readFileSync(file, 'utf8'), before)
    } finally { runtime.close() }
  } finally { rmSync(parent, { recursive: true, force: true }) }
})

test('a smaller installation keeps only grants and dependencies between the selected applications', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'sislexa-install-')), directory = join(parent, 'components')
  try {
    const result = await initializeComponents({ directory, environmentId: 'public', container: true, applications: ['core', 'identity', 'billing'] })
    assert.deepEqual(result.issued.map(p => p.consumerId + '<-' + p.providerId).sort(), ['billing<-identity', 'core<-billing', 'core<-identity', 'identity<-core'])
    const core = JSON.parse(readFileSync(join(directory, 'core/config.json'), 'utf8'))
    assert.deepEqual(core.dependencies.map(d => d.applicationId), ['identity', 'billing'])
    assert.deepEqual(core.grants.map(g => g.consumerId), ['identity'])
    assert.equal(core.registryDirectory, '/run/sislexa/provider')
    await assert.rejects(initializeComponents({ directory: join(parent, 'other'), environmentId: 'public', applications: ['core', 'storage'] }))
  } finally { rmSync(parent, { recursive: true, force: true }) }
})
