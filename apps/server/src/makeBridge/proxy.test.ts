// Прокси Make в ядре: метод, путь с query, заголовки и сырое тело доезжают до процесса Make как
// есть, статус и заголовки ответа возвращаются клиенту; недоступный Make — 503, а не 500.
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerMakeProxy } from './proxy.js'

let core: FastifyInstance
let make: FastifyInstance
let seen: Array<{ method: string; url: string; headers: Record<string, unknown>; body: string }>

async function setup(makeDown = false): Promise<void> {
  seen = []
  make = Fastify()
  make.removeAllContentTypeParsers()
  make.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => done(null, body))
  make.all('/api/make/*', async (req, reply) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: String(req.body ?? '') })
    return reply.code(201).header('x-make', 'yes').header('set-cookie', 'vc_pub_x=1; Path=/').type('text/plain').send('ok:' + req.url)
  })
  make.get('/p/:token/*', async (_req, reply) => reply.type('text/html').send('<h1>pub</h1>'))
  await make.ready()
  const fetchImpl: typeof fetch = async (input, init) => {
    if (makeDown) throw new Error('ECONNREFUSED')
    const url = new URL(String(input))
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((v, k) => { headers[k] = v })
    const res = await make.inject({ method: init?.method as 'GET', url: url.pathname + url.search, headers, payload: init?.body ? Buffer.from(init.body as Uint8Array) : undefined })
    return new Response(new Uint8Array(res.rawPayload), { status: res.statusCode, headers: Object.entries(res.headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, String(x)] as [string, string]) : [[k, String(v)] as [string, string]])) })
  }
  core = Fastify()
  registerMakeProxy(core, { makeUrl: 'http://make.test/', fetchImpl })
  await core.ready()
}
afterEach(async () => { await core?.close(); await make?.close() })

describe('registerMakeProxy', () => {
  it('пересылает метод, путь с query, заголовки пользователя и сырое тело; ответ — как у Make', async () => {
    await setup()
    const res = await core.inject({
      method: 'PUT', url: '/api/make/c1/file?rev=3',
      headers: { authorization: 'Bearer t', cookie: 'vc_session=s', 'x-vc-csrf': 'c', 'content-type': 'application/json', host: 'stand.local' },
      payload: '{"path":"a.css","content":"x"}'
    })
    expect(res.statusCode).toBe(201)
    expect(res.body).toBe('ok:/api/make/c1/file?rev=3')
    expect(res.headers['x-make']).toBe('yes')
    expect(res.headers['set-cookie']).toEqual(['vc_pub_x=1; Path=/'])
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ method: 'PUT', url: '/api/make/c1/file?rev=3', body: '{"path":"a.css","content":"x"}' })
    expect(seen[0]!.headers).toMatchObject({ authorization: 'Bearer t', cookie: 'vc_session=s', 'x-vc-csrf': 'c', 'content-type': 'application/json', 'x-forwarded-host': 'stand.local' })
    expect(seen[0]!.headers.host).not.toBe('stand.local')
  })

  it('DELETE без тела уходит без content-type — иначе Fastify у Make отвечал бы 400 на пустой JSON', async () => {
    await setup()
    const res = await core.inject({ method: 'DELETE', url: '/api/make/c1/file?path=a.css', headers: { 'content-type': 'application/json', 'content-length': '0' } })
    expect(res.statusCode).toBe(201)
    expect(seen[0]!.headers['content-type']).toBeUndefined()
    expect(seen[0]!.body).toBe('')
  })

  it('публикации /p/* тоже идут в Make; чужие пути прокси не трогает', async () => {
    await setup()
    expect((await core.inject({ method: 'GET', url: '/p/tok/index.html' })).body).toBe('<h1>pub</h1>')
    expect((await core.inject({ method: 'GET', url: '/api/other' })).statusCode).toBe(404)
  })

  it('Make недоступен — 503 make_unavailable', async () => {
    await setup(true)
    const res = await core.inject({ method: 'GET', url: '/api/make/c1' })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'make_unavailable' })
  })
})
