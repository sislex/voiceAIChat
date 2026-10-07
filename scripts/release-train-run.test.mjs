import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execute, parseRunArgs, createJournal, executeJournal, concreteAdapter } from './release-train-run.mjs'

const read = path => JSON.parse(readFileSync(path, 'utf8'))
const put = (path, value) => writeFileSync(path, JSON.stringify(value))
function fixture(t, realGit = true) {
  const directory = mkdtempSync(join(process.env.DELIVERY_ATTEMPT_ROOT ? join(process.env.DELIVERY_ATTEMPT_ROOT, 'tmp') : tmpdir(), 'train-run-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  if (!realGit) return { directory, repository: directory, plan: { ready: true, core: { count: 1 }, applications: [{
    application: 'identity', repository: 'sislex/identity', proposedVersion: '1.0.1', changes: { ahead: true, dev: 'a'.repeat(40) }, release: {} }] } }
  const git = (cwd, ...args) => execute('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], cwd)
  const owner = join(directory, 'owner'), repository = join(directory, 'core')
  for (const cwd of [owner, repository]) {
    mkdirSync(cwd); git(cwd, 'init', '-b', 'main')
    mkdirSync(join(cwd, 'apps/server'), { recursive: true })
    put(join(cwd, 'package.json'), { version: '1.0.0', scripts: { gate: 'true' } })
    put(join(cwd, 'apps/server/package.json'), { version: '1.0.0' })
    put(join(cwd, 'package-lock.json'), {})
    git(cwd, 'add', '.'); git(cwd, 'commit', '-m', 'base')
  }
  const old = git(owner, 'rev-parse', 'HEAD')
  git(owner, 'checkout', '-b', 'dev'); writeFileSync(join(owner, 'change'), 'owner'); git(owner, 'add', '.'); git(owner, 'commit', '-m', 'owner change')
  const source = git(owner, 'rev-parse', 'HEAD'); git(owner, 'checkout', '--detach')
  mkdirSync(join(repository, 'deploy')); mkdirSync(join(repository, 'docs/kb'), { recursive: true })
  const pin = { repository: 'https://github.com/sislex/identity', workspace: 'apps/server', version: '1.0.0', commit: old }
  put(join(repository, 'deploy/tools.lock.json'), { tools: { identity: pin } })
  writeFileSync(join(repository, 'docker-compose.yml'), `image: ghcr.io/sislex/identity:${old}\n`)
  writeFileSync(join(repository, 'docs/kb/deploy.md'), `Identity ${old}\n`)
  git(repository, 'add', '.'); git(repository, 'commit', '-m', 'Core pins'); git(repository, 'branch', 'dev')
  git(repository, 'remote', 'add', 'origin', 'https://github.com/sislex/core.git')
  const core = { count: 1, dev: git(repository, 'rev-parse', 'HEAD') }
  git(repository, 'checkout', '--detach')
  const plan = { ready: true, core, applications: [{ application: 'identity', repository: 'sislex/identity',
    proposedVersion: '1.0.1', pinnedVersion: '1.0.0', pinnedCommit: old, changes: { ahead: true, dev: source }, release: { matchesPinnedCommit: true } }] }
  const calls = [], prs = [], branches = [], releases = []
  let published, failPublish = false, failPreflight = false
  const env = { GH_TOKEN: randomUUID(), RELEASE_CENTER_TOKEN: randomUUID(), RELEASE_CENTER_URL: 'https://center.test', RELEASE_CENTER_PROJECT_ID: 'core', RELEASE_HEALTH_URL: 'https://health.test' }
  const run = (binary, args, cwd, options = {}) => {
    calls.push({ binary, args, cwd, config: options.env?.DOCKER_CONFIG })
    if (binary === 'git') {
      if (args[0] === 'clone') {
        const remote = args.at(-2), actual = remote.includes('identity') ? owner : repository
        const result = git(cwd, ...args.slice(0, -2), actual, args.at(-1))
        git(args.at(-1), 'config', 'remote.origin.url', actual)
        return result
      }
      if (args[0] === 'remote' && args[1] === 'get-url') return cwd.includes('owner-') || cwd.includes('publish-') ? 'https://github.com/sislex/identity.git' : 'https://github.com/sislex/core.git'
      return git(cwd, ...args)
    }
    if (binary === 'npm') {
      if (args.includes('--package-lock-only')) put(join(cwd, 'package-lock.json'), { version: read(join(cwd, 'package.json')).version })
      return ''
    }
    if (binary === 'docker') {
      assert.ok(existsSync(options.env.DOCKER_CONFIG))
      if (args[0] === 'login') assert.equal(options.input, env.GH_TOKEN + '\n')
      return '{}'
    }
    if (args.includes('--source')) {
      if (failPublish) throw Error('fixture secret must never reach journal')
      const sourceDir = args.at(-1)
      assert.equal(git(sourceDir, 'status', '--porcelain'), '')
      published = { repository: 'https://github.com/sislex/identity', version: read(join(sourceDir, 'package.json')).version,
        commit: git(sourceDir, 'rev-parse', 'HEAD'), images: [{ name: 'ghcr.io/sislex/identity' }] }
      return ''
    }
    return '' // KB commands are recorded; no external package execution in fixtures.
  }
  const fetcher = async (input, init = {}) => {
    const url = new URL(input), path = url.pathname, method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ url: input, method, body })
    const reply = data => new Response(JSON.stringify(data))
    if (url.hostname === 'health.test') return reply({ version: '1.0.1' })
    if (url.hostname === 'center.test') {
      assert.equal(init.headers.Authorization, `Bearer ${env.RELEASE_CENTER_TOKEN}`)
      if (path.endsWith('/preflight')) return reply({ ok: !failPreflight })
      if (path.endsWith('/branches')) {
        if (method === 'POST') branches.push({ branch: body.branch, sha: git(repository, 'rev-parse', 'main'), version: '1.0.1' })
        return reply(method === 'POST' ? branches.at(-1) : branches)
      }
      if (path.endsWith('/deploy')) { releases.push({ id: 'deployment', branch: body.branch, status: 'succeeded' }); return reply(releases.at(-1)) }
      if (path.endsWith('/deployment')) return reply(releases.at(-1))
      return reply(releases)
    }
    assert.equal(init.headers.Authorization, `Bearer ${env.GH_TOKEN}`)
    if (path === '/user') return reply({ login: 'fixture' })
    if (path.endsWith('/assets/1')) return reply(published)
    if (path.includes('/releases/tags/')) return reply({ draft: false, published_at: 'today', assets: [{ name: 'sislexa-release.json', url: 'https://api.github.com/assets/1' }] })
    if (path.includes('/commits/v')) return reply({ sha: published.commit })
    if (path.endsWith('/commits/main')) return reply({ sha: git(repository, 'rev-parse', 'main') })
    const remote = path.includes('/identity/') ? owner : repository
    if (path.endsWith('/pulls')) {
      if (method === 'POST') prs.push({ number: prs.length + 1, remote, head: { sha: git(remote, 'rev-parse', body.head), ref: body.head }, base: { ref: 'main' }, merged: false })
      return reply(method === 'POST' ? prs.at(-1) : prs.filter(pr => pr.remote === remote))
    }
    const number = Number(/\/pulls\/(\d+)/.exec(path)?.[1]), pr = prs.find(row => row.number === number)
    if (path.endsWith('/merge')) {
      assert.equal(body.sha, pr.head.sha)
      git(remote, 'checkout', 'main'); git(remote, 'merge', '--no-ff', pr.head.sha, '-m', 'Merge release')
      pr.merged = true; pr.merge_commit_sha = git(remote, 'rev-parse', 'HEAD'); git(remote, 'checkout', '--detach')
      return reply({ merged: true, sha: pr.merge_commit_sha })
    }
    if (pr) return reply(pr)
    throw Error(`Unexpected fixture request: ${path}`)
  }
  return { directory, repository, plan, env, run, fetcher, calls, git, owner,
    failPublish: value => { failPublish = value }, failPreflight: value => { failPreflight = value } }
}

