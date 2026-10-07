import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { parseArgs, releaseContracts } from './contracts-release.mjs'

const name = '@voicechat/make-contracts'
const read = path => JSON.parse(readFileSync(path, 'utf8'))
function put(root, file, value) {
  mkdirSync(resolve(root, file, '..'), { recursive: true })
  writeFileSync(join(root, file), typeof value === 'string' ? value : JSON.stringify(value))
}
function fixture(t) {
  const parent = resolve(process.env.DELIVERY_ATTEMPT_ROOT ?? '.', 'artifacts')
  mkdirSync(parent, { recursive: true })
  const root = mkdtempSync(join(parent, 'contracts-test-'))
  const previous = {}
  for (const [key, value] of Object.entries({ TMPDIR: root, npm_config_cache: join(root, 'cache'), npm_config_offline: 'true' })) {
    previous[key] = process.env[key]
    process.env[key] = value
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(root, { recursive: true, force: true })
  })
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const repo = (label, files) => {
    const path = join(root, label)
    mkdirSync(path)
    for (const [file, value] of Object.entries(files)) put(path, file, value)
    git(path, 'init')
    git(path, 'add', '.')
    git(path, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture')
    git(path, 'remote', 'add', 'origin', 'https://example.invalid/owner.git')
    return path
  }
  const source = repo('owner', {
    'package.json': { name: 'owner', private: true, workspaces: ['packages/contracts'] },
    'packages/contracts/package.json': { name, version: '2.0.0', files: ['index.js'] },
    'packages/contracts/index.js': 'export const version = 2\n'
  })
  const core = repo('core', {
    'package.json': { name: 'core', version: '1.0.0', private: true, workspaces: ['packages/shared'], dependencies: { [name]: '1.0.0' } },
    'packages/shared/package.json': { name: '@voicechat/shared', version: '0.0.0', dependencies: { [name]: '1.0.0' }, peerDependencies: { [name]: '1.0.0' } },
    'dependency-snapshots.json': { schemaVersion: 1, purpose: 'keep', packages: [{ name: 'unrelated', version: '1.0.0' }] }
  })
  return { root, source, core, git, repo, options: { name, version: '2.0.0', source, commit: git(source, 'rev-parse', 'HEAD') } }
}

test('Core pins every manifest, lock, archive hashes and provenance from a detached commit', t => {
  const f = fixture(t)
  // A later clean HEAD must not leak into the selected release.
  put(f.source, 'packages/contracts/index.js', 'export const version = 3\n')
  f.git(f.source, 'add', '.')
  f.git(f.source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'later')
  const result = releaseContracts(f.options, { core: f.core, log() {} })
  assert.equal(result.ok, true, JSON.stringify(result.results))
  const entry = result.entry
  assert.match(entry.asset, /^voicechat-make-contracts-2\.0\.0-[a-f0-9]{12}\.tgz$/)
  const archive = join(f.core, 'vendor', entry.asset)
  const bytes = readFileSync(archive)
  assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'))
  assert.equal(entry.integrity, 'sha512-' + createHash('sha512').update(bytes).digest('base64'))
  assert.equal(entry.provenance.commit, f.options.commit)
  assert.match(execFileSync('tar', ['-xOzf', archive, 'package/index.js'], { encoding: 'utf8' }), /version = 2/)
  assert.equal(read(join(f.core, 'package.json')).dependencies[name], `file:vendor/${entry.asset}`)
  const shared = read(join(f.core, 'packages/shared/package.json'))
  assert.equal(shared.dependencies[name], `file:../../vendor/${entry.asset}`)
  assert.equal(shared.peerDependencies[name], '2.0.0')
  assert.equal(read(join(f.core, 'package-lock.json')).packages['node_modules/' + name].integrity, entry.integrity)
  const snapshot = read(join(f.core, 'dependency-snapshots.json'))
  assert.equal(snapshot.purpose, 'keep')
  assert.equal(snapshot.packages[0].name, 'unrelated')
  assert.deepEqual(snapshot.packages[1], entry)
  assert.deepEqual(read(join(f.core, 'vendor/owner-artifacts.json')).packages, [entry])
})

