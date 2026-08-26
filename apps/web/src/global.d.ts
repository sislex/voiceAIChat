// Глобальные мосты window.*, которые в Electron инжектил preload, а в вебе —
// installBridges() поверх REST+WS сервера. Формы контрактов те же (@shared/ipc),
// поэтому стор и компоненты renderer переиспользуются без изменений.
import type {
  RendererAgentsBridge,
  RendererBoardBridge,
  RendererApi,
  RendererAudioBridge,
  RendererAuthBridge,
  RendererBrowserBridge,
  RendererCcBridge,
  RendererClaudeBridge,
  RendererCodexBridge,
  RendererFilesBridge,
  RendererFsBridge,
  RendererPreviewBridge,
  RendererRealtimeBridge,
  RendererPtyBridge,
  RendererMakeBridge,
  RendererSessionBridge,
  RendererSttBridge,
  RendererTtsBridge
} from '@shared/ipc'
import type { RendererCiBridge, RendererFeaturePreviewBridge, RendererKbBridge, RendererQaBridge } from '@voicechat/ui'

declare global {
  interface Window {
    api: RendererApi
    audio: RendererAudioBridge
    auth?: RendererAuthBridge
    stt: RendererSttBridge
    claude: RendererClaudeBridge
    tts: RendererTtsBridge
    cc: RendererCcBridge
    codex: RendererCodexBridge
    agents?: RendererAgentsBridge
    realtime?: RendererRealtimeBridge
    board?: RendererBoardBridge
    session?: RendererSessionBridge
    fs?: RendererFsBridge
    files?: RendererFilesBridge
    pty?: RendererPtyBridge
    /** Make: события изменения файлов проекта (только web). */
    make?: RendererMakeBridge
    ci?: RendererCiBridge
    /** Телеметрия использования базы знаний (web). */
    kb?: RendererKbBridge
    /** Действия модели в панели веб-превью (web). */
    preview?: RendererPreviewBridge
    /** Изолированный Chromium Playwright Reader (web). */
    browser?: RendererBrowserBridge
    featurePreview?: RendererFeaturePreviewBridge
    qa?: RendererQaBridge
  }
}

export {}