test('selected owners only need their own readiness', () => {
  const row = { application: 'a', repository: 'acme/a', changes: { ahead: true, dev: 'd'.repeat(40), main: 'm'.repeat(40) }, release: { matchesPinnedCommit: true }, proposedVersion: '1.0.1', pinnedVersion: '1.0.0', pinnedCommit: 'a'.repeat(40) }
  const stale = { ...row, application: 'x', repository: 'acme/x', error: 'Published tag does not match pinned commit' }
  const ok = { docker: { ok: true }, token: { ok: true }, worktrees: { ok: true } }
  const plan = { ready: false, prerequisites: ok, core: { count: 1 }, applications: [row, stale] }
  assert.equal(createJournal(plan, { apps: ['a'], deploy: false }, '.').owners.length, 1)
  assert.throws(() => createJournal(plan, { apps: ['x'] }, '.'), /blocked/)
  assert.throws(() => createJournal(plan, { apps: [] }, '.'), /blocked/)
  assert.throws(() => createJournal({ ...plan, prerequisites: { ...ok, worktrees: { ok: false } } }, { apps: ['a'] }, '.'), /blocked/)
  assert.throws(() => createJournal({ ...plan, core: null }, { apps: ['a'] }, '.'), /blocked/)
})

test('run arguments, owner selection, shared aliases and pinned-only publication', () => {
  assert.deepEqual(parseRunArgs(['--apps', 'a,b', '--deploy']), { apps: ['a', 'b'], deploy: true, resume: undefined })
  for (const args of [['--resume', '../escape'], ['--resume', 'x', '--deploy'], ['--unknown'], ['--apps']]) assert.throws(() => parseRunArgs(args))
  const row = { application: 'a', repository: 'acme/a', changes: { ahead: false }, release: { matchesPinnedCommit: false }, pinnedVersion: '1.0.0', pinnedCommit: 'a'.repeat(40) }
  const plan = { ready: true, core: { count: 0 }, applications: [row, { ...row, application: 'b' }] }
  const journal = createJournal(plan, { apps: ['a'], deploy: false }, '.')
  assert.equal(journal.owners.length, 1); assert.deepEqual(journal.owners[0].applications, ['a', 'b'])
  assert.equal(journal.owners[0].bump, false)
  assert.throws(() => createJournal(plan, { apps: ['missing'] }, '.'))
  assert.throws(() => createJournal({ ...plan, ready: false }, { apps: [] }, '.'))
})

