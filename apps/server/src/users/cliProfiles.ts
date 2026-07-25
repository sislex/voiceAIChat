// Изолированные HOME для Claude Code / Codex CLI. История и состояние каждого
// пользователя живут отдельно; из общего контейнерного HOME копируются только
// файлы авторизации/конфигурации, без sessions/projects/history.

import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface CliProfileDirs {
  home: string
  claude: string
  codex: string
  ccProjects: string
  codexSessions: string
}

function profileKey(userId: string): string {
  return Buffer.from(userId, 'utf8').toString('base64url') || 'anonymous'
}

export function cliProfileDirs(dataDir: string, userId: string): CliProfileDirs {
  const home = join(dataDir, 'cli-users', profileKey(userId))
  const claude = join(home, '.claude')
  const codex = join(home, '.codex')
  return {
    home,
    claude,
    codex,
    ccProjects: join(claude, 'projects'),
    codexSessions: join(codex, 'sessions')
  }
}

function seedFile(source: string, target: string): void {
  if (existsSync(target) || !existsSync(source)) return
  try {
    copyFileSync(source, target)
    chmodSync(target, 0o600)
  } catch {
    // Профиль всё равно остаётся изолированным; UI покажет, что нужен login.
  }
}

/** Создаёт приватный профиль и при первом обращении копирует только auth/config. */
export function ensureCliProfile(dataDir: string, userId: string): CliProfileDirs {
  const dirs = cliProfileDirs(dataDir, userId)
  for (const dir of [dirs.home, dirs.claude, dirs.codex, dirs.ccProjects, dirs.codexSessions]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    try {
      chmodSync(dir, 0o700)
    } catch {
      // Не мешаем запуску на ФС без chmod.
    }
  }

  const sharedHome = homedir()
  seedFile(join(sharedHome, '.claude', '.credentials.json'), join(dirs.claude, '.credentials.json'))
  seedFile(join(sharedHome, '.claude', 'settings.json'), join(dirs.claude, 'settings.json'))
  seedFile(join(sharedHome, '.codex', 'auth.json'), join(dirs.codex, 'auth.json'))
  seedFile(join(sharedHome, '.codex', 'config.toml'), join(dirs.codex, 'config.toml'))
  return dirs
}

/** Окружение дочернего CLI, направляющее всё состояние в профиль пользователя. */
export function cliProfileEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    CODEX_HOME: join(home, '.codex')
  }
}
