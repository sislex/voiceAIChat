import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { registerPreviewProxy, isPublicAddress, previewInspectorScript, rewritePreviewBody, upstreamRequestHeaders } from './previewProxy.js'
let app: FastifyInstance
beforeEach(() => { app = Fastify(); app.decorateRequest('user', null); app.addHook('preHandler', async (req, reply) => { if (!req.headers.authorization) return reply.code(401).send({error:'auth'}); (req as unknown as {user: {name: string}}).user = {name:'user'} }); registerPreviewProxy(app) })
afterEach(async () => { await app.close() })
const inj = (opts: InjectOptions) => app.inject({ ...opts, headers: {authorization:'Bearer test', ...opts.headers} })
describe('REST: preview proxy', () => {
  it('блокирует loopback и приватные сети до запроса', async () => {
    for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '::1', 'fe80::1', 'fc00::1']) expect(isPublicAddress(address)).toBe(false)
    expect(isPublicAddress('8.8.8.8')).toBe(true)
    expect((await inj({ method: 'GET', url: '/api/preview?url=http%3A%2F%2F127.0.0.1%2F' })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/api/preview?url=https%3A%2F%2Fexample.com' })).statusCode).toBe(401)
  })

  it('переписывает HTML-ссылки и убирает frame-ancestors CSP', () => {
    const html = '<meta http-equiv="Content-Security-Policy" content="frame-ancestors none"><a href="/next">next</a><img src="image.png"><script src="/app.js"></script>'
    const result = rewritePreviewBody(Buffer.from(html), 'text/html', new URL('https://site.example/base/')).toString()
    expect(result).not.toContain('Content-Security-Policy')
    expect(result).toContain('/api/preview?url=https%3A%2F%2Fsite.example%2Fnext')
    expect(result).toContain('/api/preview?url=https%3A%2F%2Fsite.example%2Fbase%2Fimage.png')
    expect(result).toContain('id="voicechat-preview-inspector"')
    expect(result.indexOf('voicechat-preview-inspector')).toBeLessThan(result.indexOf('</body>') === -1 ? result.length : result.indexOf('</body>'))
  })

  it('переписывает url() в <style>-блоках и inline style-атрибутах', () => {
    const html = '<style>.a{background:url("/bg.png")}</style><div style="background-image:url(img/x.png)">x</div>'
    const result = rewritePreviewBody(Buffer.from(html), 'text/html', new URL('https://site.example/base/')).toString()
    expect(result).toContain('url("/api/preview?url=https%3A%2F%2Fsite.example%2Fbg.png")')
    expect(result).toContain('url(&quot;/api/preview?url=https%3A%2F%2Fsite.example%2Fbase%2Fimg%2Fx.png&quot;)')
  })

  it('не пропускает наружу cookie и Authorization ChatAI, а Authorization страницы возвращает апстриму', () => {
    const headers = upstreamRequestHeaders({
      host: 'chat.example',
      cookie: 'vc_preview_session=secret',
      authorization: 'Bearer chatai-token',
      'x-preview-authorization': 'Bearer site-token',
      'content-type': 'application/json',
      'x-api-key': 'k',
      'sec-fetch-mode': 'cors',
      'accept-encoding': 'gzip',
      'x-forwarded-for': '1.2.3.4'
    })
    expect(headers).toEqual({ authorization: 'Bearer site-token', 'content-type': 'application/json', 'x-api-key': 'k' })
  })

  it('тело любого content-type принимается сырым, SSRF-граница действует и для POST', async () => {
    // Невалидный JSON не должен падать на парсере — тело уходит апстриму как есть,
    // а до апстрима запрос к приватному адресу не доходит (403, не 400/415).
    const json = await inj({ method: 'POST', url: '/api/preview?url=http%3A%2F%2F127.0.0.1%2F', payload: '{"broken', headers: { 'content-type': 'application/json' } })
    expect(json.statusCode).toBe(403)
    const beacon = await inj({ method: 'POST', url: '/api/preview?url=http%3A%2F%2F192.168.1.1%2F', payload: 'beacon-body', headers: { 'content-type': 'text/plain' } })
    expect(beacon.statusCode).toBe(403)
  })

  it('инспектор строит уникальный selector, сериализует стили и ограничивает payload', () => {
    const script = previewInspectorScript()
    expect(script).toContain('document.querySelectorAll(candidate).length===1')
    expect(script).toContain(':nth-of-type(')
    expect(script).toContain('outerHTML:el.outerHTML.slice(0,HTML_LIMIT)')
    expect(script).toContain("text:(el.innerText||el.textContent||'').trim().slice(0,TEXT_LIMIT)")
    expect(script).toContain('gridTemplateColumns:s.gridTemplateColumns')
    expect(script).toContain("document.addEventListener('click',click,true)")
    expect(script).toContain('e.stopImmediatePropagation()')
    expect(script).toContain('e.source!==parent||e.origin!==location.origin')
  })
})
