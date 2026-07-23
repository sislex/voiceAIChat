import { app, BrowserWindow, Menu, Tray, ipcMain, session, shell } from 'electron'
import { existsSync, statSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { VoiceChatDb } from './db/database'
import { trayIcon } from './trayIcon'
import { initAgentMode, agentMenuItems, disposeAgentMode } from './agentMode'
import { readServerUrl, writeServerUrl } from './remoteConfig'
import { registerIpc } from './ipc/register'
import { listMcpServers } from './claude/mcp'
import { WhisperEngine } from './stt/whisperEngine'
import { createSttService, type SttService } from './stt/sttService'
import { isModelPresent, listModels, modelPath } from './stt/models'
import { createModelDownloadService, type ModelDownloadService } from './stt/modelDownloadService'
import { StubDiarizationEngine } from './diarization/stubDiarization'
import { SayTtsEngine } from './tts/sayTts'
import { PiperTtsEngine } from './tts/piperTts'
import { piperVoiceFile } from './tts/piperVoices'
import { piperCatalog } from './tts/piperCatalog'
import { createTtsService, type TtsService } from './tts/ttsService'
import { createVoiceDownloadService, type VoiceDownloadService } from './tts/voiceDownloadService'
import type { TtsEngine } from './tts/types'
import type { TtsVoiceCatalog } from '@shared/types'
import { ClaudeCli } from './claude/claudeCli'
import { createClaudeService, type ClaudeService } from './claude/claudeService'
import { createCcService, type CcService } from './cc/ccService'
import { createCodexService, type CodexService } from './codex/codexService'
import { UploadStore } from './uploads'
import { DEFAULT_SETTINGS } from '@shared/types'

const isDev = !app.isPackaged

let db: VoiceChatDb | null = null
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let remoteSetupWindow: BrowserWindow | null = null
let disposeIpc: (() => void) | null = null
let sttService: SttService | null = null
let claudeService: ClaudeService | null = null
let ccService: CcService | null = null
let codexService: CodexService | null = null
let modelDownloadService: ModelDownloadService | null = null
let ttsService: TtsService | null = null
let voiceDownloadService: VoiceDownloadService | null = null

/**
 * Каталог с GGML-моделями Whisper. В dev — <project>/models; в упакованном
 * приложении — userData (bundle только для чтения, а модель качается при первом
 * запуске).
 */
function modelsDir(): string {
  // dev — общий с web/сервером каталог моделей (node_modules whisper.cpp), чтобы
  // модель не дублировалась между приложениями; prod — записываемый userData.
  return app.isPackaged
    ? join(app.getPath('userData'), 'models')
    : join(app.getAppPath(), 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp', 'models')
}

/** Каталог голосов Piper: dev — общий с web/сервером (resources/piper-voices,
 * он же источник бандла); prod — записываемый userData. */
function piperVoicesDir(): string {
  return app.isPackaged
    ? join(app.getPath('userData'), 'models', 'piper')
    : join(app.getAppPath(), 'resources', 'piper-voices')
}
/** Исполняемый piper: dev — .venv-piper; prod — вложенный standalone python. */
function piperBinPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'piper-runtime', 'python', 'bin', 'python3')
    : join(app.getAppPath(), '.venv-piper', 'bin', 'piper')
}
/** В prod piper запускается как `python -m piper`. */
function piperArgsPrefix(): string[] {
  return app.isPackaged ? ['-m', 'piper'] : []
}

/**
 * В упакованном приложении копирует вложённые голоса (resources/piper-voices)
 * в записываемый userData/models/piper, если их там ещё нет.
 */
function ensureBundledVoices(): void {
  if (!app.isPackaged) return
  const src = join(process.resourcesPath, 'piper-voices')
  const dst = piperVoicesDir()
  if (!existsSync(src)) return
  mkdirSync(dst, { recursive: true })
  for (const file of readdirSync(src)) {
    const to = join(dst, file)
    if (!existsSync(to)) copyFileSync(join(src, file), to)
  }
}

/**
 * Выбор TTS-движка: Piper (локально, лучше качество), если доступны исполняемый
 * piper и голос; иначе — macOS `say` (всегда доступен).
 */
function createTtsEngine(): TtsEngine {
  const voicesDir = piperVoicesDir()
  const piperBin = piperBinPath()
  const voicePath = join(voicesDir, piperVoiceFile(DEFAULT_SETTINGS.voice))
  if (existsSync(piperBin) && existsSync(voicePath)) {
    console.log('[tts] движок: Piper')
    return new PiperTtsEngine({ piperBin, voicesDir, argsPrefix: piperArgsPrefix() })
  }
  console.log('[tts] движок: say (Piper недоступен)')
  return new SayTtsEngine()
}

