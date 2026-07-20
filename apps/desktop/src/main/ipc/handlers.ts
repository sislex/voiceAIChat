import type { VoiceChatDb } from '../db/database'
import type { IpcArg, IpcChannel, IpcResult, SttStatus, UploadInfo } from '@shared/ipc'
import type { TtsVoiceCatalog, TtsVoiceInfo, WhisperModel, WhisperModelInfo } from '@shared/types'
import type { McpServer } from '@shared/mcp'
import { listProjects, listSessions, readTranscript } from '../cc/ccSessions'

/**
 * Тип обработчика одного канала: получает аргумент, возвращает результат.
 * Синхронный или асинхронный (репозитории better-sqlite3 синхронны).
 */
export type Handler<C extends IpcChannel> = (
  arg: IpcArg<C>
) => IpcResult<C> | Promise<IpcResult<C>>

export type Handlers = { [C in IpcChannel]: Handler<C> }

export interface HandlerDeps {
  /** Статус модели Whisper (наличие файла). По умолчанию — «есть». */
  sttStatus?: () => SttStatus
  /** Реальные голоса TTS активного движка. По умолчанию — пусто. */
  listTtsVoices?: () => Promise<TtsVoiceInfo[]>
  /** Каталог скачиваемых голосов. По умолчанию — недоступно. */
  ttsCatalog?: () => TtsVoiceCatalog
  /** Сохранение вложения (base64) → метаданные. По умолчанию — ошибка. */
  saveUpload?: (name: string, dataBase64: string) => UploadInfo
  /** Список моделей Whisper с наличием/размером. По умолчанию — пусто. */
  listModels?: () => WhisperModelInfo[]
  /** Удалить файл модели Whisper. */
  deleteModel?: (model: WhisperModel) => void
  /** Удалить установленный голос Piper. */
  deleteVoice?: (id: string) => void
  /** Список MCP-серверов (read-only). По умолчанию — пусто. */
  listMcpServers?: () => McpServer[] | Promise<McpServer[]>
}

/**
 * Чистая фабрика обработчиков поверх БД — без зависимостей от Electron,
 * поэтому тестируется напрямую.
 */
export function createHandlers(db: VoiceChatDb, deps: HandlerDeps = {}): Handlers {
  const sttStatus = deps.sttStatus ?? (() => ({ present: true, model: db.getSettings().whisperModel }))
  const listTtsVoices = deps.listTtsVoices ?? (async () => [])
  const ttsCatalog = deps.ttsCatalog ?? (() => ({ downloadable: false, voices: [] }))
  return {
    'app:ping': () => 'pong',

    'conversations:list': () => db.listConversations(),

    'conversations:create': ({ title }) => db.createConversation(title),

    'conversations:get': ({ id }) => {
      const conversation = db.getConversation(id)
      if (!conversation) return null
      return { conversation, messages: db.listMessages(id) }
    },

    'conversations:search': ({ query }) => db.searchConversations(query),

    'conversations:rename': ({ id, title }) => {
      db.renameConversation(id, title)
    },

    'conversations:delete': ({ id }) => {
      db.deleteConversation(id)
    },

    'messages:add': ({ conversationId, role, text, time }) =>
      db.addMessage(conversationId, role, text, time),

    'messages:delete': ({ conversationId, messageId }) => {
      db.deleteMessage(conversationId, messageId)
      // История изменилась — сбрасываем сессию Claude, чтобы контекст пересобрался.
      db.setClaudeSession(conversationId, null)
    },

    'uploads:add': ({ name, dataBase64 }) => {
      if (!deps.saveUpload) throw new Error('Загрузка вложений недоступна')
      return deps.saveUpload(name, dataBase64)
    },

    'settings:get': () => db.getSettings(),

    'settings:save': (settings) => {
      db.saveSettings(settings)
    },

    'stt:status': () => sttStatus(),

    'stt:models': () => deps.listModels?.() ?? [],

    'stt:deleteModel': ({ model }) => {
      deps.deleteModel?.(model)
    },

    'tts:voices': () => listTtsVoices(),

    'tts:catalog': () => ttsCatalog(),

    'tts:deleteVoice': ({ id }) => {
      deps.deleteVoice?.(id)
    },

    'mcp:list': () => (deps.listMcpServers ? deps.listMcpServers() : []),

    // Машины-агенты — только в web-режиме (claude и так выполняется локально).
    'agents:list': () => [],
    'agents:create': () => {
      throw new Error('Машины-агенты не поддерживаются в desktop-приложении')
    },
    'agents:delete': () => {},

    'cc:projects': () => listProjects(),
    'cc:sessions': ({ slug }) => listSessions(slug),
    'cc:transcript': ({ slug, id, limit }) => readTranscript(slug, id, { limit })
  }
}
