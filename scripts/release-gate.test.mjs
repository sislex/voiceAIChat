import test from 'node:test'
import assert from 'node:assert/strict'
import { FULL_RELEASE_COMMANDS, main, releaseBase, releaseCommands, verifiedBase, releaseImpact, SYSTEM_PATH_PREFIXES, PERFORMANCE_PATH_PREFIXES } from './release-gate.mjs'

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
  assert.deepEqual(releaseCommands({ full: false, onlyPins: true, pinnedPackages: ['@sislexa/web-reader'] }).extra, [['npm', ['run', 'gate:system', '--', '--owners', 'webreader']]])
  assert.equal(releaseCommands({ full: true }).mode, 'full')
})

test('without a production commit or with an unproven diff the full release chain runs', async () => {
  const saved = process.env.VOICECHAT_RELEASE_BASE_SHA
  delete process.env.VOICECHAT_RELEASE_BASE_SHA
  try {
    const calls = []
    assert.equal((await main([], (command, args) => calls.push([command, args]))).mode, 'full')
    assert.deepEqual(calls, FULL_RELEASE_COMMANDS.map(([c, a]) => [c, a]))
    const head = sha
    const fullCalls = []
    const outcome = await main(['--base', head], (command, args) => fullCalls.push([command, args]), async () => ({ full: true, reasons: ['Core'], applications: [], contracts: [], e2eFiles: [] }), { releaseBase: () => ({ base: sha, reason: null }), verifiedBase: base => base, releaseImpact: () => ({ files: ['apps/server/src/db/schema.ts'], pinnedPackages: [] }) })
    assert.equal(outcome.mode, 'full')
    assert.deepEqual(fullCalls, [['npm', ['run', 'gate:all']]])
  } finally { if (saved !== undefined) process.env.VOICECHAT_RELEASE_BASE_SHA = saved }
})

test('a proven owner replacement runs the narrowed plan and the owner system suites', async () => {
  const head = sha
  const calls = []
  const plan = { full: false, reasons: ['pin'], applications: [], contracts: [], e2eFiles: [], pinChecks: true, onlyPins: true, pinnedPackages: ['@sislexa/playwright-reader'] }
  const outcome = await main(['--base', head], (command, args) => calls.push([command.split('/').pop(), args.join(' ')]), async () => plan, { releaseBase: () => ({ base: sha, reason: null }), verifiedBase: base => base, releaseImpact: () => ({ files: [], pinnedPackages: plan.pinnedPackages }) })
  assert.equal(outcome.mode, 'narrowed')
  assert.ok(calls.some(([, args]) => args.includes('shared-chat-artifacts.test.mjs')))
  assert.deepEqual(calls.at(-1), ['npm', 'run gate:system -- --owners playwrightreader'])
  assert.ok(!calls.some(([, args]) => args === 'run gate:all'))
})

