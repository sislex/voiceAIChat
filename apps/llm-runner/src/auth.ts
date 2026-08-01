// Аутентификация исполнителя: единственный Bearer-токен на весь API.
//
// Пользователей у исполнителя нет — клиент один (сервер voicechat), и токен
// хранится в его реестре исполнителей. Поэтому не сессии, а простое сравнение.

import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'

/** Токен из заголовка `Authorization: Bearer <token>`. */
export function bearerToken(req: FastifyRequest): string | undefined {
  const header = req.headers['authorization']
  if (typeof header !== 'string') return undefined
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1] : undefined
}

/** Сравнение за постоянное время: токен долгоживущий, побайтовый подбор ему не нужен. */
export function tokenMatches(expected: string, given: string | undefined): boolean {
  if (!expected || !given) return false
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(given, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Закрывает весь `/v1/*` токеном: без верного Bearer — 401. */
export function registerRunnerAuth(app: FastifyInstance, token: string): void {
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/v1/')) return
    if (tokenMatches(token, bearerToken(req))) return
    await reply.code(401).send({ error: 'unauthorized' })
    return reply
  })
}
