import { ipcMain } from 'electron'
import { IPC_CHANNELS, type IpcChannel } from '@shared/ipc'
import { createHandlers, type HandlerDeps, type Handlers } from './handlers'
import type { VoiceChatDb } from '../db/database'

/**
 * Регистрирует все IPC-каналы в ipcMain, делегируя чистым обработчикам.
 * Возвращает функцию отписки.
 */
export function registerIpc(db: VoiceChatDb, deps: HandlerDeps = {}): () => void {
  const handlers: Handlers = createHandlers(db, deps)

  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, async (_event, arg) => {
      const handler = handlers[channel as IpcChannel] as (a: unknown) => unknown
      return await handler(arg)
    })
  }

  return () => {
    for (const channel of IPC_CHANNELS) ipcMain.removeHandler(channel)
  }
}
