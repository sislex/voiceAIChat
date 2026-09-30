import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyComposition, currentComposition } from './release-composition.mjs'
import { archiveDigests, manifestFromCore, publishGithubRelease } from './owner-release-publish.mjs'
import { releasePackageAsset } from '../packages/shared/src/releaseComposition.ts'

const REPO = 'https://github.com/sislex/make'
const OLD = 'a'.repeat(40), NEW = 'b'.repeat(40)
const write = (path, value) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n') }
const read = (path) => JSON.parse(readFileSync(path, 'utf8'))

/** Настоящий npm-архив: package/package.json и release-source.json. */
function archive(name, version, commit) {
  const dir = mkdtempSync(join(tmpdir(), 'rc-pack-'))
  write(join(dir, 'package', 'package.json'), { name, version })
  if (commit) write(join(dir, 'package', 'release-source.json'), { schemaVersion: 1, repository: REPO, commit, version })
  return execFileSync('tar', ['-czf', '-', '-C', dir, 'package'])
}

function row(name, version, commit, bytes) {
  const d = archiveDigests(bytes)
  return { name, version, filename: `${name.replace('@', '').replace('/', '-')}-${version}.tgz`, asset: releasePackageAsset(name, version, d.sha256), sha256: d.sha256, integrity: d.integrity, repository: REPO, commit, provenance: { schemaVersion: 1, repository: REPO, version, commit } }
}

/** Core с закреплённым Make 1.0.0: все поверхности, которые переписывает состав релиза. */
function fixture() {
  const core = mkdtempSync(join(tmpdir(), 'rc-core-'))
  const bytes = archive('@sislexa/make', '1.0.0', OLD)
  const pinned = row('@sislexa/make', '1.0.0', OLD, bytes)
  write(join(core, 'vendor', pinned.asset), '')
  writeFileSync(join(core, 'vendor', pinned.asset), bytes)
  write(join(core, 'vendor/owner-artifacts.json'), { schemaVersion: 1, packages: [pinned] })
  write(join(core, 'dependency-snapshots.json'), { schemaVersion: 1, purpose: 'x', handoff: 'y', packages: [pinned] })
  write(join(core, 'package.json'), { name: 'core', dependencies: { '@sislexa/make': `file:vendor/${pinned.asset}` } })
  write(join(core, 'apps/server/package.json'), { name: 'server', dependencies: { '@sislexa/make': `file:../../vendor/${pinned.asset}` } })
  write(join(core, 'package-lock.json'), { lockfileVersion: 3, packages: {
    '': { dependencies: { '@sislexa/make': `file:vendor/${pinned.asset}` } },
    'node_modules/@sislexa/make': { version: '1.0.0', resolved: `file:vendor/${pinned.asset}`, integrity: pinned.integrity }
  } })
  write(join(core, 'deploy/tools.lock.json'), { schemaVersion: 1, tools: { make: { package: '@sislexa/make', repository: REPO, version: '1.0.0', commit: OLD } } })
  write(join(core, 'docker-compose.yml'), `services:\n  make:\n    image: \${SISLEXA_MAKE_IMAGE:-ghcr.io/sislex/make-api:${OLD}}\n`)
  return { core, pinned }
}

/** Опубликованный выпуск Make 1.1.0 в каталоге, как его скачивает центр релизов. */
function published(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rc-rel-'))
  const bytes = overrides.bytes ?? archive('@sislexa/make', '1.1.0', overrides.inside ?? NEW)
  const pkg = { name: '@sislexa/make', version: '1.1.0', ...(() => { const d = archiveDigests(bytes); return { asset: releasePackageAsset('@sislexa/make', '1.1.0', d.sha256), ...d } })() }
  const manifest = { schemaVersion: 1, repository: REPO, version: '1.1.0', commit: NEW, packages: [pkg], images: [{ name: 'ghcr.io/sislex/make-api' }], tools: ['make'], ...overrides.manifest }
  write(join(dir, 'make', 'sislexa-release.json'), manifest)
  writeFileSync(join(dir, 'make', pkg.asset), overrides.tampered ?? bytes)
  return { dir, pkg, manifest }
}

