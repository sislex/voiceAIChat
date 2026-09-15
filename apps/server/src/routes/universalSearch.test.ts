import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { REST, SEARCH_SOURCES, type UniversalSearchResult } from '@voicechat/shared'
import { VoiceChatDb } from '../db/database.js'
import { ScopedKnowledgeBase } from '../kb/scoped.js'
import type { KnowledgeBaseService } from '../kb/types.js'
import { registerUniversalSearch, UniversalSearch, SearchCursorError, type SearchAdapters, type SearchCandidate } from './universalSearch.js'

let db: VoiceChatDb
let app: FastifyInstance
const files = new Map<string, Array<{ path: string; size: number; updatedAt: number }>>()
const base = { topics: async () => [], document: async () => null } as unknown as KnowledgeBaseService
beforeEach(async () => {
  db = new VoiceChatDb(':memory:')
  await db.ready
  await db.identity.createUser('alice', '', 'developer')
  await db.identity.createUser('bob', '', 'developer')
  files.clear()
  app = Fastify()
  app.addHook('preHandler', async req => { req.user = { name: String(req.headers['x-user'] ?? 'alice'), role: 'developer' } })
  registerUniversalSearch(app, db, new ScopedKnowledgeBase(base, db), { listFiles: async id => files.get(id) ?? [] })
})
afterEach(async () => { await app.close(); await db.close() })
async function search(query: string, extra: object = {}, user = 'alice'): Promise<UniversalSearchResult> {
  const response = await app.inject({ method: 'POST', url: REST.universalSearch, headers: { 'x-user': user }, payload: { query, ...extra } })
  expect(response.statusCode, response.body).toBe(200)
  expect(response.headers['cache-control']).toBe('no-store')
  return response.json()
}
const hits = (result: UniversalSearchResult) => result.groups.flatMap(group => group.hits)
async function seed() {
  const project = await db.projects.createProject('alice', { name: 'Найти project' })
  const board = (await db.tasks.getBoardSkeleton('alice', project.id))!
  const task = (await db.tasks.createTask('alice', project.id, { columnId: board.columns[0].id, title: 'Найти task' }))!
  const chat = await db.chat.createConversation('alice', 'Найти chat')
  const message = await db.chat.addMessage('alice', chat.id, 'u1', 'Найти message\napi_key=hidden-needle\n<script>alert("unsafe")</script>', '12:00')
  const make = await db.chat.createConversation('alice', 'Workshop', 'make')
  files.set(make.id, [{ path: 'Найти folder/a #?.ts', size: 1, updatedAt: 0 }, { path: '.env', size: 1, updatedAt: 0 }])
  const doc = await db.kb.saveKbDocument({ scope: 'project', projectId: project.id, title: 'Найти KB', body: 'Найти knowledge', createdBy: 'alice' })
  return { project, task, chat, message, make, doc }
}

