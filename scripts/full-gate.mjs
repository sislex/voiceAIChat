import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const FRONTEND_E2E_FILES = Object.freeze([
  'e2e/routeBudgets.e2e.test.ts'
])
export const FULL_GATE_STAGES = Object.freeze([
  ['typecheck', ['run', 'typecheck']],
  ['tests', ['run', 'test']],
  ['frontends', ['run', 'build:frontends']],
  ['core-ui-artifact', ['run', 'verify:core-ui']],
  ['browser-integration', ['run', 'test:browser']]
])
export function testTasks(root) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  return [
    { name: 'tooling', args: ['run', 'test:tooling'] },
    ...manifest.workspaces.flatMap(path => {
      const workspace = JSON.parse(readFileSync(resolve(root, path, 'package.json'), 'utf8'))
      return workspace.scripts?.test ? [{ name: workspace.name, args: ['run', 'test', '-w', workspace.name] }] : []
    })
  ]
}
export function testConcurrency(value = process.env.VC_GATE_TEST_CONCURRENCY) {
  if (value === undefined || value === '') return 3
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`VC_GATE_TEST_CONCURRENCY must be a positive integer, received: ${value}`)
  return parsed
}
export async function runTestTasks(tasks, execute, { concurrency = 3, log = console.log } = {}) {
  const results = new Array(tasks.length)
  let next = 0
  async function worker() {
    while (next < tasks.length) {
      const index = next++
      const task = tasks[index]
      const started = performance.now()
      try {
        const result = await execute('npm', task.args)
        results[index] = { name: task.name, seconds: Number(((performance.now() - started) / 1000).toFixed(2)), exitCode: result.status ?? 1, output: result.output ?? '', error: result.error }
      } catch (error) {
        results[index] = { name: task.name, seconds: Number(((performance.now() - started) / 1000).toFixed(2)), exitCode: error.exitCode || 1, output: error.output ?? '', error }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
  for (const result of results) {
    log(`[gate:tests] ${result.name}`)
    if (result.output) log(result.output.replace(/\s+$/, ''))
    log(`[gate:timing] tests/${result.name}: ${result.seconds}s (exit ${result.exitCode})`)
  }
  const failed = results.filter(result => result.error || result.exitCode !== 0)
  if (failed.length) {
    const error = Object.assign(new Error(`Test workspaces failed: ${failed.map(result => result.name).join(', ')}`), {
      exitCode: failed.find(result => result.exitCode)?.exitCode || 1,
      results
    })
    throw error
  }
  return results
}
export function spawnBuffered(command, args, options) {
  return new Promise(resolveResult => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    /** @type {Buffer[]} */
    const chunks = []
    child.stdout.on('data', chunk => chunks.push(chunk))
    child.stderr.on('data', chunk => chunks.push(chunk))
    child.on('error', error => resolveResult({ status: 1, error, output: Buffer.concat(chunks).toString() }))
    child.on('close', status => resolveResult({ status, output: Buffer.concat(chunks).toString() }))
  })
}
export function remainingBrowserFiles(files, fullGatePassed) {
  return [...new Set(files)].filter(file => !fullGatePassed || FRONTEND_E2E_FILES.includes(file))
}
export function runStages(stages, execute, record = (_results) => {}) {
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
    const results = []
    for (const [name, args] of stages) {
      if (name === 'tests' && !routes) {
        const started = performance.now()
        let workspaceResults
        try {
          workspaceResults = await runTestTasks(testTasks(root), (command, taskArgs) => spawnBuffered(command, taskArgs, { cwd: root }), { concurrency: testConcurrency() })
        } catch (error) {
          workspaceResults = error.results ?? []
          results.push(...workspaceResults.map(row => ({ ...row, name: `tests/${row.name}`, output: undefined, error: undefined })))
          results.push({ name, seconds: Number(((performance.now() - started) / 1000).toFixed(2)), exitCode: error.exitCode || 1 })
          console.log(`[gate:timing] tests: ${results.at(-1).seconds}s (exit ${results.at(-1).exitCode})`)
          writeFileSync(resolve(output, 'full.json'), JSON.stringify({ startedAt, results }, null, 2))
          throw error
        }
        results.push(...workspaceResults.map(row => ({ ...row, name: `tests/${row.name}`, output: undefined, error: undefined })))
        results.push({ name, seconds: Number(((performance.now() - started) / 1000).toFixed(2)), exitCode: 0 })
        console.log(`[gate:timing] tests: ${results.at(-1).seconds}s (exit 0)`)
      } else {
        const rows = runStages([[name, args]], (command, stageArgs) => spawnSync(command, stageArgs, { cwd: root, stdio: 'inherit' }))
        results.push(...rows)
      }
      writeFileSync(resolve(output, routes ? 'frontend.json' : 'full.json'), JSON.stringify({ startedAt, results }, null, 2))
    }
  } catch (error) { console.error(error.message); process.exitCode = error.exitCode || 1 }
}
