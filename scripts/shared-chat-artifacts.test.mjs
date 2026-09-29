import { test } from 'node:test'
import './model-speed-artifacts.test.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { archiveFiles, verifySnapshot } from './shared-chat-artifacts.mjs'
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
