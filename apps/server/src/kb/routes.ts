import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { REST, isKbScope, type KbDocument, type KbDocumentKind, type KbScope, type KbUsageReport } from '@voicechat/shared'
import type { KnowledgeBaseService } from './types.js'
import type { VoiceChatDb } from '../db/database.js'
import { uid } from '../users/auth.js'
import { kbViewOfRequest, kbWriteDenial } from './access.js'
import type { KbResearchManager } from './research.js'

/** Телеметрия БЗ по чату; проектный агрегат живёт рядом с /board (routes/projects.ts). */
export interface KbUsageRoutesDeps {
  db: VoiceChatDb
  /** Инструменты mcp__kb__* включены администратором (config.kbToolEnabled). */
  toolEnabled: boolean
}

/**
 * Флаги конфигурации для отчёта: БД про них не знает, а панель обязана отличать
 * «обращений не было» от «БЗ выключена/недоступна».
 */
export function kbUsageFlags(kb: KnowledgeBaseService, toolEnabled: boolean): { available: boolean; toolEnabled: boolean } {
  const available = (() => {
    try {
      return kb.status().available
    } catch {
      return false
    }
  })()
  return { available, toolEnabled: toolEnabled && available }
}

/** Гейт проекта: чужой (или несуществующий) проект — 403, а не пустая выдача. */
function projectDenied(db: VoiceChatDb, req: FastifyRequest, projectId: string | undefined): boolean {
  return !!projectId && !db.getProject(uid(req), projectId)
}

export function registerKbRoutes(app: FastifyInstance, kb: KnowledgeBaseService, usage?: KbUsageRoutesDeps): void {
  const db = usage?.db
  const forbidden = (reply: FastifyReply): FastifyReply => reply.code(403).send({ error: 'нет доступа к знаниям этого проекта' })
  app.get(REST.kbStatus, async () => kb.status())

  app.get<{ Querystring: { scope?: string; projectId?: string } }>(REST.kbTopics, async (req, reply) => {
    if (!db) return kb.topics()
    if (projectDenied(db, req, req.query.projectId)) return forbidden(reply)
    return kb.topics(kbViewOfRequest(db, req, req.query))
  })

  app.get<{ Querystring: { q?: string; kind?: string; tags?: string; limit?: string; scope?: string; projectId?: string } }>(REST.kbSearch, async (req, reply) => {
    const request = {
      query: req.query.q ?? '',
      kinds: req.query.kind ? (req.query.kind.split(',') as KbDocumentKind[]) : undefined,
      tags: req.query.tags ? req.query.tags.split(',') : undefined,
      limit: Number(req.query.limit) || undefined,
      ...(isKbScope(req.query.scope) ? { scope: req.query.scope } : {}),
      ...(req.query.projectId ? { projectId: req.query.projectId } : {})
    }
    if (!db) return kb.search(request)
    if (projectDenied(db, req, req.query.projectId)) return forbidden(reply)
    return kb.search(request, kbViewOfRequest(db, req, req.query))
  })

  app.get<{ Querystring: { q?: string; budget?: string; projectId?: string } }>(REST.kbContext, async (req, reply) => {
    const budget = Number(req.query.budget) || undefined
    if (!db) return kb.context(req.query.q ?? '', budget)
    if (projectDenied(db, req, req.query.projectId)) return forbidden(reply)
    return kb.context(req.query.q ?? '', budget, kbViewOfRequest(db, req, req.query))
  })

  // Документ: чужая проектная/персональная статья неотличима от отсутствующей.
  app.get<{ Params: { id: string } }>('/api/kb/documents/:id', async (req, reply) => {
    const found = db ? kb.document(req.params.id, kbViewOfRequest(db, req)) : kb.document(req.params.id)
    return found ?? reply.code(404).send({ error: 'KB document not found' })
  })

  if (!db) return

  // --- Запись статей (персональные и проектные) --------------------------

  app.post<{ Body: { id?: string; scope?: string; projectId?: string | null; title?: string; body?: string; kind?: KbDocumentKind; tags?: string[]; areas?: string[] } }>(
    REST.kbDocuments,
    async (req, reply): Promise<KbDocument | FastifyReply> => {
      const b = req.body ?? {}
      const scope: KbScope = isKbScope(b.scope) ? b.scope : 'user'
      const title = (b.title ?? '').trim()
      if (!title) return reply.code(400).send({ error: 'title required' })
      const user = req.user as { name: string; role: string }
      const denial = kbWriteDenial(db, user, { scope, projectId: b.projectId ?? null })
      if (denial) return reply.code(403).send({ error: denial })
      // Правка существующей статьи проверяется по её собственной принадлежности:
      // подменить scope/projectId в теле и переписать чужую статью нельзя.
      if (b.id) {
        const existing = db.kbDocumentById(b.id)
        if (!existing) return reply.code(404).send({ error: 'KB document not found' })
        const own = kbWriteDenial(db, user, { scope: existing.scope, projectId: existing.projectId })
        if (own || (existing.scope === 'user' && existing.ownerId !== user.name)) return reply.code(403).send({ error: own ?? 'чужая статья' })
      }
      const saved = db.saveKbDocument({
        id: b.id ?? null,
        scope,
        ownerId: scope === 'user' ? user.name : null,
        projectId: scope === 'project' ? b.projectId ?? null : null,
        title,
        body: b.body ?? '',
        kind: b.kind,
        tags: b.tags,
        areas: b.areas,
        createdBy: user.name
      })
      return kb.document(saved.id, kbViewOfRequest(db, req)) as KbDocument
    }
  )

  app.delete<{ Params: { id: string } }>('/api/kb/documents/:id', async (req, reply) => {
    const user = req.user as { name: string; role: string }
    const existing = db.kbDocumentById(req.params.id)
    if (!existing) return reply.code(404).send({ error: 'KB document not found' })
    const denial = kbWriteDenial(db, user, { scope: existing.scope, projectId: existing.projectId })
    if (denial || (existing.scope === 'user' && existing.ownerId !== user.name)) return reply.code(403).send({ error: denial ?? 'чужая статья' })
    db.deleteKbDocument(req.params.id)
    return { ok: true }
  })

  if (!usage) return
  // Снапшот телеметрии чата: чужой чат → 404 (изоляция начинается с getConversation).
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/api/conversations/:id/kb-usage', async (req, reply) => {
    const report = usage.db.kbUsageReport(uid(req), req.params.id, Number(req.query.limit) || undefined)
    if (!report) return reply.code(404).send({ error: 'conversation not found' })
    return { ...report, ...kbUsageFlags(kb, usage.toolEnabled) } satisfies KbUsageReport
  })
}

/**
 * «Исследовать проект»: запуск сверки статей с кодом и состояние прогона.
 * Гейт — членство в проекте (тот же db.getProject, что и у остальных знаний).
 */
export function registerKbResearchRoutes(app: FastifyInstance, db: VoiceChatDb, research: KbResearchManager): void {
  app.post<{ Params: { id: string } }>('/api/projects/:id/kb/research', async (req, reply) => {
    const project = db.getProject(uid(req), req.params.id)
    if (!project) return reply.code(403).send({ error: 'нет доступа к знаниям этого проекта' })
    try {
      return research.start(uid(req), project)
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  app.get<{ Params: { id: string } }>('/api/projects/:id/kb/research', async (req, reply) => {
    const project = db.getProject(uid(req), req.params.id)
    if (!project) return reply.code(403).send({ error: 'нет доступа к знаниям этого проекта' })
    return research.get(req.params.id)
  })
}
