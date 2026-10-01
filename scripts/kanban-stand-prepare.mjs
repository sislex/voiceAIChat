// Чекаут sislex/sislexa-kanban на коммите, закреплённом compose ядра, для e2e-стенда «ядро + канбан»
// (e2e/kanbanStand.ts). Кэшируется по коммиту: повторный запуск ничего не делает.
//
//   node scripts/kanban-stand-prepare.mjs   печатает путь чекаута
//
// Каталог кэша — VC_E2E_KANBAN_CACHE или ~/.cache/sislexa/kanban; источник — SISLEXA_KANBAN_REPOSITORY
// или https://github.com/sislex/sislexa-kanban.git (доступ к git — как у самого ядра на машине).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')

export function pinnedKanbanCommit(compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8')) {
  const commit = /sislexa-kanban:([0-9a-f]{40})/.exec(compose)?.[1]
  if (!commit) throw new Error('compose ядра не закрепляет образ sislexa-kanban')
  return commit
}

export function kanbanCacheDir(commit, env = process.env) {
  return join(env.VC_E2E_KANBAN_CACHE ?? join(homedir(), '.cache', 'sislexa', 'kanban'), commit)
}

export function prepareKanbanStand(env = process.env, run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: ['ignore', 'ignore', 'inherit'] })) {
  const commit = pinnedKanbanCommit()
  const dir = kanbanCacheDir(commit, env)
  const ready = join(dir, '.sislexa-e2e-ready')
  if (existsSync(ready) && readFileSync(ready, 'utf8').trim() === commit) return dir
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  run('git', ['init', '-q'], dir)
  run('git', ['fetch', '-q', '--depth', '1', env.SISLEXA_KANBAN_REPOSITORY ?? 'https://github.com/sislex/sislexa-kanban.git', commit], dir)
  run('git', ['checkout', '-q', '--detach', 'FETCH_HEAD'], dir)
  run('npm', ['ci', '--no-audit', '--no-fund'], dir)
  writeFileSync(ready, commit + '\n')
  return dir
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(prepareKanbanStand()) } catch (error) { console.error(error.message); process.exitCode = 1 }
}
