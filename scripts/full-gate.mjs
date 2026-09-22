import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const FRONTEND_E2E_FILES = Object.freeze([
  'e2e/routeBudgets.e2e.test.ts',
  'e2e/lazyBoundary.e2e.test.ts',
  'e2e/applicationFrontend.e2e.test.ts'
])
export const FULL_GATE_STAGES = Object.freeze([
  ['typecheck', ['run', 'typecheck']],
  ['tests', ['run', 'test']],
  ['frontends', ['run', 'build:frontends']],
  ['chat-renderer', ['run', 'build:chat-client']],
  ['web', ['run', '-w', '@voicechat/web', 'build']],
  ['storybook', ['run', 'build:storybook']],
  ['frontend-browser', ['run', 'frontend:route-gates']]
])
export function remainingBrowserFiles(files, fullGatePassed) {
  return [...new Set(files)].filter(file => !fullGatePassed || !FRONTEND_E2E_FILES.includes(file))
}
export function runStages(stages, execute, record = () => {}) {
  const results = []
  for (const [name, args] of stages) {
    const started = performance.now()
    const result = execute('npm', args)
    const row = { name, seconds: Number(((performance.now() - started) / 1000).toFixed(2)), exitCode: result.status ?? 1 }
    results.push(row)
    record(results)
    console.log(`[gate:timing] ${name}: ${row.seconds}s (exit ${row.exitCode})`)
    if (result.error || row.exitCode !== 0) throw Object.assign(result.error ?? new Error(`Gate stage failed: ${name}`), { exitCode: row.exitCode || 1 })
  }
  return results
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const root = resolve(import.meta.dirname, '..')
  try {
    const routes = process.argv.includes('--routes')
    const stages = routes ? [['frontend-browser', ['exec', '--', 'vitest', 'run', '--config', 'e2e/vitest.config.ts', '--no-file-parallelism', ...FRONTEND_E2E_FILES]]] : FULL_GATE_STAGES
    const output = resolve(root, 'artifacts/gate-timings')
    mkdirSync(output, { recursive: true })
    const startedAt = new Date().toISOString()
    runStages(stages, (command, args) => spawnSync(command, args, { cwd: root, stdio: 'inherit' }), results => {
      writeFileSync(resolve(output, routes ? 'frontend.json' : 'full.json'), JSON.stringify({ startedAt, results }, null, 2))
    })
  } catch (error) { console.error(error.message); process.exitCode = error.exitCode || 1 }
}
