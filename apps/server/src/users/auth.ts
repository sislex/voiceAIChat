// Аутентификация запросов приложения (web). Глобальный preHandler защищает
// /api/* (кроме публичных путей) по Bearer-токену; роль и блокировка берутся из
// БД (таблица users). Плюс роуты сессии (login/me/logout) и guard requireAdmin.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { REST, type SessionUser } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import { signToken, verifyTokenName } from './accounts.js'

const PREVIEW_SESSION_COOKIE = 'vc_preview_session'
const PREVIEW_COOKIE_PATH = '/api/preview'

function previewCookie(token: string, maxAge?: number): string {
  return `${PREVIEW_SESSION_COOKIE}=${token}; Path=${PREVIEW_COOKIE_PATH}; HttpOnly; SameSite=Strict${maxAge === undefined ? '' : `; Max-Age=${maxAge}`}`
}

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

/** Отдельная HttpOnly-cookie для same-origin iframe; на прочих API не действует. */
function previewSession(req: FastifyRequest, url: string): string | undefined {
  if (url !== PREVIEW_COOKIE_PATH) return undefined
  const header = req.headers.cookie
  if (typeof header !== 'string') return undefined
  for (const item of header.split(';')) {
    const [name, ...value] = item.trim().split('=')
    if (name === PREVIEW_SESSION_COOKIE) return value.join('=') || undefined
  }
  return undefined
}

/** Публичные пути (без токена): health, сессия, скачивание бинарей/установщиков агента. */
function isPublic(url: string): boolean {
  return (
    url === REST.health ||
    url.startsWith('/api/session/') ||
    url === REST.agentApp ||
    url === REST.agentScript ||
    url === REST.agentInstallAndroid ||
    url === REST.agentInstallWindows ||
    url === REST.agentInstallLinux ||
    url === REST.agentInstallMacos ||
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
    const user = resolveUser(db, bearer(req) ?? previewSession(req, url), secret)
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
      const token = signToken(user, secret)
      reply.header('set-cookie', previewCookie(token))
      return { token, user }
    }
  )

  // Выпускает preview-cookie из действующего Bearer-токена. Login покрывает только
  // свежий вход; сессии из localStorage (и после перезапуска браузера — cookie
  // сессионная) без этого роута остаются без cookie, и iframe получает 401.
  // Путь публичный (префикс /api/session/), поэтому Bearer проверяется здесь.
  app.post(REST.sessionPreview, async (req, reply) => {
    const user = resolveUser(db, bearer(req), secret)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    reply.header('set-cookie', previewCookie(signToken(user, secret)))
    return { ok: true }
  })

  app.get(REST.sessionMe, async (req) => {
    const user = resolveUser(db, bearer(req), secret)
    return user ? { user } : { user: null }
  })

  app.post(REST.sessionLogout, async (_req, reply) => {
    reply.header('set-cookie', previewCookie('', 0))
    return { ok: true }
  })
}
