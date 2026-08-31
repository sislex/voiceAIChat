// Адаптер доменных клиентов поверх мостов `window.*` (CHAT-236).
//
// Это единственное место приложения, где читаются window-мосты: хранилища видят
// только интерфейсы из `types.ts`. Транспорт при этом не переписан — под
// адаптером те же REST/WS-мосты, что и раньше.

import type { RendererApi } from '@shared/ipc'
import { createBrowserAudioController } from '../audio/browserAudio'
import { listMicrophones } from '../audio/microphones'
import { enqueueTtsAudio, stopTts } from '../lib/ttsPlayer'
import { VOICE_INPUT_ENABLED } from '../lib/featureFlags'
import { withApi } from './types'
import type {
  AppClients,
  AdminClient,
  ChatClient,
  DownloadPort,
  OperationsClient,
  PreferencesPort,
  ProjectsClient,
  SettingsClient
} from './types'

/** Есть ли мост в окне (в desktop/тестах часть мостов отсутствует). */
function bridge<K extends keyof Window>(name: K): Window[K] | undefined {
  return typeof window === 'undefined' ? undefined : window[name]
}

/** Предпочтения на localStorage: приватный режим и SSR не должны ронять UI. */
export const browserPreferences: PreferencesPort = {
  get(key) {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* localStorage недоступен — настройка просто не переживёт перезагрузку */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* см. выше */
    }
  }
}

