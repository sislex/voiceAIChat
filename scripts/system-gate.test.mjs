import { test } from 'node:test'
import assert from 'node:assert/strict'
import { systemPlan, executeSystemPlan, selectSystemOwners, prepareCoreFixture, cleanOwnerGitResidue, assertNoActiveGit, systemOwnersRoot, main, retryGitFetch, TRANSIENT_GIT_FAILURE } from './system-gate.mjs'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'
import { pathToFileURL } from 'node:url'
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()
const idle = checkout => assertNoActiveGit(checkout, () => '1 /usr/bin/node\n2 /usr/bin/ps')
function fixture(t) {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'system gate # '))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const root = join(directory, 'Core # with spaces'), checkout = join(directory, 'owner')
  mkdirSync(root); mkdirSync(checkout)
  git(root, 'init', '--quiet')
  git(root, 'config', 'user.email', 'test@example.com')
  git(root, 'config', 'user.name', 'System gate test')
  writeFileSync(join(root, 'package-lock.json'), '{}\n')
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'fixture')
  const commit = git(root, 'rev-parse', 'HEAD')
  return { root, checkout, commit, directory, target: join(checkout, '.cache/core-system', commit) }
}
function residue(checkout) {
  const pack = join(checkout, '.git/objects/pack')
  mkdirSync(pack, { recursive: true })
  const files = [join(checkout, '.git/shallow.lock'), join(pack, 'tmp_pack_test')]
  for (const file of files) writeFileSync(file, 'interrupted')
  const ordinary = join(pack, 'pack-keep.pack')
  writeFileSync(ordinary, 'keep')
  return { files, ordinary }
}

// @testCase TC1
test('seeds a detached Core fixture exclusively from a local URL', t => {
  const { root, checkout, commit } = fixture(t)
  const target = prepareCoreFixture(root, checkout, commit)
  assert.equal(git(target, 'rev-parse', 'HEAD'), commit)
  assert.equal(spawnSync('git', ['symbolic-ref', '-q', 'HEAD'], { cwd: target }).status, 1)
  assert.equal(git(target, 'remote', 'get-url', 'origin'), 'https://github.com/sislex/voiceAIChat.git')
  assert.equal(readFileSync(join(target, 'package-lock.json'), 'utf8'), '{}\n')
  assert.ok(readFileSync(join(target, '.git/FETCH_HEAD'), 'utf8').includes(' of ' + pathToFileURL(root).href))
  assert.equal(git(target, 'rev-parse', '--is-shallow-repository'), 'true')
})

// @testCase TC2
test('recreates incomplete fixtures and preserves ready fixtures without fetching', t => {
  const { root, checkout, commit, target, directory } = fixture(t)
  const { files } = residue(target)
  const outside = join(directory, 'keep')
  writeFileSync(outside, 'keep')
  prepareCoreFixture(root, checkout, commit, idle)
  for (const file of files) assert.equal(existsSync(file), false)
  assert.equal(readFileSync(outside, 'utf8'), 'keep')
  writeFileSync(join(target, 'sentinel'), 'keep')
  const fetched = readFileSync(join(target, '.git/FETCH_HEAD'), 'utf8')
  assert.equal(prepareCoreFixture('/missing-local-core', checkout, commit, () => assert.fail('ready fixture inspected')), target)
  assert.equal(readFileSync(join(target, 'sentinel'), 'utf8'), 'keep')
  assert.equal(readFileSync(join(target, '.git/FETCH_HEAD'), 'utf8'), fetched)
})

// @testCase TC3
test('cleans only stale owner residues and fails closed for active or unknown Git state', t => {
  const { root, checkout, commit, target } = fixture(t)
  git(checkout, 'init', '--quiet')
  const { files, ordinary } = residue(checkout)
  for (const inspect of [() => '1 /usr/bin/git\n2 /usr/bin/node', () => '1 /usr/lib/git-core/git-index-pack', () => 'unparseable process output', () => '', () => { throw Error('ps denied') }]) {
    const guard = path => assertNoActiveGit(path, inspect)
    assert.throws(() => cleanOwnerGitResidue(checkout, guard), /Git/)
    residue(target)
    assert.throws(() => prepareCoreFixture(root, checkout, commit, guard), /Git/)
    for (const file of [...files, join(target, '.git/shallow.lock')]) assert.equal(existsSync(file), true)
  }
  cleanOwnerGitResidue(checkout, idle)
  for (const file of files) assert.equal(existsSync(file), false)
  assert.equal(readFileSync(ordinary, 'utf8'), 'keep')
})

