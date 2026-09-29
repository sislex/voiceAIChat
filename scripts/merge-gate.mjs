import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const owners = [
  { path: 'packages/shared', workspace: '@voicechat/shared' },
  { path: 'packages/component-runtime', workspace: '@sislexa/component-runtime' },
  { path: 'apps/server', workspace: '@voicechat/server' },
  { path: 'apps/automation-runner', workspace: '@voicechat/automation-runner' }
]
const routeScripts = new Set(['scripts/measure-routes.mjs', 'scripts/route-gate.mjs'])
const testFile = /\.(?:test|spec)\.[cm]?[jt]sx?$/

/** A merge may use focused tests only when the diff itself supplies regressions. */
export function planMergeGate(files, fileExists = path => existsSync(resolve(root, path))) {
  const selected = new Map()
  const rootTests = new Set()
  let sharedContract = false
  const fallback = reason => ({ focused: false, reason, owners: [], rootTests: [] })
  for (const file of files) {
    if (/^(?:docs|plans|artifacts|generated\/kb|frontend-quality\/measurements)\//.test(file)
      || /(^|\/)(?:AGENTS|README|CLAUDE)\.md$/.test(file)) continue
    const owner = owners.find(item => file.startsWith(`${item.path}/`))
    if (owner) {
      if (!file.startsWith(`${owner.path}/src/`)) return fallback(`Package configuration changed: ${file}`)
      const entry = selected.get(owner.path) ?? { ...owner, tests: [], sources: [] }
      if (testFile.test(file)) entry.tests.push(file.slice(owner.path.length + 1))
      else entry.sources.push(file)
      selected.set(owner.path, entry)
      if (owner.path === 'packages/shared' && !testFile.test(file)) sharedContract = true
      continue
    }
    if (testFile.test(file) && file.startsWith('scripts/')) {
      rootTests.add(file)
      continue
    }
    if (routeScripts.has(file)) {
      rootTests.add('scripts/route-budgets.test.mjs')
      continue
    }
    if (file === 'scripts/prod/release_retention.py') {
      rootTests.add('scripts/prod/release_retention_test.py')
      continue
    }
    return fallback(`Unknown impact: ${file}`)
  }
  for (const owner of selected.values()) {
    if (owner.sources.length && !owner.tests.length)
      return fallback(`No changed regression suite for ${owner.path}`)
    if (owner.tests.some(test => !fileExists(`${owner.path}/${test}`)))
      return fallback(`Missing regression suite for ${owner.path}`)
  }
  if (sharedContract) {
    const server = selected.get('apps/server')
    if (!server?.tests.length) return fallback('Shared contract has no changed server consumer suite')
  }
  if ([...rootTests].some(file => !fileExists(file))) return fallback('Missing tooling regression suite')
  return { focused: true, owners: [...selected.values()], rootTests: [...rootTests] }
}

function run(command, args) {
  const started = performance.now()
  console.log(`[merge-gate] ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env })
  console.log(`[merge-gate] ${((performance.now() - started) / 1000).toFixed(2)}s, exit ${result.status ?? result.signal}`)
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}

export function main(args = process.argv.slice(2)) {
  const baseIndex = args.indexOf('--base')
  const base = baseIndex < 0 ? 'origin/main' : args[baseIndex + 1]
  if (!base || base.startsWith('-')) throw new Error('A valid --base ref is required')
  const files = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', base, 'HEAD', '--'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  const plan = planMergeGate(files)
  console.log(JSON.stringify({ base, files, plan }, null, 2))
  if (args.includes('--dry-run')) return plan
  if (!plan.focused) {
    console.log(`[merge-gate] Broad gate required: ${plan.reason}`)
    run('npm', ['run', 'gate:changed', '--', '--base', base])
    return plan
  }
  for (const owner of plan.owners) {
    run('npm', ['run', '-w', owner.workspace, 'typecheck'])
    if (owner.tests.length) run('npm', ['run', '-w', owner.workspace, 'test', '--', ...owner.tests])
  }
  for (const file of plan.rootTests) {
    if (file.endsWith('.py')) run('python3', [file])
    else run('node', ['--test', file])
  }
  return plan
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main() } catch (error) { console.error(error); process.exitCode = 1 }
}
