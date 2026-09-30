// Сборка shell-команд для exec машины: значения экранируются, пользовательский ввод
// не конкатенируется в строку скрипта.

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
