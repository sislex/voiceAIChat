import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Пакеты гейта в порядке запуска и явный граф зависимостей: `dependsOn` — на кого
 * пакет опирается, потребители выводятся обратным замыканием (`consumersOf`).
 *
 * Граф именно явный, а не выведенный из `package.json`: часть связей живёт только
 * в алиасах. `apps/web` импортирует `@voicechat/ui` через `paths` в tsconfig и
 * alias в `vite.config.ts`, а в зависимостях его нет вовсе — вывод по манифестам
 * потерял бы эту связь и пропустил бы поломку web от правки UI.
 *
 * Рассинхронизацию с репозиторием ловят тесты: один требует, чтобы в списке был
 * каждый воркспейс, другой — чтобы каждая зависимость из `package.json` попала
 * в `dependsOn`. Забытый пакет раньше означал молчаливый полный гейт на любой
 * правке фронта, потому что путь не распознавался.
 */
export const PACKAGES = [
  { id: 'shared', path: 'packages/shared', workspace: '@voicechat/shared', dependsOn: ['sessions-core'] },
  { id: 'sessions-core', path: 'packages/sessions-core', workspace: '@voicechat/sessions-core', dependsOn: [] },
  { id: 'ui-kit', path: 'packages/ui-kit', workspace: '@voicechat/ui-kit', dependsOn: [] },
  { id: 'app-shell', path: 'packages/app-shell', workspace: '@voicechat/app-shell', dependsOn: [] },
  { id: 'sessions-app', path: 'packages/sessions-app', workspace: '@voicechat/sessions-app', dependsOn: ['sessions-core', 'ui-kit'] },
  { id: 'profile-app', path: 'packages/profile-app', workspace: '@voicechat/profile-app', dependsOn: ['sessions-app', 'ui-kit'] },
  { id: 'chat-app', path: 'packages/chat-app', workspace: '@voicechat/chat-app', dependsOn: ['shared', 'ui-kit'] },
  { id: 'projects-app', path: 'packages/projects-app', workspace: '@voicechat/projects-app', dependsOn: ['shared', 'ui-kit'] },
  { id: 'operations-app', path: 'packages/operations-app', workspace: '@voicechat/operations-app', dependsOn: ['shared', 'ui-kit'] },
  { id: 'admin-app', path: 'packages/admin-app', workspace: '@voicechat/admin-app', dependsOn: ['profile-app', 'sessions-app', 'shared', 'ui-kit'] },
  { id: 'web-reader', path: 'packages/web-reader-app', workspace: '@voicechat/web-reader-app', dependsOn: ['chat-app', 'shared', 'ui-kit'] },
  { id: 'playwright-reader', path: 'packages/playwright-reader-app', workspace: '@voicechat/playwright-reader-app', dependsOn: ['chat-app', 'shared', 'ui-kit'] },
  { id: 'ui', path: 'packages/ui', workspace: '@voicechat/ui', dependsOn: ['admin-app', 'app-shell', 'chat-app', 'operations-app', 'playwright-reader', 'projects-app', 'sessions-app', 'sessions-core', 'shared', 'ui-kit', 'web-reader'] },
  { id: 'server', path: 'apps/server', workspace: '@voicechat/server', dependsOn: ['runner', 'sessions-core', 'shared'] },
  { id: 'runner', path: 'apps/llm-runner', workspace: '@voicechat/llm-runner', dependsOn: ['shared'] },
  { id: 'tts-runner', path: 'apps/tts-runner', workspace: '@voicechat/tts-runner', dependsOn: ['shared'] },
  { id: 'stt-runner', path: 'apps/stt-runner', workspace: '@voicechat/stt-runner', dependsOn: ['shared'] },
  { id: 'automation-runner', path: 'apps/automation-runner', workspace: '@voicechat/automation-runner', dependsOn: ['shared'] },
  { id: 'browser-runner', path: 'apps/browser-runner', workspace: '@voicechat/browser-runner', dependsOn: ['shared'] },
  { id: 'agent', path: 'apps/agent', workspace: '@voicechat/agent', dependsOn: ['shared'] },
  // `ui` тут не из package.json, а из tsconfig `paths` и alias в vite.config.ts.
  { id: 'web', path: 'apps/web', workspace: '@voicechat/web', dependsOn: ['chat-app', 'shared', 'ui'] },
  { id: 'web-recorder', path: 'apps/web-recorder', workspace: '@voicechat/web-recorder', dependsOn: ['shared', 'ui'] },
  // Вне npm-workspaces: свой node_modules с Electron, поэтому запуск через --prefix.
  // `manualGate` — их не втягивает замыкание потребителей: корневой `npm install`
  // их не ставит, и на машине без локального install гейт падал бы на чужой правке
  // UI. Свои гейты у них отдельные (`typecheck:desktop`, `test:desktop` в verify).
  { id: 'desktop', path: 'apps/desktop', prefix: 'apps/desktop', dependsOn: ['shared', 'ui', 'web'], manualGate: true },
  { id: 'agent-tray', path: 'apps/agent-tray', prefix: 'apps/agent-tray', dependsOn: ['shared'], manualGate: true },
  { id: 'login-application', path: 'apps/login-application', prefix: 'apps/login-application', dependsOn: ['shared', 'agent'], manualGate: true }
]

