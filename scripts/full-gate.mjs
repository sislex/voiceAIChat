import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isTest, repositoryFile } from './test-files.mjs'

const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'"

export function toolingCommand(root, report) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  // Preserve the manifest's command chain, including its short-circuit semantics.
  let script = manifest.scripts['test:tooling'].replace(/npm test --prefix ([\w./-]+)/g, (_match, path) => {
    const child = JSON.parse(readFileSync(resolve(root, path, 'package.json'), 'utf8'))
    return `(cd ${shellQuote(path)} && ${child.scripts.test})`
  })
  // The tooling chain also delegates node tests through named scripts (gate:a07).
  script = script.replace(/npm run ([\w:-]+)/g, (match, name) => {
    const command = manifest.scripts[name]
    return command?.startsWith('node ') && /\s--test\s/.test(command) ? `(${command})` : match
  })
  let index = 0
  return script.replace(/\bnode\s+([^&;]*?--test)(?=\s)/g, (_match, args) =>
    `GATE_TEST_REPORT=${shellQuote(`${report}.${index++}.json`)} node ${args} --test-reporter ${shellQuote(resolve(root, 'scripts/test-failure-reporter.mjs'))}`)
}

export function collectTestReports(directory, repository) {
  const failed = new Set()
  for (const file of readdirSync(directory).filter(file => file.endsWith('.json')).sort()) {
    // Killed runners can leave incomplete reports; keep their original exit status.
    try {
      const data = JSON.parse(readFileSync(resolve(directory, file), 'utf8'))
      const files = Array.isArray(data) ? data : (data.testResults ?? []).filter(suite => suite.status === 'failed').map(suite => suite.name)
      for (const file of files) {
        try {
          const normalized = repositoryFile(file, repository)
          if (isTest(normalized)) failed.add(normalized)
        } catch { /* Ignore paths outside the repository. */ }
      }
    } catch { /* An unreadable report cannot identify failed files. */ }
  }
  return [...failed]
}

export async function runReportedTask(name, args, { root = resolve(import.meta.dirname, '..'), execute = spawnBuffered } = {}) {
  const directory = resolve(root, 'artifacts/gate-timings')
  mkdirSync(directory, { recursive: true })
  const temporary = mkdtempSync(resolve(directory, 'reports-'))
  const report = resolve(temporary, 'results.json')
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, GATE_TEST_REPORT: report, GATE_REPOSITORY_ROOT: root }
  delete env.NODE_TEST_CONTEXT
  try {
    let command = 'npm', commandArgs = args
    if (name === 'tooling') {
      command = 'sh'
      commandArgs = ['-c', toolingCommand(root, report)]
    } else if (args.includes('-w') || name === 'frontend-browser') {
      commandArgs = [...args, ...(args.includes('-w') ? ['--'] : []), '--reporter=default', '--reporter=json', `--outputFile.json=${report}`]
    }
    let result
    try { result = await execute(command, commandArgs, { cwd: root, env }) }
    catch (error) { result = { status: error.exitCode || 1, error, output: error.output } }
    return { ...result, failedTests: collectTestReports(temporary, root) }
  } finally { rmSync(temporary, { recursive: true, force: true }) }
}

export function reportFullGateFailure(error, log = console.log) {
  log(`GATE-FAILED-STAGE: ${error.stage ?? 'setup'}`)
  log(`GATE-FAILED-TESTS: ${JSON.stringify(error.failedTests ?? [])}`)
}

export const FRONTEND_E2E_FILES = Object.freeze([
  'e2e/routeBudgets.e2e.test.ts'
])
/** @type {ReadonlyArray<[string, string[]]>} */
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
        results[index] = { name: task.name, seconds: Number(((performance.now() - started) / 1000).toFixed(2)), exitCode: result.status ?? 1, output: result.output ?? '', error: result.error, failedTests: result.failedTests ?? [] }
      } catch (error) {
        results[index] = { name: task.name, seconds: Number(((performance.now() - started) / 1000).toFixed(2)), exitCode: error.exitCode || 1, output: error.output ?? '', error, failedTests: error.failedTests ?? [] }
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
      results,
      failedTests: [...new Set(results.flatMap(result => result.failedTests))]
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
    if (result.error || row.exitCode !== 0) throw Object.assign(result.error ?? new Error(`Gate stage failed: ${name}`), { exitCode: row.exitCode || 1, stage: name, failedTests: result.failedTests ?? [] })
  }
  return results
}
export async function main({ root = resolve(import.meta.dirname, '..'), routes = process.argv.includes('--routes'), execute = undefined } = {}) {
  let stage = 'setup'
  const failedTests = new Set()
  try {
    /** @type {ReadonlyArray<[string, string[]]>} */
    const stages = routes ? [['frontend-browser', ['exec', '--', 'vitest', 'run', '--config', 'e2e/vitest.config.ts', '--no-file-parallelism', ...FRONTEND_E2E_FILES]]] : FULL_GATE_STAGES
    const output = resolve(root, 'artifacts/gate-timings')
    mkdirSync(output, { recursive: true })
    const startedAt = new Date().toISOString()
    const results = []
    for (const [name, args] of stages) {
      stage = name
      if (name === 'tests' && !routes) {
        const started = performance.now()
        let workspaceResults
        try {
          workspaceResults = await runTestTasks(testTasks(root), (_command, taskArgs) => runReportedTask(taskArgs.includes('test:tooling') ? 'tooling' : 'workspace', taskArgs, { root, execute }), { concurrency: testConcurrency() })
        } catch (error) {
          workspaceResults = error.results ?? []
          results.push(...workspaceResults.map(row => ({ ...row, name: `tests/${row.name}`, output: undefined, error: undefined })))
          results.push({ name, seconds: Number(((performance.now() - started) / 1000).toFixed(2)), exitCode: error.exitCode || 1 })
          console.log(`[gate:timing] tests: ${results.at(-1).seconds}s (exit ${results.at(-1).exitCode})`)
          writeFileSync(resolve(output, 'full.json'), JSON.stringify({ startedAt, results }, null, 2))
          throw error
        }
        workspaceResults.flatMap(row => row.failedTests).forEach(file => failedTests.add(file))
        results.push(...workspaceResults.map(row => ({ ...row, name: `tests/${row.name}`, output: undefined, error: undefined })))
        results.push({ name, seconds: Number(((performance.now() - started) / 1000).toFixed(2)), exitCode: 0 })
        console.log(`[gate:timing] tests: ${results.at(-1).seconds}s (exit 0)`)
      } else {
        const result = await runReportedTask(name, args, { root, execute: execute ?? (async (command, stageArgs, options) => {
          const { status, error } = spawnSync(command, stageArgs, { ...options, stdio: 'inherit' })
          return { status, error }
        }) })
        result.failedTests.forEach(file => failedTests.add(file))
        if (result.output) console.log(result.output.replace(/\s+$/, ''))
        const rows = runStages([[name, args]], () => result)
        results.push(...rows)
      }
      writeFileSync(resolve(output, routes ? 'frontend.json' : 'full.json'), JSON.stringify({ startedAt, results }, null, 2))
    }
  } catch (error) {
    throw Object.assign(error, { stage, failedTests: [...new Set([...failedTests, ...(error.failedTests ?? [])])] })
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await main() }
  catch (error) {
    console.error(error.message)
    reportFullGateFailure(error)
    process.exitCode = error.exitCode || 1
  }
}
