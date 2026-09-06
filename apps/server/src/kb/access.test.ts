// Контроль доступа к разделам базы знаний. Главное свойство: не-участник проекта
// не может ни найти, ни прочитать статью чужого проекта — ни фильтром, ни по
// прямому id, ни «широким» поиском без фильтров.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { REST, type KbDocument, type KbDocumentSummary, type KbSearchResult, type ProjectDetail } from '@voicechat/shared'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { signToken } from '../users/accounts.js'
import type { KnowledgeBaseService } from './types.js'

const SECRET = 'test-secret'
let app: FastifyInstance
let db: VoiceChatDb
let adminTok: string
let bobTok: string

/** Файловый источник-заглушка: раздел «Использование» из одного документа. */
function usageKb(): KnowledgeBaseService {
  const doc: KbDocument = {
    id: 'usage-basics', title: 'Как пользоваться ChatAI', kind: 'feature', scope: 'usage', tags: [], packages: [],
    freshness: 'current', sourcePath: 'docs/kb/usage/basics.md', body: '# Как пользоваться ChatAI\n\nГолосом или текстом.',
    symbols: [], protocols: [], areas: [], related: [], headings: []
  }
  return {
    status: () => ({ available: true, mode: 'source', searchMode: 'lexical', version: 'v', createdAt: 'now', documents: 1, chunks: 1, staleDocuments: 0 }),
    topics: () => [{ id: doc.id, title: doc.title, kind: doc.kind, scope: 'usage', tags: [], packages: [], freshness: 'current', sourcePath: doc.sourcePath }],
    document: (id) => (id === doc.id ? doc : null),
    search: async ({ query }) => query.includes('голос')
      ? [{ documentId: doc.id, chunkId: `${doc.id}#overview`, title: doc.title, heading: doc.title, excerpt: 'Голосом или текстом.', score: 3, matchTypes: ['lexical'], explanation: 'Полнотекстовое совпадение', freshness: 'current', sourcePath: doc.sourcePath, anchor: '', symbols: [], relatedFiles: [], scope: 'usage' }]
      : [],
    context: async (query) => ({ query, confidence: 'low', autoInjectAllowed: false, sections: [], relatedFiles: [], relatedDocuments: [], staleWarnings: [], estimatedTokens: 0 })
  }
}

function inj(token: string, opts: { method: 'GET' | 'POST' | 'DELETE'; url: string; payload?: object }) {
  return app.inject({ ...opts, headers: { authorization: `Bearer ${token}` } })
}

beforeEach(async () => {
  let id = 0
  let clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  db.identity.createUser('bob', '', 'developer')
  app = await buildServer({
    config: loadConfig({ PORT: '0', VC_DATA_DIR: join(tmpdir(), `vc-kb-access-${Date.now()}-${id}`) }),
    db,
    kbService: usageKb(),
    sessionSecret: SECRET
  })
  adminTok = signToken({ name: 'admin', role: 'admin' }, SECRET)
  bobTok = signToken({ name: 'bob', role: 'developer' }, SECRET)
})
afterEach(async () => {
  await app.close()
  db.close()
})

async function project(name = 'Секретный'): Promise<ProjectDetail> {
  const res = await inj(adminTok, { method: 'POST', url: REST.projects, payload: { name, description: 'Проект админа' } })
  expect(res.statusCode).toBe(200)
  return res.json() as ProjectDetail
}

