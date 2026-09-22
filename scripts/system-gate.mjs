// Run owner-maintained scenarios against the exact dependencies of a Core release.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
export function main(args = process.argv.slice(2)) {
  const root = resolve(import.meta.dirname, '..')
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  const commit = git('rev-parse', 'HEAD')
  const plan = systemPlan(JSON.parse(readFileSync(join(root, 'system-tests/owners.json'))), commit)
  if (args.includes('--dry-run')) { console.log(JSON.stringify(plan, null, 2)); return }
  if (git('status', '--porcelain', '--untracked-files=no')) throw Error('System release gate requires committed Core inputs')
  const results = [], directory = join(root, 'artifacts/gate-timings'); mkdirSync(directory, { recursive: true })
  const run = (command, args, cwd, env = process.env) => {
    const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
    if (result.error || result.status !== 0) throw Object.assign(result.error ?? Error(`System stage failed: ${command} ${args.join(' ')}`), { exitCode: result.status || 1 })
  }
  executeSystemPlan(plan, owner => {
    const started = Date.now(), checkout = join(root, '.cache/system-owners', owner.repository, owner.commit)
    let exitCode = 0
    try {
      if (!existsSync(join(checkout, '.git'))) {
        mkdirSync(checkout, { recursive: true }); run('git', ['init', '--quiet'], checkout)
        run('git', ['remote', 'add', 'origin', owner.url], checkout)
      }
      if (!existsSync(join(checkout, 'package.json'))) {
        run('git', ['fetch', '--depth=1', 'origin', owner.commit], checkout)
        run('git', ['checkout', '--detach', owner.commit], checkout)
      }
      if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim() !== owner.commit) throw Error('System owner commit mismatch')
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
