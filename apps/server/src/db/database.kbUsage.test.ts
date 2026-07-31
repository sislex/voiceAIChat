// Телеметрия обращений к базе знаний: монотонность курсора, агрегаты, изоляция.
// Главная ловушка проверяется отдельно: totals.chars НЕ должен размножаться по
// числу разделов обращения (для этого итоги считаются запросом без JOIN).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VoiceChatDb } from './database'

const U = 'admin'

function makeDb(): VoiceChatDb {
  let idCounter = 0
  let clock = 1_000
  return new VoiceChatDb(':memory:', { newId: () => `id-${++idCounter}`, now: () => (clock += 10) })
}

/** Обращение с двумя разделами: 300 + 200 символов текста, отданного модели. */
function twoSections(): Array<{ documentId: string; title: string; heading: string; anchor: string; sourcePath: string; chars: number }> {
  return [
    { documentId: 'protocol', title: 'Протокол', heading: 'WebSocket', anchor: 'websocket', sourcePath: 'docs/kb/protocol.md', chars: 300 },
    { documentId: 'llm', title: 'LLM', heading: 'Ходы', anchor: 'hody', sourcePath: 'docs/kb/llm.md', chars: 200 }
  ]
}

describe('VoiceChatDb — обращения к базе знаний', () => {
  let db: VoiceChatDb
  beforeEach(() => { db = makeDb() })
  afterEach(() => db.close())

  it('seq монотонен внутри разговора и не мешает соседнему чату', () => {
    const a = db.createConversation(U, 'A')
    const b = db.createConversation(U, 'B')
    const first = db.addKbUsage({ userId: U, conversationId: a.id, source: 'auto', query: 'q1', chars: 10 })
    const second = db.addKbUsage({ userId: U, conversationId: a.id, source: 'tool_search', query: 'q2', chars: 20 })
    const other = db.addKbUsage({ userId: U, conversationId: b.id, source: 'auto', query: 'q3', chars: 30 })
    expect([first.seq, second.seq]).toEqual([1, 2])
    expect(other.seq).toBe(1)
    expect(db.kbUsageReport(U, a.id)!.lastSeq).toBe(2)
  })

  it('totals.chars не дублируется при нескольких разделах одного обращения', () => {
    const conv = db.createConversation(U, 'Чат')
    db.addKbUsage({ userId: U, conversationId: conv.id, source: 'auto', query: 'ходы', chars: 500, injected: true, sections: twoSections() })
    const report = db.kbUsageReport(U, conv.id)!
    expect(report.totals.queries).toBe(1)
    expect(report.totals.chars).toBe(500) // а не 500 × 2 разделa
    expect(report.totals.estimatedTokens).toBe(125) // ceil(500/4)
    expect(report.totals.sections).toBe(2)
    expect(report.totals.documents).toBe(2)
  })

  it('агрегат группируется по documentId + anchor и различает источник', () => {
    const conv = db.createConversation(U, 'Чат')
    db.addKbUsage({ userId: U, conversationId: conv.id, source: 'auto', query: 'ходы', chars: 300, sections: [twoSections()[0]] })
    db.addKbUsage({ userId: U, conversationId: conv.id, source: 'tool_document', query: 'ходы', chars: 300, sections: [twoSections()[0]] })
    db.addKbUsage({ userId: U, conversationId: conv.id, source: 'tool_search', query: 'llm', chars: 200, sections: [twoSections()[1]] })
    const sections = db.kbUsageReport(U, conv.id)!.sections
    expect(sections).toHaveLength(2)
    const top = sections[0]
    expect(top).toMatchObject({ documentId: 'protocol', anchor: 'websocket', times: 2, autoTimes: 1, chars: 600 })
    expect(top.estimatedTokens).toBe(150) // 75 + 75
    expect(db.kbUsageReport(U, conv.id)!.totals.toolQueries).toBe(2)
  })

  it('attachKbUsageTurn дописывает итоги хода во все обращения этого хода', () => {
    const conv = db.createConversation(U, 'Чат')
    db.addKbUsage({ userId: U, conversationId: conv.id, source: 'auto', turnId: 't1', query: 'a', chars: 100 })
    db.addKbUsage({ userId: U, conversationId: conv.id, source: 'tool_search', turnId: 't1', query: 'b', chars: 50 })
    db.addKbUsage({ userId: U, conversationId: conv.id, source: 'auto', turnId: 't2', query: 'c', chars: 40 })
    expect(db.attachKbUsageTurn({ turnId: 't1', messageId: 'm1', promptChars: 4000, turnInputTokens: 1200 })).toBe(2)
    const report = db.kbUsageReport(U, conv.id)!
    const t1 = report.recent.filter((q) => q.turnId === 't1')
    expect(t1.map((q) => q.messageId)).toEqual(['m1', 'm1'])
    expect(t1.every((q) => q.promptChars === 4000 && q.turnInputTokens === 1200)).toBe(true)
    // Промпт одного хода общий для его обращений — в итогах он учтён один раз.
    expect(report.totals.promptChars).toBe(4000)
  })

  it('удаление разговора уносит обращения и их разделы (каскад)', () => {
    const conv = db.createConversation(U, 'Чат')
    db.addKbUsage({ userId: U, conversationId: conv.id, source: 'auto', query: 'q', chars: 100, sections: twoSections() })
    db.deleteConversation(U, conv.id)
    expect(db.kbUsageReport(U, conv.id)).toBeNull()
  })

  it('чужой чат не отдаёт отчёт (изоляция по владельцу)', () => {
    db.createUser('bob', 'x', 'user')
    const conv = db.createConversation(U, 'Чат')
    db.addKbUsage({ userId: U, conversationId: conv.id, source: 'auto', query: 'q', chars: 10 })
    expect(db.kbUsageReport('bob', conv.id)).toBeNull()
  })

  it('проектный агрегат виден участнику и считает чаты, а не участнику — null', () => {
    db.createUser('alice', 'x', 'user')
    db.createUser('bob', 'x', 'user')
    const project = db.createProject('alice', { name: 'P' })
    const a = db.createConversation('alice', 'A')
    const b = db.createConversation('alice', 'B')
    db.addKbUsage({ userId: 'alice', conversationId: a.id, projectId: project.id, source: 'auto', query: 'q', chars: 300, sections: [twoSections()[0]] })
    db.addKbUsage({ userId: 'alice', conversationId: b.id, projectId: project.id, source: 'tool_search', query: 'q', chars: 300, sections: [twoSections()[0]] })
    const report = db.kbUsageProjectReport('alice', project.id)!
    expect(report.totals.queries).toBe(2)
    expect(report.totals.chars).toBe(600)
    expect(report.sections[0]).toMatchObject({ documentId: 'protocol', times: 2, conversations: 2 })
    expect(report.conversations.map((c) => c.conversationId).sort()).toEqual([a.id, b.id].sort())
    expect(db.kbUsageProjectReport('bob', project.id)).toBeNull()
  })

  it('статусы empty/error попадают в итоги и не считаются доставленными', () => {
    const conv = db.createConversation(U, 'Чат')
    db.addKbUsage({ userId: U, conversationId: conv.id, source: 'auto', status: 'empty', query: 'q', chars: 0 })
    db.addKbUsage({ userId: U, conversationId: conv.id, source: 'auto', status: 'error', query: 'q', chars: 0, error: 'kb упала' })
    db.addKbUsage({ userId: U, conversationId: conv.id, source: 'auto', query: 'q', chars: 10, injected: true })
    const totals = db.kbUsageReport(U, conv.id)!.totals
    expect(totals).toMatchObject({ queries: 3, delivered: 1, empty: 1, errors: 1 })
    expect(db.kbUsageReport(U, conv.id)!.recent[0].status).toBe('delivered')
  })
})
