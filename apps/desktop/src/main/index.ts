import { app, BrowserWindow, Menu, Tray, ipcMain, session, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { VoiceChatDb } from './db/database'
import { trayIcon } from './trayIcon'
import { initAgentMode, agentMenuItems, disposeAgentMode } from './agentMode'
import {
  isDesktopMigrationDone,
  markDesktopMigrationDone,
  readServerUrl,
  writeServerUrl
} from './remoteConfig'

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let remoteSetupWindow: BrowserWindow | null = null

function createWindow(): void {
  const userDataDir = app.getPath('userData')
  if (!readServerUrl(userDataDir)) {
    openRemoteSetup()
    return
  }
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    show: false,
    backgroundColor: '#FAFAF7',
    title: 'Голос·Чат',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  // Закрытие окна сворачивает в трей (приложение продолжает работать агентом);
  // реальный выход — только через «Выход» в трее (isQuitting) или Cmd-Q (before-quit).
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Показать окно чата (создать, если было закрыто). */
function showChat(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
  } else {
    createWindow()
  }
}

/** Окно ввода адреса сервера (тонкий клиент). */
function openRemoteSetup(): void {
  if (remoteSetupWindow) {
    remoteSetupWindow.focus()
    return
  }
  remoteSetupWindow = new BrowserWindow({
    width: 480,
    height: 260,
    resizable: false,
    title: 'Подключение к серверу',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false
    }
  })
  remoteSetupWindow.on('closed', () => {
    remoteSetupWindow = null
  })
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void remoteSetupWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/remote-setup.html`)
  } else {
    void remoteSetupWindow.loadFile(join(__dirname, '../renderer/remote-setup.html'))
  }
}

/** Пересобрать меню трея (статус агента/режим меняется — вызываем повторно). */
function rebuildTrayMenu(): void {
  if (!tray) return
  const userDataDir = app.getPath('userData')
  const serverUrl = readServerUrl(userDataDir)
  const modeLabel = serverUrl ? `Режим: сервер ${serverUrl}` : 'Сервер не настроен'
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Открыть чат', click: () => showChat() },
      { type: 'separator' },
      { label: modeLabel, enabled: false },
      { label: 'Подключиться к серверу…', click: () => openRemoteSetup() },
      { type: 'separator' },
      ...agentMenuItems(),
      { type: 'separator' },
      {
        label: 'Выход',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
}

/** Сохраняет URL сервера и перезапускает тонкий клиент. */
function applyServerUrl(url: string | null): void {
  const previousUrl = readServerUrl(app.getPath('userData'))
  writeServerUrl(app.getPath('userData'), url)
  remoteSetupWindow?.close()

  // Локальный backend создаётся только при старте процесса. При переходе через
  // границу local ↔ remote нужен чистый перезапуск, иначе либо останутся жить
  // тяжёлые локальные сервисы, либо renderer не получит IPC-мосты.
  if (Boolean(previousUrl) !== Boolean(url)) {
    app.relaunch()
    app.exit(0)
    return
  }
  rebuildTrayMenu()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.reload()
    mainWindow.show()
    mainWindow.focus()
  } else {
    createWindow()
  }
}

app.whenReady().then(() => {
  const userDataDir = app.getPath('userData')
  const serverUrl = readServerUrl(userDataDir)

  // Chromium по умолчанию отклоняет запрос микрофона — разрешаем media явно
  // (на macOS дополнительно потребуется системное разрешение TCC).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })

  // Режим тонкого клиента: renderer читает URL при старте (window.remoteClient).
  ipcMain.handle('remote:getUrl', () => readServerUrl(app.getPath('userData')))
  ipcMain.handle('remote:setUrl', (_e, url: string | null) => {
    applyServerUrl(url)
  })
  ipcMain.handle('remote:exportLegacyData', () => {
    const dir = app.getPath('userData')
    const url = readServerUrl(dir)
    const dbPath = join(dir, 'voicechat.db')
    if (!url || isDesktopMigrationDone(dir, url) || !existsSync(dbPath)) return null
    const legacyDb = new VoiceChatDb(dbPath)
    try {
      return legacyDb.exportDesktopMigration()
    } finally {
      legacyDb.close()
    }
  })
  ipcMain.handle('remote:markLegacyMigrated', () => {
    const dir = app.getPath('userData')
    const url = readServerUrl(dir)
    if (url) markDesktopMigrationDone(dir, url)
  })

  if (!serverUrl) openRemoteSetup()
  else createWindow()

  // Иконка в трее: «Открыть чат» + режим агента. Приложение живёт в трее даже
  // при закрытом окне (агент продолжает работать).
  tray = new Tray(trayIcon())
  tray.setToolTip('Голос·Чат')
  initAgentMode(rebuildTrayMenu)
  rebuildTrayMenu()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showChat()
  })
})

// С треем окна могут быть скрыты — не выходим автоматически (выход через трей/Cmd-Q).
app.on('window-all-closed', () => {})

// Cmd-Q / выход из меню: снимаем перехват close, чтобы окно реально закрылось.
app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', () => {
  disposeAgentMode()
})
