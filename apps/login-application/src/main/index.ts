import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startConnection, type AgentConnection } from '@agent/connection'
import { parseLoginEnrollmentDeepLink, REST } from '@voicechat/shared'
import { enrollWithDeepLink, loginAndCreateMachine } from './enrollment.js'

interface StoredMachine { serverUrl: string; encryptedToken: string }
const mainDir = dirname(fileURLToPath(import.meta.url))
let window: BrowserWindow | null = null
let connection: AgentConnection | null = null
let pendingLink = process.argv.find((arg) => arg.startsWith('voicechat-login://')) ?? null

function configPath(): string { return join(app.getPath('userData'), 'machine.json') }
function hasConfig(): boolean { return existsSync(configPath()) }
function saveMachine(serverUrl: string, token: string): void {
  if (hasConfig()) throw new Error('Этот Mac уже подключён. Существующая машина не была перезаписана.')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Системное защищённое хранилище недоступно')
  mkdirSync(app.getPath('userData'), { recursive: true })
  const data: StoredMachine = { serverUrl, encryptedToken: safeStorage.encryptString(token).toString('base64') }
  writeFileSync(configPath(), JSON.stringify(data))
}
function readMachine(): { serverUrl: string; token: string } | null {
  try {
    const data = JSON.parse(readFileSync(configPath(), 'utf8')) as StoredMachine
    return { serverUrl: data.serverUrl, token: safeStorage.decryptString(Buffer.from(data.encryptedToken, 'base64')) }
  } catch { return null }
}
function startAgent(): void {
  const cfg = readMachine()
  if (!cfg) return
  connection?.stop()
  connection = startConnection(
    { serverUrl: cfg.serverUrl, token: cfg.token, rootDir: homedir() },
    {
      onStatus: (status) => window?.webContents.send('login:status', status),
      onRegistered: (name) => window?.webContents.send('login:complete', name),
      onDenied: (reason) => window?.webContents.send('login:error', reason),
      onExec: () => undefined,
      onExecDone: () => undefined,
      onLog: () => undefined
    }
  )
}
function createWindow(): void {
  if (window) { window.show(); window.focus(); return }
  window = new BrowserWindow({
    width: 500, height: 480, resizable: false, title: 'VoiceChat Login',
    webPreferences: { preload: join(mainDir, '../preload/index.mjs'), contextIsolation: true, sandbox: false, nodeIntegration: false }
  })
  window.on('closed', () => { window = null })
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && dev) void window.loadURL(dev)
  else void window.loadFile(join(mainDir, '../renderer/index.html'))
}
async function handleLink(value: string): Promise<void> {
  createWindow()
  try {
    if (hasConfig()) throw new Error('Этот Mac уже подключён. Удалите существующую настройку вручную перед новым enrollment.')
    const result = await enrollWithDeepLink(value, fetch, hostname())
    saveMachine(result.serverUrl, result.machineToken)
    startAgent()
  } catch (error) {
    window?.webContents.send('login:error', error instanceof Error ? error.message : String(error))
  } finally { pendingLink = null }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
else {
  app.setAsDefaultProtocolClient('voicechat-login')
  app.on('open-url', (event, value) => { event.preventDefault(); pendingLink = value; if (app.isReady()) void handleLink(value) })
  app.on('second-instance', (_event, argv) => {
    const value = argv.find((arg) => arg.startsWith('voicechat-login://'))
    if (value) void handleLink(value)
    else createWindow()
  })
  void app.whenReady().then(() => {
    ipcMain.handle('login:addCurrentDevice', async (_event, input: { serverUrl: string; login: string; password: string }) => {
      if (hasConfig()) throw new Error('Этот Mac уже подключён. Существующая машина не была перезаписана.')
      const result = await loginAndCreateMachine(input, fetch, hostname())
      saveMachine(result.serverUrl, result.machineToken)
      startAgent()
      return { ok: true }
    })
    ipcMain.handle('login:configured', () => hasConfig())
    createWindow()
    if (pendingLink) void handleLink(pendingLink)
  })
}
app.on('window-all-closed', () => {})
app.on('will-quit', () => { connection?.stop(); connection = null })

export { parseLoginEnrollmentDeepLink, REST }
