// Тестовый харнесс доменных хранилищ (CHAT-236).
//
// ЭТО НЕ ПРОДУКТОВЫЙ ФАСАД: файл живёт в `src/test/` и в сборку приложения не
// попадает. Он нужен поведенческим тестам, которые проверяют сценарий целиком
// («отправил → ушёл запрос → изменился экран») и которым удобно смотреть на
// один снимок и один набор действий, а не собирать их из семи доменов вручную.
// Контракт каждого домена по отдельности проверяют `store/domains/*.test.ts`.

import type { RendererApi, RendererBoardBridge, RendererFilesBridge, RendererFsBridge, RendererSessionBridge, SttSegmentWire, SttStatus } from '@shared/ipc'
import type { RendererCiBridge } from '../remote/ciBridge'
import type { RendererKbBridge } from '../remote/kbBridge'
import type { AudioController } from '../audio/browserAudio'
import type { MicDevice } from '../audio/microphones'
import { withApi } from '../clients/types'
import { createAdminClient } from '../clients/browser'
import type {
  AppClients,
  ChatClient,
  OperationsClient,
  PreferencesPort,
  ProjectsClient,
  SettingsClient
} from '../clients/types'
import { createAppRuntime, type AppRuntime, type RealtimeConnect } from '../runtime/appRuntime'
import type { PipelineDelays } from '../store/mockPipeline'

/** Deps в форме прежнего глобального стора — тесты писались под неё. */
export interface HarnessDeps {
  api: RendererApi
  session?: RendererSessionBridge
  fs?: RendererFsBridge
  files?: RendererFilesBridge
  board?: RendererBoardBridge
  ci?: RendererCiBridge
  kb?: RendererKbBridge
  now?: () => number
  delays?: Partial<PipelineDelays>
  audio?: AudioController | null
  listMics?: () => Promise<MicDevice[]>
  sttEnabled?: boolean
  voiceInputEnabled?: boolean
  claudeEnabled?: boolean
  sendClaudePrompt?: (
    conversationId: string,
    segments: SttSegmentWire[],
    attachments?: string[],
    verbose?: boolean,
    execTarget?: string | null,
    messageId?: string
  ) => void
  cancelClaude?: (conversationId?: string) => void
  editQueued?: (conversationId: string, id: string, text: string) => void
  deleteQueued?: (conversationId: string, id: string) => void
  sendQueuedNow?: (conversationId: string, id: string) => void
  getSttStatus?: () => Promise<SttStatus>
  startModelDownload?: () => void
  ttsEnabled?: boolean
  speakText?: (text: string, voice: string) => void
  cancelTts?: () => void
  startVoiceDownload?: (id: string) => void
  download?: (filename: string, mime: string, data: string) => void
  openUrl?: (url: string) => void
  ccTailStart?: (slug: string, id: string) => void
  ccTailStop?: () => void
  cxTailStart?: (id: string) => void
  cxTailStop?: () => void
  realtime?: RealtimeConnect
  prefs?: PreferencesPort
}

/** localStorage-предпочтения: ключи те же, что в браузере. */
const testPreferences: PreferencesPort = {
  get: (key) => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* jsdom без storage */
    }
  },
  remove: (key) => {
    try {
      localStorage.removeItem(key)
    } catch {
      /* jsdom без storage */
    }
  }
}

export function buildTestClients(deps: HarnessDeps): AppClients {
  const api = deps.api
  return {
    ...(deps.session ? { session: deps.session } : {}),
    settings: withApi<SettingsClient>(api, {
      ...(deps.getSttStatus ? { sttStatus: deps.getSttStatus } : {}),
      ...(deps.startModelDownload ? { startModelDownload: deps.startModelDownload } : {}),
      ...(deps.startVoiceDownload ? { startVoiceDownload: deps.startVoiceDownload } : {}),
      ...(deps.listMics ? { listMics: deps.listMics } : {})
    }),
    chat: withApi<ChatClient>(api, {
      ...(deps.kb ? { kb: deps.kb } : {}),
      turn: {
        enabled: deps.claudeEnabled ?? false,
        ...(deps.sendClaudePrompt ? { send: deps.sendClaudePrompt } : {}),
        ...(deps.cancelClaude ? { cancel: deps.cancelClaude } : {}),
        ...(deps.editQueued ? { editQueued: deps.editQueued } : {}),
        ...(deps.deleteQueued ? { deleteQueued: deps.deleteQueued } : {}),
        ...(deps.sendQueuedNow ? { sendQueuedNow: deps.sendQueuedNow } : {})
      }
    }),
    operations: withApi<OperationsClient>(api, {
      ...(deps.fs ? { fs: deps.fs } : {}),
      ...(deps.files ? { files: deps.files } : {}),
      ...(deps.ccTailStart ? { ccTailStart: deps.ccTailStart } : {}),
      ...(deps.ccTailStop ? { ccTailStop: deps.ccTailStop } : {}),
      ...(deps.cxTailStart ? { cxTailStart: deps.cxTailStart } : {}),
      ...(deps.cxTailStop ? { cxTailStop: deps.cxTailStop } : {})
    }),
    admin: createAdminClient(api),
    projects: withApi<ProjectsClient>(api, {
      ...(deps.board ? { board: deps.board } : {}),
      ...(deps.ci ? { ci: deps.ci } : {})
    }),
    voiceInput: deps.audio ?? null,
    stt: { enabled: deps.sttEnabled ?? false, inputEnabled: deps.voiceInputEnabled ?? true },
    tts: {
      enabled: deps.ttsEnabled ?? false,
      ...(deps.speakText ? { speak: deps.speakText } : {}),
      ...(deps.cancelTts ? { cancel: deps.cancelTts } : {})
    },
    prefs: deps.prefs ?? testPreferences,
    download: {
      file: (filename, mime, data) => deps.download?.(filename, mime, data),
      bytes: () => {},
      open: (url) => deps.openUrl?.(url)
    }
  }
}

