// Режим агента внутри десктоп-приложения: приложение помимо чата может
// подключаться к серверу как компаньон-агент и выполнять его команды на этой
// машине. Ядро подключения переиспользуется из @agent; настройка — строкой
// подключения через окно из меню трея. Пункты меню агента отдаются в трей index.ts.

import { app, BrowserWindow, ipcMain, safeStorage, type MenuItemConstructorOptions } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startConnection, type AgentConnection, type AgentStatus } from '@agent/connection'
import { decodeAgentConnection } from '@shared/agentProtocol'
import { parseLoginEnrollmentDeepLink } from '@shared/enrollment'
import { REST } from '@shared/protocol'

const isDev = !app.isPackaged
const mainDir = dirname(fileURLToPath(import.meta.url))
const LOG_CAP = 200

interface StoredConfig {
  serverUrl: string
  encryptedToken: string
}
type UiStatus = AgentStatus | 'unconfigured'

const state: { status: UiStatus; id: string | null; name: string | null; log: string[] } = {
  status: 'unconfigured',
  id: null,
  name: null,
  log: []
}

let connection: AgentConnection | null = null
let setupWin: BrowserWindow | null = null
let logWin: BrowserWindow | null = null
let onChange: () => void = () => {}

const cfgPath = (): string => join(app.getPath('userData'), 'agent-config.json')

function readCfg(): { serverUrl: string; token: string } | null {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    const o = JSON.parse(readFileSync(cfgPath(), 'utf8')) as Partial<StoredConfig> & { token?: unknown }
    if (typeof o.serverUrl !== 'string' || !o.serverUrl) return null
    if (typeof o.encryptedToken === 'string' && o.encryptedToken) {
      return { serverUrl: o.serverUrl, token: safeStorage.decryptString(Buffer.from(o.encryptedToken, 'base64')) }
    }
    // Одноразово мигрируем прежний plaintext agent-config.json в safeStorage.
    if (typeof o.token === 'string' && o.token) {
      const migrated = { serverUrl: o.serverUrl, token: o.token }
      writeCfg(migrated)
      return migrated
    }
    return null
  } catch {
    return null
  }
}

function writeCfg(cfg: { serverUrl: string; token: string }): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Системное защищённое хранилище недоступно')
  mkdirSync(app.getPath('userData'), { recursive: true })
  const stored: StoredConfig = {
    serverUrl: cfg.serverUrl,
    encryptedToken: safeStorage.encryptString(cfg.token).toString('base64')
  }
  writeFileSync(cfgPath(), JSON.stringify(stored, null, 2))
}

