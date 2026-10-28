import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ComponentTokenRegistry } from '../packages/component-runtime/src/registry.ts'
import { rotateComponents } from './component-rotation.mjs'
import { initializeComponents } from './component-installation.mjs'

function fixture(ttl = 60) {
  const parent = mkdtempSync(join(tmpdir(), 'rotation-'))
  const directory = join(parent, 'installation')
  mkdirSync(directory, { mode: 0o700 })
  let time = Date.now()
  const dependency = { applicationId: 'identity', minVersion: '1.0.0', maxVersionExclusive: '2.0.0', minApiVersion: '1.0.0', maxApiVersionExclusive: '2.0.0', scopes: ['identity.verify'] }
  const contracts = {
    core: { schemaVersion: 1, applicationId: 'core', provides: [], legacyScopes: [], dependencies: [dependency] },
    identity: { schemaVersion: 1, applicationId: 'identity', provides: ['identity.verify'], legacyScopes: [], dependencies: [] }
  }
  const configs = {
    core: { schemaVersion: 1, environmentId: 'test', grants: [], legacyScopes: [], dependencies: [{ applicationId: 'identity', url: 'http://identity:8798', tokenFile: '/run/sislexa/outgoing/identity.token' }] },
    identity: { schemaVersion: 1, environmentId: 'test', registryDirectory: '/run/sislexa/provider', grants: [{ consumerId: 'core', scopes: ['identity.verify'], maxTtlSeconds: 2592000 }], legacyScopes: [], dependencies: [] }
  }
  for (const id of Object.keys(contracts)) {
    mkdirSync(join(directory, id), { mode: 0o700 })
    mkdirSync(join(directory, id, 'outgoing'), { mode: 0o700 })
    writeFileSync(join(directory, id, 'config.json'), JSON.stringify(configs[id]), { mode: 0o600 })
    writeFileSync(join(parent, id + '.json'), JSON.stringify(contracts[id]))
  }
  const registry = new ComponentTokenRegistry(contracts.identity, { ...configs.identity, registryDirectory: join(directory, 'identity/provider') }, () => time)
  const old = registry.issue('core', ['identity.verify'], ttl)
  const file = join(directory, 'core/outgoing/identity.token')
  writeFileSync(file, old.token + '\n', { mode: 0o600 })
  return { directory, file, registry, old, now: () => time, advance: ms => { time += ms },
    options: { directory, now: () => time, contractFile: id => join(parent, id + '.json') },
    close: () => { registry.close(); rmSync(parent, { recursive: true, force: true }) } }
}

test('renews every grant in the real installation, including Core and Billing to Identity', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'rotation-full-'))
  const directory = join(parent, 'components')
  try {
    const installation = await initializeComponents({ directory, environmentId: 'test', container: true })
    const now = () => Math.max(...installation.issued.map(p => p.expiresAt)) + 1
    const dry = await rotateComponents({ directory, now })
    assert.equal(dry.results.length, installation.issued.length)
    const applied = await rotateComponents({ directory, now, apply: true })
    assert.equal(applied.results.length, installation.issued.length)
    for (const consumerId of ['core', 'billing']) assert.ok(applied.results.some(r => r.providerId === 'identity' && r.consumerId === consumerId))
    assert.deepEqual((await rotateComponents({ directory, now })).results, [])
  } finally { rmSync(parent, { recursive: true, force: true }) }
})

test('failed replacement authorization leaves the old file and grant intact', async t => {
  const f = fixture()
  try {
    t.mock.method(ComponentTokenRegistry.prototype, 'authorize', () => ({ ok: false, status: 401 }))
    await assert.rejects(rotateComponents({ ...f.options, apply: true }), /authorization failed/)
    assert.equal(readFileSync(f.file, 'utf8').trim(), f.old.token)
    assert.ok(f.registry.installed(f.old.token))
    assert.equal(f.registry.list().length, 1)
    assert.equal(existsSync(join(f.directory, '.rotation-lock')), false)
  } finally { f.close() }
})

for (const expired of [false, true]) test('dry-run and atomic apply ' + (expired ? 'recover an expired grant' : 'renew a near-expiry grant'), async () => {
  const f = fixture()
  try {
    if (expired) f.advance(60001)
    const before = statSync(f.file)
    const dry = await rotateComponents(f.options)
    assert.equal(dry.apply, false)
    assert.equal(dry.results[0].action, 'would_rotate')
    assert.equal(readFileSync(f.file, 'utf8').trim(), f.old.token)
    assert.ok(f.registry.installed(f.old.token))
    const result = await rotateComponents({ ...f.options, apply: true })
    const replacement = readFileSync(f.file, 'utf8').trim()
    assert.notEqual(replacement, f.old.token)
    assert.equal(f.registry.authorize('Bearer ' + replacement, ['identity.verify']).ok, true)
    assert.equal(f.registry.installed(f.old.token), undefined)
    assert.equal(result.results[0].expiresAt, f.now() + 2592000000)
    assert.deepEqual([statSync(f.file).uid, statSync(f.file).gid, statSync(f.file).mode], [before.uid, before.gid, before.mode])
    assert.notEqual(statSync(f.file).ino, before.ino)
    assert.equal(JSON.stringify([dry, result]).includes(replacement), false)
    assert.equal(JSON.stringify([dry, result]).includes(f.old.token), false)
    assert.deepEqual((await rotateComponents({ ...f.options, apply: true })).results, [])
    assert.equal(existsSync(join(f.directory, '.rotation-lock')), false)
  } finally { f.close() }
})

test('never renews revoked credentials and releases the lock on failure', async () => {
  const f = fixture()
  try {
    f.registry.revoke(f.old.principal.tokenId)
    await assert.rejects(rotateComponents({ ...f.options, apply: true }), /does not match/)
    assert.equal(readFileSync(f.file, 'utf8').trim(), f.old.token)
    assert.equal(existsSync(join(f.directory, '.rotation-lock')), false)
  } finally { f.close() }
})

test('rejects concurrent rotation and invalid horizons', async () => {
  const f = fixture()
  try {
    for (const days of [0, -1, NaN, 366]) await assert.rejects(rotateComponents({ ...f.options, days }))
    mkdirSync(join(f.directory, '.rotation-lock'))
    await assert.rejects(rotateComponents({ ...f.options, apply: true }))
    assert.equal(readFileSync(f.file, 'utf8').trim(), f.old.token)
  } finally { f.close() }
})
