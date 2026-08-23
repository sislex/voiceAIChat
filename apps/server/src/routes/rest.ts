// REST-роуты поверх VoiceChatDb (Ф3): разговоры, сообщения, настройки.

import { join } from 'node:path'
import type { FastifyInstance, FastifyReply } from 'fastify'
import {
  REST,
  CONVERSATION_STATUSES,
  type ConversationStatus,
  ccResumeMessages,
  ccResumeTitle,
  ccTimeLabel,
  cxResumeMessages,
  cxResumeTitle,
  cxTimeLabel,
  type AddMessageArgs,
  type DesktopMigrationBundle,
  type Settings,
  type UsageUnit
} from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import { uid } from '../users/auth.js'
import { readUserFile } from '../serverFiles.js'
import { ensureCliProfile, listMcpServers } from '@voicechat/llm-runner/cli'
import { getLoginStatus } from '../auth/loginStatus.js'
import type { RunnerFsClient } from '../llm/runnerFsClient.js'
import type { AuthStatusState } from '../auth/statusState.js'
import { listProjects, listSessions, readTranscript, readUsage } from '../cc/ccSessions.js'
import {
  listCxProjects,
  listCxSessions,
  readCxTranscript,
  readCxUsage
} from '../codex/codexSessions.js'

/** Флаг из query-строки: `?includeCompleted=1` (или `=true`). */
function queryFlag(v: string | undefined): boolean {
  return v === '1' || v === 'true'
}

