import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { analyzeVendorArchives, assertVendorArchivesUsed, removeUnusedVendorArchives } from './vendor-archives.mjs'
import { pinSharedChat } from './pin-shared-chat.mjs'

const root = resolve(import.meta.dirname, '..')
function put(root, file, value) {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
}
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'vendor-archives-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  put(dir, 'package.json', {})
  put(dir, 'vendor/old.tgz', 'old')
  return dir
}

// @testCase TC-01
test('repository archives all have consumers and the check is in test:tooling', () => {
  const report = assertVendorArchivesUsed(root)
  assert.ok(report.archives.length)
  assert.ok(report.archives.every(row => row.sources.length))
  assert.match(JSON.parse(readFileSync(join(root, 'package.json'))).scripts['test:tooling'], /scripts\/vendor-archives\.test\.mjs/)
})

// @testCase TC-02
test('reports every unused archive, including nested and untracked archives', t => {
  const dir = fixture(t)
  put(dir, 'vendor/nested/other.tgz', 'other')
  execFileSync('git', ['init', '-q'], { cwd: dir })
  assert.throws(() => assertVendorArchivesUsed(dir), /Unused vendor archives:[\s\S]*other\.tgz[\s\S]*old\.tgz/)
  assert.deepEqual(analyzeVendorArchives(dir).unused.map(row => row.file), ['vendor/nested/other.tgz', 'vendor/old.tgz'])
})

const sources = [
  ['package.json', { dependencies: { fixture: 'file:vendor/old.tgz' } }],
  ['package-lock.json', { packages: { 'node_modules/fixture': { resolved: 'file:vendor/old.tgz' } } }],
  ['examples/deep/package.json', { dependencies: { fixture: 'file:../../vendor/old.tgz' } }],
  ['examples/deep/package-lock.json', { packages: { 'node_modules/fixture': { resolved: 'file:../../vendor/old.tgz' } } }],
  ['vendor/owner-artifacts.json', { packages: [{ filename: 'publication.tgz', asset: 'old.tgz' }] }],
  ['dependency-snapshots.json', { packages: [{ filename: 'publication.tgz', asset: 'old.tgz' }] }],
  ['vendor/ui-libraries.json', { packages: [{ asset: 'old.tgz' }] }],
  ['scripts/read.mjs', "readFileSync(join(root, 'vendor', 'old.tgz'))"],
]
for (const [file, value] of sources) {
  // @testCase TC-02
  test('a sole reference from ' + file + ' protects the archive', t => {
    const dir = fixture(t)
    put(dir, file, value)
    assert.deepEqual(assertVendorArchivesUsed(dir).unused, [])
    assert.deepEqual(removeUnusedVendorArchives(dir, ['vendor/old.tgz']), [])
    assert.ok(existsSync(join(dir, 'vendor/old.tgz')))
  })
}

// @testCase TC-02
test('asset has consumer semantics; filename alone does not pin a local archive', t => {
  const dir = fixture(t)
  put(dir, 'vendor/current.tgz', 'current')
  put(dir, 'vendor/owner-artifacts.json', { packages: [{ filename: 'old.tgz', asset: 'current.tgz' }] })
  assert.deepEqual(analyzeVendorArchives(dir).unused.map(row => row.file), ['vendor/old.tgz'])
})

// @testCase TC-02
test('malformed and unreadable reference sources stop cleanup before any deletion', t => {
  for (const file of ['package-lock.json', 'nested/package.json', 'vendor/ui-libraries.json', 'dependency-snapshots.json']) {
    const dir = fixture(t)
    put(dir, file, '{broken')
    assert.throws(() => removeUnusedVendorArchives(dir, ['vendor/old.tgz']), SyntaxError)
    assert.ok(existsSync(join(dir, 'vendor/old.tgz')))
  }
  const dir = fixture(t)
  mkdirSync(join(dir, 'scripts'))
  symlinkSync(join(dir, 'missing'), join(dir, 'scripts', 'reader.mjs'))
  assert.throws(() => removeUnusedVendorArchives(dir, ['vendor/old.tgz']), /symlink|ENOENT/)
  assert.ok(existsSync(join(dir, 'vendor/old.tgz')))
})

// @testCase TC-02
test('a missing tracked source or symlink cannot turn incomplete analysis into deletion', t => {
  const dir = fixture(t)
  put(dir, 'scripts/consumer.mjs', "open('old.tgz')")
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['add', '.'], { cwd: dir })
  rmSync(join(dir, 'scripts/consumer.mjs'))
  assert.throws(() => removeUnusedVendorArchives(dir, ['vendor/old.tgz']), /ENOENT/)
  symlinkSync(join(dir, 'missing'), join(dir, 'scripts/consumer.mjs'))
  assert.throws(() => removeUnusedVendorArchives(dir, ['vendor/old.tgz']), /symlink/)
  assert.ok(existsSync(join(dir, 'vendor/old.tgz')))
})