test('Git inspection accepts macOS PID zero without hiding active Git or malformed rows', () => {
  assert.doesNotThrow(() => assertNoActiveGit('/fixture', () => '    0 kernel_task\n    1 /sbin/launchd\n'))
  assert.throws(() => assertNoActiveGit('/fixture', () => '    0 kernel_task\n   42 /usr/bin/git\n'), /Active Git/)
  for (const row of ['-1 /usr/bin/node', '00 kernel_task', '0', 'unknown']) {
    assert.throws(() => assertNoActiveGit('/fixture', () => row), /Cannot establish Git inactivity/)
  }
})

test('active Git takes precedence over unknown process rows without permitting cleanup', () => {
  for (const unknown of ['42', 'unparseable process output']) {
    for (const rows of [`${unknown}\n43 /usr/bin/git`, `43 /usr/bin/git\n${unknown}`]) {
      assert.throws(() => assertNoActiveGit('/fixture', () => rows), /Active Git/)
    }
    assert.throws(() => assertNoActiveGit('/fixture', () => `${unknown}\n43 /usr/bin/node`), /Cannot establish Git inactivity/)
  }
})

test('no owner residue skips Git inspection even with unrelated Git processes', t => {
  const checkout = mkdtempSync(join(realpathSync(tmpdir()), 'system-owner-residue-'))
  t.after(() => rmSync(checkout, { recursive: true, force: true }))
  mkdirSync(join(checkout, '.git/objects/pack'), { recursive: true })
  cleanOwnerGitResidue(checkout, () => assert.fail('clean checkout inspected Git processes'))
  const { files } = residue(checkout)
  cleanOwnerGitResidue(checkout, idle)
  for (const file of files) assert.equal(existsSync(file), false)
  cleanOwnerGitResidue(checkout, () => assert.fail('cleaned checkout inspected Git processes'))
})

// @testCase TC3
test('a live Git process prevents destructive recovery', async t => {
  const { root, checkout, commit, target } = fixture(t)
  const { files } = residue(target)
  const child = spawn('git', ['hash-object', '--stdin'], { cwd: target, stdio: ['pipe', 'pipe', 'pipe'] })
  await once(child, 'spawn')
  try {
    assert.throws(() => prepareCoreFixture(root, checkout, commit), /Active Git/)
    for (const file of files) assert.equal(existsSync(file), true)
  } finally {
    const exited = once(child, 'exit')
    child.stdin.end()
    await exited
  }
})

// @testCase TC2
test('recovery refuses symlinked cache directories', t => {
  const { root, checkout, commit, directory } = fixture(t)
  symlinkSync(directory, join(checkout, '.cache'))
  assert.throws(() => prepareCoreFixture(root, checkout, commit, idle), /Unsafe cache/)
  assert.equal(existsSync(join(root, 'package-lock.json')), true)
})

// @testCase TC1
test('unavailable local SHA fails without remote fallback and can be retried', t => {
  const { root, checkout, commit } = fixture(t)
  assert.throws(() => prepareCoreFixture(root, checkout, 'f'.repeat(40)))
  assert.throws(() => prepareCoreFixture('/missing-local-core', checkout, commit))
  const target = prepareCoreFixture(root, checkout, commit, idle)
  assert.equal(git(target, 'rev-parse', 'HEAD'), commit)
  assert.throws(() => prepareCoreFixture(root, checkout, '../escape'), /immutable/)
})

// @testCase TC1
test('a local commit without the readiness marker fails preparation', t => {
  const { root, checkout } = fixture(t)
  git(root, 'rm', 'package-lock.json')
  git(root, 'commit', '-qm', 'missing marker')
  const commit = git(root, 'rev-parse', 'HEAD')
  assert.throws(() => prepareCoreFixture(root, checkout, commit), /missing package-lock.json/)
})

