// Общий контракт операций над машиной-агентом для самодостаточных виджетов
// (консоль/проводник). Реализуется стором поверх window.fs; в тестах — фейком.

import type { AgentExecResult, FsResult } from '@shared/agentProtocol'

export interface MachineOps {
  list(agentId: string, path: string): Promise<FsResult>
  /** Содержимое файла (base64) — например, чтобы показать картинку в сообщении. */
  read(agentId: string, path: string): Promise<FsResult>
  write(agentId: string, path: string, dataBase64: string): Promise<FsResult>
  remove(agentId: string, path: string): Promise<FsResult>
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

/** Вариант отображения виджета: карточка в сообщении или модалка из меню. */
export type UtilityVariant = 'embedded' | 'modal'
