// Release regression compares the candidate with production or a refreshed full-gate
// attestation. Core fallback and owner/performance selection are independent.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { executeApplicationPlan, main as planFromDiff } from './application-gate.mjs'
import { FRONTEND_E2E_FILES } from './full-gate.mjs'

const root = resolve(import.meta.dirname, '..')
/** Owner archives whose repositories carry the system suites of `gate:system`. */
export const SYSTEM_OWNER_PACKAGES = Object.freeze(['@sislexa/core-ui', '@sislexa/web-reader', '@sislexa/playwright-reader'])
export const FULL_RELEASE_COMMANDS = Object.freeze([['npm', ['run', 'gate:all']], ['npm', ['run', 'gate:performance']], ['npm', ['run', 'gate:system']]])

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const error = Object.assign(new Error(`${command} ${args.join(' ')} failed: ${result.status ?? result.signal}`), { exitCode: result.status || 1 })
    throw error
  }
}

/** Production commit given by the release center; null means "unknown, run everything". */
export function releaseBase(args = process.argv.slice(2), env = process.env, has = (sha) => {
  try { execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: root, stdio: 'ignore' }); return true } catch { return false }
}) {
  const index = args.indexOf('--base')
  const value = index >= 0 ? args[index + 1] : env.VOICECHAT_RELEASE_BASE_SHA
  if (!value || !/^[a-f0-9]{40}$/.test(value)) return { base: null, reason: 'Коммит production не передан' }
  if (!has(value)) return { base: null, reason: `Коммит production ${value.slice(0, 12)} отсутствует в checkout` }
  return { base: value, reason: null }
}

// Public bridge changes select their consumers even when the application plan is full.
export const SYSTEM_PATH_PREFIXES = Object.freeze({
  '@sislexa/web-reader': ['apps/server/src/reader/', 'apps/server/src/readerBridge/', 'apps/server/src/routes/rest', 'apps/server/src/routes/integration', 'apps/server/src/tool', 'packages/shared/src/protocol', 'packages/shared/src/mcp', 'packages/shared/src/applicationFrontend'],
  '@sislexa/playwright-reader': ['apps/server/src/playwrightReaderBridge/', 'apps/server/src/readerBridge/', 'apps/server/src/browser/', 'apps/server/src/routes/browserShots', 'apps/server/src/routes/rest', 'apps/server/src/routes/integration', 'apps/server/src/tool', 'packages/shared/src/protocol', 'packages/shared/src/mcp', 'packages/shared/src/applicationFrontend'],
  '@sislexa/core-ui': ['apps/server/src/browserUi/', 'apps/server/src/routes/applicationFrontends', 'apps/server/src/routes/rest', 'apps/server/src/routes/chatSettings', 'apps/server/src/auth/browserChat', 'packages/shared/src/protocol', 'packages/shared/src/chatContract', 'packages/shared/src/applicationFrontend', 'packages/shared/src/browserUiRelease']
})
export const PERFORMANCE_PATH_PREFIXES = Object.freeze([
  'apps/server/src/browserUi/', 'apps/server/src/routes/uiPerformance',
  'packages/shared/src/chat', 'packages/chat/', 'packages/ui/', 'apps/web/',
  'scripts/measure-routes', 'scripts/route-', 'scripts/performance',
  'frontend-quality/route-budgets', 'frontend-quality/bundle-baseline',
  'frontend-quality/measurements/', 'e2e/routeBudgets.', 'e2e/fixtures/'
])
const repositories = { '@sislexa/core-ui': 'sislexa-core-ui', '@sislexa/web-reader': 'webreader', '@sislexa/playwright-reader': 'playwrightreader' }
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

/** Fetch failure must not make stale local attestations authoritative. */
export function verifiedBase(production, invoke = git) {
  try {
    invoke('fetch', '--no-tags', 'origin', 'refs/tags/verified/full-gate/*:refs/tags/verified/full-gate/*')
    const refs = invoke('for-each-ref', '--sort=-taggerdate', '--format=%(refname)', 'refs/tags/verified/full-gate/')
    for (const ref of refs.split('\n').filter(Boolean)) {
      const match = /^refs\/tags\/verified\/full-gate\/([a-f0-9]{40})$/.exec(ref)
      if (!match) continue
      try {
        if (invoke('cat-file', '-t', ref) !== 'tag') continue
        const [header, ...message] = invoke('cat-file', '-p', ref).split('\n\n')
        if (!header.startsWith(`object ${match[1]}\ntype commit\n`) || !message.join('\n\n').includes('gate:all exit 0')) continue
        invoke('merge-base', '--is-ancestor', match[1], 'HEAD')
        invoke('merge-base', '--is-ancestor', production, match[1])
        return match[1]
      } catch { /* Ignore invalid and unrelated attestations. */ }
    }
  } catch { /* Keep production when origin cannot be refreshed. */ }
  return production
}

