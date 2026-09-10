import fastify, { type FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { registerPreviewProxy } from '../apps/server/src/routes/previewProxy.js'

// Только тестовые домены имеют фиксированный публичный DNS; транспорт идёт по
// явным operator aliases к локальному стенду. Реальные сайты не запрашиваются.
vi.mock('node:dns/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:dns/promises')>()
  return { ...original, lookup: async (...args: Parameters<typeof original.lookup>) => {
    if (String(args[0]).endsWith('.reader.test')) return [{ address: '93.184.216.34', family: 4 }]
    return original.lookup(...args)
  } }
})
let app: FastifyInstance, upstream: FastifyInstance, browser: Browser, page: Page, base: string, targetHost: string
let setPath = '/set', setCookies: string[] = [], redirect = false
const site = 'http://shop.reader.test'
const echo = (cookie: string | undefined) => '<!doctype html><title>Cookie QA</title><output id="cookie">' + (cookie || 'empty').replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</output>'
const open = async (url: string, server = base): Promise<string> => { await page.goto(server + '/host?target=' + encodeURIComponent(url)); const result = page.frameLocator('iframe').locator('#cookie'); await result.waitFor(); return (await result.textContent())! }
async function makeServer(): Promise<{ app: FastifyInstance; base: string }> {
  const instance = fastify()
  instance.addHook('onRequest', async req => { ;(req as unknown as { user: { name: string; role: string } }).user = { name: 'cookie-e2e', role: 'user' } })
  instance.get<{ Querystring: { target: string } }>('/host', async (req, reply) => reply.type('text/html').send('<!doctype html><iframe title="Cookie QA" src="/api/preview?url=' + encodeURIComponent(req.query.target) + '"></iframe>'))
  registerPreviewProxy(instance, {
    hostAliases: new Map(['shop.reader.test','child.shop.reader.test','other.reader.test'].map(host => [host, targetHost])),
    machines: { canUse: async () => true, bridge: { isOnline: () => true, http: async (_id, request) => ({ status: 200, headers: { 'content-type': 'text/html', 'cache-control': 'no-store', ...(request.path === setPath ? { 'Set-Cookie': setCookies } : {}) }, bodyBase64: Buffer.from(echo(request.headers?.cookie)).toString('base64') }) } }
  })
  return { app: instance, base: await instance.listen({ host: '127.0.0.1', port: 0 }) }
}

describe('Reader: cookie и цепочки авторизации в Chromium', () => {
  beforeAll(async () => {
    upstream = fastify(); upstream.all('/*', async (req, reply) => {
      reply.header('cache-control', 'no-store')
      if (req.url === setPath) reply.header('set-cookie', setCookies)
      if (redirect && req.url === '/start') return reply.code(302).header('set-cookie', 'login=redirect; Path=/').header('location', '/finish').send('')
      return reply.type('text/html').send(echo(req.headers.cookie))
    })
    targetHost = new URL(await upstream.listen({ host: '127.0.0.1', port: 0 })).host
    const server = await makeServer(); app = server.app; base = server.base; browser = await chromium.launch()
  })
  beforeEach(async () => { setPath = '/set'; setCookies = []; redirect = false; await app.inject({ method: 'POST', url: '/api/preview/reset-cookies', payload: {} }); page = await browser.newPage(); page.setDefaultTimeout(5000) })
  afterEach(async () => { await page?.close() })
  afterAll(async () => { await browser?.close(); await app?.close(); await upstream?.close() })
  it('host-only сессия не передаётся поддомену', async () => { setCookies = ['sid=host; Path=/']; await open(site + '/set'); expect(await open(site + '/echo')).toBe('sid=host'); expect(await open('http://child.shop.reader.test/echo')).toBe('empty') })
  it('Path=/app не передаётся в /apple', async () => { setCookies = ['sid=app; Path=/app']; await open(site + '/set'); expect(await open(site + '/app')).toBe('sid=app'); expect(await open(site + '/apple')).toBe('empty') })
  it('default-path авторизации включает страницу родительского пути', async () => { setPath = '/app/login'; setCookies = ['sid=default']; await open(site + setPath); expect(await open(site + '/app')).toBe('sid=default'); expect(await open(site + '/outside')).toBe('empty') })
  it('Max-Age сохраняет сессию вопреки старому Expires', async () => { setCookies = ['sid=alive; Max-Age=3600; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/']; await open(site + '/set'); expect(await open(site + '/echo')).toBe('sid=alive') })
  it('публичный суффикс не связывает разные сайты одной cookie', async () => { setCookies = ['shared=bad; Domain=test; Path=/']; await open(site + '/set'); expect(await open('http://other.reader.test/echo')).toBe('empty') })
  it('HTTPS окружения соблюдают Secure и cookie-префиксы', async () => {
    const machine = 'secure-cookie.machine.internal:5173'
    setCookies = ['__Host-good=1; Secure; Path=/','__Secure-bad=1','__Host-bad=1; Secure; Path=/nested']
    await open('https://' + machine + '/set'); expect(await open('https://' + machine + '/echo')).toBe('__Host-good=1'); expect(await open('http://' + machine + '/echo')).toBe('empty')
  })
  it('logout с Expires=epoch удаляет сохранённую сессию', async () => { setCookies = ['sid=alive; Path=/']; await open(site + '/set'); setCookies = ['sid=deleted; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT']; await open(site + '/set'); expect(await open(site + '/echo')).toBe('empty') })
  it('два Reader-сервера не используют общую авторизацию', async () => {
    setCookies = ['sid=first; Path=/']; await open(site + '/set'); const second = await makeServer()
    try { expect(await open(site + '/echo', second.base)).toBe('empty'); expect(await open(site + '/echo')).toBe('sid=first') } finally { await second.app.close() }
  })
  it('Set-Cookie от машины сохраняется независимо от регистра', async () => { const machine = 'http://case-cookie.machine.internal:5173'; setCookies = ['first=1; Path=/','second=2; Path=/']; await open(machine + '/set'); expect(await open(machine + '/echo')).toBe('first=1; second=2') })
  it('cookie промежуточного redirect доходит до конечной страницы входа', async () => { redirect = true; expect(await open(site + '/start')).toBe('login=redirect') })
})
