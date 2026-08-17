import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { DesktopMigrationBundle } from '@shared/protocol'

/** Подписка на событие main→renderer с возвратом функции отписки. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// Мост режима агента (окна настройки/журнала в трее).
interface AgentAdminState {
  status: 'connecting' | 'online' | 'offline' | 'stopped' | 'unconfigured'
  id: string | null
  name: string | null
  log: string[]
}
const agentAdmin = {
  submitConnection: (str: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('agentmode:submitConnection', str),
  getState: (): Promise<AgentAdminState> => ipcRenderer.invoke('agentmode:getState'),
  onLog: (cb: (line: string) => void) => subscribe<string>('agentmode:log', cb),
  onStatus: (cb: (s: AgentAdminState) => void) => subscribe<AgentAdminState>('agentmode:status', cb)
}

// URL сервера и одноразовая миграция legacy-БД.
const remoteClient = {
  getUrl: (): Promise<string | null> => ipcRenderer.invoke('remote:getUrl'),
  setUrl: (url: string | null): Promise<void> => ipcRenderer.invoke('remote:setUrl', url),
  exportLegacyData: (): Promise<DesktopMigrationBundle | null> =>
    ipcRenderer.invoke('remote:exportLegacyData'),
  markLegacyMigrated: (): Promise<void> => ipcRenderer.invoke('remote:markLegacyMigrated')
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('agentAdmin', agentAdmin)
    contextBridge.exposeInMainWorld('remoteClient', remoteClient)
  } catch (error) {
    console.error('[preload] exposeInMainWorld failed', error)
  }
} else {
  const g = globalThis as unknown as {
    agentAdmin: typeof agentAdmin
    remoteClient: typeof remoteClient
  }
  g.agentAdmin = agentAdmin
  g.remoteClient = remoteClient
}
