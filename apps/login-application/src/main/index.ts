import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { startConnection, type AgentConnection } from '@agent/connection'
import type { AgentConfig } from '@agent/config'
import { parseLoginEnrollmentDeepLink, REST, type AgentPolicy } from '@voicechat/shared'

type StoredConfig = { serverUrl: string; encryptedToken: string }
let window: BrowserWindow | null = null
let connection: AgentConnection | null = null
let pendingDeepLink: string | null = null

const configPath = (): string => join(app.getPath('userData'), 'machine.json')
function readConfig(): AgentConfig | null {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    const value = JSON.parse(readFileSync(configPath(), 'utf8')) as StoredConfig
    return { serverUrl: value.serverUrl, token: safeStorage.decryptString(Buffer.from(value.encryptedToken, 'base64')), rootDir: homedir() }
  } catch { return null }
}
function saveAndStart(serverBase: string, machineToken: string): void {
  if (readConfig()) throw new Error('Этот Mac уже настроен как машина. Сначала удалите существующую настройку.')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Системное защищённое хранилище macOS недоступно')
  const server = new URL(serverBase)
  const serverUrl = `${server.protocol === 'https:' ? 'wss:' : 'ws:'}//${server.host}/agent`
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(configPath(), JSON.stringify({ serverUrl, encryptedToken: safeStorage.encryptString(machineToken).toString('base64') }))
  const config: AgentConfig = { serverUrl, token: machineToken, rootDir: homedir() }
  connection?.stop()
  connection = startConnection(config, {
    onStatus: (status) => window?.webContents.send('login:status', status),
    onRegistered: (name) => window?.webContents.send('login:status', `Подключено: ${name}`),
    onDenied: (reason) => window?.webContents.send('login:status', `Отказ сервера: ${reason}`),
    onExec: () => {},
    onExecDone: () => {},
    onPolicy: (_policy: AgentPolicy) => {},
    onUpdateAvailable: () => {},
    onLog: () => {}
  })
}
function openWindow(): void {
  if (window) { window.show(); window.focus(); return }
  window = new BrowserWindow({
    width: 480, height: 470, title: 'Голос·Чат Login',
    webPreferences: { preload: join(__dirname, '../preload/index.mjs'), contextIsolation: true, sandbox: false }
  })
  window.on('closed', () => { window = null })
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) void window.loadURL(dev)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
}
async function redeemDeepLink(value: string): Promise<void> {
  const parsed = parseLoginEnrollmentDeepLink(value)
  if (!parsed) { window?.webContents.send('login:status', 'Некорректная ссылка подключения'); return }
  if (readConfig()) { window?.webContents.send('login:status', 'Этот Mac уже настроен; существующая машина не перезаписана'); return }
  const response = await fetch(parsed.serverUrl + REST.loginEnrollmentRedeem, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: parsed.token, name: hostname() })
  })
  const body = await response.json() as { machineToken?: string; serverUrl?: string; error?: string }
  if (!response.ok || !body.machineToken || !body.serverUrl) throw new Error(body.error ?? `HTTP ${response.status}`)
  saveAndStart(body.serverUrl, body.machineToken)
}
ipcMain.handle('login:add', async (_event, input: { serverUrl: string; name: string; password: string }) => {
  try {
    if (readConfig()) return { ok: false, error: 'Этот Mac уже настроен как машина' }
    const base = new URL(input.serverUrl).origin
    const login = await fetch(base + REST.sessionLogin, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: input.name, password: input.password, remember: false })
    })
    const session = await login.json() as { token?: string; requires2fa?: boolean }
    if (!login.ok || !session.token) return { ok: false, error: session.requires2fa ? 'Для аккаунта включён 2FA; используйте подключение из web-интерфейса' : 'Неверный адрес, логин или пароль' }
    const created = await fetch(base + REST.agents, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ name: hostname() })
    })
    const machine = await created.json() as { token?: string; error?: string }
    if (!created.ok || !machine.token) throw new Error(machine.error ?? `HTTP ${created.status}`)
    saveAndStart(base, machine.token)
    return { ok: true }
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) } }
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
else {
  app.setAsDefaultProtocolClient('voicechat-login')
  app.on('open-url', (event, url) => { event.preventDefault(); pendingDeepLink = url; openWindow(); void redeemDeepLink(url).catch((e) => window?.webContents.send('login:status', String(e))) })
  app.on('second-instance', (_event, argv) => {
    const link = argv.find((arg) => arg.startsWith('voicechat-login://'))
    openWindow()
    if (link) void redeemDeepLink(link).catch((e) => window?.webContents.send('login:status', String(e)))
  })
  app.whenReady().then(() => {
    openWindow()
    const configured = readConfig()
    if (configured) connection = startConnection(configured, {
      onStatus: (status) => window?.webContents.send('login:status', status),
      onRegistered: (name) => window?.webContents.send('login:status', `Подключено: ${name}`),
      onDenied: () => {}, onExec: () => {}, onExecDone: () => {}, onPolicy: () => {}, onUpdateAvailable: () => {}, onLog: () => {}
    })
    const link = pendingDeepLink ?? process.argv.find((arg) => arg.startsWith('voicechat-login://'))
    if (link) void redeemDeepLink(link).catch((e) => window?.webContents.send('login:status', String(e)))
  })
}
