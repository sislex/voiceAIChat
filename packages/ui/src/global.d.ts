// Глобальные мосты window.*, которые UI читает при инициализации. Каждое
// приложение внедряет их по-своему: desktop — через preload (Electron IPC),
// web — через installBridges (REST+WS). Формы контрактов общие (@shared/ipc).
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
  RendererWidgetUiBridge,
  RendererRealtimeBridge,
  RendererPtyBridge,
  RendererMakeBridge,
  RendererSessionBridge,
  RendererSttBridge,
  RendererTtsBridge
} from '@shared/ipc'
import type { RendererCiBridge } from './remote/ciBridge'
import type { RendererKbBridge } from './remote/kbBridge'
import type { RendererFeaturePreviewBridge } from './remote/featurePreviewBridge'
import type { RendererQaBridge } from './remote/qaBridge'

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
    /** Живой список агентов (web); в desktop отсутствует. */
    agents?: RendererAgentsBridge
    /** Lifecycle и общие адресные realtime-события (web). */
    realtime?: RendererRealtimeBridge
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
    /** Make: события изменения файлов проекта (только web). */
    make?: RendererMakeBridge
    /** CI-раннер (web); в desktop отсутствует. */
    ci?: RendererCiBridge
    /** Телеметрия использования базы знаний (web); в desktop отсутствует. */
    kb?: RendererKbBridge
    /** Действия модели в панели веб-превью (web); в desktop отсутствует. */
    preview?: RendererPreviewBridge
    widgetUi?: RendererWidgetUiBridge
    /** Изолированный Chromium Playwright Reader (web); в desktop отсутствует. */
    browser?: RendererBrowserBridge
    /** Управляемое окружение feature-ветки задачи. */
    featurePreview?: RendererFeaturePreviewBridge
    /** Структурированные критерии и результаты ручного QA. */
    qa?: RendererQaBridge
  }
}

export {}
