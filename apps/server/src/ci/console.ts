// Диагностическая консоль рана (US-6): выполнение команд в рабочей директории рана.
// По умолчанию read-only — разрешён только белый список безопасных команд; запись в
// ФС/сеть запрещена. Режим редактирования — отдельное право (владелец проекта) с
// аудит-логом. Здесь только проверка команды и запуск; переключение режима и
// таймер авто-возврата ведёт вызывающий (in-memory), запись в аудит — тоже.

/** Первое слово команды (бинарь). */
function head(command: string): string {
  return command.trim().split(/\s+/)[0] ?? ''
}

/** Безопасные для чтения бинарники. */
const READONLY_BINS = new Set(['ls', 'cat', 'pwd', 'head', 'tail', 'wc', 'grep', 'find', 'echo', 'env', 'tree', 'stat', 'du', 'file', 'which', 'whoami', 'date', 'df'])
/** Безопасные подкоманды git (только чтение). */
const READONLY_GIT = new Set(['status', 'log', 'diff', 'show', 'branch', 'remote', 'rev-parse', 'describe', 'ls-files', 'blame', 'config'])

/** Разрешена ли команда в read-only режиме (одиночная, без цепочек/редиректов). */
export function isReadOnlyCommand(command: string): boolean {
  const c = command.trim()
  // Цепочки, подстановки, редиректы, фоновый запуск — запрещены (обход белого списка).
  if (/[;&|><`$()]/.test(c)) return false
  const bin = head(c)
  if (bin === 'git') {
    const sub = c.split(/\s+/)[1] ?? ''
    // git config только чтение (без записи: наличие --unset/значения не проверяем строго — запрет set)
    if (sub === 'config' && /\s(--global|--unset|--add)\b/.test(c)) return false
    return READONLY_GIT.has(sub)
  }
  return READONLY_BINS.has(bin)
}
