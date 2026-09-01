import { contextBridge, ipcRenderer } from 'electron'

const login = {
  addCurrentDevice: (input: { serverUrl: string; login: string; password: string }): Promise<{ ok: true }> =>
    ipcRenderer.invoke('login:addCurrentDevice', input),
  configured: (): Promise<boolean> => ipcRenderer.invoke('login:configured'),
  onStatus: (callback: (status: string) => void): void => { ipcRenderer.on('login:status', (_event, status) => callback(status)) },
  onComplete: (callback: (name: string) => void): void => { ipcRenderer.on('login:complete', (_event, name) => callback(name)) },
  onError: (callback: (message: string) => void): void => { ipcRenderer.on('login:error', (_event, message) => callback(message)) }
}
contextBridge.exposeInMainWorld('voicechatLogin', login)
export type LoginBridge = typeof login
