// Explicit integration check: node --test scripts/vendor-install.test.mjs
// Run against a committed tree; never installs dependencies in the working checkout.
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const base = process.env.VENDOR_BASE_COMMIT ?? '2b094a67a442be8f0e9edf0a50db63c064b0e884'
const target = process.env.VENDOR_TARGET_COMMIT ?? 'HEAD'
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim()
const tree = ref => git('ls-tree', '-r', '-l', ref).split('\n').map(line => {
  const [metadata, file] = line.split('\t')
  return { file, bytes: Number(metadata.trim().split(/\s+/).at(-1)) || 0 }
})

// @testCase TC-04
test('npm ci succeeds in a clean clone of the target commit without changing its lockfile', { timeout: 300000 }, t => {
  const dir = mkdtempSync(join(tmpdir(), 'vendor-clean-install-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const clone = join(dir, 'repository')
  execFileSync('git', ['clone', '--quiet', '--shared', '--no-checkout', root, clone], { stdio: 'pipe' })
  execFileSync('git', ['checkout', '--quiet', '--detach', git('rev-parse', target)], { cwd: clone, stdio: 'pipe' })
  const lock = readFileSync(join(clone, 'package-lock.json'))
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: clone, encoding: 'utf8' }), '')
  execFileSync('npm', ['ci'], { cwd: clone, stdio: 'pipe', timeout: 270000, maxBuffer: 32 * 1024 * 1024 })
  assert.deepEqual(readFileSync(join(clone, 'package-lock.json')), lock)
  assert.equal(execFileSync('git', ['diff', '--exit-code', '--', 'package-lock.json'], { cwd: clone, encoding: 'utf8' }), '')
})

// @testCase TC-05
test('measures Git blob tree reduction and preserves pinned manifests and lockfile', t => {
  const before = tree(base), after = tree(target)
  const sum = rows => rows.reduce((total, row) => total + row.bytes, 0)
  const remaining = new Map(after.map(row => [row.file, row.bytes]))
  const deleted = before.filter(row => row.file.startsWith('vendor/') && row.file.endsWith('.tgz') && !remaining.has(row.file))
  assert.ok(deleted.length > 0)
  const delta = sum(before) - sum(after)
  assert.ok(delta > 0)
  assert.ok(sum(deleted) >= delta)
  for (const row of after.filter(row => row.file.startsWith('vendor/') && row.file.endsWith('.tgz'))) {
    assert.equal(git('rev-parse', base + ':' + row.file), git('rev-parse', target + ':' + row.file))
  }
  for (const file of ['package-lock.json', 'dependency-snapshots.json', 'vendor/owner-artifacts.json', 'vendor/ui-libraries.json']) {
    assert.equal(git('rev-parse', base + ':' + file), git('rev-parse', target + ':' + file))
  }
  t.diagnostic(JSON.stringify({ base: git('rev-parse', base), target: git('rev-parse', target), beforeBytes: sum(before), afterBytes: sum(after), reductionBytes: delta, removedArchives: deleted.length, removedArchiveBytes: sum(deleted) }))
})