function nowLabel(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function pushLog(line: string): void {
  state.log.push(`${nowLabel()}  ${line}`)
  if (state.log.length > LOG_CAP) state.log = state.log.slice(-LOG_CAP)
  logWin?.webContents.send('agentmode:log', state.log[state.log.length - 1])
}

function setStatus(s: UiStatus): void {
  state.status = s
  logWin?.webContents.send('agentmode:status', { ...state })
  onChange()
}

function handlers() {
  return {
    onStatus: (s: AgentStatus) => setStatus(s),
    onRegistered: (name: string, id?: string) => {
      state.id = id ?? null
      state.name = name
      pushLog(`подключён как «${name}»`)
      setStatus('online')
    },
    onDenied: (reason: string) => {
      pushLog(`отказ сервера: ${reason}`)
      setStatus('stopped')
      openSetup()
    },
    onExec: (command: string) => pushLog(`$ ${command}`),
    onExecDone: (_c: string, code: number | null, timedOut: boolean, ms: number) =>
      pushLog(`→ exit ${code ?? '?'}${timedOut ? ' (таймаут)' : ''} (${(ms / 1000).toFixed(1)}с)`),
    onLog: (line: string) => pushLog(line)
  }
}

function startAgent(): void {
  const cfg = readCfg()
  if (!cfg) {
    setStatus('unconfigured')
    openSetup()
    return
  }
  connection?.stop()
  connection = startConnection(
    { serverUrl: cfg.serverUrl, token: cfg.token, rootDir: homedir() },
    handlers()
  )
}

function stopAgent(): void {
  connection?.stop()
  connection = null
  setStatus('stopped')
}

// --- Окна настройки/журнала ------------------------------------------------

function loadRenderer(win: BrowserWindow, name: 'agent-setup' | 'agent-log'): void {
  const base = process.env['ELECTRON_RENDERER_URL']
  if (isDev && base) void win.loadURL(`${base}/${name}.html`)
  else void win.loadFile(join(mainDir, `../renderer/${name}.html`))
}

function openSetup(): void {
  if (setupWin) {
    setupWin.focus()
    return
  }
  setupWin = new BrowserWindow({
    width: 460,
    height: 300,
    resizable: false,
    title: 'Режим агента',
    webPreferences: {
      preload: join(mainDir, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false
    }
  })
  setupWin.on('closed', () => {
    setupWin = null
  })
  loadRenderer(setupWin, 'agent-setup')
}

function openLog(): void {
  if (logWin) {
    logWin.focus()
    return
  }
  logWin = new BrowserWindow({
    width: 560,
    height: 460,
    title: 'Журнал агента',
    webPreferences: {
      preload: join(mainDir, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false
    }
  })
  logWin.on('closed', () => {
    logWin = null
  })
  loadRenderer(logWin, 'agent-log')
}

// --- Меню трея (агентская часть) -------------------------------------------

function statusLabel(): string {
  switch (state.status) {
    case 'unconfigured':
      return 'Агент: выключен'
    case 'connecting':
      return 'Агент: подключение…'
    case 'online':
      return `Агент: в сети — ${state.name ?? '?'}`
    case 'offline':
      return 'Агент: офлайн (переподключение…)'
    case 'stopped':
      return 'Агент: остановлен'
  }
}

/** Пункты меню, относящиеся к режиму агента (встраиваются в общее меню трея). */
export function agentMenuItems(): MenuItemConstructorOptions[] {
  const running = state.status === 'online' || state.status === 'offline' || state.status === 'connecting'
  if (state.status === 'unconfigured') {
    return [
      { label: statusLabel(), enabled: false },
      { label: 'Включить режим агента…', click: () => openSetup() }
    ]
  }
  return [
    { label: statusLabel(), enabled: false },
    { label: 'Журнал агента', click: () => openLog() },
    running
      ? { label: 'Остановить агента', click: () => stopAgent() }
      : { label: 'Возобновить агента', click: () => startAgent() },
    { label: 'Сменить подключение…', click: () => openSetup() }
  ]
}

/** Инициализация: регистрирует IPC, запускает агента если настроен. */
export function initAgentMode(onChangeCb: () => void): void {
  onChange = onChangeCb

  ipcMain.handle('agentmode:getState', () => ({ ...state }))
  ipcMain.handle('agentmode:submitConnection', (_e, str: string) => {
    const parsed = decodeAgentConnection(String(str))
    if (!parsed) return { ok: false, error: 'Строка подключения не распознана' }
    writeCfg({ serverUrl: parsed.server, token: parsed.token })
    setupWin?.close()
    startAgent()
    return { ok: true }
  })

  if (readCfg()) startAgent()
  else setStatus('unconfigured')
}

export async function enrollCurrentDevice(value: string): Promise<void> {
  const parsed = parseLoginEnrollmentDeepLink(value)
  if (!parsed) throw new Error('Некорректная ссылка подключения устройства')
  const response = await fetch(parsed.serverUrl + REST.loginEnrollmentRedeem, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: parsed.token, name: hostname() })
  })
  const body = await response.json() as { machineToken?: string; serverUrl?: string; error?: string }
  if (!response.ok || !body.machineToken || !body.serverUrl) throw new Error(body.error ?? `HTTP ${response.status}`)
  const server = new URL(body.serverUrl)
  const serverUrl = `${server.protocol === 'https:' ? 'wss:' : 'ws:'}//${server.host}/agent`
  writeCfg({ serverUrl, token: body.machineToken })
  startAgent()
  openLog()
}

export function disposeAgentMode(): void {
  connection?.stop()
  connection = null
}
