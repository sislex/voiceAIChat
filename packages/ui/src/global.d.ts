// Глобальные мосты window.*, которые UI читает при инициализации. Каждое
// приложение внедряет их по-своему: desktop — через preload (Electron IPC),
// web — через installBridges (REST+WS). Формы контрактов общие (@shared/ipc).
import type {
  RendererAgentsBridge,
  RendererApi,
  RendererAudioBridge,
  RendererCcBridge,
  RendererClaudeBridge,
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
    /** Живой список агентов (web); в desktop отсутствует. */
    agents?: RendererAgentsBridge
  }
}

export {}
