import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { main as applicationMain, OWNER_PIN_TESTS } from './application-gate.mjs'
import { root, workspaceEntries, isTest, mapTestFiles, runTests, reportFailure } from './test-files.mjs'

function walk(path) {
  if (!existsSync(path)) return []
  if (statSync(path).isFile()) return [path]
  return readdirSync(path).filter(name => !['node_modules', 'dist', '.git'].includes(name))
    .flatMap(name => walk(resolve(path, name)))
}
export function relatedTooling(files, repository = root) {
  const changed = new Set(files.map(file => resolve(repository, file)))
  function touches(file, seen = new Set()) {
    if (changed.has(file)) return true
    if (seen.has(file) || !existsSync(file) || !statSync(file).isFile()) return false
    seen.add(file)
    const source = readFileSync(file, 'utf8')
    return [...source.matchAll(/(?:from\s*|import\s*\(|import\s*|require\s*\()\s*['"]([^'"]+)['"]/g)]
      .filter(match => match[1].startsWith('.'))
      .some(match => {
        const target = resolve(dirname(file), match[1])
        return [target, target + '.mjs', target + '.ts', target.replace(/\.js$/, '.ts')]
          .some(candidate => touches(candidate, seen))
      })
  }
  return walk(resolve(repository, 'scripts')).filter(file => isTest(file) && touches(file))
    .map(file => relative(repository, file))
}
export function quickPlanCommands(plan, files, repository = root, { task = false } = {}) {
  // Configuration cannot be narrowed by the source import graph.
  if (!task && (plan.full || files.some(file => /(^|\/)(package(?:-lock)?\.json|tsconfig[^/]*\.json|vitest[^/]*\.[cm]?[jt]s|vite\.config\.[cm]?[jt]s)$/.test(file))))
    return [{ command: 'npm', args: ['run', 'gate:all'] }]
  const workspaces = workspaceEntries(repository), steps = [], tests = new Set()
  const selected = new Set(task
    ? workspaces.filter(workspace => files.some(file => file.startsWith(workspace.path + '/'))).map(workspace => workspace.name)
    : plan.applications.flatMap(app => app.workspaces))
  for (const check of task ? [] : plan.contracts) selected.add(check.workspace)
  for (const name of selected) {
    const workspace = workspaces.find(item => item.name === name)
    if (!workspace) throw Error(`Missing workspace: ${name}`)
    if (!workspace.scripts?.typecheck) throw Error(`Missing typecheck: ${name}`)
    for (const script of ['typecheck', ...(!task && workspace.scripts.build ? ['build'] : [])])
      steps.push({ command: 'npm', args: ['run', '-w', name, script] })
    const changed = files.filter(file => file.startsWith(workspace.path + '/'))
    for (const file of changed.filter(isTest)) if (existsSync(resolve(repository, file))) tests.add(file)
    const sources = changed.filter(file => !isTest(file) && /\.[cm]?[jt]sx?$/.test(file))
    if (task && sources.length) {
      for (const file of changed.filter(isTest)) if (tests.delete(file)) sources.push(file)
    }
    if (sources.length) steps.push({ path: workspace.path, runner: 'vitest', related: true, files: sources })
  }
  for (const check of task ? [] : plan.contracts) {
    const workspace = workspaces.find(item => item.name === check.workspace)
    for (const path of check.files.length ? check.files : ['src']) {
      const absolute = resolve(repository, workspace.path, path)
      if (!existsSync(absolute)) throw Error(`Missing contract suite: ${absolute}`)
      for (const file of walk(absolute).filter(isTest)) tests.add(relative(repository, file))
    }
  }
  if (task || plan.tooling) for (const file of relatedTooling(files, repository)) tests.add(file)
  if (!task && plan.pinChecks) for (const file of OWNER_PIN_TESTS) tests.add(file)
  for (const file of task ? [] : plan.e2eFiles ?? []) tests.add(file)
  if (!task && plan.verifyArtifacts) steps.push({ command: 'npm', args: ['run', 'verify:core-ui'] })
  if (tests.size) steps.push(...mapTestFiles([...tests], repository))
  return steps
}
export function executeQuickPlan(steps) {
  for (const step of steps) {
    if (step.runner) runTests(step)
    else {
      console.log(`[gate:quick] ${step.command} ${step.args.join(' ')}`)
      const result = spawnSync(step.command, step.args, { cwd: root, stdio: 'inherit' })
      if (result.error || result.status !== 0)
        throw Object.assign(result.error ?? Error(`Check exited ${result.status ?? result.signal}`), { exitCode: result.status || 1 })
    }
  }
}
export async function main(args = process.argv.slice(2)) {
  let base
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--dry-run') continue
    if (args[index] !== '--base' || base) throw Error(`Unknown argument: ${args[index]}`)
    base = args[++index]
    if (!base || base.startsWith('-')) throw Error('Provide --base <sha>')
  }
  if (!base) throw Error('Provide --base <sha>')
  const dry = args.includes('--dry-run')
  return applicationMain(args.filter(arg => arg !== '--dry-run'), {
    execute(plan, files) {
      const steps = quickPlanCommands(plan, files)
      console.log(JSON.stringify(steps, null, 2))
      if (!dry) executeQuickPlan(steps)
    }
  })
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(reportFailure)
