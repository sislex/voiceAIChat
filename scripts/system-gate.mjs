// Run owner-maintained scenarios against the exact dependencies of a Core release.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
export function systemPlan(matrix, coreCommit) {
  if (!/^[a-f0-9]{40}$/.test(coreCommit)) throw Error('Expected immutable Core commit')
  if (matrix.schemaVersion !== 1 || matrix.owners?.length !== 3) throw Error('Missing system owners')
  const seen = new Set()
  return matrix.owners.map(owner => {
    if (!/^(playwrightreader|webreader|sislexa-core-ui)$/.test(owner.repository) || !/^[a-f0-9]{40}$/.test(owner.commit) || seen.has(owner.repository)) throw Error('Invalid or duplicate system owner')
    seen.add(owner.repository)
    return { ...owner, url: `https://github.com/sislex/${owner.repository}.git`, coreCommit, command: ['npm', 'run', 'test:system'] }
  })
}
export function executeSystemPlan(plan, execute) {
  for (const owner of plan) execute(owner)
}
export function selectSystemOwners(plan, args) {
  const index = args.indexOf('--owners')
  if (index < 0) return plan
  const selected = args[index + 1]?.split(',') ?? []
  if (!selected.length || selected.some(name => !plan.some(owner => owner.repository === name))) throw Error('Invalid system owner selection')
  return plan.filter(owner => selected.includes(owner.repository))
}
// Fail closed: process arguments cannot reliably identify repositories (GIT_DIR,
// -C, helpers and inherited cwd). Any live Git process makes deletion unsafe.
export function assertNoActiveGit(checkout, inspect = () => execFileSync('ps', ['-axo', 'pid=,comm='], { encoding: 'utf8' })) {
  let processes
  try { processes = inspect() } catch (cause) {
    throw Error(`Cannot establish Git inactivity for ${checkout}`, { cause })
  }
  if (typeof processes !== 'string' || !processes.trim()) throw Error(`Cannot establish Git inactivity for ${checkout}`)
  for (const line of processes.trim().split('\n')) {
    const match = line.trim().match(/^[1-9]\d*\s+(.+)$/)
    if (!match) throw Error(`Cannot establish Git inactivity for ${checkout}`)
    if (/(?:^|\/)git(?:-[^/\s]+)?(?:\s|$)/.test(match[1])) {
      throw Error(`Active Git process; refusing cleanup of ${checkout}`)
    }
  }
}

function assertRealDirectories(directory) {
  // Never follow a cache symlink into another checkout during destructive recovery.
  for (let path = resolve(directory); ; path = resolve(path, '..')) {
    if (existsSync(path) && (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())) throw Error(`Unsafe cache directory: ${path}`)
    if (path === resolve(path, '..')) break
  }
}

export function cleanOwnerGitResidue(checkout, assertIdle = assertNoActiveGit) {
  const gitDirectory = join(checkout, '.git'), packDirectory = join(gitDirectory, 'objects/pack')
  assertRealDirectories(gitDirectory)
  assertRealDirectories(packDirectory)
  const residues = [
    ...(existsSync(join(gitDirectory, 'shallow.lock')) ? [join(gitDirectory, 'shallow.lock')] : []),
    ...(existsSync(packDirectory) ? readdirSync(packDirectory).filter(name => name.startsWith('tmp_pack_')).map(name => join(packDirectory, name)) : []),
  ]
  if (!residues.length) return
  assertIdle(checkout)
  for (const file of residues) {
    if (!lstatSync(file).isFile()) throw Error(`Unsafe Git residue: ${file}`)
  }
  for (const file of residues) rmSync(file)
}

export function prepareCoreFixture(root, checkout, coreCommit, assertIdle = assertNoActiveGit) {
  if (!/^[a-f0-9]{40}$/.test(coreCommit)) throw Error('Expected immutable Core commit')
  const fixture = join(checkout, '.cache/core-system', coreCommit)
  if (existsSync(join(fixture, 'package-lock.json'))) return fixture
  assertRealDirectories(fixture)
  if (existsSync(fixture)) {
    assertIdle(fixture)
    rmSync(fixture, { recursive: true })
  }
  mkdirSync(fixture, { recursive: true })
  const git = (...args) => execFileSync('git', args, { cwd: fixture, stdio: 'pipe' })
  git('init', '--quiet')
  git('remote', 'add', 'origin', 'https://github.com/sislex/voiceAIChat.git')
  git('fetch', '--depth=1', pathToFileURL(resolve(root)).href, coreCommit)
  git('checkout', '--detach', coreCommit)
  if (!existsSync(join(fixture, 'package-lock.json'))) throw Error('Core fixture is missing package-lock.json')
  return fixture
}