/** Сохранение файла через временный `<a download>` и переход по ссылке. */
export const browserDownload: DownloadPort = {
  file(filename, mime, data) {
    saveBlob(filename, new Blob([data], { type: mime }))
  },
  bytes(filename, bytes) {
    // `BlobPart` в текущем lib.dom требует ArrayBuffer, а не ArrayBufferLike.
    saveBlob(filename, new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' }))
  },
  open(url) {
    window.location.assign(url)
  }
}

function saveBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function createAdminClient(api: RendererApi): AdminClient {
  return {
      listUsers: () => api['admin:users'](),
      usageSummary: (range) => api['admin:usageSummary'](range),
      userSessions: ({ name }) => api['admin:userSessions']({ name }).then((r) => r.sessions),
      revokeSession: ({ sid }) => api['admin:revokeSession']({ sid }).then(() => undefined),
      securityEvents: (input) => api['admin:securityEvents'](input).then((r) => r.events),
      listInvites: () => api['admin:invites']().then((r) => r.invites),
      resetCode: ({ name }) => api['admin:resetCode']({ name }),
      setUserLlmLimit: (input) => api['admin:setUserLlmLimit'](input),
      signupConfig: () => api['admin:signupConfig'](),
      setSignupConfig: (input) => api['admin:setSignupConfig'](input),
      createInvite: (input) => api['admin:inviteCreate'](input),
      deleteInvite: ({ token }) => api['admin:inviteDelete']({ token }).then(() => undefined),
      makeStats: () => api['admin:makeStats'](),
      machineStats: () => api['admin:machineStats'](),
      createUser: (input) => api['admin:createUser'](input),
      updateUserRole: (input) => api['admin:updateUserRole'](input),
      userMachines: ({ name }) => api['admin:userMachines']({ name }),
      setUserBlocked: (input) => api['admin:setBlocked'](input),
      deleteUser: (input) => api['admin:deleteUser'](input),
      getUserLlmAccess: (input) => api['admin:llmAccess'](input),
      replaceUserLlmAccess: (input) => api['admin:saveLlmAccess'](input),
      userUsage: (input) => api['admin:usage'](input),
      userConversations: (input) => api['admin:conversations'](input),
      userMessages: (input) => api['admin:messages'](input),
      pendingProjectTypes: () => api['admin:projectTypes'](),
      reviewProjectType: (input) => api['admin:reviewProjectType'](input),
      listLlmEngines: () => api['admin:llmEngines'](),
      createLlmEngine: (input) => api['admin:createLlmEngine'](input),
      updateLlmEngine: (input) => api['admin:updateLlmEngine'](input),
      deleteLlmEngine: (input) => api['admin:deleteLlmEngine'](input),
      checkLlmEngineHealth: (input) => api['admin:checkLlmEngineHealth'](input),
      listModelPrices: () => api['admin:modelPrices'](),
      saveModelPrice: (input) => api['admin:saveModelPrice'](input),
      deleteModelPrice: (input) => api['admin:deleteModelPrice'](input)
    }
}

/** Переопределения для тестов и сториз: всё, чего нет, берётся из окна. */
export interface BrowserClientOverrides extends Partial<AppClients> {
  api?: RendererApi
}

/**
 * Собирает клиенты из мостов окна. `overrides` полностью заменяют собранный
 * клиент домена — тесты подставляют фейки, не трогая остальные домены.
 */
export function createBrowserClients(overrides: BrowserClientOverrides = {}): AppClients {
  const api = overrides.api ?? (typeof window !== 'undefined' ? window.api : undefined as unknown as RendererApi)
  const claude = bridge('claude')
  const stt = bridge('stt')
  const tts = bridge('tts')
  const cc = bridge('cc')
  const codex = bridge('codex')

  const clients: AppClients = {
    ...(overrides.session ?? bridge('session') ? { session: overrides.session ?? bridge('session') } : {}),
    settings: overrides.settings ?? withApi<SettingsClient>(api, {
      ...(stt ? { sttStatus: () => api['stt:status'](), startModelDownload: () => stt.download() } : {}),
      ...(tts ? { startVoiceDownload: (id: string) => tts.downloadVoice({ id }) } : {}),
      listMics: listMicrophones
    }),
    chat: overrides.chat ?? withApi<ChatClient>(api, {
      ...(bridge('kb') ? { kb: bridge('kb') } : {}),
      turn: {
        enabled: !!claude,
        ...(claude
          ? {
              send: (
                conversationId: string,
                segments: Parameters<typeof claude.send>[0]['segments'],
                attachments?: string[],
                verbose?: boolean,
                execTarget?: string | null,
                messageId?: string
              ) => claude.send({ conversationId, messageId, segments, attachments, verbose, execTarget }),
              cancel: (conversationId?: string) =>
                claude.cancel(conversationId ? { conversationId } : undefined),
              editQueued: (conversationId: string, id: string, text: string) =>
                claude.editQueued?.({ conversationId, id, text, segments: [{ speakerId: 1, text }] }),
              deleteQueued: (conversationId: string, id: string) => claude.deleteQueued?.({ conversationId, id }),
              reorderQueued: (conversationId: string, ids: string[]) => claude.reorderQueued?.({ conversationId, ids }),
              sendQueuedNow: (conversationId: string, id: string) => claude.sendQueuedNow?.({ conversationId, id })
            }
          : {})
      }
    }),
    operations: overrides.operations ?? withApi<OperationsClient>(api, {
      ...(bridge('fs') ? { fs: bridge('fs') } : {}),
      ...(bridge('files') ? { files: bridge('files') } : {}),
      ...(cc ? { ccTailStart: (slug: string, id: string) => cc.tailStart({ slug, id }), ccTailStop: () => cc.tailStop() } : {}),
      ...(codex ? { cxTailStart: (id: string) => codex.tailStart({ id }), cxTailStop: () => codex.tailStop() } : {})
    }),
    admin: overrides.admin ?? createAdminClient(api),
    projects: overrides.projects ?? withApi<ProjectsClient>(api, {
      ...(bridge('board') ? { board: bridge('board') } : {}),
      ...(bridge('ci') ? { ci: bridge('ci') } : {})
    }),
    voiceInput:
      overrides.voiceInput !== undefined
        ? overrides.voiceInput
        : typeof window !== 'undefined' && window.audio
          ? createBrowserAudioController(window.audio)
          : null,
    stt: overrides.stt ?? { enabled: !!stt, inputEnabled: VOICE_INPUT_ENABLED },
    tts: overrides.tts ?? {
      enabled: !!tts,
      ...(tts
        ? {
            speak: (text: string, voice: string) => tts.speak({ text, voice }),
            cancel: () => {
              stopTts() // прервать воспроизведение уже полученных клипов
              tts.cancel() // прервать синтез в main
            }
          }
        : {})
    },
    playback: overrides.playback ?? { enqueue: enqueueTtsAudio, stop: stopTts },
    prefs: overrides.prefs ?? browserPreferences,
    download: overrides.download ?? browserDownload
  }
  return clients
}

