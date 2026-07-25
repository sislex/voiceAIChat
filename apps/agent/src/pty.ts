// Живой PTY-терминал на машине через node-pty: интерактивный shell (fish/zsh/bash),
// стрим вывода чанками, ресайз, kill. Отдельно от exec.ts (тот — однострочный
// раннер с гейтом политики). Нативный модуль грузится лениво (createRequire),
// чтобы юнит-тесты без терминала не тянули native binding.
//
// Fallback: если @lydell/node-pty не собран (частый случай на Termux/Android),
// открываем shell через обычный pipe (child_process). Без настоящего TTY и ресайза,
// но интерактивный ввод-вывод работает — консоль остаётся полезной.

import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import type { AgentToServer } from '@voicechat/shared'
import { which } from './platform.js'

// Минимальная форма node-pty, которая нам нужна (без зависимости от типов пакета).
interface IPty {
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}
interface PtyModule {
  spawn(file: string, args: string[], opts: Record<string, unknown>): IPty
}

/** Общий интерфейс сессии — и нативной (node-pty), и pipe-fallback. */
interface PtySession {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

let ptyMod: PtyModule | null = null
function loadPty(): PtyModule {
  if (ptyMod) return ptyMod
  // В CJS-бандле (esbuild) доступен глобальный require; в ESM-dev (tsx) — import.meta.url.
  const req: NodeRequire =
    typeof require !== 'undefined' ? (require as NodeRequire) : createRequire(import.meta.url)
  ptyMod = req('@lydell/node-pty') as PtyModule
  return ptyMod
}

/** Активные PTY-сессии: ptyId → сессия. */
const sessions = new Map<string, PtySession>()

/** Выбор интерактивного shell: override → fish → zsh → bash → $SHELL → sh. */
export function pickShell(): string {
  if (process.env.VC_PTY_SHELL) return process.env.VC_PTY_SHELL
  for (const s of ['fish', 'zsh', 'bash']) {
    const p = which(s)
    if (p) return p
  }
  return process.env.SHELL || which('sh') || '/bin/sh'
}

function clampDim(v: number, fallback: number): number {
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback
}

/** Нативный терминал (node-pty). Кидает, если модуль недоступен. */
function startNative(ptyId: string, cols: number, rows: number, cwd: string, emit: (msg: AgentToServer) => void): void {
  const shell = pickShell()
  const term = loadPty().spawn(shell, [], {
    name: 'xterm-256color',
    cols: clampDim(cols, 80),
    rows: clampDim(rows, 24),
    cwd: cwd || process.env.HOME || process.cwd(),
    env: { ...process.env, TERM: 'xterm-256color' }
  })
  sessions.set(ptyId, term)
  term.onData((data) => emit({ t: 'pty.output', ptyId, data }))
  term.onExit(({ exitCode, signal }) => {
    sessions.delete(ptyId)
    emit({ t: 'pty.exit', ptyId, exitCode, signal })
  })
}

/**
 * Fallback через pipe: интерактивный shell без TTY. Вывод шлёт \n — конвертируем
 * в \r\n, чтобы xterm.js не рисовал «лесенку». Ресайз игнорируется.
 */
function startFallback(ptyId: string, cwd: string, emit: (msg: AgentToServer) => void): void {
  const shell = pickShell()
  const child = spawn(shell, ['-i'], {
    cwd: cwd || process.env.HOME || process.cwd(),
    env: { ...process.env, TERM: 'xterm-256color' },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  emit({
    t: 'pty.output',
    ptyId,
    data: '\r\n\x1b[33m[агент] нативный терминал недоступен — упрощённый режим (без TTY/ресайза)\x1b[0m\r\n'
  })
  const send = (d: Buffer): void =>
    emit({ t: 'pty.output', ptyId, data: d.toString().replace(/(?<!\r)\n/g, '\r\n') })
  child.stdout?.on('data', send)
  child.stderr?.on('data', send)
  child.on('error', (err) => {
    sessions.delete(ptyId)
    emit({ t: 'pty.error', ptyId, message: err.message })
  })
  child.on('close', (code) => {
    sessions.delete(ptyId)
    emit({ t: 'pty.exit', ptyId, exitCode: code ?? 0, signal: undefined })
  })
  sessions.set(ptyId, {
    write: (data: string) => void child.stdin?.write(data),
    resize: () => {},
    // Интерактивный shell игнорирует SIGTERM — валим жёстко.
    kill: () => void child.kill('SIGKILL')
  })
}

/** Открывает PTY и стримит вывод через emit. Повторный ptyId — игнор. */
export function startPty(
  ptyId: string,
  cols: number,
  rows: number,
  cwd: string,
  emit: (msg: AgentToServer) => void
): void {
  if (sessions.has(ptyId)) return
  // Явное принуждение к pipe-режиму (сломанный node-pty на Termux / тесты).
  if (process.env.VC_PTY_FORCE_FALLBACK) {
    try {
      startFallback(ptyId, cwd, emit)
    } catch (err) {
      emit({ t: 'pty.error', ptyId, message: err instanceof Error ? err.message : String(err) })
    }
    return
  }
  try {
    startNative(ptyId, cols, rows, cwd, emit)
  } catch {
    // node-pty не собран (Termux/Android и т.п.) — деградируем в pipe-режим.
    try {
      startFallback(ptyId, cwd, emit)
    } catch (err) {
      emit({ t: 'pty.error', ptyId, message: err instanceof Error ? err.message : String(err) })
    }
  }
}

/** Ввод пользователя (нажатия клавиш) в PTY. */
export function writePty(ptyId: string, data: string): void {
  sessions.get(ptyId)?.write(data)
}

/** Изменение размеров терминала. */
export function resizePty(ptyId: string, cols: number, rows: number): void {
  try {
    sessions.get(ptyId)?.resize(clampDim(cols, 80), clampDim(rows, 24))
  } catch {
    /* сессия уже закрыта или fallback без ресайза */
  }
}

/** Завершение PTY-сессии. */
export function killPty(ptyId: string): void {
  const term = sessions.get(ptyId)
  if (!term) return
  sessions.delete(ptyId)
  try {
    term.kill()
  } catch {
    /* уже завершён */
  }
}

/** Число активных PTY-сессий (для логов/тестов). */
export function ptyCount(): number {
  return sessions.size
}