/** Каталог скачиваемых голосов Piper с отметкой «установлен». */
function ttsCatalog(): TtsVoiceCatalog {
  const voicesDir = piperVoicesDir()
  const downloadable = existsSync(piperBinPath())
  const voices = piperCatalog().map((v) => ({
    ...v,
    installed: existsSync(join(voicesDir, `${v.id}.onnx`))
  }))
  return { downloadable, voices }
}

function createWindow(): void {
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
  const serverUrl = readServerUrl(app.getPath('userData'))
  const modeLabel = serverUrl ? `Режим: сервер ${serverUrl}` : 'Режим: локальный'
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Открыть чат', click: () => showChat() },
      { type: 'separator' },
      { label: modeLabel, enabled: false },
      { label: 'Подключиться к серверу…', click: () => openRemoteSetup() },
      ...(serverUrl
        ? [{ label: 'Локальный режим', click: () => applyServerUrl(null) }]
        : []),
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

/** Сохранить URL сервера и перезагрузить окно чата в нужном режиме. */
function applyServerUrl(url: string | null): void {
  writeServerUrl(app.getPath('userData'), url)
  remoteSetupWindow?.close()
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
  db = new VoiceChatDb(join(app.getPath('userData'), 'voicechat.db'))
  const currentModel = (): (typeof DEFAULT_SETTINGS)['whisperModel'] =>
    db?.getSettings().whisperModel ?? DEFAULT_SETTINGS.whisperModel

  ensureBundledVoices()
  const ttsEngine = createTtsEngine()

  // Хранилище вложений на диске (userData/uploads): base64 → файл, id → путь.
  const uploads = new UploadStore(join(app.getPath('userData'), 'uploads'))

  disposeIpc = registerIpc(db, {
    sttStatus: () => ({
      present: isModelPresent(modelsDir(), currentModel(), { existsSync, statSync }),
      model: currentModel()
    }),
    listTtsVoices: () => ttsEngine.listVoices(),
    ttsCatalog,
    listMcpServers: () => listMcpServers(),
    saveUpload: (name, dataBase64) => {
      const rec = uploads.save(name, Buffer.from(dataBase64, 'base64'))
      return { id: rec.id, name: rec.name }
    },
    listModels: () => listModels(modelsDir(), { existsSync, statSync }),
    deleteModel: (model) => {
      const p = modelPath(modelsDir(), model)
      rmSync(p, { force: true })
      rmSync(`${p}.part`, { force: true })
    },
    deleteVoice: (id) => {
      const onnx = join(piperVoicesDir(), `${id}.onnx`)
      rmSync(onnx, { force: true })
      rmSync(`${onnx}.json`, { force: true })
    }
  })

  // STT-движок читает текущую модель из настроек на каждый прогон.
  const engine = new WhisperEngine({ modelsDir: modelsDir(), getModel: currentModel })
  sttService = createSttService({
    engine,
    send: (channel, payload) => mainWindow?.webContents.send(channel, payload),
    diarization: new StubDiarizationEngine(),
    isDiarizationEnabled: () => db?.getSettings().diarization ?? true
  })

  modelDownloadService = createModelDownloadService({
    modelsDir: modelsDir(),
    getModel: currentModel,
    send: (channel, payload) => mainWindow?.webContents.send(channel, payload)
  })

  // TTS: локальный синтез (Piper, если доступен; иначе macOS `say`).
  ttsService = createTtsService({
    engine: ttsEngine,
    send: (channel, payload) => mainWindow?.webContents.send(channel, payload)
  })

  // Скачивание голосов Piper из настроек.
  voiceDownloadService = createVoiceDownloadService({
    voicesDir: piperVoicesDir(),
    send: (channel, payload) => mainWindow?.webContents.send(channel, payload)
  })

  // Claude Code CLI: session-id и модель берутся из БД/настроек в сервисе.
  claudeService = createClaudeService({
    client: new ClaudeCli(),
    db,
    send: (channel, payload) => mainWindow?.webContents.send(channel, payload),
    resolveUpload: (id) => uploads.pathById(id)
  })

  // Проводник Claude Code: live-tail сессий (~/.claude/projects).
  ccService = createCcService({
    send: (channel, payload) => mainWindow?.webContents.send(channel, payload)
  })

  // Проводник Codex: live-tail сессий (~/.codex/sessions).
  codexService = createCodexService({
    send: (channel, payload) => mainWindow?.webContents.send(channel, payload)
  })

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
  // Синхронно для preload: решить, внедрять ли локальные IPC-мосты (иначе их ставит
  // renderer как REST+WS против сервера; contextBridge-свойства перезаписать нельзя).
  ipcMain.on('remote:getUrlSync', (e) => {
    e.returnValue = readServerUrl(app.getPath('userData'))
  })

  createWindow()

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
  claudeService?.dispose()
  ccService?.dispose()
  codexService?.dispose()
  sttService?.dispose()
  modelDownloadService?.dispose()
  ttsService?.dispose()
  voiceDownloadService?.dispose()
  disposeIpc?.()
  db?.close()
  db = null
})
