// Выбирает проверки по владельцу кода; контрактная связь не равна импорту реализации.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  APPLICATION_CATALOG,
  applicationForPath,
  validateApplicationCatalog
} from '../packages/shared/src/applicationCatalog.ts'
import { FRONTEND_E2E_FILES, remainingBrowserFiles } from './full-gate.mjs'
import { PACKAGES, selectAffected, validatePackageDependencies } from './affected-check.mjs'
const root = resolve(import.meta.dirname, '..')
const git = (...args) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  })
const matches = (file, path) => file === path || file.startsWith(path + '/')
const docs = (file) =>
  /^(docs|plans|artifacts|generated\/kb)\//.test(file) ||
  /(^|\/)(AGENTS|CLAUDE|README)\.md$/.test(file)

export function validateApplicationDependencies(repository = root, catalog = APPLICATION_CATALOG) {
  validateApplicationCatalog(catalog)
  const lock = JSON.parse(readFileSync(resolve(repository, 'package-lock.json'), 'utf8'))
  const workspaces = new Map()
  for (const path of Object.keys(lock.packages)) {
    if (!/^(apps|packages)\//.test(path) || path.includes('/node_modules/')) continue
    const manifestPath = resolve(repository, path, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const owner = applicationForPath(path, catalog)
    if (!owner || !owner.workspaces.includes(manifest.name)) {
      throw new Error(`No application owns workspace ${manifest.name}: ${path}`)
    }
    workspaces.set(manifest.name, { manifest, owner })
  }
  for (const app of catalog) {
    for (const name of app.workspaces) {
      const workspace = workspaces.get(name)
      if (!workspace) throw new Error(`Missing workspace ${name} for ${app.id}`)
      const { manifest } = workspace
      for (const dependency of Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.peerDependencies,
        ...manifest.optionalDependencies
      })) {
        const owner = workspaces.get(dependency)?.owner
        if (owner && owner.id !== app.id && !app.buildDependencies.includes(owner.id)) {
          throw new Error(`Missing build dependency in application catalog: ${app.id} -> ${owner.id}`)
        }
      }
    }
  }
}

