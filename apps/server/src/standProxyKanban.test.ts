import { expect, it, vi } from 'vitest'
import { MakeRequestAuthority } from './makeBridge/requestAuthority.js'
import { standProxyKanban } from './standProxyKanban.js'

it('reads the encoded stand detail on behalf of the exact user and revokes the capability', async () => {
  const authority = new MakeRequestAuthority(async name => ({ name, role: 'admin' }))
  let token = ''
  const url = '/api/projects/p%2Fx/dev-stands/s%2Fx'
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    expect(input).toBe('http://kanban' + url)
    expect(init?.redirect).toBe('error')
    token = (init?.headers as Record<string, string>).authorization!
    expect(await authority.authenticate({ method: 'GET', url, headers: { authorization: token } })).toMatchObject({ ok: true, user: { name: 'alice' } })
    expect(await authority.authenticate({ method: 'GET', url: '/other', headers: { authorization: token } })).toMatchObject({ ok: false })
    return Response.json({ standId: 's/x', machineId: 'machine', gateway: { port: 24019, urls: [] } })
  })
  await expect(standProxyKanban('http://kanban/', authority, fetchImpl)('alice', 'p/x', 's/x')).resolves.toEqual({ machineId: 'machine', gatewayPort: 24019 })
  expect(await authority.authenticate({ method: 'GET', url, headers: { authorization: token } })).toMatchObject({ ok: false })
})

it('rejects missing, mismatched and malformed targets and unavailable Kanban', async () => {
  const authority = new MakeRequestAuthority(async name => ({ name, role: 'admin' }))
  for (const body of [null, {}, { standId: 'other', machineId: 'm', gateway: { port: 24019 } }, { standId: 's', machineId: 1, gateway: { port: 24019 } }, { standId: 's', machineId: 'm', gateway: { port: 65536 } }]) {
    await expect(standProxyKanban('http://kanban', authority, async () => Response.json(body))('u', 'p', 's')).rejects.toMatchObject({ statusCode: 502, message: 'invalid_stand_response' })
  }
  await expect(standProxyKanban(undefined, authority)('u', 'p', 's')).rejects.toMatchObject({ statusCode: 503 })
  await expect(standProxyKanban('http://kanban', authority, async () => { throw new Error('offline') })('u', 'p', 's')).rejects.toMatchObject({ statusCode: 503 })
  await expect(standProxyKanban('http://kanban', authority, async () => new Response('', { status: 404 }))('u', 'p', 's')).rejects.toMatchObject({ statusCode: 404, message: 'stand_not_found' })
})
