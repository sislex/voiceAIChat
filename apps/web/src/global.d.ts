// Глобальные мосты window.*, которые в Electron инжектил preload, а в вебе —
// installBridges() поверх REST+WS сервера. Формы контрактов те же (@shared/ipc),
// поэтому стор и компоненты renderer переиспользуются без изменений.
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
    agents?: RendererAgentsBridge
  }
}

export {}
