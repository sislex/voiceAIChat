// Главный процесс трей-агента: иконка в menu bar, статус, журнал команд,
// запуск/остановка ядра агента (@agent). Настройка — окно ввода строки подключения.

import { app, Tray, Menu, BrowserWindow, Notification, dialog, shell, ipcMain } from 'electron'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { writeFileSync } from 'node:fs'
import { startConnection, type AgentConnection, type AgentStatus } from '@agent/connection'
import type { AgentConfig } from '@agent/config'
import { AGENT_VERSION, REST, compareVersions, type AgentPolicy } from '@voicechat/shared'
import { trayIcon } from './trayIcon.js'
import { readConfig, writeConfig, configFromConnectionString } from './configStore.js'
import { httpBaseFromWs } from './serverUrl.js'

const isDev = !app.isPackaged
const LOG_CAP = 200

type UiStatus = AgentStatus | 'unconfigured'

const state: {
  status: UiStatus
  name: string | null
  log: string[]
  /** Версия, о которой сообщил сервер как о доступной (null — нет обновления). */
  latestVersion: string | null
  /** Текущая политика (разрешения) машины; null — ещё не подключены. */
  policy: AgentPolicy | null
} = {
  status: 'unconfigured',
  name: null,
  log: [],
  latestVersion: null,
  policy: null
}

let tray: Tray | null = null
let connection: AgentConnection | null = null
let setupWindow: BrowserWindow | null = null
let logWindow: BrowserWindow | null = null
let permsWindow: BrowserWindow | null = null

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
  const hasUpdate = state.latestVersion !== null && compareVersions(state.latestVersion, AGENT_VERSION) > 0
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: statusLabel(), enabled: false },
      { label: `Версия ${AGENT_VERSION}`, enabled: false },
      { type: 'separator' },
      { label: 'Показать журнал', click: () => openLog() },
      { label: 'Разрешения…', enabled: state.policy !== null, click: () => openPermissions() },
      running
        ? { label: 'Остановить', click: () => stopAgent() }
        : { label: 'Возобновить', enabled: hasConfig, click: () => startAgent() },
      { label: 'Настройки…', click: () => openSetup() },
      hasUpdate
        ? { label: `⬆︎ Обновить (v${state.latestVersion})`, click: () => void startUpdate() }
        : { label: 'Проверить обновления', click: () => void checkForUpdates() },
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
    onPolicy: (policy: AgentPolicy) => {
      state.policy = policy
      updateTray() // разблокировать пункт «Разрешения…»
      permsWindow?.webContents.send('agent:policy', policy)
    },
    onUpdateAvailable: (version: string) => {
      state.latestVersion = version
      pushLog(`доступно обновление v${version}`)
      updateTray()
      if (Notification.isSupported()) {
        new Notification({
          title: 'Доступно обновление агента',
          body: `Версия v${version}. Откройте меню в трее → «Обновить».`
        }).show()
      }
    },
    onLog: (line: string) => pushLog(line)
  }
}

/** Проверить наличие новой версии на сервере и предложить обновление. */
async function checkForUpdates(): Promise<void> {
  const cfg = readConfig(userDir())
  if (!cfg) {
    openSetup()
    return
  }
  const base = httpBaseFromWs(cfg.serverUrl)
  try {
    const res = await fetch(`${base}${REST.agentLatestVersion}`)
    const { version } = (await res.json()) as { version: string }
    if (compareVersions(version, AGENT_VERSION) > 0) {
      state.latestVersion = version
      updateTray()
      const r = await dialog.showMessageBox({
        type: 'info',
        message: `Доступна новая версия v${version}`,
        detail: `Установлена v${AGENT_VERSION}. Обновить сейчас?`,
        buttons: ['Обновить', 'Позже'],
        defaultId: 0,
        cancelId: 1
      })
      if (r.response === 0) await startUpdate()
    } else {
      await dialog.showMessageBox({
        type: 'info',
        message: 'Установлена последняя версия',
        detail: `v${AGENT_VERSION}`
      })
    }
  } catch (err) {
    pushLog(`проверка обновлений не удалась: ${err instanceof Error ? err.message : err}`)
  }
}

/** Скачать новый .dmg с сервера и открыть его (установка вручную — Gatekeeper). */
async function startUpdate(): Promise<void> {
  const cfg = readConfig(userDir())
  if (!cfg) return
  const base = httpBaseFromWs(cfg.serverUrl)
  const dest = join(tmpdir(), 'voicechat-agent-update.dmg')
  pushLog('скачиваю обновление…')
  try {
    const res = await fetch(`${base}${REST.agentApp}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
    pushLog('открываю установщик…')
    await shell.openPath(dest)
    await dialog.showMessageBox({
      type: 'info',
      message: 'Установщик открыт',
      detail: 'Перетащите приложение в «Программы» и перезапустите его.'
    })
  } catch (err) {
    pushLog(`обновление не удалось: ${err instanceof Error ? err.message : err}`)
    await dialog.showMessageBox({ type: 'error', message: 'Не удалось обновить', detail: String(err) })
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
  // Корень проводника на десктопной машине — домашний каталог пользователя.
  const agentConfig: AgentConfig = { serverUrl: cfg.serverUrl, token: cfg.token, rootDir: homedir() }
  connection = startConnection(agentConfig, handlers())
}

function stopAgent(): void {
  connection?.stop()
  connection = null
  state.status = 'stopped'
  updateTray()
  pushStatus()
}

type RendererName = 'setup' | 'log' | 'permissions'
function rendererFile(name: RendererName): string {
  return join(__dirname, `../renderer/${name}.html`)
}
function rendererUrl(name: RendererName): string | null {
  const base = process.env['ELECTRON_RENDERER_URL']
  return base ? `${base}/${name}.html` : null
}

function loadRenderer(win: BrowserWindow, name: RendererName): void {
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

function openPermissions(): void {
  if (permsWindow) {
    permsWindow.focus()
    return
  }
  permsWindow = new BrowserWindow({
    width: 480,
    height: 520,
    title: 'Разрешения машины',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false
    }
  })
  permsWindow.on('closed', () => {
    permsWindow = null
  })
  loadRenderer(permsWindow, 'permissions')
}

// --- IPC ------------------------------------------------------------------

ipcMain.handle('agent:getState', () => ({ ...state }))

ipcMain.handle('agent:getPolicy', () => state.policy)
ipcMain.handle('agent:setPolicy', (_e, policy: AgentPolicy) => {
  connection?.setPolicy(policy)
})

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
