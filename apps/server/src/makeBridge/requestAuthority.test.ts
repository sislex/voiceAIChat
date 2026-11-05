import { describe, expect, it, vi } from 'vitest'
import { MakeRequestAuthority } from './requestAuthority.js'

const request = (authorization: string, method: string, url: string) => ({
  headers: { authorization },
  method,
  url,
}) as never

describe('MakeRequestAuthority', () => {
  it('accepts the exact request through a relative or absolute whoami URL', async () => {
    const authority = new MakeRequestAuthority(async id => id === 'ann' ? { name: 'ann', role: 'admin' as const } : null)

    await authority.run('ann', 'GET', '/api/projects/p1/dev-stands?all=1', async authorization => {
      await expect(authority.authenticate(request(authorization, 'GET', '/api/projects/p1/dev-stands?all=1')))
        .resolves.toEqual({ ok: true, user: { name: 'ann', role: 'admin' as const } })
      await expect(authority.authenticate(request(authorization, 'GET', 'https://kanban.internal/api/projects/p1/dev-stands?all=1')))
        .resolves.toEqual({ ok: true, user: { name: 'ann', role: 'admin' as const } })
      await expect(authority.authenticate(request(authorization, 'GET', '/api/projects/p1/dev-stands?all=2')))
        .resolves.toEqual({ ok: false, status: 403, error: 'make_request_denied' })
      await expect(authority.authenticate(request(authorization, 'POST', '/api/projects/p1/dev-stands?all=1')))
        .resolves.toEqual({ ok: false, status: 403, error: 'make_request_denied' })
    })
  })

  it('revokes the capability immediately after the request completes', async () => {
    const authority = new MakeRequestAuthority(async () => ({ name: 'ann', role: 'admin' as const }))
    let authorization = ''
    await authority.run('ann', 'GET', '/api/projects/p1/dev-stands', async value => { authorization = value })
    await expect(authority.authenticate(request(authorization, 'GET', '/api/projects/p1/dev-stands')))
      .resolves.toEqual({ ok: false, status: 403, error: 'make_request_denied' })
  })

  it('rejects an unknown capability', async () => {
    const authority = new MakeRequestAuthority(vi.fn())
    await expect(authority.authenticate(request('Bearer make_request_unknown', 'GET', '/api/projects/p1/dev-stands')))
      .resolves.toEqual({ ok: false, status: 403, error: 'make_request_denied' })
  })
})
