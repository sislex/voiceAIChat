// Определение платформы и разрешение shell/каталогов. Вынесено отдельно, чтобы
// exec.ts и pty.ts выбирали рабочий shell одинаково — критично для Termux (Android),
// где НЕТ /bin/bash, а бинарники лежат в /data/data/com.termux/files/usr/bin,
// и для Windows, где ищем настоящий bash.exe (Git for Windows) и только если
// его нет — деградируем в cmd.exe.

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

/**
 * Окружение дочерних команд агента. Node-gyp на Android ожидает gyp-переменную
 * android_ndk_path, но npm/Termux не задают её автоматически даже при наличии
 * системного ndk-sysroot. Без неё сборка любого нативного addon падает ещё на
 * configure. Сохраняем пользовательские GYP_DEFINES и добавляем только
 * отсутствующее определение.
 */
export function commandEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result = { ...env }
  if (!isTermux(env) || /(?:^|\s)android_ndk_path=/.test(env.GYP_DEFINES ?? '')) return result
  const prefix = env.PREFIX || TERMUX_PREFIX
  result.GYP_DEFINES = [env.GYP_DEFINES, `android_ndk_path=${prefix}`].filter(Boolean).join(' ')
  return result
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
 * Известные пути установки Git for Windows (portable/обычная установка), где
 * лежит bash.exe, если его нет в PATH. Порядок — от системной установки к
 * пользовательской (LOCALAPPDATA — типичный путь portable-Git без прав администратора).
 */
function knownGitBashPaths(env: NodeJS.ProcessEnv): string[] {
  const roots = [env.ProgramFiles, env.ProgramW6432, env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Programs') : undefined]
  return roots.filter((r): r is string => Boolean(r)).map((root) => join(root, 'Git', 'bin', 'bash.exe'))
}

/** Ищет bash.exe по известным путям Git for Windows (не через PATH). */
function findKnownGitBash(env: NodeJS.ProcessEnv): string | null {
  for (const p of knownGitBashPaths(env)) {
    if (existsSync(p)) return p
  }
  return null
}

/** Похож ли override на Unix-путь (`/bin/bash`) — на Windows такой путь не существует. */
function isUnixLikePath(p: string): boolean {
  return p.startsWith('/')
}

/** Результат разрешения shell: сам путь + признак деградации (для UI/лога). */
export interface ShellResolution {
  shell: string
  /** true — на Windows не нашли bash.exe и упали в cmd.exe (ограниченная функциональность). */
  degraded: boolean
  /** Override (SHELL/VC_PTY_SHELL) был задан, но проигнорирован — Unix-путь на Windows. */
  ignoredOverride?: string
}

/**
 * Путь к shell для запуска команд (с деталями для диагностики). Порядок:
 * VC_PTY_SHELL/SHELL override (кроме Unix-подобных путей на Windows — их
 * игнорируем, отмечая в ignoredOverride) → на Windows: bash.exe из PATH →
 * bash.exe по известным путям Git for Windows → cmd.exe (ComSpec) как
 * деградация → на остальных ОС: bash/zsh/fish/sh из PATH (с учётом Termux) →
 * /bin/bash → /bin/sh → 'sh'.
 */
export function resolveShellInfo(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): ShellResolution {
  const override = env.VC_PTY_SHELL || env.SHELL
  let ignoredOverride: string | undefined
  if (override) {
    if (isWindows(platform) && isUnixLikePath(override)) {
      // Unix-подобный SHELL долетает на Windows из унаследованного окружения
      // (напр. Git Bash сам себя запустил) — как путь для spawn он не годится.
      ignoredOverride = override
    } else if (existsSync(override)) {
      return { shell: override, degraded: false }
    }
  }

  if (isWindows(platform)) {
    const bash = which('bash', env, platform) ?? findKnownGitBash(env)
    if (bash) return { shell: bash, degraded: false, ...(ignoredOverride ? { ignoredOverride } : {}) }
    return { shell: env.ComSpec || 'cmd.exe', degraded: true, ...(ignoredOverride ? { ignoredOverride } : {}) }
  }

  for (const s of ['bash', 'zsh', 'fish', 'sh']) {
    const p = which(s, env, platform)
    if (p) return { shell: p, degraded: false }
  }
  if (existsSync('/bin/bash')) return { shell: '/bin/bash', degraded: false }
  if (existsSync('/bin/sh')) return { shell: '/bin/sh', degraded: false }
  return { shell: 'sh', degraded: false }
}

/** Путь к shell для запуска команд — см. `resolveShellInfo` за деталями выбора. */
export function resolveShell(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveShellInfo(env, platform).shell
}

/** Корневой каталог проводника по умолчанию: VC_AGENT_ROOT → Termux $HOME → cwd. */
export function defaultRootDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.VC_AGENT_ROOT) return env.VC_AGENT_ROOT
  if (isTermux(env)) return env.HOME || TERMUX_HOME
  return process.cwd()
}
