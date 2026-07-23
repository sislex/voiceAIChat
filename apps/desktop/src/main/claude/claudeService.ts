// Сервис Claude (Шаг 8): принимает claude:send из renderer, ведёт session-id по
// разговору в БД, читает модель из настроек, стримит ответ обратно событиями.

import { ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import type { IpcEventChannel, IpcEventPayload, IpcSendPayload } from '@shared/ipc'
import type { VoiceChatDb } from '../db/database'
import { claudeModelAlias, buildPrompt, buildConversationPrompt } from './prompt'
import type { LlmClient, LlmHandle } from './types'

export interface ClaudeServiceDeps {
  client: LlmClient
  db: VoiceChatDb
  send: <C extends IpcEventChannel>(channel: C, payload: IpcEventPayload<C>) => void
  /** Резолв id вложения → абсолютный путь (для промпта Claude). */
  resolveUpload?: (id: string) => string | undefined
}

export interface ClaudeService {
  dispose(): void
}

export function createClaudeService(deps: ClaudeServiceDeps): ClaudeService {
  let current: LlmHandle | null = null

  const onSend = (_e: unknown, payload: IpcSendPayload<'claude:send'>): void => {
    const { conversationId, segments } = payload
    current?.cancel() // barge-in/повторная отправка отменяет предыдущий запрос
    const conversation = deps.db.getConversation(conversationId)
    const sessionId = conversation?.claudeSessionId ?? null
    const settings = deps.db.getSettings()
    const model = claudeModelAlias(settings.model)
    const permissionMode = settings.permissionMode
    const cwd = settings.workdir && existsSync(settings.workdir) ? settings.workdir : undefined
    const attachmentPaths = (payload.attachments ?? [])
      .map((id) => deps.resolveUpload?.(id))
      .filter((p): p is string => typeof p === 'string')
    // Есть сессия → продолжаем одним ходом; нет → пересобираем контекст из текущей
    // истории БД (без удалённых реплик), чтобы модель их «забыла».
    const prompt = sessionId
      ? buildPrompt(segments, attachmentPaths)
      : buildConversationPrompt(deps.db.listMessages(conversationId), attachmentPaths)

    current = deps.client.send(
      { prompt, sessionId, model, permissionMode, cwd },
      {
        onSession: (sid) => deps.db.setClaudeSession(conversationId, sid),
        onDelta: (delta) => deps.send('claude:token', { conversationId, delta }),
        onDone: (text, meta) =>
          deps.send('claude:done', { conversationId, text, meta, engine: 'claude' }),
        onError: (message) => deps.send('claude:error', { conversationId, message }),
        // Режим консоли: активность агента шлём только если клиент попросил.
        onActivity: payload.verbose
          ? (entry) => deps.send('claude:log', { conversationId, entry })
          : undefined
      }
    )
  }

  const onCancel = (): void => {
    current?.cancel()
    current = null
  }

  ipcMain.on('claude:send', onSend)
  ipcMain.on('claude:cancel', onCancel)

  return {
    dispose(): void {
      current?.cancel()
      ipcMain.removeListener('claude:send', onSend)
      ipcMain.removeListener('claude:cancel', onCancel)
    }
  }
}
