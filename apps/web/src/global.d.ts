// Глобальные мосты window.*, которые в Electron инжектил preload, а в вебе —
// installBridges() поверх REST+WS сервера. Формы контрактов те же (@shared/ipc),
// поэтому стор и компоненты renderer переиспользуются без изменений.
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
import type { RendererCiBridge, RendererKbBridge } from '@voicechat/ui'

declare global {
  interface Window {
    api: RendererApi
    audio: RendererAudioBridge
    stt: RendererSttBridge
    claude: RendererClaudeBridge
    tts: RendererTtsBridge
    cc: RendererCcBridge
    codex: RendererCodexBridge
    agents?: RendererAgentsBridge
    board?: RendererBoardBridge
    session?: RendererSessionBridge
    fs?: RendererFsBridge
    files?: RendererFilesBridge
    pty?: RendererPtyBridge
    ci?: RendererCiBridge
    /** Телеметрия использования базы знаний (web). */
    kb?: RendererKbBridge
  }
}

export {}
