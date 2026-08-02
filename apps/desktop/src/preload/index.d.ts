import type {
  RendererAgentsBridge,
  RendererApi,
  RendererAudioBridge,
  RendererBoardBridge,
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
import type { RendererCiBridge } from '../../../../packages/ui/src/remote/ciBridge'
import type { RendererKbBridge } from '../../../../packages/ui/src/remote/kbBridge'

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
    files?: RendererFilesBridge
    pty?: RendererPtyBridge
    /** CI-раннер (web); в desktop отсутствует. */
    ci?: RendererCiBridge
    /** Телеметрия использования базы знаний (в desktop отсутствует). */
    kb?: RendererKbBridge
  }
}

export {}
