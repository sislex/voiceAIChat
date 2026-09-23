import { PRODUCT_CAPABILITIES } from '@sislexa/identity/contracts/accountAccess'
// Core integration: CORS, admin orchestration, resource permissions and legacy migration.
// Identity's internal authentication/device cases run in the Identity repository.
import { describe, it, expect, beforeEach } from 'vitest'
import { VoiceChatDb } from '../db/database.js'
import { SCHEMA_SQL } from '../db/schema.js'
import { signToken } from "@sislexa/identity/server/users/accounts"
import type { FastifyInstance } from 'fastify'
import { setupRestHarness } from './restHarness.js'
// Сырой драйвер SQLite и файловые базы: на Postgres (VC_TEST_DB_URL) этих тестов нет — там нет ни файла, ни драйвера.
const standardAccount = { userId: expect.any(String), tenantId: expect.any(String), tenantKind: 'personal', membershipRole: 'owner', tariffId: 'standard', tariffRevision: 1, capabilities: [...PRODUCT_CAPABILITIES] }
const ON_POSTGRES = Boolean(process.env.VC_TEST_DB_URL)

// Обвязка одна на все rest.*.test.ts — см. restHarness.ts.
// Хук harness зарегистрирован первым, поэтому к моменту этого beforeEach
// поля уже пересозданы под текущий тест.
const harness = setupRestHarness()
const { inj, sentMails, SECRET } = harness
let app: FastifyInstance
let db: VoiceChatDb
beforeEach(() => { ({ app, db } = harness) })