test('apply rewrites every Core pin surface and drops the replaced archive', () => {
  const { core, pinned } = fixture()
  const { dir, pkg } = published()
  const [result] = applyComposition(core, dir)
  assert.deepEqual(result, { repository: REPO, version: '1.1.0', commit: NEW, packages: [{ package: '@sislexa/make', from: '1.0.0', to: '1.1.0' }], tools: ['make'], images: ['ghcr.io/sislex/make-api'] })
  for (const file of ['vendor/owner-artifacts.json', 'dependency-snapshots.json']) {
    const [entry] = read(join(core, file)).packages
    assert.deepEqual({ version: entry.version, asset: entry.asset, sha256: entry.sha256, integrity: entry.integrity, commit: entry.commit, filename: entry.filename, provenance: entry.provenance },
      { version: '1.1.0', asset: pkg.asset, sha256: pkg.sha256, integrity: pkg.integrity, commit: NEW, filename: 'sislexa-make-1.1.0.tgz', provenance: { schemaVersion: 1, repository: REPO, version: '1.1.0', commit: NEW } })
  }
  assert.equal(read(join(core, 'package.json')).dependencies['@sislexa/make'], `file:vendor/${pkg.asset}`)
  assert.equal(read(join(core, 'apps/server/package.json')).dependencies['@sislexa/make'], `file:../../vendor/${pkg.asset}`)
  const lock = read(join(core, 'package-lock.json')).packages
  assert.deepEqual(lock['node_modules/@sislexa/make'], { version: '1.1.0', resolved: `file:vendor/${pkg.asset}`, integrity: pkg.integrity })
  assert.equal(lock[''].dependencies['@sislexa/make'], `file:vendor/${pkg.asset}`)
  assert.deepEqual(read(join(core, 'deploy/tools.lock.json')).tools.make, { package: '@sislexa/make', repository: REPO, version: '1.1.0', commit: NEW })
  assert.match(readFileSync(join(core, 'docker-compose.yml'), 'utf8'), new RegExp(`make-api:${NEW}`))
  assert.ok(existsSync(join(core, 'vendor', pkg.asset)))
  assert.equal(existsSync(join(core, 'vendor', pinned.asset)), false)
  assert.deepEqual(currentComposition(core).map(({ repository, version, commit }) => ({ repository, version, commit })), [{ repository: REPO, version: '1.1.0', commit: NEW }])
})

test('apply refuses bytes, commits and targets that do not match the published release', () => {
  const cases = [
    [published({ tampered: Buffer.from('not the archive') }), /байты не совпадают/],
    [published({ inside: 'c'.repeat(40) }), /собран из c{40}/],
    [published({ manifest: { images: [{ name: 'ghcr.io/sislex/other-api' }] } }), /Образ ghcr.io\/sislex\/other-api не закреплён/],
    [published({ manifest: { tools: ['voice'] } }), /Инструмент voice не закреплён/],
    [published({ manifest: { repository: 'https://github.com/sislex/fork' } }), /закреплён из https:\/\/github.com\/sislex\/make/]
  ]
  for (const [{ dir }, error] of cases) {
    const { core } = fixture()
    const snapshot = (base) => ['vendor/owner-artifacts.json', 'dependency-snapshots.json', 'package.json', 'package-lock.json', 'deploy/tools.lock.json', 'docker-compose.yml'].map((file) => readFileSync(join(base, file), 'utf8'))
    const before = snapshot(core)
    assert.throws(() => applyComposition(core, dir), error)
    // Отказ проверки не оставляет чекаут наполовину переписанным.
    assert.deepEqual(snapshot(core), before)
  }
})

