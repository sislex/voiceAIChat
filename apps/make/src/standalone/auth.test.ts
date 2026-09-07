// Пересылка авторизации в ядро: заголовки уходят как есть, вердикт ядра становится статусом ответа,
// чтения кэшируются по токену и классу пути, мутации — нет; недоступное ядро — 503, а не 401.
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { INTERNAL_WHOAMI_PATH, type WhoamiRequest, type WhoamiResponse } from '../internal.js'
import { registerForwardedAuth } from './auth.js'

const TOKEN = 'internal-token'
let app: FastifyInstance
let seen: WhoamiRequest[] = []
let verdict: (req: WhoamiRequest) => WhoamiResponse = () => ({ ok: true, user: { name: 'ann', role: 'developer' } })
let now = 1_000_000
let coreDown = false

async function setup(): Promise<void> {
  seen = []; coreDown = false
  app = Fastify()
  const fetchImpl: typeof fetch = async (input, init) => {
    if (coreDown) throw new Error('ECONNREFUSED')
    expect(String(input)).toBe(`http://core.test${INTERNAL_WHOAMI_PATH}`)
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`)
    const body = JSON.parse(String(init?.body)) as WhoamiRequest
    seen.push(body)
    return new Response(JSON.stringify(verdict(body)), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  registerForwardedAuth(app, { coreUrl: 'http://core.test/', token: TOKEN, fetchImpl, cacheMs: 30_000, now: () => now })
  app.get('/api/make/x', async (req) => ({ user: (req as unknown as { user: unknown }).user }))
  app.put('/api/make/x', async (req) => ({ user: (req as unknown as { user: unknown }).user }))
  app.get('/api/preview/make/x/index.html', async (req) => ({ user: (req as unknown as { user: unknown }).user }))
  app.get('/p/token/index.html', async () => ({ public: true }))
  await app.ready()
}
afterEach(async () => { await app?.close() })

describe('registerForwardedAuth', () => {
  it('пересылает метод, путь и cookie/Bearer/CSRF; вне /api/ не вмешивается', async () => {
    await setup()
    const res = await app.inject({ method: 'PUT', url: '/api/make/x?rev=1', headers: { cookie: 'vc_session=s1; vc_csrf=c1', 'x-vc-csrf': 'c1', authorization: 'Bearer t' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ user: { name: 'ann', role: 'developer' } })
    expect(seen).toEqual([{ method: 'PUT', url: '/api/make/x?rev=1', headers: { cookie: 'vc_session=s1; vc_csrf=c1', authorization: 'Bearer t', 'x-vc-csrf': 'c1' } }])
    expect((await app.inject({ method: 'GET', url: '/p/token/index.html' })).json()).toEqual({ public: true })
    expect(seen).toHaveLength(1)
  })

  it('вердикт ядра становится ответом: 401/403 с тем же текстом', async () => {
    await setup()
    verdict = () => ({ ok: false, status: 403, error: 'csrf' })
    const res = await app.inject({ method: 'PUT', url: '/api/make/x', headers: { cookie: 'vc_session=s1' } })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'csrf' })
    verdict = () => ({ ok: false, status: 401, error: 'unauthorized' })
    expect((await app.inject({ method: 'GET', url: '/api/make/x' })).statusCode).toBe(401)
    verdict = () => ({ ok: true, user: { name: 'ann', role: 'developer' } })
  })

  it('чтения кэшируются 30 с по токену и классу пути, мутации — каждый раз; отказ не кэшируется', async () => {
    await setup()
    const h = { authorization: 'Bearer t' }
    await app.inject({ method: 'GET', url: '/api/make/x', headers: h })
    await app.inject({ method: 'GET', url: '/api/make/x?other=1', headers: h })
    expect(seen).toHaveLength(1)
    // Превью — другой класс пути (у ядра там действует preview-cookie): свой ключ.
    await app.inject({ method: 'GET', url: '/api/preview/make/x/index.html', headers: h })
    expect(seen).toHaveLength(2)
    // Другой токен — другой ключ.
    await app.inject({ method: 'GET', url: '/api/make/x', headers: { authorization: 'Bearer other' } })
    expect(seen).toHaveLength(3)
    // Мутации — без кэша.
    await app.inject({ method: 'PUT', url: '/api/make/x', headers: h })
    await app.inject({ method: 'PUT', url: '/api/make/x', headers: h })
    expect(seen).toHaveLength(5)
    // Срок кэша вышел — спрашиваем снова.
    now += 30_001
    await app.inject({ method: 'GET', url: '/api/make/x', headers: h })
    expect(seen).toHaveLength(6)
    // Отказ не кэшируется: следующий запрос снова идёт в ядро.
    verdict = () => ({ ok: false, status: 401, error: 'unauthorized' })
    await app.inject({ method: 'GET', url: '/api/make/x', headers: { authorization: 'Bearer bad' } })
    await app.inject({ method: 'GET', url: '/api/make/x', headers: { authorization: 'Bearer bad' } })
    expect(seen).toHaveLength(8)
    verdict = () => ({ ok: true, user: { name: 'ann', role: 'developer' } })
  })

  it('ядро недоступно — 503 core_unavailable, а не 401', async () => {
    await setup()
    coreDown = true
    const res = await app.inject({ method: 'GET', url: '/api/make/x', headers: { authorization: 'Bearer t' } })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'core_unavailable' })
  })
})
