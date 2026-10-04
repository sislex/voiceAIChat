import compress from '@fastify/compress'
import type { FastifyInstance, FastifyReply, FastifyRequest, onSendHookHandler } from 'fastify'

const MIN_BYTES = 1024
const textOrJson = /^(?:text\/[^;]+|application\/(?:[\w.-]+\+)?json)(?:;|$)/i
const streamingPath = /\/(?:exec-stream|tunnels?|preview[^/]*|web-recorder)(?:\/|$)/i

function eligible(request: FastifyRequest, reply: FastifyReply, payload: unknown): boolean {
  const path = request.url.split('?', 1)[0]
  if (!/^\/(?:api|internal)(?:\/|$)/.test(path) || streamingPath.test(path)) return false
  if (/\/logs(?:\/|$)/.test(path) && new URL(request.url, 'http://core').searchParams.has('follow')) return false
  if (request.headers.upgrade || request.headers.range || reply.statusCode === 206 ||
      reply.hasHeader('content-range') || reply.hasHeader('content-encoding')) return false
  const type = String(reply.getHeader('content-type') ?? '')
  if (!textOrJson.test(type) || /^text\/event-stream(?:;|$)/i.test(type)) return false
  // Never consume a stream to discover its size: this also protects remote proxies.
  return (typeof payload === 'string' || Buffer.isBuffer(payload)) && Buffer.byteLength(payload) > MIN_BYTES
}

/** Register before routes, preserving their hooks and all non-compressed headers. */
export async function registerHttpCompression(app: FastifyInstance): Promise<void> {
  const hooks = (value: onSendHookHandler | onSendHookHandler[] | undefined) =>
    value ? (Array.isArray(value) ? value : [value]) : []
  const original = new WeakMap<object, Set<onSendHookHandler>>()
  // @fastify/compress installs per-route onSend hooks. Bracket its onRoute hook
  // so only compression is guarded; application hooks still run on excluded bodies.
  app.addHook('onRoute', route => { original.set(route, new Set(hooks(route.onSend))) })
  await app.register(compress, {
    global: true,
    globalDecompression: false,
    encodings: ['br', 'gzip'],
    threshold: MIN_BYTES + 1,
    customTypes: textOrJson,
    removeContentLengthHeader: true,
  })
  app.addHook('onRoute', route => {
    route.onSend = hooks(route.onSend).map(hook => {
      if (original.get(route)?.has(hook)) return hook
      return function (request, reply, payload, done) {
        if (!eligible(request, reply, payload)) return done(null, payload)
        return hook.call(this, request, reply, payload, done)
      } satisfies onSendHookHandler
    })
  })
}
