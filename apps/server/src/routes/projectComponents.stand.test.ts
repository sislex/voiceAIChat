import { expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { registerProjectComponentsRoutes } from './projectComponents.js'
const uuid = '11111111-1111-4111-8111-111111111111'
it.each([true, false])('opens stand Storybook with proxy enabled=%s', async enabled => {
  const app = Fastify()
  app.addHook('preHandler', async req => { req.user = { name: 'alice', role: 'developer' } as NonNullable<typeof req.user> })
  const access = vi.fn(async () => ({ url: 'http://core:24032/', expiresAt: 123 }))
  const refresh = vi.fn(async () => ({ state: 'running', port: 6008 }))
  const workspace = 'stand:' + [uuid, uuid, uuid].join('/')
  registerProjectComponentsRoutes(app, {
    git: { resolve: vi.fn(async () => ({ agentId: 'machine', path: '/live' })) } as never,
    storybook: { refresh } as never, tickets: {} as never,
    standProxy: enabled ? { access } : undefined
  })
  try {
    const response = await app.inject({ method: 'POST', url: '/api/projects/project/components/storybook/open', headers: { host: 'core:8787' }, payload: { workspace, localAgentId: 'machine' } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ kind: 'proxy', tunnelId: null })
    expect(refresh).toHaveBeenCalledWith('machine', workspace, '/live')
    if (enabled) {
      expect(response.json().url).toBe('http://core:24032/')
      expect(access).toHaveBeenCalledWith('alice', uuid, uuid, 'core:8787', 6008)
    } else {
      expect(response.json().url).toMatch(/^\/api\/preview\?url=/)
      expect(access).not.toHaveBeenCalled()
    }
  } finally { await app.close() }
})

