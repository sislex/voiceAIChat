// Сквозной стенд «ядро + канбан» для e2e страниц проекта (доска, панель кода, приглашения).
// Канбана в ядре нет (docs/plans/kanban-service.md): страницы проекта рисуются, только когда
// рядом работает сервис `sislexa-kanban`. Стенд поднимает временный Postgres (docker), ядро в
// режиме `VC_KANBAN_MODE=remote` и процесс канбана из чекаута `sislexa-kanban` того коммита,
// который закрепил compose ядра (`SISLEXA_KANBAN_IMAGE`). Без любого из условий сьюты
// пропускаются с причиной — `kanbanStandUnavailable()`.
//
//   SISLEXA_KANBAN_SOURCE  чекаут sislex/sislexa-kanban с установленными зависимостями; по умолчанию —
//                          кэш `scripts/kanban-stand-prepare.mjs` для закреплённого коммита, затем
//                          соседний каталог `../sislexa-kanban`
//   VC_E2E_DB_URL          готовый Postgres вместо контейнера (база очищается не стендом)
//   SISLEXA_KANBAN_SOURCE_ANY_COMMIT=1  разрешить чекаут не на закреплённом коммите
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { freePort } from './free-port'

export const ROOT = resolve(__dirname, '..')
export const WEB_DIST = join(ROOT, 'node_modules/@sislexa/core-ui/web')
const INTERNAL = 'e2e-internal-token'
const MCP = 'e2e-mcp-secret'

/** Коммит канбана, закреплённый в compose ядра. */
export function pinnedKanbanCommit(): string | null {
  return /sislexa-kanban:([0-9a-f]{40})/.exec(readFileSync(join(ROOT, 'docker-compose.yml'), 'utf8'))?.[1] ?? null
}

function kanbanSource(): string {
  if (process.env.SISLEXA_KANBAN_SOURCE) return resolve(process.env.SISLEXA_KANBAN_SOURCE)
  const pinned = pinnedKanbanCommit()
  // Тот же путь, что у scripts/kanban-stand-prepare.mjs.
  const cached = pinned && join(process.env.VC_E2E_KANBAN_CACHE ?? join(homedir(), '.cache', 'sislexa', 'kanban'), pinned)
  return cached && existsSync(join(cached, '.sislexa-e2e-ready')) ? cached : join(ROOT, '..', 'sislexa-kanban')
}
export const KANBAN_SOURCE = kanbanSource()

