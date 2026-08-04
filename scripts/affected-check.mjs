import { spawnSync } from 'node:child_process'

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

function runPackage(pkg, script) {
  const args = pkg.workspace
    ? ['run', '-w', pkg.workspace, script]
    : ['--prefix', pkg.prefix, 'run', script]
  console.log(`[affected-check] ${pkg.id}: npm ${args.join(' ')}`)
  run('npm', args)
}

function main() {
  const baseBranch = process.env.BASE_BRANCH || 'main'
  const baseRef = `origin/${baseBranch}`
  const diff = changedFiles(baseRef)
  const decision = 'error' in diff
    ? fullGate(`не удалось получить diff от ${baseRef}: ${diff.error}`)
    : selectAffected(diff)

  console.log(`[affected-check] base ref: ${baseRef}`)
  console.log(`[affected-check] changed files: ${'error' in diff ? '(diff unavailable)' : diff.length ? diff.join(', ') : '(none)'}`)
  console.log(`[affected-check] selected packages: ${decision.packages.length ? decision.packages.map((pkg) => pkg.id).join(', ') : '(none)'}`)
  if (decision.full) console.log(`[affected-check] full fallback: ${decision.reason}`)
  if (!decision.packages.length) return

  for (const pkg of decision.packages) runPackage(pkg, 'typecheck')
  for (const pkg of decision.packages) runPackage(pkg, 'test')
}

if (import.meta.url === `file://${process.argv[1]}`) main()
