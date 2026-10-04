import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync, mkdirSync, realpathSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

export const root = resolve(import.meta.dirname, '..')
export const isTest = file => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
export function workspaceEntries(repository = root) {
  const manifest = JSON.parse(readFileSync(resolve(repository, 'package.json'), 'utf8'))
  return manifest.workspaces.flatMap(pattern => pattern.endsWith('/*')
    ? readdirSync(resolve(repository, pattern.slice(0, -2))).map(name => pattern.slice(0, -1) + name)
    : [pattern]).filter(path => existsSync(resolve(repository, path, 'package.json')))
    .map(path => ({ path, ...JSON.parse(readFileSync(resolve(repository, path, 'package.json'), 'utf8')) }))
}
export function repositoryFile(file, repository = root) {
  const normalized = relative(repository, resolve(repository, file)).replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('../') || isAbsolute(normalized) || file.startsWith('-'))
    throw Error(`Not a repository file: ${file}`)
  return normalized
}
export function mapTestFiles(files, repository = root) {
  if (!files.length) throw Error('Provide repository-relative test files')
  const workspaces = workspaceEntries(repository), groups = new Map()
  for (const input of files) {
    const file = repositoryFile(input, repository)
    if (isAbsolute(input) || !isTest(file) || !existsSync(resolve(repository, file)))
      throw Error(`Invalid test file: ${input}`)
    repositoryFile(realpathSync(resolve(repository, file)), repository)
    const workspace = workspaces.find(item => file.startsWith(item.path + '/'))
    const path = workspace?.path ?? (file.startsWith('scripts/') ? '.' : file.startsWith('e2e/') ? 'e2e' : null)
    if (!path) throw Error(`No test runner owns ${file}`)
    if (workspace && !workspace.scripts?.test?.includes('vitest')) throw Error(`Unsupported runner: ${workspace.name}`)
    const group = groups.get(path) ?? { path, runner: path === '.' ? 'node' : 'vitest', files: [] }
    if (!group.files.includes(file)) group.files.push(file)
    groups.set(path, group)
  }
  return [...groups.values()]
}
export function vitestFailures(report, repository = root) {
  return [...new Set((report.testResults ?? []).filter(suite => suite.status === 'failed')
    .map(suite => repositoryFile(suite.name, repository)))]
}
export function runTests(group, { repository = root, spawn = spawnSync } = {}) {
  const directory = resolve(repository, 'artifacts/gate-quick')
  mkdirSync(directory, { recursive: true })
  const temporary = mkdtempSync(resolve(directory, 'run-'))
  const report = resolve(temporary, 'results.json')
  const cwd = resolve(repository, group.path === 'e2e' ? '.' : group.path)
  const files = group.files.map(file => relative(cwd, resolve(repository, file)))
  let args
  if (group.runner === 'node') {
    args = ['--import', 'tsx', '--test', '--test-reporter', resolve(root, 'scripts/test-failure-reporter.mjs'), ...files]
  } else {
    args = [resolve(repository, 'node_modules/vitest/vitest.mjs'),
      ...(group.related ? ['related', '--run'] : ['run']), ...files,
      ...(group.path === 'e2e' ? ['--config', 'e2e/vitest.config.ts'] : []),
      ...(group.related ? ['--passWithNoTests'] : []),
      '--reporter=default', '--reporter=json', `--outputFile.json=${report}`]
  }
  console.log(`[test:files] ${group.path}: ${process.execPath} ${args.join(' ')}`)
  try {
    const env = { ...process.env, GATE_TEST_REPORT: report, GATE_REPOSITORY_ROOT: repository }
    // A new runner must not inherit node:test's child-process sentinel.
    delete env.NODE_TEST_CONTEXT
    const result = spawn(process.execPath, args, { cwd, stdio: 'inherit', env })
    let failed = []
    if (existsSync(report)) {
      const data = JSON.parse(readFileSync(report, 'utf8'))
      failed = group.runner === 'node' ? data : vitestFailures(data, repository)
    }
    if (result.error || result.status !== 0)
      throw Object.assign(result.error ?? Error(`Tests exited ${result.status ?? result.signal}`), { exitCode: result.status || 1, failedTests: failed })
  } finally { rmSync(temporary, { recursive: true, force: true }) }
}
export function reportFailure(error) {
  console.error(error.message)
  console.log(`GATE-FAILED-TESTS: ${JSON.stringify(error.failedTests ?? [])}`)
  process.exitCode = error.exitCode || 1
}
export function main(files = process.argv.slice(2)) {
  for (const group of mapTestFiles(files)) runTests(group)
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main() } catch (error) { reportFailure(error) }
}
