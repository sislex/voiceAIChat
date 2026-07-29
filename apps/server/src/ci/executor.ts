// Исполнитель CI-команд поверх потокового exec машины (AgentRegistry.execStream).
// Собирает безопасную команду: cd в рабочую директорию + export переменных
// окружения (значения shell-экранируются — пользовательский ввод НЕ конкатенируется
// в строку скрипта), затем сам скрипт. Секреты маскируются в потоке лога.

import type { CommandExecRequest, CommandExecResult, CommandExecutor } from './types.js'

/** Минимальный интерфейс реестра (для инъекции/моков). */
export interface ExecStreamCapable {
  execStream(
    agentId: string,
    command: string,
    timeoutMs: number,
    onChunk: (data: string) => void,
    signal?: AbortSignal
  ): Promise<{ exitCode: number | null; timedOut: boolean }>
}

/** Одинарные кавычки для bash: закрыть-экранировать-открыть. */
export function shellQuote(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`
}

/** Валидное имя переменной окружения. */
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Строит итоговую команду: `cd -- <workdir> && export K=V … && ( <script> )`.
 * Значения окружения экранируются, ключи-мусор отбрасываются. Скрипт выполняется
 * в подоболочке, чтобы его `exit`/`cd` не ломали префикс.
 */
export function buildShellCommand(script: string, workdir: string, env: Record<string, string>): string {
  const parts: string[] = []
  if (workdir) parts.push(`cd -- ${shellQuote(workdir)}`)
  for (const [k, v] of Object.entries(env)) {
    if (!ENV_KEY.test(k)) continue
    parts.push(`export ${k}=${shellQuote(v)}`)
  }
  const prefix = parts.length ? parts.join(' && ') + ' && ' : ''
  return `${prefix}(\n${script}\n)`
}

/** Функция маскирования: заменяет вхождения секретов на ***. */
export function maskSecrets(secrets: string[]): (s: string) => string {
  const real = secrets.filter((x) => x && x.length >= 4)
  if (!real.length) return (s) => s
  return (s) => {
    let out = s
    for (const sec of real) out = out.split(sec).join('***')
    return out
  }
}

export class AgentCommandExecutor implements CommandExecutor {
  constructor(private readonly registry: ExecStreamCapable) {}

  run(req: CommandExecRequest, onChunk: (data: string) => void, signal?: AbortSignal): Promise<CommandExecResult> {
    const command = buildShellCommand(req.script, req.workdir, req.env)
    const mask = maskSecrets(req.secrets ?? [])
    return this.registry
      .execStream(req.agentId, command, req.timeoutMs, (d) => onChunk(mask(d)), signal)
      .then((r) => ({ exitCode: r.exitCode, timedOut: r.timedOut }))
  }
}