export function lockChangedApplications(
  before,
  after,
  catalog = APPLICATION_CATALOG
) {
  if (
    !before?.packages ||
    !after?.packages ||
    before.lockfileVersion !== after.lockfileVersion
  )
    return null
  const changed = new Set(
    Object.keys({ ...before.packages, ...after.packages }).filter(
      (key) =>
        JSON.stringify(before.packages[key]) !==
        JSON.stringify(after.packages[key])
    )
  )
  if (changed.has('')) return null
  const owners = new Set(),
    visited = new Set()
  // Дерево зависимостей читается с обеих сторон: удалённая зависимость тоже влияет.
  for (const lock of [before, after])
    for (const app of catalog) {
      const seen = new Set(),
        queue = app.paths.filter((path) => lock.packages[path])
      while (queue.length) {
        const key = queue.shift()
        if (seen.has(key)) continue
        seen.add(key)
        visited.add(key)
        if (changed.has(key)) owners.add(app.id)
        const entry = lock.packages[key]
        if (entry?.link && entry.resolved) queue.push(entry.resolved)
        for (const name of Object.keys({
          ...entry?.dependencies,
          ...entry?.optionalDependencies,
          ...entry?.devDependencies,
          ...entry?.peerDependencies
        })) {
          let directory = key,
            found
          while (true) {
            const candidate =
              (directory ? directory + '/' : '') + 'node_modules/' + name
            if (lock.packages[candidate]) {
              found = candidate
              break
            }
            if (!directory) break
            directory = directory.includes('/')
              ? directory.slice(0, directory.lastIndexOf('/'))
              : ''
          }
          if (found) queue.push(found)
        }
      }
    }
  // Неразрешимый lock diff нельзя объявлять безопасным.
  if ([...changed].some((key) => !visited.has(key))) return null
  return [...owners]
}
export function planApplicationChecks(
  files,
  { catalog = APPLICATION_CATALOG, lockBefore, lockAfter } = {}
) {
  validateApplicationCatalog(catalog)
  const selected = new Map(),
    contracts = new Map(),
    reasons = [],
    e2eFiles = new Set()
  let tooling = false, verifyArtifacts = false
  const browserSuites = new Set([...FRONTEND_E2E_FILES, ...catalog.flatMap(app => app.e2eFiles)])
  const performancePath = file => FRONTEND_E2E_FILES.includes(file) ||
    /^frontend-quality\/(?:route-budgets\.json|measurements\/.*\.json)$/.test(file) ||
    ['scripts/measure-routes.mjs', 'scripts/route-gate.mjs', 'scripts/route-budgets.mjs', 'scripts/route-compression.mjs'].includes(file)
  const explicitPerformance = files.some(performancePath)
  const full = (reason) => ({
    full: true,
    reasons: [reason],
    applications: [],
    contracts: [],
    e2eFiles: [...new Set([...catalog.flatMap((app) => app.e2eFiles), ...(explicitPerformance ? FRONTEND_E2E_FILES : [])])]
  })
  const add = (app, reason) => {
    selected.set(app.id, app)
    reasons.push(`${app.id}: ${reason}`)
  }
  const legacy = (file) => {
    const decision = selectAffected([file])
    if (decision.full) return false
    for (const pkg of decision.packages) {
      const owner =
        catalog.find((app) => app.workspaces.includes(pkg.workspace)) ??
        catalog.find((app) => app.paths.includes(pkg.path))
      if (!owner) return false
      add(owner, `общая граница ${file}`)
    }
    return true
  }
  const publicConsumers = (app, reason) => {
    for (const check of app.contractChecks)
      contracts.set(JSON.stringify(check), check)
    // Библиотека входит в артефакт потребителя: изменение требует его проверки.
    if (app.kind === 'library') {
      const queue = [app.id],
        seen = new Set(queue)
      while (queue.length) {
        const id = queue.shift()
        for (const consumer of catalog)
          if (
            consumer.buildDependencies.includes(id) &&
            !seen.has(consumer.id)
          ) {
            seen.add(consumer.id)
            add(consumer, reason)
            if (!consumer.isolation.tests) queue.push(consumer.id)
            for (const check of consumer.contractChecks)
              contracts.set(JSON.stringify(check), check)
          }
      }
    }
  }
  for (const file of files) {
    if (docs(file)) continue
    if (browserSuites.has(file)) {
      e2eFiles.add(file)
      reasons.push(`Browser suite: ${file}`)
      continue
    }
    if (file === 'e2e/vitest.config.ts') {
      for (const suite of browserSuites) e2eFiles.add(suite)
      tooling = true
      reasons.push('Browser configuration: all browser suites, no application unit suites')
      continue
    }
    if (performancePath(file)) {
      for (const suite of FRONTEND_E2E_FILES) e2eFiles.add(suite)
      tooling = true
      reasons.push('Route budgets: real Web/Desktop measurement')
      continue
    }
    // Narrow only explicitly reviewed tooling. Gate/build/deploy changes and
    // unknown scripts still exercise the full application fallback.
    if (/^scripts\/(?:long-run|core-ui-artifact|route-budgets|route-compression)(?:\.test)?\.mjs$/.test(file)) {
      tooling = true
      if (file === 'scripts/core-ui-artifact.mjs') verifyArtifacts = true
      if (['scripts/route-budgets.mjs', 'scripts/route-compression.mjs'].includes(file))
        for (const suite of FRONTEND_E2E_FILES) e2eFiles.add(suite)
      reasons.push(`Tooling regression suite: ${file}`)
      continue
    }
    if (file === 'package-lock.json') {
      const affected = lockChangedApplications(lockBefore, lockAfter, catalog)
      if (affected === null)
        return full('Не удалось доказать область изменения lock-файла')
      for (const id of affected) {
        const app = catalog.find((item) => item.id === id)
        add(app, 'изменение зависимостей lock-файла')
        publicConsumers(app, 'зависимость из lock-файла')
      }
      continue
    }
    const app = applicationForPath(file, catalog)
    if (!app) {
      return full(`Неопределённая область влияния: ${file}`)
    }
    add(app, file)
    if (app.browserPaths.some((path) => matches(file, path)))
      for (const test of app.e2eFiles) e2eFiles.add(test)
    if (
      app.contractPaths.some((path) => matches(file, path)) ||
      /\/(package\.json|tsconfig[^/]*\.json|vite[^/]*\.ts)$/.test(file)
    )
      publicConsumers(app, `контракт ${file}`)
    if (!app.isolation.tests && app.kind !== 'library' && !legacy(file))
      return full(`Общая область: ${file}`)
  }
  return {
    full: false,
    applications: [...selected.values()],
    contracts: [...contracts.values()],
    reasons,
    e2eFiles: [...e2eFiles],
    tooling, verifyArtifacts
  }
}
function hasContractTests(path) {
  if (statSync(path).isFile()) return /\.test\.tsx?$/.test(path)
  return readdirSync(path).some((name) => hasContractTests(resolve(path, name)))
}
function run(command, args, env = {}) {
  console.log(`[gate:app] ${command} ${args.join(' ')}`)
  const started = performance.now()
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env }
  })
  console.log(`[gate:timing] ${command} ${args.join(' ')}: ${((performance.now() - started) / 1000).toFixed(2)}s (exit ${result.status ?? result.signal})`)
  if (result.error) throw result.error
  if (result.status !== 0)
    throw Object.assign(
      new Error(
        `Проверка завершилась с кодом ${result.status ?? result.signal}`
      ),
      { exitCode: result.status || 1 }
    )
}
function workspacePath(workspace) {
  const app = APPLICATION_CATALOG.find((app) =>
    app.workspaces.includes(workspace)
  )
  const pkg = PACKAGES.find((pkg) => pkg.workspace === workspace)
  return (
    pkg?.path ??
    app?.paths.find(
      (path) =>
        existsSync(resolve(root, path, 'package.json')) &&
        JSON.parse(readFileSync(resolve(root, path, 'package.json'), 'utf8'))
          .name === workspace
    )
  )
}
export function applicationCommands(app) {
  const paths = app.workspaces.length
    ? app.workspaces.map((workspace) => ({
        workspace,
        path: workspacePath(workspace)
      }))
    : app.paths.map((path) => ({ path }))
  return paths.flatMap(({ workspace, path }) => {
    if (!path) throw new Error(`Не найден пакет ${workspace}`)
    const pkg = JSON.parse(
      readFileSync(resolve(root, path, 'package.json'), 'utf8')
    )
    const prefix = workspace
      ? ['run', '-w', workspace]
      : ['--prefix', path, 'run']
    const scripts = [
      'typecheck',
      'test',
      ...(pkg.scripts?.build ? ['build'] : []),
      ...(pkg.scripts?.['build-storybook'] ? ['build-storybook'] : [])
    ]
    for (const script of ['typecheck', 'test'])
      if (!pkg.scripts?.[script])
        throw new Error(`${app.id}: не задан ${script}`)
    return scripts.map((script) => ['npm', [...prefix, script]])
  })
}
// This is shared by normal gates and the audit runner so measured scenarios
// execute exactly the same commands as a real diff, including failure handling.
export function applicationPlanCommands(plan) {
  const commands = []
  const add = (command, args) => commands.push([command, args])
  if (plan.full) add('npm', ['run', 'gate:all'])
  if (plan.tooling && !plan.full) add('npm', ['run', 'test:tooling'])
  for (const app of plan.applications)
    for (const command of applicationCommands(app)) commands.push(command)
  const contracts = new Map()
  for (const check of plan.contracts) {
    if (plan.applications.some(app => app.workspaces.includes(check.workspace))) continue
    const path = workspacePath(check.workspace)
    if (!path || check.files.some(file => !existsSync(resolve(root, path, file))))
      throw Error(`Missing contract suite: ${check.workspace}: ${check.files.join(', ')}`)
    if (check.files.length && !check.files.some(file => hasContractTests(resolve(root, path, file))))
      throw Error(`Empty contract suite: ${check.workspace}`)
    const previous = contracts.get(check.workspace)
    contracts.set(check.workspace, previous === undefined ? check.files :
      (!previous.length || !check.files.length ? [] : [...new Set([...previous, ...check.files])]))
  }
  for (const [workspace, files] of contracts) {
    add('npm', ['run', '-w', workspace, 'typecheck'])
    add('npm', ['run', '-w', workspace, 'test', ...(files.length ? ['--', ...files] : [])])
  }
  const browserFiles = remainingBrowserFiles(plan.e2eFiles ?? [], plan.full)
  if ((browserFiles.length || plan.verifyArtifacts) && !plan.full) {
    add('npm', ['run', 'build:frontends'])
    add('npm', ['run', 'verify:core-ui'])
  }
  if (browserFiles.length) {
    for (const file of browserFiles) if (!existsSync(resolve(root, file))) throw Error(`Missing E2E: ${file}`)
    add(process.execPath, ['scripts/browser-gate.mjs', ...browserFiles])
  }
  // Several public boundaries can select the same consumer typecheck.
  return commands.filter(([command, args], index) => commands.findIndex(entry => JSON.stringify(entry) === JSON.stringify([command, args])) === index)
}

