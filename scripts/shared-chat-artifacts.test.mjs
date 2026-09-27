import { test } from 'node:test'
import assert from 'node:assert/strict'
import { peerBlockers, inspectArtifacts } from './shared-chat-artifacts.mjs'

test('missing and incompatible owner peers block the candidate', () => {
  const owner = { name: '@sislexa/make', version: '1.2.1', peers: {
    '@sislexa/chat-ui': '0.2.0', '@voicechat/shared': '>=0.1.10 <0.2.0',
  } }
  assert.deepEqual(peerBlockers([owner], { '@voicechat/shared': '0.1.3' }), [
    { owner: owner.name, dependency: '@sislexa/chat-ui', required: '0.2.0', actual: null },
    { owner: owner.name, dependency: '@voicechat/shared', required: '>=0.1.10 <0.2.0', actual: '0.1.3' },
  ])
  assert.deepEqual(peerBlockers([owner], { '@sislexa/chat-ui': '0.2.0', '@voicechat/shared': '0.1.10' }), [])
})

test('candidate peer versions supersede old pins; optional absent peers are allowed', () => {
  const consumer = { name: '@sislexa/make', version: '1.2.1', peers: {
    '@voicechat/make-contracts': '1.3.0', '@sislexa/optional': '^1.0.0',
  }, optionalPeers: { '@sislexa/optional': { optional: true } } }
  assert.deepEqual(peerBlockers([consumer, { name: '@voicechat/make-contracts', version: '1.3.0', peers: {} }], {
    '@voicechat/make-contracts': '1.2.0',
  }), [])
  assert.equal(peerBlockers([consumer], { '@voicechat/make-contracts': '1.3.0', '@sislexa/optional': '2.0.0' }).length, 1)
})

test('incomplete or unsafe inventory fails before reading any archives', () => {
  assert.throws(() => inspectArtifacts('.', { schemaVersion: 1, artifacts: [] }), /Incomplete/)
  assert.throws(() => inspectArtifacts('.', { schemaVersion: 2, artifacts: [] }), /Invalid/)
  for (const filename of ['../escape.tgz', '/escape.tgz', '-option.tgz']) {
    assert.throws(() => inspectArtifacts('.', { schemaVersion: 1, artifacts: [{ filename, sha256: 'a'.repeat(64) }] }), /Invalid/)
  }
})
