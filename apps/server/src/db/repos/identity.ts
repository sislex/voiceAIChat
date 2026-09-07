// Домен «identity»: таблицы users, sessions, session_revocations, security_events, invites, email_verifications, password_reset_tokens, login_device_emails, user_llm_access.
// Файл получен разрезанием бывшего VoiceChatDb (apps/server/src/db/database.ts) по владению таблицами;
// карта владения — ./ownership.ts, правила — docs/plans/db-repositories.md.
import type { SessionInfo, SessionGeo, SessionEndReason, SecurityEvent, SecurityEventType, InviteInfo } from '@voicechat/shared'
import { type UserLlmAccess, type UserRole } from '@voicechat/shared'
import { createHash } from 'node:crypto'
import { hashPassword, verifyPassword } from '../../users/passwords.js'
import { BaseRepo } from './base.js'

/** Строка таблицы `sessions` со всеми метаданными устройства. */
interface SessionRow {
  sid: string
  user_name: string
  created_at: number
  last_seen: number
  expires_at: number
  ip: string
  user_agent: string
  revoked_at: number | null
  label: string | null
  device_key: string | null
  trusted_at: number | null
  platform: string | null
  client_version: string | null
  geo: string | null
  requests: number | null
  last_path: string | null
  device_secret: string | null
  two_factor: number | null
  end_reason: string | null
}

/** Строка → контракт. Гео хранится JSON-ом: битую запись просто теряем. */
function sessionOf(r: SessionRow): SessionInfo {
  let geo: SessionGeo | null = null
  if (r.geo) { try { geo = JSON.parse(r.geo) as SessionGeo } catch { geo = null } }
  return {
    sid: r.sid,
    user: r.user_name,
    createdAt: r.created_at,
    lastSeen: r.last_seen,
    expiresAt: r.expires_at,
    ip: r.ip,
    userAgent: r.user_agent,
    label: r.label ?? null,
    deviceKey: r.device_key ?? null,
    trustedAt: r.trusted_at ?? null,
    platform: r.platform ?? null,
    clientVersion: r.client_version ?? null,
    geo,
    requests: r.requests ?? 0,
    lastPath: r.last_path ?? null,
    deviceSecret: r.device_secret ?? null,
    twoFactor: r.two_factor === 1,
    endReason: (r.end_reason as SessionInfo['endReason']) ?? null
  }
}

/** Запись пользователя приложения (без хеша пароля наружу). */
export interface UserRow {
  name: string
  role: UserRole
  blocked: boolean
  createdAt: number
  /** Блокировка после неудач (auth-roadmap п.3): подряд неверных паролей и до какого момента вход закрыт. */
  failedLogins: number
  lockedUntil: number | null
  lockReason: string | null
  /** Включён ли второй фактор (auth-roadmap п.6); сам секрет наружу не отдаётся. */
  totpEnabled: boolean
  /** Временный пароль — при входе требуется сменить (auth-roadmap п.11). */
  mustChangePassword: boolean
  /** Последний успешный вход (п.18) и месячный лимит расхода LLM в USD (п.17; null — без лимита). */
  lastLogin: number | null
  llmLimitUsd: number | null
  /** Подтверждённый email (саморегистрация); null — не указан. */
  email: string | null
}

/** Порог временной блокировки и её длительность; после `LOGIN_HARD_LOCK_FAILS` подряд — блокировка `blocked`. */
export const LOGIN_LOCK_FAILS = 5

export const LOGIN_LOCK_MS = 15 * 60_000

export const LOGIN_HARD_LOCK_FAILS = 10

interface UserDbRow {
  name: string
  password_hash: string
  role: string
  blocked: number
  created_at: number
  failed_logins?: number | null
  locked_until?: number | null
  lock_reason?: string | null
  totp_secret?: string | null
  reset_code_hash?: string | null
  reset_code_expires?: number | null
  must_change_password?: number | null
  last_login?: number | null
  notices_seen_at?: number | null
  llm_limit_usd?: number | null
  email?: string | null
}
export class IdentityRepo extends BaseRepo {
  private mapUser(r: UserDbRow): UserRow {
    return { name: r.name, role: r.role as UserRole, blocked: r.blocked !== 0, createdAt: r.created_at, failedLogins: r.failed_logins ?? 0, lockedUntil: r.locked_until ?? null, lockReason: r.lock_reason ?? null, totpEnabled: Boolean(r.totp_secret), mustChangePassword: Boolean(r.must_change_password), lastLogin: r.last_login ?? null, llmLimitUsd: r.llm_limit_usd ?? null, email: r.email ?? null }
  }