export function executeApplicationPlan(plan, execute = run, output = 'changed') {
  if (!/^[\w-]+$/.test(output)) throw Error('Invalid timing report name')
  const results = [], startedAt = new Date().toISOString()
  const directory = resolve(root, 'artifacts/gate-timings')
  mkdirSync(directory, { recursive: true })
  const record = () => writeFileSync(resolve(directory, `${output}.json`), JSON.stringify({ startedAt,
    plan: { ...plan, applications: plan.applications.map(app => app.id) }, results }, null, 2))
  record()
  for (const [command, args] of applicationPlanCommands(plan)) {
    const started = performance.now()
    let exitCode = 0
    try { execute(command, args) }
    catch (error) { exitCode = error.exitCode || 1; throw error }
    finally {
      results.push({ command, args, seconds: Number(((performance.now() - started) / 1000).toFixed(2)), exitCode })
      record()
    }
  }
  return results
}

export async function main(args = process.argv.slice(2)) {
  // Package tests do not run the root graph tests; reject drift before choosing a gate.
  validatePackageDependencies(root)
  validateApplicationDependencies()
  if (args.includes('--fast') && !args.includes('--worktree'))
    args = [...args, '--worktree']
  const dry = args.includes('--dry-run'),
    explicit = args[0] && !args[0].startsWith('--') ? args[0] : null
  let plan
  if (explicit) {
    const app = APPLICATION_CATALOG.find((app) => app.id === explicit)
    if (!app) throw new Error(`Неизвестное приложение: ${explicit}`)
    if (app.external) throw new Error(`Application ${app.id} is owned by ${app.external.repository}; run its gate there`)
    plan = {
      full: false,
      applications: [app],
      contracts: app.contractChecks,
      e2eFiles: app.e2eFiles,
      reasons: [`Явно выбрано ${explicit}`]
    }
  } else {
    const baseIndex = args.indexOf('--base'),
      base =
        baseIndex >= 0
          ? args[baseIndex + 1]
          : args.includes('--worktree')
            ? 'HEAD'
            : 'origin/main'
    if (!base || base.startsWith('-')) throw new Error('Нужна база сравнения')
    let files, lockBefore
    try {
      const baseline = args.includes('--worktree')
        ? 'HEAD'
        : git('merge-base', 'HEAD', base).trim()
      files = [
        ...new Set(
          [
            ...git(
              'diff',
              '--name-only',
              '--no-renames',
              '-z',
              baseline,
              '--'
            ).split('\0'),
            ...git('ls-files', '--others', '--exclude-standard', '-z').split(
              '\0'
            )
          ].filter(Boolean)
        )
      ]
      if (files.includes('package-lock.json'))
        lockBefore = JSON.parse(git('show', `${baseline}:package-lock.json`))
    } catch (error) {
      plan = {
        full: true,
        applications: [],
        contracts: [],
        e2eFiles: [
          ...new Set(APPLICATION_CATALOG.flatMap((app) => app.e2eFiles))
        ],
        reasons: [`Не удалось получить diff: ${error.message}`]
      }
    }
    if (!plan)
      plan = planApplicationChecks(files, {
        lockBefore,
        lockAfter: files.includes('package-lock.json')
          ? JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'))
          : undefined
      })
  }
  console.log(
    JSON.stringify(
      { ...plan, applications: plan.applications.map((app) => app.id) },
      null,
      2
    )
  )
  if (dry) return plan
  executeApplicationPlan(plan)

  return plan
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = error.exitCode || 1
  })
