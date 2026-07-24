// Аутентификация запросов приложения (web). Глобальный preHandler защищает
// /api/* (кроме публичных путей) по Bearer-токену, плюс роуты сессии
// (login/me/logout). Токены — stateless HMAC (см. accounts.ts).

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { REST, type SessionUser } from '@voicechat/shared'
import { signToken, verifyCredentials, verifyToken } from './accounts.js'

declare module 'fastify' {
  interface FastifyRequest {
    /** Пользователь сессии (устанавливается preHandler для защищённых путей). */
    user: SessionUser | null
  }
}

/** id владельца данных = логин пользователя (гарантирован на защищённых роутах). */
export function uid(req: FastifyRequest): string {
  if (!req.user) throw new Error('нет аутентифицированного пользователя')
  return req.user.name
}

/** Токен из заголовка Authorization: Bearer <token>. */
function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers['authorization']
  if (typeof h !== 'string') return undefined
  const m = /^Bearer\s+(.+)$/i.exec(h)
  return m ? m[1] : undefined
}

/** Публичные пути (без токена): health, сессия, скачивание бинарей приложения. */
function isPublic(url: string): boolean {
  return (
    url === REST.health ||
    url.startsWith('/api/session/') ||
    url === REST.agentApp ||
    url === REST.agentScript ||
    url === REST.desktopApp
  )
}

export function registerAuth(app: FastifyInstance, secret: string): void {
  app.decorateRequest('user', null)

  app.addHook('preHandler', async (req, reply) => {
    const url = req.url.split('?')[0]
    if (!url.startsWith('/api/')) return // статика/SPA/ws — не трогаем
    if (isPublic(url)) return
    const user = verifyToken(bearer(req), secret)
    if (!user) {
      await reply.code(401).send({ error: 'unauthorized' })
      return reply
    }
    req.user = user
  })

  app.post<{ Body: { name?: string; password?: string } }>(
    REST.sessionLogin,
    async (req, reply) => {
      const { name, password } = req.body ?? {}
      const user = verifyCredentials(name ?? '', password ?? '')
      if (!user) return reply.code(401).send({ error: 'неверный логин или пароль' })
      return { token: signToken(user, secret), user }
    }
  )

  app.get(REST.sessionMe, async (req) => {
    const user = verifyToken(bearer(req), secret)
    return user ? { user } : { user: null }
  })

  app.post(REST.sessionLogout, async () => ({ ok: true }))
}