  getUserByEmail(email: string): UserRow | null {
    const row = this.db.prepare(`SELECT * FROM users WHERE email = ?`).get(email.toLowerCase()) as UserDbRow | undefined
    return row ? this.mapUser(row) : null
  }

  /** Заявка на регистрацию: пароль уже хешируется, токен хранится хешем; повторная заявка на тот же email заменяет прежнюю. */
  createEmailVerification(input: { token: string; name: string; email: string; password: string; ttlMs: number }): void {
    this.db.prepare(`DELETE FROM email_verifications WHERE email = ? OR name = ?`).run(input.email.toLowerCase(), input.name)
    this.db.prepare(`INSERT INTO email_verifications (token_hash, name, email, password_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(createHash('sha256').update(input.token).digest('hex'), input.name, input.email.toLowerCase(), hashPassword(input.password), Date.now(), Date.now() + input.ttlMs)
  }

  /** Подтверждение: создаёт пользователя из заявки и удаляет её; null — токен неизвестен/истёк/логин занят. */
  redeemEmailVerification(token: string, role: UserRole): UserRow | null {
    const hash = createHash('sha256').update(token).digest('hex')
    const r = this.db.prepare(`SELECT * FROM email_verifications WHERE token_hash = ?`).get(hash) as { name: string; email: string; password_hash: string; expires_at: number } | undefined
    if (!r) return null
    this.db.prepare(`DELETE FROM email_verifications WHERE token_hash = ?`).run(hash)
    if (r.expires_at < Date.now() || this.getUser(r.name) || this.getUserByEmail(r.email)) return null
    this.db.prepare(`INSERT INTO users (name, password_hash, role, blocked, created_at, email) VALUES (?, ?, ?, 0, ?, ?)`).run(r.name, r.password_hash, role, this.now(), r.email)
    return this.getUser(r.name)
  }

  pendingVerificationByEmail(email: string): { name: string; expiresAt: number } | null {
    const r = this.db.prepare(`SELECT name, expires_at FROM email_verifications WHERE email = ? AND expires_at > ?`).get(email.toLowerCase(), Date.now()) as { name: string; expires_at: number } | undefined
    return r ? { name: r.name, expiresAt: r.expires_at } : null
  }

  getPendingVerificationRaw(email: string): { name: string } | null {
    const r = this.db.prepare(`SELECT name FROM email_verifications WHERE email = ?`).get(email.toLowerCase()) as { name: string } | undefined
    return r ?? null
  }

  replaceVerificationToken(email: string, token: string, ttlMs: number): void {
    this.db.prepare(`UPDATE email_verifications SET token_hash = ?, expires_at = ? WHERE email = ?`).run(createHash('sha256').update(token).digest('hex'), Date.now() + ttlMs, email.toLowerCase())
  }

  pruneEmailVerifications(): number {
    return this.db.prepare(`DELETE FROM email_verifications WHERE expires_at < ?`).run(Date.now()).changes
  }

  /** Выпускает ровно один действующий email-токен сброса для пользователя; сырой токен в БД не попадает. */
  createPasswordResetToken(user: string, token: string, ttlMs: number): void {
    this.db.prepare(`DELETE FROM password_reset_tokens WHERE user_name = ?`).run(user)
    this.db.prepare(`INSERT INTO password_reset_tokens (token_hash, user_name, created_at, expires_at) VALUES (?, ?, ?, ?)`)
      .run(createHash('sha256').update(token).digest('hex'), user, Date.now(), Date.now() + ttlMs)
  }

  /** Одноразово применяет токен. Истёкший отличается от неизвестного для понятного экрана, но не раскрывает email. */
  redeemPasswordResetToken(token: string, password: string): 'ok' | 'expired' | 'invalid' {
    const hash = createHash('sha256').update(token).digest('hex')
    const row = this.db.prepare(`SELECT user_name, expires_at FROM password_reset_tokens WHERE token_hash = ?`).get(hash) as { user_name: string; expires_at: number } | undefined
    if (!row) return 'invalid'
    this.db.prepare(`DELETE FROM password_reset_tokens WHERE token_hash = ?`).run(hash)
    if (row.expires_at < Date.now()) return 'expired'
    this.setUserPassword(row.user_name, password)
    return 'ok'
  }

  passwordResetTokenUser(token: string): string | null {
    const hash = createHash('sha256').update(token).digest('hex')
    const row = this.db.prepare(`SELECT user_name FROM password_reset_tokens WHERE token_hash = ?`).get(hash) as { user_name: string } | undefined
    return row?.user_name ?? null
  }

  markLogin(name: string): void {
    this.db.prepare(`UPDATE users SET last_login = ? WHERE name = ?`).run(Date.now(), name)
  }

  setUserLlmLimit(name: string, usd: number | null): void {
    this.db.prepare(`UPDATE users SET llm_limit_usd = ? WHERE name = ?`).run(usd, name)
  }

  /** Непросмотренные уведомления безопасности (п.16): входы с нового устройства после отметки «видел». */
  unseenSecurityNotices(name: string): SecurityEvent[] {
    const r = this.db.prepare(`SELECT notices_seen_at FROM users WHERE name = ?`).get(name) as { notices_seen_at?: number } | undefined
    const since = r?.notices_seen_at ?? 0
    // Вытеснение лимитом человек тоже должен заметить: его выкинуло не само.
    // Всё, что случилось с сессиями не по воле человека, он должен увидеть:
    // чужой вход, вытеснение лимитом и действия администратора.
    const shown = new Set<SecurityEventType>(['login_new_device', 'session_evicted', 'session_revoked', 'session_untrusted'])
    return this.listSecurityEvents({ user: name, limit: 50 })
      .filter((e) => e.at > since && shown.has(e.type) && (e.type !== 'session_revoked' || e.details.includes('администратором')) && (e.type !== 'session_untrusted' || e.details.includes('администратором')))
  }

  markNoticesSeen(name: string): void {
    this.db.prepare(`UPDATE users SET notices_seen_at = ? WHERE name = ?`).run(Date.now(), name)
  }

  /** Атомарно резервирует суточное письмо для пары IP+UA; false означает, что письмо уже резервировали. */
  reserveLoginDeviceEmail(name: string, ip: string, userAgent: string, now = Date.now()): boolean {
    const cutoff = now - 24 * 60 * 60_000
    const result = this.db.prepare(`INSERT INTO login_device_emails (user_name, ip, user_agent, sent_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_name, ip, user_agent) DO UPDATE SET sent_at = excluded.sent_at WHERE login_device_emails.sent_at <= ?`)
      .run(name, ip, userAgent, now, cutoff)
    return result.changes > 0
  }

  /** Автоотключение неактивных (п.18): не входили дольше `days` (или никогда, но созданы давно) → blocked с причиной inactive; admin не трогаем. */
  blockInactiveUsers(days: number): string[] {
    const cutoff = Date.now() - days * 24 * 60 * 60_000
    const rows = this.db.prepare(`SELECT name FROM users WHERE blocked = 0 AND name != 'admin' AND role != 'admin' AND COALESCE(last_login, created_at) < ?`).all(cutoff) as Array<{ name: string }>
    for (const r of rows) this.db.prepare(`UPDATE users SET blocked = 1, lock_reason = 'inactive' WHERE name = ?`).run(r.name)
    return rows.map((r) => r.name)
  }

  setMustChangePassword(name: string, value: boolean): void {
    this.db.prepare(`UPDATE users SET must_change_password = ? WHERE name = ?`).run(value ? 1 : 0, name)
  }

  /** Одноразовый код сброса от администратора (п.10): хранится хеш, действует `ttlMs`. */
  setResetCode(name: string, code: string, ttlMs: number): void {
    this.db.prepare(`UPDATE users SET reset_code_hash = ?, reset_code_expires = ? WHERE name = ?`).run(hashPassword(code), Date.now() + ttlMs, name)
  }

  /** Проверяет код и при успехе ставит новый пароль, снимает код, замок и флаг смены; false — код неверен/истёк. */
  redeemResetCode(name: string, code: string, newPassword: string): boolean {
    const r = this.db.prepare(`SELECT reset_code_hash, reset_code_expires FROM users WHERE name = ?`).get(name) as { reset_code_hash?: string | null; reset_code_expires?: number | null } | undefined
    if (!r?.reset_code_hash || !r.reset_code_expires || r.reset_code_expires < Date.now() || !verifyPassword(code, r.reset_code_hash)) return false
    this.db.prepare(`UPDATE users SET password_hash = ?, reset_code_hash = NULL, reset_code_expires = NULL, must_change_password = 0, failed_logins = 0, locked_until = NULL, lock_reason = NULL WHERE name = ?`).run(hashPassword(newPassword), name)
    return true
  }

  getUserTotpSecret(name: string): string | null {
    const r = this.db.prepare(`SELECT totp_secret FROM users WHERE name = ?`).get(name) as { totp_secret?: string | null } | undefined
    return r?.totp_secret ?? null
  }

  setUserTotpSecret(name: string, secret: string | null): void {
    this.db.prepare(`UPDATE users SET totp_secret = ? WHERE name = ?`).run(secret, name)
  }

  /** Неудачный вход: счётчик подряд; с 5-й попытки — замок на 15 минут, с 10-й — постоянная блокировка с причиной `auto`. */
  recordLoginFailure(name: string): { failedLogins: number; lockedUntil: number | null; blocked: boolean } | null {
    const row = this.db.prepare(`SELECT * FROM users WHERE name = ?`).get(name) as UserDbRow | undefined
    if (!row) return null
    const failed = (row.failed_logins ?? 0) + 1
    // Замок сравнивается с Date.now() в auth.ts — тестовые часы БД здесь не подходят.
    const now = Date.now()
    const hard = failed >= LOGIN_HARD_LOCK_FAILS
    const lockedUntil = hard ? null : failed >= LOGIN_LOCK_FAILS ? now + LOGIN_LOCK_MS : row.locked_until ?? null
    this.db.prepare(`UPDATE users SET failed_logins = ?, locked_until = ?, blocked = CASE WHEN ? THEN 1 ELSE blocked END, lock_reason = CASE WHEN ? THEN 'auto' ELSE lock_reason END WHERE name = ?`)
      .run(failed, lockedUntil, hard ? 1 : 0, hard ? 1 : 0, name)
    return { failedLogins: failed, lockedUntil, blocked: hard || row.blocked !== 0 }
  }

  /** Успешный вход или ручная разблокировка: счётчик и замок снимаются. */
  resetLoginFailures(name: string): void {
    this.db.prepare(`UPDATE users SET failed_logins = 0, locked_until = NULL, lock_reason = NULL WHERE name = ?`).run(name)
  }

  /**
   * Гарантирует наличие пользователя admin (сид при старте). Пароль применяется
   * только при создании записи — смена пароля через UI не перезатирается рестартом.
   */
  ensureAdmin(password = ''): void {
    const exists = this.db.prepare(`SELECT 1 FROM users WHERE name = 'admin'`).get()
    if (exists) return
    this.db
      .prepare(`INSERT INTO users (name, password_hash, role, blocked, created_at) VALUES (?, ?, 'admin', 0, ?)`)
      .run('admin', hashPassword(password), this.now())
  }

  /** Создаёт пользователя с одной из поддерживаемых ролей. Кидает при дубликате имени. */
  createUser(name: string, password: string, role: UserRole): UserRow {
    this.db
      .prepare(`INSERT INTO users (name, password_hash, role, blocked, created_at) VALUES (?, ?, ?, 0, ?)`)
      .run(name, hashPassword(password), role, this.now())
    return { name, role, blocked: false, createdAt: this.now(), failedLogins: 0, lockedUntil: null, lockReason: null, totpEnabled: false, mustChangePassword: false, lastLogin: null, llmLimitUsd: null, email: null }
  }

  getUser(name: string): UserRow | null {
    const row = this.db.prepare(`SELECT * FROM users WHERE name = ?`).get(name) as
      | UserDbRow
      | undefined
    return row ? this.mapUser(row) : null
  }

  listUsers(): UserRow[] {
    const rows = this.db.prepare(`SELECT * FROM users ORDER BY created_at ASC`).all() as UserDbRow[]
    return rows.map((r) => this.mapUser(r))
  }

  /** Проверяет пароль; возвращает пользователя при успехе, иначе null. */
  verifyUserPassword(name: string, password: string): UserRow | null {
    const row = this.db.prepare(`SELECT * FROM users WHERE name = ?`).get(name) as
      | UserDbRow
      | undefined
    if (!row) return null
    return verifyPassword(password, row.password_hash) ? this.mapUser(row) : null
  }

  setUserBlocked(name: string, blocked: boolean): void {
    // Ручная разблокировка снимает и авто-замок, иначе пользователь останется «заперт» до истечения таймера.
    if (blocked) this.db.prepare(`UPDATE users SET blocked = 1 WHERE name = ?`).run(name)
    else this.db.prepare(`UPDATE users SET blocked = 0, failed_logins = 0, locked_until = NULL, lock_reason = NULL WHERE name = ?`).run(name)
  }

  setUserRole(name: string, role: UserRole): UserRow | null {
    this.db.prepare(`UPDATE users SET role = ? WHERE name = ?`).run(role, name)
    return this.getUser(name)
  }

  setUserPassword(name: string, password: string): void {
    this.db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0 WHERE name = ?`).run(hashPassword(password), name)
  }