test('concrete adapters execute fixture owner and Core repositories, APIs, pins and deploy', async t => {
  const f = fixture(t), journal = createJournal(f.plan, { apps: [], deploy: true }, f.repository)
  const adapter = concreteAdapter(f)
  await executeJournal(journal, f.directory, adapter)
  assert.equal(journal.status, 'completed')
  const ownerDir = join(f.directory, journal.id, 'owner-0'), coreDir = join(f.directory, journal.id, 'core')
  assert.equal(read(join(ownerDir, 'package.json')).version, '1.0.1')
  assert.equal(read(join(ownerDir, 'apps/server/package.json')).version, '1.0.1')
  assert.equal(f.git(f.owner, 'rev-parse', 'dev'), f.git(f.owner, 'rev-parse', 'main'))
  const pin = read(join(coreDir, 'deploy/tools.lock.json')).tools.identity
  assert.equal(pin.commit, journal.results['owner-0-verify'].commit)
  assert.match(readFileSync(join(coreDir, 'docker-compose.yml'), 'utf8'), new RegExp(pin.commit))
  assert.match(readFileSync(join(coreDir, 'docs/kb/deploy.md'), 'utf8'), /1.0.1/)
  assert.ok(f.calls.some(call => call.args?.includes('--package-lock-only')))
  assert.ok(!f.calls.some(call => call.args?.includes('--workspaces')))
  assert.ok(f.calls.some(call => call.args?.join(' ') === 'run gate'))
  for (const call of f.calls.filter(call => call.config)) assert.equal(existsSync(call.config), false)
  assert.ok(!readFileSync(join(f.directory, journal.id + '.json'), 'utf8').includes('secret'))
  const count = f.calls.length
  await executeJournal(journal, f.directory, adapter)
  assert.equal(f.calls.length, count)
})

