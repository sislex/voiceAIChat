// Сервис Проводника Codex (desktop): live-tail активной сессии.
// Принимает cx:tailStart/cx:tailStop из renderer, шлёт новые записи событием cx:tail.

import { ipcMain } from 'electron'
import type { IpcEventChannel, IpcEventPayload, IpcSendPayload } from '@shared/ipc'
import { watchCxTranscript } from './codexSessions'

export interface CodexServiceDeps {
  send: <C extends IpcEventChannel>(channel: C, payload: IpcEventPayload<C>) => void
}

export interface CodexService {
  dispose(): void
}

export function createCodexService(deps: CodexServiceDeps): CodexService {
  let stop: (() => void) | null = null

  const onStart = (_e: unknown, payload: IpcSendPayload<'cx:tailStart'>): void => {
    stop?.()
    const { id } = payload
    stop = watchCxTranscript(id, (items) => deps.send('cx:tail', { id, items }))
  }
  const onStop = (): void => {
    stop?.()
    stop = null
  }

  ipcMain.on('cx:tailStart', onStart)
  ipcMain.on('cx:tailStop', onStop)

  return {
    dispose() {
      ipcMain.removeListener('cx:tailStart', onStart)
      ipcMain.removeListener('cx:tailStop', onStop)
      stop?.()
      stop = null
    }
  }
}
