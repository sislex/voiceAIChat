// Сервис Проводника Claude Code (desktop): live-tail активной сессии.
// Принимает cc:tailStart/cc:tailStop из renderer, шлёт новые записи событием cc:tail.

import { ipcMain } from 'electron'
import type { IpcEventChannel, IpcEventPayload, IpcSendPayload } from '@shared/ipc'
import { watchTranscript } from './ccSessions'

export interface CcServiceDeps {
  send: <C extends IpcEventChannel>(channel: C, payload: IpcEventPayload<C>) => void
}

export interface CcService {
  dispose(): void
}

export function createCcService(deps: CcServiceDeps): CcService {
  let stop: (() => void) | null = null

  const onStart = (_e: unknown, payload: IpcSendPayload<'cc:tailStart'>): void => {
    stop?.()
    const { slug, id } = payload
    stop = watchTranscript(slug, id, (items) => deps.send('cc:tail', { slug, id, items }))
  }
  const onStop = (): void => {
    stop?.()
    stop = null
  }

  ipcMain.on('cc:tailStart', onStart)
  ipcMain.on('cc:tailStop', onStop)

  return {
    dispose() {
      ipcMain.removeListener('cc:tailStart', onStart)
      ipcMain.removeListener('cc:tailStop', onStop)
      stop?.()
      stop = null
    }
  }
}