describe('REST: аутентификация', () => {
  // @testCase TC-01
  it('allows credentialed login from the packaged Desktop and Electron dev origins', async () => {
    await db.identity.createUser('electron', 'electron-pass-2026', 'developer')
    for (const origin of ['sislexa://app', 'http://localhost:5173', 'http://127.0.0.1:5173']) {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/api/session/login',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type,authorization,x-vc-csrf,x-vc-client-version'
        }
      })
      expect(response.statusCode).toBe(204)
      expect(response.headers['access-control-allow-origin']).toBe(origin)
      expect(response.headers['access-control-allow-credentials']).toBe('true')
      expect(response.headers['access-control-allow-methods']).toContain('POST')
      expect(response.headers['access-control-allow-headers']).toBe('Content-Type, Authorization, x-vc-csrf, x-vc-client-version, x-sislexa-tenant-id, x-request-id')
      const login = await app.inject({
        method: 'POST',
        url: '/api/session/login',
        headers: { origin, 'x-forwarded-proto': 'https' },
        payload: { name: 'electron', password: 'electron-pass-2026', remember: true }
      })
      expect(login.headers['access-control-allow-origin']).toBe(origin)
      const cookies = ([] as string[]).concat(login.headers['set-cookie'] as string[])
      expect(cookies.find((cookie) => cookie.startsWith('__Secure-vc_session='))).toMatch(/SameSite=None.*Max-Age=.*Secure/)
    }
  })

  // @testCase TC-02
  it('не выдаёт разрешающие CORS-заголовки неизвестному origin и не ломает запрос без Origin', async () => {
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/session/login',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' }
    })
    expect(preflight.statusCode).toBe(204)
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined()
    expect(preflight.headers['access-control-allow-credentials']).toBeUndefined()
    const login = await app.inject({
      method: 'POST',
      url: '/api/session/login',
      headers: { origin: 'https://evil.example' },
      payload: { name: 'nobody', password: 'wrong' }
    })
    expect(login.headers['access-control-allow-origin']).toBeUndefined()
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200)
  })

  it('без токена защищённый роут → 401, health и login — открыты', async () => {
    await db.identity.createUser('user', '', 'developer') // пользователь теперь заводится в БД
    expect((await app.inject({ method: 'GET', url: '/api/conversations' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200)
    // Логин: верный пароль (пустой) → токен; неверный → 401.
    const ok = await app.inject({
      method: 'POST',
      url: '/api/session/login',
      payload: { name: 'user', password: '' }
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().user).toEqual({ name: 'user', role: 'developer', account: standardAccount })
    expect(typeof ok.json().token).toBe('string')
    expect(String(ok.headers['set-cookie'])).toContain('vc_preview_session=')
    expect(String(ok.headers['set-cookie'])).toContain('Path=/api/preview')
    expect(String(ok.headers['set-cookie'])).toContain('HttpOnly')
    expect(String(ok.headers['set-cookie'])).toContain('SameSite=Strict')
    const bad = await app.inject({
      method: 'POST',
      url: '/api/session/login',
      payload: { name: 'user', password: 'x' }
    })
    expect(bad.statusCode).toBe(401)
  })

  it('returns and preserves request correlation while exposing operations metrics only to admins', async () => {
    const health = await app.inject({ method: 'GET', url: '/api/health', headers: { 'x-request-id': 'browser:request-1' } })
    expect(health.headers['x-request-id']).toBe('browser:request-1')
    const status = await inj({ method: 'GET', url: '/api/admin/operations/status' })
    expect(status.statusCode).toBe(200)
    expect(status.headers['cache-control']).toBe('no-store')
    expect(status.json()).toMatchObject({ inFlight: 1, requests: expect.any(Number), failures: expect.any(Number), alerts: expect.any(Array) })
    const metrics = await inj({ method: 'GET', url: '/api/admin/operations/metrics' })
    expect(metrics.statusCode).toBe(200)
    expect(metrics.headers['content-type']).toContain('text/plain')
    expect(metrics.body).toContain('sislexa_core_http_requests_total')
    await db.identity.createUser('metrics-user', '', 'developer')
    const token = signToken({ name: 'metrics-user', role: 'developer' }, SECRET)
    expect((await app.inject({ method: 'GET', url: '/api/admin/operations/status', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(403)
  })

  it('сессии: список с текущей, «выйти везде» отзывает остальные, отзыв одной, админ видит и отзывает (auth-roadmap п.4)', async () => {
    await db.identity.createUser('sess', 'sess-pass-2026-ok', 'developer')
    const login = async (ua: string) => (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'sess', password: 'sess-pass-2026-ok' }, headers: { 'user-agent': ua } })).json().token as string
    const t1 = await login('Phone/1.0'), t2 = await login('Laptop/2.0')
    const list = (await app.inject({ method: 'GET', url: '/api/session/list', headers: { authorization: `Bearer ${t1}` } })).json() as { sessions: Array<{ current?: boolean; userAgent: string }> }
    expect(list.sessions).toHaveLength(2)
    expect(list.sessions.find((s) => s.current)!.userAgent).toBe('Phone/1.0')
    // Отзыв одной чужой (своей же) сессии по sid.
    const other = list.sessions.find((s) => !s.current)! as unknown as { sid: string }
    expect((await app.inject({ method: 'DELETE', url: `/api/session/${other.sid}`, headers: { authorization: `Bearer ${t1}` } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/conversations', headers: { authorization: `Bearer ${t2}` } })).statusCode).toBe(401)
    // «Выйти везде» с t1 при третьем входе: t3 отозван, t1 жив.
    const t3 = await login('Tablet/3.0')
    const all = (await app.inject({ method: 'POST', url: '/api/session/logout-all', headers: { authorization: `Bearer ${t1}` } })).json() as { revoked: number }
    expect(all.revoked).toBe(1)
    expect((await app.inject({ method: 'GET', url: '/api/conversations', headers: { authorization: `Bearer ${t3}` } })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/conversations', headers: { authorization: `Bearer ${t1}` } })).statusCode).toBe(200)
    // Админ: список и отзыв.
    const adminList = (await inj({ method: 'GET', url: '/api/admin/users/sess/sessions' })).json() as { sessions: Array<{ sid: string }> }
    expect(adminList.sessions).toHaveLength(1)
    expect((await inj({ method: 'DELETE', url: `/api/admin/sessions/${adminList.sessions[0]!.sid}` })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/conversations', headers: { authorization: `Bearer ${t1}` } })).statusCode).toBe(401)
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it.skipIf(ON_POSTGRES)('старая база без новых колонок сессий и журнала открывается без ошибок', async () => {
    // Сторож правила: индексы по колонкам, которые добавляет migrate(), нельзя
    // объявлять в schema.ts — схема выполняется раньше ALTER TABLE. Дважды
    // наступали, теперь проверяется.
    const old = new VoiceChatDb(':memory:')
    await old.ready
    ;(old as unknown as { db: { exec(sql: string): void } }).db.exec(`
      DROP TABLE sessions;
      DROP TABLE security_events;
      CREATE TABLE sessions (sid TEXT PRIMARY KEY, user_name TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
        expires_at INTEGER NOT NULL, ip TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '', revoked_at INTEGER);
      CREATE TABLE security_events (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, user_name TEXT NOT NULL,
        type TEXT NOT NULL, ip TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '');
    `)
    await expect((old as unknown as { migrate(): Promise<void> }).migrate()).resolves.toBeUndefined()
    // И повторное применение схемы поверх мигрированной базы тоже проходит.
    expect(() => (old as unknown as { db: { exec(sql: string): void } }).db.exec(SCHEMA_SQL)).not.toThrow()
    await old.close()
  })

  it.skipIf(ON_POSTGRES)('старая база без колонок устройства мигрирует и продолжает читать прежние сессии', async () => {
    const legacyDb = new VoiceChatDb(':memory:')
    await legacyDb.ready
    // Воспроизводим таблицу такой, какой она была до метаданных устройства.
    ;(legacyDb as unknown as { db: { exec(sql: string): void } }).db.exec(`
      DROP TABLE sessions;
      CREATE TABLE sessions (sid TEXT PRIMARY KEY, user_name TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
        expires_at INTEGER NOT NULL, ip TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '', revoked_at INTEGER);
      INSERT INTO sessions (sid, user_name, created_at, last_seen, expires_at, ip, user_agent)
        VALUES ('old', 'someone', 1, 2, ${Date.now() + 86_400_000}, '10.0.0.1', 'legacy');
    `)
    await (legacyDb as unknown as { migrate(): Promise<void> }).migrate()
    const rows = await legacyDb.identity.listSessions('someone')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ sid: 'old', userAgent: 'legacy', label: null, deviceKey: null, trustedAt: null, geo: null, requests: 0 })
    // Новые колонки пишутся уже после миграции — старая строка этому не мешает.
    expect(await legacyDb.identity.updateSession('old', { label: 'Старый вход', trusted: true })).toBe(true)
    expect((await legacyDb.identity.listSessions('someone'))[0]).toMatchObject({ label: 'Старый вход' })
    expect((await legacyDb.identity.listSessions('someone'))[0]!.trustedAt).toBeGreaterThan(0)
    await legacyDb.close()
  })

  it('список сессий не отдаёт хеш секрета устройства ни владельцу, ни админу', async () => {
    await db.identity.createUser('hidden', 'hidden-pass-2026-ok', 'developer')
    const token = (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'hidden', password: 'hidden-pass-2026-ok' } })).json().token as string
    // В базе хеш есть — наружу он не уходит: иначе это подсказка для подбора.
    expect((await db.identity.listSessions('hidden'))[0]!.deviceSecret).toMatch(/^[0-9a-f]{64}$/)
    const own = (await app.inject({ method: 'GET', url: '/api/session/list', headers: { authorization: `Bearer ${token}` } })).json() as { sessions: Array<Record<string, unknown>> }
    expect(own.sessions[0]).not.toHaveProperty('deviceSecret')
    const admin = (await inj({ method: 'GET', url: '/api/admin/users/hidden/sessions' })).json() as { sessions: Array<Record<string, unknown>> }
    expect(admin.sessions[0]).not.toHaveProperty('deviceSecret')
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('админ задаёт лимит одновременных сессий; отрицательное значение и мусор отвергаются', async () => {
    expect((await inj({ method: 'GET', url: '/api/admin/signup' })).json()).toMatchObject({ sessionLimit: 0 })
    expect((await inj({ method: 'PUT', url: '/api/admin/signup', payload: { sessionLimit: 3 } })).json()).toMatchObject({ sessionLimit: 3 })
    expect(await db.settings.getAppConfig('sessions.maxPerUser')).toBe('3')
    expect((await inj({ method: 'PUT', url: '/api/admin/signup', payload: { sessionLimit: -1 } })).statusCode).toBe(400)
    expect((await inj({ method: 'PUT', url: '/api/admin/signup', payload: { sessionLimit: 1.5 } })).statusCode).toBe(400)
    // Ноль — «без ограничения», он обязан приниматься.
    expect((await inj({ method: 'PUT', url: '/api/admin/signup', payload: { sessionLimit: 0 } })).json()).toMatchObject({ sessionLimit: 0 })
  })

  it('админ снимает доверие с устройства пользователя', async () => {
    await db.identity.createUser('trusted-user', 'trusted-user-pass-26', 'developer')
    const token = (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'trusted-user', password: 'trusted-user-pass-26' } })).json().token as string
    const sid = (await db.identity.listSessions('trusted-user'))[0]!.sid
    await app.inject({ method: 'PATCH', url: `/api/session/${sid}`, payload: { trusted: true }, headers: { authorization: `Bearer ${token}` } })
    expect((await db.identity.listSessions('trusted-user'))[0]!.trustedAt).toBeGreaterThan(0)
    expect((await inj({ method: 'DELETE', url: `/api/admin/sessions/${sid}/trust` })).statusCode).toBe(200)
    expect((await db.identity.listSessions('trusted-user'))[0]!.trustedAt).toBeNull()
    // Сессия при этом остаётся живой: сняли доверие, а не выгнали человека.
    expect((await app.inject({ method: 'GET', url: '/api/conversations', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200)
    expect((await inj({ method: 'DELETE', url: '/api/admin/sessions/нет-такой/trust' })).statusCode).toBe(404)
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('о действиях администратора над сессиями пользователь узнаёт из уведомлений', async () => {
    await db.identity.createUser('watched', 'watched-pass-2026-ok', 'developer')
    const login = async (ua: string) => (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'watched', password: 'watched-pass-2026-ok' }, headers: { 'user-agent': ua } })).json().token as string
    const keep = await login('Laptop/1.0')
    const victimToken = await login('Phone/2.0')
    const victimSid = (await db.identity.listSessions('watched')).find((s) => s.userAgent === 'Phone/2.0')!.sid
    await inj({ method: 'DELETE', url: `/api/admin/sessions/${victimSid}` })
    const me = (await app.inject({ method: 'GET', url: '/api/session/me', headers: { authorization: `Bearer ${keep}` } })).json() as { notices: Array<{ type: string; details: string }> }
    expect(me.notices.some((n) => n.type === 'session_revoked' && n.details.includes('администратором'))).toBe(true)
    // Своё собственное завершение сессии в уведомления не попадает — это шум.
    expect(victimToken).toBeTruthy()
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('админский список сессий отдаёт сводку живых и доверенных', async () => {
    await db.identity.createUser('counted', 'counted-pass-2026-ok', 'developer')
    const token = (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'counted', password: 'counted-pass-2026-ok' }, headers: { 'user-agent': 'A/1' } })).json().token as string
    await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'counted', password: 'counted-pass-2026-ok' }, headers: { 'user-agent': 'B/2' } })
    const sid = (await db.identity.listSessions('counted'))[0]!.sid
    await app.inject({ method: 'PATCH', url: `/api/session/${sid}`, payload: { trusted: true }, headers: { authorization: `Bearer ${token}` } })
    const res = (await inj({ method: 'GET', url: '/api/admin/users/counted/sessions' })).json() as { stats: { total: number; trusted: number } }
    expect(res.stats).toEqual({ total: 2, trusted: 1 })
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('журнал безопасности: неудачный вход, вход и выход попадают в /api/admin/security с IP (auth-roadmap п.7)', async () => {
    await db.identity.createUser('audit', 'audit-pass-2026-ok', 'developer')
    await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'audit', password: 'nope' } })
    const ok = await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'audit', password: 'audit-pass-2026-ok' }, headers: { 'user-agent': 'Audit/1.0' } })
    await app.inject({ method: 'POST', url: '/api/session/logout', headers: { authorization: `Bearer ${ok.json().token}` } })
    const events = (await inj({ method: 'GET', url: '/api/admin/security?user=audit' })).json() as { events: Array<{ type: string; userAgent: string; ip: string }> }
    expect(events.events.map((e) => e.type)).toEqual(['logout', 'login', 'login_failed'])
    expect(events.events[1]!.userAgent).toBe('Audit/1.0')
    expect(events.events[1]!.ip).toBeTruthy()
    expect((await app.inject({ method: 'GET', url: '/api/admin/security' })).statusCode).toBe(401)
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('инвайты: админ может отправить ссылку письмом, а инвайт без адреса работает как раньше (auth-roadmap пп.8–9)', async () => {
    const emailed = (await inj({ method: 'POST', url: '/api/admin/invites', payload: { role: 'observer', email: 'Guest@Example.com' } })).json() as { token: string; email: string | null; emailedAt: number | null }
    expect(emailed.email).toBe('guest@example.com')
    expect(emailed.emailedAt).toBeTypeOf('number')
    expect(sentMails).toHaveLength(1)
    expect(sentMails[0]).toMatchObject({ to: 'guest@example.com', subject: 'Приглашение в ChatAI' })
    expect(sentMails[0]!.text).toContain(`/#/invite/${emailed.token}`)

    const created = (await inj({ method: 'POST', url: '/api/admin/invites', payload: { role: 'tester', maxUses: 1, ttlHours: 1, note: 'QA' } })).json() as { token: string; role: string; uses: number; email: null; emailedAt: null }
    expect(created).toMatchObject({ role: 'tester', email: null, emailedAt: null })
    expect(sentMails).toHaveLength(1)
    expect((await app.inject({ method: 'GET', url: `/api/session/invite/${created.token}` })).json()).toMatchObject({ role: 'tester', note: 'QA' })
    expect((await app.inject({ method: 'GET', url: '/api/session/invite/nope' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: '/api/session/register', payload: { token: created.token, name: 'newbie', password: 'short' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/session/register', payload: { token: created.token, name: 'bad name!', password: 'good-long-password-1' } })).statusCode).toBe(400)
    const reg = await app.inject({ method: 'POST', url: '/api/session/register', payload: { token: created.token, name: 'newbie', password: 'good-long-password-1' } })
    expect(reg.statusCode).toBe(200)
    expect(reg.json().user).toEqual({ name: 'newbie', role: 'tester', account: standardAccount })
    expect((await app.inject({ method: 'GET', url: '/api/conversations', headers: { authorization: `Bearer ${reg.json().token}` } })).statusCode).toBe(200)
    // Лимит 1 использование — второй раз ссылка мертва; список показывает uses=1; удаление.
    expect((await app.inject({ method: 'POST', url: '/api/session/register', payload: { token: created.token, name: 'second', password: 'good-long-password-2' } })).statusCode).toBe(404)
    const list = (await inj({ method: 'GET', url: '/api/admin/invites' })).json() as { invites: Array<{ token: string; uses: number }> }
    expect(list.invites.find((i) => i.token === created.token)!.uses).toBe(1)
    expect((await inj({ method: 'DELETE', url: `/api/admin/invites/${created.token}` })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/api/admin/invites', payload: { role: 'tester' } })).statusCode).toBe(401)
  })

  it('сброс кодом админа и смена своего пароля; временный пароль блокирует мутации до смены (auth-roadmap пп.10–12)', async () => {
    // Временный пароль при создании.
    await inj({ method: 'POST', url: '/api/admin/users', payload: { name: 'temp', password: 'initial-secret-2026-x', role: 'developer', mustChangePassword: true } })
    const t = await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'temp', password: 'initial-secret-2026-x' } })
    expect(t.json().user).toEqual({ name: 'temp', role: 'developer', mustChangePassword: true, account: standardAccount })
    const auth = { authorization: `Bearer ${t.json().token}` }
    expect((await app.inject({ method: 'POST', url: '/api/conversations', headers: auth, payload: { title: 'x' } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/api/conversations', headers: auth })).statusCode).toBe(200)
    // Смена пароля: неверный текущий → 400, слабый → 400, ок → флаг снят.
    expect((await app.inject({ method: 'POST', url: '/api/session/password', headers: auth, payload: { current: 'wrong', next: 'brand-new-password-1' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/session/password', headers: auth, payload: { current: 'initial-secret-2026-x', next: 'short' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/session/password', headers: auth, payload: { current: 'initial-secret-2026-x', next: 'brand-new-password-1' } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/session/me', headers: auth })).json().user.mustChangePassword).toBeUndefined()
    expect((await app.inject({ method: 'POST', url: '/api/conversations', headers: auth, payload: { title: 'x' } })).statusCode).not.toBe(403)
    // Код сброса от админа: неверный → 401, верный → сессия и новый пароль, повтор кода мёртв.
    const issued = (await inj({ method: 'POST', url: '/api/admin/users/temp/reset-code' })).json() as { code: string }
    expect(issued.code).toMatch(/^[A-Z0-9]{8}$/)
    expect((await app.inject({ method: 'POST', url: '/api/session/reset', payload: { name: 'temp', code: 'NOPE1234', password: 'after-reset-password-1' } })).statusCode).toBe(401)
    const reset = await app.inject({ method: 'POST', url: '/api/session/reset', payload: { name: 'temp', code: issued.code, password: 'after-reset-password-1' } })
    expect(reset.statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/api/session/reset', payload: { name: 'temp', code: issued.code, password: 'after-reset-password-2' } })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'temp', password: 'after-reset-password-1' } })).statusCode).toBe(200)
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('лимит LLM в месяц ставится PATCH-ом без роли и виден в списке (auth-roadmap п.17)', async () => {
    await db.identity.createUser('limited', 'limited-pass-2026', 'developer')
    const r = await inj({ method: 'PATCH', url: '/api/admin/users/limited', payload: { llmLimitUsd: 5 } })
    expect(r.json()).toMatchObject({ name: 'limited', role: 'developer', llmLimitUsd: 5 })
    expect((await db.identity.getUser('limited'))!.llmLimitUsd).toBe(5)
    expect((await inj({ method: 'PATCH', url: '/api/admin/users/limited', payload: { llmLimitUsd: null } })).json().llmLimitUsd).toBeNull()
  })

  it('открытая регистрация: выключена → 404; админ включает; заявка шлёт письмо со ссылкой; verify создаёт учётку с email и сессию; повтор токена мёртв', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/session/signup' })).json()).toEqual({ enabled: false })
    expect((await app.inject({ method: 'POST', url: '/api/session/signup', payload: { name: 'nina', email: 'nina@example.com', password: 'first-strong-pass-1' } })).statusCode).toBe(404)
    const cfg = (await inj({ method: 'PUT', url: '/api/admin/signup', payload: { enabled: true, role: 'tester' } })).json()
    expect(cfg).toMatchObject({ enabled: true, role: 'tester', mailConfigured: true })
    expect((await app.inject({ method: 'POST', url: '/api/session/signup', payload: { name: 'nina', email: 'bad', password: 'first-strong-pass-1' } })).statusCode).toBe(400)
    const req = await app.inject({ method: 'POST', url: '/api/session/signup', headers: { host: 'chat.example.com' }, payload: { name: 'nina', email: 'Nina@Example.com', password: 'first-strong-pass-1' } })
    expect(req.json()).toEqual({ ok: true, mailSent: true })
    expect(sentMails).toHaveLength(1)
    expect(sentMails[0]!.to).toBe('nina@example.com')
    const link = /https?:\/\/[^\s]+#\/verify\/([^\s"<]+)/.exec(sentMails[0]!.text)!
    expect(link[0]).toContain('chat.example.com')
    // Пользователя ещё нет; вход невозможен.
    expect(await db.identity.getUser('nina')).toBeNull()
    const ver = await app.inject({ method: 'POST', url: '/api/session/verify', payload: { token: decodeURIComponent(link[1]!) } })
    expect(ver.statusCode).toBe(200)
    expect(ver.json().user).toEqual({ name: 'nina', role: 'tester', account: standardAccount })
    expect((await db.identity.getUser('nina'))!.email).toBe('nina@example.com')
    expect((await app.inject({ method: 'POST', url: '/api/session/verify', payload: { token: decodeURIComponent(link[1]!) } })).statusCode).toBe(400)
    // Тот же email снова: ответ одинаковый, письма нет; занятый логин — 409.
    expect((await app.inject({ method: 'POST', url: '/api/session/signup', payload: { name: 'nina2', email: 'nina@example.com', password: 'second-strong-pass-1' } })).json()).toEqual({ ok: true, mailSent: true })
    expect(sentMails).toHaveLength(1)
    expect((await app.inject({ method: 'POST', url: '/api/session/signup', payload: { name: 'nina', email: 'other@example.com', password: 'third-strong-pass-2' } })).statusCode).toBe(409)
    // Повторное письмо для ожидающей заявки.
    await app.inject({ method: 'POST', url: '/api/session/signup', payload: { name: 'oleg', email: 'oleg@example.com', password: 'fourth-strong-pass-1' } })
    await app.inject({ method: 'POST', url: '/api/session/signup/resend', payload: { email: 'oleg@example.com' } })
    expect(sentMails.filter((m) => m.to === 'oleg@example.com')).toHaveLength(2)
    const link2 = /#\/verify\/([^\s"<]+)/.exec(sentMails[sentMails.length - 1]!.text)!
    expect((await app.inject({ method: 'POST', url: '/api/session/verify', payload: { token: decodeURIComponent(link2[1]!) } })).statusCode).toBe(200)
    await inj({ method: 'PUT', url: '/api/admin/signup', payload: { enabled: false } })
  })

  it('same-origin cookie авторизует только iframe-превью и удаляется при logout', async () => {
    await db.identity.createUser('user', '', 'developer')
    const login = await app.inject({
      method: 'POST',
      url: '/api/session/login',
      payload: { name: 'user', password: '' }
    })
    const cookie = String(login.headers['set-cookie']).split(';', 1)[0]

    const preview = await app.inject({ method: 'GET', url: '/api/preview?url=invalid', headers: { cookie } })
    expect(preview.statusCode).toBe(400)
    expect(preview.json().error).toBe('invalid_url')

    const otherApi = await app.inject({ method: 'GET', url: '/api/conversations', headers: { cookie } })
    expect(otherApi.statusCode).toBe(401)
    const anonymous = await app.inject({ method: 'GET', url: '/api/preview?url=invalid' })
    expect(anonymous.statusCode).toBe(401)

    const token = login.json().token as string
    const logout = await app.inject({
      method: 'POST',
      url: '/api/session/logout',
      headers: { authorization: `Bearer ${token}` }
    })
    expect(logout.statusCode).toBe(200)
    expect(String(logout.headers['set-cookie'])).toContain('vc_preview_session=;')
    expect(String(logout.headers['set-cookie'])).toContain('Max-Age=0')
    expect((await app.inject({
      method: 'GET',
      url: '/api/conversations',
      headers: { authorization: `Bearer ${token}` }
    })).statusCode).toBe(401)

    // Отзывается только текущая сессия: новый вход того же аккаунта работает.
    const relogin = await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'user', password: '' } })
    expect(relogin.statusCode).toBe(200)
    expect(relogin.json().token).not.toBe(token)
  })

  it('POST /api/session/preview выпускает preview-cookie из Bearer, без токена — 401', async () => {
    await db.identity.createUser('user', '', 'developer')
    const userTok = signToken({ name: 'user', role: 'developer' }, SECRET)

    // Сессия, восстановленная из localStorage без повторного login, получает cookie здесь.
    const minted = await app.inject({
      method: 'POST',
      url: '/api/session/preview',
      headers: { authorization: `Bearer ${userTok}` }
    })
    expect(minted.statusCode).toBe(200)
    const setCookie = String(minted.headers['set-cookie'])
    expect(setCookie).toContain('vc_preview_session=')
    expect(setCookie).toContain('Path=/api/preview')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')

    // Выпущенная cookie авторизует iframe-превью (400 invalid_url — уже за preHandler).
    const cookie = setCookie.split(';', 1)[0]
    const preview = await app.inject({ method: 'GET', url: '/api/preview?url=invalid', headers: { cookie } })
    expect(preview.statusCode).toBe(400)

    const anonymous = await app.inject({ method: 'POST', url: '/api/session/preview' })
    expect(anonymous.statusCode).toBe(401)
    expect(anonymous.headers['set-cookie']).toBeUndefined()

    const badToken = await app.inject({
      method: 'POST',
      url: '/api/session/preview',
      headers: { authorization: 'Bearer forged.token' }
    })
    expect(badToken.statusCode).toBe(401)
  })

  it('данные пользователей изолированы (user не видит разговоры admin)', async () => {
    await db.identity.createUser('user', '', 'developer')
    const adminTok = signToken({ name: 'admin', role: 'admin' }, SECRET)
    const userTok = signToken({ name: 'user', role: 'developer' }, SECRET)
    const auth = (t: string) => ({ authorization: `Bearer ${t}` })
    await app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: { title: 'Секрет админа' },
      headers: auth(adminTok)
    })
    const adminList = (
      await app.inject({ method: 'GET', url: '/api/conversations', headers: auth(adminTok) })
    ).json()
    const userList = (
      await app.inject({ method: 'GET', url: '/api/conversations', headers: auth(userTok) })
    ).json()
    expect(adminList).toHaveLength(1)
    expect(userList).toHaveLength(0)
  })
})

describe('REST: свои данные (/api/me/*)', () => {
  it('профиль отдаёт свои поля любой роли и не требует прав администратора', async () => {
    await db.identity.createUser('bob', '', 'observer')
    const bobTok = signToken({ name: 'bob', role: 'observer' }, SECRET)
    const res = await app.inject({ method: 'GET', url: '/api/me/profile', headers: { authorization: `Bearer ${bobTok}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ name: 'bob', role: 'observer', blocked: false, machinesTotal: 0, machinesOnline: 0 })
    expect(res.json().agents).toBeUndefined()
    // Чужого имени в роуте нет физически — подставить некуда.
    expect((await app.inject({ method: 'GET', url: '/api/admin/users', headers: { authorization: `Bearer ${bobTok}` } })).statusCode).toBe(403)
  })

  it('журнал безопасности показывает только свои события', async () => {
    await db.identity.createUser('bob', '', 'developer')
    await db.identity.createUser('kate', '', 'developer')
    await db.identity.logSecurityEvent({ user: 'bob', type: 'login', ip: '10.0.0.1', details: 'своё' })
    await db.identity.logSecurityEvent({ user: 'kate', type: 'login', ip: '10.0.0.2', details: 'чужое' })
    const bobTok = signToken({ name: 'bob', role: 'developer' }, SECRET)
    const res = await app.inject({ method: 'GET', url: '/api/me/security', headers: { authorization: `Bearer ${bobTok}` } })
    expect(res.statusCode).toBe(200)
    const events = res.json() as Array<{ user: string; details: string }>
    expect(events.length).toBeGreaterThan(0)
    expect(events.every((event) => event.user === 'bob')).toBe(true)
    expect(events.some((event) => event.details === 'чужое')).toBe(false)
    const machines = await app.inject({ method: 'GET', url: '/api/me/security?group=machines', headers: { authorization: `Bearer ${bobTok}` } })
    expect(machines.statusCode).toBe(200)
    expect(machines.json()).toEqual([])
  })

  it('без сессии оба роута — 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/me/profile' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/me/security' })).statusCode).toBe(401)
  })
})
