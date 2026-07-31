import type { FastifyInstance } from 'fastify'
import { REST, type KbDocumentKind, type KbUsageReport } from '@voicechat/shared'
import type { KnowledgeBaseService } from './types.js'
import type { VoiceChatDb } from '../db/database.js'
import { uid } from '../users/auth.js'

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

export function registerKbRoutes(app: FastifyInstance, kb: KnowledgeBaseService, usage?: KbUsageRoutesDeps): void {
  app.get(REST.kbStatus, async () => kb.status())
  app.get(REST.kbTopics, async () => kb.topics())
  app.get<{ Querystring: { q?: string; kind?: string; tags?: string; limit?: string } }>(REST.kbSearch, async (req) => kb.search({ query:req.query.q??'', kinds:req.query.kind?req.query.kind.split(',') as KbDocumentKind[]:undefined, tags:req.query.tags?req.query.tags.split(','):undefined, limit:Number(req.query.limit)||undefined }))
  app.get<{ Querystring: { q?: string; budget?: string } }>(REST.kbContext, async (req) => kb.context(req.query.q??'',Number(req.query.budget)||undefined))
  app.get<{ Params: { id: string } }>('/api/kb/documents/:id', async (req,reply) => kb.document(req.params.id) ?? reply.code(404).send({error:'KB document not found'}))
  if (!usage) return
  // Снапшот телеметрии чата: чужой чат → 404 (изоляция начинается с getConversation).
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/api/conversations/:id/kb-usage', async (req, reply) => {
    const report = usage.db.kbUsageReport(uid(req), req.params.id, Number(req.query.limit) || undefined)
    if (!report) return reply.code(404).send({ error: 'conversation not found' })
    return { ...report, ...kbUsageFlags(kb, usage.toolEnabled) } satisfies KbUsageReport
  })
}
