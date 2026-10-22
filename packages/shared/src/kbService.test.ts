import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { REST } from './protocol'
import type { IpcInvokeMap } from './ipc'
import {
  createKbServiceRpcDispatcher, formatKbFileDocumentId, isKbContextRequest,
  isKbModuleId, isKbSearchRequest, isKbTopicsRequest, KB_SERVICE_RPC,
  parseKbFileDocumentId
} from './kbService'
import type { KbServiceRpcHandlers, KbServiceRpcResult } from './kbService'
import type { KbContextRequest, KbDocument, KbModule, KbTopicsRequest } from './kb'

describe('module file identities', () => {
  it.each(['architecture', 'features/project-knowledge-base', 'docs/kb/protocol.md'])('resolves legacy %s in core', path => {
    expect(parseKbFileDocumentId(path)).toEqual({ module: 'core', path })
    expect(parseKbFileDocumentId(`core:${path}`)).toEqual(parseKbFileDocumentId(path))
  })
  it('round-trips paths and keeps modules distinct', () => {
    expect(formatKbFileDocumentId('make', 'features/editor.md')).toBe('make:features/editor.md')
    expect(parseKbFileDocumentId('make:features/editor.md')).toEqual({ module: 'make', path: 'features/editor.md' })
    expect(parseKbFileDocumentId('core:features/editor.md')?.module).toBe('core')
  })
  it.each(['', ':path', 'Core:path', 'core:', 'core:../secret', 'core:/root', 'core:a//b', 'core:a:b', 'core:a\\b'])('rejects malformed file ID %s', id => {
    expect(parseKbFileDocumentId(id)).toBeNull()
  })
  it('validates module slugs at construction', () => {
    expect(isKbModuleId('playwright-reader')).toBe(true)
    expect(() => formatKbFileDocumentId('bad/module', 'topic')).toThrow(TypeError)
  })
})

describe('backward-compatible decoded requests', () => {
  it('accepts omitted filters and existing project, search and context requests', () => {
    for (const value of [undefined, {}, { scope: 'project', projectId: 'p' }, { projectId: null }]) {
      expect(isKbTopicsRequest(value)).toBe(true)
    }
    expect(isKbSearchRequest({ query: '' })).toBe(true)
    expect(isKbSearchRequest({ query: 'editor', kinds: ['feature'], tags: [], limit: 0, scope: 'project', projectId: 'p' })).toBe(true)
    expect(isKbContextRequest({ query: 'editor', budget: 2000 })).toBe(true)
    expect(isKbContextRequest({ query: 'editor', projectId: 'p' })).toBe(true)
  })
  it('accepts a module on each filtered method', () => {
    expect(isKbTopicsRequest({ module: 'core' })).toBe(true)
    expect(isKbSearchRequest({ query: 'editor', module: 'make' })).toBe(true)
    expect(isKbContextRequest({ query: 'editor', module: 'make' })).toBe(true)
    expectTypeOf<IpcInvokeMap['kb:topics']['arg']>().toEqualTypeOf<KbTopicsRequest | void>()
    expectTypeOf<IpcInvokeMap['kb:context']['arg']>().toEqualTypeOf<KbContextRequest>()
  })
  it.each([null, 12, '', 'Core', '../core', 'core:topic', 'with space', '-core', 'core--ui'])('rejects invalid module %s', module => {
    expect(isKbTopicsRequest({ module })).toBe(false)
    expect(isKbSearchRequest({ query: 'q', module })).toBe(false)
    expect(isKbContextRequest({ query: 'q', module })).toBe(false)
  })
  it('rejects malformed payloads and preserves forward-compatible fields', () => {
    for (const value of [null, [], 'q', { scope: 'admin' }, { projectId: 42 }]) expect(isKbTopicsRequest(value)).toBe(false)
    for (const value of [{}, { query: 1 }, { query: 'q', limit: NaN }, { query: 'q', kinds: ['other'] }, { query: 'q', tags: [1] }]) expect(isKbSearchRequest(value)).toBe(false)
    expect(isKbContextRequest({ query: 'q', budget: Infinity })).toBe(false)
    expect(isKbContextRequest({ query: 'q', budget: '100' })).toBe(false)
    expect(isKbTopicsRequest({ futureOption: true })).toBe(true)
  })
})

describe('knowledge RPC boundary', () => {
  it('exposes the complete method registry and modules endpoint', () => {
    expect(Object.keys(KB_SERVICE_RPC)).toEqual(['status', 'modules', 'topics', 'document', 'search', 'context', 'write', 'delete', 'usage'])
    expect(REST.kbModules).toBe('/api/kb/modules')
    expect(REST.kbModulesReconcile).toBe('/api/kb/modules/reconcile')
    expectTypeOf<KbServiceRpcResult<'modules'>>().toEqualTypeOf<KbModule[]>()
    expectTypeOf<KbDocument['module']>().toEqualTypeOf<string | undefined>()
  })
  it('validates every method including opaque database IDs', () => {
    expect(KB_SERVICE_RPC.status(undefined)).toBe(true)
    expect(KB_SERVICE_RPC.modules({})).toBe(false)
    expect(KB_SERVICE_RPC.document({ id: 'db:opaque-id' })).toBe(true)
    expect(KB_SERVICE_RPC.delete({ id: '' })).toBe(false)
    expect(KB_SERVICE_RPC.write({ scope: 'user', title: 'Title', body: '' })).toBe(true)
    expect(KB_SERVICE_RPC.write({ scope: 'user', title: 'Title', body: '', areas: [1] })).toBe(false)
    for (const request of [
      { target: 'conversation', conversationId: 'c' }, { target: 'project', projectId: 'p' },
      { target: 'run', runId: 'r' }, { target: 'task', projectId: 'p', taskId: 't' }
    ]) expect(KB_SERVICE_RPC.usage(request)).toBe(true)
    expect(KB_SERVICE_RPC.usage({ target: 'task', taskId: 't' })).toBe(false)
    expect(KB_SERVICE_RPC.usage({ target: 'unknown' })).toBe(false)
  })
  it('dispatches validated arguments with the host viewer and propagates failures', async () => {
    const handlers: KbServiceRpcHandlers<{ userId: string }> = {
      status: vi.fn(), modules: vi.fn(async () => []), topics: vi.fn(async () => []),
      document: vi.fn(async () => null), search: vi.fn(async () => []), context: vi.fn(),
      write: vi.fn(), delete: vi.fn(), usage: vi.fn()
    }
    const dispatch = createKbServiceRpcDispatcher(handlers)
    const viewer = { userId: 'alice' }
    await expect(dispatch('modules', undefined, viewer)).resolves.toEqual([])
    await expect(dispatch('topics', undefined, viewer)).resolves.toEqual([])
    const request = { query: 'q', module: 'make' }
    await expect(dispatch('search', request, viewer)).resolves.toEqual([])
    expect(handlers.search).toHaveBeenCalledWith(request, viewer)
    await expect(dispatch('search', { query: 'q', module: '../core' }, viewer)).rejects.toThrow(TypeError)
    expect(handlers.search).toHaveBeenCalledTimes(1)
    vi.mocked(handlers.document).mockRejectedValueOnce(new Error('denied'))
    await expect(dispatch('document', { id: 'private' }, viewer)).rejects.toThrow('denied')
  })
})
