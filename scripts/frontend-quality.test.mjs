import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { checkArchitecture, checkBundle, redact, runStatic } from './frontend-quality.mjs'

test('frontend build gate installs standalone Desktop dependencies before build', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.match(pkg.scripts['frontend:build-gates'], /npm ci --prefix apps\/desktop && npm --prefix apps\/desktop run build/)
})

test('current frontend satisfies static quality gates', () => {
  const result = runStatic()
  assert.equal(result.architecture.packages, 12)
  assert.equal(result.stories.modules, 9)
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

// Группы бюджета сопоставляются по префиксу имени файла, и у входного чанка это
// однажды сработало наоборот: ленивый чанк пакета с точкой входа `index.ts`
// получил имя `index-XXX.js`, попал в ту же группу — и разгрузка главного чанка
// выглядела как его рост на 32 КБ. Для входного чанка префикса недостаточно.
test('bundle budget measures the entry chunk named by index.html, not every index- file', () => {
  const root = mkdtempSync(join(tmpdir(), 'bundle-gate-'))
  const assets = join(root, 'apps/web/dist/assets')
  mkdirSync(assets, { recursive: true })
  writeFileSync(join(root, 'apps/web/dist/index.html'), '<script type="module" src="/assets/index-entry.js"></script>')
  writeFileSync(join(assets, 'index-entry.js'), 'a'.repeat(1000))
  // Ленивый чанк с тем же префиксом: он не должен попадать в бюджет входного.
  writeFileSync(join(assets, 'index-lazy.js'), 'b'.repeat(5000))
  writeFileSync(join(assets, 'react-x.js'), 'c'.repeat(100))
  mkdirSync(join(root, 'frontend-quality'), { recursive: true })
  writeFileSync(join(root, 'frontend-quality/bundle-baseline.json'), JSON.stringify({
    maxBytes: { 'index-': 1200, 'react-': 200 },
    totalJsMaxBytes: 100000,
    measuredAt: 'test'
  }))

  const result = checkBundle({ root })
  assert.equal(result.measured['index-'], 1000)
  assert.deepEqual(result.chunks['index-'], ['index-entry.js'])
})

test('bundle budget still sums a group with several legitimate chunks', () => {
  const root = mkdtempSync(join(tmpdir(), 'bundle-gate-sum-'))
  const assets = join(root, 'apps/web/dist/assets')
  mkdirSync(assets, { recursive: true })
  writeFileSync(join(root, 'apps/web/dist/index.html'), '<script type="module" src="/assets/index-entry.js"></script>')
  writeFileSync(join(assets, 'index-entry.js'), 'a'.repeat(10))
  writeFileSync(join(assets, 'markdown-a.js'), 'm'.repeat(300))
  writeFileSync(join(assets, 'markdown-b.js'), 'm'.repeat(400))
  writeFileSync(join(assets, 'react-x.js'), 'c'.repeat(10))
  mkdirSync(join(root, 'frontend-quality'), { recursive: true })
  writeFileSync(join(root, 'frontend-quality/bundle-baseline.json'), JSON.stringify({
    maxBytes: { 'index-': 100, 'markdown-': 1000, 'react-': 100 },
    totalJsMaxBytes: 100000,
    measuredAt: 'test'
  }))

  const result = checkBundle({ root })
  assert.equal(result.measured['markdown-'], 700)
})
