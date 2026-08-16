// Доменные клиенты (CHAT-236): единственная граница между хранилищами и внешним
// миром. Хранилище получает только эти интерфейсы, поэтому в нём нет ни
// `window.*`, ни fetch/WebSocket, ни Electron — их знает адаптер `browser.ts`.
//
// Наборы методов собраны `Pick` из общего контракта `RendererApi`: так домен
// объявляет ровно то, чем пользуется, а расхождение с протоколом ловит `tsc`, а
// не глаз. Транспорт при этом остаётся прежним — мосты `window.*` только
// оборачиваются адаптером (промежуточный шаг перед выделением приложений).

import type {
  RendererApi,
  RendererBoardBridge,
  RendererFilesBridge,
  RendererFsBridge,
  RendererSessionBridge,
  SttSegmentWire,
  SttStatus
} from '@shared/ipc'
import type { RendererCiBridge } from '../remote/ciBridge'
import type { RendererKbBridge } from '../remote/kbBridge'
import type { AudioController } from '../audio/browserAudio'
import type { MicDevice } from '../audio/microphones'

/**
 * Клиент домена = его собственные порты плюс живая ссылка на общий `RendererApi`.
 * Именно живая: копировать методы в новый объект нельзя — тест, подменяющий
 * метод моста уже после создания runtime, получил бы старую функцию, а мост в
 * desktop/web устанавливается хостом однажды и по имени.
 */
export function withApi<T extends object>(api: RendererApi, ports: object): T {
  return new Proxy(ports, {
    get: (target, prop, receiver) =>
      prop in target ? Reflect.get(target, prop, receiver) : (api as unknown as Record<PropertyKey, unknown>)[prop],
    has: (target, prop) => prop in target || prop in (api as unknown as object)
  }) as T
}

/** Сессия пользователя (web). Отсутствует в desktop — там вход не требуется. */
export type SessionClient = RendererSessionBridge

/** Настройки, каталоги моделей/голосов и системные возможности. */
export type SettingsClient = Pick<
  RendererApi,
  | 'settings:get'
  | 'settings:save'
  | 'llm:engines'
  | 'llm:access'
  | 'system:capabilities'
  | 'mcp:list'
  | 'auth:status'
  | 'stt:models'
  | 'stt:deleteModel'
  | 'tts:voices'
  | 'tts:catalog'
  | 'tts:deleteVoice'
> & {
  /** Статус локальной модели Whisper (наличие файла). */
  sttStatus?: () => Promise<SttStatus>
  /** Запуск скачивания модели Whisper. */
  startModelDownload?: () => void
  /** Запуск скачивания голоса Piper. */
  startVoiceDownload?: (id: string) => void
  /** Список микрофонов (enumerateDevices). */
  listMics?: () => Promise<MicDevice[]>
}

/** Отправка и отмена хода LLM (renderer → main/WS). */
export interface ChatTurnPort {
  /** Ход исполняет реальный LLM (иначе — мок-пайплайн стора). */
  enabled: boolean
  send?: (
    conversationId: string,
    segments: SttSegmentWire[],
    attachments?: string[],
    verbose?: boolean,
    execTarget?: string | null,
    messageId?: string
  ) => void
  cancel?: (conversationId?: string) => void
  editQueued?: (conversationId: string, id: string, text: string) => void
  deleteQueued?: (conversationId: string, id: string) => void
  sendQueuedNow?: (conversationId: string, id: string) => void
}

/** Разговоры, сообщения, поиск, вложения и телеметрия БЗ. */
export type ChatClient = Pick<
  RendererApi,
  | 'conversations:list'
  | 'conversations:create'
  | 'conversations:createDraft'
  | 'conversations:get'
  | 'conversations:search'
  | 'conversations:rename'
  | 'conversations:setProject'
  | 'conversations:setPreviewUrl'
  | 'conversations:setStatus'
  | 'conversations:setExecTarget'
  | 'conversations:listMachines'
  | 'conversations:taskContext'
  | 'conversations:taskChats'
  | 'conversations:delete'
  | 'messages:add'
  | 'messages:updateMeta'
  | 'messages:delete'
  | 'messages:search'
  | 'uploads:add'
  | 'prompt:suggest'
  | 'kb:status'
> & {
  turn: ChatTurnPort
  /** Телеметрия БЗ (web); без неё панель живёт на фолбэке из истории. */
  kb?: RendererKbBridge
}