export async function registerRest(
  app: FastifyInstance,
  db: VoiceChatDb,
  dataDir: string,
  opts: { runnerFs?: RunnerFsClient; authStatus?: AuthStatusState; isAgentOnline?: (agentId: string) => boolean } = {}
): Promise<void> {
  const profile = (req: Parameters<typeof uid>[0]) => ensureCliProfile(dataDir, uid(req))
  const ccDir = (req: Parameters<typeof uid>[0]) => process.env.VC_CC_DIR ?? profile(req).ccProjects
  const cxDir = (req: Parameters<typeof uid>[0]) => process.env.VC_CODEX_DIR ?? profile(req).codexSessions
  const runnerFs = opts.runnerFs
  const proxyError = (reply: FastifyReply, err: unknown) =>
    reply.code(502).send({ error: 'runner_unavailable', message: err instanceof Error ? err.message : String(err) })
  // Файл с диска сервера (картинки, созданные самим CLI). Своя область — профиль
  // CLI пользователя, его загрузки и заданный им рабочий каталог; всё остальное
  // неотличимо от «нет такого файла». Проверка пути — `serverFiles.ts`.
  app.get<{ Querystring: { path?: string } }>(REST.serverFile, async (req, reply) => {
    const userId = uid(req)
    if (runnerFs) {
      try {
        const remote = await runnerFs.readFile(userId, req.query.path ?? '')
        if (remote) return remote
      } catch (err) {
        return proxyError(reply, err) as never
      }
    }
    const workdir = db.getSettings(userId).workdir
    const roots = [profile(req).home, join(dataDir, 'uploads'), ...(workdir ? [workdir] : [])]
    const res = readUserFile(req.query.path ?? '', roots)
    if (!res.ok) {
      const code = res.reason === 'too-large' ? 413 : 404
      return reply.code(code).send({ error: res.reason }) as never
    }
    return res.file
  })

  // includeCompleted=1 — вместе с чатами задач, лежащих в колонке «Готово»
  // (по умолчанию их в списке нет, см. `listConversations`).
  app.get<{ Querystring: { includeCompleted?: string } }>(REST.conversations, async (req) =>
    db.listConversations(uid(req), { includeCompleted: queryFlag(req.query.includeCompleted) })
  )
   app.post<{ Body: DesktopMigrationBundle }>(REST.desktopMigration, async (req, reply) => {
    if (!req.body || !Array.isArray(req.body.conversations)) return reply.code(400).send({ error: 'invalid migration bundle' })
    return db.importDesktopData(uid(req), req.body)
  })

  app.post<{ Body: { title?: string; assistantKind?: 'web-recorder' | 'playwright-reader' } }>(REST.conversations, async (req) => {
    const kind = req.body?.assistantKind
    return db.createConversation(uid(req), req.body?.title, kind === 'web-recorder' || kind === 'playwright-reader' ? kind : null)
  })

  app.get<{ Params: { projectId: string }; Querystring: { conversationId?: string } }>('/api/projects/:projectId/kanban-assistant', async (req, reply) => {
    const userId = uid(req)
    const privateConversation = db.ensureKanbanAssistantConversation(userId, req.params.projectId)
    const requested = req.query.conversationId ? db.getConversation(userId, req.query.conversationId) : null
    const conversation = requested?.projectId === req.params.projectId && (requested.assistantKind === null || requested.assistantKind === 'kanban')
      ? requested
      : privateConversation
    if (!conversation) return reply.code(404).send({ error: 'not found' })
    const project = db.getCiLlmConfig('project', req.params.projectId) ?? db.ciLlmDefaultsForUser(userId)
    const settings = db.getSettings(userId)
    const provider = conversation.llmProvider ?? project.provider
    const model = conversation.llmProvider
      ? (conversation.llmModel ?? (provider === 'codex' ? settings.codexModel : settings.model))
      : project.model
    return {
      conversation,
      messages: db.listMessages(userId, conversation.id),
      effectiveLlm: {
        llmEngineId: conversation.llmEngineId ?? project.llmEngineId ?? settings.llmEngineId,
        provider,
        model,
        inherited: conversation.llmProvider === null && conversation.llmEngineId === null
      }
    }
  })

  app.post<{
    Body: { idempotencyKey?: string; title?: string; projectId?: string | null; message?: Omit<AddMessageArgs, 'conversationId'> }
  }>(REST.conversationDraft, async (req, reply) => {
    const { idempotencyKey, title, projectId, message } = req.body ?? {}
    if (!idempotencyKey?.trim() || !title?.trim() || !message) {
      return reply.code(400).send({ error: 'idempotencyKey, title and message are required' })
    }
    try {
      return db.createConversationDraft(uid(req), idempotencyKey, title, projectId ?? null, message)
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  app.get<{ Querystring: { q?: string; includeCompleted?: string } }>(REST.conversationsSearch, async (req) =>
    db.searchConversations(uid(req), req.query.q ?? '', { includeCompleted: queryFlag(req.query.includeCompleted) })
  )

  /**
   * Полнотекстовый поиск по сообщениям (FTS5). `projectId` со значением `none`
   * (или пустым) — только беседы без проекта, параметра нет — по всем.
   * Владельца подставляет `uid(req)`: чужие сообщения не выдаются никогда.
   */
  app.get<{
    Querystring: { q?: string; projectId?: string; conversationId?: string; limit?: string; cursor?: string }
  }>(REST.messagesSearch, async (req) => {
    const { q, projectId, conversationId, limit, cursor } = req.query
    return db.searchMessages(uid(req), {
      q: q ?? '',
      projectId: projectId === undefined ? undefined : projectId === '' || projectId === 'none' ? null : projectId,
      ...(conversationId ? { conversationId } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
      cursor: cursor ?? null
    })
  })

  app.get<{ Params: { id: string } }>('/api/conversations/:id', async (req, reply) => {
    const conversation = db.getConversation(uid(req), req.params.id)
    if (!conversation) return reply.code(404).send({ error: 'not found' })
    return { conversation, messages: db.listMessages(uid(req), req.params.id) }
  })

  app.patch<{
    Params: { id: string }
    Body: {
      title?: string
      execTarget?: string | null
      workdir?: string | null
      skillNames?: string[]
      llmEngineId?: string | null
      llmProvider?: string | null
      llmModel?: string | null
      permissionMode?: string | null
      kbContextMode?: string
    }
  }>(
    '/api/conversations/:id',
    async (req, reply) => {
      const userId = uid(req)
      const current = db.getConversation(userId, req.params.id)
      if (!current) return reply.code(404).send({ error: 'not found' })
      if (
        req.body.execTarget !== undefined &&
        req.body.execTarget !== null &&
        req.body.execTarget !== 'none' &&
        !db.canUseAgent(userId, req.body.execTarget, current.projectId)
      ) {
        return reply.code(403).send({ error: 'machine is not available for this conversation' })
      }
      if (typeof req.body.title === 'string') db.renameConversation(userId, req.params.id, req.body.title)
      if (req.body.kbContextMode === 'auto' || req.body.kbContextMode === 'manual' || req.body.kbContextMode === 'off') db.setConversationKbContextMode(uid(req), req.params.id, req.body.kbContextMode)
      if (req.body.execTarget !== undefined) {
        const role = db.getUser(uid(req))?.role ?? 'developer'
        if (req.body.llmEngineId && !db.listLlmEnginesForRole(role).some((engine) => engine.id === req.body.llmEngineId)) {
          return reply.code(403).send({ error: 'llm engine is not available for role' })
        }
        // Неизвестное значение движка приравниваем к «из общих настроек».
        const llmProvider =
          req.body.llmProvider === undefined
            ? undefined
            : req.body.llmProvider === 'claude' || req.body.llmProvider === 'codex'
              ? req.body.llmProvider
              : null
        // Неизвестный режим прав приравниваем к «из общих настроек».
        const permissionMode =
          req.body.permissionMode === undefined
            ? undefined
            : req.body.permissionMode === 'plan' || req.body.permissionMode === 'acceptEdits' || req.body.permissionMode === 'bypassPermissions'
              ? req.body.permissionMode
              : null
        db.setConversationExecTarget(
          uid(req),
          req.params.id,
          req.body.execTarget,
          req.body.workdir,
          req.body.skillNames,
          llmProvider,
          req.body.llmModel,
          permissionMode,
          req.body.llmEngineId
        )
      }
      const conversation = db.getConversation(uid(req), req.params.id)
      if (!conversation) return reply.code(404).send({ error: 'not found' })
      return conversation
    }
  )

  // Метки чатов задач для списка бесед: ключ, тип и последний ран. Статический
  // путь объявлен до `/api/conversations/:id`, но Fastify и так предпочитает его
  // параметрическому — «task-chats» не будет прочитан как id беседы.
  app.get(REST.conversationTaskChats, async (req) => db.taskChatBadges(uid(req)))

  // Контекст задачи для шапки связанного чата (проект/эпик/стори/этап/машина/ран).
  app.get<{ Params: { id: string } }>('/api/conversations/:id/task-context', async (req, reply) => {
    if (!db.getConversation(uid(req), req.params.id)) return reply.code(404).send({ error: 'not found' })
    return db.getTaskChatContext(uid(req), req.params.id, opts.isAgentOnline)
  })

  app.post<{ Params: { id: string }; Body: { projectId?: string | null } }>(
    '/api/conversations/:id/project',
    async (req, reply) => {
      const conversation = db.setConversationProject(uid(req), req.params.id, req.body?.projectId ?? null)
      if (!conversation) return reply.code(404).send({ error: 'not found' })
      return conversation
    }
  )

  app.post<{ Params: { id: string }; Body: { previewUrl?: string | null } }>(
    '/api/conversations/:id/preview-url',
    async (req, reply) => {
      const raw = req.body?.previewUrl
      let previewUrl: string | null = null
      if (raw) {
        try {
          const url = new URL(raw.trim())
          if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol')
          previewUrl = url.toString()
        } catch {
          return reply.code(400).send({ error: 'previewUrl must be an http/https URL' })
        }
      }
      const conversation = db.setConversationPreviewUrl(uid(req), req.params.id, previewUrl)
      if (!conversation) return reply.code(404).send({ error: 'not found' })
      return conversation
    }
  )

  app.post<{ Params: { id: string }; Body: { status?: string } }>(
    '/api/conversations/:id/status',
    async (req, reply) => {
      const status = req.body?.status
      if (!CONVERSATION_STATUSES.some((s) => s.id === status)) {
        return reply.code(400).send({ error: 'invalid status' })
      }
      const conversation = db.setConversationStatus(uid(req), req.params.id, status as ConversationStatus)
      if (!conversation) return reply.code(404).send({ error: 'not found' })
      return conversation
    }
  )

  app.delete<{ Params: { id: string } }>('/api/conversations/:id', async (req, reply) => {
    try {
      db.deleteConversation(uid(req), req.params.id)
      return { ok: true }
    } catch (err) {
      return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  app.post<{ Params: { id: string }; Body: AddMessageArgs }>(
    '/api/conversations/:id/messages',
    async (req) => {
      const { role, text, time, engine, meta, execTarget, attachments } = req.body
      return db.addMessage(uid(req), req.params.id, role, text, time, engine, meta, execTarget, attachments)
    }
  )

  app.patch<{ Params: { id: string; messageId: string }; Body: { meta?: import('@voicechat/shared').TurnMeta } }>(
    '/api/conversations/:id/messages/:messageId',
    async (req, reply) => {
      if (!req.body?.meta) return reply.code(400).send({ error: 'meta required' })
      try {
        return db.updateMessageMeta(uid(req), req.params.id, req.params.messageId, req.body.meta)
      } catch {
        return reply.code(404).send({ error: 'not found' })
      }
    }
  )

  app.delete<{ Params: { id: string; messageId: string } }>(
    '/api/conversations/:id/messages/:messageId',
    async (req) => {
      db.deleteMessage(uid(req), req.params.id, req.params.messageId)
      // История изменилась — сбрасываем сессию Claude, чтобы следующий запрос
      // пересобрал контекст из БД (модель «забудет» удалённое).
      db.setClaudeSession(uid(req), req.params.id, null)
      return { ok: true }
    }
  )

  app.get(REST.mcpServers, async () => listMcpServers())

  app.get(REST.authStatus, async (req, reply) => {
    if (opts.authStatus) {
      try { return await opts.authStatus.get(uid(req)) }
      catch (err) { return proxyError(reply, err) }
    }
    if (!runnerFs) return getLoginStatus({ home: profile(req).home })
    try { return await runnerFs.authStatus(uid(req)) }
    catch (err) { return proxyError(reply, err) }
  })

  app.get(REST.ccProjects, async (req, reply) => {
    if (!runnerFs) return listProjects(ccDir(req))
    try {
      return await runnerFs.listCcProjects(uid(req))
    } catch (err) {
      return proxyError(reply, err)
    }
  })
  app.get<{ Params: { slug: string } }>(
    '/api/cc/projects/:slug/sessions',
    async (req, reply) => {
      if (!runnerFs) return listSessions(req.params.slug, ccDir(req))
      try {
        return await runnerFs.listCcSessions(uid(req), req.params.slug)
      } catch (err) {
        return proxyError(reply, err)
      }
    }
  )
  app.get<{ Params: { slug: string; id: string }; Querystring: { limit?: string } }>(
    '/api/cc/projects/:slug/sessions/:id',
    async (req, reply) => {
      if (!runnerFs) {
        const dir = ccDir(req)
        const items = readTranscript(req.params.slug, req.params.id, {
          limit: req.query.limit ? Number(req.query.limit) : undefined
        }, dir)
        return { items, usage: readUsage(req.params.slug, req.params.id, dir) }
      }
      try {
        return await runnerFs.readCcTranscript(uid(req), req.params.slug, req.params.id, req.query.limit ? Number(req.query.limit) : undefined)
      } catch (err) {
        return proxyError(reply, err)
      }
    }
  )

  app.post<{ Body: { slug: string; id: string } }>(REST.ccResume, async (req, reply) => {
    const u = uid(req)
    const { slug, id } = req.body ?? {}
    if (!slug || !id) return reply.code(400).send({ error: 'slug и id обязательны' })
    let items
    try {
      items = runnerFs
        ? (await runnerFs.readCcTranscript(u, slug, id)).items
        : readTranscript(slug, id, {}, ccDir(req))
    } catch (err) {
      return proxyError(reply, err)
    }
    const conv = db.createConversation(u, ccResumeTitle(items))
    const now = Date.now()
    for (const m of ccResumeMessages(items)) {
      db.addMessage(u, conv.id, m.role, m.text, ccTimeLabel(m.ts, now))
    }
    // Привязка к session-id CC → следующий ход пойдёт через `claude --resume <id>`.
    db.setClaudeSession(u, conv.id, id)
    return { conversation: db.getConversation(u, conv.id), messages: db.listMessages(u, conv.id) }
  })

  // --- Проводник Codex ---------------------------------------------------
  app.get(REST.cxProjects, async (req, reply) => {
    if (!runnerFs) return listCxProjects(cxDir(req))
    try {
      return await runnerFs.listCxProjects(uid(req))
    } catch (err) {
      return proxyError(reply, err)
    }
  })
  app.get<{ Querystring: { cwd?: string } }>(REST.cxSessions, async (req, reply) => {
    if (!runnerFs) return listCxSessions(req.query.cwd ?? '', cxDir(req))
    try {
      return await runnerFs.listCxSessions(uid(req), req.query.cwd ?? '')
    } catch (err) {
      return proxyError(reply, err)
    }
  })
  app.get<{ Querystring: { id?: string; limit?: string } }>(REST.cxTranscript, async (req, reply) => {
    if (!runnerFs) {
      const dir = cxDir(req)
      const id = req.query.id ?? ''
      const items = readCxTranscript(id, {
        limit: req.query.limit ? Number(req.query.limit) : undefined
      }, dir)
      return { items, usage: readCxUsage(id, dir) }
    }
    try {
      return await runnerFs.readCxTranscript(uid(req), req.query.id ?? '', req.query.limit ? Number(req.query.limit) : undefined)
    } catch (err) {
      return proxyError(reply, err)
    }
  })

  app.post<{ Body: { id: string } }>(REST.cxResume, async (req, reply) => {
    const u = uid(req)
    const { id } = req.body ?? {}
    if (!id) return reply.code(400).send({ error: 'id обязателен' })
    let items
    try {
      items = runnerFs
        ? (await runnerFs.readCxTranscript(u, id)).items
        : readCxTranscript(id, {}, cxDir(req))
    } catch (err) {
      return proxyError(reply, err)
    }
    const conv = db.createConversation(u, cxResumeTitle(items))
    const now = Date.now()
    for (const m of cxResumeMessages(items)) {
      db.addMessage(u, conv.id, m.role, m.text, cxTimeLabel(m.ts, now), m.role === 'ai' ? 'codex' : undefined)
    }
    // Привязка к session-id Codex (префикс провайдера) → следующий ход пойдёт
    // через `codex exec resume <id>` (см. resumeIdFor в session.ts).
    db.setClaudeSession(u, conv.id, `codex:${id}`)
    return { conversation: db.getConversation(u, conv.id), messages: db.listMessages(u, conv.id) }
  })

  app.get(REST.llmEngines, async (req) => db.listLlmEnginesForRole(db.getUser(uid(req))?.role ?? 'developer'))

  app.get(REST.settings, async (req) => db.getSettings(uid(req)))
  const myLlmAccess = async (req: Parameters<typeof uid>[0]) => db.getUserLlmAccess(uid(req))
  app.get(REST.llmAccess, myLlmAccess)
  app.get(REST.meLlmAccess, myLlmAccess)

  // Личный отчёт строится всегда от uid сессии: query не содержит userId и не
  // может открыть расход другого пользователя.
  const usageForMe = (userId: string, query: { unit?: string; from?: string; to?: string; conversationId?: string }, reply: FastifyReply) => {
    const unit = query.unit ?? 'day'
    if (unit !== 'hour' && unit !== 'day' && unit !== 'week') return reply.code(400).send({ error: 'unit must be hour, day or week' })
    const number = (value: string | undefined): number | undefined => {
      if (value === undefined || value === '') return undefined
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : undefined
    }
    const from = number(query.from)
    const to = number(query.to)
    if ((query.from && from === undefined) || (query.to && to === undefined)) return reply.code(400).send({ error: 'from and to must be timestamps' })
    return db.usageReport(userId, unit as UsageUnit, from, to, query.conversationId || undefined)
  }
  app.get<{ Querystring: { unit?: string; from?: string; to?: string; conversationId?: string } }>(REST.usage, async (req, reply) => usageForMe(uid(req), req.query, reply))
  app.get<{ Querystring: { unit?: string; from?: string; to?: string; conversationId?: string } }>(REST.meUsage, async (req, reply) => usageForMe(uid(req), req.query, reply))

  app.put<{ Body: Settings }>(REST.settings, async (req, reply) => {
    const role = db.getUser(uid(req))?.role ?? 'developer'
    if (req.body.llmEngineId && !db.listLlmEnginesForRole(role).some((engine) => engine.id === req.body.llmEngineId)) {
      return reply.code(403).send({ error: 'llm engine is not available for role' })
    }
    const generatedFilesTtlDays = req.body.generatedFilesTtlDays ?? db.getSettings(uid(req)).generatedFilesTtlDays
    if (!Number.isInteger(generatedFilesTtlDays) || generatedFilesTtlDays < 1 || generatedFilesTtlDays > 3650) {
      return reply.code(400).send({ error: 'generatedFilesTtlDays must be an integer from 1 to 3650' })
    }
    const raw = req.body.personalization ?? db.getSettings(uid(req)).personalization
    const preferredName = raw.preferredName?.trim().replace(/\s+/g, ' ') || null
    const currentYear = new Date().getUTCFullYear()
    const validParts =
      (raw.birthDay === null || (Number.isInteger(raw.birthDay) && raw.birthDay >= 1 && raw.birthDay <= 31)) &&
      (raw.birthMonth === null || (Number.isInteger(raw.birthMonth) && raw.birthMonth >= 1 && raw.birthMonth <= 12)) &&
      (raw.birthYear === null || (Number.isInteger(raw.birthYear) && raw.birthYear >= 1900 && raw.birthYear <= currentYear))
    const validDate = raw.birthDay === null || raw.birthMonth === null || raw.birthDay <= new Date(Date.UTC(raw.birthYear ?? 2000, raw.birthMonth, 0)).getUTCDate()
    const validEnums = (raw.responseLanguage === null || /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(raw.responseLanguage)) &&
      ['brief', 'normal', 'detailed', 'step-by-step'].includes(raw.responseStyle) &&
      ['neutral', 'friendly', 'business', 'plain'].includes(raw.tone)
    if (preferredName && preferredName.length > 80) return reply.code(400).send({ error: 'preferredName is too long' })
    if (!validParts || !validDate || !validEnums) return reply.code(400).send({ error: 'invalid personalization' })
    db.saveSettings(uid(req), { ...req.body, generatedFilesTtlDays, personalization: { ...raw, preferredName } })
    return db.getSettings(uid(req))
  })
}