describe('разделы базы знаний', () => {
  it('новый проект получает скелет раздела «Разработка»', async () => {
    const p = await project()
    const docs = db.kb.kbDocuments({ scope: 'project', projectId: p.id })
    expect(docs).toHaveLength(1)
    expect(docs[0].title).toBe('Разработка: Секретный')
    expect(docs[0].body).toContain('Исследовать проект')

    const topics = (await inj(adminTok, { method: 'GET', url: `${REST.kbTopics}?scope=project&projectId=${p.id}` })).json() as KbDocumentSummary[]
    expect(topics.map((t) => t.title)).toEqual(['Разработка: Секретный'])
    expect(topics[0].scope).toBe('project')
  })

  it('раздел «Использование» виден всем, а вкладка сужает выдачу', async () => {
    const all = (await inj(bobTok, { method: 'GET', url: REST.kbTopics })).json() as KbDocumentSummary[]
    expect(all.map((t) => t.id)).toContain('usage-basics')
    const own = (await inj(bobTok, { method: 'GET', url: `${REST.kbTopics}?scope=user` })).json() as KbDocumentSummary[]
    expect(own).toEqual([])
  })

  it('не-участник не видит знания чужого проекта ни фильтром, ни по id, ни поиском', async () => {
    const p = await project()
    const docId = db.kb.kbDocuments({ scope: 'project', projectId: p.id })[0].id
    // Модель уже дописала в раздел проекта статью с приметным словом.
    db.kb.saveKbDocument({ scope: 'project', projectId: p.id, title: 'Развёртывание', body: '# Развёртывание\n\nСекретный ключ деплоя лежит в vault и в репозиторий не попадает.', createdBy: 'admin' })

    expect((await inj(bobTok, { method: 'GET', url: `${REST.kbTopics}?scope=project&projectId=${p.id}` })).statusCode).toBe(403)
    expect((await inj(bobTok, { method: 'GET', url: `${REST.kbSearch}?q=vault&scope=project&projectId=${p.id}` })).statusCode).toBe(403)
    expect((await inj(bobTok, { method: 'GET', url: REST.kbDocument(docId) })).statusCode).toBe(404)

    // Поиск без фильтров тоже не должен подмешивать чужое.
    const wide = (await inj(bobTok, { method: 'GET', url: `${REST.kbSearch}?q=vault` })).json() as KbSearchResult[]
    expect(wide).toEqual([])
    const mine = (await inj(adminTok, { method: 'GET', url: `${REST.kbSearch}?q=vault` })).json() as KbSearchResult[]
    expect(mine.map((r) => r.documentId)).toContain(db.kb.kbDocuments({ scope: 'project', projectId: p.id }).find((d) => d.title === 'Развёртывание')?.id)

    // Участнику проекта то же самое доступно.
    expect((await inj(adminTok, { method: 'GET', url: REST.kbDocument(docId) })).statusCode).toBe(200)
  })

  it('участник проекта видит его знания сразу после добавления', async () => {
    const p = await project('Общий')
    await inj(adminTok, { method: 'POST', url: REST.projectMembers(p.id), payload: { username: 'bob' } })
    const topics = (await inj(bobTok, { method: 'GET', url: `${REST.kbTopics}?scope=project&projectId=${p.id}` })).json() as KbDocumentSummary[]
    expect(topics.map((t) => t.title)).toEqual(['Разработка: Общий'])
  })

  it('персональные знания видит только владелец', async () => {
    const saved = (await inj(bobTok, { method: 'POST', url: REST.kbDocuments, payload: { scope: 'user', title: 'Мои настройки', body: 'Отвечай кратко, голосом Amy.' } })).json() as KbDocument
    expect(saved.scope).toBe('user')
    expect(saved.editable).toBe(true)

    const bobTopics = (await inj(bobTok, { method: 'GET', url: `${REST.kbTopics}?scope=user` })).json() as KbDocumentSummary[]
    expect(bobTopics.map((t) => t.title)).toEqual(['Мои настройки'])
    expect((await inj(adminTok, { method: 'GET', url: REST.kbDocument(saved.id) })).statusCode).toBe(404)
    expect(((await inj(adminTok, { method: 'GET', url: `${REST.kbSearch}?q=Amy` })).json() as KbSearchResult[])).toEqual([])
    // Чужую статью нельзя ни переписать, ни удалить.
    expect((await inj(adminTok, { method: 'POST', url: REST.kbDocuments, payload: { id: saved.id, scope: 'user', title: 'Подмена', body: 'x' } })).statusCode).toBe(403)
    expect((await inj(adminTok, { method: 'DELETE', url: REST.kbDocument(saved.id) })).statusCode).toBe(403)
  })

  it('писать в чужой проект и в «Использование» без прав нельзя', async () => {
    const p = await project()
    expect((await inj(bobTok, { method: 'POST', url: REST.kbDocuments, payload: { scope: 'project', projectId: p.id, title: 'Чужое', body: 'x' } })).statusCode).toBe(403)
    expect((await inj(bobTok, { method: 'POST', url: REST.kbDocuments, payload: { scope: 'usage', title: 'Общее', body: 'x' } })).statusCode).toBe(403)
    expect((await inj(adminTok, { method: 'POST', url: REST.kbDocuments, payload: { scope: 'usage', title: 'Общее', body: 'x' } })).statusCode).toBe(200)
  })

  it('«Исследовать проект» закрыт для не-участника и требует машину', async () => {
    const p = await project()
    expect((await inj(bobTok, { method: 'POST', url: REST.projectKbResearch(p.id) })).statusCode).toBe(403)
    const noMachine = await inj(adminTok, { method: 'POST', url: REST.projectKbResearch(p.id) })
    expect(noMachine.statusCode).toBe(400)
    expect(noMachine.json().error).toContain('нет машины')
  })
})
