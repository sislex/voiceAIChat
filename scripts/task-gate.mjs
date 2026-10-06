// @ts-check
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { quickPlanCommands } from './quick-gate.mjs'
import { root } from './test-files.mjs'

export function taskPlan(files, repository = root) {
  if (files.every(file => file.startsWith('docs/') || /^[^/]+\.md$/.test(file)))
    return [{ command: 'npm', args: ['run', 'kb:check'] }]
  return quickPlanCommands({}, files, repository, { task: true })
}

export function changedFiles(base, repository = root, spawn = spawnSync) {
  const git = args => {
    const result = spawn('git', args, { cwd: repository, encoding: 'utf8' })
    if (result.error || result.status !== 0) throw result.error ?? Error(result.stderr || 'Cannot read task diff')
    return result.stdout
  }
  const baseline = git(['merge-base', 'HEAD', base]).trim()
  return [...new Set([
    ...git(['diff', '--name-only', '--no-renames', '-z', baseline, '--']).split('\0'),
    ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0')
  ].filter(Boolean))]
}

export function executeTask(steps, {
  repository = root, spawn = spawnSync, now = () => performance.now(), log = console.log,
  started = now(), maxTests = 100, maxSeconds = 60
} = {}) {
  let count = 0
  const timings = []
  const seconds = () => (now() - started) / 1000
  const breach = pending => {
    // Contract (docs/plans/dev-lane-v1.md «Общий контракт»): file names after GATE-TASK-SLOW, slowest first.
    log('GATE-TASK-SLOW:')
    for (const entry of [...timings].sort((a, b) => b.duration - a.duration)) log(entry.name)
    if (pending) log(pending)
    throw Object.assign(Error('Task budget exceeded (100 tests / 60 seconds)'), { exitCode: 2 })
  }
  try {
    for (const step of steps) {
      if (step.deferred) {
        log(`GATE-TASK-DEFERRED: ${step.deferred} direct importer file(s) left to the promotion gate`)
        continue
      }
      const label = step.files?.join(', ') ?? `${step.command} ${step.args.join(' ')}`
      if (seconds() >= maxSeconds) breach(label)
      let temporary
      try {
        let command = step.command, args = step.args, cwd = repository, report
        const env = { ...process.env }
        delete env.NODE_TEST_CONTEXT
        if (step.runner) {
          const directory = resolve(repository, 'artifacts/gate-task')
          mkdirSync(directory, { recursive: true })
          temporary = mkdtempSync(resolve(directory, 'run-'))
          report = resolve(temporary, 'results.json')
          cwd = resolve(repository, step.path)
          const files = step.files.map(file => relative(cwd, resolve(repository, file)))
          command = process.execPath
          args = step.runner === 'node'
            ? ['--import', 'tsx', '--test', '--test-concurrency=4', '--test-reporter', resolve(root, 'scripts/task-test-reporter.mjs'), ...files]
            : [resolve(repository, 'node_modules/vitest/vitest.mjs'),
                'run', ...files, '--maxWorkers=4', '--minWorkers=1', '--fileParallelism',
                '--passWithNoTests', '--reporter=default', '--reporter=json', `--outputFile.json=${report}`]
          env.GATE_TASK_REPORT = report
        }
        log(`[gate:task] ${command} ${args.join(' ')}`)
        const result = spawn(command, args, {
          cwd, env, stdio: 'inherit', timeout: Math.max(1, Math.ceil((maxSeconds - seconds()) * 1000)), killSignal: 'SIGKILL'
        })
        if (report && existsSync(report)) {
          const data = JSON.parse(readFileSync(report, 'utf8'))
          count += data.numTotalTests
          if (!Number.isFinite(count)) throw Error('Invalid test count in task report')
          for (const suite of data.testResults) for (const assertion of suite.assertionResults) {
            timings.push({ name: `${suite.name}: ${assertion.fullName}`, duration: assertion.duration ?? 0 })
            log(`GATE-TASK-CASE: ${suite.name}: ${assertion.fullName}`)
          }
        } else if (step.runner && !result.error && result.status === 0) throw Error('Missing task test report')
        if (count > maxTests || seconds() > maxSeconds ||
          (result.error && 'code' in result.error && result.error.code === 'ETIMEDOUT')) breach(label)
        if (result.error || result.status !== 0) throw result.error ?? Error(`Check exited ${result.status ?? result.signal}`)
      } finally {
        if (temporary) rmSync(temporary, { recursive: true, force: true })
      }
    }
  } finally {
    log(`GATE-TASK: tests=${count} seconds=${seconds().toFixed(3)}`)
  }
}

export function main(args = process.argv.slice(2)) {
  const started = performance.now()
  if (args.length !== 2 || args[0] !== '--base' || !args[1] || args[1].startsWith('-'))
    throw Error('Provide --base <sha>')
  let steps
  try { steps = taskPlan(changedFiles(args[1])) }
  catch (error) {
    console.log(`GATE-TASK: tests=0 seconds=${((performance.now() - started) / 1000).toFixed(3)}`)
    throw error
  }
  executeTask(steps, { started })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main() } catch (error) {
    console.error(error.message)
    process.exitCode = error.exitCode ?? 1
  }
}