const git = (...args: string[]): string | null => {
  const result = spawnSync('git', ['-C', KANBAN_SOURCE, ...args], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}

/** Почему стенд нельзя поднять; null — можно. */
export function kanbanStandUnavailable(): string | null {
  if (!existsSync(WEB_DIST)) return `нет собранного core-ui: ${WEB_DIST}`
  if (!process.env.VC_E2E_DB_URL && spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) return 'нет docker для временного Postgres (или задайте VC_E2E_DB_URL)'
  if (!existsSync(join(KANBAN_SOURCE, 'apps/server/src/kanban/standalone/index.ts'))) return `нет чекаута sislexa-kanban: ${KANBAN_SOURCE} (SISLEXA_KANBAN_SOURCE)`
  if (!existsSync(join(KANBAN_SOURCE, 'node_modules'))) return `в ${KANBAN_SOURCE} не установлены зависимости (npm ci)`
  const pinned = pinnedKanbanCommit()
  if (!pinned) return 'compose ядра не закрепляет образ sislexa-kanban'
  if (process.env.SISLEXA_KANBAN_SOURCE_ANY_COMMIT !== '1') {
    // Сравниваются деревья: merge-коммит над закреплённым коммитом с тем же содержимым подходит.
    const tree = git('rev-parse', 'HEAD^{tree}'), pinnedTree = git('rev-parse', `${pinned}^{tree}`)
    if (!pinnedTree) return `в ${KANBAN_SOURCE} нет закреплённого коммита ${pinned.slice(0, 12)} (git fetch)`
    if (tree !== pinnedTree) return `${KANBAN_SOURCE} не на закреплённом коммите ${pinned.slice(0, 12)} (git checkout или SISLEXA_KANBAN_SOURCE_ANY_COMMIT=1)`
    if (git('status', '--porcelain', '--untracked-files=no')) return `в ${KANBAN_SOURCE} есть незакоммиченные изменения`
  }
  return null
}

async function waitFor(url: string, what: string, child: ChildProcess, seconds = 90): Promise<void> {
  for (let i = 0; i < seconds; i++) {
    if (child.exitCode !== null) throw new Error(`${what} завершился с кодом ${child.exitCode}`)
    try { if ((await fetch(url)).ok) return } catch { /* ещё не поднялся */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`${what} не поднялся за ${seconds} с`)
}

async function startPostgres(): Promise<{ url: string; stop: () => void }> {
  if (process.env.VC_E2E_DB_URL) return { url: process.env.VC_E2E_DB_URL, stop: () => {} }
  const port = await freePort()
  const name = `vc-e2e-pg-${process.pid}-${port}`
  const run = spawnSync('docker', ['run', '-d', '--rm', '--name', name, '-p', `127.0.0.1:${port}:5432`, '-e', 'POSTGRES_PASSWORD=e2e', 'postgres:16-alpine'], { encoding: 'utf8' })
  if (run.status !== 0) throw new Error(`Postgres не запустился: ${run.stderr}`)
  const stop = () => { spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' }) }
  for (let i = 0; i < 60; i++) {
    // pg_isready внутри контейнера и подключение снаружи: порт публикуется не сразу.
    if (spawnSync('docker', ['exec', name, 'pg_isready', '-U', 'postgres'], { stdio: 'ignore' }).status === 0) {
      return { url: `postgres://postgres:e2e@127.0.0.1:${port}/postgres`, stop }
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  stop()
  throw new Error('Postgres не поднялся за 60 с')
}

export interface KanbanStand {
  base: string
  stop(): Promise<void>
}

/** Postgres → ядро (миграции общей базы — у ядра) → канбан. `env` добавляется обоим процессам. */
export async function startKanbanStand(opts: { adminPassword: string; env?: Record<string, string> }): Promise<KanbanStand> {
  const reason = kanbanStandUnavailable()
  if (reason) throw new Error(reason)
  const postgres = await startPostgres()
  const children: ChildProcess[] = []
  const dirs: string[] = []
  const stop = async (): Promise<void> => {
    for (const child of children.reverse()) child.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 500))
    postgres.stop()
    for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  }
  try {
    const port = await freePort(), kanbanPort = await freePort()
    const base = `http://127.0.0.1:${port}`, kanbanUrl = `http://127.0.0.1:${kanbanPort}`
    const shared = { VC_DB_URL: postgres.url, VC_INTERNAL_TOKEN: INTERNAL, VC_MCP_SECRET: MCP, VC_PUBLIC_URL: base, ...opts.env }
    const coreData = await mkdtemp(join(tmpdir(), 'vc-e2e-core-')), kanbanData = await mkdtemp(join(tmpdir(), 'vc-e2e-kanban-'))
    dirs.push(coreData, kanbanData)
    const log = process.env.VC_E2E_STAND_LOG === '1' ? 'inherit' : 'ignore'
    const core = spawn('npx', ['tsx', 'src/index.ts'], {
      cwd: join(ROOT, 'apps/server'),
      env: { ...process.env, ...shared, PORT: String(port), HOST: '127.0.0.1', VC_DATA_DIR: coreData, VC_WEB_DIR: WEB_DIST, VC_ADMIN_PASSWORD: opts.adminPassword,
        VC_KANBAN_MODE: 'remote', VC_KANBAN_URL: kanbanUrl, VC_KANBAN_MCP_PUBLIC_BASE: kanbanUrl },
      stdio: log
    })
    children.push(core)
    await waitFor(`${base}/api/health`, 'Ядро', core)
    const kanban = spawn('npx', ['tsx', 'src/kanban/standalone/index.ts'], {
      cwd: join(KANBAN_SOURCE, 'apps/server'),
      env: { ...process.env, ...shared, PORT: String(kanbanPort), HOST: '127.0.0.1', VC_DATA_DIR: kanbanData, VC_CORE_URL: base,
        VC_MCP_PUBLIC_BASE: base, VC_KANBAN_MCP_PUBLIC_BASE: kanbanUrl,
        // Модель стенду не нужна: адрес исполнителя обязателен при старте, но не вызывается.
        VC_LLM_RUNNER_URL: 'http://127.0.0.1:9' },
      stdio: log
    })
    children.push(kanban)
    await waitFor(`${kanbanUrl}/v1/health`, 'Канбан', kanban)
    return { base, stop }
  } catch (error) {
    await stop()
    throw error
  }
}
