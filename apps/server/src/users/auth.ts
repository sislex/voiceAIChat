// Аутентификация запросов приложения (web). Глобальный preHandler защищает
// /api/* (кроме публичных путей) по Bearer-токену; роль и блокировка берутся из
// БД (таблица users). Плюс роуты сессии (login/me/logout) и guard requireAdmin.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { SlidingWindowLimiter } from '../make/rateLimit.js'

/** По имени — 10 за 10 минут; по IP — 30: за одним NAT сидит офис, и чужой брутфорс не должен запирать всех. */
const LOGIN_LIMIT = 10
const LOGIN_IP_LIMIT = 30
const LOGIN_WINDOW_MS = 10 * 60_000
import { REST, type SessionUser, SESSION_TTL_MS } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import { newSessionId, signToken, verifyToken, verifyTokenName } from './accounts.js'

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

export type ProjectPermission =
  | 'project:view'
  | 'task:create'
  | 'task:update'
  | 'workflow:start'
  | 'task:merge'
  | 'release:prepare'
  | 'production:deploy'
  | 'users:manage'
  | 'project:settings'

const DEVELOPER_PERMISSIONS = new Set<ProjectPermission>([
  'project:view', 'task:create', 'task:update', 'workflow:start', 'task:merge'
])

/** Централизованная матрица проектных полномочий; admin разрешены и будущие действия. */
export function hasProjectPermission(role: SessionUser['role'], permission: ProjectPermission): boolean {
  return role === 'admin' || (role === 'developer' && DEVELOPER_PERMISSIONS.has(permission))
}

/** Fastify guard для проектных операций. Аутентификацию раньше проверяет глобальный hook. */
export function requireProjectPermission(permission: ProjectPermission) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!req.user || !hasProjectPermission(req.user.role, permission)) {
      await reply.code(403).send({ error: 'forbidden', permission })
    }
  }
}

/** Guard «только admin» для административных роутов. */
export const requireAdmin = requireProjectPermission('users:manage')

