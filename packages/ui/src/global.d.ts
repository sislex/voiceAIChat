// Глобальные мосты window.*, которые UI читает при инициализации. Каждое
// приложение внедряет их по-своему: desktop — через preload (Electron IPC),
// web — через installBridges (REST+WS). Формы контрактов общие (@shared/ipc).
import type {
  RendererAgentsBridge,
  RendererBoardBridge,
  RendererApi,
  RendererAudioBridge,
  RendererCcBridge,
  RendererClaudeBridge,
  RendererCodexBridge,
  RendererFilesBridge,
  RendererFsBridge,
  RendererPtyBridge,
  RendererSessionBridge,
  RendererSttBridge,
  RendererTtsBridge
} from '@shared/ipc'

declare global {
  interface Window {
    api: RendererApi
    audio: RendererAudioBridge
    stt: RendererSttBridge
    claude: RendererClaudeBridge
    tts: RendererTtsBridge
    cc: RendererCcBridge
    codex: RendererCodexBridge
    /** Живой список агентов (web); в desktop отсутствует. */
    agents?: RendererAgentsBridge
    /** Живая канбан-доска проекта (web); в desktop отсутствует. */
    board?: RendererBoardBridge
    /** Сессия пользователя (web); в desktop отсутствует → без экрана логина. */
    session?: RendererSessionBridge
    /** Файловый проводник по машине-агенту (web); в desktop отсутствует. */
    fs?: RendererFsBridge
    /** Чтение файлов с диска сервера (web); в desktop отсутствует. */
    files?: RendererFilesBridge
    /** Живой PTY-терминал по машине (web); в desktop отсутствует. */
    pty?: RendererPtyBridge
  }
}

export {}