const workspacePackages = PACKAGES.filter((pkg) => pkg.workspace)
const byId = new Map(PACKAGES.map((pkg) => [pkg.id, pkg]))

/** Транзитивное замыкание «кто ломается, если правишь этот пакет». */
export function consumersOf(id) {
  const affected = new Set()
  const queue = [id]
  while (queue.length) {
    const current = queue.shift()
    for (const pkg of PACKAGES) {
      if (pkg.manualGate || !pkg.dependsOn.includes(current) || affected.has(pkg.id)) continue
      affected.add(pkg.id)
      queue.push(pkg.id)
    }
  }
  return affected
}

/** Транзитивное замыкание «на кого этот пакет опирается» — источники его related-файлов. */
export function dependenciesOf(id) {
  const seen = new Set()
  const queue = [id]
  while (queue.length) {
    const current = queue.shift()
    for (const dependency of byId.get(current)?.dependsOn ?? []) {
      if (seen.has(dependency)) continue
      seen.add(dependency)
      queue.push(dependency)
    }
  }
  return seen
}

const fullGate = (reason) => ({ full: true, reason, packages: workspacePackages })
const harmlessPaths = [/^docs\//, /^generated\/kb\//, /^plans\//, /^artifacts\//, /^(README|LICENSE)(\.md)?$/]
// У этих путей свой гейт, к пакетным тестам они не относятся: e2e гоняют скрипты
// `e2e:*`, базовую линию бандла — `frontend:static`, настройки агентов вообще
// не код продукта. Раньше любой из них молча включал полный гейт репозитория.
const ownGatePaths = [/^e2e\//, /^frontend-quality\//, /^\.claude\//, /^\.vscode\//, /^\.idea\//]
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
    if (ownGatePaths.some((pattern) => pattern.test(file))) continue
    return fullGate(`нераспознанный критичный путь: ${file}`)
  }

  for (const id of [...affected]) for (const consumer of consumersOf(id)) affected.add(consumer)
  return { full: false, reason: null, packages: PACKAGES.filter((pkg) => affected.has(pkg.id)) }
}

/**
 * Сколько воркеров дать одному пакету. Замеры на 8 CPU: `packages/ui` — 42 с при
 * дефолте, 40 с при 4 воркерах, 61 с при 12. То есть перепрописка вредна, а
 * `--maxWorkers=1` (так было раньше при `--jobs 2`) стоил 108 с вместо 42 с.
 * Поэтому пул делится между параллельными пакетами, а не сажается на единицу.
 */