// @testCase TC2
test('a ready fixture with a different HEAD is preserved for owner-host validation', t => {
  const { root, checkout, commit } = fixture(t)
  const target = prepareCoreFixture(root, checkout, commit)
  git(target, 'config', 'user.email', 'test@example.com')
  git(target, 'config', 'user.name', 'System gate test')
  git(target, 'commit', '--allow-empty', '-qm', 'different HEAD')
  const different = git(target, 'rev-parse', 'HEAD')
  prepareCoreFixture(root, checkout, commit, () => assert.fail('ready fixture inspected'))
  assert.equal(git(target, 'rev-parse', 'HEAD'), different)
  assert.notEqual(different, commit)
})

const owner = { repository: 'webreader', commit: 'a'.repeat(40) }
const matrix = { schemaVersion: 1, owners: [owner, { ...owner, repository: 'playwrightreader' }, { ...owner, repository: 'sislexa-core-ui' }] }
function orchestrationFixture(t, snapshot = false) {
  const context = fixture(t)
  const { root, checkout } = context
  git(checkout, 'init', '--quiet')
  git(checkout, 'config', 'user.email', 'test@example.com')
  git(checkout, 'config', 'user.name', 'System gate test')
  writeFileSync(join(checkout, 'package.json'), '{}')
  git(checkout, 'add', '.'); git(checkout, 'commit', '-qm', 'owner')
  const ownerCommit = git(checkout, 'rev-parse', 'HEAD')
  const config = { schemaVersion: 1, owners: matrix.owners.map(row => ({ ...row, commit: ownerCommit })) }
  mkdirSync(join(root, 'system-tests'))
  writeFileSync(join(root, 'system-tests/owners.json'), JSON.stringify(config))
  if (snapshot) writeFileSync(join(root, 'dependency-snapshots.json'), JSON.stringify({
    packages: config.owners.map((row, index) => ({ repository: 'https://github.com/sislex/' + row.repository, commit: row.commit, name: ['@sislexa/web-reader', '@sislexa/playwright-reader', '@sislexa/core-ui'][index] })),
  }))
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'matrix')
  return { ...context, ownersRoot: join(context.directory, 'owners'), commit: git(root, 'rev-parse', 'HEAD'), config }
}

// @testCase TC4
test('selected owners clean before fetch and prepare before suites, after exact artifacts', t => {
  for (const selected of [[], ['--owners', 'webreader']]) {
    const { root, checkout, commit, config, ownersRoot } = orchestrationFixture(t, true)
    const calls = []
    const plan = selectSystemOwners(systemPlan(config, commit), selected)
    for (const row of plan) {
      const path = join(ownersRoot, row.repository, row.commit)
      mkdirSync(path, { recursive: true }); git(path, 'init', '--quiet')
      residue(path)
    }
    main(selected, {
      root,
      ownersRoot,
      cleanOwner: path => { calls.push('clean'); cleanOwnerGitResidue(path, idle) },
      prepareFixture: (core, path, sha) => {
        assert.equal(git(path, 'rev-parse', 'HEAD'), plan[0].commit)
        calls.push('prepare')
        prepareCoreFixture(core, path, sha, idle)
      },
      spawn: (command, args, options) => {
        if (command === process.execPath) { calls.push('exact'); return { status: 0 } }
        if (command === 'npm') {
          calls.push('suite')
          assert.equal(options.env.SISLEXA_TEST_CORE_COMMIT, commit)
          assert.equal(options.env.SISLEXA_TEST_SUBJECT, 'installed')
          assert.equal(git(join(options.cwd, '.cache/core-system', commit), 'rev-parse', 'HEAD'), commit)
          return { status: 0 }
        }
        if (args[0] === 'fetch') {
          calls.push('fetch')
          assert.equal(existsSync(join(options.cwd, '.git/shallow.lock')), false)
          // Use a local owner source; the orchestrator still requests its origin.
          assert.equal(args[2], 'origin')
          return spawnSync(command, [args[0], args[1], pathToFileURL(checkout).href, args[3]], options)
        }
        return spawnSync(command, args, options)
      },
    })
    assert.deepEqual(calls, ['exact', ...plan.flatMap(() => ['clean', 'fetch', 'prepare', 'suite'])])
    // Owner checkouts must stay outside the Core checkout: task workspaces reject nested repositories.
    assert.equal(existsSync(join(root, '.cache')), false)
    for (const row of plan) assert.equal(existsSync(join(ownersRoot, row.repository, row.commit, '.git')), true)
    const report = JSON.parse(readFileSync(join(root, 'artifacts/gate-timings/system.json')))
    assert.deepEqual(report.results.map(row => row.repository), plan.map(row => row.repository))
    assert.ok(report.results.every(row => row.exitCode === 0))
  }
})

