import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
import { measure } from './measure-routes.mjs'
import { checkRoutes, compareRoutes, selectRouteBaseline } from './route-budgets.mjs'
if (process.platform === 'linux' && !process.env.DISPLAY) {
  const run = spawnSync('xvfb-run', ['-a', process.execPath, ...process.argv.slice(1)], { stdio: 'inherit' })
  if (run.error) console.error(run.error.message)
  process.exitCode = run.status ?? 1
} else {
  try {
    const output = resolve('artifacts/route-budgets')
    // Electron application checks are temporarily opt-in. Keep measuring the
    // complete Web route budget on every release.
    const clients = process.env.VC_ELECTRON_TESTS === '1' ? ['web', 'electron'] : ['web']
    const report = await measure({ web: 'node_modules/@sislexa/core-ui/web', desktop: dirname(require.resolve('@sislexa/core-ui/renderer/index.html')), output, clients })
    const allBudget = JSON.parse(readFileSync('frontend-quality/route-budgets.json', 'utf8'))
    const selected = ([route]) => clients.some(client => route.startsWith(client + '/'))
    const budget = { ...allBudget, routes: Object.fromEntries(Object.entries(allBudget.routes).filter(selected)), forbiddenInitial: Object.fromEntries(Object.entries(allBudget.forbiddenInitial ?? {}).filter(selected)) }
    const budgetDiff = checkRoutes(budget, report, clients)
    if (!clients.includes('electron')) {
      writeFileSync(resolve(output, 'diff.json'), JSON.stringify({ baseline: null, budgetDiff, comparison: null, skipped: ['electron', 'cross-client-baseline'] }, null, 2))
      console.log('[route-gate] Electron application measurement skipped; Web budgets enforced')
      console.table(budgetDiff.map(({ resources, ...row }) => row))
      process.exit(0)
    }
    const baseline = selectRouteBaseline([
      'frontend-quality/measurements/CHAT-473/before.json',
      'frontend-quality/measurements/sislexa-extraction/after.json',
      'frontend-quality/measurements/component-qa-chat-sync/before.json',
      'frontend-quality/measurements/chat-495-macbook-m1/after.json'
    ].map(path => ({ path, report: JSON.parse(readFileSync(path, 'utf8')) })), report)
    const comparison = compareRoutes(baseline.report, report)
    writeFileSync(resolve(output, 'diff.json'), JSON.stringify({ baseline: baseline.path, budgetDiff, comparison }, null, 2))
    console.table(budgetDiff.map(({ resources, ...row }) => row))
    console.table(comparison)
  } catch (error) { console.error(error); process.exitCode = 1 }
}
