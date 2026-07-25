import type {
  RendererAgentsBridge,
  RendererApi,
  RendererAudioBridge,
  RendererCcBridge,
  RendererClaudeBridge,
  RendererCodexBridge,
  RendererFsBridge,
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
    /** Файловый проводник по машине-агенту (web); в desktop отсутствует. */
    fs?: RendererFsBridge
  }
}

export {}
