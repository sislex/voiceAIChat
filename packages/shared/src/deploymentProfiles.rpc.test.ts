import { describe, it, expect } from 'vitest'
import { authorizeSharedServiceRpc, SHARED_SERVICE_RPC_ROUTES, APPLICATION_ASSISTANT_KIND } from './deploymentProfiles.js'

const make = { application: 'make' as const, userId: 'alice', tenantId: 't1' }
describe('shared service RPC authority', () => {
  it('fills and enforces the delegated user argument', () => {
    expect(authorizeSharedServiceRpc('/internal/make/core', { method: 'listProjects', args: [] }, make))
      .toEqual({ ok: true, body: { method: 'listProjects', args: ['alice'] } })
    expect(authorizeSharedServiceRpc('/internal/make/core', { method: 'project', args: ['alice', 'p1'] }, make))
      .toEqual({ ok: true, body: { method: 'project', args: ['alice', 'p1'] } })
    expect(authorizeSharedServiceRpc('/internal/make/core', { method: 'project', args: ['bob', 'p1'] }, make))
      .toMatchObject({ ok: false, status: 403, error: 'delegation_denied' })
    expect(authorizeSharedServiceRpc('/internal/make/core', { method: 'project', args: ['', 'p1'] }, { application: 'make' }))
      .toMatchObject({ ok: false, status: 401, error: 'delegation_required' })
  })
  it('fills the generate body user and refuses a foreign one', () => {
    expect(authorizeSharedServiceRpc('/internal/image-studio/generate', { prompt: 'x' }, { ...make, application: 'image-studio' }))
      .toEqual({ ok: true, body: { prompt: 'x', userId: 'alice' } })
    expect(authorizeSharedServiceRpc('/internal/image-studio/generate', { prompt: 'x', userId: 'bob' }, { ...make, application: 'image-studio' }))
      .toMatchObject({ ok: false, error: 'delegation_denied' })
  })
  it('refuses unknown methods, foreign paths and build-wide machine access', () => {
    for (const method of ['machineFs.read', 'machineFs.list', 'unknown', '__proto__', 'constructor'])
      expect(authorizeSharedServiceRpc('/internal/make/core', { method, args: [] }, make)).toMatchObject({ ok: false, error: 'method_denied' })
    expect(authorizeSharedServiceRpc('/internal/kanban/core', { method: 'machines.fsRead', args: [] }, make)).toMatchObject({ ok: false, error: 'method_denied' })
    expect(authorizeSharedServiceRpc('/internal/admin/rpc', {}, make)).toMatchObject({ ok: false, error: 'method_denied' })
    expect(authorizeSharedServiceRpc('/internal/reader/core', { method: 'listPreviews', args: [] }, { ...make, application: 'web-reader' })).toMatchObject({ ok: false })
  })
  it('accepts service and delegated authorities as documented', () => {
    expect(authorizeSharedServiceRpc('/internal/make/core', { method: 'userExists', args: ['bob'] }, { application: 'make' }).ok).toBe(true)
    expect(authorizeSharedServiceRpc('/internal/make/events', { events: [] }, { application: 'make' })).toMatchObject({ ok: false, error: 'delegation_required' })
    expect(authorizeSharedServiceRpc('/internal/make/events', { events: [] }, make).ok).toBe(true)
    expect(authorizeSharedServiceRpc('/internal/kanban/core', { method: 'kb.status', args: [] }, { application: 'projects' }).ok).toBe(true)
  })
  it('fills and enforces the user field of an object argument', () => {
    const reader = { application: 'web-reader' as const, userId: 'alice' }
    expect(authorizeSharedServiceRpc('/internal/reader/core', { method: 'context', args: [{ userId: null, conversationId: 'c1' }] }, reader))
      .toEqual({ ok: true, body: { method: 'context', args: [{ userId: 'alice', conversationId: 'c1' }] } })
    expect(authorizeSharedServiceRpc('/internal/reader/core', { method: 'logBrowserEvidence', args: [{ userId: 'bob', conversationId: 'c1' }, {}] }, reader))
      .toMatchObject({ ok: false, status: 403, error: 'delegation_denied' })
    expect(authorizeSharedServiceRpc('/internal/reader/core', { method: 'context', args: ['alice'] }, reader))
      .toMatchObject({ ok: false, status: 403, error: 'delegation_denied' })
    expect(authorizeSharedServiceRpc('/internal/reader/core', { method: 'context', args: [{ conversationId: 'c1' }] }, { application: 'web-reader' }))
      .toMatchObject({ ok: false, status: 401, error: 'delegation_required' })
    expect(authorizeSharedServiceRpc('/internal/reader/core', { method: 'projectResource', args: [{ method: 'GET', path: '/x', headers: {} }] }, reader).ok).toBe(true)
    expect(authorizeSharedServiceRpc('/internal/reader/core', { method: 'listPreviews', args: [] }, reader)).toMatchObject({ ok: false, error: 'method_denied' })
  })
  it('lets Web Reader drive the core browser only for its user', () => {
    const reader = { application: 'web-reader' as const, userId: 'alice' }
    expect(authorizeSharedServiceRpc('/internal/playwright-reader/service', { method: 'execute', args: [null, 'c1', {}] }, reader))
      .toEqual({ ok: true, body: { method: 'execute', args: ['alice', 'c1', {}] } })
    expect(authorizeSharedServiceRpc('/internal/playwright-reader/service', { method: 'control', args: ['bob', 'c1', {}] }, reader)).toMatchObject({ ok: false, status: 403 })
    expect(authorizeSharedServiceRpc('/internal/playwright-reader/service', { method: 'execute', args: [null, 'c1', {}] }, { application: 'playwright-reader', userId: 'alice' }))
      .toMatchObject({ ok: false, error: 'method_denied' })
  })
  it('limits a task-scoped (read-only) caller to the read methods', () => {
    const scoped = { ...make, readOnly: true }
    expect(authorizeSharedServiceRpc('/internal/make/core', { method: 'projectStructure', args: ['', 'p1'] }, scoped).ok).toBe(true)
    expect(authorizeSharedServiceRpc('/internal/make/core', { method: 'projectNotesUpdate', args: ['', 'p1', 'x'] }, scoped)).toMatchObject({ ok: false, status: 403, error: 'method_denied' })
    expect(authorizeSharedServiceRpc('/internal/make/core', { method: 'boardChanged', args: [] }, scoped)).toMatchObject({ ok: false, error: 'method_denied' })
    expect(authorizeSharedServiceRpc('/internal/make/events', { events: [] }, scoped)).toMatchObject({ ok: false, error: 'method_denied' })
    expect(authorizeSharedServiceRpc('/internal/image-studio/core', { method: 'conversation', args: ['', 'c1'] }, { application: 'image-studio', userId: 'alice', readOnly: true }))
      .toMatchObject({ ok: false, error: 'method_denied' })
  })
  it('maps every route to an application with an explicit authority', () => {
    for (const route of Object.values(SHARED_SERVICE_RPC_ROUTES)) expect(route.methods ?? route.body).toBeTruthy()
    expect(APPLICATION_ASSISTANT_KIND.projects).toBeUndefined()
  })
})
