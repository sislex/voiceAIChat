// REST-снапшоты телеметрии БЗ: по чату и по проекту. Изоляция здесь — не деталь:
// числа обращений показывают, что модель читала, поэтому чужой чат и чужой проект
// обязаны отвечать 404, а не пустым отчётом.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { REST, type KbProjectUsageReport, type KbUsageReport } from '@voicechat/shared'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { signToken } from '../users/accounts.js'

const SECRET = 'test-secret'
let app: FastifyInstance
let db: VoiceChatDb
let adminTok: string
let bobTok: string

function get(token: string, url: string) {
  return app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } })
}

beforeEach(async () => {
  let id = 0
  let clock = 1_000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  db.createUser('bob', '', 'developer')
  app = await buildServer({
    config: loadConfig({ PORT: '0', VC_DATA_DIR: join(tmpdir(), `vc-kbusage-${Date.now()}`) }),
    db,
    sessionSecret: SECRET
  })
  adminTok = signToken({ name: 'admin', role: 'admin' }, SECRET)
  bobTok = signToken({ name: 'bob', role: 'developer' }, SECRET)
})
afterEach(async () => {
  await app.close()
  db.close()
})

describe('GET /api/conversations/:id/kb-usage', () => {
  it('отдаёт итоги, разделы, ленту и lastSeq своего чата', async () => {
    const conv = db.createConversation('admin', 'Чат')
    db.addKbUsage({
      userId: 'admin', conversationId: conv.id, source: 'auto', query: 'ходы', chars: 400, injected: true, confidence: 'high',
      sections: [{ documentId: 'llm', title: 'LLM', heading: 'Ходы', anchor: 'hody', sourcePath: 'docs/kb/llm.md', chars: 400 }]
    })
    db.addKbUsage({ userId: 'admin', conversationId: conv.id, source: 'tool_search', query: 'ws', chars: 120 })

    const res = await get(adminTok, REST.conversationKbUsage(conv.id))
    expect(res.statusCode).toBe(200)
    const report = res.json() as KbUsageReport
    expect(report.conversationId).toBe(conv.id)
    expect(report.kbContextMode).toBe('auto')
    expect(report.lastSeq).toBe(2)
    expect(report.totals).toMatchObject({ queries: 2, delivered: 2, toolQueries: 1, chars: 520, documents: 1 })
    expect(report.sections[0]).toMatchObject({ documentId: 'llm', anchor: 'hody', times: 1, autoTimes: 1 })
    expect(report.recent.map((q) => q.source)).toEqual(['tool_search', 'auto'])
    // Флаги конфигурации приходят вместе с отчётом: панель отличает «пусто» от «выключено».
    expect(typeof report.toolEnabled).toBe('boolean')
    expect(typeof report.available).toBe('boolean')
  })

  it('режим разговора виден в отчёте (панель показывает чип режима)', async () => {
    const conv = db.createConversation('admin', 'Чат')
    db.setConversationKbContextMode('admin', conv.id, 'manual')
    const report = (await get(adminTok, REST.conversationKbUsage(conv.id))).json() as KbUsageReport
    expect(report.kbContextMode).toBe('manual')
    expect(report.totals.queries).toBe(0)
  })

  it('чужой и несуществующий чат → 404', async () => {
    const conv = db.createConversation('admin', 'Чат')
    expect((await get(bobTok, REST.conversationKbUsage(conv.id))).statusCode).toBe(404)
    expect((await get(adminTok, REST.conversationKbUsage('нет-такого'))).statusCode).toBe(404)
  })

  it('без токена → 401 (маршрут не публичный)', async () => {
    const conv = db.createConversation('admin', 'Чат')
    const res = await app.inject({ method: 'GET', url: REST.conversationKbUsage(conv.id) })
    expect(res.statusCode).toBe(401)
  })

  it('успешно отмечает загруженную границу, не захватывая более новое событие', async () => {
    const conv = db.createConversation('admin', 'Чат')
    db.addKbUsage({ userId: 'admin', conversationId: conv.id, source: 'auto', query: 'q1', chars: 1 })
    const snapshot = (await get(adminTok, REST.conversationKbUsage(conv.id))).json() as KbUsageReport
    db.addKbUsage({ userId: 'admin', conversationId: conv.id, source: 'tool_search', query: 'q2', chars: 1 })

    const marked = await app.inject({
      method: 'POST',
      url: REST.conversationKbUsageViewed(conv.id),
      headers: { authorization: `Bearer ${adminTok}` },
      payload: { lastSeq: snapshot.lastSeq }
    })
    expect(marked.statusCode).toBe(200)
    expect(marked.json()).toEqual({ lastSeq: 1, unreadCount: 1 })
    expect((await get(adminTok, REST.conversationKbUsage(conv.id))).json()).toMatchObject({
      unreadCount: 1,
      totals: { queries: 2 }
    })
  })

  it('не позволяет отмечать чужой чат и валидирует границу', async () => {
    const conv = db.createConversation('admin', 'Чат')
    const foreign = await app.inject({
      method: 'POST', url: REST.conversationKbUsageViewed(conv.id),
      headers: { authorization: `Bearer ${bobTok}` }, payload: { lastSeq: 0 }
    })
    expect(foreign.statusCode).toBe(404)
    const bad = await app.inject({
      method: 'POST', url: REST.conversationKbUsageViewed(conv.id),
      headers: { authorization: `Bearer ${adminTok}` }, payload: { lastSeq: -1 }
    })
    expect(bad.statusCode).toBe(400)
  })
})

describe('GET /api/projects/:id/kb-usage', () => {
  it('агрегирует обращения всех чатов проекта', async () => {
    const project = db.createProject('admin', { name: 'P' })
    const a = db.createConversation('admin', 'A')
    const b = db.createConversation('admin', 'B')
    for (const conv of [a, b]) {
      db.addKbUsage({
        userId: 'admin', conversationId: conv.id, projectId: project.id, source: 'auto', query: 'q', chars: 200,
        sections: [{ documentId: 'ui', title: 'UI', heading: 'Панели', anchor: 'paneli', sourcePath: 'docs/kb/ui.md', chars: 200 }]
      })
    }
    const res = await get(adminTok, REST.projectKbUsage(project.id))
    expect(res.statusCode).toBe(200)
    const report = res.json() as KbProjectUsageReport
    expect(report.totals).toMatchObject({ queries: 2, chars: 400 })
    expect(report.sections[0]).toMatchObject({ documentId: 'ui', times: 2, conversations: 2 })
    expect(report.conversations).toHaveLength(2)
    expect(report.recent).toHaveLength(2)
  })

  it('не участник проекта → 404', async () => {
    const project = db.createProject('admin', { name: 'P' })
    expect((await get(bobTok, REST.projectKbUsage(project.id))).statusCode).toBe(404)
  })
})
