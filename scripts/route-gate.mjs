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
    const report = await measure({ web: 'apps/web/dist', desktop: dirname(require.resolve('@sislexa/desktop/renderer/index.html')), output })
    const budget = JSON.parse(readFileSync('frontend-quality/route-budgets.json', 'utf8'))
    const budgetDiff = checkRoutes(budget, report)
    const baseline = selectRouteBaseline([
      'frontend-quality/measurements/CHAT-473/before.json',
      'frontend-quality/measurements/sislexa-extraction/after.json',
      'frontend-quality/measurements/chat-accounting-runtime/before.json'
    ].map(path => ({ path, report: JSON.parse(readFileSync(path, 'utf8')) })), report)
    const comparison = compareRoutes(baseline.report, report)
    writeFileSync(resolve(output, 'diff.json'), JSON.stringify({ baseline: baseline.path, budgetDiff, comparison }, null, 2))
    console.table(budgetDiff.map(({ resources, ...row }) => row))
    console.table(comparison)
  } catch (error) { console.error(error); process.exitCode = 1 }
}
