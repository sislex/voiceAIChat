// Прозрачный Anthropic Messages API gateway для Claude Code.
// Тело запросов и ответ upstream не преобразуются (кроме опционального model map),
// поэтому сохраняются tools, thinking, prompt caching, beta-возможности и SSE.

import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { LlmClient } from '../claude/types.js'

export interface AnthropicGatewayOptions {
  backend?: 'upstream' | 'codex'
  codex?: LlmClient
  upstreamUrl?: string
  upstreamApiKey?: string
  authMode?: 'x-api-key' | 'bearer' | 'both'
  modelMap?: Record<string, string>
  fetch?: typeof globalThis.fetch
}

const ROUTES = ['/v1/messages', '/v1/messages/count_tokens'] as const
const RESPONSE_HEADERS = [
  'content-type',
  'request-id',
  'anthropic-request-id',
  'retry-after',
  'x-ratelimit-limit-requests',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-reset-requests',
  'x-ratelimit-limit-tokens',
  'x-ratelimit-remaining-tokens',
  'x-ratelimit-reset-tokens'
]

function endpointUrl(base: string, route: string): string {
  const url = new URL(base)
  const basePath = url.pathname.replace(/\/$/, '')
  url.pathname = basePath.endsWith('/v1')
    ? `${basePath}${route.slice('/v1'.length)}`
    : `${basePath}${route}`
  url.search = ''
  url.hash = ''
  return url.toString()
}

function forwardedHeaders(req: FastifyRequest, opts: AnthropicGatewayOptions): Headers {
  const headers = new Headers({ 'content-type': 'application/json' })
  for (const [name, raw] of Object.entries(req.headers)) {
    const lower = name.toLowerCase()
    if (!lower.startsWith('anthropic-') || raw === undefined) continue
    headers.set(name, Array.isArray(raw) ? raw.join(',') : String(raw))
  }
  const key = opts.upstreamApiKey
  if (key) {
    const mode = opts.authMode ?? 'x-api-key'
    if (mode === 'x-api-key' || mode === 'both') headers.set('x-api-key', key)
    if (mode === 'bearer' || mode === 'both') headers.set('authorization', `Bearer ${key}`)
  }
  return headers
}

function mappedBody(body: unknown, modelMap: Record<string, string>): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body
  const record = body as Record<string, unknown>
  const model = typeof record.model === 'string' ? modelMap[record.model] : undefined
  return model ? { ...record, model } : body
}


interface MessageBody {
  model?: string
  stream?: boolean
  system?: unknown
  messages?: unknown[]
  tools?: Array<{ name?: string; description?: string; input_schema?: unknown }>
}

type CodexResult =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input: Record<string, unknown> }

function codexPrompt(body: MessageBody): string {
  const tools = body.tools ?? []
  const toolInstruction = tools.length
    ? `\nДоступные инструменты находятся НА КОМПЬЮТЕРЕ КЛИЕНТА:\n${JSON.stringify(tools)}\n` +
      'Если для выполнения запроса нужен инструмент, выбери ровно один и верни ТОЛЬКО JSON без markdown: ' +
      '{"type":"tool_use","name":"точное имя инструмента","input":{...}}. ' +
      'Не выполняй действие своими локальными инструментами. Если инструмент не нужен, верни ТОЛЬКО JSON: ' +
      '{"type":"text","text":"твой ответ"}.'
    : '\nВерни обычный содержательный текстовый ответ.'
  return [
    'Ты являешься моделью за Anthropic Messages API для Claude Code.',
    'Следуй системным инструкциям и истории диалога. Не описывай транспортный адаптер.',
    body.system === undefined ? '' : `\nСистемные инструкции:\n${JSON.stringify(body.system)}`,
    `\nИстория сообщений:\n${JSON.stringify(body.messages ?? [])}`,
    toolInstruction
  ].join('\n')
}

function parseCodexResult(text: string, body: MessageBody): CodexResult {
  if (!body.tools?.length) return { type: 'text', text }
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const value = JSON.parse(cleaned) as Record<string, unknown>
    if (value.type === 'tool_use' && typeof value.name === 'string') {
      const allowed = body.tools.some((tool) => tool.name === value.name)
      if (allowed && value.input && typeof value.input === 'object' && !Array.isArray(value.input)) {
        return { type: 'tool_use', name: value.name, input: value.input as Record<string, unknown> }
      }
    }
    if (value.type === 'text' && typeof value.text === 'string') return { type: 'text', text: value.text }
  } catch {
    // Если Codex нарушил служебный JSON-формат, покажем его ответ как текст, не теряя данные.
  }
  return { type: 'text', text }
}

function tokenEstimate(body: unknown): number {
  return Math.max(1, Math.ceil(JSON.stringify(body ?? {}).length / 4))
}

