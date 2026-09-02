import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { isTermux, which } from './platform.js'

export interface WakeLockHandle {
  release(): void
}

export interface WakeLockDeps {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  pid?: number
  findBinary?: (name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform) => string | null
  spawn?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess
  warn?: (message: string) => void
  log?: (message: string) => void
}

const noopHandle: WakeLockHandle = { release: () => {} }

function commandWarning(warn: (message: string) => void, command: string, detail: unknown): void {
  const reason = detail instanceof Error ? detail.message : String(detail)
  warn(`[agent] wake lock: команда ${command} завершилась с ошибкой: ${reason}`)
}

function watchCommand(
  child: ChildProcess,
  command: string,
  warn: (message: string) => void,
  persistent: boolean
): void {
  child.once('error', (error) => commandWarning(warn, command, error))
  child.once('exit', (code, signal) => {
    if (code && code !== 0) commandWarning(warn, command, `exit code ${code}`)
    else if (persistent && signal === null) commandWarning(warn, command, 'процесс завершился раньше агента')
  })
}

/** Best-effort wake lock, принадлежащий жизненному циклу процесса агента. */
export function acquireWakeLock(deps: WakeLockDeps = {}): WakeLockHandle {
  const platform = deps.platform ?? process.platform
  const env = deps.env ?? process.env
  const pid = deps.pid ?? process.pid
  const findBinary = deps.findBinary ?? which
  const spawnCommand = deps.spawn ?? ((command, args, options) => spawn(command, args, options))
  const warn = deps.warn ?? ((message) => console.warn(message))
  const log = deps.log ?? ((message) => console.log(message))

  if (platform === 'darwin') {
    const command = findBinary('caffeinate', env, platform)
    if (!command) {
      warn('[agent] wake lock: команда caffeinate не найдена; продолжаю без защиты от idle sleep')
      return noopHandle
    }
    let child: ChildProcess
    try {
      // -i запрещает только system idle sleep; -w связывает assertion с PID агента.
      child = spawnCommand(command, ['-i', '-w', String(pid)], { stdio: 'ignore', env })
      watchCommand(child, 'caffeinate', warn, true)
      log(`[agent] wake lock: caffeinate привязан к pid ${pid}`)
    } catch (error) {
      commandWarning(warn, 'caffeinate', error)
      return noopHandle
    }
    let released = false
    return {
      release: () => {
        if (released) return
        released = true
        try {
          if (child.exitCode === null && child.signalCode === null && !child.kill()) {
            commandWarning(warn, 'caffeinate', 'не удалось завершить дочерний процесс')
          }
        } catch (error) {
          commandWarning(warn, 'caffeinate', error)
        }
      }
    }
  }

  if (!isTermux(env)) return noopHandle

  const lockCommand = findBinary('termux-wake-lock', env, platform)
  if (!lockCommand) {
    warn('[agent] wake lock: команда termux-wake-lock не найдена; установите Termux:API и пакет termux-api')
    return noopHandle
  }
  try {
    const child = spawnCommand(lockCommand, [], { stdio: 'ignore', env })
    watchCommand(child, 'termux-wake-lock', warn, false)
    log('[agent] wake lock: Termux lock запрошен')
  } catch (error) {
    commandWarning(warn, 'termux-wake-lock', error)
    return noopHandle
  }

  let released = false
  return {
    release: () => {
      if (released) return
      released = true
      const unlockCommand = findBinary('termux-wake-unlock', env, platform)
      if (!unlockCommand) {
        warn('[agent] wake lock: команда termux-wake-unlock не найдена; lock не удалось освободить штатно')
        return
      }
      try {
        const child = spawnCommand(unlockCommand, [], { stdio: 'ignore', env })
        watchCommand(child, 'termux-wake-unlock', warn, false)
      } catch (error) {
        commandWarning(warn, 'termux-wake-unlock', error)
      }
    }
  }
}

