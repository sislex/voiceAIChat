// Аутентификация запросов приложения (web). Глобальный preHandler защищает
// /api/* (кроме публичных путей) по Bearer-токену; роль и блокировка берутся из
// БД (таблица users). Плюс роуты сессии (login/me/logout) и guard requireAdmin.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { SlidingWindowLimiter } from '../make/rateLimit.js'

/** По имени — 10 за 10 минут; по IP — 30: за одним NAT сидит офис, и чужой брутфорс не должен запирать всех. */
const LOGIN_LIMIT = 10
const LOGIN_IP_LIMIT = 30
const LOGIN_WINDOW_MS = 10 * 60_000
import { REST, type SessionUser, SESSION_TTL_MS, checkPasswordPolicy } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import { newSessionId, signToken, verifyToken, verifyTokenName } from './accounts.js'
import { newTotpSecret, otpauthUrl, verifyTotp } from './totp.js'

const PREVIEW_SESSION_COOKIE = 'vc_preview_session'
const PREVIEW_COOKIE_PATH = '/api/preview'

/** Cookie-сессия (auth-roadmap п.5): HttpOnly-токен на весь /api + читаемый CSRF-токен для мутаций. */
export const SESSION_COOKIE = 'vc_session'
export const CSRF_COOKIE = 'vc_csrf'
export const CSRF_HEADER = 'x-vc-csrf'
function secureFlag(req: FastifyRequest): string {
  const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol)
  return proto === 'https' ? '; Secure' : ''
}
export function sessionCookies(req: FastifyRequest, token: string, csrf: string, maxAgeSec: number): string[] {
  return [
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secureFlag(req)}`,
    `${CSRF_COOKIE}=${csrf}; Path=/; SameSite=Strict; Max-Age=${maxAgeSec}${secureFlag(req)}`
  ]
}
export function clearSessionCookies(req: FastifyRequest): string[] {
  return [`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureFlag(req)}`, `${CSRF_COOKIE}=; Path=/; SameSite=Strict; Max-Age=0${secureFlag(req)}`]
}
function cookieOf(req: FastifyRequest, name: string): string | undefined {
  const header = req.headers.cookie
  if (typeof header !== 'string') return undefined
  for (const item of header.split(';')) { const [k, ...rest] = item.trim().split('='); if (k === name) return rest.join('=') }
  return undefined
}

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
  const tokenOf = (req: FastifyRequest): string | undefined => bearer(req) ?? cookieOf(req, SESSION_COOKIE)
  const sidOf = (req: FastifyRequest): string | null => verifyToken(tokenOf(req), secret)?.sid ?? null
  db.pruneSessions()

  app.addHook('preHandler', async (req, reply) => {
    const url = req.url.split('?')[0]
    if (!url.startsWith('/api/')) return // статика/SPA/ws — не трогаем
    if (isPublic(url)) return
    // Порядок: Bearer (desktop/агенты/старые клиенты) → cookie-сессия (web, п.5) → preview-cookie (iframe).
    // Cookie авторизует мутации только с CSRF-заголовком, равным читаемой cookie: чужой сайт cookie отправит, заголовок — нет.
    let token = bearer(req)
    let viaCookie = false
    if (!token) { token = cookieOf(req, SESSION_COOKIE); viaCookie = Boolean(token) }
    if (!token) token = previewSession(req, url)
    const user = activeUser(token)
    if (!user) {
      await reply.code(401).send({ error: 'unauthorized' })
      return reply
    }
    if (viaCookie && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const csrf = cookieOf(req, CSRF_COOKIE)
      if (!csrf || req.headers[CSRF_HEADER] !== csrf) {
        await reply.code(403).send({ error: 'csrf' })
        return reply
      }
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
  const registerLimiter = new SlidingWindowLimiter(5, 60 * 60_000)
  app.decorate('resetLoginLimiters', () => { loginByIp.reset(); loginByName.reset() })
  /** Ожидающие второго шага тикеты и незавершённые настройки 2FA — в памяти процесса, живут минуты. */
  const pendingTwoFactor = new Map<string, { name: string; expires: number; attempts: number }>()
  const pendingSetup = new Map<string, { secret: string; expires: number }>()
  const issueSession = (req: FastifyRequest, reply: FastifyReply, name: string, role: SessionUser['role']): { token: string; user: SessionUser; csrf: string } => {
    const user: SessionUser = { name, role }
    const sid = newSessionId()
    const token = signToken(user, secret, sid)
    db.createSession(sid, name, { ip: req.ip, userAgent: String(req.headers['user-agent'] ?? ''), ttlMs: SESSION_TTL_MS })
    db.logSecurityEvent({ user: name, type: 'login', ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '') })
    const csrf = newSessionId()
    reply.header('set-cookie', [previewCookie(token), ...sessionCookies(req, token, csrf, Math.floor(SESSION_TTL_MS / 1000))])
    return { token, user, csrf }
  }
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
          db.logSecurityEvent({ user: existing.name, type: state?.lockedUntil || state?.blocked ? 'login_locked' : 'login_failed', ip: req.ip, userAgent: String(req.headers['user-agent'] ?? ''), details: state?.blocked ? 'блокировка после неудач' : state?.lockedUntil ? 'временный замок' : 'неверный пароль' })
          if (state?.blocked && !existing.blocked) app.log.warn({ user: existing.name, ip: req.ip }, 'auth: аккаунт заблокирован автоматически после неудачных входов')
          else if (state?.lockedUntil) app.log.warn({ user: existing.name, ip: req.ip, until: state.lockedUntil }, 'auth: временный замок после неудачных входов')
        }
        return reply.code(401).send({ error: 'неверный логин или пароль' })
      }
      if (u.blocked) return reply.code(403).send({ error: u.lockReason === 'auto' ? 'учётная запись заблокирована после многократных неудачных входов — обратитесь к администратору' : 'учётная запись заблокирована' })
      db.resetLoginFailures(u.name)
      loginByName.forget(u.name.trim().toLowerCase())
      // 2FA (п.6): пароль верен, но сессию выдаём только после кода — клиенту уходит одноразовый тикет на 5 минут.
      if (db.getUserTotpSecret(u.name)) {
        const ticket = newSessionId()
        pendingTwoFactor.set(ticket, { name: u.name, expires: Date.now() + 5 * 60_000, attempts: 0 })
        return { requires2fa: true, ticket }
      }
      return issueSession(req, reply, u.name, u.role)
    }
  )

  // Второй шаг входа (п.6): тикет + код TOTP → полноценная сессия. Тикет одноразовый, 5 попыток.
  app.post<{ Body: { ticket?: string; code?: string } }>(REST.session2fa, async (req, reply) => {
    const { ticket, code } = req.body ?? {}
    const pending = ticket ? pendingTwoFactor.get(ticket) : undefined
    if (!pending || pending.expires < Date.now()) { if (ticket) pendingTwoFactor.delete(ticket); return reply.code(401).send({ error: 'сессия входа истекла — введите пароль ещё раз' }) }
    const secret = db.getUserTotpSecret(pending.name)
    const u = db.getUser(pending.name)
    if (!secret || !u || u.blocked) { pendingTwoFactor.delete(ticket!); return reply.code(401).send({ error: 'unauthorized' }) }
    if (!verifyTotp(secret, String(code ?? ''))) {
      pending.attempts += 1
      db.logSecurityEvent({ user: pending.name, type: 'login_2fa_failed', ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '') })
      if (pending.attempts >= 5) pendingTwoFactor.delete(ticket!)
      return reply.code(401).send({ error: 'неверный код подтверждения' })
    }
    pendingTwoFactor.delete(ticket!)
    return issueSession(req, reply, u.name, u.role)
  })
  // Настройка 2FA: setup выдаёт секрет и otpauth-ссылку (ещё не включено), enable включает после верного кода, disable — по коду.
  app.post(REST.session2faSetup, async (req, reply) => {
    const user = activeUser(tokenOf(req))
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const secretValue = newTotpSecret()
    pendingSetup.set(user.name, { secret: secretValue, expires: Date.now() + 10 * 60_000 })
    return { secret: secretValue, otpauth: otpauthUrl(user.name, secretValue), enabled: Boolean(db.getUserTotpSecret(user.name)) }
  })
  app.post<{ Body: { code?: string } }>(REST.session2faEnable, async (req, reply) => {
    const user = activeUser(tokenOf(req))
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const setup = pendingSetup.get(user.name)
    if (!setup || setup.expires < Date.now()) return reply.code(400).send({ error: 'сначала запросите новый секрет' })
    if (!verifyTotp(setup.secret, String(req.body?.code ?? ''))) return reply.code(400).send({ error: 'неверный код — проверьте время на устройстве и повторите' })
    db.setUserTotpSecret(user.name, setup.secret)
    pendingSetup.delete(user.name)
    db.logSecurityEvent({ user: user.name, type: 'twofactor_enabled', ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '') })
    app.log.info({ user: user.name }, 'auth: включён второй фактор')
    return { ok: true }
  })
  app.post<{ Body: { code?: string } }>(REST.session2faDisable, async (req, reply) => {
    const user = activeUser(tokenOf(req))
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const secretValue = db.getUserTotpSecret(user.name)
    if (!secretValue) return { ok: true }
    if (!verifyTotp(secretValue, String(req.body?.code ?? ''))) return reply.code(400).send({ error: 'неверный код' })
    db.setUserTotpSecret(user.name, null)
    db.logSecurityEvent({ user: user.name, type: 'twofactor_disabled', ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '') })
    app.log.info({ user: user.name }, 'auth: второй фактор выключен')
    return { ok: true }
  })
  app.get(REST.session2fa, async (req, reply) => {
    const user = activeUser(tokenOf(req))
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    return { enabled: Boolean(db.getUserTotpSecret(user.name)) }
  })

  // Выпускает preview-cookie из действующего Bearer-токена. Login покрывает только
  // свежий вход; сессии из localStorage (и после перезапуска браузера — cookie
  // сессионная) без этого роута остаются без cookie, и iframe получает 401.
  // Путь публичный (префикс /api/session/), поэтому Bearer проверяется здесь.
  app.post(REST.sessionPreview, async (req, reply) => {
    const user = activeUser(tokenOf(req))
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    reply.header('set-cookie', previewCookie(signToken(user, secret)))
    return { ok: true }
  })

  app.get(REST.sessionMe, async (req) => {
    const user = activeUser(tokenOf(req))
    return user ? { user } : { user: null }
  })

  app.post(REST.sessionLogout, async (req, reply) => {
    const token = tokenOf(req)
    const who = activeUser(token)
    if (!who) return reply.code(401).send({ error: 'unauthorized' })
    db.revokeSession(token!)
    const sid = sidOf(req)
    if (sid) db.revokeSessionById(sid)
    db.logSecurityEvent({ user: who.name, type: 'logout', ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '') })
    reply.header('set-cookie', [previewCookie('', 0), ...clearSessionCookies(req)])
    return { ok: true }
  })

  // Саморегистрация по инвайту (auth-roadmap п.8): проверка ссылки и создание учётки с политикой пароля → сразу сессия.
  app.get<{ Params: { token: string } }>('/api/session/invite/:token', async (req, reply) => {
    const inv = db.inviteUsable(req.params.token)
    if (!inv) return reply.code(404).send({ error: 'Приглашение недействительно или истекло' })
    return { role: inv.role, expiresAt: inv.expiresAt, note: inv.note }
  })
  app.post<{ Body: { token?: string; name?: string; password?: string } }>(REST.sessionRegister, async (req, reply) => {
    const { token, name, password } = req.body ?? {}
    if (!registerLimiter.hit(req.ip).ok) return reply.code(429).send({ error: 'Слишком много регистраций — попробуйте позже' })
    const inv = token ? db.inviteUsable(token) : null
    if (!inv) return reply.code(404).send({ error: 'Приглашение недействительно или истекло' })
    const login = (name ?? '').trim()
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(login)) return reply.code(400).send({ error: 'Логин: 3–32 символа, латиница, цифры, точка, дефис, подчёркивание' })
    if (db.getUser(login)) return reply.code(409).send({ error: 'Такой логин уже занят' })
    const violation = checkPasswordPolicy(password ?? '', { name: login })
    if (violation) return reply.code(400).send({ error: violation })
    const u = db.createUser(login, password ?? '', inv.role)
    db.consumeInvite(inv.token)
    db.logSecurityEvent({ user: login, type: 'registered', ip: req.ip, userAgent: String(req.headers['user-agent'] ?? ''), details: `по инвайту ${inv.createdBy}, роль ${inv.role}` })
    return issueSession(req, reply, u.name, u.role)
  })

  // Перенос старой localStorage-сессии в cookie (п.5): Bearer → HttpOnly cookie + CSRF, токен из localStorage клиент удаляет.
  app.post(REST.sessionCookie, async (req, reply) => {
    const token = bearer(req)
    if (!activeUser(token)) return reply.code(401).send({ error: 'unauthorized' })
    const csrf = newSessionId()
    reply.header('set-cookie', [previewCookie(token!), ...sessionCookies(req, token!, csrf, Math.floor(SESSION_TTL_MS / 1000))])
    return { ok: true, csrf }
  })

  // Сессии пользователя (auth-roadmap п.4): список, «выйти везде» (кроме текущей), отзыв одной.
  app.get(REST.sessionList, async (req, reply) => {
    const user = activeUser(tokenOf(req))
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const current = sidOf(req)
    return { sessions: db.listSessions(user.name).map((s) => ({ ...s, current: s.sid === current })) }
  })
  app.post(REST.sessionLogoutAll, async (req, reply) => {
    const user = activeUser(tokenOf(req))
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const revoked = db.revokeUserSessions(user.name, sidOf(req))
    db.logSecurityEvent({ user: user.name, type: 'logout_all', ip: req.ip, userAgent: String(req.headers['user-agent'] ?? ''), details: `отозвано сессий: ${revoked}` })
    return { revoked }
  })
  app.delete<{ Params: { sid: string } }>('/api/session/:sid', async (req, reply) => {
    const user = activeUser(tokenOf(req))
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const s = db.getSession(req.params.sid)
    if (!s || s.user !== user.name) return reply.code(404).send({ error: 'not found' })
    db.revokeSessionById(s.sid)
    return { ok: true }
  })
}
