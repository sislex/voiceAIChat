// Живой PTY-терминал на машине через node-pty: интерактивный shell (fish/zsh/bash),
// стрим вывода чанками, ресайз, kill. Отдельно от exec.ts (тот — однострочный
// раннер с гейтом политики). Нативный модуль грузится лениво (createRequire),
// чтобы юнит-тесты без терминала не тянули native binding.

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { AgentToServer } from '@voicechat/shared'

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

let ptyMod: PtyModule | null = null
function loadPty(): PtyModule {
  if (ptyMod) return ptyMod
  // В CJS-бандле (esbuild) доступен глобальный require; в ESM-dev (tsx) — import.meta.url.
  // Ленивое разрешение: если модуля нет — startPty ловит ошибку и деградирует.
  const req: NodeRequire =
    typeof require !== 'undefined' ? (require as NodeRequire) : createRequire(import.meta.url)
  ptyMod = req('@lydell/node-pty') as PtyModule
  return ptyMod
}

/** Активные PTY-сессии: ptyId → процесс. */
const sessions = new Map<string, IPty>()

/** Первый найденный в PATH бинарь из списка (или null). */
function which(bin: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir && existsSync(join(dir, bin))) return join(dir, bin)
  }
  return null
}

/** Выбор интерактивного shell: override → fish → zsh → bash → $SHELL → sh. */
export function pickShell(): string {
  if (process.env.VC_PTY_SHELL) return process.env.VC_PTY_SHELL
  for (const s of ['fish', 'zsh', 'bash']) {
    const p = which(s)
    if (p) return p
  }
  return process.env.SHELL || '/bin/sh'
}

function clampDim(v: number, fallback: number): number {
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback
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
  const shell = pickShell()
  let term: IPty
  try {
    term = loadPty().spawn(shell, [], {
      name: 'xterm-256color',
      cols: clampDim(cols, 80),
      rows: clampDim(rows, 24),
      cwd: cwd || process.env.HOME || process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color' }
    })
  } catch (err) {
    emit({ t: 'pty.error', ptyId, message: err instanceof Error ? err.message : String(err) })
    return
  }
  sessions.set(ptyId, term)
  term.onData((data) => emit({ t: 'pty.output', ptyId, data }))
  term.onExit(({ exitCode, signal }) => {
    sessions.delete(ptyId)
    emit({ t: 'pty.exit', ptyId, exitCode, signal })
  })
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
    /* сессия уже закрыта */
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