// @testCase TC4
test('local fetch failure prevents the suite and all later owners and records failure', t => {
  const { root, checkout, config, ownersRoot } = orchestrationFixture(t)
  let preparations = 0, suites = 0
  assert.throws(() => main([], {
    root,
    ownersRoot,
    prepareFixture: (core, path, sha) => { preparations++; prepareCoreFixture('/missing-local-core', path, sha) },
    spawn: (command, args, options) => {
      if (command === 'npm') { suites++; return { status: 0 } }
      if (args[0] === 'fetch') return spawnSync(command, [args[0], args[1], pathToFileURL(checkout).href, args[3]], options)
      return spawnSync(command, args, options)
    },
  }))
  assert.equal(preparations, 1)
  assert.equal(suites, 0)
  const report = JSON.parse(readFileSync(join(root, 'artifacts/gate-timings/system.json')))
  assert.equal(report.results.length, 1)
  assert.equal(report.results[0].repository, config.owners[0].repository)
  assert.equal(report.results[0].exitCode, 1)
})

// @testCase TC3
test('unsafe owner cleanup stops before fetch, fixture preparation and suites', t => {
  for (const inspect of [() => '1 /usr/bin/git', () => 'unparseable process output', () => { throw Error('ps denied') }]) {
    const { root, commit, config, ownersRoot } = orchestrationFixture(t)
    const row = config.owners[0]
    const checkout = join(ownersRoot, row.repository, row.commit)
    git(root, 'init', '--quiet', checkout)
    const { files } = residue(checkout)
    assert.throws(() => main([], {
      root,
      ownersRoot,
      cleanOwner: path => cleanOwnerGitResidue(path, directory => assertNoActiveGit(directory, inspect)),
      prepareFixture: () => assert.fail('prepared after unsafe cleanup'),
      spawn: () => assert.fail('executed after unsafe cleanup'),
    }), /Git/)
    for (const file of files) assert.equal(existsSync(file), true)
    const report = JSON.parse(readFileSync(join(root, 'artifacts/gate-timings/system.json')))
    assert.equal(report.coreCommit, commit)
    assert.equal(report.results.length, 1)
    assert.equal(report.results[0].exitCode, 1)
  }
})

// @testCase TC4
test('dry-run preserves exact output and does no preparation, cleanup or execution', t => {
  for (const snapshot of [false, true]) for (const selected of [[], ['--owners', 'webreader']]) {
    const { root, commit, config, ownersRoot } = orchestrationFixture(t, snapshot)
    const output = [], originalLog = console.log
    console.log = value => output.push(value)
    const unexpected = () => assert.fail('dry-run performed a mutation')
    try { main(['--dry-run', ...selected], { root, ownersRoot, spawn: unexpected, prepareFixture: unexpected, cleanOwner: unexpected }) }
    finally { console.log = originalLog }
    const expected = []
    if (snapshot) expected.push(JSON.stringify({ subject: 'exact-artifacts', command: [process.execPath, '--import', 'tsx', 'scripts/shared-chat-gate.mjs'] }))
    expected.push(JSON.stringify(selectSystemOwners(systemPlan(config, commit), selected), null, 2))
    assert.deepEqual(output, expected)
    assert.equal(existsSync(join(root, '.cache')), false)
    assert.equal(existsSync(join(root, 'artifacts')), false)
    assert.equal(git(root, 'status', '--porcelain'), '')
  }
})

test('owner checkouts default outside the Core checkout and honour an override', () => {
  const home = join(tmpdir(), 'home'), first = systemOwnersRoot('/work/core-a', {}, home)
  assert.ok(first.startsWith(join(home, '.cache/sislexa/system-owners') + '/'))
  assert.equal(systemOwnersRoot('/work/core-a', {}, home), first)
  assert.notEqual(systemOwnersRoot('/work/core-b', {}, home), first)
  assert.equal(systemOwnersRoot('/work/core-a', { SISLEXA_SYSTEM_OWNERS_DIR: '/var/cache/owners' }, home), '/var/cache/owners')
})

