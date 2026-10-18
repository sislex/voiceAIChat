import Fastify from 'fastify'
import { describe, it, expect } from 'vitest'
import { parseApplications } from '@voicechat/shared'
import { TrustedCoreRegistry } from '@sislexa/component-runtime'
import { ApplicationTickets, registerApplicationTickets } from './applicationTickets.js'
describe('application tickets', () => {
  it('binds core, application and user; consumes once and expires at 60 seconds', () => {
    let now = 100
    const tickets = new ApplicationTickets(() => now)
    const user = { name: 'alice', role: 'admin' as const }
    const ticket = tickets.issue('core-a', 'make', user)
    user.name = 'mutated'
    expect(() => tickets.redeem('core-b', 'make', ticket)).toThrow('ticket_invalid')
    expect(() => tickets.redeem('core-a', 'projects', ticket)).toThrow('ticket_invalid')
    expect(tickets.redeem('core-a', 'make', ticket).user.name).toBe('alice')
    expect(() => tickets.redeem('core-a', 'make', ticket)).toThrow('ticket_used')
    const expired = tickets.issue('core-a', 'make', user)
    now += 60000
    expect(() => tickets.redeem('core-a', 'make', expired)).toThrow('ticket_invalid')
  })
  it('authenticates each application before consuming tickets over HTTP', async () => {
    const app = Fastify()
    app.addHook('preHandler', async req => { if (req.headers.authorization === 'Bearer user') req.user = { name: 'alice', role: 'admin' } })
    registerApplicationTickets(app, { manifest: { coreId: 'core-a', applications: parseApplications('make=https://make.example.org,projects=https://projects.example.org') }, credentials: { make: 'make-secret', projects: 'projects-secret' } })
    try {
      expect((await app.inject({ method: 'POST', url: '/api/applications/make/enter' })).statusCode).toBe(401)
      expect((await app.inject({ method: 'POST', url: '/api/applications/chat/enter', headers: { authorization: 'Bearer user' } })).json()).toEqual({ error: 'application_disabled' })
      const issued = await app.inject({ method: 'POST', url: '/api/applications/make/enter', headers: { authorization: 'Bearer user' } })
      const url = new URL(issued.json().url)
      expect(url.origin).toBe('https://make.example.org')
      expect(url.searchParams.get('core')).toBe('core-a')
      const redeem = (token: string, application = 'make') => app.inject({ method: 'POST', url: '/internal/v1/tickets/redeem', headers: { authorization: `Bearer ${token}` }, payload: { ticket: url.searchParams.get('ticket'), application } })
      expect((await redeem('projects-secret')).statusCode).toBe(401)
      expect((await redeem('projects-secret', 'projects')).json()).toEqual({ error: 'ticket_invalid' })
      const session = (await redeem('make-secret')).json()
      expect(session.user.name).toBe('alice')
      expect(session.delegation.token).toMatch(/^sxd_/)
      expect(session.delegation.expiresAt).toBe(session.expiresAt)
      expect((await redeem('make-secret')).json()).toEqual({ error: 'ticket_used' })
    } finally { await app.close() }
  })
  it('redeems through the runtime HTTP adapter against the issuing Core routes', async () => {
    const app = Fastify()
    const tickets = new ApplicationTickets()
    registerApplicationTickets(app, { tickets, manifest: { coreId: 'core-a', applications: parseApplications('make=https://make.example.org') }, credentials: { make: 'service-secret' } })
    const transport: typeof fetch = async (input, init) => {
      const url = new URL(String(input))
      expect(url.origin).toBe('https://core.example.org')
      const result = await app.inject({ method: 'POST', url: url.pathname, headers: Object.fromEntries(new Headers(init?.headers)), payload: String(init?.body) })
      return new Response(result.body, { status: result.statusCode })
    }
    const registry = new TrustedCoreRegistry(() => 'service-secret', transport)
    registry.add({ coreId: 'core-a', url: 'https://core.example.org', credentialRef: 'private' })
    try {
      const ticket = tickets.issue('core-a', 'make', { name: 'alice', role: 'admin' })
      const session = await registry.redeem('core-a', { ticket, application: 'make' })
      expect(session.coreId).toBe('core-a'); expect(session.user.name).toBe('alice')
      await expect(registry.redeem('core-a', { ticket, application: 'make' })).rejects.toThrow('ticket_used')
    } finally { await app.close() }
  })
})
