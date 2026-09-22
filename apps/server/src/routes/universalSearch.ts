import { createHash, randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  REST, SEARCH_SOURCES, searchHref, searchText, issueKey, type ConversationScope,
  type SearchHit, type SearchSource, type SearchTarget, type UniversalSearchRequest, type UniversalSearchResult
} from '@voicechat/shared'
import type { MakeService } from '@voicechat/make-contracts'
import type { VoiceChatDb } from '../db/database.js'
import type { KnowledgeBaseService } from '../kb/types.js'
import { kbViewOfRequest } from '../kb/access.js'
import { canSee } from '../kb/scoped.js'
import { uid } from "@sislexa/identity/server/users/auth"

export interface SearchCandidate {
  key: string
  title: string
  text: string
  target: SearchTarget
  allowed: () => Promise<boolean>
}
export type SearchAdapters = Record<SearchSource, () => Promise<SearchCandidate[]>>
interface Continuation { user: string; query: string; recent: string[]; seen: string[]; expires: number }
export class SearchCursorError extends Error {}

/** Cursors store no content and are immutable, so retries return the same logical page. */
export class UniversalSearch {
  private cursors = new Map<string, Continuation>()
  constructor(private timeoutMs = 5000) {}

  async search(user: string, request: UniversalSearchRequest, adapters: SearchAdapters): Promise<UniversalSearchResult> {
    const query = request.query.trim().toLowerCase()
    const limit = request.limit ?? 30
    const now = Date.now()
    for (const [key, value] of this.cursors) if (value.expires <= now) this.cursors.delete(key)
    const previous = request.cursor ? this.cursors.get(request.cursor) : undefined
    if (request.cursor && (!previous || previous.user !== user || previous.query !== query)) throw new SearchCursorError()
    const seen = new Set(previous?.seen ?? [])
    if (previous && request.recent && JSON.stringify(request.recent) !== JSON.stringify(previous.recent)) throw new SearchCursorError()
    const recent = new Set(previous?.recent ?? request.recent ?? [])
    if (!query && !recent.size) return {
      groups: SEARCH_SOURCES.map(source => ({ source, hits: [], status: 'ok' })), nextCursor: null
    }
    const guards = new Map<string, () => Promise<boolean>>()
    const settled = await Promise.all(SEARCH_SOURCES.map(async source => {
      let timer: ReturnType<typeof setTimeout> | undefined
      let expired = false
      try {
        const hits = await Promise.race([
          (async () => {
            const result: SearchHit[] = []
            for (const item of await adapters[source]()) {
              if (expired) break
              const title = searchText(item.title)
              const text = searchText(item.text)
              const id = source + ':' + createHash('sha256').update(item.key).digest('hex')
              if (!title || seen.has(id)) continue
              if (query ? !(title + ' ' + text).toLowerCase().includes(query) : !recent.has(id)) continue
              if (!await item.allowed() || expired) continue
              guards.set(id, item.allowed)
              const at = Math.max(0, text.toLowerCase().indexOf(query) - 50)
              result.push({ id, source, title: title.slice(0, 180), snippet: text.slice(at, at + 220), target: item.target, href: searchHref(item.target) })
            }
            return result
          })(),
          new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error('unavailable')) }, this.timeoutMs) })
        ])
        return { source, status: 'ok' as const, hits }
      } catch {
        // Neither exception text nor raw counts cross the authorization boundary.
        return { source, status: 'unavailable' as const, hits: [] as SearchHit[] }
      } finally { if (timer) clearTimeout(timer) }
    }))
    const candidates = Array.from(new Map(settled.flatMap(group => group.hits).map(hit => [hit.id, hit])).values())
    // A slow sibling source must not preserve access revoked while it was loading.
    const permitted = await Promise.all(candidates.map(async hit => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          guards.get(hit.id)!(),
          new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), this.timeoutMs) })
        ])
      } catch { return false }
      finally { if (timer) clearTimeout(timer) }
    }))
    const all = candidates.filter((_, index) => permitted[index])
    const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0
    all.sort((a, b) => {
      const score = (hit: SearchHit): number => hit.title.toLowerCase() === query ? 0 : hit.title.toLowerCase().startsWith(query) ? 1 : 2
      return score(a) - score(b) || compare(a.title.toLowerCase(), b.title.toLowerCase()) || compare(a.id, b.id)
    })
    const page = all.slice(0, limit)
    let nextCursor: string | null = null
    if (all.length > page.length) {
      nextCursor = randomUUID()
      if (this.cursors.size >= 1000) this.cursors.delete(this.cursors.keys().next().value!)
      this.cursors.set(nextCursor, { user, query, recent: [...recent], seen: [...seen, ...page.map(hit => hit.id)], expires: now + 5 * 60_000 })
    }
    return {
      groups: settled.map(group => ({ source: group.source, status: group.status, hits: page.filter(hit => hit.source === group.source) })),
      nextCursor
    }
  }
}

const chatRoute = (scope: string): string => ({
  chat: 'chat', make: 'make', 'web-reader': 'web-reader', 'playwright-reader': 'playwright-reader',
  console: 'console-reader', images: 'images', kanban: 'kanban'
})[scope] ?? 'chat'
const fileAllowed = (path: string): boolean =>
  !/(^|\/)(?:\.env(?:\.|$)|\.git(?:\/|$)|.*(?:secret|credential|password)|id_rsa|id_ed25519)|\.(?:pem|key|p12|pfx)$/i.test(path)
  && !path.split('/').includes('..') && !path.startsWith('/') && searchText(path) === path