/** Плоский снимок всех доменов — только для утверждений в тестах. */
export function combinedState(runtime: AppRuntime): Record<string, unknown> {
  return {
    ...runtime.shell.getState(),
    ...runtime.session.getState(),
    ...runtime.settings.getState(),
    ...runtime.operations.getState(),
    ...runtime.admin.getState(),
    ...runtime.projects.getState(),
    ...runtime.voice.getState(),
    ...runtime.chat.getState()
  }
}

export type CombinedState = ReturnType<AppRuntime['shell']['getState']> &
  ReturnType<AppRuntime['session']['getState']> &
  ReturnType<AppRuntime['settings']['getState']> &
  ReturnType<AppRuntime['operations']['getState']> &
  ReturnType<AppRuntime['admin']['getState']> &
  ReturnType<AppRuntime['projects']['getState']> &
  ReturnType<AppRuntime['voice']['getState']> &
  ReturnType<AppRuntime['chat']['getState']>

export interface TestStore {
  runtime: AppRuntime
  getState(): CombinedState
  subscribe(listener: () => void): () => void
  actions: TestActions
}

export type TestActions = AppRuntime['shell']['actions'] &
  AppRuntime['settings']['actions'] &
  AppRuntime['operations']['actions'] &
  AppRuntime['admin']['actions'] &
  AppRuntime['projects']['actions'] &
  AppRuntime['voice']['actions'] &
  AppRuntime['chat']['actions'] & {
    init(preferredChatId?: string | null): Promise<void>
    login(name: string, password: string): Promise<void>
    logout(): Promise<void>
    suggestPrompts(): Promise<void>
    resumeCcSession(slug: string, id: string): Promise<string | null>
    resumeCxSession(id: string): Promise<string | null>
    openKbUsage(): void
    closeKbUsage(): void
    dispose(): void
  }

/**
 * Создаёт runtime на фейковых клиентах и отдаёт его в форме прежнего стора.
 * Подписка — на все домены сразу (тесты ждут одного `subscribe`).
 */
export function createTestStore(deps: HarnessDeps): TestStore {
  const runtime = createAppRuntime({
    clients: buildTestClients(deps),
    ...(deps.realtime ? { realtime: deps.realtime } : {}),
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.delays ? { delays: deps.delays } : {})
  })

  const actions = {
    ...runtime.shell.actions,
    ...runtime.settings.actions,
    ...runtime.operations.actions,
    ...runtime.admin.actions,
    ...runtime.projects.actions,
    ...runtime.voice.actions,
    ...runtime.chat.actions,
    init: (preferredChatId?: string | null) => runtime.start(preferredChatId ?? null),
    login: (name: string, password: string) => runtime.login(name, password),
    logout: () => runtime.logout(),
    openUsers: () => runtime.openAdmin(),
    suggestPrompts: () => runtime.chat.actions.suggestPrompts(runtime.settings.getState().settings.aiAssistPrompts),
    resumeCcSession: (slug: string, id: string) => runtime.resumeCcSession(slug, id),
    resumeCxSession: (id: string) => runtime.resumeCxSession(id),
    openKbUsage: () => runtime.openKbUsage(),
    closeKbUsage: () => runtime.closeKbUsage(),
    dispose: () => runtime.dispose()
  } as unknown as TestActions

  return {
    runtime,
    getState: () => combinedState(runtime) as unknown as CombinedState,
    subscribe(listener) {
      const unsubs = [
        runtime.shell.subscribe(listener),
        runtime.session.subscribe(listener),
        runtime.settings.subscribe(listener),
        runtime.operations.subscribe(listener),
        runtime.admin.subscribe(listener),
        runtime.projects.subscribe(listener),
        runtime.voice.subscribe(listener),
        runtime.chat.subscribe(listener)
      ]
      return () => unsubs.forEach((u) => u())
    },
    actions
  }
}