// @testCase TC-API
it('returns six typed, named sources with stable IDs and encoded targets', async () => {
  await seed()
  const result = await search('Найти')
  expect(result.groups.map(group => group.source)).toEqual([...SEARCH_SOURCES])
  expect(result.groups.every(group => group.status === 'ok' && group.hits.length >= 1)).toBe(true)
  expect(hits(await search('Найти'))).toEqual(hits(result))
  for (const hit of hits(result)) {
    expect(hit.id.split(':')[0]).toBe(hit.source)
    expect(hit.id.split(':')[1]).toMatch(/^[a-f0-9]{64}$/)
    expect(hit.target.source).toBe(hit.source)
    expect(hit.href).toMatch(/^#\//)
  }
  expect(hits(result).find(hit => hit.source === 'files')!.href).toContain('file=' + encodeURIComponent('Найти folder/a #?.ts'))
  expect(hits(result).find(hit => hit.source === 'messages')!.snippet).toBe('Найти message')
})

// @testCase TC-SECURITY
it('excludes foreign data, secret matches, sensitive file names and revoked recent results', async () => {
  const seeded = await seed()
  expect(hits(await search('Найти', {}, 'bob'))).toEqual([])
  for (const query of ['hidden-needle', 'api_key', 'unsafe', '.env']) expect(hits(await search(query))).toEqual([])
  const before = await search('Найти')
  const serialized = JSON.stringify(before)
  expect(serialized).not.toMatch(/hidden-needle|api_key|script|alert|\.env/)
  await db.projects.addMember('alice', seeded.project.id, 'bob')
  const shared = await search('Найти', {}, 'bob')
  expect([...new Set(hits(shared).map(hit => hit.source))].sort()).toEqual(['kb', 'projects', 'tasks'])
  await db.projects.removeMember('alice', seeded.project.id, 'bob')
  expect(hits(await search('', { recent: hits(shared).map(hit => hit.id) }, 'bob'))).toEqual([])
  expect(hits(await search('Найти', {}, 'bob'))).toEqual([])
})

// @testCase TC-CONSISTENCY
it('reflects confirmed creates, updates and deletes without index refresh', async () => {
  const seeded = await seed()
  expect(hits(await search('updated'))).toEqual([])
  await db.chat.renameConversation('alice', seeded.chat.id, 'updated chat')
  await db.tasks.updateTask('alice', seeded.project.id, seeded.task.id, { title: 'updated task' })
  await db.projects.updateProject('alice', seeded.project.id, { name: 'updated project' })
  await db.kb.saveKbDocument({ id: seeded.doc.id, scope: 'project', projectId: seeded.project.id, title: 'updated KB', body: 'updated body', createdBy: 'alice' })
  files.set(seeded.make.id, [{ path: 'updated.ts', size: 1, updatedAt: 1 }])
  await db.chat.addMessage('alice', seeded.chat.id, 'u1', 'updated message', '12:01')
  expect(new Set(hits(await search('updated')).map(hit => hit.source)).size).toBe(6)
  await db.chat.deleteConversation('alice', seeded.chat.id)
  await db.tasks.deleteTask('alice', seeded.project.id, seeded.task.id)
  await db.kb.deleteKbDocument(seeded.doc.id)
  files.set(seeded.make.id, [])
  const remaining = hits(await search('updated'))
  expect(remaining.map(hit => hit.source)).toEqual(['projects'])
})

// @testCase TC-CONSISTENCY
it('paginates deterministically, rejects foreign/changed cursors and removes revoked data on continuation', async () => {
  const seeded = await seed()
  const first = await search('Найти', { limit: 2 })
  const second = await search('Найти', { limit: 2, cursor: first.nextCursor })
  expect(hits(await search('Найти', { limit: 2, cursor: first.nextCursor }))).toEqual(hits(second))
  const ids = [...hits(first), ...hits(second)].map(hit => hit.id)
  expect(new Set(ids).size).toBe(ids.length)
  for (const [query, user] of [['changed', 'alice'], ['Найти', 'bob']]) {
    const response = await app.inject({ method: 'POST', url: REST.universalSearch, headers: { 'x-user': user }, payload: { query, cursor: first.nextCursor } })
    expect(response.statusCode).toBe(400)
    expect(response.body).not.toContain(seeded.project.id)
  }
  await db.chat.deleteConversation('alice', seeded.chat.id)
  const rest = hits(await search('Найти', { cursor: second.nextCursor }))
  expect(rest.some(hit => hit.target.source === 'messages' && hit.target.conversationId === seeded.chat.id)).toBe(false)
})

// @testCase TC-CONSISTENCY
it('sees KB updates even when timestamps and the old index version do not change', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000)
  try {
    const row = await db.kb.saveKbDocument({ scope: 'user', ownerId: 'alice', title: 'first-title', body: 'first-body', createdBy: 'alice' })
    expect(hits(await search('first-body'))).toHaveLength(1)
    const version = await db.kb.kbDocumentsVersion()
    await db.kb.saveKbDocument({ id: row.id, scope: 'user', ownerId: 'alice', title: 'second-title', body: 'second-body', createdBy: 'alice' })
    expect(await db.kb.kbDocumentsVersion()).toBe(version)
    expect(hits(await search('first-body'))).toHaveLength(0)
    expect(hits(await search('second-body'))).toHaveLength(1)
  } finally { now.mockRestore() }
})