export function searchAdapters(db: VoiceChatDb, kb: KnowledgeBaseService, make: Pick<MakeService, 'listFiles'>, req: FastifyRequest): SearchAdapters {
  const user = uid(req)
  const projectAllowed = async (id: string | null | undefined): Promise<boolean> => !id || !!await db.projects.getProject(user, id)
  const chatAllowed = async (id: string): Promise<boolean> => {
    const chat = await db.chat.getConversation(user, id)
    return !!chat && await projectAllowed(chat.projectId)
  }
  const chats = async () => {
    const scopes: ConversationScope[] = ['chat', 'make', 'web-reader', 'playwright-reader', 'console', 'images']
    const own = (await Promise.all(scopes.map(scope => db.chat.listConversations(user, { scope, includeCompleted: true })))).flat()
    for (const project of await db.projects.listProjects(user)) {
      own.push(...await db.chat.listConversations(user, { scope: 'kanban', projectId: project.id, includeCompleted: true }))
    }
    return own
  }
  return {
    chats: async () => (await chats()).map(chat => ({
      key: chat.id, title: chat.title, text: '',
      target: { source: 'chats', conversationId: chat.id, route: chatRoute(chat.scope), ...(chat.projectId ? { projectId: chat.projectId } : {}) },
      allowed: () => chatAllowed(chat.id)
    })),
    messages: async () => (await db.chat.universalSearchRows(user)).map(message => ({
      key: message.id, title: message.title, text: message.text,
      target: { source: 'messages', conversationId: message.conversationId, messageId: message.id, route: chatRoute(message.scope), ...(message.projectId ? { projectId: message.projectId } : {}) },
      allowed: () => chatAllowed(message.conversationId)
    })),
    projects: async () => (await db.projects.listProjects(user)).map(project => ({
      key: project.id, title: project.name, text: '',
      target: { source: 'projects', projectId: project.id },
      allowed: () => projectAllowed(project.id)
    })),
    tasks: async () => {
      const result: SearchCandidate[] = []
      for (const project of await db.projects.listProjects(user)) {
        const board = await db.tasks.getBoardSkeleton(user, project.id, { includeCompleted: true })
        for (const task of board?.tasks ?? []) result.push({
          key: task.id, title: issueKey(project.name, task) + ' · ' + task.title, text: '#' + task.seq,
          target: { source: 'tasks', projectId: project.id, taskId: task.id },
          allowed: () => projectAllowed(project.id)
        })
      }
      return result
    },
    files: async () => {
      const result: SearchCandidate[] = []
      for (const chat of await db.chat.listConversations(user, { scope: 'make', includeCompleted: true })) {
        if (!await chatAllowed(chat.id)) continue
        for (const file of await make.listFiles(chat.id)) {
          if (!fileAllowed(file.path)) continue
          result.push({
            key: JSON.stringify([chat.id, file.path]), title: file.path, text: '',
            target: { source: 'files', conversationId: chat.id, path: file.path },
            allowed: () => chatAllowed(chat.id)
          })
        }
      }
      return result
    },
    kb: async () => {
      const result: SearchCandidate[] = []
      const view = await kbViewOfRequest(db, req)
      // Read stored documents directly: timestamp-based index versions can collide
      // when two confirmed writes happen in the same millisecond.
      for (const row of await db.kb.kbDocuments()) {
        if (!canSee(row, view)) continue
        result.push({
          key: row.id, title: row.title, text: row.body,
          target: { source: 'kb', documentId: row.id },
          allowed: async () => {
            const fresh = await db.kb.kbDocumentById(row.id)
            return !!fresh && canSee(fresh, await kbViewOfRequest(db, req))
          }
        })
      }
      for (const summary of (await kb.topics(view)).filter(item => !item.editable)) {
        const document = await kb.document(summary.id, await kbViewOfRequest(db, req))
        if (!document) continue
        result.push({
          key: document.id, title: document.title, text: document.body,
          target: { source: 'kb', documentId: document.id },
          allowed: async () => !!await kb.document(document.id, await kbViewOfRequest(db, req))
        })
      }
      return result
    }
  }
}

export function registerUniversalSearch(app: FastifyInstance, db: VoiceChatDb, kb: KnowledgeBaseService, make: Pick<MakeService, 'listFiles'>): void {
  const service = new UniversalSearch()
  app.post<{ Body: UniversalSearchRequest }>(REST.universalSearch, {
    schema: { body: {
      type: 'object', additionalProperties: false, required: ['query'],
      properties: {
        query: { type: 'string', maxLength: 300 }, limit: { type: 'integer', minimum: 1, maximum: 60 },
        cursor: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
        recent: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 90 } }
      }
    } }
  }, async (req, reply) => {
    reply.header('cache-control', 'no-store')
    try { return await service.search(uid(req), req.body, searchAdapters(db, kb, make, req)) }
    catch (error) {
      if (error instanceof SearchCursorError) return reply.code(400).send({ error: 'invalid_search_cursor' })
      return reply.code(503).send({ error: 'search_unavailable' })
    }
  })
}