/** Pin identities are independent of the application's full-fallback decision. */
export function releaseImpact(base, invoke = git, read = file => readFileSync(resolve(root, file), 'utf8')) {
  const files = invoke('diff', '--name-only', '--no-renames', '-z', base, '--').split('\0').filter(Boolean)
  const pinnedPackages = new Set()
  for (const file of ['dependency-snapshots.json', 'vendor/owner-artifacts.json', 'vendor/ui-libraries.json', 'package.json', 'package-lock.json']) {
    if (!files.includes(file)) continue
    const before = JSON.parse(invoke('show', `${base}:${file}`))
    const after = JSON.parse(read(file))
    for (const name of SYSTEM_OWNER_PACKAGES) {
      const identity = data => Array.isArray(data.packages)
        ? data.packages.find(row => row.name === name)
        : file === 'package-lock.json' ? data.packages?.[`node_modules/${name}`]
          : ['dependencies', 'devDependencies', 'optionalDependencies'].map(field => data[field]?.[name])
      if (JSON.stringify(identity(before)) !== JSON.stringify(identity(after))) pinnedPackages.add(name)
    }
  }
  if (files.some(file => file.startsWith('vendor/') && file.endsWith('.tgz'))) {
    const snapshot = JSON.parse(read('dependency-snapshots.json'))
    for (const row of snapshot.packages)
      if (SYSTEM_OWNER_PACKAGES.includes(row.name) && files.includes(`vendor/${row.asset}`)) pinnedPackages.add(row.name)
  }
  return { files, pinnedPackages: [...pinnedPackages] }
}

export function releaseCommands(plan, impact = { files: [], pinnedPackages: plan.pinnedPackages ?? [] }) {
  const owners = SYSTEM_OWNER_PACKAGES.filter(name => impact.pinnedPackages.includes(name) || impact.files.some(file => SYSTEM_PATH_PREFIXES[name].some(prefix => file.startsWith(prefix))))
  const performance = impact.pinnedPackages.includes('@sislexa/core-ui') || impact.files.some(file => PERFORMANCE_PATH_PREFIXES.some(prefix => file.startsWith(prefix)))
  const extra = []
  if (performance) extra.push(['npm', ['run', 'gate:performance']])
  if (owners.length) extra.push(['npm', ['run', 'gate:system', '--', '--owners', owners.map(name => repositories[name]).join(',')]])
  return { mode: plan.full || !plan.onlyPins ? 'full' : 'narrowed', extra, owners, performance }
}

export async function main(args = process.argv.slice(2), execute = run, plan = planFromDiff, adapters = {}) {
  const { base: production, reason } = (adapters.releaseBase ?? releaseBase)(args)
  if (!production) {
    console.log(`[release-gate] full: ${reason}`)
    for (const [command, commandArgs] of FULL_RELEASE_COMMANDS) execute(command, commandArgs)
    return { mode: 'full', reason }
  }
  const base = (adapters.verifiedBase ?? verifiedBase)(production)
  if (base !== production) console.log(`[release-gate] base: verified full gate ${base.slice(0, 12)} (production ${production.slice(0, 12)})`)
  const selected = await plan(['--base', base, '--dry-run'])
  const decision = releaseCommands(selected, (adapters.releaseImpact ?? releaseImpact)(base))
  console.log(`[release-gate] ${decision.mode} relative to base ${base.slice(0, 12)}: ${selected.reasons.join('; ')}`)
  if (decision.mode === 'full') {
    execute('npm', ['run', 'gate:all'])
  } else executeApplicationPlan({ ...selected, e2eFiles: (selected.e2eFiles ?? []).filter(file => !FRONTEND_E2E_FILES.includes(file)) }, execute, 'release')
  if (!decision.performance) console.log('[release-gate] performance: skipped (no rendering, Core UI pin, measurement or budget changes)')
  for (const [command, commandArgs] of decision.extra) execute(command, commandArgs)
  return { mode: decision.mode, reason: selected.reasons.join('; ') }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => { console.error(error.message); process.exitCode = error.exitCode || 1 })
