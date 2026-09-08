// Прокси путей Make в ядре для режима `remote`. Наружу стенд смотрит и через Caddy, и напрямую
// портом 8787 (так ходят на прод сегодня), поэтому path-routing одного Caddy недостаточно: ядро
// само переправляет запросы Make в его процесс. Пользовательская авторизация `/api/*` при этом
// срабатывает у ядра как обычно, Make перепроверяет её через `whoami` (кэш 30 с) — двойная
// проверка дешевле, чем отдельный список исключений в preHandler.
//
// Тела не разбираются: сырой буфер уходит как есть (импорт zip до 12 МБ). Ответ — статус,
// заголовки и тело целиком; потоков у Make нет (файлы проекта ≤ 2 МБ, ZIP-экспорт — в памяти).

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

/** Пути, которые в режиме `remote` обслуживает процесс Make. `/mcp/make` исполнитель зовёт напрямую. */
export const MAKE_PROXY_PREFIXES = ['/api/make', '/api/preview/make', '/api/preview/make-shared', '/p', '/s'] as const

export interface MakeProxyOptions {
  makeUrl: string
  fetchImpl?: typeof fetch
  /** Импорт ZIP шлёт base64 до 12 МБ; запас — на JSON-обёртку. */
  bodyLimit?: number
  timeoutMs?: number
}

/** Общий прокси путей соседнего сервиса (Make, канбан): тот же перенос заголовков и тела. */
export interface ServiceProxyOptions {
  /** Имя сервиса — для лога и кода ошибки `<name>_unavailable`. */
  name: string
  baseUrl: string
  prefixes: readonly string[]
  fetchImpl?: typeof fetch
  bodyLimit?: number
  timeoutMs?: number
}

/** Заголовки hop-by-hop и те, что задаёт транспорт, не пересылаются ни туда, ни обратно. */
const SKIP_REQUEST = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'upgrade', 'expect'])
// `set-cookie` fetch склеивает в одну строку — переносим отдельно через getSetCookie().
const SKIP_RESPONSE = new Set(['connection', 'content-length', 'transfer-encoding', 'content-encoding', 'keep-alive', 'set-cookie'])

export function registerMakeProxy(app: FastifyInstance, opts: MakeProxyOptions): void {
  registerServiceProxy(app, { name: 'make', baseUrl: opts.makeUrl, prefixes: MAKE_PROXY_PREFIXES, ...opts })
}

export function registerServiceProxy(app: FastifyInstance, opts: ServiceProxyOptions): void {
  const fetchImpl = opts.fetchImpl ?? fetch
  const base = opts.baseUrl.replace(/\/+$/, '')
  const forward = async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const headers = new Headers()
    for (const [name, value] of Object.entries(req.headers)) {
      if (SKIP_REQUEST.has(name) || value === undefined) continue
      for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v)
    }
    headers.set('x-forwarded-for', req.ip)
    headers.set('x-forwarded-host', String(req.headers.host ?? ''))
    headers.set('x-forwarded-proto', String(req.headers['x-forwarded-proto'] ?? req.protocol))
    const body = req.body as Buffer | undefined
    const hasBody = Boolean(body && body.length) && !['GET', 'HEAD'].includes(req.method)
    // DELETE без тела браузер шлёт с `content-type: application/json` и `content-length: 0`; fetch
    // длину не передаст, и Fastify у Make попытался бы разобрать пустой JSON — 400. Без тела нет и типа.
    if (!hasBody) headers.delete('content-type')
    let upstream: Response
    try {
      upstream = await fetchImpl(`${base}${req.url}`, {
        method: req.method,
        headers,
        body: hasBody ? new Uint8Array(body!) : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000)
      })
    } catch (error) {
      req.log.error({ err: error }, `[${opts.name}-proxy] процесс ${opts.name} недоступен`)
      return reply.code(503).send({ error: `${opts.name}_unavailable` })
    }
    reply.code(upstream.status)
    upstream.headers.forEach((value, name) => { if (!SKIP_RESPONSE.has(name)) reply.header(name, value) })
    const setCookie = upstream.headers.getSetCookie()
    if (setCookie.length) reply.header('set-cookie', setCookie)
    return reply.send(Buffer.from(await upstream.arrayBuffer()))
  }

  app.register(async (scope) => {
    // Сырое тело любого типа: сервис сам разберёт JSON, urlencoded (форма пароля публикации) и бинарь.
    scope.removeAllContentTypeParsers()
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: opts.bodyLimit ?? 16 * 1024 * 1024 }, (_req, body, done) => done(null, body))
    for (const prefix of opts.prefixes) {
      scope.all(prefix, forward)
      scope.all(`${prefix}/*`, forward)
    }
  })
}
