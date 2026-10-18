import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { VENDOR_URL, ensureVendorArchive, fetchVendorArchives, ghVendorPublisher, isVendorRef, pinnedArchives, publishVendorArchives, trackedVendorArchives, underTestRunner, vendorAssetFromRef, vendorRef } from './vendor-store.mjs'

const asset = 'sislexa-demo-1.0.0-abcdef012345.tgz'
const bytes = Buffer.from('demo archive bytes')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64')

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'vendor-store-'))
  mkdirSync(join(root, 'vendor'))
  process.env.SISLEXA_VENDOR_CACHE = join(root, 'cache')
  return root
}

async function server(handler) {
  const srv = createServer(handler)
  await new Promise(done => srv.listen(0, '127.0.0.1', done))
  return { srv, base: `http://127.0.0.1:${srv.address().port}/` }
}

test('references accept the release URL and legacy file: specs', () => {
  assert.equal(vendorRef(asset), VENDOR_URL + asset)
  assert.equal(vendorAssetFromRef(VENDOR_URL + asset), asset)
  assert.equal(vendorAssetFromRef('file:vendor/' + asset), asset)
  assert.equal(vendorAssetFromRef('file:../../vendor/' + asset), asset)
  assert.equal(vendorAssetFromRef('https://example.test/' + asset), null)
  assert.equal(vendorAssetFromRef('^1.0.0'), null)
  assert.ok(isVendorRef(VENDOR_URL + asset, asset))
  assert.throws(() => vendorRef('../escape.tgz'))
})

test('downloads with retry, verifies, caches and reuses the cache', async () => {
  const root = fixture()
  let calls = 0
  const { srv, base } = await server((req, res) => {
    calls += 1
    if (calls === 1) { res.writeHead(502); res.end(); return }
    res.end(bytes)
  })
  try {
    const got = await ensureVendorArchive(root, asset, { sha256, integrity }, { baseUrl: base, attempts: 3 })
    assert.deepEqual(got, bytes)
    assert.equal(calls, 2)
    assert.ok(existsSync(join(process.env.SISLEXA_VENDOR_CACHE, asset)))
    rmSync(join(root, 'vendor', asset))
    await ensureVendorArchive(root, asset, { sha256 }, { baseUrl: base })
    assert.equal(calls, 2, 'second fetch must come from the cache')
  } finally { srv.close(); rmSync(root, { recursive: true, force: true }) }
})

test('rejects bytes that do not match the pinned checksum', async () => {
  const root = fixture()
  const { srv, base } = await server((req, res) => res.end('tampered'))
  try {
    await assert.rejects(ensureVendorArchive(root, asset, { sha256 }, { baseUrl: base, attempts: 1 }), /does not match/)
    assert.ok(!existsSync(join(root, 'vendor', asset)))
    writeFileSync(join(root, 'vendor', asset), 'stale')
    await assert.rejects(ensureVendorArchive(root, asset, { sha256 }, { baseUrl: base }), /differs from its pinned checksum/)
    await assert.rejects(ensureVendorArchive(root, asset, {}, { baseUrl: base }), /No checksum/)
  } finally { srv.close(); rmSync(root, { recursive: true, force: true }) }
})

test('pinned archives come from the lockfile and owner manifests', async () => {
  const root = fixture()
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/@sislexa/demo': { resolved: VENDOR_URL + asset, integrity }, 'node_modules/x': { resolved: 'https://registry.npmjs.org/x/-/x-1.0.0.tgz' } } }))
  writeFileSync(join(root, 'vendor', 'owner-artifacts.json'), JSON.stringify({ packages: [{ name: '@sislexa/demo', asset, sha256 }] }))
  assert.deepEqual([...pinnedArchives(root)], [[asset, { integrity, sha256 }]])
  const { srv, base } = await server((req, res) => res.end(bytes))
  try {
    assert.deepEqual(await fetchVendorArchives(root, { baseUrl: base }), [asset])
    assert.deepEqual(readFileSync(join(root, 'vendor', asset)), bytes)
  } finally { srv.close(); rmSync(root, { recursive: true, force: true }) }
})

test('publish uploads only archives missing from the release, through the injected publisher', () => {
  const root = fixture()
  writeFileSync(join(root, 'vendor', asset), bytes)
  writeFileSync(join(root, 'vendor', 'kept-1.0.0.tgz'), bytes)
  const uploads = []
  const fake = { assets: () => new Set(['kept-1.0.0.tgz']), upload: file => uploads.push(file) }
  assert.deepEqual(publishVendorArchives(root, fake), [asset])
  assert.deepEqual(uploads, [join(root, 'vendor', asset)])
  assert.throws(() => publishVendorArchives(root), /explicit publisher/)
  rmSync(root, { recursive: true, force: true })
})

test('the real GitHub publisher refuses to run under a test runner and never execs gh', () => {
  assert.ok(underTestRunner(), 'node:test sets NODE_TEST_CONTEXT for this file')
  const calls = []
  const exec = (...args) => { calls.push(args); throw Error('gh must not be called from tests') }
  const real = ghVendorPublisher({ exec })
  assert.throws(() => real.assets(), /Refusing to touch the public vendor release/)
  assert.throws(() => real.upload('/tmp/x.tgz'), /Refusing to touch the public vendor release/)
  assert.deepEqual(calls, [])
  for (const marker of [{ VITEST: 'true' }, { NODE_ENV: 'test' }, { JEST_WORKER_ID: '1' }]) assert.ok(underTestRunner(marker))
  assert.equal(underTestRunner({}), false)
})

test('archives are never tracked in git, including this repository', () => {
  const root = fixture()
  execFileSync('git', ['init', '-q'], { cwd: root })
  writeFileSync(join(root, 'vendor', asset), bytes)
  assert.deepEqual(trackedVendorArchives(root), [])
  execFileSync('git', ['add', '-f', 'vendor/' + asset], { cwd: root })
  assert.deepEqual(trackedVendorArchives(root), ['vendor/' + asset])
  rmSync(root, { recursive: true, force: true })
  assert.deepEqual(trackedVendorArchives(resolve(import.meta.dirname, '..')), [])
})
