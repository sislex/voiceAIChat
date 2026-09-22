import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { planApplicationChecks, applicationPlanCommands, executeApplicationPlan, validateApplicationDependencies } from './application-gate.mjs'
import { validatePackageDependencies } from './affected-check.mjs'
const root = resolve(import.meta.dirname, '..')
validatePackageDependencies(root)
validateApplicationDependencies(root)
const scenarios = JSON.parse(readFileSync(resolve(root, 'scripts/gate-scenarios.json'), 'utf8'))
const args = process.argv.slice(2)
const runIndex = args.indexOf('--run')
const selected = runIndex < 0 ? scenarios : scenarios.filter(s => s.id === args[runIndex + 1])
if (!selected.length) throw Error('Unknown gate scenario')
const rows = selected.map(scenario => {
  if (scenario.id !== 'unknown') for (const file of scenario.files)
    if (!existsSync(resolve(root, file))) throw Error(`Stale audit scenario ${scenario.id}: ${file}`)
  const plan = planApplicationChecks(scenario.files)
  const commands = applicationPlanCommands(plan)
  return { ...scenario, full: plan.full, applications: plan.applications.map(app => app.id),
    e2eFiles: plan.e2eFiles, reasons: plan.reasons, commands,
    ...(runIndex < 0 ? {} : { timings: executeApplicationPlan(plan, undefined, 'audit-' + scenario.id) }) }
})
mkdirSync(resolve(root, 'artifacts/gate-timings'), { recursive: true })
writeFileSync(resolve(root, 'artifacts/gate-timings/audit.json'), JSON.stringify(rows, null, 2))
console.log(JSON.stringify(rows, null, 2))
