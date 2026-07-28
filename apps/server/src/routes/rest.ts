// REST-роуты поверх VoiceChatDb (Ф3): разговоры, сообщения, настройки.

import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
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
  type Settings
} from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import { uid } from '../users/auth.js'
import { ensureCliProfile } from '../users/cliProfiles.js'
import { readUserFile } from '../serverFiles.js'
import { listMcpServers } from '../claude/mcp.js'
import { getLoginStatus } from '../auth/loginStatus.js'
import { listProjects, listSessions, readTranscript } from '../cc/ccSessions.js'
import {
  listCxProjects,
  listCxSessions,
  readCxTranscript
} from '../codex/codexSessions.js'

export async function registerRest(app: FastifyInstance, db: VoiceChatDb, dataDir: string): Promise<void> {
  const profile = (req: Parameters<typeof uid>[0]) => ensureCliProfile(dataDir, uid(req))
  const ccDir = (req: Parameters<typeof uid>[0]) => process.env.VC_CC_DIR ?? profile(req).ccProjects
  const cxDir = (req: Parameters<typeof uid>[0]) => process.env.VC_CODEX_DIR ?? profile(req).codexSessions
  // Файл с диска сервера (картинки, созданные самим CLI). Своя область — профиль
  // CLI пользователя, его загрузки и заданный им рабочий каталог; всё остальное
  // неотличимо от «нет такого файла». Проверка пути — `serverFiles.ts`.
  app.get<{ Querystring: { path?: string } }>(REST.serverFile, async (req, reply) => {
    const userId = uid(req)
    const workdir = db.getSettings(userId).workdir
    const roots = [profile(req).home, join(dataDir, 'uploads'), ...(workdir ? [workdir] : [])]
    const res = readUserFile(req.query.path ?? '', roots)
    if (!res.ok) {
      const code = res.reason === 'too-large' ? 413 : 404
      return reply.code(code).send({ error: res.reason }) as never
    }
    return res.file
  })

  app.get(REST.conversations, async (req) => db.listConversations(uid(req)))
   app.post<{ Body: DesktopMigrationBundle }>(REST.desktopMigration, async (req, reply) => {
    if (!req.body || !Array.isArray(req.body.conversations)) return reply.code(400).send({ error: 'invalid migration bundle' })
    return db.importDesktopData(uid(req), req.body)
  })

  app.post<{ Body: { title?: string } }>(REST.conversations, async (req) =>
    db.createConversation(uid(req), req.body?.title)
  )

  app.get<{ Querystring: { q?: string } }>(REST.conversationsSearch, async (req) =>
    db.searchConversations(uid(req), req.query.q ?? '')
  )

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
      llmProvider?: string | null
      llmModel?: string | null
      permissionMode?: string | null
      kbContextMode?: string
    }
  }>(
    '/api/conversations/:id',
    async (req, reply) => {
      if (typeof req.body.title === 'string') db.renameConversation(uid(req), req.params.id, req.body.title)
      if (req.body.kbContextMode === 'auto' || req.body.kbContextMode === 'manual' || req.body.kbContextMode === 'off') db.setConversationKbContextMode(uid(req), req.params.id, req.body.kbContextMode)
      if (req.body.execTarget !== undefined) {
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
          permissionMode
        )
      }
      const conversation = db.getConversation(uid(req), req.params.id)
      if (!conversation) return reply.code(404).send({ error: 'not found' })
      return conversation
    }
  )

  app.post<{ Params: { id: string }; Body: { projectId?: string | null } }>(
    '/api/conversations/:id/project',
    async (req, reply) => {
      const conversation = db.setConversationProject(uid(req), req.params.id, req.body?.projectId ?? null)
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
      const { role, text, time, engine, meta, execTarget } = req.body
      return db.addMessage(uid(req), req.params.id, role, text, time, engine, meta, execTarget)
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

  app.get(REST.authStatus, async (req) => getLoginStatus({ home: profile(req).home }))

  app.get(REST.ccProjects, async (req) => listProjects(ccDir(req)))
  app.get<{ Params: { slug: string } }>(
    '/api/cc/projects/:slug/sessions',
    async (req) => listSessions(req.params.slug, ccDir(req))
  )
  app.get<{ Params: { slug: string; id: string }; Querystring: { limit?: string } }>(
    '/api/cc/projects/:slug/sessions/:id',
    async (req) =>
      readTranscript(req.params.slug, req.params.id, {
        limit: req.query.limit ? Number(req.query.limit) : undefined
      }, ccDir(req))
  )

  app.post<{ Body: { slug: string; id: string } }>(REST.ccResume, async (req, reply) => {
    const u = uid(req)
    const { slug, id } = req.body ?? {}
    if (!slug || !id) return reply.code(400).send({ error: 'slug и id обязательны' })
    const items = readTranscript(slug, id, {}, ccDir(req))
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
  app.get(REST.cxProjects, async (req) => listCxProjects(cxDir(req)))
  app.get<{ Querystring: { cwd?: string } }>(REST.cxSessions, async (req) =>
    listCxSessions(req.query.cwd ?? '', cxDir(req))
  )
  app.get<{ Querystring: { id?: string; limit?: string } }>(REST.cxTranscript, async (req) =>
    readCxTranscript(req.query.id ?? '', {
      limit: req.query.limit ? Number(req.query.limit) : undefined
    }, cxDir(req))
  )

  app.post<{ Body: { id: string } }>(REST.cxResume, async (req, reply) => {
    const u = uid(req)
    const { id } = req.body ?? {}
    if (!id) return reply.code(400).send({ error: 'id обязателен' })
    const items = readCxTranscript(id, {}, cxDir(req))
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

  app.get(REST.settings, async (req) => db.getSettings(uid(req)))

  app.put<{ Body: Settings }>(REST.settings, async (req) => {
    db.saveSettings(uid(req), req.body)
    return db.getSettings(uid(req))
  })
}
