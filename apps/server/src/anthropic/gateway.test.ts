import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { registerAnthropicGateway } from './gateway'

function appWith(fetch: typeof globalThis.fetch, extra: Parameters<typeof registerAnthropicGateway>[1] = {}) {
  const app = Fastify()
  registerAnthropicGateway(app, {
    upstreamUrl: 'https://upstream.example/api',
    upstreamApiKey: 'upstream-secret',
    fetch,
    ...extra
  })
  return app
}

describe('Anthropic gateway', () => {
  it('прозрачно передаёт messages, tools и beta-заголовки, меняя только модель', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      expect(_url).toBe('https://upstream.example/api/v1/messages')
      const headers = new Headers(init?.headers)
      expect(headers.get('anthropic-version')).toBe('2023-06-01')
      expect(headers.get('anthropic-beta')).toBe('tools-2024-04-04')
      expect(headers.get('x-api-key')).toBe('upstream-secret')
      expect(headers.get('authorization')).toBeNull()
      const body = JSON.parse(String(init?.body))
      expect(body.model).toBe('upstream-sonnet')
      expect(body.tools[0].name).toBe('Bash')
      expect(body.messages[0].content[0].type).toBe('tool_result')
      return new Response(
        JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', content: [] }),
        { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_1' } }
      )
    })
    const app = appWith(fetch, { modelMap: { 'claude-sonnet-4-6': 'upstream-sonnet' } })
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: {
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'tools-2024-04-04',
        authorization: 'Bearer client-token'
      },
      payload: {
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        tools: [{ name: 'Bash', input_schema: { type: 'object' } }],
        messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] }]
      }
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['request-id']).toBe('req_1')
    expect(res.json().id).toBe('msg_1')
    await app.close()
  })

  it('передаёт SSE-поток Claude без изменения событий tool_use', async () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_2","type":"message","role":"assistant","content":[]}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"Bash","input":{}}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"command\\":\\"pwd\\"}"}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
      ''
    ].join('\n')
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(sse, { headers: { 'content-type': 'text/event-stream' } })
    )
    const app = appWith(fetch)
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: { model: 'm', stream: true, max_tokens: 100, messages: [] }
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')
    expect(res.body).toBe(sse)
    expect(res.body).toContain('input_json_delta')
    await app.close()
  })

  it('поддерживает count_tokens и base URL, который уже заканчивается на /v1', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
      expect(url).toBe('https://upstream.example/v1/messages/count_tokens')
      return Response.json({ input_tokens: 42 })
    })
    const app = appWith(fetch, { upstreamUrl: 'https://upstream.example/v1' })
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages/count_tokens',
      payload: { model: 'm', messages: [{ role: 'user', content: 'hello' }] }
    })
    expect(res.json()).toEqual({ input_tokens: 42 })
    await app.close()
  })

  it('возвращает Anthropic-ошибку 503, если upstream не настроен', async () => {
    const app = Fastify()
    registerAnthropicGateway(app, {})
    const res = await app.inject({ method: 'POST', url: '/v1/messages', payload: {} })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toMatchObject({ type: 'error', error: { type: 'api_error' } })
    await app.close()
  })
})
