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
import { readFileSync, readlinkSync } from 'node:fs'
import type { AgentToServer, PtyContext } from '@voicechat/shared'
import { consolePtyId } from '@voicechat/shared'
import { commandEnv, isWindows, resolveShell } from './platform.js'

/** Префикс ptyId консоли с ассистентом — только у них отслеживаем контекст. */
const CONSOLE_PTY_PREFIX = consolePtyId('')

// Минимальная форма node-pty, которая нам нужна (без зависимости от типов пакета).
interface IPty {
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  /** pid shell-процесса — нужен для чтения контекста из /proc (Linux). */
  pid?: number
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
  // В CJS-бандле доступен глобальный require. В ESM-dev резолвим зависимости
  // относительно рабочего проекта; import.meta не используем, чтобы esbuild
  // не подменял его пустым объектом при сборке CommonJS.
  const req: NodeRequire = typeof require !== 'undefined'
    ? (require as NodeRequire)
    : createRequire(`${process.cwd()}/package.json`)
  ptyMod = req('@lydell/node-pty') as PtyModule
  return ptyMod
}

/** Активные PTY-сессии: ptyId → сессия. */
const sessions = new Map<string, PtySession>()

function clampDim(v: number, fallback: number): number {
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback
}

// --- Контекст консоли (cwd/foreground/altScreen) ---------------------------
// Только для PTY консоли-с-ассистентом и только на Linux (через /proc). На других
// платформах поля остаются неизвестны — это ожидаемая деградация.

const ctxTimers = new Map<string, NodeJS.Timeout>()
const altScreenState = new Map<string, boolean>()
const lastCtxSent = new Map<string, string>()

function isConsolePty(ptyId: string): boolean {
  return ptyId.startsWith(CONSOLE_PTY_PREFIX)
}

/** Отслеживаем вход/выход из альтернативного экрана (полноэкранный TUI). */
function scanAltScreen(ptyId: string, data: string): void {
  if (data.includes('\x1b[?1049h') || data.includes('\x1b[?47h')) altScreenState.set(ptyId, true)
  if (data.includes('\x1b[?1049l') || data.includes('\x1b[?47l')) altScreenState.set(ptyId, false)
}

/** Рабочий каталог shell из /proc/<pid>/cwd (Linux); null — не удалось. */
function readCwd(pid: number): string | null {
  try {
    return readlinkSync(`/proc/${pid}/cwd`)
  } catch {
    return null
  }
}

/** Процесс в фокусе терминала: tpgid из /proc/<pid>/stat → имя из comm. */
function readForeground(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    // comm может содержать пробелы/скобки — берём всё после последней ')'.
    const rest = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)
    // rest: state ppid pgrp session tty_nr tpgid ...
    const tpgid = Number(rest[5])
    if (!Number.isFinite(tpgid) || tpgid <= 0) return null
    const comm = readFileSync(`/proc/${tpgid}/comm`, 'utf8').trim()
    return comm || null
  } catch {
    return null
  }
}

function computeContext(ptyId: string, pid: number): PtyContext {
  return {
    cwd: readCwd(pid),
    foreground: readForeground(pid),
    altScreen: altScreenState.get(ptyId) ?? false
  }
}

/** Раз в секунду шлём контекст сессии серверу — только при изменении. */
function startContextTracking(ptyId: string, pid: number | undefined, emit: (msg: AgentToServer) => void): void {
  if (!isConsolePty(ptyId) || process.platform !== 'linux' || !pid) return
  const tick = (): void => {
    const context = computeContext(ptyId, pid)
    const serialized = JSON.stringify(context)
    if (lastCtxSent.get(ptyId) === serialized) return
    lastCtxSent.set(ptyId, serialized)
    emit({ t: 'pty.context', ptyId, context })
  }
  tick()
  const timer = setInterval(tick, 1000)
  timer.unref?.()
  ctxTimers.set(ptyId, timer)
}

function stopContextTracking(ptyId: string): void {
  const timer = ctxTimers.get(ptyId)
  if (timer) clearInterval(timer)
  ctxTimers.delete(ptyId)
  altScreenState.delete(ptyId)
  lastCtxSent.delete(ptyId)
}

/** Нативный терминал (node-pty). Кидает, если модуль недоступен. */
function startNative(ptyId: string, cols: number, rows: number, cwd: string, emit: (msg: AgentToServer) => void): void {
  const shell = resolveShell()
  const term = loadPty().spawn(shell, [], {
    name: 'xterm-256color',
    cols: clampDim(cols, 80),
    rows: clampDim(rows, 24),
    cwd: cwd || process.env.HOME || process.cwd(),
    env: { ...commandEnv(), TERM: 'xterm-256color' }
  })
  sessions.set(ptyId, term)
  term.onData((data) => {
    scanAltScreen(ptyId, data)
    emit({ t: 'pty.output', ptyId, data })
  })
  term.onExit(({ exitCode, signal }) => {
    sessions.delete(ptyId)
    stopContextTracking(ptyId)
    emit({ t: 'pty.exit', ptyId, exitCode, signal })
  })
  startContextTracking(ptyId, term.pid, emit)
}

/**
 * Fallback через pipe: интерактивный shell без TTY. Вывод шлёт \n — конвертируем
 * в \r\n, чтобы xterm.js не рисовал «лесенку». Ресайз игнорируется.
 */
function startFallback(ptyId: string, cwd: string, emit: (msg: AgentToServer) => void): void {
  const shell = resolveShell()
  // cmd.exe/PowerShell интерактивны по умолчанию и не знают флага -i.
  const child = spawn(shell, isWindows() ? [] : ['-i'], {
    cwd: cwd || process.env.HOME || process.cwd(),
    env: { ...commandEnv(), TERM: 'xterm-256color' },
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
  stopContextTracking(ptyId)
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