// @testCase TC-SECURITY
it('excludes cancelled task messages even when direct chat reading remains authorized', async () => {
  const project = await db.projects.createProject('alice', { name: 'Cancellation' })
  const board = (await db.tasks.getBoardSkeleton('alice', project.id))!
  const task = (await db.tasks.createTask('alice', project.id, { columnId: board.columns[0].id, title: 'Hidden task' }))!
  const chat = (await db.chat.openOrCreateTaskChat('alice', project.id, task.id))!
  await db.chat.addMessage('alice', chat.id, 'u1', 'cancelled-needle', '12:00')
  const before = hits(await search('cancelled-needle'))
  expect(before).toHaveLength(1)
  await db.tasks.moveTask('alice', project.id, task.id, { columnId: board.columns.find(column => column.semanticType === 'cancelled')!.id })
  expect(await db.chat.listMessages('alice', chat.id)).toHaveLength(1)
  expect(hits(await search('cancelled-needle'))).toEqual([])
  expect(hits(await search('', { recent: [before[0].id] }))).toEqual([])
})

// @testCase TC-API
it('handles empty, Unicode, punctuation and malformed requests predictably', async () => {
  await seed()
  for (const query of ['', '   ', '*', '"', 'ЖЖЖЖ', '<svg>']) expect((await search(query)).groups).toHaveLength(6)
  for (const payload of [{ query: 'x', limit: 0 }, { query: 'x', limit: 61 }, { query: 'x', cursor: 'invalid' }, { query: 'x'.repeat(301) }]) {
    expect((await app.inject({ method: 'POST', url: REST.universalSearch, payload })).statusCode).toBe(400)
  }
})

const candidate = (key: string): SearchCandidate => ({
  key, title: 'needle ' + key, text: '', target: { source: 'projects', projectId: key }, allowed: async () => true
})
const adapters = (): SearchAdapters => ({ chats: async () => [], messages: async () => [], projects: async () => [], tasks: async () => [], files: async () => [], kb: async () => [] })

// @testCase TC-CONSISTENCY
it('keeps successful sources on timeout without exposing source exceptions', async () => {
  const source = adapters()
  source.projects = async () => [candidate('p')]
  source.kb = () => new Promise(() => {})
  source.files = async () => { throw new Error('secret-private-file-path') }
  const result = await new UniversalSearch(10).search('alice', { query: 'needle' }, source)
  expect(hits(result)).toHaveLength(1)
  expect(result.groups.filter(group => group.status === 'unavailable').map(group => group.source)).toEqual(['files', 'kb'])
  expect(JSON.stringify(result)).not.toContain('secret-private-file-path')
})

// @testCase TC-SECURITY
it('rechecks access after a slow sibling finishes and excludes revoked data from pagination', async () => {
  const source = adapters()
  let allowed = true
  let checked!: () => void
  const initialCheck = new Promise<void>(resolve => { checked = resolve })
  source.projects = async () => [{ ...candidate('revoked'), allowed: async () => { checked(); return allowed } }]
  source.kb = async () => { await initialCheck; allowed = false; return [] }
  const response = await new UniversalSearch().search('alice', { query: 'needle', limit: 1 }, source)
  expect(hits(response)).toEqual([])
  expect(response.nextCursor).toBeNull()
  expect(JSON.stringify(response)).not.toContain('revoked')
})

// @testCase TC-CONSISTENCY
it('keeps seen IDs out after renames and expires cursors safely', async () => {
  const service = new UniversalSearch()
  const source = adapters()
  source.projects = async () => [candidate('a'), candidate('b'), candidate('c')]
  const first = await service.search('alice', { query: 'needle', limit: 1 }, source)
  source.projects = async () => [{ ...candidate('a'), title: 'needle zzz' }, candidate('b'), candidate('c')]
  const next = await service.search('alice', { query: 'needle', cursor: first.nextCursor }, source)
  expect(hits(next).some(hit => hit.id === hits(first)[0].id)).toBe(false)
  const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 360_000)
  try { await expect(service.search('alice', { query: 'needle', cursor: first.nextCursor }, source)).rejects.toBeInstanceOf(SearchCursorError) }
  finally { now.mockRestore() }
})