test('owner selection preserves exact commits and rejects missing or unknown owners', () => {
  const plan = systemPlan(matrix, 'b'.repeat(40))
  assert.deepEqual(selectSystemOwners(plan, []), plan)
  for (const row of plan) assert.deepEqual(selectSystemOwners(plan, ['--owners', row.repository]), [row])
  assert.deepEqual(selectSystemOwners(plan, ['--owners', 'webreader,sislexa-core-ui']), [plan[0], plan[2]])
  for (const args of [['--owners'], ['--owners', ''], ['--owners', 'unknown']]) assert.throws(() => selectSystemOwners(plan, args))
})
test('release scenarios require pinned, known, unique repositories', () => {
  assert.equal(systemPlan(matrix, 'b'.repeat(40))[0].url, 'https://github.com/sislex/webreader.git')
  assert.throws(() => systemPlan(matrix, 'main'))
  for (const owners of [[], [owner], [owner, owner], [{ ...owner, commit: 'main' }], [{ ...owner, repository: '../core' }]]) assert.throws(() => systemPlan({ ...matrix, owners }, 'b'.repeat(40)))
})
test('one owner failure prevents later system stages', () => {
  const calls = []
  assert.throws(() => executeSystemPlan([owner, owner], row => { calls.push(row); throw Error('browser failed') }), /browser failed/)
  assert.equal(calls.length, 1)
})

test('git fetch retries transient GitHub transport failures with backoff and cleanup', () => {
  const results = [
    { status: 128, stderr: 'fetch-pack: unexpected disconnect while reading sideband packet\nfatal: fetch-pack: invalid index-pack output\n' },
    { status: 128, stderr: 'error: RPC failed; HTTP 502 curl 22 The requested URL returned error: 502\n' },
    { status: 0, stderr: '' },
  ]
  const sleeps = [], cleans = []
  retryGitFetch(() => results.shift(), { sleep: ms => sleeps.push(ms), clean: () => cleans.push(true), log: () => {} })
  assert.deepEqual(sleeps, [5000, 10000])
  assert.equal(cleans.length, 2)
  assert.equal(results.length, 0)
})

test('git fetch does not retry permanent failures and keeps the final message', () => {
  let calls = 0
  assert.throws(() => retryGitFetch(() => { calls++; return { status: 128, stderr: "fatal: couldn't find remote ref deadbeef\n" } }, { sleep: () => assert.fail('slept'), log: () => {} }),
    /couldn't find remote ref/)
  assert.equal(calls, 1)
})

test('git fetch gives up after four transient attempts', () => {
  let calls = 0
  const sleeps = []
  assert.throws(() => retryGitFetch(() => { calls++; return { status: 128, stderr: 'fatal: the remote end hung up unexpectedly\n' } }, { sleep: ms => sleeps.push(ms), log: () => {} }),
    error => /remote end hung up/.test(error.message) && error.exitCode === 128)
  assert.equal(calls, 4)
  assert.deepEqual(sleeps, [5000, 10000, 20000])
})

test('transient pattern covers the documented transport failures only', () => {
  for (const text of ['early EOF', 'Could not resolve host: github.com', 'Connection reset by peer', 'Connection timed out', 'HTTP 503']) assert.match(text, TRANSIENT_GIT_FAILURE)
  for (const text of ["couldn't find remote ref", 'Authentication failed', 'Permission denied (publickey)']) assert.doesNotMatch(text, TRANSIENT_GIT_FAILURE)
})

test('system gate retries a dropped owner fetch before running the suite', t => {
  const { root, checkout, ownersRoot } = orchestrationFixture(t)
  let fetches = 0
  const sleeps = []
  main([], {
    root,
    ownersRoot,
    sleep: ms => sleeps.push(ms),
    prepareFixture: () => {},
    spawn: (command, args, options) => {
      if (command === 'npm') return { status: 0 }
      if (args[0] === 'fetch') {
        fetches++
        if (fetches === 1) return { status: 128, stderr: 'fatal: fetch-pack: invalid index-pack output\n' }
        return spawnSync(command, [args[0], args[1], pathToFileURL(checkout).href, args[3]], options)
      }
      return spawnSync(command, args, options)
    },
  })
  assert.equal(sleeps[0], 5000)
  assert.ok(fetches >= 2)
})
