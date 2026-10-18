import { test } from 'node:test'
import './model-speed-artifacts.test.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { archiveFiles, verifySnapshot, desktopFrozen, verifyDesktopRendererProvenance } from './shared-chat-artifacts.mjs'
import { pack } from 'tar-stream'
import { gzipSync } from 'node:zlib'
const snapshot = JSON.parse(readFileSync(new URL('../dependency-snapshots.json', import.meta.url)))
test('all exact owner artifacts and embedded Desktop renderer match the release snapshot', async () => {
  assert.equal((await verifySnapshot(snapshot)).size, 13)
})
test('incomplete, duplicate, mutated and wrong-provenance release sets fail closed', async () => {
  for (const mutate of [s => s.packages.pop(), s => s.packages[0] = s.packages[1], s => s.packages[0].sha256 = '0'.repeat(64), s => s.packages[0].commit = '0'.repeat(40), s => s.packages[0].asset = '../escape.tgz']) {
    const copy = structuredClone(snapshot); mutate(copy)
    await assert.rejects(verifySnapshot(copy))
  }
})
test('consumer extraction rejects links and traversal', async () => {
  for (const header of [{ name: 'package/../escape' }, { name: 'package/link', type: 'symlink', linkname: '/etc/passwd' }]) {
    const stream = pack(), chunks = []
    stream.on('data', chunk => chunks.push(chunk))
    const done = new Promise(resolve => stream.on('end', resolve))
    stream.entry(header, ''); stream.finalize(); await done
    await assert.rejects(archiveFiles(gzipSync(Buffer.concat(chunks))), /Unsafe/)
  }
})
test('a frozen Desktop is pinned but not re-verified against the current Core UI renderer', async () => {
  const frozenRow = { name: '@sislexa/desktop', frozen: { since: '2026-10-18', reason: 'unused' } }
  assert.equal(desktopFrozen({ packages: [frozenRow] }), true)
  assert.equal(desktopFrozen({ packages: [{ name: '@sislexa/desktop' }] }), false)
  assert.equal(desktopFrozen({ packages: [] }), false)
  if (!desktopFrozen(snapshot)) return
  const archives = await verifySnapshot(snapshot)
  const desktop = JSON.parse(archives.get('@sislexa/desktop').get('release-source.json'))
  const ui = JSON.parse(archives.get('@sislexa/core-ui').get('release-source.json'))
  let matches = true
  try { verifyDesktopRendererProvenance(desktop, ui) } catch { matches = false }
  // While frozen the pinned Desktop may embed an older renderer; unfreezing restores the check.
  const unfrozen = structuredClone(snapshot)
  delete unfrozen.packages.find(row => row.name === '@sislexa/desktop').frozen
  if (!matches) await assert.rejects(verifySnapshot(unfrozen), /Desktop/)
})