export function workersPerJob(jobs, parallelism = availableParallelism()) {
  if (!Number.isInteger(jobs) || jobs <= 1) return undefined
  return Math.max(1, Math.floor(parallelism / jobs))
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
  const diagnostics = createCommandDiagnostics(`${pkg.id} / ${script}`)
  child.stdout.on('data', (chunk) => diagnostics.append(chunk))
  child.stderr.on('data', (chunk) => diagnostics.append(chunk))
  let killTimer
  let settled = false
  const kill = (signal) => {
    if (settled) return
    if (process.platform === 'win32' || !child.pid) child.kill(signal)
    else process.kill(-child.pid, signal)
  }
  return {
    done: new Promise((resolve, reject) => {
      child.once('error', (error) => {
        diagnostics.complete()
        reject(error)
      })
      child.once('exit', (code, signal) => {
        settled = true
        diagnostics.complete()
        clearTimeout(killTimer)
        const summary = reportFile ? vitestSummary(reportFile) : null
        if (code === 0) {
          resolve(summary)
          return
        }
        const output = diagnostics.output()
        if (script === 'test') printVitestFailure(pkg, summary, output)
        else if (output.trim()) console.error(`[check failed] ${pkg.id}: ${script}\n${compactOutput(output)}`)
        reject(Object.assign(new Error(`${pkg.id} ${script} завершился${signal ? ` по сигналу ${signal}` : ` с кодом ${code}`}`), { code: code ?? 1, summary }))
      })
    }),
    stop: () => {
      try {
        diagnostics.stopped('stopped')
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

/**
 * План гейта шага для одного пакета. Отличие от `fastCheckForPackage`: пакет,
 * которого задело по графу зависимостей, тоже проверяется через related — Vitest
 * видит исходники соседнего пакета как обычные файлы модульного графа (проверено:
 * из `packages/ui` related на `../ui-kit/src/Button.tsx` находит 85 файлов из 149).
 * Раньше такой пакет получал полный набор, и правка одного компонента тянула за
 * собой 42-секундный прогон всего `ui`.
 *
 * Полный набор остаётся там, где статический граф не доказателен:
 * — правки самого `shared` и всё, что задето через `shared`: контракт WS/REST
 *   ходит строковыми литералами через границы процессов, импортом это не видно;
 * — конфиг, схема БД, миграция в любом пакете-источнике.
 */
export function fastPlanForPackage(pkg, files) {
  const sources = new Set([pkg.id, ...dependenciesOf(pkg.id)])
  const relevant = PACKAGES
    .filter((source) => sources.has(source.id))
    .flatMap((source) => files.filter((file) => file.startsWith(`${source.path}/`)))

  if (!relevant.length) return { pkg, files: [], reason: 'изменений в этом пакете и его зависимостях нет' }
  if (sources.has('shared') && relevant.some((file) => file.startsWith('packages/shared/'))) {
    return { pkg, files: [], reason: 'shared-контракт' }
  }
  const unsafe = relevant.find((file) => fastUnsafeFile.test(file) || migrationPath.test(file))
  if (unsafe) return { pkg, files: [], reason: `конфиг, схема или миграция: ${unsafe}` }

  return { pkg, files: relevant.map((file) => relative(pkg.path, file)), reason: null }
}

function compactOutput(output) {
  return output.trim().split('\n').slice(-16).join('\n')
}

/**
 * Держит полный вывод дочерней проверки вне успешной ленты, но после порога
 * сообщает активный пакет/этап. При остановке печатает хвост до отправки сигнала.
 */
const activeDiagnostics = new Set()

export function createCommandDiagnostics(label, {
  heartbeatMs = 30_000,
  now = Date.now,
  info = console.log,
  error = console.error
} = {}) {
  const startedAt = now()
  let output = ''
  let finished = false
  const elapsed = () => Math.max(0, now() - startedAt)
  const timer = heartbeatMs > 0
    ? setInterval(() => info(`[affected-check] active package: ${label}; elapsed: ${Math.round(elapsed() / 1000)}s; stage: running`), heartbeatMs)
    : null
  timer?.unref?.()
  const diagnostics = {
    append(chunk) {
      output = (output + chunk).slice(-8_000)
    },
    output() {
      return output
    },
    complete() {
      if (finished) return
      finished = true
      activeDiagnostics.delete(diagnostics)
      if (timer) clearInterval(timer)
    },
    stopped(reason = 'stopped') {
      if (finished) return
      this.complete()
      error(`[affected-check] ${reason}: ${label}; elapsed: ${Math.round(elapsed() / 1000)}s\n${compactOutput(output) || '(no child output)'}`)
    }
  }
  activeDiagnostics.add(diagnostics)
  return diagnostics
}

function installSignalDiagnostics() {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      for (const diagnostics of [...activeDiagnostics]) diagnostics.stopped(`signal ${signal}`)
      process.removeListener(signal, handler)
      process.kill(process.pid, signal)
    }
    process.once(signal, handler)
  }
}

export function relatedArgs(files, reportFile, maxWorkers) {
  const args = ['vitest', 'related', ...files, '--run', '--passWithNoTests', '--reporter=json', `--outputFile=${reportFile}`, '--silent']
  // Vitest 2 валится до запуска suites, если вычисленный minWorkers больше
  // заданного maxWorkers. Fast-stage ограничивает worker при параллельных пакетах,
  // поэтому обе границы обязаны задаваться вместе, как в packageArgs().
  if (maxWorkers) args.push(`--minWorkers=${maxWorkers}`, `--maxWorkers=${maxWorkers}`)
  return args
}

export function startRelatedTest(check, { maxWorkers } = {}) {
  const reportFile = vitestResultFile()
  // `--related` живёт только в подкоманде `vitest related`, а тестовый скрипт
  // пакета — это `vitest run`: `vitest run --related` в vitest 2.x падает с
  // «Unknown option `--related`», и быстрый этап валил гейт на любой правке кода.
  // Поэтому зовём vitest напрямую в папке пакета, мимо npm-скрипта; пути в
  // `check.files` уже относительны пакету.
  const args = relatedArgs(check.files, reportFile, maxWorkers)
  const child = spawn('npx', args, { cwd: check.pkg.path, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
  const diagnostics = createCommandDiagnostics(`${check.pkg.id} / related tests`)
  let killTimer
  let settled = false
  child.stdout.on('data', (chunk) => diagnostics.append(chunk))
  child.stderr.on('data', (chunk) => diagnostics.append(chunk))

  const kill = (signal) => {
    if (settled) return
    if (process.platform === 'win32' || !child.pid) child.kill(signal)
    else process.kill(-child.pid, signal)
  }
  return {
    done: new Promise((resolve, reject) => {
      child.once('error', (error) => {
        diagnostics.complete()
        reject(error)
      })
      child.once('exit', (code, signal) => {
        settled = true
        diagnostics.complete()
        clearTimeout(killTimer)
        const output = diagnostics.output()
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
        diagnostics.stopped('stopped')
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

  const limit = Number.isInteger(jobs) && jobs > 0 ? jobs : 2
  const maxWorkers = runnable.length > 1 ? workersPerJob(limit) : undefined
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
export async function runPackageGates(packages, { jobs = 2, start = startPackageCommand, scripts = ['typecheck', 'test'] } = {}) {
  const totals = { total: 0, passed: 0, failed: 0 }
  const limit = Number.isInteger(jobs) && jobs > 0 ? jobs : 2
  const maxWorkers = packages.length > 1 ? workersPerJob(limit) : undefined
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
      for (const script of scripts) {
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
  // Этап только с typecheck не печатает нулевую тестовую сводку: в fast-гейте
  // «0 passed» рядом с зелёным related читалось как «тесты не запускались».
  if (scripts.includes('test')) console.log(`[tests] total: ${totals.total}; passed: ${totals.passed}; failed: ${totals.failed}`)
  if (firstError) throw firstError
}

export function parseOptions(argv) {
  const jobsIndex = argv.indexOf('--jobs')
  let jobs = 2
  if (jobsIndex !== -1) {
    const value = Number(argv[jobsIndex + 1])
    if (!Number.isInteger(value) || value < 1) throw new Error('--jobs должен быть положительным целым числом')
    jobs = value
  }
  // `--worktree` — гейт шага разработки: база диффа HEAD, а не origin/main. В
  // worktree отставшая origin/main даёт дифф на сотни файлов, и узкий гейт
  // молча превращался в полный.
  const worktree = argv.includes('--worktree')
  const baseIndex = argv.indexOf('--base')
  if (baseIndex !== -1 && worktree) throw new Error('--base и --worktree взаимно исключают друг друга')
  const explicitBase = baseIndex === -1 ? null : argv[baseIndex + 1]
  if (baseIndex !== -1 && (!explicitBase || explicitBase.startsWith('--'))) {
    throw new Error('--base требует git-ref')
  }
  const base = explicitBase ?? (worktree ? 'HEAD' : `origin/${process.env.BASE_BRANCH || 'main'}`)
  return { jobs, base, fast: argv.includes('--fast') }
}

/**
 * Нужны ли сборки фронта. В полном гейте — те же условия, что раньше. В `--fast`
 * гейте шага сборки адресные: web-сборка (16 с) только на правках самого клиента
 * и его конфигурации, витрина (30 с) — только на правках сториз и .storybook,
 * иначе 46 с сборок съедали бы весь смысл узкого гейта. Сломанные импорты ловит
 * typecheck, сломанные сториз — stories.a11y.dom.test.tsx через related.
 */
export function buildGates(files, { fast }) {
  if (!fast) {
    const frontend = files.some((file) => /^(?:packages\/(?:ui|ui-kit|app-shell|chat-app|projects-app|operations-app|admin-app)|apps\/(?:web|desktop)|frontend-quality\/)/.test(file))
    return frontend ? ['frontend:build-gates'] : []
  }
  const gates = []
  if (files.some((file) => /^apps\/web\//.test(file))) gates.push('build:web')
  if (files.some((file) => /\.stories\.tsx$/.test(file) || /^packages\/ui\/\.storybook\//.test(file))) gates.push('build:storybook')
  return gates
}

const BUILD_GATE_COMMANDS = {
  'frontend:build-gates': ['run', 'frontend:build-gates'],
  'build:web': ['run', '-w', '@voicechat/web', 'build'],
  'build:storybook': ['run', 'build:storybook']
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  const diff = changedFiles(options.base)
  const decision = 'error' in diff
    ? fullGate(`не удалось получить diff от ${options.base}: ${diff.error}`)
    : selectAffected(diff)

  console.log(`[affected-check] mode: ${options.fast ? 'fast (гейт шага)' : 'full (гейт перед коммитом)'}`)
  console.log(`[affected-check] base ref: ${options.base}`)
  console.log(`[affected-check] changed files: ${'error' in diff ? '(diff unavailable)' : diff.length ? diff.join(', ') : '(none)'}`)
  console.log(`[affected-check] selected packages: ${decision.packages.length ? decision.packages.map((pkg) => pkg.id).join(', ') : '(none)'}`)

  const runBuildGates = (files) => {
    for (const gate of buildGates(files, options)) {
      console.log(`[affected-check] build gate: ${gate}`)
      run('npm', BUILD_GATE_COMMANDS[gate])
    }
  }

  if (decision.full) {
    console.log(`[affected-check] full fallback: ${decision.reason}`)
    console.log('[affected-check] fast stage: skipped (full fallback)')
    // Полный fallback обязан сохранить прежний корневой гейт: в нём есть тесты
    // самого скрипта выбора пакетов, которых нет среди npm-workspaces.
    const fullStartedAt = Date.now()
    console.log('[affected-check] full gate: npm run typecheck && npm test')
    run('npm', ['run', 'typecheck'])
    run('npm', ['test'])
    if (!('error' in diff)) runBuildGates(diff)
    console.log(`[affected-check] full stage: completed in ${Date.now() - fullStartedAt}ms`)
    return
  }
  if (!decision.packages.length) {
    // Пустой выбор — не то же самое, что зелёный гейт. Чаще всего это правки
    // только в docs/ или уже сделанный коммит: дифф от HEAD пуст, и молчаливый
    // ноль читался бы как «всё проверено».
    console.log(`[affected-check] nothing to check: в диффе от ${options.base} нет кода пакетов`)
    if (!('error' in diff) && !diff.length) {
      console.log('[affected-check] дифф пуст — если правки уже в коммите, задай базу: --base origin/main')
    }
    return
  }

  const jobs = options.jobs
  console.log(`[affected-check] jobs: ${jobs}; workers per job: ${workersPerJob(jobs) ?? 'default'}`)
  const checks = decision.packages.map((pkg) => options.fast ? fastPlanForPackage(pkg, diff) : fastCheckForPackage(pkg, diff))
  const fastStartedAt = Date.now()
  await runFastChecks(checks, { jobs })
  console.log(`[affected-check] fast stage: completed in ${Date.now() - fastStartedAt}ms`)

  // В fast-режиме полный набор пакета гоняется только там, где related не
  // доказателен: shared-контракт, конфиг, схема, миграция, а также пакеты, чьих
  // собственных файлов в диффе нет (их задело по графу зависимостей).
  const fullPackages = options.fast
    ? checks.filter((check) => !check.files.length).map((check) => check.pkg)
    : decision.packages
  const typecheckOnly = options.fast
    ? checks.filter((check) => check.files.length).map((check) => check.pkg)
    : []

  const fullStartedAt = Date.now()
  if (typecheckOnly.length) {
    console.log(`[affected-check] typecheck only: ${typecheckOnly.map((pkg) => pkg.id).join(', ')}`)
    await runPackageGates(typecheckOnly, { jobs, scripts: ['typecheck'] })
  }
  if (fullPackages.length) {
    console.log(`[affected-check] full package gate: ${fullPackages.map((pkg) => pkg.id).join(', ')}`)
    await runPackageGates(fullPackages, { jobs })
  }
  runBuildGates(diff)
  console.log(`[affected-check] full stage: completed in ${Date.now() - fullStartedAt}ms`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  installSignalDiagnostics()
  main().catch((error) => {
    console.error(`[affected-check] ${error.message}`)
    process.exitCode = error.code ?? 1
  })
}