// @testCase TC-02
test('relative references resolve from each manifest, not by basename', t => {
  const dir = fixture(t)
  put(dir, 'examples/deep/package.json', { dependencies: { fixture: 'file:vendor/old.tgz' } })
  assert.deepEqual(analyzeVendorArchives(dir).unused.map(row => row.file), ['vendor/old.tgz'])
})

// @testCase TC-02
test('a script path does not protect another archive with the same basename', t => {
  const dir = fixture(t)
  put(dir, 'vendor/nested/old.tgz', 'nested')
  put(dir, 'scripts/reader.mjs', "readFileSync('vendor/nested/old.tgz')")
  assert.deepEqual(analyzeVendorArchives(dir).unused.map(row => row.file), ['vendor/old.tgz'])
})

// @testCase TC-03
test('cleanup keeps the last consumer and never sweeps a newly added archive', t => {
  const dir = fixture(t)
  put(dir, 'package.json', { dependencies: { fixture: 'file:vendor/old.tgz' } })
  put(dir, 'nested/package-lock.json', { resolved: 'file:../vendor/old.tgz' })
  put(dir, 'vendor/new.tgz', 'new')
  put(dir, 'package.json', { dependencies: { fixture: 'file:vendor/new.tgz' } })
  assert.deepEqual(removeUnusedVendorArchives(dir, ['vendor/old.tgz']), [])
  put(dir, 'nested/package-lock.json', {})
  assert.deepEqual(removeUnusedVendorArchives(dir, ['vendor/old.tgz']).map(row => row.file), ['vendor/old.tgz'])
  assert.ok(existsSync(join(dir, 'vendor/new.tgz')))
})

function handoff(t, version = '2.0.0', commit = 'b'.repeat(40)) {
  const dir = mkdtempSync(join(tmpdir(), 'vendor-handoff-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  put(dir, 'package/package.json', { name: '@fixture/pkg', version })
  put(dir, 'package/release-source.json', { repository: 'fixture', version, commit })
  const bytes = execFileSync('tar', ['-czf', '-', '-C', dir, 'package/package.json', 'package/release-source.json'])
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  put(dir, 'fixture.tgz', bytes)
  put(dir, 'source.json', { repository: 'fixture', commit, copies: [{ name: 'fixture.tgz', sha256 }] })
  return { dir, asset: 'fixture-' + sha256.slice(0, 12) + '.tgz' }
}
function pinFixture(t) {
  const dir = fixture(t)
  for (const file of ['package.json', 'apps/server/package.json', 'packages/shared/package.json', 'packages/component-runtime/package.json'])
    put(dir, file, { dependencies: { '@fixture/pkg': 'file:' + (file === 'package.json' ? '' : '../../') + 'vendor/old.tgz' } })
  put(dir, 'package-lock.json', { packages: { '': {}, 'apps/server': {}, 'packages/shared': {}, 'packages/component-runtime': {}, 'node_modules/@fixture/pkg': { resolved: 'file:vendor/old.tgz' } } })
  for (const file of ['vendor/owner-artifacts.json', 'dependency-snapshots.json'])
    put(dir, file, { packages: [{ name: '@fixture/pkg', asset: 'old.tgz' }] })
  return dir
}

// @testCase TC-03
test('real handoff pin removes replaced bytes only after the last reference and is idempotent', async t => {
  for (const shared of [false, true]) {
    const dir = pinFixture(t)
    const next = handoff(t)
    if (shared) put(dir, 'other/package-lock.json', { resolved: 'file:../vendor/old.tgz' })
    await pinSharedChat(next.dir, dir)
    assert.equal(existsSync(join(dir, 'vendor/old.tgz')), shared)
    assert.ok(existsSync(join(dir, 'vendor', next.asset)))
    const lock = readFileSync(join(dir, 'package-lock.json'), 'utf8')
    assert.match(lock, new RegExp(next.asset))
    await pinSharedChat(next.dir, dir)
    assert.equal(readFileSync(join(dir, 'package-lock.json'), 'utf8'), lock)
    if (shared) {
      put(dir, 'other/package-lock.json', {})
      await pinSharedChat(next.dir, dir)
      assert.equal(existsSync(join(dir, 'vendor/old.tgz')), false)
    }
  }
})

// @testCase TC-03
test('bad handoff digest or provenance leaves the old archive and references intact', async t => {
  for (const bad of ['digest', 'provenance']) {
    const dir = pinFixture(t)
    const next = handoff(t, '2.0.0', bad === 'provenance' ? 'invalid' : 'b'.repeat(40))
    if (bad === 'digest') put(next.dir, 'fixture.tgz', 'corrupt')
    const before = readFileSync(join(dir, 'package.json'), 'utf8')
    await assert.rejects(pinSharedChat(next.dir, dir), /digest mismatch|Invalid provenance/)
    assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), before)
    assert.ok(existsSync(join(dir, 'vendor/old.tgz')))
    assert.equal(existsSync(join(dir, 'vendor', next.asset)), false)
  }
})
