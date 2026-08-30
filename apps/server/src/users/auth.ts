// Аутентификация запросов приложения (web). Глобальный preHandler защищает
// /api/* (кроме публичных путей) по Bearer-токену; роль и блокировка берутся из
// БД (таблица users). Плюс роуты сессии (login/me/logout) и guard requireAdmin.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { SlidingWindowLimiter } from '../make/rateLimit.js'

/** По имени — 10 за 10 минут; по IP — 30: за одним NAT сидит офис, и чужой брутфорс не должен запирать всех. */
const LOGIN_LIMIT = 10
const LOGIN_IP_LIMIT = 30
const LOGIN_WINDOW_MS = 10 * 60_000
import { REST, type SessionUser, type UserRole, SESSION_SHORT_TTL_MS, SESSION_TTL_MS, checkPasswordPolicy } from '@voicechat/shared'
import { deviceKey, findTrustedDevice, isNewDevice, localGeo, overLimit, parseUserAgent, type GeoResolver } from '@voicechat/sessions-core'
import { createGeoResolver } from './geo.js'
import type { VoiceChatDb } from '../db/database.js'
import { newSessionId, signToken, verifyToken, verifyTokenName } from './accounts.js'
import { newTotpSecret, otpauthUrl, verifyTotp } from './totp.js'
import { createMailer, type Mailer } from './mailer.js'
import { randomBytes } from 'node:crypto'
import type { ProjectFeature } from '@voicechat/shared'

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
/** `maxAgeSec: null` — сессионная cookie без Max-Age (живёт до закрытия браузера). */
export function sessionCookies(req: FastifyRequest, token: string, csrf: string, maxAgeSec: number | null): string[] {
  const age = maxAgeSec === null ? '' : `; Max-Age=${maxAgeSec}`
  return [
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${age}${secureFlag(req)}`,
    `${CSRF_COOKIE}=${csrf}; Path=/; SameSite=Strict${age}${secureFlag(req)}`
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
  | 'project:create'

const DEVELOPER_PERMISSIONS = new Set<ProjectPermission>([
  'project:view', 'task:create', 'task:update', 'workflow:start', 'task:merge'
])

/**
 * Полномочия, доступные любой роли. Свой проект может завести кто угодно: создатель
 * становится его владельцем (`project_members.role='owner'`), а что он вправе делать
 * внутри — по-прежнему решают DEVELOPER_PERMISSIONS и проектное владение. Раньше
 * создание попадало под `project:settings`, то есть было доступно только глобальному
 * admin, и «свой проект» получить было нельзя.
 */
const ANY_ROLE_PERMISSIONS = new Set<ProjectPermission>(['project:create'])

/** Централизованная матрица проектных полномочий; admin разрешены и будущие действия. */
export function hasProjectPermission(role: SessionUser['role'], permission: ProjectPermission): boolean {
  if (ANY_ROLE_PERMISSIONS.has(permission)) return true
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
  // Создание своего проекта доступно любой роли и обязано проверяться раньше общего
  // правила про `/api/projects` ниже: то возвращает `project:settings`, и создание
  // снова стало бы админской операцией.
  if (method === 'POST' && url === '/api/projects') return 'project:create'
  if (/^\/api\/projects\/[^/]+\/releases\/deploy$/.test(url)) return 'production:deploy'
  if (/^\/api\/projects\/[^/]+\/releases(?:\/|$)/.test(url)) return 'release:prepare'
  if (/^\/api\/projects\/[^/]+\/tasks\/[^/]+\/merge$/.test(url) || /^\/api\/merge\/runs\/[^/]+\/retry$/.test(url)) return 'task:merge'
  if (/\/ci\/run(?:-on-machine)?$/.test(url) || /^\/api\/ci\/runs\/[^/]+\/(?:retry|retry-from-step|discard-and-retry)$/.test(url)) return 'workflow:start'
  if (method === 'POST' && /^\/api\/projects\/[^/]+\/tasks$/.test(url)) return 'task:create'
  if (method === 'PATCH' && /^\/api\/projects\/[^/]+\/tasks\/[^/]+$/.test(url)) return 'task:update'
  // Состав и роли участников проверяются проектной ролью owner в БД. Глобальный
  // admin сам по себе не получает эти права, а owner не обязан быть admin.
  if (url === '/api/projects' || /^\/api\/projects\/[^/]+$/.test(url) || /^\/api\/projects\/[^/]+\/(?:members|invitations|machines|default-machine|columns)(?:\/|$)/.test(url)) return 'project:settings'
  return null
}

/**
 * Классификация URL по подсистеме проекта. Возможности задаёт ТИП проекта, и
 * скрытия в интерфейсе недостаточно: без этой карты REST по-прежнему принимал бы
 * запуск CI-рана или создание релиза в проекте, где подсистема выключена.
 *
 * Гейтятся только адреса, где проект есть в пути. URL вида `/api/ci/runs/:id/retry`
 * и `/api/qa/runs/:id` работают с уже созданным раном — их создание перекрыто выше,
 * поэтому отдельная проверка там не нужна (и негде взять projectId без запроса).
 * Чтение не отделяется от записи намеренно: в проекте без подсистемы её списки
 * бессмысленны, а UI их и не показывает.
 */
export function projectFeatureForRequest(method: string, url: string): ProjectFeature | null {
  if (!/^\/api\/projects\/[^/]+\//.test(url)) return null
  if (/^\/api\/projects\/[^/]+\/(?:releases|production)(?:\/|$)/.test(url)) return 'releases'
  if (/^\/api\/projects\/[^/]+\/(?:machines|default-machine)(?:\/|$)/.test(url)) return 'machines'
  if (/^\/api\/projects\/[^/]+\/tasks\/[^/]+\/merge(?:\/|$)/.test(url)) return 'git'
  if (/^\/api\/projects\/[^/]+\/tasks\/[^/]+\/qa(?:\/|$)/.test(url)) return 'qa'
  if (/^\/api\/projects\/[^/]+\/tasks\/[^/]+\/preview(?:\/|$)/.test(url)) return 'preview'
  if (/^\/api\/projects\/[^/]+\/(?:ci|improvements)(?:\/|$)/.test(url)) return 'ci'
  if (/^\/api\/projects\/[^/]+\/tasks\/[^/]+\/(?:ci|improvements|preparation)(?:\/|$)/.test(url)) return 'ci'
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
  return { name: u.name, role: u.role, ...(u.mustChangePassword ? { mustChangePassword: true } : {}) }
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

export interface AuthOptions {
  /** Отправка писем (регистрация с подтверждением email); без SMTP — «консольный» мейлер из createMailer. */
  mailer?: Mailer
  /** Публичный адрес приложения для ссылок в письмах; иначе берём Origin/Host запроса. */
  publicUrl?: string | null
  /** Определение места входа по IP; по умолчанию офлайн — только локальная сеть. */
  geo?: GeoResolver
}

/** Настройка открытой регистрации хранится в app_config: `signup.enabled` ('1'/'0') и `signup.role`. */
export function readSignupConfig(db: VoiceChatDb): { enabled: boolean; role: UserRole } {
  const role = db.getAppConfig('signup.role')
  return { enabled: db.getAppConfig('signup.enabled') === '1', role: role === 'admin' || role === 'developer' || role === 'tester' || role === 'observer' ? role : 'developer' }
}

/**
 * Откуда вошли. Отдельного заголовка у клиентов нет, поэтому смотрим на UA:
 * Electron-оболочка и компаньон-агент представляются явно, всё прочее — веб.
 */
function platformOf(ua: string): string {
  if (/Electron/i.test(ua)) return 'desktop'
  if (/VoiceChatAgent/i.test(ua)) return 'agent'
  const profile = parseUserAgent(ua)
  return profile.legacy ? 'unknown' : 'web'
}

/** Версия клиента, если он её сообщает: помогает отличить залипший старый бандл. */
function clientVersionOf(req: FastifyRequest): string | null {
  const raw = req.headers['x-vc-client-version']
  const value = Array.isArray(raw) ? raw[0] : raw
  return value ? String(value).slice(0, 32) : null
}

export function registerAuth(app: FastifyInstance, db: VoiceChatDb, secret: string, options: AuthOptions = {}): void {
  const mailer = options.mailer ?? createMailer({}, (m, extra) => app.log.warn(extra ?? {}, m))
  const geo = options.geo ?? createGeoResolver({
    url: process.env.VC_GEOIP_URL ?? null,
    onError: (message) => app.log.warn({ err: message }, 'geoip: место входа определить не удалось')
  })
  const baseUrl = (req: FastifyRequest): string => (options.publicUrl ?? `${String(req.headers['x-forwarded-proto'] ?? req.protocol)}://${String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost')}`).replace(/\/$/, '')
  app.decorateRequest('user', null)
  // Сессии (auth-roadmap п.4): токен действителен, пока есть живая запись в `sessions` (не отозвана, не истекла).
  // Токены без записи (выданы до таблицы) регистрируются лениво — так старые входы не рвутся при обновлении.
  const activeUser = (token: string | undefined, path?: string): SessionUser | null => {
    if (!token || db.isSessionRevoked(token)) return null
    const parsed = verifyToken(token, secret)
    if (!parsed) return null
    if (parsed.sid) {
      const s = db.getSession(parsed.sid)
      if (s) { if (s.expiresAt < Date.now()) return null; db.touchSession(parsed.sid, Math.max(SESSION_SHORT_TTL_MS, s.expiresAt - s.lastSeen), path) }
      else if (db.hasSessionRow(parsed.sid)) return null // отозвана или истекла
      else if (db.getUser(parsed.name)) db.createSession(parsed.sid, parsed.name, { ip: '', userAgent: 'legacy', ttlMs: SESSION_TTL_MS })
    }
    return resolveUser(db, token, secret)
  }
  const tokenOf = (req: FastifyRequest): string | undefined => bearer(req) ?? cookieOf(req, SESSION_COOKIE)
  /** Мутации сессионных роутов по cookie требуют CSRF (общий preHandler их не покрывает — префикс публичный). */
  const csrfOk = (req: FastifyRequest): boolean => Boolean(bearer(req)) || (Boolean(cookieOf(req, CSRF_COOKIE)) && req.headers[CSRF_HEADER] === cookieOf(req, CSRF_COOKIE))
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
    // Путь запоминаем в сессии: в списке устройств он отвечает на вопрос «а что
    // это устройство вообще делает», когда вход выглядит подозрительно.
    const user = activeUser(token, url)
    if (!user) {
      await reply.code(401).send({ error: 'unauthorized' })
      return reply
    }
    // Временный пароль (п.11): до смены пароля запрещаем всё, кроме чтения — сессионные роуты публичны и сюда не попадают.
    if (user.mustChangePassword && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      await reply.code(403).send({ error: 'password_change_required' })
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
    // Возможности типа проекта: читаются живьём, поэтому правка типа немедленно
    // закрывает подсистему и в интерфейсе, и в API.
    const feature = projectFeatureForRequest(req.method, url)
    if (feature) {
      const projectId = /^\/api\/projects\/([^/]+)/.exec(url)?.[1]
      if (projectId && !db.projectFeatures(decodeURIComponent(projectId))[feature]) {
        await reply.code(409).send({ error: 'feature_unavailable', feature })
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
  const pendingTwoFactor = new Map<string, { name: string; expires: number; attempts: number; remember: boolean }>()
  const pendingSetup = new Map<string, { secret: string; expires: number }>()
  const issueSession = async (req: FastifyRequest, reply: FastifyReply, name: string, role: SessionUser['role'], remember = true): Promise<{ token: string; user: SessionUser; csrf: string }> => {
    const row = db.getUser(name)
    const user: SessionUser = { name, role, ...(row?.mustChangePassword ? { mustChangePassword: true } : {}) }
    const sid = newSessionId()
    const token = signToken(user, secret, sid)
    // «Запомнить меня» (п.15): 30 дней и cookie с Max-Age; иначе 12 часов и сессионная cookie (умирает с браузером).
    const ttl = remember ? SESSION_TTL_MS : SESSION_SHORT_TTL_MS
    const ua = String(req.headers['user-agent'] ?? '')
    // Новое устройство (п.16): решает ядро модуля сессий по ключу устройства —
    // тот не меняется от обновления браузера и от соседнего адреса провайдера,
    // поэтому предупреждение приходит на смену устройства, а не на смену версии.
    const known = db.listSessions(name)
    const isNew = isNewDevice(known, { userAgent: ua, ip: req.ip })
    db.createSession(sid, name, {
      ip: req.ip,
      userAgent: ua,
      ttlMs: ttl,
      deviceKey: deviceKey({ userAgent: ua, ip: req.ip }),
      platform: platformOf(ua),
      clientVersion: clientVersionOf(req),
      geo: localGeo(req.ip)
    })
    // Лимит одновременных сессий: превышение гасит самые давно неактивные, но
    // никогда — только что выданную. Ноль или отсутствие настройки — без лимита.
    const limit = Number(db.getAppConfig('sessions.maxPerUser')) || 0
    for (const victim of overLimit(db.listSessions(name), limit || null, sid)) {
      db.revokeSessionById(victim.sid)
      db.logSecurityEvent({ user: name, type: 'session_evicted', ip: victim.ip, userAgent: victim.userAgent, details: `лимит ${limit} сессий` })
    }
    // Публичный адрес уточняем в фоне: вход не должен ждать внешний сервис, а
    // список сессий читают уже после — к этому моменту место обычно на месте.
    if (!localGeo(req.ip)) {
      // Резолвер по контракту ядра может быть и синхронным — приводим к промису.
      void Promise.resolve(geo.resolve(req.ip))
        .then((place) => { if (place) db.updateSession(sid, { geo: place }) })
        .catch(() => undefined)
    }
    db.markLogin(name)
    db.logSecurityEvent({ user: name, type: 'login', ip: req.ip, userAgent: ua })
    if (isNew) {
      const at = Date.now()
      db.logSecurityEvent({ user: name, type: 'login_new_device', ip: req.ip, userAgent: ua, details: 'вход с нового устройства' })
      const email = row?.email
      if (email && db.getSettings(name).loginNewDeviceEmails && db.reserveLoginDeviceEmail(name, req.ip, ua, at)) {
        const passwordLink = `${baseUrl(req)}/#/security/password`
        const sessionsLink = `${baseUrl(req)}/#/security/sessions`
        const when = `${new Date(at).toLocaleString('ru-RU', { timeZone: 'UTC' })} UTC`
        try {
          await mailer.send({
            to: email,
            subject: 'Новый вход в ChatAI',
            text: `Здравствуйте, ${name}!\n\nЗафиксирован вход с нового устройства.\nКогда: ${when}\nIP: ${req.ip}\nUser-Agent: ${ua || 'не указан'}\n\nЕсли это были не вы, смените пароль: ${passwordLink}\nИ отзовите другие сессии: ${sessionsLink}`
          })
        } catch (error) {
          app.log.error({ error, user: name }, 'auth: письмо о новом устройстве не отправлено')
        }
      }
    }
    const csrf = newSessionId()
    reply.header('set-cookie', [previewCookie(token), ...sessionCookies(req, token, csrf, remember ? Math.floor(ttl / 1000) : null)])
    return { token, user, csrf }
  }
  app.post<{ Body: { name?: string; password?: string; remember?: boolean } }>(
    REST.sessionLogin,
    async (req, reply) => {
      const { name, password } = req.body ?? {}
      const remember = req.body?.remember !== false
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
      // Исключение — устройство, которое пользователь сам пометил доверенным:
      // второй фактор защищает от входа с чужого устройства, а на своём он
      // превращается в ежедневный налог и подталкивает выключить 2FA совсем.
      if (db.getUserTotpSecret(u.name)) {
        const ua = String(req.headers['user-agent'] ?? '')
        const trusted = findTrustedDevice(db.listSessions(u.name), { userAgent: ua, ip: req.ip })
        if (!trusted) {
          const ticket = newSessionId()
          pendingTwoFactor.set(ticket, { name: u.name, expires: Date.now() + 5 * 60_000, attempts: 0, remember })
          return { requires2fa: true, ticket }
        }
      }
      return issueSession(req, reply, u.name, u.role, remember)
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
    return issueSession(req, reply, u.name, u.role, pending.remember)
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
    if (!csrfOk(req)) return reply.code(403).send({ error: 'csrf' })
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
    if (!csrfOk(req)) return reply.code(403).send({ error: 'csrf' })
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
    // Вместе с пользователем — непросмотренные уведомления безопасности (п.16): клиент покажет тостом и отметит.
    return user ? { user, notices: db.unseenSecurityNotices(user.name) } : { user: null }
  })
  app.post(REST.sessionNoticesSeen, async (req, reply) => {
    const user = activeUser(tokenOf(req))
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    if (!csrfOk(req)) return reply.code(403).send({ error: 'csrf' })
    db.markNoticesSeen(user.name)
    return { ok: true }
  })

  app.post(REST.sessionLogout, async (req, reply) => {
    const token = tokenOf(req)
    const who = activeUser(token)
    if (!who) return reply.code(401).send({ error: 'unauthorized' })
    // Выход по cookie — только с CSRF-заголовком: иначе любой запрос с приложенными браузером cookie (в т.ч. старая вкладка
    // без Bearer или чужой сайт) отзовёт общую сессию. Сессионные роуты публичны и общим preHandler не проверяются.
    if (!bearer(req)) {
      const csrf = cookieOf(req, CSRF_COOKIE)
      if (!csrf || req.headers[CSRF_HEADER] !== csrf) return reply.code(403).send({ error: 'csrf' })
    }
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

  // Сброс пароля кодом администратора (auth-roadmap п.10): без входа, код одноразовый и срочный, политика пароля та же.
  app.post<{ Body: { name?: string; code?: string; password?: string } }>(REST.sessionReset, async (req, reply) => {
    const { name, code, password } = req.body ?? {}
    if (!registerLimiter.hit(`reset:${req.ip}`).ok) return reply.code(429).send({ error: 'Слишком много попыток — попробуйте позже' })
    const login = (name ?? '').trim()
    const violation = checkPasswordPolicy(password ?? '', { name: login })
    if (violation) return reply.code(400).send({ error: violation })
    if (!login || !code || !db.redeemResetCode(login, String(code).trim(), password!)) return reply.code(401).send({ error: 'Неверный логин или код, либо код истёк' })
    const u = db.getUser(login)!
    db.revokeUserSessions(login)
    db.logSecurityEvent({ user: login, type: 'password_reset', ip: req.ip, userAgent: String(req.headers['user-agent'] ?? ''), details: 'по коду администратора' })
    return issueSession(req, reply, u.name, u.role)
  })
  // Смена своего пароля (пп.11–12): текущий пароль обязателен; остальные сессии отзываются.
  app.post<{ Body: { current?: string; next?: string } }>(REST.sessionPassword, async (req, reply) => {
    const user = activeUser(tokenOf(req))
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    if (!csrfOk(req)) return reply.code(403).send({ error: 'csrf' })
    const { current, next } = req.body ?? {}
    if (!db.verifyUserPassword(user.name, current ?? '')) return reply.code(400).send({ error: 'Текущий пароль неверен' })
    const violation = checkPasswordPolicy(next ?? '', { name: user.name })
    if (violation) return reply.code(400).send({ error: violation })
    if (current === next) return reply.code(400).send({ error: 'Новый пароль совпадает с текущим' })
    db.setUserPassword(user.name, next!)
    db.revokeUserSessions(user.name, sidOf(req))
    db.logSecurityEvent({ user: user.name, type: 'password_changed', ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '') })
    return { ok: true }
  })

  // Открытая регистрация с подтверждением email: заявка → письмо со ссылкой #/verify/<token> → учётка и сессия.
  const signupLimiter = new SlidingWindowLimiter(5, 60 * 60_000)
  const passwordResetByIp = new SlidingWindowLimiter(5, 60 * 60_000)
  const passwordResetByEmail = new SlidingWindowLimiter(3, 60 * 60_000)
  const resetRequested = { ok: true as const, message: 'Если адрес подтверждён, письмо со ссылкой отправлено.' }

  // Email-вариант сброса (п.10): одинаковый ответ не раскрывает существование адреса; ограничения считаются и по IP, и по адресу.
  app.post<{ Body: { email?: string } }>(REST.sessionResetRequest, async (req, reply) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase()
    const byIp = passwordResetByIp.hit(req.ip)
    const byEmail = passwordResetByEmail.hit(email || 'invalid')
    if (!byIp.ok || !byEmail.ok) {
      const retry = Math.max(byIp.retryAfterSec, byEmail.retryAfterSec)
      return reply.code(429).header('retry-after', String(retry)).send({ error: `Слишком много запросов — попробуйте через ${retry} с`, retryAfterSec: retry })
    }
    const user = email ? db.getUserByEmail(email) : null
    if (!user || user.blocked) return resetRequested
    const token = randomBytes(32).toString('base64url')
    db.createPasswordResetToken(user.name, token, 60 * 60_000)
    const link = `${baseUrl(req)}/#/reset/${encodeURIComponent(token)}`
    try {
      await mailer.send({
        to: email,
        subject: 'Сброс пароля ChatAI',
        text: `Здравствуйте, ${user.name}!\n\nЧтобы установить новый пароль, откройте ссылку (действует 1 час):\n${link}\n\nЕсли вы не запрашивали сброс — просто проигнорируйте письмо.`,
        html: `<p>Здравствуйте, <b>${user.name}</b>!</p><p>Чтобы установить новый пароль, откройте ссылку (действует 1 час):</p><p><a href="${link}">Сменить пароль</a></p><p>Если вы не запрашивали сброс — просто проигнорируйте письмо.</p>`
      })
    } catch (error) {
      app.log.error({ error, user: user.name }, 'auth: письмо сброса пароля не отправлено')
    }
    return resetRequested
  })

  app.post<{ Body: { token?: string; password?: string } }>(REST.sessionResetEmail, async (req, reply) => {
    const token = String(req.body?.token ?? '')
    const name = token ? db.passwordResetTokenUser(token) : null
    if (!name) return reply.code(400).send({ error: 'Ссылка сброса недействительна или уже использована' })
    const violation = checkPasswordPolicy(String(req.body?.password ?? ''), { name })
    if (violation) return reply.code(400).send({ error: violation })
    const result = db.redeemPasswordResetToken(token, String(req.body?.password ?? ''))
    if (result === 'expired') return reply.code(410).send({ error: 'Ссылка сброса истекла. Запросите новое письмо.' })
    if (result !== 'ok') return reply.code(400).send({ error: 'Ссылка сброса недействительна или уже использована' })
    db.revokeUserSessions(name)
    db.logSecurityEvent({ user: name, type: 'password_reset', ip: req.ip, userAgent: String(req.headers['user-agent'] ?? ''), details: 'по подтверждённому email' })
    reply.header('set-cookie', [previewCookie('', 0), ...clearSessionCookies(req)])
    return { ok: true }
  })

  const sendVerification = async (req: FastifyRequest, name: string, email: string, token: string): Promise<void> => {
    const link = `${baseUrl(req)}/#/verify/${encodeURIComponent(token)}`
    await mailer.send({
      to: email,
      subject: 'Подтверждение регистрации в ChatAI',
      text: `Здравствуйте, ${name}!\n\nЧтобы завершить регистрацию, откройте ссылку (действует 24 часа):\n${link}\n\nЕсли вы не регистрировались — просто проигнорируйте это письмо.`,
      html: `<p>Здравствуйте, <b>${name}</b>!</p><p>Чтобы завершить регистрацию, нажмите кнопку (ссылка действует 24 часа):</p><p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#4f7cff;color:#fff;border-radius:8px;text-decoration:none">Подтвердить email</a></p><p style="color:#666;font-size:12px">Или скопируйте адрес: ${link}<br>Если вы не регистрировались — проигнорируйте письмо.</p>`
    })
  }
  app.get(REST.sessionSignup, async () => ({ enabled: readSignupConfig(db).enabled }))
  app.post<{ Body: { name?: string; email?: string; password?: string } }>(REST.sessionSignup, async (req, reply) => {
    if (!readSignupConfig(db).enabled) return reply.code(404).send({ error: 'Регистрация закрыта — попросите приглашение у администратора' })
    if (!signupLimiter.hit(req.ip).ok) return reply.code(429).send({ error: 'Слишком много регистраций — попробуйте позже' })
    const { name, email, password } = req.body ?? {}
    const login = (name ?? '').trim()
    const mail = (email ?? '').trim().toLowerCase()
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(login)) return reply.code(400).send({ error: 'Логин: 3–32 символа, латиница, цифры, точка, дефис, подчёркивание' })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail) || mail.length > 254) return reply.code(400).send({ error: 'Некорректный email' })
    const violation = checkPasswordPolicy(password ?? '', { name: login })
    if (violation) return reply.code(400).send({ error: violation })
    // Занятый логин или email не раскрываем сразу пользователю? Логин — раскрываем (он публичен), email — отвечаем одинаково.
    if (db.getUser(login)) return reply.code(409).send({ error: 'Такой логин уже занят' })
    if (!db.getUserByEmail(mail)) {
      const token = randomBytes(24).toString('base64url')
      db.createEmailVerification({ token, name: login, email: mail, password: password!, ttlMs: 24 * 60 * 60_000 })
      db.logSecurityEvent({ user: login, type: 'signup_requested', ip: req.ip, userAgent: String(req.headers['user-agent'] ?? ''), details: mail })
      try { await sendVerification(req, login, mail, token) } catch (error) { app.log.error({ error }, 'signup: письмо не отправлено'); return reply.code(502).send({ error: 'Не удалось отправить письмо — попробуйте позже или обратитесь к администратору' }) }
    }
    return { ok: true, mailSent: mailer.configured }
  })
  app.post<{ Body: { email?: string } }>(REST.sessionSignupResend, async (req, reply) => {
    if (!readSignupConfig(db).enabled) return reply.code(404).send({ error: 'Регистрация закрыта' })
    if (!signupLimiter.hit(`resend:${req.ip}`).ok) return reply.code(429).send({ error: 'Слишком часто — попробуйте позже' })
    const mail = (req.body?.email ?? '').trim().toLowerCase()
    const pending = mail ? db.pendingVerificationByEmail(mail) : null
    if (pending) {
      // Новый токен взамен старого: заявку пересоздать нельзя без пароля, поэтому продлеваем через новую ссылку на ту же запись.
      const token = randomBytes(24).toString('base64url')
      const row = db.getPendingVerificationRaw(mail)
      if (row) db.replaceVerificationToken(mail, token, 24 * 60 * 60_000)
      try { await sendVerification(req, pending.name, mail, token) } catch (error) { app.log.error({ error }, 'signup: письмо не отправлено') }
    }
    return { ok: true }
  })
  app.post<{ Body: { token?: string } }>(REST.sessionVerify, async (req, reply) => {
    const { token } = req.body ?? {}
    const cfg = readSignupConfig(db)
    const u = token ? db.redeemEmailVerification(String(token), cfg.role) : null
    if (!u) return reply.code(400).send({ error: 'Ссылка недействительна или истекла — зарегистрируйтесь ещё раз' })
    db.logSecurityEvent({ user: u.name, type: 'signup_verified', ip: req.ip, userAgent: String(req.headers['user-agent'] ?? ''), details: u.email ?? '' })
    // Приглашения, отправленные на этот адрес до регистрации, теперь адресованы
    // конкретному пользователю. Автоприёма нет: вступление он подтверждает сам.
    if (u.email) db.attachInvitationsToNewUser(u.name, u.email)
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
  app.post<{ Body: { includeCurrent?: boolean } | undefined }>(REST.sessionLogoutAll, async (req, reply) => {
    const user = activeUser(tokenOf(req))
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    if (!csrfOk(req)) return reply.code(403).send({ error: 'csrf' })
    // `includeCurrent` — «выйти везде, включая это устройство»: после кражи
    // пароля человек хочет обнулить всё разом, а не оставлять себе исключение.
    const includeCurrent = req.body?.includeCurrent === true
    const revoked = db.revokeUserSessions(user.name, includeCurrent ? null : sidOf(req))
    if (includeCurrent) {
      const token = tokenOf(req)
      if (token) db.revokeSession(token)
      reply.header('set-cookie', clearSessionCookies(req))
    }
    db.logSecurityEvent({ user: user.name, type: 'logout_all', ip: req.ip, userAgent: String(req.headers['user-agent'] ?? ''), details: `отозвано сессий: ${revoked}${includeCurrent ? ', включая текущую' : ''}` })
    return { revoked }
  })
  app.delete<{ Params: { sid: string } }>('/api/session/:sid', async (req, reply) => {
    const user = activeUser(tokenOf(req))
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    if (!csrfOk(req)) return reply.code(403).send({ error: 'csrf' })
    const s = db.getSession(req.params.sid)
    if (!s || s.user !== user.name) return reply.code(404).send({ error: 'not found' })
    db.revokeSessionById(s.sid)
    db.logSecurityEvent({ user: user.name, type: 'session_revoked', ip: req.ip, userAgent: s.userAgent, details: s.label ?? '' })
    return { ok: true }
  })
  // Имя устройства и отметка «доверенное» — только для своей сессии.
  app.patch<{ Params: { sid: string }; Body: { label?: string | null; trusted?: boolean } }>('/api/session/:sid', async (req, reply) => {
    const user = activeUser(tokenOf(req))
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    if (!csrfOk(req)) return reply.code(403).send({ error: 'csrf' })
    const s = db.getSession(req.params.sid)
    // Чужая и несуществующая сессия отвечают одинаково: по ответу не должно быть
    // видно, существует ли сессия с таким sid у кого-то другого.
    if (!s || s.user !== user.name) return reply.code(404).send({ error: 'not found' })
    const patch: { label?: string | null; trusted?: boolean } = {}
    if (req.body?.label !== undefined) {
      const label = typeof req.body.label === 'string' ? req.body.label.trim() : ''
      patch.label = label || null
    }
    if (typeof req.body?.trusted === 'boolean') patch.trusted = req.body.trusted
    if (Object.keys(patch).length === 0) return reply.code(400).send({ error: 'нечего менять' })
    db.updateSession(s.sid, patch)
    const ua = String(req.headers['user-agent'] ?? '')
    if (patch.label !== undefined) db.logSecurityEvent({ user: user.name, type: 'session_renamed', ip: req.ip, userAgent: ua, details: patch.label ?? 'имя снято' })
    if (patch.trusted !== undefined) db.logSecurityEvent({ user: user.name, type: patch.trusted ? 'session_trusted' : 'session_untrusted', ip: req.ip, userAgent: s.userAgent, details: s.label ?? '' })
    return { ok: true }
  })
}
