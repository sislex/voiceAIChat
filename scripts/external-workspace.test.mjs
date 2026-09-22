import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runExternalWorkspace, validateExternalWorkspace } from './external-workspace.mjs'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'external-consumer-'))
  const owner = join(root, 'node_modules/@fixture/owner')
  mkdirSync(owner, { recursive: true })
  const write = (path, value) => writeFileSync(path, JSON.stringify(value))
  const source = { version: '1.2.3', commit: 'a'.repeat(40), repository: 'https://github.com/fixture/owner' }
  const adapter = { sislexaExternal: { ...source, package: '@fixture/owner', workspace: '.' } }
  const manifest = { name: '@fixture/owner', version: source.version, exports: { './package.json': './package.json' }, scripts: { test: 'node -e "require(\'fs\').writeFileSync(\'owner-ran\',\'yes\')"' } }
  write(join(root, 'package.json'), adapter)
  write(join(owner, 'package.json'), manifest)
  write(join(owner, 'release-source.json'), source)
  return { root, owner, write, source, adapter, manifest, close: () => rmSync(root, { recursive: true, force: true }) }
}

test('consumer verification never executes owner suites and rejects their direct invocation', () => {
  const f = fixture()
  try {
    runExternalWorkspace('verify', [], f.root)
    for (const script of ['test', 'typecheck']) assert.throws(() => runExternalWorkspace(script, [], f.root), /owner repository/)
    assert.equal(existsSync(join(f.owner, 'owner-ran')), false)
  } finally { f.close() }
})
test('consumer refuses mismatched source and package versions or escaping workspace paths', () => {
  const f = fixture()
  try {
    for (const key of ['version', 'commit', 'repository']) {
      f.write(join(f.owner, 'release-source.json'), { ...f.source, [key]: 'wrong' })
      assert.throws(() => validateExternalWorkspace(f.root), /provenance/)
    }
    f.write(join(f.owner, 'release-source.json'), f.source)
    f.write(join(f.owner, 'package.json'), { ...f.manifest, version: '9.0.0' })
    assert.throws(() => validateExternalWorkspace(f.root), /provenance/)
    f.write(join(f.owner, 'package.json'), f.manifest)
    f.adapter.sislexaExternal.workspace = '../other'
    f.write(join(f.root, 'package.json'), f.adapter)
    assert.throws(() => validateExternalWorkspace(f.root), /workspace path/)
  } finally { f.close() }
})
