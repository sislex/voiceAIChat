import type {
  RendererApi,
  RendererAudioBridge,
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
  }
}

export {}