/** Единая классификация защищённых HTTP-операций; маршруты не дублируют матрицу ролей. */
export function projectPermissionForRequest(method: string, url: string): ProjectPermission | null {
  if (url.startsWith('/api/admin/')) return 'users:manage'
  if (/^\/api\/projects\/[^/]+\/machines\/available$/.test(url)) return 'project:settings'
  if (method === 'GET') return null
  if (/^\/api\/projects\/[^/]+\/releases\/deploy$/.test(url)) return 'production:deploy'
  if (/^\/api\/projects\/[^/]+\/releases(?:\/|$)/.test(url)) return 'release:prepare'
  if (/^\/api\/projects\/[^/]+\/tasks\/[^/]+\/merge$/.test(url) || /^\/api\/merge\/runs\/[^/]+\/retry$/.test(url)) return 'task:merge'
  if (/\/ci\/run(?:-on-machine)?$/.test(url) || /^\/api\/ci\/runs\/[^/]+\/(?:retry|retry-from-step|discard-and-retry)$/.test(url)) return 'workflow:start'
  if (method === 'POST' && /^\/api\/projects\/[^/]+\/tasks$/.test(url)) return 'task:create'
  if (method === 'PATCH' && /^\/api\/projects\/[^/]+\/tasks\/[^/]+$/.test(url)) return 'task:update'
  // Состав и роли участников проверяются проектной ролью owner в БД. Глобальный
  // admin сам по себе не получает эти права, а owner не обязан быть admin.
  if (url === '/api/projects' || /^\/api\/projects\/[^/]+$/.test(url) || /^\/api\/projects\/[^/]+\/(?:members|machines|default-machine|columns)(?:\/|$)/.test(url)) return 'project:settings'
  return null
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
  // Точный путь прокси плюс сброс cookie-контейнера превью (кнопка «Сессия» Reader).
  // Превью и экспорт Make лежат под тем же префиксом: iframe и ссылка «Скачать» шлют только cookie.
  if (url !== PREVIEW_COOKIE_PATH && url !== PREVIEW_COOKIE_PATH + '/reset-cookies' && !url.startsWith(PREVIEW_COOKIE_PATH + '/make')) return undefined
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

/**
 * Как `resolveUser`, но с учётом отзыва токена и таблицы сессий (auth-roadmap п.4) — для WS и любых мест вне preHandler.
 * Ленивую регистрацию старых токенов не делает: это забота HTTP-входа, WS всегда идёт после него.
 */
export function resolveActiveUser(db: VoiceChatDb, token: string | undefined, secret: string): SessionUser | null {
  if (!token || db.isSessionRevoked(token)) return null
  const parsed = verifyToken(token, secret)
  if (!parsed) return null
  if (parsed.sid) {
    const s = db.getSession(parsed.sid)
    if (s ? s.expiresAt < Date.now() : db.hasSessionRow(parsed.sid)) return null
  }
  return resolveUser(db, token, secret)
}

export function registerAuth(app: FastifyInstance, db: VoiceChatDb, secret: string): void {
  app.decorateRequest('user', null)
  // Сессии (auth-roadmap п.4): токен действителен, пока есть живая запись в `sessions` (не отозвана, не истекла).
  // Токены без записи (выданы до таблицы) регистрируются лениво — так старые входы не рвутся при обновлении.
  const activeUser = (token: string | undefined): SessionUser | null => {
    if (!token || db.isSessionRevoked(token)) return null
    const parsed = verifyToken(token, secret)
    if (!parsed) return null
    if (parsed.sid) {
      const s = db.getSession(parsed.sid)
      if (s) { if (s.expiresAt < Date.now()) return null; db.touchSession(parsed.sid, SESSION_TTL_MS) }
      else if (db.hasSessionRow(parsed.sid)) return null // отозвана или истекла
      else if (db.getUser(parsed.name)) db.createSession(parsed.sid, parsed.name, { ip: '', userAgent: 'legacy', ttlMs: SESSION_TTL_MS })
    }
    return resolveUser(db, token, secret)
  }
  const sidOf = (req: FastifyRequest): string | null => verifyToken(bearer(req), secret)?.sid ?? null
  db.pruneSessions()

  app.addHook('preHandler', async (req, reply) => {
    const url = req.url.split('?')[0]
    if (!url.startsWith('/api/')) return // статика/SPA/ws — не трогаем
    if (isPublic(url)) return
    const user = activeUser(bearer(req) ?? previewSession(req, url))
    if (!user) {
      await reply.code(401).send({ error: 'unauthorized' })
      return reply
    }
    req.user = user
    const permission = projectPermissionForRequest(req.method, url)
    if (permission) {
      const projectId = /^\/api\/projects\/([^/]+)/.exec(url)?.[1]
      const ownerPermission =
        permission === 'project:settings' ||
        permission === 'release:prepare' ||
        permission === 'production:deploy'
      // Проектные owner-права берутся только из project_members. Это разрешает
      // каждому владельцу критические операции независимо от глобальной роли и
      // не превращает глобального admin во владельца чужого проекта.
      const allowed = ownerPermission && projectId
        ? db.isProjectOwner(user.name, decodeURIComponent(projectId))
        : hasProjectPermission(user.role, permission)
      if (!allowed) {
        await reply.code(403).send({ error: 'forbidden', permission })
        return reply
      }
    }
  })

  // Rate-limit входа (auth-roadmap п.1): 10 попыток за 10 минут отдельно по IP и по имени; успешный вход счётчик не сбрасывает —
  // окно скользящее, и брутфорс с одного адреса упирается в 429 независимо от того, угадал ли он пароль по пути.
  const loginByIp = new SlidingWindowLimiter(LOGIN_IP_LIMIT, LOGIN_WINDOW_MS)
  const loginByName = new SlidingWindowLimiter(LOGIN_LIMIT, LOGIN_WINDOW_MS)
  app.decorate('resetLoginLimiters', () => { loginByIp.reset(); loginByName.reset() })
  app.post<{ Body: { name?: string; password?: string } }>(
    REST.sessionLogin,
    async (req, reply) => {
      const { name, password } = req.body ?? {}
      const byIp = loginByIp.hit(req.ip)
      const byName = name ? loginByName.hit(name.trim().toLowerCase()) : { ok: true, remaining: LOGIN_LIMIT, retryAfterSec: 0 }
      if (!byIp.ok || !byName.ok) {
        const retry = Math.max(byIp.retryAfterSec, byName.retryAfterSec)
        return reply.code(429).header('retry-after', String(retry)).send({ error: `Слишком много попыток входа — подождите ${retry} с`, retryAfterSec: retry })
      }
      // Блокировка после неудач (auth-roadmap п.3): пока действует замок, пароль даже не проверяем — ответ одинаковый.
      const existing = name ? db.getUser(name) : null
      if (existing?.lockedUntil && existing.lockedUntil > Date.now()) {
        const retry = Math.max(1, Math.ceil((existing.lockedUntil - Date.now()) / 1000))
        return reply.code(423).header('retry-after', String(retry)).send({ error: `Вход временно закрыт после неудачных попыток — попробуйте через ${Math.ceil(retry / 60)} мин`, retryAfterSec: retry })
      }
      const u = name ? db.verifyUserPassword(name, password ?? '') : null
      if (!u) {
        if (existing) {
          const state = db.recordLoginFailure(existing.name)
          if (state?.blocked && !existing.blocked) app.log.warn({ user: existing.name, ip: req.ip }, 'auth: аккаунт заблокирован автоматически после неудачных входов')
          else if (state?.lockedUntil) app.log.warn({ user: existing.name, ip: req.ip, until: state.lockedUntil }, 'auth: временный замок после неудачных входов')
        }
        return reply.code(401).send({ error: 'неверный логин или пароль' })
      }
      if (u.blocked) return reply.code(403).send({ error: u.lockReason === 'auto' ? 'учётная запись заблокирована после многократных неудачных входов — обратитесь к администратору' : 'учётная запись заблокирована' })
      db.resetLoginFailures(u.name)
      loginByName.forget(u.name.trim().toLowerCase())
      const user: SessionUser = { name: u.name, role: u.role }
      const sid = newSessionId()
      const token = signToken(user, secret, sid)
      db.createSession(sid, u.name, { ip: req.ip, userAgent: String(req.headers['user-agent'] ?? ''), ttlMs: SESSION_TTL_MS })
      reply.header('set-cookie', previewCookie(token))
      return { token, user }
    }
  )

  // Выпускает preview-cookie из действующего Bearer-токена. Login покрывает только
  // свежий вход; сессии из localStorage (и после перезапуска браузера — cookie
  // сессионная) без этого роута остаются без cookie, и iframe получает 401.
  // Путь публичный (префикс /api/session/), поэтому Bearer проверяется здесь.
  app.post(REST.sessionPreview, async (req, reply) => {
    const user = activeUser(bearer(req))
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    reply.header('set-cookie', previewCookie(signToken(user, secret)))
    return { ok: true }
  })

  app.get(REST.sessionMe, async (req) => {
    const user = activeUser(bearer(req))
    return user ? { user } : { user: null }
  })

  app.post(REST.sessionLogout, async (req, reply) => {
    const token = bearer(req)
    if (!activeUser(token)) return reply.code(401).send({ error: 'unauthorized' })
    db.revokeSession(token!)
    const sid = sidOf(req)
    if (sid) db.revokeSessionById(sid)
    reply.header('set-cookie', previewCookie('', 0))
    return { ok: true }
  })

  // Сессии пользователя (auth-roadmap п.4): список, «выйти везде» (кроме текущей), отзыв одной.
  app.get(REST.sessionList, async (req, reply) => {
    const user = activeUser(bearer(req))
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const current = sidOf(req)
    return { sessions: db.listSessions(user.name).map((s) => ({ ...s, current: s.sid === current })) }
  })
  app.post(REST.sessionLogoutAll, async (req, reply) => {
    const user = activeUser(bearer(req))
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    return { revoked: db.revokeUserSessions(user.name, sidOf(req)) }
  })
  app.delete<{ Params: { sid: string } }>('/api/session/:sid', async (req, reply) => {
    const user = activeUser(bearer(req))
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const s = db.getSession(req.params.sid)
    if (!s || s.user !== user.name) return reply.code(404).send({ error: 'not found' })
    db.revokeSessionById(s.sid)
    return { ok: true }
  })
}