const newer = 'b'.repeat(40), older = 'c'.repeat(40)
const ref = value => `refs/tags/verified/full-gate/${value}`
function fakeGit(tags, calls = [], failFetch = false, forks = {}) {
  return (...args) => {
    calls.push(args)
    if (args[0] === 'fetch') { if (failFetch) throw Error('offline'); return '' }
    if (args[0] === 'for-each-ref') {
      assert.ok(args.includes('--sort=-taggerdate'))
      return tags.map(tag => tag.ref ?? ref(tag.sha)).join('\n')
    }
    if (args[0] === 'cat-file') {
      const tag = tags.find(tag => (tag.ref ?? ref(tag.sha)) === args[2])
      return args[1] === '-t' ? tag.type ?? 'tag' : `object ${tag.object ?? tag.sha}\ntype ${tag.targetType ?? 'commit'}\ntag x\ntagger Test\n\n${tag.message ?? 'gate:all exit 0\n2026-10-06T00:00:00Z'}`
    }
    if (args[0] === 'merge-base' && args[1] !== '--is-ancestor') return forks[args[1]] ?? args[1]
    if (args[0] === 'merge-base') {
      const tag = tags.find(tag => tag.sha === (args[3] === 'HEAD' ? args[2] : args[3]))
      if (args[3] === 'HEAD' ? tag.nonAncestor : tag.beforeProduction) throw Error('not ancestor')
      return ''
    }
    throw Error(`Unexpected git: ${args}`)
  }
}
test('newest valid annotated attestation is selected after fetching only verified refs', () => {
  const calls = []
  assert.equal(verifiedBase(sha, fakeGit([{ sha: newer }, { sha: older }], calls)), newer)
  assert.deepEqual(calls[0], ['fetch', '--no-tags', 'origin', 'refs/tags/verified/full-gate/*:refs/tags/verified/full-gate/*'])
  assert.ok(calls.some(args => args.join(' ') === `merge-base --is-ancestor ${sha} ${newer}`))
})
test('a production release branch is compared from where it left the candidate history', () => {
  const calls = []
  const productionBranchHead = 'f'.repeat(40)
  assert.equal(verifiedBase(productionBranchHead, fakeGit([{ sha: newer }], calls, false, { [productionBranchHead]: sha })), newer)
  assert.ok(calls.some(args => args.join(' ') === `merge-base ${productionBranchHead} HEAD`))
  assert.ok(calls.some(args => args.join(' ') === `merge-base --is-ancestor ${sha} ${newer}`))
})
test('invalid names, lightweight tags, mismatched objects, missing success and unrelated history are rejected', () => {
  for (const invalid of [
    { ref: ref('main') }, { ref: ref(newer) + '/extra' }, { type: 'commit' },
    { object: older }, { targetType: 'tag' }, { message: 'gate:all exit 1' },
    { nonAncestor: true }, { beforeProduction: true }
  ]) {
    assert.equal(verifiedBase(sha, fakeGit([{ sha: newer, ...invalid }])), sha)
    assert.equal(verifiedBase(sha, fakeGit([{ sha: newer, ...invalid }, { sha: older }])), older)
  }
  assert.equal(verifiedBase(sha, fakeGit([{ sha } ])), sha)
  assert.equal(verifiedBase(sha, fakeGit([])), sha)
  assert.equal(verifiedBase(sha, fakeGit([{ sha: newer }], [], true)), sha)
})
test('owner pins and integration prefixes select suites in both full and narrowed mode', () => {
  for (const full of [false, true]) for (const [owner, prefixes] of Object.entries(SYSTEM_PATH_PREFIXES)) {
    assert.deepEqual(releaseCommands({ full, onlyPins: true }, { files: [], pinnedPackages: [owner] }).owners, [owner])
    for (const prefix of prefixes) assert.ok(releaseCommands({ full }, { files: [prefix + 'fixture.ts'], pinnedPackages: [] }).owners.includes(owner), prefix)
  }
  assert.deepEqual(releaseCommands({ full: true }, { files: ['apps/server/src/browser/checkTarget.ts'], pinnedPackages: [] }).owners, ['@sislexa/playwright-reader'])
  assert.deepEqual(releaseCommands({ full: true }, { files: ['apps/server/src/reader/mcpBase.ts'], pinnedPackages: [] }).owners, ['@sislexa/web-reader'])
  assert.deepEqual(releaseCommands({ full: true }, { files: ['docs/readme.md', 'apps/server/src/db/schema.ts'], pinnedPackages: [] }).extra, [])
})
test('performance runs for each rendering/measurement prefix and Core UI pin only', () => {
  for (const prefix of PERFORMANCE_PATH_PREFIXES) assert.equal(releaseCommands({}, { files: [prefix + 'fixture'], pinnedPackages: [] }).performance, true, prefix)
  assert.equal(releaseCommands({}, { files: [], pinnedPackages: ['@sislexa/core-ui'] }).performance, true)
  assert.equal(releaseCommands({}, { files: ['docs/test.md'], pinnedPackages: ['@sislexa/web-reader'] }).performance, false)
})
test('full fallback still detects exactly the changed archive relative to the selected base', () => {
  const before = { packages: [{ name: '@sislexa/core-ui', asset: 'ui.tgz', commit: sha }, { name: '@sislexa/web-reader', asset: 'reader.tgz', commit: sha }] }
  const after = structuredClone(before); after.packages[1].commit = newer
  const impact = releaseImpact(older, (...args) => {
    if (args[0] === 'diff') { assert.equal(args[4], older); return 'dependency-snapshots.json\0apps/server/src/db/schema.ts\0' }
    assert.equal(args[1], `${older}:dependency-snapshots.json`)
    return JSON.stringify(before)
  }, () => JSON.stringify(after))
  assert.deepEqual(impact.pinnedPackages, ['@sislexa/web-reader'])
  assert.deepEqual(releaseCommands({ full: true }, impact).owners, ['@sislexa/web-reader'])
  assert.deepEqual(releaseImpact(sha, () => 'vendor/ui.tgz\0', () => JSON.stringify(before)).pinnedPackages, ['@sislexa/core-ui'])
})
test('package and lock pin changes do not select unrelated owners', () => {
  for (const file of ['package.json', 'package-lock.json']) {
    const doc = version => file === 'package.json'
      ? { dependencies: { '@sislexa/core-ui': version, '@sislexa/web-reader': 'unchanged' } }
      : { packages: { 'node_modules/@sislexa/core-ui': { resolved: version }, 'node_modules/@sislexa/web-reader': { resolved: 'unchanged' } } }
    const impact = releaseImpact(sha, (...args) => args[0] === 'diff' ? `${file}\0` : JSON.stringify(doc('before')), () => JSON.stringify(doc('after')))
    assert.deepEqual(impact.pinnedPackages, ['@sislexa/core-ui'])
  }
})
test('verified base reaches planning and impact inspection before full-mode owner execution', async () => {
  const head = sha
  const calls = [], order = []
  await main(['--base', head], (command, args) => calls.push([command, args]), async args => {
    order.push('plan'); assert.equal(args[1], newer); return { full: true, reasons: ['Core'] }
  }, { releaseBase: () => ({ base: sha, reason: null }), verifiedBase: () => { order.push('fetch'); return newer }, releaseImpact: base => {
    assert.equal(base, newer); return { files: [], pinnedPackages: ['@sislexa/core-ui'] }
  } })
  assert.deepEqual(order, ['fetch', 'plan'])
  assert.deepEqual(calls, [['npm', ['run', 'gate:all']], ['npm', ['run', 'gate:performance']], ['npm', ['run', 'gate:system', '--', '--owners', 'sislexa-core-ui']]])
})
