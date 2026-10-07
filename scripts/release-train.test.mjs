import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { command, coreChanges, formatPlan, githubClient, githubRepository, nextPatch, ownerChanges, pinnedRelease, planReleaseTrain, protectedWorktrees, main } from './release-train.mjs'

const fixtureToken = randomUUID()

function fixture(t, realGit = true) {
  // Canonical path: on macOS tmpdir() is under /var, a symlink to /private/var, which the root check rejects.
  const directory = realpathSync(mkdtempSync(join(process.env.DELIVERY_ATTEMPT_ROOT ? join(process.env.DELIVERY_ATTEMPT_ROOT, 'tmp') : tmpdir(), 'train-')))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const repository = join(directory, 'core'), worktreeRoot = join(directory, 'protected')
  mkdirSync(join(repository, 'deploy'), { recursive: true }); mkdirSync(worktreeRoot)
  const git = (...args) => command('git', ['-c', 'commit.gpgsign=false', ...args], repository)
  let base = 'a'.repeat(40)
  if (realGit) {
    git('init', '-b', 'main'); git('config', 'user.email', 'fixture@example.test'); git('config', 'user.name', 'Fixture')
    git('commit', '--allow-empty', '-m', 'base')
    base = git('rev-parse', 'HEAD')
    git('update-ref', 'refs/remotes/origin/main', base)
    git('commit', '--allow-empty', '-m', 'Core change')
    git('update-ref', 'refs/remotes/origin/dev', 'HEAD')
  }
  const pin = { repository: 'https://github.com/acme/voice', version: '1.2.9', commit: base }
  writeFileSync(join(repository, 'deploy/tools.lock.json'), JSON.stringify({ tools: { stt: pin, tts: pin, local: { repository: 'https://example.test/local' } } }))
  if (realGit) { git('add', '.'); git('commit', '-m', 'fixture lock') }
  const calls = []
  const fetcher = async (url, options) => {
    calls.push(url)
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error')
    assert.equal(options.headers.Authorization, `Bearer ${fixtureToken}`)
    let data
    if (url.endsWith('/commits/main')) data = { sha: base }
    else if (url.endsWith('/commits/dev')) data = { sha: 'd'.repeat(40) }
    else if (url.includes('/compare/')) data = { status: 'ahead', ahead_by: 1, commits: [{ sha: 'd'.repeat(40), commit: { message: 'Owner change\nbody' } }] }
    else if (url.endsWith('/releases/tags/v1.2.9')) data = { draft: false, published_at: '2026-01-01', target_commitish: 'main' }
    else if (url.endsWith('/commits/v1.2.9')) data = { sha: base }
    else throw Error('Unexpected request')
    return new Response(JSON.stringify(data))
  }
  const run = (binary, args, cwd) => {
    if (binary === 'docker') return '28.0'
    if (realGit) return command(binary, args, cwd)
    if (args[0] === 'log') return `${'c'.repeat(40)}\tCore change`
    return args.at(-1).includes('main') ? base : 'c'.repeat(40)
  }
  return { repository, worktreeRoot, env: { GH_TOKEN: fixtureToken }, fetcher, run, calls, git, base }
}

test('fixture Core and fake GitHub produce a read-only, ordered plan for every owner', async t => {
  const f = fixture(t)
  const before = f.git('status', '--porcelain=v1')
  const refs = f.git('show-ref')
  const index = readFileSync(join(f.repository, '.git/index'))
  const plan = await planReleaseTrain(f)
  assert.equal(plan.ready, true)
  assert.equal(plan.applications.length, 2)
  assert.equal(plan.applications[0].proposedVersion, '1.2.10')
  assert.equal(plan.applications[0].changes.count, 1)
  assert.equal(plan.applications[0].changes.commits[0].subject, 'Owner change')
  assert.equal(plan.applications[0].release.matchesPinnedCommit, true)
  assert.equal(plan.core.count, 1)
  assert.equal(plan.core.commits[0].subject, 'Core change')
  assert.equal(plan.steps.filter(step => step.startsWith('acme/voice:')).length, 1)
  assert.match(plan.steps[1], /pin verified/)
  assert.match(formatPlan(plan), /dev ahead: true \(1; ahead\)/)
  assert.ok(!JSON.stringify(plan).includes(fixtureToken))
  assert.equal(f.calls.length, 5)
  assert.equal(f.git('status', '--porcelain=v1'), before)
  assert.equal(f.git('show-ref'), refs)
  assert.deepEqual(readFileSync(join(f.repository, '.git/index')), index)
})

test('prerequisite failures retain Core results without sending unauthenticated requests', async t => {
  const f = fixture(t)
  const plan = await planReleaseTrain({ ...f, env: {}, worktreeRoot: join(f.worktreeRoot, 'missing'), run: (binary, args, cwd) => {
    if (binary === 'docker') throw Error('unavailable')
    return command(binary, args, cwd)
  } })
  assert.equal(plan.ready, false)
  assert.ok(Object.values(plan.prerequisites).every(check => !check.ok))
  assert.equal(plan.core.count, 1)
  assert.equal(f.calls.length, 0)
  assert.equal(plan.applications.length, 2)
})

test('protected root accepts clean fixture repositories and rejects dirty, symlink and stray entries', t => {
  const f = fixture(t)
  // A fixture root containing the Core checkout exercises actual git status.
  const directory = join(f.repository, '..')
  rmSync(f.worktreeRoot, { recursive: true })
  assert.equal(protectedWorktrees(directory).ok, true)
  writeFileSync(join(f.repository, 'untracked'), 'dirty')
  assert.equal(protectedWorktrees(directory).ok, false)
  rmSync(join(f.repository, 'untracked'))
  symlinkSync(f.repository, join(directory, 'link'))
  assert.equal(protectedWorktrees(directory).ok, false)
  rmSync(join(directory, 'link'))
  writeFileSync(join(directory, 'stray'), '')
  assert.equal(protectedWorktrees(directory).ok, false)
})

