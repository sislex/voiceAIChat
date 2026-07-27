import type { FastifyInstance } from 'fastify'
import { REST, type KbDocumentKind } from '@voicechat/shared'
import type { KnowledgeBaseService } from './types.js'
export function registerKbRoutes(app: FastifyInstance, kb: KnowledgeBaseService): void {
  app.get(REST.kbStatus, async () => kb.status())
  app.get(REST.kbTopics, async () => kb.topics())
  app.get<{ Querystring: { q?: string; kind?: string; tags?: string; limit?: string } }>(REST.kbSearch, async (req) => kb.search({ query:req.query.q??'', kinds:req.query.kind?req.query.kind.split(',') as KbDocumentKind[]:undefined, tags:req.query.tags?req.query.tags.split(','):undefined, limit:Number(req.query.limit)||undefined }))
  app.get<{ Querystring: { q?: string; budget?: string } }>(REST.kbContext, async (req) => kb.context(req.query.q??'',Number(req.query.budget)||undefined))
  app.get<{ Params: { id: string } }>('/api/kb/documents/:id', async (req,reply) => kb.document(req.params.id) ?? reply.code(404).send({error:'KB document not found'}))
}
