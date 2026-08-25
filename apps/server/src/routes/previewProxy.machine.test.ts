// Loopback-мост машин в /api/preview: виртуальный host <agentId>.machine.internal
// доставляется компаньон-агентом, ответ проходит общий rewrite и cookie-контейнер.

import { describe, expect, it } from 'vitest'
import fastify from 'fastify'
import type { AgentHttpRequest, AgentHttpResponse } from '@voicechat/shared'
import { machineAgentIdOf, registerPreviewProxy, type PreviewMachineBridge } from './previewProxy.js'

interface BridgeCall { agentId: string; request: AgentHttpRequest }

function makeBridge(handler: (call: BridgeCall) => AgentHttpResponse | Error): PreviewMachineBridge & { calls: BridgeCall[]; offline?: boolean } {
  const bridge = {
    calls: [] as BridgeCall[],
    offline: false,
    isOnline: (_agentId: string) => !bridge.offline,
    http: (agentId: string, request: AgentHttpRequest) => {
      const call = { agentId, request }
      bridge.calls.push(call)
      const result = handler(call)
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
    }
  }
  return bridge
}

async function makeApp(bridge: PreviewMachineBridge, canUse = (_userId: string, _agentId: string) => true, withDeps = true) {
  const app = fastify()
  app.addHook('onRequest', async (req) => {
    ;(req as unknown as { user: { name: string; role: string } }).user = { name: 'alice', role: 'admin' }
  })
  registerPreviewProxy(app, withDeps ? { machines: { bridge, canUse } } : {})
  await app.ready()
  return app
}

const html = (body: string): AgentHttpResponse => ({
  status: 200,
  headers: { 'content-type': 'text/html; charset=utf-8' },
  bodyBase64: Buffer.from(body).toString('base64')
})

describe('machineAgentIdOf', () => {
  it('распознаёт только точную форму <agentId>.machine.internal', () => {
    expect(machineAgentIdOf('agent-1.machine.internal')).toBe('agent-1')
    expect(machineAgentIdOf('machine.internal')).toBeNull()
    expect(machineAgentIdOf('a.b.machine.internal')).toBeNull()
    expect(machineAgentIdOf('example.com')).toBeNull()
  })
})

