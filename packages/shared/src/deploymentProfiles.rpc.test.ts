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
  it('maps every route to an application with an explicit authority', () => {
    for (const route of Object.values(SHARED_SERVICE_RPC_ROUTES)) expect(route.methods ?? route.body).toBeTruthy()
    expect(APPLICATION_ASSISTANT_KIND.projects).toBeUndefined()
  })
})