  deleteUser(name: string): void {
    this.db.prepare(`DELETE FROM users WHERE name = ?`).run(name)
  }

  createInvite(input: { token: string; role: UserRole; createdBy: string; ttlMs: number; maxUses: number; note?: string; email?: string }): InviteInfo {
    const now = Date.now()
    this.db.prepare(`INSERT INTO invites (token, role, created_by, created_at, expires_at, max_uses, uses, note, email) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`)
      .run(input.token, input.role, input.createdBy, now, now + input.ttlMs, Math.max(1, input.maxUses), (input.note ?? '').slice(0, 200), input.email || null)
    return this.getInvite(input.token)!
  }

  getInvite(token: string): InviteInfo | null {
    const r = this.db.prepare(`SELECT * FROM invites WHERE token = ?`).get(token) as { token: string; role: string; created_by: string; created_at: number; expires_at: number; max_uses: number; uses: number; note: string; email: string | null; emailed_at: number | null } | undefined
    return r ? { token: r.token, role: r.role as UserRole, createdBy: r.created_by, createdAt: r.created_at, expiresAt: r.expires_at, maxUses: r.max_uses, uses: r.uses, note: r.note, email: r.email, emailedAt: r.emailed_at } : null
  }

  markInviteEmailed(token: string): InviteInfo | null {
    this.db.prepare(`UPDATE invites SET emailed_at = ? WHERE token = ?`).run(Date.now(), token)
    return this.getInvite(token)
  }

