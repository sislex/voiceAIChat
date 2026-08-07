import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const PACKAGES = [
  { id: 'shared', path: 'packages/shared', workspace: '@voicechat/shared' },
  { id: 'server', path: 'apps/server', workspace: '@voicechat/server' },
  { id: 'runner', path: 'apps/llm-runner', workspace: '@voicechat/llm-runner' },
  { id: 'agent', path: 'apps/agent', workspace: '@voicechat/agent' },
  { id: 'ui', path: 'packages/ui', workspace: '@voicechat/ui' },
  { id: 'web', path: 'apps/web', workspace: '@voicechat/web' },
  { id: 'desktop', path: 'apps/desktop', prefix: 'apps/desktop' },
  { id: 'agent-tray', path: 'apps/agent-tray', prefix: 'apps/agent-tray' }
]

// Это явная карта зависимостей: shared — контракт всех workspace-потребителей.
const sharedConsumers = ['server', 'runner', 'agent', 'ui', 'web']
const workspacePackages = PACKAGES.filter((pkg) => pkg.workspace)
const fullGate = (reason) => ({ full: true, reason, packages: workspacePackages })
const harmlessPaths = [/^docs\//, /^generated\/kb\//, /^(README|LICENSE)(\.md)?$/]
const rootFiles = new Set([
  'package.json', 'package-lock.json', '.npmrc', '.nvmrc',
  'tsconfig.json', 'vitest.config.ts', 'vite.config.ts', 'docker-compose.yml', 'Dockerfile'
])

export function selectAffected(files) {
  if (!Array.isArray(files) || files.some((file) => typeof file !== 'string' || !file)) {
    return fullGate('diff содержит нераспознанные имена файлов')
  }

  const affected = new Set()
  for (const file of files) {
    if (rootFiles.has(file) || file.startsWith('.github/') || file.startsWith('scripts/')) {
      return fullGate(`общий конфиг или CI-скрипт: ${file}`)
    }
    const match = PACKAGES.find((pkg) => file === pkg.path || file.startsWith(`${pkg.path}/`))
    if (match) {
      affected.add(match.id)
      continue
    }
    if (harmlessPaths.some((pattern) => pattern.test(file))) continue
    return fullGate(`нераспознанный критичный путь: ${file}`)
  }

  if (affected.has('shared')) for (const consumer of sharedConsumers) affected.add(consumer)
  return { full: false, reason: null, packages: PACKAGES.filter((pkg) => affected.has(pkg.id)) }
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function changedFiles(baseRef) {
  try {
    const base = spawnSync('git', ['rev-parse', '--verify', '--quiet', baseRef], { encoding: 'utf8' })
    if (base.status !== 0) throw new Error(base.stderr || `не найден ${baseRef}`)
    const diff = spawnSync('git', ['diff', '--name-only', baseRef], { encoding: 'utf8' })
    if (diff.status !== 0) throw new Error(diff.stderr || 'git diff завершился с ошибкой')
    const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' })
    if (untracked.status !== 0) throw new Error(untracked.stderr || 'git ls-files завершился с ошибкой')
    return [...new Set(`${diff.stdout}\n${untracked.stdout}`.split('\n').filter(Boolean))]
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export function packageArgs(pkg, script, maxWorkers, extraArgs = []) {
  const args = pkg.workspace
    ? ['run', '-w', pkg.workspace, script]
    : ['--prefix', pkg.prefix, 'run', script]
  if (script === 'test' && (maxWorkers || extraArgs.length)) {
    args.push('--')
    // Vitest 2.x может оставить вычисленный по CPU minWorkers выше явного
    // maxWorkers и завершиться с нулём найденных suites. Ограничиваем оба края.
    if (maxWorkers) args.push(`--minWorkers=${maxWorkers}`, `--maxWorkers=${maxWorkers}`)
    args.push(...extraArgs)
  }
  return args
}

function vitestResultFile() {
  return join(tmpdir(), `voicechat-vitest-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
}

function vitestSummary(file) {
  if (!existsSync(file)) return null
  try {
    const report = JSON.parse(readFileSync(file, 'utf8'))
    const failed = Number(report.numFailedTests ?? 0)
    const passed = Number(report.numPassedTests ?? 0)
    const total = Number(report.numTotalTests ?? failed + passed)
    const failures = []
    for (const result of report.testResults ?? []) {
      for (const assertion of result.assertionResults ?? []) {
        if (assertion.status !== 'failed') continue
        const title = [...(assertion.ancestorTitles ?? []), assertion.title].filter(Boolean).join(' > ')
        const error = (assertion.failureMessages ?? []).join('\n').trim() || 'Текст ошибки отсутствует'
        failures.push({ title: title || result.name || 'Без названия', error })
      }
    }
    return { total, passed, failed, failures }
  } catch {
    return null
  } finally {
    try { rmSync(file, { force: true }) } catch {}
  }
}

function printVitestFailure(pkg, summary, fallback) {
  for (const failure of summary?.failures ?? []) {
    console.error(`[test failed] ${pkg.id}: ${failure.title}\n${failure.error}`)
  }
  if (!summary?.failures?.length && fallback.trim()) console.error(`[test failed] ${pkg.id}\n${compactOutput(fallback)}`)
}

export function startPackageCommand(pkg, script, { maxWorkers } = {}) {
  const reportFile = script === 'test' ? vitestResultFile() : null
  // Пакетные test-скрипты уже передают `--silent`; повтор Vitest 2.x считает
  // конфликтом CLI-опций и завершает до запуска тестов.
  const args = packageArgs(pkg, script, maxWorkers, reportFile ? ['--reporter=json', `--outputFile=${reportFile}`] : [])
  // Успешные проверки и предупреждения не засоряют ленту. Для Vitest берём
  // структурированный отчёт, чтобы в ошибке остались только имя теста и причина.
  const child = spawn('npm', args, { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
  let output = ''
  child.stdout.on('data', (chunk) => { output = (output + chunk).slice(-8_000) })
  child.stderr.on('data', (chunk) => { output = (output + chunk).slice(-8_000) })
  let killTimer
  let settled = false
  const kill = (signal) => {
    if (settled) return
    if (process.platform === 'win32' || !child.pid) child.kill(signal)
    else process.kill(-child.pid, signal)
  }
  return {
    done: new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => {
        settled = true
        clearTimeout(killTimer)
        const summary = reportFile ? vitestSummary(reportFile) : null
        if (code === 0) {
          resolve(summary)
          return
        }
        if (script === 'test') printVitestFailure(pkg, summary, output)
        else if (output.trim()) console.error(`[check failed] ${pkg.id}: ${script}\n${compactOutput(output)}`)
        reject(Object.assign(new Error(`${pkg.id} ${script} завершился${signal ? ` по сигналу ${signal}` : ` с кодом ${code}`}`), { code: code ?? 1, summary }))
      })
    }),
    stop: () => {
      try {
        kill('SIGTERM')
        killTimer = setTimeout(() => {
          try {
            kill('SIGKILL')
          } catch {
            // Процесс мог закончиться между таймаутом и принудительным сигналом.
          }
        }, 2_000)
      } catch {
        // Уже завершившийся процесс не должен скрывать исходную ошибку пакета.
      }
    }
  }
}

const fastUnsafeFile = /(?:^|\/)(?:[^/]*\.config\.[^/]+|package\.json|tsconfig(?:\.[^/]+)?\.json|[^/]*(?:schema|migration)\.(?:[cm]?[jt]sx?|sql))$/i
const migrationPath = /(?:^|\/)migrations?\//i

// Related не заменяет гейт: контракты shared, миграции и конфигурация могут менять
// интеграции, которые Vitest не выводит из статического графа импортов.
export function fastCheckForPackage(pkg, files) {
  const packageFiles = files
    .filter((file) => file.startsWith(`${pkg.path}/`))
    .map((file) => file.slice(pkg.path.length + 1))

  if (!packageFiles.length) return { pkg, files: [], reason: 'изменений этого пакета нет' }
  if (pkg.id === 'shared') return { pkg, files: [], reason: 'shared-контракт' }
  if (packageFiles.some((file) => fastUnsafeFile.test(file) || migrationPath.test(file))) {
    return { pkg, files: [], reason: 'конфиг, схема или миграция' }
  }
  return { pkg, files: packageFiles, reason: null }
}

function compactOutput(output) {
  return output.trim().split('\n').slice(-16).join('\n')
}

export function startRelatedTest(check, { maxWorkers } = {}) {
  const reportFile = vitestResultFile()
  // `--related` живёт только в подкоманде `vitest related`, а тестовый скрипт
  // пакета — это `vitest run`: `vitest run --related` в vitest 2.x падает с
  // «Unknown option `--related`», и быстрый этап валил гейт на любой правке кода.
  // Поэтому зовём vitest напрямую в папке пакета, мимо npm-скрипта; пути в
  // `check.files` уже относительны пакету.
  const args = ['vitest', 'related', ...check.files, '--run', '--passWithNoTests', '--reporter=json', `--outputFile=${reportFile}`, '--silent']
  if (maxWorkers) args.push(`--maxWorkers=${maxWorkers}`)
  const child = spawn('npx', args, { cwd: check.pkg.path, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
  let output = ''
  let killTimer
  let settled = false
  const append = (chunk) => {
    output = (output + chunk).slice(-8_000)
  }
  child.stdout.on('data', append)
  child.stderr.on('data', append)

  const kill = (signal) => {
    if (settled) return
    if (process.platform === 'win32' || !child.pid) child.kill(signal)
    else process.kill(-child.pid, signal)
  }
  return {
    done: new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => {
        settled = true
        clearTimeout(killTimer)
        const summary = vitestSummary(reportFile)
        if (code === 0) {
          resolve({ found: !/No test files found/i.test(output), summary })
          return
        }
        printVitestFailure(check.pkg, summary, output)
        reject(Object.assign(new Error(`${check.pkg.id} related-тесты завершились${signal ? ` по сигналу ${signal}` : ` с кодом ${code}`}`), { code: code ?? 1 }))
      })
    }),
    stop: () => {
      try {
        kill('SIGTERM')
        killTimer = setTimeout(() => {
          try {
            kill('SIGKILL')
          } catch {
            // Процесс мог закончиться между таймаутом и принудительным сигналом.
          }
        }, 2_000)
      } catch {
        // Уже завершившийся процесс не должен скрывать исходную ошибку пакета.
      }
    }
  }
}

// Быстрый этап заканчивается до typecheck и полных тестов: его ошибка даёт fix-loop
// короткий диагноз и не тратит время на основной пакетный гейт.
export async function runFastChecks(checks, { jobs = 2, start = startRelatedTest } = {}) {
  const runnable = checks.filter((check) => check.files.length)
  // Пропущенный related не означает успех: пакет всё равно войдёт в полный гейт.
  if (!runnable.length) return

  const limit = Number.isInteger(jobs) && jobs > 0 ? Math.min(jobs, 2) : 2
  const maxWorkers = limit > 1 && runnable.length > 1 ? 1 : undefined
  const pending = [...runnable]
  const active = new Set()
  let firstError

  const worker = async () => {
    while (!firstError && pending.length) {
      const check = pending.shift()
      const startedAt = Date.now()
      const task = start(check, { maxWorkers })
      active.add(task)
      try {
        await task.done
      } catch (error) {
        if (!firstError) {
          firstError = error
          for (const activeTask of active) activeTask.stop?.()
        }
      } finally {
        active.delete(task)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, runnable.length) }, worker))
  if (firstError) throw firstError
}

// Один пакет проходит typecheck перед собственными тестами; два пакета могут идти
// одновременно. После ошибки новые задания не выдаются, а живые процессы гасятся.
export async function runPackageGates(packages, { jobs = 2, start = startPackageCommand } = {}) {
  const totals = { total: 0, passed: 0, failed: 0 }
  const limit = Number.isInteger(jobs) && jobs > 0 ? Math.min(jobs, 2) : 2
  const maxWorkers = limit > 1 && packages.length > 1 ? 1 : undefined
  const pending = [...packages]
  const active = new Set()
  let firstError

  const stopActive = () => {
    for (const task of active) task.stop?.()
  }

  const worker = async () => {
    while (!firstError && pending.length) {
      const pkg = pending.shift()
      const startedAt = Date.now()
      let completed = true
      for (const script of ['typecheck', 'test']) {
        if (firstError) {
          completed = false
          break
        }
        const task = start(pkg, script, { maxWorkers })
        active.add(task)
        try {
          const result = await task.done
          if (script === 'test' && result) {
            totals.total += result.total
            totals.passed += result.passed
            totals.failed += result.failed
          }
        } catch (error) {
          if (script === 'test' && error.summary) {
            totals.total += error.summary.total
            totals.passed += error.summary.passed
            totals.failed += error.summary.failed
          }
          completed = false
          if (!firstError) {
            firstError = error
            stopActive()
          }
          break
        } finally {
          active.delete(task)
        }
      }
      if (!completed) return
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, packages.length) }, worker))
  console.log(`[tests] total: ${totals.total}; passed: ${totals.passed}; failed: ${totals.failed}`)
  if (firstError) throw firstError
}

function parseJobs(argv) {
  const index = argv.indexOf('--jobs')
  if (index === -1) return 2
  const value = Number(argv[index + 1])
  if (!Number.isInteger(value) || value < 1) throw new Error('--jobs должен быть положительным целым числом')
  return value
}

async function main() {
  const baseBranch = process.env.BASE_BRANCH || 'main'
  const baseRef = `origin/${baseBranch}`
  const diff = changedFiles(baseRef)
  const decision = 'error' in diff
    ? fullGate(`не удалось получить diff от ${baseRef}: ${diff.error}`)
    : selectAffected(diff)

  console.log(`[affected-check] base ref: ${baseRef}`)
  console.log(`[affected-check] changed files: ${'error' in diff ? '(diff unavailable)' : diff.length ? diff.join(', ') : '(none)'}`)
  console.log(`[affected-check] selected packages: ${decision.packages.length ? decision.packages.map((pkg) => pkg.id).join(', ') : '(none)'}`)
  if (decision.full) {
    console.log(`[affected-check] full fallback: ${decision.reason}`)
    console.log('[affected-check] fast stage: skipped (full fallback)')
    // Полный fallback обязан сохранить прежний корневой гейт: в нём есть тесты
    // самого скрипта выбора пакетов, которых нет среди npm-workspaces.
    const fullStartedAt = Date.now()
    console.log('[affected-check] full gate: npm run typecheck && npm test')
    run('npm', ['run', 'typecheck'])
    run('npm', ['test'])
    console.log(`[affected-check] full stage: completed in ${Date.now() - fullStartedAt}ms`)
    return
  }
  if (!decision.packages.length) return

  const jobs = parseJobs(process.argv.slice(2))
  console.log(`[affected-check] jobs: ${jobs}`)
  const fastStartedAt = Date.now()
  await runFastChecks(decision.packages.map((pkg) => fastCheckForPackage(pkg, diff)), { jobs })
  console.log(`[affected-check] fast stage: completed in ${Date.now() - fastStartedAt}ms`)
  const fullStartedAt = Date.now()
  await runPackageGates(decision.packages, { jobs })
  console.log(`[affected-check] full stage: completed in ${Date.now() - fullStartedAt}ms`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[affected-check] ${error.message}`)
    process.exitCode = error.code ?? 1
  })
}