test('consumer pins exact peers and performs a clean real npm ci', t => {
  const f = fixture(t)
  const consumer = f.repo('make', { 'package.json': { name: 'make', version: '1.0.0', dependencies: { [name]: '1.0.0' }, peerDependencies: { [name]: '^1.0.0' } } })
  put(consumer, 'node_modules/stale/marker', 'remove me')
  const result = releaseContracts({ ...f.options, consumers: `make=${consumer}` }, { core: f.core, log() {} })
  assert.equal(result.ok, true, JSON.stringify(result.results))
  assert.equal(read(join(consumer, 'package.json')).peerDependencies[name], '2.0.0')
  assert.equal(read(join(consumer, 'node_modules', name, 'package.json')).version, '2.0.0')
  assert.equal(existsSync(join(consumer, 'node_modules/stale')), false)
})

test('reports the peer conflict chain and continues with subsequent consumers', t => {
  const f = fixture(t)
  const blocker = join(f.root, 'blocker')
  put(blocker, 'package.json', { name: 'old-consumer', version: '1.0.0', peerDependencies: { [name]: '1.0.0' } })
  execFileSync('npm', ['pack', '--ignore-scripts'], { cwd: blocker, stdio: 'pipe' })
  const bad = f.repo('bad', { 'package.json': { name: 'bad', version: '1.0.0', dependencies: { [name]: '1.0.0', 'old-consumer': `file:${join(blocker, 'old-consumer-1.0.0.tgz')}` } } })
  const good = f.repo('good', { 'package.json': { name: 'good', version: '1.0.0', dependencies: { [name]: '1.0.0' } } })
  const logs = []
  const result = releaseContracts({ ...f.options, consumers: `bad=${bad},good=${good}` }, { core: f.core, log: line => logs.push(JSON.parse(line)) })
  assert.equal(result.ok, false)
  assert.deepEqual(logs.map(row => row.status), ['pass', 'fail', 'pass'])
  assert.match(logs[1].error, /ERESOLVE/)
  assert.match(logs[1].error, /peer @voicechat\/make-contracts@"1.0.0"/)
  assert.match(logs[1].error, /old-consumer/)
})

test('dirty source is refused before changing Core', t => {
  const f = fixture(t)
  put(f.source, 'untracked', 'dirty')
  assert.throws(() => releaseContracts(f.options, { core: f.core }), /Dirty source refused/)
  assert.equal(existsSync(join(f.core, 'vendor')), false)
})

test('Shared invokes the committed build:core-contracts adapter', t => {
  const f = fixture(t)
  const source = f.repo('shared-owner', {
    'package.json': { name: 'shared-owner', scripts: { 'build:core-contracts': 'node scripts/core-contracts-release.mjs' } },
    'packages/shared/package.json': { name: '@voicechat/shared', dependencies: {} },
    'packages/shared/src/index.ts': 'export const shared = true\n',
    'package-lock.json': { packages: {} },
    'scripts/core-contracts-release.mjs': readFileSync(new URL('./core-contracts-release.mjs', import.meta.url), 'utf8')
  })
  const core = f.repo('shared-core', { 'package.json': { name: 'shared-core', dependencies: { '@voicechat/shared': '0.1.0' } } })
  const result = releaseContracts({ name: '@voicechat/shared', version: '0.2.0', source, commit: f.git(source, 'rev-parse', 'HEAD') }, { core, log() {} })
  assert.equal(result.ok, true, JSON.stringify(result.results))
  assert.equal(result.entry.provenance.command, 'npm run build:core-contracts')
})

test('rejects malformed CLI inputs', () => {
  assert.throws(() => parseArgs([name, '--version', '2.0.0']), /Expected --version/)
  assert.throws(() => parseArgs(['@sislexa/make']), /owner/)
})