/** Машины, их утилиты и наблюдатели сессий CLI. */
export type OperationsClient = Pick<
  RendererApi,
  | 'agents:list'
  | 'agents:create'
  | 'agents:delete'
  | 'agents:setPolicy'
  | 'agents:regenerateToken'
  | 'agents:update'
  | 'agents:connectionString'
  | 'downloads:url'
  | 'cc:projects'
  | 'cc:sessions'
  | 'cc:transcript'
  | 'cc:resume'
  | 'cx:projects'
  | 'cx:sessions'
  | 'cx:transcript'
  | 'cx:resume'
> & {
  /** Файловые операции и exec на машине. */
  fs?: RendererFsBridge
  /** Чтение файлов с диска сервера (картинки, созданные CLI). */
  files?: RendererFilesBridge
  /** Live-tail транскрипта Claude Code. */
  ccTailStart?: (slug: string, id: string) => void
  ccTailStop?: () => void
  /** Live-tail транскрипта Codex. */
  cxTailStart?: (id: string) => void
  cxTailStop?: () => void
}

/** Администрирование: пользователи, расход, прайсы и реестр исполнителей. */
export type AdminClient = Pick<
  RendererApi,
  | 'admin:users'
  | 'admin:usageSummary'
  | 'admin:llmAccess'
  | 'admin:saveLlmAccess'
  | 'admin:createUser'
  | 'admin:setBlocked'
  | 'admin:deleteUser'
  | 'admin:usage'
  | 'admin:conversations'
  | 'admin:messages'
  | 'admin:modelPrices'
  | 'admin:saveModelPrice'
  | 'admin:deleteModelPrice'
  | 'admin:llmEngines'
  | 'admin:createLlmEngine'
  | 'admin:updateLlmEngine'
  | 'admin:deleteLlmEngine'
  | 'admin:checkLlmEngineHealth'
  | 'usage:report'
  | 'conversations:list'
  | 'llm:access'
>

/**
 * Проекты, доска и CI-раннер. Домен временно остаётся в `packages/ui`: перенос
 * его состояния в `@voicechat/projects-app` — отдельный шаг (см. `docs/kb/ui.md`).
 */
export type ProjectsClient = Pick<
  RendererApi,
  | 'projects:list'
  | 'projects:create'
  | 'projects:get'
  | 'projects:update'
  | 'projects:delete'
  | 'projects:addMember'
  | 'projects:updateMemberRole'
  | 'projects:removeMember'
  | 'projects:linkMachine'
  | 'projects:unlinkMachine'
  | 'projects:setMachinePath'
  | 'projects:setReposRoot'
  | 'projects:setDefaultMachine'
  | 'board:get'
  | 'columns:create'
  | 'columns:rename'
  | 'columns:setHidden'
  | 'columns:reorder'
  | 'columns:delete'
  | 'tasks:create'
  | 'tasks:update'
  | 'tasks:move'
  | 'tasks:delete'
  | 'tasks:openChat'
> & {
  /** Живая доска (web). */
  board?: RendererBoardBridge
  /** CI-раннер (web). */
  ci?: RendererCiBridge
}

/** Захват микрофона: старт/стоп записи и монитор энергии для VAD. */
export type VoiceInputPort = AudioController

/** Распознавание речи: живые события приходят через runtime, здесь — режим. */
export interface SttPort {
  /** true — транскрипт даёт реальный Whisper (события `stt:*`). */
  enabled: boolean
  /** Разрешён ли захват микрофона вообще (capability gate приложения). */
  inputEnabled: boolean
}

/** Синтез речи. */
export interface TtsPort {
  enabled: boolean
  speak?: (text: string, voice: string) => void
  /** Прервать и синтез, и воспроизведение уже полученных клипов. */
  cancel?: () => void
}

/** Воспроизведение синтезированных клипов в браузере. */
export interface AudioPlaybackPort {
  enqueue: (audio: ArrayBuffer, onDone: () => void) => void
  stop: () => void
}

/** Постоянные пользовательские предпочтения (localStorage). */
export interface PreferencesPort {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

/** Сохранение файла и переход по ссылке (экспорт, скачивание артефактов). */
export interface DownloadPort {
  file(filename: string, mime: string, data: string): void
  bytes(filename: string, bytes: Uint8Array): void
  open(url: string): void
}

/** Полный набор клиентов приложения — то, что получает `createAppRuntime`. */
export interface AppClients {
  session?: SessionClient
  settings: SettingsClient
  chat: ChatClient
  operations: OperationsClient
  admin: AdminClient
  projects: ProjectsClient
  voiceInput?: VoiceInputPort | null
  stt: SttPort
  tts: TtsPort
  playback?: AudioPlaybackPort
  prefs: PreferencesPort
  download: DownloadPort
}