  listInvites(): InviteInfo[] {
    return (this.db.prepare(`SELECT token FROM invites ORDER BY created_at DESC`).all() as Array<{ token: string }>).map((r) => this.getInvite(r.token)!)
  }

  /** Инвайт годен: не истёк и не исчерпан. */
  inviteUsable(token: string): InviteInfo | null {
    const inv = this.getInvite(token)
    return inv && inv.expiresAt > Date.now() && inv.uses < inv.maxUses ? inv : null
  }

  consumeInvite(token: string): void {
    this.db.prepare(`UPDATE invites SET uses = uses + 1 WHERE token = ?`).run(token)
  }

  deleteInvite(token: string): boolean {
    return this.db.prepare(`DELETE FROM invites WHERE token = ?`).run(token).changes > 0
  }

  /** Чистка истёкших и исчерпанных инвайтов старше недели (auth-roadmap п.18 — вызывается планировщиком). */
  pruneInvites(): number {
    return this.db.prepare(`DELETE FROM invites WHERE expires_at < ? OR (uses >= max_uses AND created_at < ?)`).run(Date.now() - 7 * 24 * 60 * 60_000, Date.now() - 7 * 24 * 60 * 60_000).changes
  }

  logSecurityEvent(e: { user: string; type: SecurityEventType; ip?: string; userAgent?: string; details?: string; sid?: string | null }): void {
    this.db.prepare(`INSERT INTO security_events (at, user_name, type, ip, user_agent, details, session_sid) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(Date.now(), e.user.slice(0, 80), e.type, (e.ip ?? '').slice(0, 64), (e.userAgent ?? '').slice(0, 200), (e.details ?? '').slice(0, 500), e.sid ?? null)
    // Журнал не должен расти бесконечно: держим последние 50 000 записей.
    if (Math.random() < 0.01) this.db.prepare(`DELETE FROM security_events WHERE id < (SELECT COALESCE(MAX(id), 0) - 50000 FROM security_events)`).run()
  }

  listSecurityEvents(filter: { user?: string; limit?: number } = {}): SecurityEvent[] {
    const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000)
    const rows = (filter.user
      ? this.db.prepare(`SELECT * FROM security_events WHERE user_name = ? ORDER BY id DESC LIMIT ?`).all(filter.user, limit)
      : this.db.prepare(`SELECT * FROM security_events ORDER BY id DESC LIMIT ?`).all(limit)) as Array<{ id: number; at: number; user_name: string; type: SecurityEventType; ip: string; user_agent: string; details: string }>
    return rows.map((r) => ({ id: r.id, at: r.at, user: r.user_name, type: r.type, ip: r.ip, userAgent: r.user_agent, details: r.details }))
  }

  // Время сессий — настенное (Date.now), а не тестовые часы базы: сроки жизни,
  // Retry-After и Max-Age у cookie измеряются в реальных днях. Необязательный
  // `at` есть только ради контрактного набора ядра, который двигает часы сам.

  /** Регистрирует сессию входа; повторный вызов для того же sid обновляет last_seen. */
  createSession(sid: string, user: string, meta: { ip: string; userAgent: string; ttlMs: number; deviceKey?: string | null; deviceSecret?: string | null; platform?: string | null; clientVersion?: string | null; geo?: SessionGeo | null; twoFactor?: boolean; at?: number }): void {
    const now = meta.at ?? Date.now()
    this.db.prepare(`INSERT INTO sessions (sid, user_name, created_at, last_seen, expires_at, ip, user_agent, device_key, device_secret, platform, client_version, geo, two_factor)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET last_seen = excluded.last_seen`)
      .run(sid, user, now, now, now + meta.ttlMs, meta.ip.slice(0, 64), meta.userAgent.slice(0, 200),
        meta.deviceKey ?? null, meta.deviceSecret ?? null, meta.platform ?? null, meta.clientVersion ?? null, meta.geo ? JSON.stringify(meta.geo) : null, meta.twoFactor ? 1 : 0)
  }

  /** Есть ли запись о сессии вообще (в т.ч. отозванная) — чтобы ленивый импорт старых токенов не воскрешал отозванные. */
  hasSessionRow(sid: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM sessions WHERE sid = ?`).get(sid))
  }

  getSession(sid: string): SessionInfo | null {
    const r = this.db.prepare(`SELECT * FROM sessions WHERE sid = ?`).get(sid) as SessionRow | undefined
    if (!r || r.revoked_at) return null
    return sessionOf(r)
  }

  /**
   * Отметка активности — не чаще раза в минуту, чтобы не писать в БД на каждый
   * запрос. Поэтому `requests` считает не запросы, а минутные интервалы, в
   * которых сессия была жива: как мера активности этого достаточно, а полный
   * счётчик стоил бы записи в SQLite на каждом обращении к API.
   */
  touchSession(sid: string, ttlMs: number, path?: string, at?: number): void {
    const now = at ?? Date.now()
    this.db.prepare(`UPDATE sessions SET last_seen = ?, expires_at = ?, requests = requests + 1, last_path = COALESCE(?, last_path)
      WHERE sid = ? AND revoked_at IS NULL AND last_seen < ?`).run(now, now + ttlMs, path ? path.slice(0, 120) : null, sid, now - 60_000)
  }

  /**
   * Имя, которое пользователь уже дал этому устройству. Метка живёт на сессии,
   * а человек мыслит устройством: без наследования «Рабочий ноут» пришлось бы
   * вводить заново после каждого перелогина.
   */
  deviceLabel(user: string, deviceKey: string): string | null {
    const row = this.db.prepare(`SELECT label FROM sessions WHERE user_name = ? AND device_key = ? AND label IS NOT NULL
      ORDER BY last_seen DESC LIMIT 1`).get(user, deviceKey) as { label: string } | undefined
    return row?.label ?? null
  }

  /** Одна метка на все живые сессии устройства: переименовывают устройство, а не вкладку. */
  renameDevice(user: string, deviceKey: string, label: string | null): number {
    return this.db.prepare(`UPDATE sessions SET label = ? WHERE user_name = ? AND device_key = ? AND revoked_at IS NULL`)
      .run(label ? label.slice(0, 60) : null, user, deviceKey).changes
  }

  /** Снять доверие со всех устройств пользователя; возвращает число затронутых. */
  untrustAllSessions(user: string): number {
    return this.db.prepare(`UPDATE sessions SET trusted_at = NULL WHERE user_name = ? AND revoked_at IS NULL AND trusted_at IS NOT NULL`).run(user).changes
  }

  /**
   * Последняя активность и число живых сессий сразу по всем пользователям.
   * Список админки строится одним проходом: спрашивать `sessionStats` на каждого
   * — это N запросов ради двух чисел в строке таблицы.
   */
  sessionActivity(at?: number): Map<string, { lastSeen: number; live: number }> {
    const now = at ?? Date.now()
    const rows = this.db.prepare(`SELECT user_name AS user, MAX(last_seen) AS lastSeen, COUNT(*) AS live
      FROM sessions WHERE revoked_at IS NULL AND expires_at > ? GROUP BY user_name`).all(now) as { user: string; lastSeen: number; live: number }[]
    return new Map(rows.map((row) => [row.user, { lastSeen: row.lastSeen, live: row.live }]))
  }

  /** Сколько живых сессий и сколько из них доверенных — сводка для админки. */
  sessionStats(user: string, at?: number): { total: number; trusted: number } {
    const now = at ?? Date.now()
    const row = this.db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN trusted_at IS NOT NULL THEN 1 ELSE 0 END) AS trusted
      FROM sessions WHERE user_name = ? AND revoked_at IS NULL AND expires_at > ?`).get(user, now) as { total: number; trusted: number | null }
    return { total: row.total, trusted: row.trusted ?? 0 }
  }

  /** Правка метки и доверия своей сессии; false — строки нет или она отозвана. */
  updateSession(sid: string, patch: { label?: string | null; trusted?: boolean; geo?: SessionGeo | null }, at?: number): boolean {
    const sets: string[] = []
    const params: Array<string | number | null> = []
    if (patch.label !== undefined) { sets.push('label = ?'); params.push(patch.label ? patch.label.slice(0, 60) : null) }
    if (patch.trusted !== undefined) { sets.push('trusted_at = ?'); params.push(patch.trusted ? (at ?? Date.now()) : null) }
    if (patch.geo !== undefined) { sets.push('geo = ?'); params.push(patch.geo ? JSON.stringify(patch.geo) : null) }
    if (sets.length === 0) return Boolean(this.getSession(sid))
    return this.db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE sid = ? AND revoked_at IS NULL`).run(...params, sid).changes > 0
  }

  listSessions(user: string, at?: number): SessionInfo[] {
    const rows = this.db.prepare(`SELECT * FROM sessions WHERE user_name = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen DESC`).all(user, at ?? Date.now()) as SessionRow[]
    return rows.map(sessionOf)
  }

  /**
   * События безопасности, относящиеся к устройству сессии. Ключ сопоставления —
   * User-Agent и адрес: в журнале нет sid, а по паре видно именно тот вход,
   * про который человек спрашивает «что это устройство делало».
   */
  listSessionHistory(user: string, session: { sid: string; userAgent: string; ip: string }, limit = 10): SecurityEvent[] {
    // Сначала по sid — это точная привязка. Пара «UA + адрес» осталась как
    // фолбэк для событий, записанных до появления колонки: без неё история
    // старых сессий стала бы пустой на ровном месте.
    const rows = this.db.prepare(`SELECT * FROM security_events
      WHERE user_name = ? AND (session_sid = ? OR (session_sid IS NULL AND user_agent = ? AND (ip = ? OR ip = '')))
      ORDER BY id DESC LIMIT ?`).all(user, session.sid, session.userAgent.slice(0, 200), session.ip.slice(0, 64), Math.min(Math.max(limit, 1), 50)) as Array<{ id: number; at: number; user_name: string; type: SecurityEventType; ip: string; user_agent: string; details: string }>
    return rows.map((r) => ({ id: r.id, at: r.at, user: r.user_name, type: r.type, ip: r.ip, userAgent: r.user_agent, details: r.details }))
  }

  /**
   * Недавно завершённые сессии: отозванные и истёкшие, пока их не убрал prune.
   * Нужны, чтобы «сессия исчезла» отличалось от «сессии не было» — иначе после
   * отзыва человек не может убедиться, что закрыл именно тот вход.
   */
  listEndedSessions(user: string, limit = 20, at?: number): SessionInfo[] {
    const now = at ?? Date.now()
    const rows = this.db.prepare(`SELECT * FROM sessions WHERE user_name = ? AND (revoked_at IS NOT NULL OR expires_at <= ?)
      ORDER BY COALESCE(revoked_at, expires_at) DESC LIMIT ?`).all(user, now, Math.min(Math.max(limit, 1), 100)) as SessionRow[]
    return rows.map((r) => ({
      ...sessionOf(r),
      endedAt: r.revoked_at ?? r.expires_at,
      ended: true,
      // Истечение срока причины в базе не имеет: она видна по отсутствию отзыва.
      endReason: (r.end_reason as SessionInfo['endReason']) ?? (r.revoked_at ? 'revoked' : 'expired')
    }))
  }

  revokeSessionById(sid: string, at?: number, reason: SessionEndReason = 'revoked'): boolean {
    return this.db.prepare(`UPDATE sessions SET revoked_at = ?, end_reason = ? WHERE sid = ? AND revoked_at IS NULL`).run(at ?? Date.now(), reason, sid).changes > 0
  }

  /** «Выйти везде»: все сессии пользователя, кроме указанной (текущей). */
  revokeUserSessions(user: string, exceptSid: string | null = null, at?: number, reason: SessionEndReason = 'logout_all'): number {
    return this.db.prepare(`UPDATE sessions SET revoked_at = ?, end_reason = ? WHERE user_name = ? AND revoked_at IS NULL AND (? IS NULL OR sid != ?)`).run(at ?? Date.now(), reason, user, exceptSid, exceptSid).changes
  }

  /**
   * Отзывает сессии, в которых давно не было активности. Формально они ещё живы
   * (TTL продлевается каждым запросом), но забытый вход с чужого ноутбука —
   * ровно та сессия, о которой владелец не вспомнит сам.
   */
  revokeStaleSessions(staleDays: number, at?: number): number {
    if (staleDays <= 0) return 0
    const now = at ?? Date.now()
    return this.db.prepare(`UPDATE sessions SET revoked_at = ?, end_reason = 'stale' WHERE revoked_at IS NULL AND last_seen < ?`)
      .run(now, now - staleDays * 24 * 60 * 60_000).changes
  }

  /** Чистка истёкших и давно отозванных сессий (вызывается на старте и раз в сутки). */
  pruneSessions(keepRevokedMs = 7 * 24 * 60 * 60_000, at?: number): number {
    const now = at ?? Date.now()
    return this.db.prepare(`DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)`).run(now, now - keepRevokedMs).changes
  }

  /** Делает конкретный Bearer-токен недействительным даже после рестарта сервера. */
  revokeSession(token: string): void {
    const hash = createHash('sha256').update(token).digest('hex')
    this.db.prepare(`INSERT OR IGNORE INTO session_revocations (token_hash, created_at) VALUES (?, ?)`).run(hash, this.now())
  }

  isSessionRevoked(token: string): boolean {
    const hash = createHash('sha256').update(token).digest('hex')
    return Boolean(this.db.prepare(`SELECT 1 FROM session_revocations WHERE token_hash = ?`).get(hash))
  }

  /** Deny-list rows only: an empty list means every provider and model is allowed. */
  getUserLlmAccess(userId: string): UserLlmAccess[] {
    return this.db.prepare(`SELECT provider, model_id AS modelId FROM user_llm_access WHERE user_name = ? ORDER BY provider, model_id`).all(userId) as UserLlmAccess[]
  }

  setUserLlmAccess(userId: string, access: UserLlmAccess[]): void {
    const insert = this.db.prepare(`INSERT INTO user_llm_access (user_name, provider, model_id) VALUES (?, ?, ?)`)
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM user_llm_access WHERE user_name = ?`).run(userId)
      for (const entry of access) insert.run(userId, entry.provider, entry.modelId)
    })()
  }

  /** Удаляет пользователя и ВСЕ его данные (разговоры/сообщения/агенты/настройки). */
  deleteUserData(userId: string): void {
    // Каскад идёт по владельцам данных: identity знает только, ЧТО пользователь
    // исчезает, а как это отражается в чатах, машинах, настройках и проектах —
    // решает каждый домен сам. Порядок прежний: сначала чаты и машины
    // (project_machines уйдут по CASCADE при удалении агентов и/или проектов),
    // потом настройки, задачи, проекты, и последним — сама учётка.
    this.db.transaction(() => {
      const deletedEmail = (this.getUser(userId)?.email ?? '').toLowerCase()
      this.repos.chat.deleteConversationsOfUser(userId)
      this.repos.machines.deleteAgentsOfUser(userId)
      this.repos.settings.deleteUserSettings(userId)
      this.repos.tasks.unassignUser(userId)
      this.repos.projects.detachDeletedUser(userId, deletedEmail)
      this.db.prepare(`DELETE FROM users WHERE name = ?`).run(userId)
    })()
  }
}
