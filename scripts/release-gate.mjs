// Release regression: the checks of the diff between the production commit and the
// candidate. A proven owner-archive replacement runs its narrowed plan; changes to Core,
// shared configuration, unknown files or an unknown production commit run the full
// release gate (gate:all, gate:performance, gate:system) exactly as before.
import { execFileSync, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { executeApplicationPlan, main as planFromDiff } from './application-gate.mjs'

const root = resolve(import.meta.dirname, '..')
/** Owner archives whose repositories carry the system suites of `gate:system`. */
export const SYSTEM_OWNER_PACKAGES = Object.freeze(['@sislexa/core-ui', '@sislexa/web-reader', '@sislexa/playwright-reader'])
export const FULL_RELEASE_COMMANDS = Object.freeze([['npm', ['run', 'gate:all']], ['npm', ['run', 'gate:performance']], ['npm', ['run', 'gate:system']]])

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const error = new Error(`${command} ${args.join(' ')} failed: ${result.status ?? result.signal}`)
    error.exitCode = result.status || 1
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

export function releaseCommands(plan) {
  // Core, shared configuration or any other source change keeps the full release chain.
  if (plan.full || !plan.onlyPins) return { mode: 'full', extra: [] }
  const system = (plan.pinnedPackages ?? []).some((name) => SYSTEM_OWNER_PACKAGES.includes(name))
  return { mode: 'narrowed', extra: system ? [['npm', ['run', 'gate:system']]] : [] }
}

export async function main(args = process.argv.slice(2), execute = run, plan = planFromDiff) {
  const { base, reason } = releaseBase(args)
  if (!base) {
    console.log(`[release-gate] full: ${reason}`)
    for (const [command, commandArgs] of FULL_RELEASE_COMMANDS) execute(command, commandArgs)
    return { mode: 'full', reason }
  }
  const selected = await plan(['--base', base, '--dry-run'])
  const decision = releaseCommands(selected)
  console.log(`[release-gate] ${decision.mode} relative to production ${base.slice(0, 12)}: ${selected.reasons.join('; ')}`)
  if (decision.mode === 'full') {
    for (const [command, commandArgs] of FULL_RELEASE_COMMANDS) execute(command, commandArgs)
    return { mode: 'full', reason: selected.reasons.join('; ') }
  }
  executeApplicationPlan(selected, execute, 'release')
  for (const [command, commandArgs] of decision.extra) execute(command, commandArgs)
  return { mode: 'narrowed', reason: selected.reasons.join('; ') }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => { console.error(error.message); process.exitCode = error.exitCode || 1 })
