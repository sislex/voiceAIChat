import { spawnSync } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// These suites use separate ephemeral ports, databases and browser contexts.
// New suites stay serial until their isolation has been reviewed.
const parallelFiles = new Set([
  'sessions', 'projects', 'gitPane', 'universalSearch',
  'webReaderOwnProject', 'webReaderProject', 'toolIntegration'
].map(name => `e2e/${name}.e2e.test.ts`))

export function integrationBrowserFiles(root = resolve(import.meta.dirname, '..')) {
  return readdirSync(resolve(root, 'e2e')).filter(file => file.endsWith('.e2e.test.ts') && file !== 'routeBudgets.e2e.test.ts').sort().map(file => 'e2e/' + file)
}

export function browserWorkers(value, cpus = availableParallelism()) {
  if (value !== undefined && !['1', '2'].includes(String(value))) throw Error('VC_E2E_WORKERS must be 1 or 2')
  return value === undefined ? (cpus >= 4 ? 2 : 1) : Number(value)
}

export function browserBatches(files, workers = browserWorkers(process.env.VC_E2E_WORKERS)) {
  const unique = [...new Set(files)]
  if (!unique.length || unique.some(file => !/^e2e\/[\w.-]+\.e2e\.test\.ts$/.test(file))) throw Error('Expected explicit browser suite paths')
  if (![1, 2].includes(workers)) throw Error('Invalid browser worker count')
  // Timing measurements and native Electron input never overlap another suite.
  const serial = unique.filter(file => !parallelFiles.has(file))
  const parallel = unique.filter(file => parallelFiles.has(file))
  return [
    ...serial.map(file => ({ files: [file], workers: 1 })),
    ...(parallel.length ? [{ files: parallel, workers: Math.min(workers, parallel.length) }] : [])
  ]
}

export function browserArgs(batch) {
  return ['exec', '--', 'vitest', 'run', '--config', 'e2e/vitest.config.ts',
    batch.workers === 1 ? '--no-file-parallelism' : '--fileParallelism',
    `--minWorkers=${batch.workers}`, `--maxWorkers=${batch.workers}`, ...batch.files]
}

export function runBrowserBatches(batches, execute, record = () => {}) {
  const results = []
  for (const batch of batches) {
    const started = performance.now()
    const result = execute('npm', browserArgs(batch))
    const row = { ...batch, seconds: Number(((performance.now() - started) / 1000).toFixed(2)), exitCode: result.status ?? 1 }
    results.push(row); record(results)
    console.log(`[gate:browser] ${batch.files.join(', ')}: ${row.seconds}s, ${batch.workers} worker(s), exit ${row.exitCode}`)
    if (result.error || row.exitCode) throw Object.assign(result.error ?? Error('Browser gate failed'), { exitCode: row.exitCode || 1 })
  }
  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const root = resolve(import.meta.dirname, '..')
    const args = process.argv.slice(2)
    const files = args.length === 1 && args[0] === '--integration' ? integrationBrowserFiles(root) : args
    const batches = browserBatches(files)
    for (const file of files) if (!existsSync(resolve(root, file))) throw Error(`Missing browser suite: ${file}`)
    const directory = resolve(root, 'artifacts/gate-timings'); mkdirSync(directory, { recursive: true })
    const startedAt = new Date().toISOString()
    runBrowserBatches(batches, (command, args) => spawnSync(command, args, { cwd: root, stdio: 'inherit' }), results => {
      writeFileSync(resolve(directory, 'browser.json'), JSON.stringify({ startedAt, results }, null, 2))
    })
  } catch (error) { console.error(error.message); process.exitCode = error.exitCode || 1 }
}
