import { describe, expect, it, vi } from 'vitest'
import type { Conversation } from '@shared/types'
import type { PreviewActionResult } from '@shared/previewActions'
import type { ReaderChatPort, RecorderState, WebReaderHostPort } from './contracts'
import { createWebReaderStore } from './store'

const conversation = { id: 'reader', assistantKind: 'web-recorder', projectId: 'project', previewUrl: null } as Conversation
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function harness() {
  const chat = { list: vi.fn(async () => [conversation]), get: vi.fn(async () => conversation) }
  let listener!: (state: RecorderState) => void
  let relay!: Parameters<WebReaderHostPort['relay']['subscribe']>[0]
  const unsubscribe = vi.fn()
  const recorder = {
    state: vi.fn((): RecorderState => ({ ready: true, page: 'ready' })),
    setUrl: vi.fn(), run: vi.fn(async (): Promise<PreviewActionResult> => ({ url: 'https://example.test/' })),
    subscribe: vi.fn((fn: typeof listener) => { listener = fn; return unsubscribe }), dispose: vi.fn()
  }
  const host = {
    projectPreviewUrl: vi.fn(async () => 'https://example.test/'), recorder: vi.fn(() => recorder),
    relay: { subscribe: (fn: typeof relay) => { relay = fn; return vi.fn() }, result: vi.fn() }
  }
  const store = createWebReaderStore(chat as unknown as ReaderChatPort, host)
  return { store, chat, host, recorder, unsubscribe, listener: () => listener, request: () => relay({ conversationId: 'reader', requestId: 'r', action: { kind: 'read' } }) }
}

describe('Reader activation lifecycle', () => {
  it('lets list refresh and activation finish independently', async () => {
    const h = harness(), list = deferred<Conversation[]>(), get = deferred<Conversation>()
    h.chat.list.mockReturnValueOnce(list.promise); h.chat.get.mockReturnValueOnce(get.promise)
    const loading = h.store.load(), activating = h.store.activate('reader')
    list.resolve([conversation]); get.resolve(conversation)
    await Promise.all([loading, activating])
    expect(h.store.getState()).toMatchObject({ status: 'ready', recorder: 'ready', previewUrl: 'https://example.test/' })
    h.store.dispose()
  })
  it('ignores an older list response', async () => {
    const h = harness(), old = deferred<Conversation[]>()
    h.chat.list.mockReturnValueOnce(old.promise)
    const pending = h.store.load(); await h.store.load()
    old.resolve([]); await pending
    expect(h.store.getState().conversations).toEqual([conversation]); h.store.dispose()
  })
  it('turns lookup rejection into recoverable state', async () => {
    const h = harness(); h.chat.get.mockRejectedValueOnce(new Error('offline'))
    await expect(h.store.activate('reader')).resolves.toBeUndefined()
    expect(h.store.getState().error).toContain('Не удалось открыть'); h.store.dispose()
  })
  it('handles rejected project fallback without opening a recorder', async () => {
    const h = harness(); h.host.projectPreviewUrl.mockRejectedValueOnce(new Error('offline'))
    await h.store.activate('reader')
    expect(h.store.getState().error).toContain('Не удалось открыть')
    expect(h.host.recorder).not.toHaveBeenCalled(); h.store.dispose()
  })
  it('does not depend on project availability for an explicit URL', async () => {
    const h = harness(); h.chat.get.mockResolvedValueOnce({ ...conversation, previewUrl: 'https://own.test/' })
    await h.store.activate('reader')
    expect(h.host.projectPreviewUrl).not.toHaveBeenCalled()
    expect(h.recorder.setUrl).toHaveBeenCalledWith('https://own.test/'); h.store.dispose()
  })
  it('clears the old error when activating or clearing a conversation', async () => {
    const h = harness(); h.chat.get.mockRejectedValueOnce(new Error('offline'))
    await h.store.activate('reader'); await h.store.activate(null)
    expect(h.store.getState().error).toBeNull(); h.store.dispose()
  })
  it('exposes initial recorder state without waiting for an event', async () => {
    const h = harness(); await h.store.activate('reader')
    expect(h.store.getState().recorder).toBe('ready'); h.store.dispose()
  })
  it('unsubscribes before disposing the old recorder', async () => {
    const h = harness(); await h.store.activate('reader'); await h.store.activate(null)
    expect(h.unsubscribe).toHaveBeenCalledOnce()
    expect(h.unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(h.recorder.dispose.mock.invocationCallOrder[0]); h.store.dispose()
  })
  it('ignores old events even after reactivating the same conversation', async () => {
    const h = harness(); await h.store.activate('reader'); const old = h.listener()
    await h.store.activate(null); await h.store.activate('reader')
    old({ ready: false, page: 'error', error: 'stale' })
    expect(h.store.getState()).toMatchObject({ recorder: 'ready', error: null }); h.store.dispose()
  })
  it('contains action rejection and suppresses late results after reactivation', async () => {
    const h = harness(); await h.store.activate('reader')
    h.recorder.run.mockRejectedValueOnce(new Error('closed')); h.request()
    await vi.waitFor(() => expect(h.store.getState().error).toContain('действие Reader'))
    const action = deferred<PreviewActionResult>(); h.recorder.run.mockReturnValueOnce(action.promise); h.request()
    await vi.waitFor(() => expect(h.recorder.run).toHaveBeenCalledTimes(2))
    await h.store.activate(null); await h.store.activate('reader')
    action.resolve({ url: 'https://stale.test/' }); await action.promise; await Promise.resolve()
    expect(h.host.relay.result).not.toHaveBeenCalled(); h.store.dispose()
  })
})