test('resume persists every successful boundary and retries only the failed step', async t => {
  const f = fixture(t, false), template = createJournal(f.plan, { apps: [], deploy: true }, f.repository)
  const names = ['prepare', 'gate', 'merge', 'sync', 'publish', 'verify', 'pin', 'coreGate', 'coreMerge', 'preflight', 'branch', 'deploy', 'health']
  for (const [index, failure] of names.entries()) {
    const journal = { ...structuredClone(template), id: `resume-${index}` }, calls = []
    await assert.rejects(executeJournal(journal, f.directory, async action => {
      calls.push(action); if (action === failure) throw Error('private error'); return action
    }), new RegExp(`stopped at .*${failure}`))
    const disk = read(join(f.directory, journal.id + '.json'))
    assert.equal(disk.status, 'failed'); assert.equal(Object.keys(disk.results).length, index)
    await executeJournal(disk, f.directory, async action => { calls.push(action); return action })
    assert.deepEqual(calls, [...names.slice(0, index + 1), ...names.slice(index)])
    assert.equal(disk.status, 'completed')
  }
})

test('publication failure removes Docker credentials and resumes concrete execution', async t => {
  const f = fixture(t), journal = createJournal(f.plan, { apps: [], deploy: false }, f.repository)
  f.failPublish(true)
  await assert.rejects(executeJournal(journal, f.directory, concreteAdapter(f)), /owner-0-publish/)
  for (const call of f.calls.filter(call => call.config)) assert.equal(existsSync(call.config), false)
  assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1)
  f.failPublish(false)
  await executeJournal(read(join(f.directory, journal.id + '.json')), f.directory, concreteAdapter(f))
  assert.equal(f.calls.filter(call => call.url?.endsWith('/deploy')).length, 0)
})

test('lost responses after every concrete step reconcile without duplicate side effects', async t => {
  const f = fixture(t), journal = createJournal(f.plan, { apps: [], deploy: true }, f.repository), adapter = concreteAdapter(f)
  for (const failure of ['prepare', 'gate', 'merge', 'sync', 'publish', 'verify', 'pin', 'coreGate', 'coreMerge', 'preflight', 'branch', 'deploy', 'health']) {
    await assert.rejects(executeJournal(journal, f.directory, async (...args) => {
      const result = await adapter(...args)
      if (args[0] === failure) throw Error('connection lost after acceptance')
      return result
    }), /stopped/)
  }
  await executeJournal(journal, f.directory, adapter)
  assert.equal(f.calls.filter(call => call.url?.endsWith('/branches') && call.method === 'POST').length, 1)
  assert.equal(f.calls.filter(call => call.url?.endsWith('/deploy') && call.method === 'POST').length, 1)
})

test('preflight blocks branch creation, and an active journal lock blocks execution', async t => {
  const f = fixture(t), journal = createJournal(f.plan, { apps: [], deploy: false }, f.repository)
  f.failPreflight(true)
  await assert.rejects(executeJournal(journal, f.directory, concreteAdapter(f)), /preflight/)
  assert.equal(f.calls.filter(call => call.url?.endsWith('/branches') && call.method === 'POST').length, 0)
  writeFileSync(join(f.directory, journal.id + '.json.lock'), '')
  await assert.rejects(executeJournal(journal, f.directory, () => assert.fail('locked')), /EEXIST/)
})
