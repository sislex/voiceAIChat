import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { createCachedSizer, sizes } from './route-compression.mjs'
import { inventory } from './route-budgets.mjs'
const fixture = () => Buffer.from('export const hello = "world";\n'.repeat(20))
function directory(t) { const path = mkdtempSync(join(tmpdir(), 'vc-compression-test-')); t.after(() => rmSync(path, { recursive: true, force: true })); return path }

test('cold and persisted warm cache match reference compression', t => {
  const path = directory(t), bytes = fixture(), cold = createCachedSizer(path)
  assert.deepEqual(cold(bytes), sizes(bytes)); assert.equal(cold.stats.misses, 1)
  const warm = createCachedSizer(path)
  assert.deepEqual(warm(bytes), sizes(bytes)); assert.equal(warm.stats.hits, 1)
  const changed = Buffer.concat([bytes, Buffer.from('// changed')])
  assert.deepEqual(warm(changed), sizes(changed)); assert.equal(warm.stats.misses, 1)
})
test('invalid metadata, runtime/options fingerprint, bytes and compressed content are recomputed', t => {
  const path = directory(t), bytes = fixture(), reference = sizes(bytes), measure = createCachedSizer(path)
  measure(bytes)
  const file = join(path, readdirSync(path)[0]), original = readFileSync(file, 'utf8')
  const wrong = gzipSync(Buffer.from('other content'))
  for (const corrupt of [
    () => '{',
    entry => JSON.stringify({ ...entry, fingerprint: 'other runtime or options' }),
    entry => JSON.stringify({ ...entry, content: 'wrong build' }),
    entry => JSON.stringify({ ...entry, gzip: { ...entry.gzip, bytes: 'broken' } }),
    entry => JSON.stringify({ ...entry, gzip: { bytes: wrong.toString('base64'), sha256: createHash('sha256').update(wrong).digest('hex') } })
  ]) {
    writeFileSync(file, corrupt(JSON.parse(original)))
    assert.deepEqual(measure(bytes), reference)
    assert.equal(measure.stats.hits, 0)
  }
  assert.equal(measure.stats.misses, 6)
})
test('unwritable cache cannot fail a valid budget measurement', t => {
  const path = join(directory(t), 'file'); writeFileSync(path, 'not a directory')
  const measure = createCachedSizer(path)
  assert.deepEqual(measure(fixture()), sizes(fixture()))
  assert.equal(measure.stats.writeFailures, 1)
})
test('cached compression never hides changed import graphs or missing chunks', t => {
  const root = directory(t), cache = directory(t), measure = createCachedSizer(cache)
  writeFileSync(join(root, 'index.js'), 'export const one = 1')
  const before = inventory(root, measure)
  writeFileSync(join(root, 'index.js'), 'import "./part.js"; export const one = 1')
  assert.throws(() => inventory(root, measure), /missing dependency part.js/)
  writeFileSync(join(root, 'part.js'), 'export const two = 2')
  const after = inventory(root, measure)
  assert.notEqual(after['index.js'].sha256, before['index.js'].sha256)
  assert.deepEqual(after['index.js'].imports, ['part.js'])
  assert.deepEqual(after, inventory(root))
})
