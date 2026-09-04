import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
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
const activeLinks = new Set<string>()
const completedLinks = new Set<string>()

function configPath(): string { return join(app.getPath('userData'), 'machine.json') }
function hasConfig(): boolean { return existsSync(configPath()) }
function saveMachine(serverUrl: string, token: string, replace = false): void {
  if (hasConfig() && !replace) throw new Error('Этот Mac уже подключён. Существующая машина не была перезаписана.')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Системное защищённое хранилище недоступно')
  mkdirSync(app.getPath('userData'), { recursive: true })
  const data: StoredMachine = { serverUrl, encryptedToken: safeStorage.encryptString(token).toString('base64') }
  const target = configPath()
  const temporary = target + '.new'
  try {
    writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 })
    renameSync(temporary, target)
  } catch (error) {
    try { if (existsSync(temporary)) unlinkSync(temporary) } catch {}
    throw error
  }
}
async function confirmReplacement(): Promise<boolean> {
  if (!hasConfig()) return true
  const options = {
    type: 'warning' as const,
    buttons: ['Оставить текущую', 'Заменить'],
    defaultId: 0,
    cancelId: 0,
    title: 'Заменить подключение?',
    message: 'Этот Mac уже подключён.',
    detail: 'Новое подключение заменит сохранённую настройку только после вашего подтверждения.'
  }
  const answer = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  return answer.response === 1
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
    width: 1000, height: 860, minWidth: 360, minHeight: 560, resizable: true, title: 'VoiceChat Login',
    webPreferences: { preload: join(mainDir, '../preload/index.mjs'), contextIsolation: true, sandbox: false, nodeIntegration: false }
  })
  window.on('closed', () => { window = null })
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && dev) void window.loadURL(dev)
  else void window.loadFile(join(mainDir, '../renderer/index.html'))
}
async function handleLink(value: string): Promise<void> {
  createWindow()
  if (activeLinks.has(value) || completedLinks.has(value)) return
  activeLinks.add(value)
  try {
    const replacing = hasConfig()
    if (replacing && !await confirmReplacement()) {
      window?.webContents.send('login:status', 'Существующее подключение сохранено')
      return
    }
    const result = await enrollWithDeepLink(value, fetch, hostname())
    saveMachine(result.serverUrl, result.machineToken, replacing)
    completedLinks.add(value)
    startAgent()
  } catch (error) {
    window?.webContents.send('login:error', error instanceof Error ? error.message : String(error))
  } finally {
    activeLinks.delete(value)
    pendingLink = null
  }
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
      const replacing = hasConfig()
      if (replacing && !await confirmReplacement()) return { ok: false as const }
      const result = await loginAndCreateMachine(input, fetch, hostname())
      saveMachine(result.serverUrl, result.machineToken, replacing)
      startAgent()
      return { ok: true as const }
    })
    ipcMain.handle('login:configured', () => hasConfig())
    createWindow()
    if (pendingLink) void handleLink(pendingLink)
  })
}
app.on('window-all-closed', () => {})
app.on('will-quit', () => { connection?.stop(); connection = null })

export { parseLoginEnrollmentDeepLink, REST }
