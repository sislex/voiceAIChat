import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { resolveMakeLocale, translateMakeSystemText, type MakeLocale } from '@voicechat/make-contracts/localization'

export function requestMakeLocale(request: Pick<FastifyRequest, 'url' | 'headers'>): MakeLocale {
  const query = new URL(request.url, 'http://make.invalid').searchParams.get('makeLocale')
  if (query === 'ru' || query === 'en') return query
  const cookie = (request.headers.cookie ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith('vc_make_locale='))?.slice('vc_make_locale='.length)
  if (cookie === 'ru' || cookie === 'en') return cookie
  return resolveMakeLocale(request.headers['accept-language'])
}

function languageHeaders(reply: FastifyReply, locale: MakeLocale): void {
  const vary = String(reply.getHeader('vary') ?? '').split(',').map((value) => value.trim()).filter(Boolean)
  if (!vary.includes('*')) for (const name of ['Accept-Language', 'Cookie']) {
    if (!vary.some((value) => value.toLowerCase() === name.toLowerCase())) vary.push(name)
  }
  reply.header('content-language', locale).header('vary', vary.includes('*') ? '*' : vary.join(', '))
}

const registered = new WeakSet<FastifyInstance>()

/** Restrict translation to Make-owned errors and diagnostics; never rewrite project or mock data. */
export function registerMakeLocalization(app: FastifyInstance): void {
  if (registered.has(app)) return
  registered.add(app)
  app.addHook('onSend', async (request, reply, payload) => {
    const path = request.routeOptions.url ?? ''
    if (!/^\/(?:api\/(?:make(?:\/|$)|preview\/make)|p\/|s\/)/.test(path) || reply.getHeader('x-vc-mock') || typeof payload !== 'string') return payload
    const locale = requestMakeLocale(request)
    const contentType = String(reply.getHeader('content-type') ?? '')
    if (contentType.includes('application/json')) {
      let body: unknown
      try { body = JSON.parse(payload) } catch { return payload }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return payload
      const result = body as Record<string, unknown>
      let changed = false
      if (reply.statusCode >= 400) {
        for (const field of ['error', 'message']) if (typeof result[field] === 'string') {
          result[field] = translateMakeSystemText(result[field], locale)
          changed = true
        }
      }
      if (path.endsWith('/check') && Array.isArray(result.issues)) {
        for (const issue of result.issues) if (issue && typeof issue.message === 'string') issue.message = translateMakeSystemText(issue.message, locale)
        changed = true
      }
      if (!changed) return payload
      languageHeaders(reply, locale)
      return JSON.stringify(result)
    }
    if (reply.statusCode >= 400 && contentType.startsWith('text/plain')) {
      languageHeaders(reply, locale)
      return translateMakeSystemText(payload, locale)
    }
    return payload
  })
}