test('GitHub comparison paginates all commits using immutable heads', async () => {
  const paths = []
  const get = async path => {
    paths.push(path)
    if (path.endsWith('/commits/main')) return { sha: 'a' }
    if (path.endsWith('/commits/dev')) return { sha: 'b' }
    return { status: 'ahead', ahead_by: 101, commits: Array.from({ length: path.endsWith('page=1') ? 100 : 1 }, (_, i) => ({ sha: String(i), commit: { message: 'subject\nbody' } })) }
  }
  const changes = await ownerChanges('acme/voice', get)
  assert.equal(changes.count, 101)
  assert.equal(changes.commits.length, 101)
  assert.match(paths.at(-1), /compare\/a\.\.\.b\?per_page=100&page=2$/)
})

test('release lookup distinguishes missing, draft, matching and mismatched tag commits', async () => {
  const release = (draft, sha) => async path => path.includes('/releases/') ? { draft, published_at: 'now', target_commitish: 'main' } : { sha }
  assert.equal((await pinnedRelease('a/b', '1.0.0', 'abc', async () => null)).published, false)
  assert.equal((await pinnedRelease('a/b', '1.0.0', 'abc', release(true, 'abc'))).matchesPinnedCommit, false)
  assert.equal((await pinnedRelease('a/b', '1.0.0', 'abc', release(false, 'abc'))).matchesPinnedCommit, true)
  assert.equal((await pinnedRelease('a/b', '1.0.0', 'abc', release(false, 'def'))).matchesPinnedCommit, false)
})

test('GitHub failures are sanitized and only optional 404 means missing', async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(githubClient(randomUUID(), async () => new Response('secret', { status }))('/test', true), new RegExp(`HTTP ${status}`))
  }
  assert.equal(await githubClient(randomUUID(), async () => new Response('', { status: 404 }))('/test', true), null)
  await assert.rejects(githubClient(fixtureToken, async () => { throw Error(fixtureToken) })('/test'), /^Error: GitHub request failed$/)
})

test('behind/identical owners need no bump; diverged and mismatched releases block', async t => {
  for (const status of ['identical', 'behind', 'diverged', 'mismatch']) {
    const f = fixture(t)
    const fetcher = async (url, options) => {
      if (url.includes('/compare/')) return new Response(JSON.stringify({ status: status === 'mismatch' ? 'identical' : status, ahead_by: 0, commits: [] }))
      if (status === 'mismatch' && url.endsWith('/commits/v1.2.9')) return new Response(JSON.stringify({ sha: 'f'.repeat(40) }))
      return f.fetcher(url, options)
    }
    const plan = await planReleaseTrain({ ...f, fetcher })
    assert.equal(plan.ready, ['identical', 'behind'].includes(status))
    assert.ok(!plan.steps.some(step => step.includes('bump to')))
  }
})

test('missing Core refs, invalid versions and unsupported commands fail explicitly', async t => {
  const f = fixture(t)
  f.git('update-ref', '-d', 'refs/remotes/origin/dev')
  assert.throws(() => coreChanges(f.repository))
  assert.equal((await planReleaseTrain(f)).ready, false)
  assert.equal(nextPatch('0.9.99'), '0.9.100')
  assert.throws(() => nextPatch('1.0.0-beta'))
  assert.equal(githubRepository('git@github.com:acme/voice.git'), 'acme/voice')
  assert.equal(githubRepository('https://github.com.evil/acme/voice'), null)
  await assert.rejects(main(['run']), /Usage:/)
})

test('plan assembly with fake adapters preserves output and blocks conflicting shared pins', async t => {
  const f = fixture(t, false)
  const plan = await planReleaseTrain(f)
  assert.equal(plan.ready, true)
  assert.equal(plan.core.count, 1)
  assert.equal(plan.applications.length, 2)
  assert.equal(plan.steps.length, 4)
  assert.equal(plan.applications[0].release.matchesPinnedCommit, true)
  assert.ok(!formatPlan(plan).includes(fixtureToken))
  const lockPath = join(f.repository, 'deploy/tools.lock.json')
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  lock.tools.tts.version = '1.2.8'
  writeFileSync(lockPath, JSON.stringify(lock))
  const conflicting = await planReleaseTrain(f)
  assert.equal(conflicting.ready, false)
  assert.match(conflicting.applications[1].error, /inconsistent pins/)
})

test('plan assembly supports token fallback, missing releases, and API failures', async t => {
  const f = fixture(t, false)
  const plan = await planReleaseTrain({ ...f, env: { GITHUB_TOKEN: fixtureToken }, fetcher: async (url, options) => {
    if (url.includes('/compare/')) return new Response(JSON.stringify({ status: 'identical', ahead_by: 0, commits: [] }))
    if (url.includes('/releases/')) return new Response('', { status: 404 })
    return f.fetcher(url, options)
  } })
  assert.equal(plan.ready, true)
  assert.equal(plan.applications[0].release.published, false)
  assert.match(plan.steps[0], /publish pinned 1.2.9/)
  const failed = await planReleaseTrain({ ...f, fetcher: async () => new Response(fixtureToken, { status: 403 }) })
  assert.equal(failed.ready, false)
  assert.equal(failed.applications.length, 2)
  assert.equal(failed.core.count, 1)
  assert.ok(!JSON.stringify(failed).includes(fixtureToken))
})
