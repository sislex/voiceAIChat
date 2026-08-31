// Поиск по сообщениям в сторе: дебаунс, обесценивание устаревших ответов,
// четыре состояния панели, пагинация и подсветка найденного сообщения.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestStore, type TestStore } from '../test/appHarness'
import { createFakeApi, type FakeApi } from '../test/fakeApi'
import type { MessageSearchHit, MessageSearchResult } from '@shared/types'

const DEBOUNCE = 250

function makeStore(): { store: TestStore; api: FakeApi } {
  const api = createFakeApi(['Беседа'])
  return { store: createTestStore({ api, now: () => 1_700_000_000_000 }), api }
}

function hit(id: string): MessageSearchHit {
  return {
    messageId: id,
    conversationId: 'c1',
    conversationTitle: 'Беседа',
    projectId: null,
    role: 'u1',
    createdAt: 1,
    time: '12:00',
    snippet: `<mark>${id}</mark>`,
    score: -1
  }
}

function page(ids: string[], nextCursor: string | null = null): MessageSearchResult {
  return { hits: ids.map(hit), nextCursor, match: '"q"*' }
}

describe('voiceStore — поиск по сообщениям', () => {
  let store: TestStore
  let api: FakeApi

  beforeEach(() => {
    vi.useFakeTimers()
    ;({ store, api } = makeStore())
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('в области «Беседы» поиск по сообщениям не запрашивается', async () => {
    const spy = vi.spyOn(api, 'messages:search')

    await store.actions.setSearchQuery('миграция')

    expect(spy).not.toHaveBeenCalled()
    expect(store.getState().messageSearch.hits).toEqual([])
  })

  it('быстрый набор шлёт один запрос — с последним текстом', async () => {
    const spy = vi.spyOn(api, 'messages:search').mockResolvedValue(page(['m1']))
    await store.actions.setSearchScope('messages')

    await store.actions.setSearchQuery('ми')
    await store.actions.setSearchQuery('мигр')
    await store.actions.setSearchQuery('миграция')
    // Пауза ещё не вышла — запроса нет, но панель уже показывает загрузку.
    expect(spy).not.toHaveBeenCalled()
    expect(store.getState().messageSearch.status).toBe('loading')

    await vi.advanceTimersByTimeAsync(DEBOUNCE)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toEqual(expect.objectContaining({ query: 'миграция' }))
    expect(spy.mock.calls[0][0]).not.toHaveProperty('projectId')
    expect(store.getState().messageSearch).toMatchObject({
      query: 'миграция',
      status: 'ready',
      hits: [hit('m1')],
      nextCursor: null
    })
  })

  it('ответ устаревшего запроса не перезаписывает результаты нового', async () => {
    const deferred: Array<(res: MessageSearchResult) => void> = []
    vi.spyOn(api, 'messages:search').mockImplementation(
      () => new Promise<MessageSearchResult>((resolve) => deferred.push(resolve))
    )
    await store.actions.setSearchScope('messages')

    await store.actions.setSearchQuery('первый')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    await store.actions.setSearchQuery('второй')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(deferred).toHaveLength(2)

    // Отвечаем в обратном порядке: сначала второй (актуальный), потом первый.
    deferred[1](page(['актуальный']))
    await vi.advanceTimersByTimeAsync(0)
    deferred[0](page(['устаревший']))
    await vi.advanceTimersByTimeAsync(0)

    expect(store.getState().messageSearch.hits.map((h) => h.messageId)).toEqual(['актуальный'])
    expect(store.getState().messageSearch.query).toBe('второй')
  })

  it('пустой запрос чистит панель и не ходит на сервер', async () => {
    const spy = vi.spyOn(api, 'messages:search').mockResolvedValue(page(['m1']))
    await store.actions.setSearchScope('messages')
    await store.actions.setSearchQuery('миграция')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(store.getState().messageSearch.hits).toHaveLength(1)
    spy.mockClear()

    await store.actions.setSearchQuery('  ')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)

    expect(spy).not.toHaveBeenCalled()
    expect(store.getState().messageSearch).toMatchObject({ status: 'idle', hits: [], query: '' })
  })

  it('ошибка запроса → состояние ошибки, «Повторить» перезапрашивает', async () => {
    const spy = vi.spyOn(api, 'messages:search').mockRejectedValue(new Error('сервер недоступен'))
    await store.actions.setSearchScope('messages')
    await store.actions.setSearchQuery('миграция')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)

    expect(store.getState().messageSearch).toMatchObject({ status: 'error', error: 'сервер недоступен' })
    // Ошибка поиска живёт в панели, а не в тостах: она рядом с запросом.
    expect(store.getState().notices).toEqual([])

    spy.mockResolvedValue(page(['m1']))
    await store.actions.retryMessageSearch()

    expect(store.getState().messageSearch).toMatchObject({ status: 'ready', hits: [hit('m1')] })
  })

  it('возврат в область «Беседы» чистит результаты и обновляет список', async () => {
    vi.spyOn(api, 'messages:search').mockResolvedValue(page(['m1']))
    await store.actions.setSearchScope('messages')
    await store.actions.setSearchQuery('миграция')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(store.getState().messageSearch.hits).toHaveLength(1)

    await store.actions.setSearchScope('chats')

    expect(store.getState().searchScope).toBe('chats')
    expect(store.getState().messageSearch).toMatchObject({ status: 'idle', hits: [] })
  })

  it('запрос, отложенный в момент возврата к беседам, не выстреливает', async () => {
    const spy = vi.spyOn(api, 'messages:search').mockResolvedValue(page(['m1']))
    await store.actions.setSearchScope('messages')
    await store.actions.setSearchQuery('миграция')

    await store.actions.setSearchScope('chats')
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 4)

    expect(spy).not.toHaveBeenCalled()
  })

  it('«Показать ещё» добавляет страницу и обновляет курсор', async () => {
    const spy = vi
      .spyOn(api, 'messages:search')
      .mockResolvedValueOnce(page(['m1'], 'cursor-1'))
      .mockResolvedValueOnce(page(['m2'], null))
    await store.actions.setSearchScope('messages')
    await store.actions.setSearchQuery('миграция')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)
    expect(store.getState().messageSearch.nextCursor).toBe('cursor-1')

    await store.actions.loadMoreMessageSearch()

    expect(spy.mock.calls[1][0]).toMatchObject({ query: 'миграция', cursor: 'cursor-1' })
    expect(store.getState().messageSearch.hits.map((h) => h.messageId)).toEqual(['m1', 'm2'])
    expect(store.getState().messageSearch.nextCursor).toBeNull()

    // Курсора больше нет — второй раз догружать нечего.
    await store.actions.loadMoreMessageSearch()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('мультифильтр поиска по сообщениям применяется на клиенте', async () => {
    const project = await api['projects:create']({ name: 'Проект' })
    const other = await api['projects:create']({ name: 'Другой' })
    const spy = vi.spyOn(api, 'messages:search').mockResolvedValue({
      ...page(['m1', 'm2']),
      hits: [{ ...hit('m1'), projectId: project.id }, { ...hit('m2'), projectId: other.id }]
    })
    await store.actions.syncSidebarProjects([project.id, other.id])
    await store.actions.setSidebarProjectIds([project.id])
    await store.actions.setSearchScope('messages')
    await store.actions.setSearchQuery('миграция')
    await vi.advanceTimersByTimeAsync(DEBOUNCE)

    expect(spy.mock.calls.at(-1)?.[0]).not.toHaveProperty('projectId')
    expect(store.getState().messageSearch.hits.map((item) => item.messageId)).toEqual(['m1'])
  })

  it('подсветка найденного сообщения ставится и снимается', () => {
    store.actions.focusMessage('m1')
    expect(store.getState().highlightMessageId).toBe('m1')

    store.actions.clearMessageHighlight()
    expect(store.getState().highlightMessageId).toBeNull()
  })
})