function sse(raw: NodeJS.WritableStream, event: string, data: unknown): void {
  raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function streamResult(raw: NodeJS.WritableStream, result: CodexResult): 'end_turn' | 'tool_use' {
  if (result.type === 'tool_use') {
    sse(raw, 'content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: `toolu_${randomUUID().replaceAll('-', '')}`, name: result.name, input: {} }
    })
    sse(raw, 'content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(result.input) }
    })
    sse(raw, 'content_block_stop', { type: 'content_block_stop', index: 0 })
    return 'tool_use'
  }
  sse(raw, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  sse(raw, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: result.text } })
  sse(raw, 'content_block_stop', { type: 'content_block_stop', index: 0 })
  return 'end_turn'
}

async function handleCodex(req: FastifyRequest, reply: import('fastify').FastifyReply, codex: LlmClient) {
  const body = (req.body ?? {}) as MessageBody
  if (req.url.endsWith('/count_tokens')) return reply.send({ input_tokens: tokenEstimate(body) })

  const id = `msg_${randomUUID().replaceAll('-', '')}`
  const model = body.model || 'codex'
  const prompt = codexPrompt(body)

  if (body.stream) {
    reply.hijack()
    reply.raw.statusCode = 200
    reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8')
    reply.raw.setHeader('cache-control', 'no-cache')
    reply.raw.setHeader('connection', 'keep-alive')
    sse(reply.raw, 'message_start', {
      type: 'message_start',
      message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: tokenEstimate(body), output_tokens: 0 } }
    })
    await new Promise<void>((resolve) => {
      let text = ''
      const handle = codex.send(
        { prompt, model: '', sessionId: null, permissionMode: 'plan' },
        {
          onSession: () => {},
          // Буферизация нужна, чтобы отличить служебный JSON tool_use от обычного текста.
          onDelta: (delta) => (text += delta),
          onDone: () => {
            const result = parseCodexResult(text, body)
            const stopReason = streamResult(reply.raw, result)
            sse(reply.raw, 'message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: tokenEstimate(text) } })
            sse(reply.raw, 'message_stop', { type: 'message_stop' })
            reply.raw.end()
            resolve()
          },
          onError: (message) => {
            sse(reply.raw, 'error', { type: 'error', error: { type: 'api_error', message } })
            reply.raw.end()
            resolve()
          }
        }
      )
      req.raw.once('aborted', () => handle.cancel())
    })
    return reply
  }

  return await new Promise((resolve) => {
    let text = ''
    const handle = codex.send(
      { prompt, model: '', sessionId: null, permissionMode: 'plan' },
      {
        onSession: () => {},
        onDelta: (delta) => (text += delta),
        onDone: () => {
          const result = parseCodexResult(text, body)
          const content = result.type === 'tool_use'
            ? [{ type: 'tool_use', id: `toolu_${randomUUID().replaceAll('-', '')}`, name: result.name, input: result.input }]
            : [{ type: 'text', text: result.text }]
          resolve(reply.send({ id, type: 'message', role: 'assistant', model, content, stop_reason: result.type === 'tool_use' ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: tokenEstimate(body), output_tokens: tokenEstimate(text) } }))
        },
        onError: (message) => resolve(reply.code(502).send({ type: 'error', error: { type: 'api_error', message } }))
      }
    )
    req.raw.once('aborted', () => handle.cancel())
  })
}

export function registerAnthropicGateway(app: FastifyInstance, opts: AnthropicGatewayOptions): void {
  for (const route of ROUTES) {
    app.post(
      route,
      { bodyLimit: 64 * 1024 * 1024 },
      async (req, reply) => {
        if (opts.backend === 'codex') {
          if (!opts.codex) return reply.code(503).send({ type: 'error', error: { type: 'api_error', message: 'Codex backend не настроен' } })
          return handleCodex(req, reply, opts.codex)
        }
        if (!opts.upstreamUrl) {
          return reply.code(503).send({
            type: 'error',
            error: {
              type: 'api_error',
              message: 'Claude gateway не настроен: задайте VC_CLAUDE_UPSTREAM_URL'
            }
          })
        }

        const controller = new AbortController()
        req.raw.once('aborted', () => controller.abort())
        let upstream: Response
        try {
          upstream = await (opts.fetch ?? globalThis.fetch)(endpointUrl(opts.upstreamUrl, route), {
            method: 'POST',
            headers: forwardedHeaders(req, opts),
            body: JSON.stringify(mappedBody(req.body, opts.modelMap ?? {})),
            signal: controller.signal
          })
        } catch (error) {
          if (controller.signal.aborted) return reply
          req.log.error(error)
          return reply.code(502).send({
            type: 'error',
            error: {
              type: 'api_error',
              message: `Upstream Anthropic API недоступен: ${error instanceof Error ? error.message : String(error)}`
            }
          })
        }

        reply.code(upstream.status)
        for (const name of RESPONSE_HEADERS) {
          const value = upstream.headers.get(name)
          if (value) reply.header(name, value)
        }
        if (!upstream.body) return reply.send()
        return reply.send(Readable.fromWeb(upstream.body as never))
      }
    )
  }
}
