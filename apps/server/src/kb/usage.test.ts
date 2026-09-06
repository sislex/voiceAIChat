// Трекер обращений к БЗ. Главное здесь — не формат, а два инварианта: кадр
// «запрашивает…» уходит ДО ответа базы и с тем же id, что у будущей строки; и ни
// один метод трекера не выбрасывает, даже если БД сломана.

import { describe, it, expect, vi } from 'vitest'
import { estimateKbTokens, type ServerMessage } from '@voicechat/shared'
import { VoiceChatDb } from '../db/database.js'
import { createKbUsageTracker } from './usage.js'

const U = 'admin'

function makeDb(): VoiceChatDb {
  let id = 0
  let clock = 1_000
  return new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
}

function collector(): { frames: Array<{ m: ServerMessage; owner: string }>; listen: (m: ServerMessage, owner: string) => void } {
  const frames: Array<{ m: ServerMessage; owner: string }> = []
  return { frames, listen: (m, owner) => frames.push({ m, owner }) }
}

describe('createKbUsageTracker', () => {
  it('begin рассылает pending, complete — терминальный кадр с тем же id', () => {
    const db = makeDb()
    const conv = db.chat.createConversation(U, 'Чат')
    const tracker = createKbUsageTracker({ db })
    const sink = collector()
    tracker.subscribe(sink.listen)

    const handle = tracker.begin({ userId: U, conversationId: conv.id, turnId: 't1', source: 'auto' }, 'как устроены ходы')
    expect(sink.frames).toHaveLength(1)
    const pending = sink.frames[0].m
    expect(pending.t).toBe('kb.usage')
    if (pending.t !== 'kb.usage') throw new Error('ожидался кадр kb.usage')
    expect(pending.query).toMatchObject({ id: handle.id, status: 'pending', chars: 0 })
    expect(pending.query.seq).toBe(1) // курсор предсказан до записи строки
    expect(sink.frames[0].owner).toBe(U)

    handle.complete({
      deliveredChars: 400,
      injected: true,
      confidence: 'high',
      bundleTokens: 90,
      sections: [{ documentId: 'protocol', title: 'Протокол', heading: 'WS', anchor: 'ws', sourcePath: 'docs/kb/protocol.md', chars: 400 }]
    })
    const done = sink.frames[1].m
    if (done.t !== 'kb.usage') throw new Error('ожидался кадр kb.usage')
    expect(done.query).toMatchObject({ id: handle.id, status: 'delivered', chars: 400, injected: true, confidence: 'high', bundleTokens: 90 })
    expect(done.query.estimatedTokens).toBe(estimateKbTokens(400))
    expect(done.query.sections).toHaveLength(1)
    // Строка появилась в БД один раз — pending в неё не писался.
    const report = db.kb.kbUsageReport(U, conv.id)!
    expect(report.recent).toHaveLength(1)
    expect(report.recent[0].id).toBe(handle.id)
    db.close()
  })

  it('повторный терминальный вызов игнорируется (одна строка на обращение)', () => {
    const db = makeDb()
    const conv = db.chat.createConversation(U, 'Чат')
    const tracker = createKbUsageTracker({ db })
    const handle = tracker.begin({ userId: U, conversationId: conv.id, source: 'tool_search' }, 'ws')
    handle.complete({ deliveredChars: 10 })
    handle.fail('поздняя ошибка')
    expect(db.kb.kbUsageReport(U, conv.id)!.totals).toMatchObject({ queries: 1, delivered: 1, errors: 0 })
    db.close()
  })

  it('empty и fail пишут статус и причину, но не текст', () => {
    const db = makeDb()
    const conv = db.chat.createConversation(U, 'Чат')
    const tracker = createKbUsageTracker({ db })
    tracker.begin({ userId: U, conversationId: conv.id, source: 'auto' }, 'q').empty('low-confidence', 'medium')
    tracker.begin({ userId: U, conversationId: conv.id, source: 'auto' }, 'q').fail('kb.context упала')
    const recent = db.kb.kbUsageReport(U, conv.id)!.recent
    expect(recent.map((q) => q.status).sort()).toEqual(['empty', 'error'])
    expect(recent.every((q) => q.chars === 0 && q.error)).toBe(true)
    // Уверенность у пустой выдачи — такой же факт, как у доставленной: без неё
    // не отличить «ничего не нашлось» от «нашлось, но не дотянуло до порога».
    const empty = recent.find((q) => q.status === 'empty')!
    expect(empty).toMatchObject({ confidence: 'medium', error: 'совпадения слабые — контекст не добавлен' })
    db.close()
  })

  it('пустая выдача по бюджету называет свою причину', () => {
    const db = makeDb()
    const conv = db.chat.createConversation(U, 'Чат')
    const tracker = createKbUsageTracker({ db })
    tracker.begin({ userId: U, conversationId: conv.id, source: 'auto' }, 'q').empty('budget', 'high')
    expect(db.kb.kbUsageReport(U, conv.id)!.recent[0]).toMatchObject({
      status: 'empty', confidence: 'high', error: 'найденное не поместилось в бюджет контекста'
    })
    db.close()
  })

  it('НЕ выбрасывает при сломанной БД — БЗ не имеет права ронять ход', () => {
    const broken = {
      kb: {
        kbUsageLastSeq: () => { throw new Error('БД закрыта') },
        addKbUsage: () => { throw new Error('БД закрыта') },
        attachKbUsageTurn: () => { throw new Error('БД закрыта') }
      }
    } as unknown as VoiceChatDb
    const tracker = createKbUsageTracker({ db: broken })
    const sink = collector()
    tracker.subscribe(sink.listen)
    expect(() => {
      const handle = tracker.begin({ userId: U, conversationId: 'c1', source: 'auto' }, 'q')
      handle.complete({ deliveredChars: 100 })
      tracker.attachTurn({ turnId: 't1', messageId: 'm1' })
    }).not.toThrow()
    // Обращение всё равно видно в панели: иначе сбой записи читался бы как
    // «модель БЗ не спрашивала».
    expect(sink.frames.map((f) => (f.m.t === 'kb.usage' ? f.m.query.status : ''))).toEqual(['pending', 'delivered'])
  })

  it('упавший слушатель не мешает записи обращения', () => {
    const db = makeDb()
    const conv = db.chat.createConversation(U, 'Чат')
    const tracker = createKbUsageTracker({ db })
    tracker.subscribe(() => { throw new Error('сокет закрыт') })
    const ok = vi.fn()
    tracker.subscribe(ok)
    expect(() => tracker.begin({ userId: U, conversationId: conv.id, source: 'auto' }, 'q').complete({ deliveredChars: 5 })).not.toThrow()
    expect(ok).toHaveBeenCalledTimes(2)
    expect(db.kb.kbUsageReport(U, conv.id)!.totals.queries).toBe(1)
    db.close()
  })

  it('pending предсказывает seq за уже записанными обращениями', () => {
    const db = makeDb()
    const conv = db.chat.createConversation(U, 'Чат')
    db.kb.addKbUsage({ userId: U, conversationId: conv.id, source: 'auto', query: 'старое', chars: 10 })
    const tracker = createKbUsageTracker({ db })
    const sink = collector()
    tracker.subscribe(sink.listen)
    tracker.begin({ userId: U, conversationId: conv.id, source: 'tool_search' }, 'новое')
    const pending = sink.frames[0].m
    if (pending.t !== 'kb.usage') throw new Error('ожидался кадр kb.usage')
    expect(pending.query.seq).toBe(2)
    db.close()
  })

  it('attachTurn дописывает итоги хода в его обращения', () => {
    const db = makeDb()
    const conv = db.chat.createConversation(U, 'Чат')
    const tracker = createKbUsageTracker({ db })
    tracker.begin({ userId: U, conversationId: conv.id, turnId: 't1', source: 'auto' }, 'q').complete({ deliveredChars: 100 })
    tracker.attachTurn({ turnId: 't1', messageId: 'm1', promptChars: 2000, turnInputTokens: 700 })
    expect(db.kb.kbUsageReport(U, conv.id)!.recent[0]).toMatchObject({ messageId: 'm1', promptChars: 2000, turnInputTokens: 700 })
    db.close()
  })
})
