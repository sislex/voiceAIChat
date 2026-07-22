// Выполнение shell-команд: стрим stdout/stderr чанками, таймаут, отмена.
// Чистый модуль без WS — тестируется напрямую.

import { spawn } from 'node:child_process'
import type { AgentToServer } from '@voicechat/shared'

/** Активные команды: execId → процесс (для exec.cancel). */
const running = new Map<string, ReturnType<typeof spawn>>()

const SIGKILL_DELAY_MS = 5_000

export function runCommand(
  execId: string,
  command: string,
  timeoutMs: number,
  emit: (msg: AgentToServer) => void
): void {
  let child: ReturnType<typeof spawn>
  try {
    child = spawn(command, { shell: '/bin/bash' })
  } catch (err) {
    emit({ t: 'exec.error', execId, message: err instanceof Error ? err.message : String(err) })
    return
  }
  running.set(execId, child)

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    try {
      child.kill('SIGKILL')
    } catch {
      /* уже завершён */
    }
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

/** Отмена команды: SIGTERM, через 5с — SIGKILL, если не завершилась. */
export function cancelCommand(execId: string): void {
  const child = running.get(execId)
  if (!child) return
  try {
    child.kill('SIGTERM')
  } catch {
    return
  }
  const hardKill = setTimeout(() => {
    try {
      child.kill('SIGKILL')
    } catch {
      /* уже завершён */
    }
  }, SIGKILL_DELAY_MS)
  child.once('close', () => clearTimeout(hardKill))
}

/** Число активных команд (для логов/тестов). */
export function runningCount(): number {
  return running.size
}
