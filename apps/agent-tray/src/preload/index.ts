// Мост renderer ↔ main для окон настройки и журнала.

import { contextBridge, ipcRenderer } from 'electron'

export interface AgentState {
  status: 'connecting' | 'online' | 'offline' | 'stopped' | 'unconfigured'
  name: string | null
  log: string[]
}

const api = {
  /** Отправить строку подключения; вернёт ошибку, если не распознана. */
  submitConnection: (str: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('agent:submitConnection', str),
  /** Текущее состояние + буфер журнала (при открытии окна). */
  getState: (): Promise<AgentState> => ipcRenderer.invoke('agent:getState'),
  /** Подписка на записи журнала. */
  onLog: (cb: (line: string) => void): void => {
    ipcRenderer.on('agent:log', (_e, line: string) => cb(line))
  },
  /** Подписка на смену статуса. */
  onStatus: (cb: (s: AgentState) => void): void => {
    ipcRenderer.on('agent:status', (_e, s: AgentState) => cb(s))
  }
}

contextBridge.exposeInMainWorld('agent', api)

export type AgentBridge = typeof api
