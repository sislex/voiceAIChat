import test from 'node:test'
import assert from 'node:assert/strict'
import { markFullGate } from './mark-full-gate.mjs'
const sha = 'a'.repeat(40)
test('promotion publishes an annotated immutable success tag with a timestamp', () => {
  const calls = []
  const tag = markFullGate(sha, args => calls.push(args), () => new Date('2026-10-06T00:00:00Z'))
  assert.equal(tag, `verified/full-gate/${sha}`)
  assert.deepEqual(calls, [
    ['cat-file', '-e', `${sha}^{commit}`],
    ['tag', '-a', tag, sha, '-m', 'gate:all exit 0\n2026-10-06T00:00:00.000Z'],
    ['push', 'origin', `refs/tags/${tag}:refs/tags/${tag}`]
  ])
})
test('invalid input and git failures stop attestation publication', () => {
  for (const value of [undefined, 'HEAD', '--all', 'a'.repeat(39)]) assert.throws(() => markFullGate(value, () => assert.fail('must not run git')))
  for (const failure of ['cat-file', 'tag', 'push']) {
    const calls = []
    assert.throws(() => markFullGate(sha, args => { calls.push(args[0]); if (args[0] === failure) throw Error('failed') }), /failed/)
    assert.equal(calls.at(-1), failure)
  }
})
