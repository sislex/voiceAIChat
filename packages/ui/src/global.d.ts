// Глобальные мосты window.*, которые UI читает при инициализации. Каждое
// приложение внедряет их по-своему: desktop — через preload (Electron IPC),
// web — через installBridges (REST+WS). Формы контрактов общие (@shared/ipc).
import type {
  RendererAgentsBridge,
  RendererApi,
  RendererAudioBridge,
  RendererCcBridge,
  RendererClaudeBridge,
  RendererCodexBridge,
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
    /** Сессия пользователя (web); в desktop отсутствует → без экрана логина. */
    session?: RendererSessionBridge
  }
}

export {}
