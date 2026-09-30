import test from 'node:test'
import assert from 'node:assert/strict'
import { isOwnerPinFile, ownerPinChanges } from './owner-pins.mjs'

const manifest = (rows, extra = {}) => JSON.stringify({ schemaVersion: 1, ...extra, packages: rows })
const row = (name, version, sha, asset) => ({ name, version, sha256: sha, asset, commit: sha.repeat(5).slice(0, 40) })
const reader = (files) => (file) => files[file] ?? null

test('pin files are recognised; source files are not', () => {
  for (const file of ['package.json', 'apps/server/package.json', 'package-lock.json'.replace('-lock', ''), 'dependency-snapshots.json', 'vendor/owner-artifacts.json', 'vendor/ui-libraries.json', 'vendor/sislexa-make-1.3.1-81a51e984158.tgz', 'deploy/tools.lock.json', 'docker-compose.yml', 'deploy/compose.tools.yml'])
    assert.equal(isOwnerPinFile(file), true, file)
  for (const file of ['apps/server/src/turns.ts', 'package-lock.json', 'scripts/release-gate.mjs', 'vendor/readme.md'])
    assert.equal(isOwnerPinFile(file), false, file)
})

test('a republished archive with the same version is a change of that package', () => {
  const before = { 'dependency-snapshots.json': manifest([row('@voicechat/web-reader-contracts', '1.3.0', 'aaaaaaaa', 'contracts-1.3.0-aaaaaaaa.tgz'), row('@sislexa/make', '1.3.1', 'cccccccc', 'make.tgz')]) }
  const after = { 'dependency-snapshots.json': manifest([row('@voicechat/web-reader-contracts', '1.3.0', 'bbbbbbbb', 'contracts-1.3.0-bbbbbbbb.tgz'), row('@sislexa/make', '1.3.1', 'cccccccc', 'make.tgz')]), 'vendor/contracts-1.3.0-bbbbbbbb.tgz': 'bytes' }
  const result = ownerPinChanges(['dependency-snapshots.json', 'vendor/contracts-1.3.0-aaaaaaaa.tgz', 'vendor/contracts-1.3.0-bbbbbbbb.tgz'], reader(before), reader(after))
  assert.deepEqual(result.packages, ['@voicechat/web-reader-contracts'])
  assert.deepEqual(result.archives, ['contracts-1.3.0-aaaaaaaa.tgz', 'contracts-1.3.0-bbbbbbbb.tgz'])
})

test('package specs may only move between vendor archives', () => {
  const pkg = (spec, extra = {}) => JSON.stringify({ name: 'x', scripts: { gate: 'g' }, dependencies: { '@sislexa/make': spec, react: '18.3.1' }, ...extra })
  assert.deepEqual(ownerPinChanges(['package.json'], reader({ 'package.json': pkg('file:vendor/make-1.3.0-a.tgz') }), reader({ 'package.json': pkg('file:vendor/make-1.3.1-b.tgz') })).packages, ['@sislexa/make'])
  assert.deepEqual(ownerPinChanges(['apps/server/package.json'], reader({ 'apps/server/package.json': pkg('file:../../vendor/make-1.3.0-a.tgz') }), reader({ 'apps/server/package.json': pkg('file:../../vendor/make-1.3.1-b.tgz') })).packages, ['@sislexa/make'])
  assert.match(ownerPinChanges(['package.json'], reader({ 'package.json': pkg('file:vendor/a.tgz') }), reader({ 'package.json': pkg('file:vendor/a.tgz', { scripts: { gate: 'other' } }) })).unproven, /кроме зависимостей/)
  assert.match(ownerPinChanges(['package.json'], reader({ 'package.json': pkg('file:vendor/a.tgz') }), reader({ 'package.json': pkg('^1.0.0') })).unproven, /не архив vendor/)
})

test('compose files may only change image lines; tools lock only version and commit', () => {
  const compose = (image, env = 'A: 1') => `services:\n  make:\n    image: ${image}\n    environment:\n      ${env}\n`
  assert.equal(ownerPinChanges(['docker-compose.yml'], reader({ 'docker-compose.yml': compose('make:1') }), reader({ 'docker-compose.yml': compose('make:2') })).images, true)
  assert.match(ownerPinChanges(['docker-compose.yml'], reader({ 'docker-compose.yml': compose('make:1') }), reader({ 'docker-compose.yml': compose('make:1', 'A: 2') })).unproven, /кроме image/)
  const tools = (make) => JSON.stringify({ schemaVersion: 1, tools: { make } })
  assert.deepEqual(ownerPinChanges(['deploy/tools.lock.json'], reader({ 'deploy/tools.lock.json': tools({ version: '1.3.0', commit: 'a', repository: 'r' }) }), reader({ 'deploy/tools.lock.json': tools({ version: '1.3.1', commit: 'b', repository: 'r' }) })).tools, ['make'])
  assert.match(ownerPinChanges(['deploy/tools.lock.json'], reader({ 'deploy/tools.lock.json': tools({ version: '1', commit: 'a', repository: 'r' }) }), reader({ 'deploy/tools.lock.json': tools({ version: '1', commit: 'a', repository: 'other' }) })).unproven, /не только version/)
})

test('unexplained archives and manifest metadata changes stay unproven', () => {
  assert.match(ownerPinChanges(['vendor/unknown-1.0.0-abc.tgz'], reader({}), reader({ 'vendor/unknown-1.0.0-abc.tgz': 'x' })).unproven, /не описан/)
  const rows = [row('@sislexa/make', '1', 'aaaaaaaa', 'm.tgz')]
  assert.match(ownerPinChanges(['vendor/owner-artifacts.json'], reader({ 'vendor/owner-artifacts.json': manifest(rows, { purpose: 'a' }) }), reader({ 'vendor/owner-artifacts.json': manifest(rows, { purpose: 'b' }) })).unproven, /вне packages/)
})
