// Определение платформы и разрешение shell/каталогов. Вынесено отдельно, чтобы
// exec.ts и pty.ts выбирали рабочий shell одинаково — критично для Termux (Android),
// где НЕТ /bin/bash, а бинарники лежат в /data/data/com.termux/files/usr/bin,
// и для Windows, где POSIX-shell нет вовсе (работаем через cmd.exe/PowerShell).

import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/** Корень Termux (там bin/, home/, etc/). */
export const TERMUX_PREFIX = '/data/data/com.termux/files/usr'
const TERMUX_BIN = `${TERMUX_PREFIX}/bin`
const TERMUX_HOME = '/data/data/com.termux/files/home'

/** Windows? Платформа — параметром, чтобы win32-ветки тестировались на POSIX-CI. */
export function isWindows(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32'
}

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
export function which(
  bin: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string | null {
  // На Windows исполняемые файлы имеют расширение (PATHEXT); голое имя не найдётся.
  const names =
    isWindows(platform) && !/\.[^\\/]+$/.test(bin) ? [bin + '.exe', bin + '.cmd', bin + '.bat'] : [bin]
  for (const dir of searchDirs(env)) {
    for (const name of names) {
      if (existsSync(join(dir, name))) return join(dir, name)
    }
  }
  return null
}

/**
 * Путь к shell для запуска команд. Порядок: VC_PTY_SHELL/SHELL override →
 * bash/zsh/fish/sh из PATH (с учётом Termux) → /bin/bash → /bin/sh → 'sh'.
 * На Termux /bin/bash отсутствует — поэтому ищем по PATH, а не хардкодим путь.
 * На Windows — cmd.exe (ComSpec): spawn(команда, {shell}) корректно квотит
 * аргументы только под cmd, а не под PowerShell.
 */
export function resolveShell(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  const override = env.VC_PTY_SHELL || env.SHELL
  if (override && existsSync(override)) return override
  if (isWindows(platform)) return env.ComSpec || 'cmd.exe'
  for (const s of ['bash', 'zsh', 'fish', 'sh']) {
    const p = which(s, env, platform)
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