describe('/api/preview через мост машины', () => {
  it('доставляет запрос агенту и переписывает относительные ссылки на machine-host', async () => {
    const bridge = makeBridge(() => html('<html><body><a href="/page">Раздел</a><h1>Dev</h1></body></html>'))
    const app = await makeApp(bridge)
    const res = await app.inject({ method: 'GET', url: '/api/preview?url=' + encodeURIComponent('http://agent-1.machine.internal:5173/?a=1') })
    expect(res.statusCode).toBe(200)
    expect(bridge.calls[0]).toMatchObject({ agentId: 'agent-1', request: { method: 'GET', port: 5173, path: '/?a=1' } })
    expect(res.body).toContain('/api/preview?url=' + encodeURIComponent('http://agent-1.machine.internal:5173/page'))
    // Инъецированный DOM-мост присутствует: open/read/find работают в окружении.
    expect(res.body).toContain('voicechat-preview-inspector')
    await app.close()
  })

  it('редирект окружения на 127.0.0.1 возвращается на мост той же машины', async () => {
    const bridge = makeBridge(({ request }) =>
      request.path === '/'
        ? { status: 302, headers: { location: 'http://127.0.0.1:5173/login' }, bodyBase64: '' }
        : html('<h1>Login</h1>')
    )
    const app = await makeApp(bridge)
    const res = await app.inject({ method: 'GET', url: '/api/preview?url=' + encodeURIComponent('http://agent-1.machine.internal:5173/') })
    expect(res.statusCode).toBe(200)
    expect(bridge.calls.map((c) => c.request.path)).toEqual(['/', '/login'])
    expect(res.body).toContain('Login')
    await app.close()
  })

  it('cookie окружения живёт в серверном контейнере: логин сохраняет сессию', async () => {
    const bridge = makeBridge(({ request }) => {
      if (request.method === 'POST') {
        return { status: 200, headers: { 'content-type': 'text/html', 'set-cookie': 'sid=test-user; Path=/' }, bodyBase64: Buffer.from('ok').toString('base64') }
      }
      const cookie = request.headers.cookie
      return html(cookie ? `<p>session:${String(cookie)}</p>` : '<p>anonymous</p>')
    })
    const app = await makeApp(bridge)
    await app.inject({ method: 'POST', url: '/api/preview?url=' + encodeURIComponent('http://agent-1.machine.internal:5173/login'), payload: 'login=tester', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    const res = await app.inject({ method: 'GET', url: '/api/preview?url=' + encodeURIComponent('http://agent-1.machine.internal:5173/profile') })
    expect(res.body).toContain('session:sid=test-user')
    await app.close()
  })

  it('чужая машина → 403, офлайн → 502, без моста → 502', async () => {
    const denied = await makeApp(makeBridge(() => html('x')), () => false)
    const forbidden = await denied.inject({ method: 'GET', url: '/api/preview?url=' + encodeURIComponent('http://agent-1.machine.internal:5173/') })
    expect(forbidden.statusCode).toBe(403)
    await denied.close()

    const offlineBridge = makeBridge(() => html('x'))
    offlineBridge.offline = true
    const offline = await makeApp(offlineBridge)
    const down = await offline.inject({ method: 'GET', url: '/api/preview?url=' + encodeURIComponent('http://agent-1.machine.internal:5173/') })
    expect(down.statusCode).toBe(502)
    expect(down.json()).toMatchObject({ error: 'preview_unavailable' })
    await offline.close()

    const noDeps = await makeApp(makeBridge(() => html('x')), () => true, false)
    const unsupported = await noDeps.inject({ method: 'GET', url: '/api/preview?url=' + encodeURIComponent('http://agent-1.machine.internal:5173/') })
    expect(unsupported.statusCode).toBe(502)
    await noDeps.close()
  })

  it('редирект окружения на внешний адрес не следуется молча', async () => {
    const bridge = makeBridge(() => ({ status: 302, headers: { location: 'https://evil.example/' }, bodyBase64: '' }))
    const app = await makeApp(bridge)
    const res = await app.inject({ method: 'GET', url: '/api/preview?url=' + encodeURIComponent('http://agent-1.machine.internal:5173/') })
    expect(res.statusCode).toBe(502)
    expect(res.json().message).toContain('наружу')
    await app.close()
  })
})

describe('https-окружения и сброс cookie', () => {
  it('https-адрес машины передаёт агенту protocol https и порт 443 по умолчанию', async () => {
    const bridge = makeBridge(() => html('<h1>Secure dev</h1>'))
    const app = await makeApp(bridge)
    const res = await app.inject({ method: 'GET', url: '/api/preview?url=' + encodeURIComponent('https://agent-1.machine.internal/secure') })
    expect(res.statusCode).toBe(200)
    expect(bridge.calls[0]?.request).toMatchObject({ protocol: 'https', port: 443, path: '/secure' })
    await app.close()
  })

  it('POST /api/preview/reset-cookies очищает сессии окружений пользователя', async () => {
    const bridge = makeBridge(({ request }) => {
      if (request.method === 'POST') {
        return { status: 200, headers: { 'set-cookie': 'sid=alive; Path=/' }, bodyBase64: Buffer.from('ok').toString('base64') }
      }
      return html(request.headers.cookie ? '<p>session</p>' : '<p>anonymous</p>')
    })
    const app = await makeApp(bridge)
    const machineUrl = (path: string): string => '/api/preview?url=' + encodeURIComponent('http://agent-1.machine.internal:5173' + path)
    await app.inject({ method: 'POST', url: machineUrl('/login'), payload: 'x', headers: { 'content-type': 'text/plain' } })
    const before = await app.inject({ method: 'GET', url: machineUrl('/profile') })
    expect(before.body).toContain('session')
    const reset = await app.inject({ method: 'POST', url: '/api/preview/reset-cookies', payload: {}, headers: { 'content-type': 'application/json' } })
    expect(reset.json()).toMatchObject({ cleared: 1 })
    const after = await app.inject({ method: 'GET', url: machineUrl('/profile') })
    expect(after.body).toContain('anonymous')
    await app.close()
  })
})

describe('кэш переписанного тела', () => {
  it('conditional-заголовки браузера не уходят апстриму, а его валидаторы не возвращаются', async () => {
    // Валидаторы описывают апстримное тело; после инъекций оно другое, и 304
    // от апстрима оставлял бы в кэше браузера HTML с устаревшими шимами.
    const bridge = makeBridge(() => ({
      status: 200,
      headers: { 'content-type': 'text/html', etag: 'W/"345-upstream"', 'last-modified': 'Mon, 24 Aug 2026 00:00:00 GMT' },
      bodyBase64: Buffer.from('<h1>Dev</h1>').toString('base64')
    }))
    const app = await makeApp(bridge)
    const res = await app.inject({
      method: 'GET',
      url: '/api/preview?url=' + encodeURIComponent('http://agent-1.machine.internal:5173/'),
      headers: { 'if-none-match': 'W/"345-upstream"', 'if-modified-since': 'Mon, 24 Aug 2026 00:00:00 GMT' }
    })
    expect(res.statusCode).toBe(200)
    const sent = bridge.calls[0]!.request.headers ?? {}
    expect(Object.keys(sent)).not.toContain('if-none-match')
    expect(Object.keys(sent)).not.toContain('if-modified-since')
    expect(res.headers.etag).toBeUndefined()
    expect(res.headers['last-modified']).toBeUndefined()
    await app.close()
  })
})
