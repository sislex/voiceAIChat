// Аутентификация запросов приложения (web). Глобальный preHandler защищает
// /api/* (кроме публичных путей) по Bearer-токену; роль и блокировка берутся из
// БД (таблица users). Плюс роуты сессии (login/me/logout) и guard requireAdmin.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { REST, type SessionUser } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import { signToken, verifyTokenName } from './accounts.js'

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

/** Guard «только admin» для admin-роутов (вешается как preHandler). */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (req.user?.role !== 'admin') {
    await reply.code(403).send({ error: 'forbidden' })
  }
}

/** Токен из заголовка Authorization: Bearer <token>. */
function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers['authorization']
  if (typeof h !== 'string') return undefined
  const m = /^Bearer\s+(.+)$/i.exec(h)
  return m ? m[1] : undefined
}

/** Публичные пути (без токена): health, сессия, скачивание бинарей/установщиков агента. */
function isPublic(url: string): boolean {
  return (
    url === REST.health ||
    url.startsWith('/api/session/') ||
    url === REST.agentApp ||
    url === REST.agentScript ||
    url === REST.agentInstallAndroid ||
    url === REST.desktopApp ||
    url === REST.agentLatestVersion
  )
}

/** Разрешает токен в актуального пользователя БД: null, если нет/заблокирован. */
export function resolveUser(db: VoiceChatDb, token: string | undefined, secret: string): SessionUser | null {
  const name = verifyTokenName(token, secret)
  if (!name) return null
  const u = db.getUser(name)
  if (!u || u.blocked) return null
  return { name: u.name, role: u.role }
}

export function registerAuth(app: FastifyInstance, db: VoiceChatDb, secret: string): void {
  app.decorateRequest('user', null)

  app.addHook('preHandler', async (req, reply) => {
    const url = req.url.split('?')[0]
    if (!url.startsWith('/api/')) return // статика/SPA/ws — не трогаем
    if (isPublic(url)) return
    const user = resolveUser(db, bearer(req), secret)
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
      const u = name ? db.verifyUserPassword(name, password ?? '') : null
      if (!u) return reply.code(401).send({ error: 'неверный логин или пароль' })
      if (u.blocked) return reply.code(403).send({ error: 'учётная запись заблокирована' })
      const user: SessionUser = { name: u.name, role: u.role }
      return { token: signToken(user, secret), user }
    }
  )

  app.get(REST.sessionMe, async (req) => {
    const user = resolveUser(db, bearer(req), secret)
    return user ? { user } : { user: null }
  })

  app.post(REST.sessionLogout, async () => ({ ok: true }))
}
