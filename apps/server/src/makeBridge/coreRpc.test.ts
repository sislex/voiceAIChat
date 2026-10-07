import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { MakeCore } from '@voicechat/make-contracts'
import { registerInternalRoutes } from '../routes/internal.js'

describe('/internal/make/core project methods', () => {
  const transfer = { targetProjectId: 'p', targetRepository: 'core-ui', title: 'Button', files: ['Button.tsx'], designConversationId: 'design' }
  const cases = [
    ['listProjects', ['alice'], []],
    ['projectStructure', ['alice', 'p'], []],
    ['projectDesign', ['alice', 'p', '.'], { tokens: [], themes: [], components: [] }],
    ['projectGit', ['alice', 'p', { op: 'push' }], { op: 'push', output: 'done' }],
    ['standPreview', ['alice', 'p', { op: 'status', subprojectPath: '.' }], { standId: 's', status: 'running', url: 'http://stand.test' }],
    ['createTransferTask', ['alice', transfer], { taskId: 't', projectId: 'p', branch: 'make/button', branchUrl: 'https://github.com/sislex/sislexa-core-ui/tree/make/button', taskUrl: '/projects/p?task=t', designUrl: '/make/design' }],
    ['standPreview', ['alice', 'p', { op: 'live_on', subprojectPath: '.', component: 'core-ui', standId: 's' }], { standId: 's', status: 'starting', url: null }],
    ['standPreview', ['alice', 'p', { op: 'live_off', subprojectPath: '.', component: 'core-ui', standId: 's' }], { standId: 's', status: 'running', url: 'http://stand.test' }]
  ] as const

  it.each(cases)('dispatches %s and preserves its result', async (method, args, result) => {
    const fn = vi.fn(async () => result)
    const token = randomUUID()
    const app = Fastify()
    registerInternalRoutes(app, { token, makeCore: { [method]: fn } as unknown as MakeCore,
      authenticate: async () => ({ ok: false, status: 401, error: 'unauthorized' }) })
    try {
      const response = await app.inject({ method: 'POST', url: '/internal/make/core', headers: { authorization: `Bearer ${token}` }, payload: { method, args } })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ result })
      expect(fn).toHaveBeenCalledWith(...args)
    } finally { await app.close() }
  })

  it.each([403, 404, 409, 503])('preserves adapter HTTP %s over RPC', async statusCode => {
    const token = randomUUID()
    const app = Fastify()
    registerInternalRoutes(app, { token, makeCore: { standPreview: async () => {
      throw Object.assign(new Error('stand_preview_unavailable'), { statusCode })
    } } as unknown as MakeCore, authenticate: async () => ({ ok: false, status: 401, error: 'unauthorized' }) })
    try {
      const response = await app.inject({ method: 'POST', url: '/internal/make/core', headers: { authorization: `Bearer ${token}` },
        payload: { method: 'standPreview', args: ['alice', 'p', { op: 'status', subprojectPath: '.' }] } })
      expect(response.statusCode).toBe(statusCode)
    } finally { await app.close() }
  })

  it('rejects unauthenticated RPC and malformed live operations', async () => {
    const fn = vi.fn()
    const token = randomUUID()
    const app = Fastify()
    registerInternalRoutes(app, { token, makeCore: { standPreview: fn } as unknown as MakeCore,
      authenticate: async () => ({ ok: false, status: 401, error: 'unauthorized' }) })
    try {
      const payload = { method: 'standPreview', args: ['alice', 'p', { op: 'live_on', component: '../secret', standId: 's', subprojectPath: '.' }] }
      expect((await app.inject({ method: 'POST', url: '/internal/make/core', payload })).statusCode).toBe(401)
      expect((await app.inject({ method: 'POST', url: '/internal/make/core', headers: { authorization: `Bearer ${token}` }, payload })).statusCode).toBe(400)
      expect(fn).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
})
