import { describe, it, expect, vi } from 'vitest'
import { createVoiceStore, type VoiceStore } from './voiceStore'
import { createFakeApi } from '../test/fakeApi'
import type { RendererKbBridge } from '../remote/kbBridge'
import { makeKbProjectUsageReport, makeKbQuery, makeKbUsageReport } from '../test/fixtures'

function makeStore(kb?: RendererKbBridge): VoiceStore {
  return createVoiceStore({ api: createFakeApi(), kb, now: () => 1_700_000_000_000 })
}

function fakeBridge(over: Partial<RendererKbBridge> = {}): RendererKbBridge {
  return {
    getConversationUsage: vi.fn(async () => makeKbUsageReport()),
    getProjectUsage: vi.fn(async () => makeKbProjectUsageReport()),
    onUsage: () => () => {},
    ...over
  }
}

describe('voiceStore — телеметрия базы знаний', () => {
  it('панель открывается и закрывается', () => {
    const store = makeStore()
    store.actions.openKbUsage()
    expect(store.getState().kbUsageOpen).toBe(true)
    store.actions.closeKbUsage()
    expect(store.getState().kbUsageOpen).toBe(false)
  })

  it('loadKbUsage кладёт снапшот и снимает загрузку', async () => {
    const bridge = fakeBridge()
    const store = makeStore(bridge)
    await store.actions.loadKbUsage('c1')
    const cache = store.getState().kbUsage['c1']
    expect(bridge.getConversationUsage).toHaveBeenCalledWith('c1')
    expect(cache.report?.totals.queries).toBe(3)
    expect(cache.loading).toBe(false)
    expect(cache.error).toBeNull()
  })

  it('ошибка чтения остаётся в кэше (панель показывает «Повторить»)', async () => {
    const store = makeStore(fakeBridge({ getConversationUsage: vi.fn(async () => { throw new Error('HTTP 500') }) }))
    await store.actions.loadKbUsage('c1')
    expect(store.getState().kbUsage['c1']).toMatchObject({ loading: false, error: 'HTTP 500' })
  })

  it('без моста отчёт собирается из истории сообщений (desktop и старые чаты)', async () => {
    const store = makeStore()
    // Чат с сохранённым авто-контекстом БЗ в meta.request последнего ответа.
    await store.actions.newConversation()
    const id = store.getState().activeId!
    const meta = {
      request: {
        provider: 'claude' as const, model: 'sonnet', prompt: 'p', promptChars: 4000, resumed: false,
        kbContext: { confidence: 'high' as const, sections: [{ documentId: 'protocol', title: 'Протокол', heading: 'WS', sourcePath: 'docs/kb/protocol.md', anchor: 'ws', chars: 800, estimatedTokens: 200, freshness: 'current' as const }] }
      }
    }
    await store.actions.applyClaudeDone('Ответ', meta, 'claude', {
      id: 'm1', conversationId: id, role: 'ai', text: 'Ответ', time: '12:00', createdAt: 1_700_000_000_000, meta
    }, id)
    await store.actions.loadKbUsage(id)
    const report = store.getState().kbUsage[id].report!
    expect(report.totals).toMatchObject({ queries: 1, chars: 800, estimatedTokens: 200 })
    expect(report.sections[0].documentId).toBe('protocol')
  })

  it('loadProjectKbUsage без моста — no-op, с мостом кладёт агрегат и чаты', async () => {
    const solo = makeStore()
    await solo.actions.loadProjectKbUsage('p1')
    expect(solo.getState().kbUsageByProject['p1']).toBeUndefined()

    const store = makeStore(fakeBridge())
    await store.actions.loadProjectKbUsage('p1')
    const cache = store.getState().kbUsageByProject['p1']
    expect(cache.report?.totals.queries).toBe(3)
    expect(cache.conversations).toHaveLength(2)
  })

  it('applyKbUsageQuery обновляет загруженный чат и проект, остальные не трогает', async () => {
    const store = makeStore(fakeBridge())
    await store.actions.loadKbUsage('c1')
    await store.actions.loadProjectKbUsage('p1')
    const fresh = makeKbQuery({ id: 'kbu-9', seq: 9, source: 'tool_search', chars: 1000 })
    store.actions.applyKbUsageQuery('c1', 'p1', fresh)
    expect(store.getState().kbUsage['c1'].report!.recent[0].id).toBe('kbu-9')
    expect(store.getState().kbUsage['c1'].report!.totals.queries).toBe(4)
    expect(store.getState().kbUsageByProject['p1'].report!.totals.queries).toBe(4)

    // Незагруженный чат кадром не создаётся: его отчёт соберётся при открытии.
    store.actions.applyKbUsageQuery('c-unknown', null, fresh)
    expect(store.getState().kbUsage['c-unknown']).toBeUndefined()
  })

  it('refreshKbStatus кладёт статус индекса и не падает на ошибке', async () => {
    const store = makeStore()
    await store.actions.refreshKbStatus()
    expect(store.getState().kbStatus?.available).toBe(true)
    const api = createFakeApi()
    api['kb:status'] = async () => { throw new Error('нет сети') }
    const broken = createVoiceStore({ api })
    await expect(broken.actions.refreshKbStatus()).resolves.toBeUndefined()
    expect(broken.getState().kbStatus).toBeNull()
  })
})
