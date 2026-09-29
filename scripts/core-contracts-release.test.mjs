import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')

test('published Shared contracts resolve the S4 Identity and SDK releases', () => {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  execFileSync('node', ['scripts/core-contracts-release.mjs', '--version', '0.1.11', '--commit', commit], { cwd: root, stdio: 'pipe' })
  const archive = join(root, 'artifacts/core-contracts/0.1.11/voicechat-shared-0.1.11.tgz')
  const manifest = JSON.parse(execFileSync('tar', ['-xOzf', archive, 'package/package.json'], { encoding: 'utf8' }))
  const source = JSON.parse(execFileSync('tar', ['-xOzf', archive, 'package/release-source.json'], { encoding: 'utf8' }))
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))

  assert.equal(manifest.name, '@voicechat/shared')
  assert.equal(manifest.version, '0.1.11')
  assert.equal(source.commit, commit)
  assert.equal(manifest.peerDependencies['@sislexa/identity'], '>=1.4.2 <1.5.0')
  assert.equal(manifest.peerDependencies['@sislexa/sdk'], '>=1.2.0 <1.4.0')
  assert.equal(manifest.peerDependencies['@sislexa/voice'], lock.packages['node_modules/@sislexa/voice'].version)
})
