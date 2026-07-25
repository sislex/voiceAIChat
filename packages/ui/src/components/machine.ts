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
  exec(agentId: string, command: string): Promise<AgentExecResult>
}

/** Вариант отображения виджета: карточка в сообщении или модалка из меню. */
export type UtilityVariant = 'embedded' | 'modal'