test('a new package or a second release of the same repository is not a composition change', () => {
  const other = archive('@sislexa/new', '1.0.0', NEW)
  const d = archiveDigests(other)
  const extra = { name: '@sislexa/new', version: '1.0.0', asset: releasePackageAsset('@sislexa/new', '1.0.0', d.sha256), ...d }
  const { dir } = published()
  const manifest = read(join(dir, 'make', 'sislexa-release.json'))
  write(join(dir, 'make', 'sislexa-release.json'), { ...manifest, packages: [...manifest.packages, extra] })
  writeFileSync(join(dir, 'make', extra.asset), other)
  assert.throws(() => applyComposition(fixture().core, dir), /@sislexa\/new не закреплён в Core/)

  const twice = published()
  mkdirSync(join(twice.dir, 'again'))
  for (const name of ['sislexa-release.json', twice.pkg.asset]) writeFileSync(join(twice.dir, 'again', name), readFileSync(join(twice.dir, 'make', name)))
  assert.throws(() => applyComposition(fixture().core, twice.dir), /Два выпуска одного репозитория/)
})

test('manifestFromCore publishes exactly the pinned bytes at the tool commit', () => {
  const { core, pinned } = fixture()
  const { manifest, files } = manifestFromCore(REPO, core)
  assert.deepEqual(manifest, { schemaVersion: 1, repository: REPO, version: '1.0.0', commit: OLD,
    packages: [{ name: '@sislexa/make', version: '1.0.0', asset: pinned.asset, sha256: pinned.sha256, integrity: pinned.integrity, size: readFileSync(join(core, 'vendor', pinned.asset)).length }],
    images: [{ name: 'ghcr.io/sislex/make-api' }], tools: ['make'] })
  assert.deepEqual(files, [join(core, 'vendor', pinned.asset)])
})

test('publishing creates the tag once and never reuses a version for another commit', async () => {
  const { core } = fixture()
  const { manifest, files } = manifestFromCore(REPO, core)
  const calls = []
  let existing = null, tag = null
  const fetchImpl = async (url, init = {}) => {
    calls.push(`${init.method ?? 'GET'} ${String(url).replace(/\?.*/, '')}`)
    if (String(url).endsWith('/releases/tags/v1.0.0')) return existing ? Response.json(existing) : new Response('', { status: 404 })
    if (String(url).endsWith('/git/ref/tags/v1.0.0')) return tag ? Response.json({ object: { type: 'commit', sha: tag } }) : new Response('', { status: 404 })
    if (String(url).endsWith('/releases') && init.method === 'POST') return Response.json({ html_url: 'https://github.com/sislex/make/releases/v1.0.0', upload_url: 'https://uploads.github.com/repos/sislex/make/releases/1/assets{?name,label}', assets: [] })
    if (String(url).startsWith('https://uploads.github.com/')) return Response.json({})
    if (String(url) === 'manifest-url') return Response.json({ ...manifest, commit: NEW })
    throw new Error('unexpected ' + url)
  }
  const result = await publishGithubRelease({ manifest, files, token: 't', fetchImpl, log: () => {} })
  assert.equal(result.tag, 'v1.0.0')
  assert.deepEqual(calls, ['GET https://api.github.com/repos/sislex/make/releases/tags/v1.0.0', 'GET https://api.github.com/repos/sislex/make/git/ref/tags/v1.0.0', 'POST https://api.github.com/repos/sislex/make/releases',
    'POST https://uploads.github.com/repos/sislex/make/releases/1/assets', 'POST https://uploads.github.com/repos/sislex/make/releases/1/assets'])
  // Тег версии уже стоит на другом коммите — релиз к нему не привязывается.
  tag = NEW
  await assert.rejects(publishGithubRelease({ manifest, files, token: 't', fetchImpl, log: () => {} }), /Тег v1.0.0 уже указывает на b{40}/)
  tag = null
  existing = { upload_url: '', assets: [{ name: 'sislexa-release.json', url: 'manifest-url' }] }
  await assert.rejects(publishGithubRelease({ manifest, files, token: 't', fetchImpl, log: () => {} }), /уже опубликован из b{40}/)
  await assert.rejects(publishGithubRelease({ manifest, files, token: '', fetchImpl, log: () => {} }), /GITHUB_TOKEN/)
})
