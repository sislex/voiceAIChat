// Выполнение shell-команд: стрим stdout/stderr чанками, таймаут, отмена.
// Чистый модуль без WS — тестируется напрямую.

import { spawn } from 'node:child_process'
import type { AgentToServer } from '@voicechat/shared'
import { isWindows, resolveShell } from './platform.js'

/** Активные команды: execId → процесс (для exec.cancel). */
const running = new Map<string, ReturnType<typeof spawn>>()

const SIGKILL_DELAY_MS = 5_000

/**
 * Убить процесс команды ВМЕСТЕ С ДЕТЬМИ. Сигнал одному shell'у оставлял живыми
 * его потомков (`npm ci`, `claude`, тесты) — отменённый CI-ран продолжал работать
 * на машине, и очередь ранов стояла на осиротевшем процессе.
 *
 * POSIX: команда запускается в своей группе процессов (`detached`), поэтому шлём
 * сигнал всей группе (`-pid`). Windows: групп процессов нет — снимаем дерево
 * через `taskkill /T`.
 */
export function killProcessTree(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  const pid = child.pid
  if (!pid || child.exitCode != null || child.signalCode != null) return
  if (isWindows()) {
    try {
      // /T — вместе с дочерними, /F — принудительно (SIGTERM на Windows нет).
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).unref()
    } catch {
      try {
        child.kill(signal)
      } catch {
        /* уже завершён */
      }
    }
    return
  }
  try {
    process.kill(-pid, signal)
  } catch {
    // Группы может не быть (процесс уже умер или detached не сработал) — бьём по pid.
    try {
      child.kill(signal)
    } catch {
      /* уже завершён */
    }
  }
}

export function runCommand(
  execId: string,
  command: string,
  timeoutMs: number,
  emit: (msg: AgentToServer) => void
): void {
  let child: ReturnType<typeof spawn>
  try {
    // Shell определяем динамически: на Termux /bin/bash нет (см. platform.resolveShell).
    // detached — своя группа процессов, чтобы отмена/таймаут снимали всё дерево.
    child = spawn(command, { shell: resolveShell(), detached: !isWindows() })
  } catch (err) {
    emit({ t: 'exec.error', execId, message: err instanceof Error ? err.message : String(err) })
    return
  }
  running.set(execId, child)

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    killProcessTree(child, 'SIGKILL')
  }, timeoutMs)

  child.stdout?.on('data', (d: Buffer) =>
    emit({ t: 'exec.chunk', execId, stream: 'stdout', data: d.toString() })
  )
  child.stderr?.on('data', (d: Buffer) =>
    emit({ t: 'exec.chunk', execId, stream: 'stderr', data: d.toString() })
  )
  child.on('error', (err) => {
    clearTimeout(timer)
    running.delete(execId)
    emit({ t: 'exec.error', execId, message: err.message })
  })
  child.on('close', (code) => {
    clearTimeout(timer)
    running.delete(execId)
    emit({ t: 'exec.done', execId, exitCode: code, timedOut: timedOut || undefined })
  })
}

/** Отмена команды: SIGTERM всему дереву, через 5с — SIGKILL, если не завершилась. */
export function cancelCommand(execId: string): void {
  const child = running.get(execId)
  if (!child) return
  killProcessTree(child, 'SIGTERM')
  const hardKill = setTimeout(() => killProcessTree(child, 'SIGKILL'), SIGKILL_DELAY_MS)
  hardKill.unref?.()
  child.once('close', () => clearTimeout(hardKill))
}

/** Число активных команд (для логов/тестов). */
export function runningCount(): number {
  return running.size
}
