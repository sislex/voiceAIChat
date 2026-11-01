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
  it('opens an external application through browser login and preserves only safe return paths', async () => {
    const app = Fastify()
    app.addHook('preHandler', async req => { if (req.headers.authorization === 'Bearer user') req.user = { name: 'alice', role: 'admin' } })
    registerApplicationTickets(app, {
      manifest: { coreId: 'core-a', applications: parseApplications('storage=https://storage.example.org') },
      credentials: { storage: 'storage-secret' }
    })
    try {
      const login = await app.inject('/applications/storage/open?return=%2Ffiles%2Frecent')
      expect(login.statusCode).toBe(302)
      expect(login.headers.location).toBe('/login/?next=%2Fapplications%2Fstorage%2Fopen%3Freturn%3D%252Ffiles%252Frecent')

      const opened = await app.inject({ url: '/applications/storage/open?return=%2Ffiles%2Frecent', headers: { authorization: 'Bearer user' } })
      expect(opened.statusCode).toBe(302)
      const target = new URL(opened.headers.location!)
      expect(target.origin).toBe('https://storage.example.org')
      expect(target.pathname).toBe('/_sislexa/enter')
      expect(target.searchParams.get('core')).toBe('core-a')
      expect(target.searchParams.get('ticket')).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(target.searchParams.get('return')).toBe('/files/recent')

      for (const unsafe of ['https://evil.example/x', '//evil.example/x', '/safe//evil', String.raw`/safe\\evil`]) {
        const response = await app.inject({ url: `/applications/storage/open?return=${encodeURIComponent(unsafe)}`, headers: { authorization: 'Bearer user' } })
        expect(new URL(response.headers.location!).searchParams.get('return')).toBe('/')
      }
      expect((await app.inject({ url: '/applications/make/open', headers: { authorization: 'Bearer user' } })).statusCode).toBe(404)
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
