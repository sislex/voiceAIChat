// Определение платформы и разрешение shell/каталогов. Вынесено отдельно, чтобы
// exec.ts и pty.ts выбирали рабочий shell одинаково — критично для Termux (Android),
// где НЕТ /bin/bash, а бинарники лежат в /data/data/com.termux/files/usr/bin.

import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/** Корень Termux (там bin/, home/, etc/). */
export const TERMUX_PREFIX = '/data/data/com.termux/files/usr'
const TERMUX_BIN = `${TERMUX_PREFIX}/bin`
const TERMUX_HOME = '/data/data/com.termux/files/home'

/** Запущены ли мы внутри Termux (Android). */
export function isTermux(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.TERMUX_VERSION) return true
  if (env.PREFIX && env.PREFIX.includes('com.termux')) return true
  return existsSync(TERMUX_BIN)
}

/** Каталоги поиска бинарников: PATH + Termux bin (на случай урезанного PATH). */
function searchDirs(env: NodeJS.ProcessEnv): string[] {
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean)
  if (isTermux(env) && !dirs.includes(TERMUX_BIN)) dirs.push(TERMUX_BIN)
  return dirs
}

/** Первый найденный бинарь из PATH (и Termux bin), иначе null. */
export function which(bin: string, env: NodeJS.ProcessEnv = process.env): string | null {
  for (const dir of searchDirs(env)) {
    if (existsSync(join(dir, bin))) return join(dir, bin)
  }
  return null
}

/**
 * Путь к shell для запуска команд. Порядок: VC_PTY_SHELL/SHELL override →
 * bash/zsh/fish/sh из PATH (с учётом Termux) → /bin/bash → /bin/sh → 'sh'.
 * На Termux /bin/bash отсутствует — поэтому ищем по PATH, а не хардкодим путь.
 */
export function resolveShell(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.VC_PTY_SHELL || env.SHELL
  if (override && existsSync(override)) return override
  for (const s of ['bash', 'zsh', 'fish', 'sh']) {
    const p = which(s, env)
    if (p) return p
  }
  if (existsSync('/bin/bash')) return '/bin/bash'
  if (existsSync('/bin/sh')) return '/bin/sh'
  return 'sh'
}

/** Корневой каталог проводника по умолчанию: VC_AGENT_ROOT → Termux $HOME → cwd. */
export function defaultRootDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.VC_AGENT_ROOT) return env.VC_AGENT_ROOT
  if (isTermux(env)) return env.HOME || TERMUX_HOME
  return process.cwd()
}