// Owner checkouts are Git repositories; keeping them inside the Core checkout
// makes task workspaces contain nested repositories, which delivery workspace
// guards reject. The per-checkout hash keeps parallel Core checkouts isolated.
export function systemOwnersRoot(root, env = process.env, home = homedir()) {
  if (env.SISLEXA_SYSTEM_OWNERS_DIR) return resolve(env.SISLEXA_SYSTEM_OWNERS_DIR)
  return join(home, '.cache/sislexa/system-owners', createHash('sha256').update(resolve(root)).digest('hex').slice(0, 16))
}

export function main(args = process.argv.slice(2), {
  root = resolve(import.meta.dirname, '..'),
  ownersRoot = systemOwnersRoot(root),
  spawn = spawnSync,
  prepareFixture = prepareCoreFixture,
  cleanOwner = cleanOwnerGitResidue,
} = {}) {
  // Exercise the exact local artifact set before the existing owner system suites.
  // This check also accepts uncommitted delivery patches; owner release suites
  // retain their committed-input requirement.
  if (existsSync(join(root, 'dependency-snapshots.json'))) {
    const command = [process.execPath, '--import', 'tsx', 'scripts/shared-chat-gate.mjs']
    if (args.includes('--dry-run')) console.log(JSON.stringify({ subject: 'exact-artifacts', command }))
    else {
      const result = spawn(command[0], command.slice(1), { cwd: root, env: process.env, stdio: 'inherit' })
      if (result.error || result.status !== 0) throw result.error ?? Error('Exact-artifact system acceptance failed')
    }
  }
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  const commit = git('rev-parse', 'HEAD')
  const matrix = JSON.parse(readFileSync(join(root, 'system-tests/owners.json'), 'utf8'))
  if (existsSync(join(root, 'dependency-snapshots.json'))) {
    const snapshot = JSON.parse(readFileSync(join(root, 'dependency-snapshots.json'), 'utf8'))
    for (const owner of matrix.owners) {
      const artifact = snapshot.packages.find(row => row.repository === `https://github.com/sislex/${owner.repository}` && ['@sislexa/core-ui', '@sislexa/web-reader', '@sislexa/playwright-reader'].includes(row.name))
      if (!artifact) throw Error('Missing exact system owner artifact')
      owner.commit = artifact.commit
    }
  }
  const plan = selectSystemOwners(systemPlan(matrix, commit), args)
  if (args.includes('--dry-run')) { console.log(JSON.stringify(plan, null, 2)); return }
  if (git('status', '--porcelain', '--untracked-files=no')) throw Error('System release gate requires committed Core inputs')
  const results = [], directory = join(root, 'artifacts/gate-timings'); mkdirSync(directory, { recursive: true })
  const run = (command, args, cwd, env = process.env) => {
    const result = spawn(command, args, { cwd, env, stdio: 'inherit' })
    if (result.error || result.status !== 0) throw Object.assign(result.error ?? Error(`System stage failed: ${command} ${args.join(' ')}`), { exitCode: result.status || 1 })
  }
  executeSystemPlan(plan, owner => {
    const started = Date.now(), checkout = join(ownersRoot, owner.repository, owner.commit)
    let exitCode = 0
    try {
      if (!existsSync(join(checkout, '.git'))) {
        mkdirSync(checkout, { recursive: true }); run('git', ['init', '--quiet'], checkout)
        run('git', ['remote', 'add', 'origin', owner.url], checkout)
      }
      if (!existsSync(join(checkout, 'package.json'))) {
        cleanOwner(checkout)
        run('git', ['fetch', '--depth=1', 'origin', owner.commit], checkout)
        run('git', ['checkout', '--detach', owner.commit], checkout)
      }
      if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim() !== owner.commit) throw Error('System owner commit mismatch')
      prepareFixture(root, checkout, commit)
      // Installed-subject mode executes Core's locked packages; owner dependencies/builds are unnecessary.
      run('npm', ['run', 'test:system'], checkout, { ...process.env, SISLEXA_TEST_CORE_COMMIT: commit, SISLEXA_TEST_SUBJECT: 'installed' })
    } catch (error) { exitCode = error.exitCode || 1; throw error }
    finally {
      results.push({ repository: owner.repository, commit: owner.commit, seconds: (Date.now() - started) / 1000, exitCode })
      writeFileSync(join(directory, 'system.json'), JSON.stringify({ coreCommit: commit, results }, null, 2) + '\n')
    }
  })
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main() } catch (error) { console.error(error); process.exitCode = error.exitCode || 1 }
}
