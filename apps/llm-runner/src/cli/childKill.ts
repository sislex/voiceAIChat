// Остановка процесса CLI (claude/codex) по отмене хода. Вынесено из обоих
// клиентов: одного SIGTERM мало — CLI может застрять на своём дочернем процессе
// или на сетевом запросе, а отменённый CI-ран не должен оставлять живой процесс
// (очередь ранов ждала именно этого, см. docs/kb/features/ci-runner.md).

import type { ChildProcess } from 'node:child_process'

/** Через сколько после SIGTERM добиваем SIGKILL. */
export const CLI_SIGKILL_DELAY_MS = 5_000

/**
 * SIGTERM процессу CLI, затем — если он не завершился за `delayMs` — SIGKILL.
 * Возврат: функция снятия отложенного SIGKILL (не нужна вызывающим, но удобна в тестах).
 */
export function killCliChild(child: ChildProcess, delayMs = CLI_SIGKILL_DELAY_MS): () => void {
  const send = (signal: NodeJS.Signals): void => {
    // `!= null`, а не `!== null`: у моков процесса полей нет (undefined), и
    // строгая проверка молча пропускала бы kill.
    if (child.exitCode != null || child.signalCode != null) return
    try {
      child.kill(signal)
    } catch {
      /* уже завершён */
    }
  }
  send('SIGTERM')
  const hard = setTimeout(() => send('SIGKILL'), delayMs)
  hard.unref?.()
  const clear = (): void => clearTimeout(hard)
  child.once('close', clear)
  return clear
}
