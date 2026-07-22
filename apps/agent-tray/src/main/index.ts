// Главный процесс трей-агента: иконка в menu bar, статус, журнал команд,
// запуск/остановка ядра агента (@agent). Настройка — окно ввода строки подключения.

import { app, Tray, Menu, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { startConnection, type AgentConnection, type AgentStatus } from '@agent/connection'
import type { AgentConfig } from '@agent/config'
import { trayIcon } from './trayIcon.js'
import { readConfig, writeConfig, configFromConnectionString } from './configStore.js'

const isDev = !app.isPackaged
const LOG_CAP = 200

type UiStatus = AgentStatus | 'unconfigured'

const state: { status: UiStatus; name: string | null; log: string[] } = {
  status: 'unconfigured',
  name: null,
  log: []
}

let tray: Tray | null = null
let connection: AgentConnection | null = null
let setupWindow: BrowserWindow | null = null
let logWindow: BrowserWindow | null = null

const userDir = (): string => app.getPath('userData')

function nowLabel(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function pushLog(line: string): void {
  state.log.push(`${nowLabel()}  ${line}`)
  if (state.log.length > LOG_CAP) state.log = state.log.slice(-LOG_CAP)
  logWindow?.webContents.send('agent:log', state.log[state.log.length - 1])
}

function statusLabel(): string {
  switch (state.status) {
    case 'unconfigured':
      return '○ Не настроено'
    case 'connecting':
      return '○ Подключение…'
    case 'online':
      return `● В сети — ${state.name ?? '?'}`
    case 'offline':
      return '○ Офлайн (переподключение…)'
    case 'stopped':
      return '⏸ Остановлено'
  }
}

function pushStatus(): void {
  logWindow?.webContents.send('agent:status', { ...state })
}

function updateTray(): void {
  if (!tray) return
  tray.setToolTip(`Голос·Чат Агент — ${statusLabel()}`)
  const running = state.status === 'online' || state.status === 'offline' || state.status === 'connecting'
  const hasConfig = readConfig(userDir()) !== null
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: statusLabel(), enabled: false },
      { type: 'separator' },
      { label: 'Показать журнал', click: () => openLog() },
      running
        ? { label: 'Остановить', click: () => stopAgent() }
        : { label: 'Возобновить', enabled: hasConfig, click: () => startAgent() },
      { label: 'Настройки…', click: () => openSetup() },
      { type: 'separator' },
      { label: 'Выход', click: () => app.quit() }
    ])
  )
}

function handlers() {
  return {
    onStatus: (s: AgentStatus) => {
      state.status = s
      updateTray()
      pushStatus()
    },
    onRegistered: (name: string) => {
      state.name = name
      pushLog(`подключён как «${name}»`)
      updateTray()
      pushStatus()
    },
    onDenied: (reason: string) => {
      pushLog(`отказ сервера: ${reason}`)
      state.status = 'stopped'
      updateTray()
      pushStatus()
      openSetup() // токен неверный — предложим ввести заново
    },
    onExec: (command: string) => pushLog(`$ ${command}`),
    onExecDone: (_c: string, exitCode: number | null, timedOut: boolean, ms: number) =>
      pushLog(`→ exit ${exitCode ?? '?'}${timedOut ? ' (таймаут)' : ''} (${(ms / 1000).toFixed(1)}с)`),
    onLog: (line: string) => pushLog(line)
  }
}

function startAgent(): void {
  const cfg = readConfig(userDir())
  if (!cfg) {
    state.status = 'unconfigured'
    updateTray()
    openSetup()
    return
  }
  connection?.stop()
  const agentConfig: AgentConfig = { serverUrl: cfg.serverUrl, token: cfg.token }
  connection = startConnection(agentConfig, handlers())
}

function stopAgent(): void {
  connection?.stop()
  connection = null
  state.status = 'stopped'
  updateTray()
  pushStatus()
}

function rendererFile(name: 'setup' | 'log'): string {
  return join(__dirname, `../renderer/${name}.html`)
}
function rendererUrl(name: 'setup' | 'log'): string | null {
  const base = process.env['ELECTRON_RENDERER_URL']
  return base ? `${base}/${name}.html` : null
}

function loadRenderer(win: BrowserWindow, name: 'setup' | 'log'): void {
  const url = isDev ? rendererUrl(name) : null
  if (url) void win.loadURL(url)
  else void win.loadFile(rendererFile(name))
}

function openSetup(): void {
  if (setupWindow) {
    setupWindow.focus()
    return
  }
  setupWindow = new BrowserWindow({
    width: 460,
    height: 280,
    resizable: false,
    title: 'Настройка агента',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false
    }
  })
  setupWindow.on('closed', () => {
    setupWindow = null
  })
  loadRenderer(setupWindow, 'setup')
}

function openLog(): void {
  if (logWindow) {
    logWindow.focus()
    return
  }
  logWindow = new BrowserWindow({
    width: 560,
    height: 460,
    title: 'Журнал агента',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false
    }
  })
  logWindow.on('closed', () => {
    logWindow = null
  })
  loadRenderer(logWindow, 'log')
}

// --- IPC ------------------------------------------------------------------

ipcMain.handle('agent:getState', () => ({ ...state }))

ipcMain.handle('agent:submitConnection', (_e, str: string) => {
  const cfg = configFromConnectionString(str)
  if (!cfg) return { ok: false, error: 'Строка подключения не распознана' }
  writeConfig(userDir(), cfg)
  setupWindow?.close()
  startAgent()
  return { ok: true }
})

// --- Жизненный цикл -------------------------------------------------------

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => openLog())

  app.whenReady().then(() => {
    app.dock?.hide() // только трей, без иконки в доке
    tray = new Tray(trayIcon())
    updateTray()
    if (readConfig(userDir())) startAgent()
    else openSetup()
  })

  // Трей-приложение живёт без окон — не выходим при закрытии окон.
  app.on('window-all-closed', () => {})
}
