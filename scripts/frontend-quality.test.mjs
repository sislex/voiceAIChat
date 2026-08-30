import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { checkArchitecture, redact, runStatic } from './frontend-quality.mjs'

test('frontend build gate installs standalone Desktop dependencies before build', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.match(pkg.scripts['frontend:build-gates'], /npm ci --prefix apps\/desktop && npm --prefix apps\/desktop run build/)
})

test('current frontend satisfies static quality gates', () => {
  const result = runStatic()
  assert.equal(result.architecture.packages, 11)
  assert.equal(result.stories.modules, 8)
  assert.equal(result.lazyLoading.lazyProducts, 6)
})
test('architecture gate rejects deep imports', () => {
  const root = mkdtempSync(join(tmpdir(), 'frontend-gate-'))
  mkdirSync(join(root, 'a/src'), { recursive: true })
  mkdirSync(join(root, 'b/src'), { recursive: true })
  writeFileSync(join(root, 'a/src/index.ts'), "import '@voicechat/b/src/internal'")
  writeFileSync(join(root, 'b/src/index.ts'), 'export const value = 1')
  assert.throws(() => checkArchitecture({
    root,
    packages: [
      { name: '@voicechat/a', dir: 'a', layer: 'host' },
      { name: '@voicechat/b', dir: 'b', layer: 'shared' }
    ]
  }), /deep workspace import/)
})
test('architecture gate rejects workspace cycles', () => {
  const root = mkdtempSync(join(tmpdir(), 'frontend-cycle-'))
  for (const name of ['a', 'b']) mkdirSync(join(root, name, 'src'), { recursive: true })
  writeFileSync(join(root, 'a/src/index.ts'), "import '@voicechat/b'")
  writeFileSync(join(root, 'b/src/index.ts'), "import '@voicechat/a'")
  assert.throws(() => checkArchitecture({
    root,
    packages: [
      { name: '@voicechat/a', dir: 'a', layer: 'host' },
      { name: '@voicechat/b', dir: 'b', layer: 'shared' }
    ]
  }), /dependency cycle/)
})
test('quality report diagnostics redact credentials', () => {
  const output = redact('Bearer abc.def token=hunter2 https://alice:secret@example.test/path')
  assert.equal(output.includes('abc.def'), false)
  assert.equal(output.includes('hunter2'), false)
  assert.equal(output.includes('alice:secret'), false)
})
