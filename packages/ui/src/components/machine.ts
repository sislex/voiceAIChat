// Общий контракт операций над машиной-агентом для самодостаточных виджетов
// (консоль/проводник). Реализуется стором поверх window.fs; в тестах — фейком.

import type { AgentExecResult, FsResult, FsCopyResult } from '@shared/agentProtocol'

export interface MachineOps {
  list(agentId: string, path: string): Promise<FsResult>
  /** Содержимое файла (base64) — например, чтобы показать картинку в сообщении. */
  read(agentId: string, path: string): Promise<FsResult>
  write(agentId: string, path: string, dataBase64: string): Promise<FsResult>
  remove(agentId: string, path: string): Promise<FsResult>
  /** Корзина машины (агент ≥ 0.15.0): элемент переезжает в `.voicechat_trash`, результат несёт trashedPath. */
  trash?(agentId: string, path: string): Promise<FsResult>
  /** Скопировать файл на другую машину пользователя (targetDir пуст — ChatAI/incoming цели). */
  copyTo?(agentId: string, path: string, targetAgentId: string, targetDir?: string): Promise<FsCopyResult>
  rename(agentId: string, from: string, to: string): Promise<FsResult>
  mkdir(agentId: string, path: string): Promise<FsResult>
  download(agentId: string, path: string, name: string): Promise<void>
  upload(agentId: string, dir: string, file: File): Promise<FsResult>
  /**
   * Выполнить команду на машине. `signal` — кнопка «Стоп» консоли: мост рвёт
   * запрос, сервер шлёт агенту `exec.cancel`. Мост без поддержки сигнала просто
   * его игнорирует — консоль всё равно перестаёт ждать результат.
   */
  exec(agentId: string, command: string, signal?: AbortSignal): Promise<AgentExecResult>
}

/**
 * Память набранных команд по машине: живёт в сторе, поэтому переживает закрытие
 * и повторное открытие утилиты (сама консоль — обычный компонент и умирает
 * вместе с окном). Не задана — история работает только внутри одного показа.
 */
export interface ConsoleHistoryStore {
  /** Команды этой машины в порядке набора (старые → новые). */
  get(agentId: string): string[]
  /** Запомнить выполненную команду. */
  push(agentId: string, command: string): void
}

/** Открытый PTY-сеанс = вкладка терминала машины. */
export interface PtySessionTab {
  /** Id сеанса на сервере: по нему идёт переподписка к тому же живому shell. */
  ptyId: string
  agentId: string
  /** Начальный каталог сеанса (подпись вкладки и cwd при первом старте). */
  cwd?: string
}

/** Снимок открытых вкладок; неизменяемый — его читает `useSyncExternalStore`. */
export interface PtySessionSnapshot {
  tabs: PtySessionTab[]
  activeId: string | null
}

/**
 * Открытые сеансы терминала: живут в сторе, а не в компоненте, поэтому переживают
 * закрытие утилиты и переключение машины — размонтирование xterm больше не убивает
 * shell (см. `docs/kb/machines.md`, «Жизненный цикл PTY-сеанса»). Сам PTY закрывает
 * тот, кто закрывает вкладку: стор только ведёт список.
 */
export interface PtySessionStore {
  snapshot(): PtySessionSnapshot
  subscribe(cb: () => void): () => void
  /** Вкладка машины: с тем же (agentId + cwd) переиспользуется, иначе заводится новая. */
  open(agentId: string, cwd?: string): string
  /** Всегда новый сеанс на машине — кнопка «Новый сеанс». */
  create(agentId: string, cwd?: string): string
  activate(ptyId: string): void
  /** Убрать вкладку из списка; `pty.kill` шлёт вызывающий. */
  close(ptyId: string): void
}

/** Вариант отображения виджета: карточка в сообщении или модалка из меню. */
export type UtilityVariant = 'embedded' | 'modal'

/** Что открыто в утилите машины: консоль/терминал или файловый проводник. */
export type UtilityKind = 'console' | 'explorer'

/**
 * Переключить утилиту на другую (переключатель общей шапки — `MachineUtilityHeader`):
 * из проводника в терминал и обратно. Машину передаёт сам виджет — ту, что выбрана
 * в его селекторе, а не «первую онлайн»; `dir` — текущая папка проводника или cwd
 * терминала, чтобы переход не терял место работы (нет папки — откроется корень
 * агента).
 */
export type SwitchUtility = (kind: UtilityKind, agentId: string, dir?: string) => void
