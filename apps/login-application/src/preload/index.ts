import { contextBridge, ipcRenderer } from 'electron'

const api = {
  addCurrentDevice: (input: { serverUrl: string; name: string; password: string }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('login:add', input),
  onStatus: (listener: (status: string) => void): (() => void) => {
    const wrapped = (_event: unknown, status: string): void => listener(status)
    ipcRenderer.on('login:status', wrapped)
    return () => ipcRenderer.removeListener('login:status', wrapped)
  }
}
contextBridge.exposeInMainWorld('loginApplication', api)
export type LoginApplicationBridge = typeof api
