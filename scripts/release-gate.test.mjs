import test from 'node:test'
import assert from 'node:assert/strict'
import { FULL_RELEASE_COMMANDS, main, releaseBase, releaseCommands } from './release-gate.mjs'

const sha = 'a'.repeat(40)

test('the production commit comes from the release center and must exist in the checkout', () => {
  assert.equal(releaseBase([], {}, () => true).base, null)
  assert.equal(releaseBase([], { VOICECHAT_RELEASE_BASE_SHA: 'main' }, () => true).base, null)
  assert.equal(releaseBase([], { VOICECHAT_RELEASE_BASE_SHA: sha }, () => false).base, null)
  assert.equal(releaseBase([], { VOICECHAT_RELEASE_BASE_SHA: sha }, () => true).base, sha)
  assert.equal(releaseBase(['--base', 'b'.repeat(40)], { VOICECHAT_RELEASE_BASE_SHA: sha }, () => true).base, 'b'.repeat(40))
})

test('system suites run only when their owner archives change', () => {
  assert.deepEqual(releaseCommands({ full: false, onlyPins: true, pinnedPackages: ['@sislexa/make'] }).extra, [])
  assert.equal(releaseCommands({ full: false, onlyPins: false, pinnedPackages: ['@sislexa/make'] }).mode, 'full')
  assert.deepEqual(releaseCommands({ full: false, onlyPins: true, pinnedPackages: ['@sislexa/web-reader'] }).extra, [['npm', ['run', 'gate:system']]])
  assert.equal(releaseCommands({ full: true }).mode, 'full')
})

test('without a production commit or with an unproven diff the full release chain runs', async () => {
  const saved = process.env.VOICECHAT_RELEASE_BASE_SHA
  delete process.env.VOICECHAT_RELEASE_BASE_SHA
  try {
    const calls = []
    assert.equal((await main([], (command, args) => calls.push([command, args]))).mode, 'full')
    assert.deepEqual(calls, FULL_RELEASE_COMMANDS.map(([c, a]) => [c, a]))
    const head = (await import('node:child_process')).execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const fullCalls = []
    const outcome = await main(['--base', head], (command, args) => fullCalls.push([command, args]), async () => ({ full: true, reasons: ['Core'], applications: [], contracts: [], e2eFiles: [] }))
    assert.equal(outcome.mode, 'full')
    assert.deepEqual(fullCalls, FULL_RELEASE_COMMANDS.map(([c, a]) => [c, a]))
  } finally { if (saved !== undefined) process.env.VOICECHAT_RELEASE_BASE_SHA = saved }
})

test('a proven owner replacement runs the narrowed plan and the owner system suites', async () => {
  const head = (await import('node:child_process')).execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const calls = []
  const plan = { full: false, reasons: ['pin'], applications: [], contracts: [], e2eFiles: [], pinChecks: true, onlyPins: true, pinnedPackages: ['@sislexa/playwright-reader'] }
  const outcome = await main(['--base', head], (command, args) => calls.push([command.split('/').pop(), args.join(' ')]), async () => plan)
  assert.equal(outcome.mode, 'narrowed')
  assert.ok(calls.some(([, args]) => args.includes('shared-chat-artifacts.test.mjs')))
  assert.deepEqual(calls.at(-1), ['npm', 'run gate:system'])
  assert.ok(!calls.some(([, args]) => args === 'run gate:all'))
})
