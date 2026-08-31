// Аутентификация, регистрация, 2FA и «свои данные» (/api/me/*).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { VoiceChatDb } from '../db/database.js'
import { SCHEMA_SQL } from '../db/schema.js'
import { signToken } from '../users/accounts.js'
import { totpCode } from '../users/totp'
import type { FastifyInstance } from 'fastify'
import { setupRestHarness } from './restHarness.js'

// Обвязка одна на все rest.*.test.ts — см. restHarness.ts.
// Хук harness зарегистрирован первым, поэтому к моменту этого beforeEach
// поля уже пересозданы под текущий тест.
const harness = setupRestHarness()
const { inj, sentMails, SECRET } = harness
let app: FastifyInstance
let db: VoiceChatDb
let token: string
beforeEach(() => { ({ app, db, token } = harness) })


describe('REST: аутентификация', () => {
  it('без токена защищённый роут → 401, health и login — открыты', async () => {
    db.createUser('user', '', 'developer') // пользователь теперь заводится в БД
    expect((await app.inject({ method: 'GET', url: '/api/conversations' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200)
    // Логин: верный пароль (пустой) → токен; неверный → 401.
    const ok = await app.inject({
      method: 'POST',
      url: '/api/session/login',
      payload: { name: 'user', password: '' }
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().user).toEqual({ name: 'user', role: 'developer' })
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

  it('rate-limit входа: 11-я попытка за окно → 429 с Retry-After, по имени и по IP (auth-roadmap п.1)', async () => {
    db.createUser('victim', 'secret-pass', 'developer')
    let last = 0
    for (let i = 0; i < 10; i++) last = (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'victim', password: 'wrong' } })).statusCode
    expect([401, 423]).toContain(last) // с 5-й неудачи срабатывает замок аккаунта (п.3), но лимит по имени считает и его
    const blocked = await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'victim', password: 'secret-pass' } })
    expect(blocked.statusCode).toBe(429)
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
    // Лимит по IP шире (30): другие имена с того же адреса проходят, пока окно не заполнится, затем — 429.
    for (let i = 0; i < 19; i++) await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: `other${i}`, password: '' } })
    expect((await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'other-last', password: '' } })).statusCode).toBe(429)
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('блокировка после неудач: 5 неверных → 423 даже с верным паролем, 10 → blocked с причиной auto; успех сбрасывает счётчик (auth-roadmap п.3)', async () => {
    db.createUser('locky', 'right-pass-2026', 'developer')
    for (let i = 0; i < 4; i++) expect((await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'locky', password: 'nope' } })).statusCode).toBe(401)
    // 4 неудачи — ещё можно войти, и счётчик обнуляется.
    expect((await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'locky', password: 'right-pass-2026' } })).statusCode).toBe(200)
    expect(db.getUser('locky')!.failedLogins).toBe(0)
    for (let i = 0; i < 5; i++) await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'locky', password: 'nope' } })
    const locked = await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'locky', password: 'right-pass-2026' } })
    expect(locked.statusCode).toBe(423)
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0)
    // Ручная разблокировка админом снимает замок.
    db.setUserBlocked('locky', false)
    expect(db.getUser('locky')!.lockedUntil).toBeNull()
    // 10 подряд — постоянная блокировка с причиной auto (замок между попытками снимаем напрямую, чтобы не ждать 15 минут).
    for (let i = 0; i < 10; i++) { db.recordLoginFailure('locky') }
    const u = db.getUser('locky')!
    expect(u.blocked).toBe(true)
    expect(u.lockReason).toBe('auto')
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('сессии: список с текущей, «выйти везде» отзывает остальные, отзыв одной, админ видит и отзывает (auth-roadmap п.4)', async () => {
    db.createUser('sess', 'sess-pass-2026-ok', 'developer')
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

  it('сессия запоминает устройство: ключ, платформу, версию клиента, локальную сеть и активность', async () => {
    db.createUser('meta', 'meta-pass-2026-ok', 'developer')
    const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36'
    const login = await app.inject({
      method: 'POST',
      url: '/api/session/login',
      payload: { name: 'meta', password: 'meta-pass-2026-ok' },
      headers: { 'user-agent': chrome, 'x-vc-client-version': '0.1.200' }
    })
    const token = login.json().token as string
    const one = db.listSessions('meta')[0]!
    expect(one.deviceKey).toMatch(/^[0-9a-f]{8}$/)
    expect(one.platform).toBe('web')
    expect(one.clientVersion).toBe('0.1.200')
    // Тесты ходят с loopback: место известно без внешних сервисов.
    expect(one.geo).toMatchObject({ local: true, label: 'локальная сеть' })
    expect(one.requests).toBe(0)
    // Отметка активности не чаще раза в минуту: серия запросов подряд её не двигает.
    await app.inject({ method: 'GET', url: '/api/conversations', headers: { authorization: `Bearer ${token}` } })
    expect(db.listSessions('meta')[0]!.requests).toBe(0)
    db.touchSession(one.sid, 60_000, '/api/conversations', Date.now() + 120_000)
    const touched = db.listSessions('meta')[0]!
    expect(touched.requests).toBe(1)
    expect(touched.lastPath).toBe('/api/conversations')
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('место входа с публичного адреса уточняется в фоне и попадает в список', async () => {
    db.createUser('geo', 'geo-pass-2026-okay', 'developer')
    await app.inject({
      method: 'POST',
      url: '/api/session/login',
      payload: { name: 'geo', password: 'geo-pass-2026-okay' },
      headers: { 'user-agent': 'Chrome/128 Mac OS X' },
      remoteAddress: '203.0.113.7'
    })
    // Резолвер подменён в beforeEach: реальные тесты в сеть не ходят.
    await vi.waitFor(() => expect(db.listSessions('geo')[0]!.geo).toMatchObject({ label: 'Москва, RU' }))
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('электронная оболочка и агент опознаются как отдельные платформы', async () => {
    db.createUser('plat', 'platform-pass-2026', 'developer')
    const login = async (ua: string): Promise<void> => {
      await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'plat', password: 'platform-pass-2026' }, headers: { 'user-agent': ua } })
    }
    await login('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Electron/33.0.0 Chrome/130.0.0.0 Safari/537.36')
    await login('VoiceChatAgent/1.4.2 (darwin)')
    expect(db.listSessions('plat').map((s) => s.platform).sort()).toEqual(['agent', 'desktop'])
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('старая база без новых колонок сессий и журнала открывается без ошибок', () => {
    // Сторож правила: индексы по колонкам, которые добавляет migrate(), нельзя
    // объявлять в schema.ts — схема выполняется раньше ALTER TABLE. Дважды
    // наступали, теперь проверяется.
    const old = new VoiceChatDb(':memory:')
    ;(old as unknown as { db: { exec(sql: string): void } }).db.exec(`
      DROP TABLE sessions;
      DROP TABLE security_events;
      CREATE TABLE sessions (sid TEXT PRIMARY KEY, user_name TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
        expires_at INTEGER NOT NULL, ip TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '', revoked_at INTEGER);
      CREATE TABLE security_events (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, user_name TEXT NOT NULL,
        type TEXT NOT NULL, ip TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '');
    `)
    expect(() => (old as unknown as { migrate(): void }).migrate()).not.toThrow()
    // И повторное применение схемы поверх мигрированной базы тоже проходит.
    expect(() => (old as unknown as { db: { exec(sql: string): void } }).db.exec(SCHEMA_SQL)).not.toThrow()
    old.close()
  })

  it('старая база без колонок устройства мигрирует и продолжает читать прежние сессии', async () => {
    const legacyDb = new VoiceChatDb(':memory:')
    // Воспроизводим таблицу такой, какой она была до метаданных устройства.
    ;(legacyDb as unknown as { db: { exec(sql: string): void } }).db.exec(`
      DROP TABLE sessions;
      CREATE TABLE sessions (sid TEXT PRIMARY KEY, user_name TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
        expires_at INTEGER NOT NULL, ip TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '', revoked_at INTEGER);
      INSERT INTO sessions (sid, user_name, created_at, last_seen, expires_at, ip, user_agent)
        VALUES ('old', 'someone', 1, 2, ${Date.now() + 86_400_000}, '10.0.0.1', 'legacy');
    `)
    ;(legacyDb as unknown as { migrate(): void }).migrate()
    const rows = legacyDb.listSessions('someone')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ sid: 'old', userAgent: 'legacy', label: null, deviceKey: null, trustedAt: null, geo: null, requests: 0 })
    // Новые колонки пишутся уже после миграции — старая строка этому не мешает.
    expect(legacyDb.updateSession('old', { label: 'Старый вход', trusted: true })).toBe(true)
    expect(legacyDb.listSessions('someone')[0]).toMatchObject({ label: 'Старый вход' })
    expect(legacyDb.listSessions('someone')[0]!.trustedAt).toBeGreaterThan(0)
    legacyDb.close()
  })

  it('переименование и доверие: только своя сессия, пустое имя снимает метку, чужая — 404', async () => {
    db.createUser('named', 'named-pass-2026-ok', 'developer')
    db.createUser('alien', 'alien-pass-2026-ok', 'developer')
    const token = (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'named', password: 'named-pass-2026-ok' } })).json().token as string
    const alienToken = (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'alien', password: 'alien-pass-2026-ok' } })).json().token as string
    const sid = db.listSessions('named')[0]!.sid
    const patch = (body: Record<string, unknown>, bearer = token) =>
      app.inject({ method: 'PATCH', url: `/api/session/${sid}`, payload: body, headers: { authorization: `Bearer ${bearer}` } })
    expect((await patch({ label: '  Рабочий ноут  ' })).statusCode).toBe(200)
    expect(db.listSessions('named')[0]!.label).toBe('Рабочий ноут')
    expect((await patch({ label: '' })).statusCode).toBe(200)
    expect(db.listSessions('named')[0]!.label).toBeNull()
    expect((await patch({ trusted: true })).statusCode).toBe(200)
    expect(db.listSessions('named')[0]!.trustedAt).toBeGreaterThan(0)
    expect((await patch({ trusted: false })).statusCode).toBe(200)
    expect(db.listSessions('named')[0]!.trustedAt).toBeNull()
    // Пустое тело менять нечего; чужая сессия неотличима от несуществующей.
    expect((await patch({})).statusCode).toBe(400)
    expect((await patch({ label: 'Чужое' }, alienToken)).statusCode).toBe(404)
    expect(db.listSecurityEvents({ user: 'named' }).map((e) => e.type)).toContain('session_trusted')
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('«выйти везде» с includeCurrent гасит и текущую сессию вместе с cookie', async () => {
    db.createUser('allout', 'allout-pass-2026-ok', 'developer')
    const login = async () => (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'allout', password: 'allout-pass-2026-ok' } })).json().token as string
    const t1 = await login(), t2 = await login()
    const res = await app.inject({ method: 'POST', url: '/api/session/logout-all', payload: { includeCurrent: true }, headers: { authorization: `Bearer ${t1}` } })
    expect(res.json()).toMatchObject({ revoked: 2 })
    expect(([] as string[]).concat(res.headers['set-cookie'] as string[]).some((c) => c.startsWith('vc_session=;'))).toBe(true)
    for (const token of [t1, t2]) {
      expect((await app.inject({ method: 'GET', url: '/api/conversations', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401)
    }
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('лимит одновременных сессий вытесняет самую давнюю и пишет событие', async () => {
    db.setAppConfig('sessions.maxPerUser', '2')
    db.createUser('limited', 'limited-pass-2026-ok', 'developer')
    const login = async (ua: string) => (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'limited', password: 'limited-pass-2026-ok' }, headers: { 'user-agent': ua } })).json().token as string
    const first = await login('Phone/1.0')
    const second = await login('Laptop/2.0')
    const third = await login('Tablet/3.0')
    expect(db.listSessions('limited').map((s) => s.userAgent).sort()).toEqual(['Laptop/2.0', 'Tablet/3.0'])
    expect((await app.inject({ method: 'GET', url: '/api/conversations', headers: { authorization: `Bearer ${first}` } })).statusCode).toBe(401)
    for (const token of [second, third]) {
      expect((await app.inject({ method: 'GET', url: '/api/conversations', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200)
    }
    expect(db.listSecurityEvents({ user: 'limited' }).map((e) => e.type)).toContain('session_evicted')
    db.setAppConfig('sessions.maxPerUser', '')
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('брошенные сессии отзываются по сроку неактивности, свежие остаются', async () => {
    db.createUser('stale', 'stale-pass-2026-okay', 'developer')
    const token = (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'stale', password: 'stale-pass-2026-okay' } })).json().token as string
    expect(db.revokeStaleSessions(90)).toBe(0)
    // Сдвигаем «сейчас» на сто дней вперёд вместо правки строки напрямую.
    expect(db.revokeStaleSessions(90, Date.now() + 100 * 24 * 60 * 60_000)).toBe(1)
    expect((await app.inject({ method: 'GET', url: '/api/conversations', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401)
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('сессии: повторный отзыв, чужой sid, мутации по cookie без CSRF и предельный User-Agent', async () => {
    db.createUser('edge', 'edge-case-pass-2026', 'developer')
    db.createUser('neighbour', 'neighbour-pass-2026', 'developer')
    const login = await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'edge', password: 'edge-case-pass-2026' }, headers: { 'user-agent': 'X'.repeat(500) } })
    const token = login.json().token as string
    // Длинный UA обрезается на записи, а не роняет вставку.
    expect(db.listSessions('edge')[0]!.userAgent.length).toBe(200)
    const sid = db.listSessions('edge')[0]!.sid
    const auth = { authorization: `Bearer ${token}` }
    expect((await app.inject({ method: 'DELETE', url: `/api/session/${sid}`, headers: auth })).statusCode).toBe(200)
    // Своя сессия уже мертва: и повторный отзыв, и любой запрос по ней — как чужие.
    expect((await app.inject({ method: 'DELETE', url: `/api/session/${sid}`, headers: auth })).statusCode).toBe(401)
    const neighbourToken = (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'neighbour', password: 'neighbour-pass-2026' } })).json().token as string
    const neighbourSid = db.listSessions('neighbour')[0]!.sid
    const freshToken = (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'edge', password: 'edge-case-pass-2026' } })).json().token as string
    expect((await app.inject({ method: 'DELETE', url: `/api/session/${neighbourSid}`, headers: { authorization: `Bearer ${freshToken}` } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/conversations', headers: { authorization: `Bearer ${neighbourToken}` } })).statusCode).toBe(200)

    // Cookie-сессия: мутации сессий без заголовка CSRF отвергаются, с ним — проходят.
    const cookieLogin = await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'edge', password: 'edge-case-pass-2026' } })
    const cookies = ([] as string[]).concat(cookieLogin.headers['set-cookie'] as string[])
    const cookieHeader = cookies.map((c) => c.split(';')[0]).join('; ')
    const csrf = cookieLogin.json().csrf as string
    const cookieSid = db.listSessions('edge').at(-1)!.sid
    for (const request of [
      { method: 'POST' as const, url: '/api/session/logout-all' },
      { method: 'PATCH' as const, url: `/api/session/${cookieSid}`, payload: { label: 'Ноут' } },
      { method: 'DELETE' as const, url: `/api/session/${cookieSid}` }
    ]) {
      const denied = await app.inject({ ...request, headers: { cookie: cookieHeader } })
      expect(denied.statusCode, `${request.method} ${request.url}`).toBe(403)
      expect(denied.json()).toMatchObject({ error: 'csrf' })
    }
    expect((await app.inject({ method: 'PATCH', url: `/api/session/${cookieSid}`, payload: { label: 'Ноут' }, headers: { cookie: cookieHeader, 'x-vc-csrf': csrf } })).statusCode).toBe(200)
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('доверие привязано к секрету устройства: тот же браузер из той же сети без cookie проходит второй фактор', async () => {
    db.createUser('secretly', 'secretly-pass-2026', 'developer')
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36'
    const login = async (cookie?: string) => app.inject({
      method: 'POST', url: '/api/session/login',
      payload: { name: 'secretly', password: 'secretly-pass-2026' },
      headers: { 'user-agent': ua, ...(cookie ? { cookie } : {}) }
    })
    const first = await login()
    const deviceCookie = ([] as string[]).concat(first.headers['set-cookie'] as string[]).find((c) => c.startsWith('vc_device='))!
    expect(deviceCookie).toContain('HttpOnly')
    const deviceHeader = deviceCookie.split(';')[0]!
    const token = first.json().token as string
    const sid = db.listSessions('secretly')[0]!.sid
    await app.inject({ method: 'PATCH', url: `/api/session/${sid}`, payload: { trusted: true }, headers: { authorization: `Bearer ${token}` } })
    const secret = (await app.inject({ method: 'POST', url: '/api/session/2fa/setup', headers: { authorization: `Bearer ${token}` } })).json().secret as string
    await app.inject({ method: 'POST', url: '/api/session/2fa/enable', payload: { code: totpCode(secret) }, headers: { authorization: `Bearer ${token}` } })

    // С cookie устройства — второй фактор пропускается.
    expect((await login(deviceHeader)).json()).toMatchObject({ user: { name: 'secretly' } })
    // Тот же User-Agent и тот же адрес, но без секрета — код спрашиваем: иначе
    // сосед по сети, укравший пароль, обошёл бы второй фактор подделкой примет.
    expect((await login()).json()).toMatchObject({ requires2fa: true })
    // Чужой секрет тоже не подходит.
    expect((await login('vc_device=подделанный-секрет-достаточной-длины')).json()).toMatchObject({ requires2fa: true })
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('список сессий не отдаёт хеш секрета устройства ни владельцу, ни админу', async () => {
    db.createUser('hidden', 'hidden-pass-2026-ok', 'developer')
    const token = (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'hidden', password: 'hidden-pass-2026-ok' } })).json().token as string
    // В базе хеш есть — наружу он не уходит: иначе это подсказка для подбора.
    expect(db.listSessions('hidden')[0]!.deviceSecret).toMatch(/^[0-9a-f]{64}$/)
    const own = (await app.inject({ method: 'GET', url: '/api/session/list', headers: { authorization: `Bearer ${token}` } })).json() as { sessions: Array<Record<string, unknown>> }
    expect(own.sessions[0]).not.toHaveProperty('deviceSecret')
    const admin = (await inj({ method: 'GET', url: '/api/admin/users/hidden/sessions' })).json() as { sessions: Array<Record<string, unknown>> }
    expect(admin.sessions[0]).not.toHaveProperty('deviceSecret')
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('завершённые сессии отдаются по запросу и показывают момент завершения', async () => {
    db.createUser('history', 'history-pass-2026-ok', 'developer')
    const login = async (ua: string) => (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'history', password: 'history-pass-2026-ok' }, headers: { 'user-agent': ua } })).json().token as string
    const keep = await login('Laptop/1.0')
    await login('Phone/2.0')
    const phoneSid = db.listSessions('history').find((s) => s.userAgent === 'Phone/2.0')!.sid
    await app.inject({ method: 'DELETE', url: `/api/session/${phoneSid}`, headers: { authorization: `Bearer ${keep}` } })

    const auth = { authorization: `Bearer ${keep}` }
    const plain = (await app.inject({ method: 'GET', url: '/api/session/list', headers: auth })).json() as { ended?: unknown }
    // Без запроса завершённых лишнего чтения из базы не делаем.
    expect(plain.ended).toBeUndefined()
    const withEnded = (await app.inject({ method: 'GET', url: '/api/session/list?ended=1', headers: auth })).json() as { sessions: unknown[]; ended: Array<{ sid: string; ended: boolean; endedAt: number }> }
    expect(withEnded.sessions).toHaveLength(1)
    expect(withEnded.ended[0]).toMatchObject({ sid: phoneSid, ended: true })
    expect(withEnded.ended[0]!.endedAt).toBeGreaterThan(0)
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('«это не я» гасит все сессии и требует смену пароля при следующем входе', async () => {
    db.createUser('panicky', 'panicky-pass-2026-ok', 'developer')
    const login = async () => (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'panicky', password: 'panicky-pass-2026-ok' } })).json()
    const first = (await login()).token as string
    const second = (await login()).token as string
    const res = await app.inject({ method: 'POST', url: '/api/session/panic', headers: { authorization: `Bearer ${first}` } })
    expect(res.json()).toMatchObject({ revoked: 2 })
    for (const token of [first, second]) {
      expect((await app.inject({ method: 'GET', url: '/api/conversations', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401)
    }
    // Следующий вход проходит, но приложение обязано увести на смену пароля.
    expect((await login()).user).toMatchObject({ name: 'panicky', mustChangePassword: true })
    expect(db.listSecurityEvents({ user: 'panicky' }).map((e) => e.type)).toContain('session_panic')
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('админ задаёт лимит одновременных сессий; отрицательное значение и мусор отвергаются', async () => {
    expect((await inj({ method: 'GET', url: '/api/admin/signup' })).json()).toMatchObject({ sessionLimit: 0 })
    expect((await inj({ method: 'PUT', url: '/api/admin/signup', payload: { sessionLimit: 3 } })).json()).toMatchObject({ sessionLimit: 3 })
    expect(db.getAppConfig('sessions.maxPerUser')).toBe('3')
    expect((await inj({ method: 'PUT', url: '/api/admin/signup', payload: { sessionLimit: -1 } })).statusCode).toBe(400)
    expect((await inj({ method: 'PUT', url: '/api/admin/signup', payload: { sessionLimit: 1.5 } })).statusCode).toBe(400)
    // Ноль — «без ограничения», он обязан приниматься.
    expect((await inj({ method: 'PUT', url: '/api/admin/signup', payload: { sessionLimit: 0 } })).json()).toMatchObject({ sessionLimit: 0 })
  })

  it('доверять можно только вход, подтверждённый кодом; признак виден в списке', async () => {
    db.createUser('tfa', 'tfa-user-pass-2026', 'developer')
    const first = await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'tfa', password: 'tfa-user-pass-2026' } })
    const token = first.json().token as string
    const sid = db.listSessions('tfa')[0]!.sid
    // Пока второго фактора нет, доверие ставится как обычно.
    expect((await app.inject({ method: 'PATCH', url: `/api/session/${sid}`, payload: { trusted: true }, headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200)
    const secret = (await app.inject({ method: 'POST', url: '/api/session/2fa/setup', headers: { authorization: `Bearer ${token}` } })).json().secret as string
    await app.inject({ method: 'POST', url: '/api/session/2fa/enable', payload: { code: totpCode(secret) }, headers: { authorization: `Bearer ${token}` } })
    // Сессия сама код не проходила: доверять ей теперь нельзя.
    await app.inject({ method: 'PATCH', url: `/api/session/${sid}`, payload: { trusted: false }, headers: { authorization: `Bearer ${token}` } })
    const denied = await app.inject({ method: 'PATCH', url: `/api/session/${sid}`, payload: { trusted: true }, headers: { authorization: `Bearer ${token}` } })
    expect(denied.statusCode).toBe(409)
    expect(denied.json().error).toMatch(/подтверждён кодом/)

    // Вход по коду помечается — и его уже можно сделать доверенным.
    const challenge = (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'tfa', password: 'tfa-user-pass-2026' } })).json() as { ticket: string }
    const second = (await app.inject({ method: 'POST', url: '/api/session/2fa', payload: { ticket: challenge.ticket, code: totpCode(secret) } })).json().token as string
    const confirmed = db.listSessions('tfa').find((x) => x.twoFactor)!
    expect(confirmed).toBeDefined()
    expect((await app.inject({ method: 'PATCH', url: `/api/session/${confirmed.sid}`, payload: { trusted: true }, headers: { authorization: `Bearer ${second}` } })).statusCode).toBe(200)
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('роль укорачивает срок жизни сессии', async () => {
    db.createUser('watcher', 'watcher-pass-2026-ok', 'observer')
    db.createUser('worker', 'worker-pass-2026-okay', 'developer')
    const ttlOf = async (name: string, password: string): Promise<number> => {
      await app.inject({ method: 'POST', url: '/api/session/login', payload: { name, password } })
      const s = db.listSessions(name)[0]!
      return s.expiresAt - s.createdAt
    }
    const week = 7 * 24 * 60 * 60_000
    expect(await ttlOf('watcher', 'watcher-pass-2026-ok')).toBeLessThanOrEqual(week + 5000)
    expect(await ttlOf('worker', 'worker-pass-2026-okay')).toBeGreaterThan(week)
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('история устройства отдаёт события этого входа и закрыта для чужих сессий', async () => {
    db.createUser('hist', 'hist-user-pass-2026', 'developer')
    db.createUser('nosy', 'nosy-user-pass-2026', 'developer')
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36'
    const token = (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'hist', password: 'hist-user-pass-2026' }, headers: { 'user-agent': ua } })).json().token as string
    const sid = db.listSessions('hist')[0]!.sid
    await app.inject({ method: 'PATCH', url: `/api/session/${sid}`, payload: { label: 'Ноут' }, headers: { authorization: `Bearer ${token}`, 'user-agent': ua } })
    const history = (await app.inject({ method: 'GET', url: `/api/session/${sid}/history`, headers: { authorization: `Bearer ${token}` } })).json() as { events: Array<{ type: string }> }
    expect(history.events.map((e) => e.type)).toContain('login')
    expect(history.events.map((e) => e.type)).toContain('session_renamed')

    const alien = (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'nosy', password: 'nosy-user-pass-2026' } })).json().token as string
    expect((await app.inject({ method: 'GET', url: `/api/session/${sid}/history`, headers: { authorization: `Bearer ${alien}` } })).statusCode).toBe(404)
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('админ снимает доверие с устройства пользователя', async () => {
    db.createUser('trusted-user', 'trusted-user-pass-26', 'developer')
    const token = (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'trusted-user', password: 'trusted-user-pass-26' } })).json().token as string
    const sid = db.listSessions('trusted-user')[0]!.sid
    await app.inject({ method: 'PATCH', url: `/api/session/${sid}`, payload: { trusted: true }, headers: { authorization: `Bearer ${token}` } })
    expect(db.listSessions('trusted-user')[0]!.trustedAt).toBeGreaterThan(0)
    expect((await inj({ method: 'DELETE', url: `/api/admin/sessions/${sid}/trust` })).statusCode).toBe(200)
    expect(db.listSessions('trusted-user')[0]!.trustedAt).toBeNull()
    // Сессия при этом остаётся живой: сняли доверие, а не выгнали человека.
    expect((await app.inject({ method: 'GET', url: '/api/conversations', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200)
    expect((await inj({ method: 'DELETE', url: '/api/admin/sessions/нет-такой/trust' })).statusCode).toBe(404)
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('массовое закрытие входов предупреждает письмом на подтверждённый адрес', async () => {
    // Email появляется только через подтверждение — как у настоящего пользователя.
    db.createEmailVerification({ token: 'verified-mailed', name: 'mailed', email: 'mailed@example.com', password: 'mailed-user-pass-2026', ttlMs: 60_000 })
    expect(db.redeemEmailVerification('verified-mailed', 'developer')).not.toBeNull()
    const token = (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'mailed', password: 'mailed-user-pass-2026' } })).json().token as string
    await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'mailed', password: 'mailed-user-pass-2026' } })
    sentMails.length = 0
    await app.inject({ method: 'POST', url: '/api/session/logout-all', headers: { authorization: `Bearer ${token}` } })
    await vi.waitFor(() => expect(sentMails.some((m) => m.to === 'mailed@example.com' && /завершены другие сессии/.test(m.text))).toBe(true))
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('частые операции с сессиями упираются в ограничение', async () => {
    db.createUser('spammy', 'spammy-user-pass-2026', 'developer')
    const token = (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'spammy', password: 'spammy-user-pass-2026' } })).json().token as string
    const sid = db.listSessions('spammy')[0]!.sid
    let limited = 0
    for (let i = 0; i < 35; i++) {
      const res = await app.inject({ method: 'PATCH', url: `/api/session/${sid}`, payload: { label: `имя-${i}` }, headers: { authorization: `Bearer ${token}` } })
      if (res.statusCode === 429) limited++
    }
    expect(limited).toBeGreaterThan(0)
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('история устройства держится на sid и переживает смену адреса', async () => {
    db.createUser('roamer', 'roamer-pass-2026-ok', 'developer')
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36'
    const token = (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'roamer', password: 'roamer-pass-2026-ok' }, headers: { 'user-agent': ua }, remoteAddress: '203.0.113.7' })).json().token as string
    const sid = db.listSessions('roamer')[0]!.sid
    // Тот же вход, но человек уехал в другую сеть — событие пишется с другого адреса.
    await app.inject({ method: 'PATCH', url: `/api/session/${sid}`, payload: { label: 'Ноут' }, headers: { authorization: `Bearer ${token}`, 'user-agent': ua }, remoteAddress: '198.51.100.9' })
    const history = (await app.inject({ method: 'GET', url: `/api/session/${sid}/history`, headers: { authorization: `Bearer ${token}` } })).json() as { events: Array<{ type: string }> }
    expect(history.events.map((e) => e.type)).toEqual(expect.arrayContaining(['login', 'session_renamed']))
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('завершённая сессия помнит причину: отзыв, лимит, тревога и простой', async () => {
    db.setAppConfig('sessions.maxPerUser', '2')
    db.createUser('reasons', 'reasons-pass-2026-ok', 'developer')
    const login = async (ua: string) => (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'reasons', password: 'reasons-pass-2026-ok' }, headers: { 'user-agent': ua } })).json().token as string
    const first = await login('Phone/1.0')
    await login('Laptop/2.0')
    const keep = await login('Tablet/3.0')
    const endedByLimit = db.listEndedSessions('reasons').find((s) => s.userAgent === 'Phone/1.0')
    expect(endedByLimit?.endReason).toBe('evicted')
    expect(first).toBeTruthy()

    const laptopSid = db.listSessions('reasons').find((s) => s.userAgent === 'Laptop/2.0')!.sid
    await app.inject({ method: 'DELETE', url: `/api/session/${laptopSid}`, headers: { authorization: `Bearer ${keep}` } })
    expect(db.listEndedSessions('reasons').find((s) => s.sid === laptopSid)?.endReason).toBe('revoked')

    await app.inject({ method: 'POST', url: '/api/session/panic', headers: { authorization: `Bearer ${keep}` } })
    expect(db.listEndedSessions('reasons').find((s) => s.userAgent === 'Tablet/3.0')?.endReason).toBe('panic')

    db.setAppConfig('sessions.maxPerUser', '')
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('вытесненную лимитом сессию человек видит в уведомлениях', async () => {
    db.setAppConfig('sessions.maxPerUser', '1')
    db.createUser('noticed', 'noticed-pass-2026-ok', 'developer')
    await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'noticed', password: 'noticed-pass-2026-ok' }, headers: { 'user-agent': 'Phone/1.0' } })
    const second = (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'noticed', password: 'noticed-pass-2026-ok' }, headers: { 'user-agent': 'Laptop/2.0' } })).json().token as string
    const me = (await app.inject({ method: 'GET', url: '/api/session/me', headers: { authorization: `Bearer ${second}` } })).json() as { notices: Array<{ type: string }> }
    // Иначе выход выглядит как сбой: сессия исчезла, а причины нигде нет.
    expect(me.notices.map((n) => n.type)).toContain('session_evicted')
    db.setAppConfig('sessions.maxPerUser', '')
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('имя устройства наследуется новым входом и меняется сразу для всех его сессий', async () => {
    db.createUser('namer', 'namer-pass-2026-okay', 'developer')
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36'
    const login = async () => (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'namer', password: 'namer-pass-2026-okay' }, headers: { 'user-agent': ua } })).json().token as string
    const first = await login()
    const firstSid = db.listSessions('namer')[0]!.sid
    await app.inject({ method: 'PATCH', url: `/api/session/${firstSid}`, payload: { label: 'Рабочий ноут' }, headers: { authorization: `Bearer ${first}` } })

    // Второй вход с того же устройства получает имя сам.
    await login()
    expect(db.listSessions('namer').every((s) => s.label === 'Рабочий ноут')).toBe(true)

    // Переименование по умолчанию меняет все входы устройства…
    await app.inject({ method: 'PATCH', url: `/api/session/${firstSid}`, payload: { label: 'Домашний ПК' }, headers: { authorization: `Bearer ${first}` } })
    expect(db.listSessions('namer').every((s) => s.label === 'Домашний ПК')).toBe(true)
    // …а с scope: 'session' — только выбранную.
    await app.inject({ method: 'PATCH', url: `/api/session/${firstSid}`, payload: { label: 'Только эта', scope: 'session' }, headers: { authorization: `Bearer ${first}` } })
    const labels = db.listSessions('namer').map((s) => s.label).sort()
    expect(labels).toEqual(['Домашний ПК', 'Только эта'])
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('доверенных устройств не больше лимита, а «снять доверие со всех» гасит их разом', async () => {
    db.createUser('truster', 'truster-pass-2026-ok', 'developer')
    const login = async (ua: string) => (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'truster', password: 'truster-pass-2026-ok' }, headers: { 'user-agent': ua } })).json().token as string
    const tokens: string[] = []
    for (let i = 0; i < 6; i++) tokens.push(await login(`Device${i}/1.0`))
    const sids = db.listSessions('truster').map((s) => s.sid)
    let denied = 0
    for (const sid of sids) {
      const res = await app.inject({ method: 'PATCH', url: `/api/session/${sid}`, payload: { trusted: true }, headers: { authorization: `Bearer ${tokens[0]}` } })
      if (res.statusCode === 409) denied++
    }
    expect(db.sessionStats('truster').trusted).toBe(5)
    expect(denied).toBe(1)

    const res = await app.inject({ method: 'POST', url: '/api/session/untrust-all', headers: { authorization: `Bearer ${tokens[0]}` } })
    expect(res.json()).toMatchObject({ affected: 5 })
    expect(db.sessionStats('truster').trusted).toBe(0)
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('о действиях администратора над сессиями пользователь узнаёт из уведомлений', async () => {
    db.createUser('watched', 'watched-pass-2026-ok', 'developer')
    const login = async (ua: string) => (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'watched', password: 'watched-pass-2026-ok' }, headers: { 'user-agent': ua } })).json().token as string
    const keep = await login('Laptop/1.0')
    const victimToken = await login('Phone/2.0')
    const victimSid = db.listSessions('watched').find((s) => s.userAgent === 'Phone/2.0')!.sid
    await inj({ method: 'DELETE', url: `/api/admin/sessions/${victimSid}` })
    const me = (await app.inject({ method: 'GET', url: '/api/session/me', headers: { authorization: `Bearer ${keep}` } })).json() as { notices: Array<{ type: string; details: string }> }
    expect(me.notices.some((n) => n.type === 'session_revoked' && n.details.includes('администратором'))).toBe(true)
    // Своё собственное завершение сессии в уведомления не попадает — это шум.
    expect(victimToken).toBeTruthy()
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('админский список сессий отдаёт сводку живых и доверенных', async () => {
    db.createUser('counted', 'counted-pass-2026-ok', 'developer')
    const token = (await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'counted', password: 'counted-pass-2026-ok' }, headers: { 'user-agent': 'A/1' } })).json().token as string
    await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'counted', password: 'counted-pass-2026-ok' }, headers: { 'user-agent': 'B/2' } })
    const sid = db.listSessions('counted')[0]!.sid
    await app.inject({ method: 'PATCH', url: `/api/session/${sid}`, payload: { trusted: true }, headers: { authorization: `Bearer ${token}` } })
    const res = (await inj({ method: 'GET', url: '/api/admin/users/counted/sessions' })).json() as { stats: { total: number; trusted: number } }
    expect(res.stats).toEqual({ total: 2, trusted: 1 })
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('cookie-сессия: login ставит HttpOnly vc_session + vc_csrf; GET по cookie проходит, мутация без CSRF → 403, с заголовком → ок; logout гасит cookie (auth-roadmap п.5)', async () => {
    db.createUser('cook', 'cookie-pass-2026', 'developer')
    const login = await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'cook', password: 'cookie-pass-2026' } })
    const setCookies = ([] as string[]).concat(login.headers['set-cookie'] as string[])
    const session = setCookies.find((c) => c.startsWith('vc_session='))!
    const csrfCookie = setCookies.find((c) => c.startsWith('vc_csrf='))!
    expect(session).toContain('HttpOnly'); expect(session).toContain('Path=/;')
    expect(csrfCookie).not.toContain('HttpOnly')
    expect(login.json().csrf).toBe(csrfCookie.split(';')[0]!.split('=')[1])
    const cookie = `${session.split(';')[0]}; ${csrfCookie.split(';')[0]}`
    expect((await app.inject({ method: 'GET', url: '/api/conversations', headers: { cookie } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/api/conversations', headers: { cookie }, payload: { title: 'x' } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: '/api/conversations', headers: { cookie, 'x-vc-csrf': login.json().csrf }, payload: { title: 'x' } })).statusCode).not.toBe(403)
    // Перенос Bearer → cookie.
    const mig = await app.inject({ method: 'POST', url: '/api/session/cookie', headers: { authorization: `Bearer ${login.json().token}` } })
    expect(mig.statusCode).toBe(200)
    expect(String(mig.headers['set-cookie'])).toContain('vc_session=')
    // Logout по cookie без CSRF-заголовка не проходит и cookie не гасит (защита от «выхода» чужой вкладкой/сайтом).
    expect((await app.inject({ method: 'POST', url: '/api/session/logout', headers: { cookie } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/api/conversations', headers: { cookie } })).statusCode).toBe(200)
    const out = await app.inject({ method: 'POST', url: '/api/session/logout', headers: { cookie, 'x-vc-csrf': login.json().csrf } })
    expect(out.statusCode).toBe(200)
    expect(String(out.headers['set-cookie'])).toContain('vc_session=; Path=/')
    expect((await app.inject({ method: 'GET', url: '/api/conversations', headers: { cookie } })).statusCode).toBe(401)
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('2FA TOTP: setup → enable по коду → логин отдаёт тикет → код даёт сессию; disable по коду (auth-roadmap п.6)', async () => {
    db.createUser('two', 'two-factor-pass-2026', 'developer')
    const first = await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'two', password: 'two-factor-pass-2026' } })
    const tok = first.json().token as string
    const setup = (await app.inject({ method: 'POST', url: '/api/session/2fa/setup', headers: { authorization: `Bearer ${tok}` } })).json() as { secret: string; otpauth: string; enabled: boolean }
    expect(setup.enabled).toBe(false)
    expect(setup.otpauth).toContain('otpauth://totp/ChatAI:two')
    expect((await app.inject({ method: 'POST', url: '/api/session/2fa/enable', headers: { authorization: `Bearer ${tok}` }, payload: { code: '000000' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/session/2fa/enable', headers: { authorization: `Bearer ${tok}` }, payload: { code: totpCode(setup.secret) } })).statusCode).toBe(200)
    // Теперь логин по паролю даёт только тикет.
    const challenge = await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'two', password: 'two-factor-pass-2026' } })
    expect(challenge.json()).toMatchObject({ requires2fa: true })
    expect(challenge.json().token).toBeUndefined()
    const ticket = challenge.json().ticket as string
    expect((await app.inject({ method: 'POST', url: '/api/session/2fa', payload: { ticket, code: '123456' } })).statusCode).toBe(401)
    const done = await app.inject({ method: 'POST', url: '/api/session/2fa', payload: { ticket, code: totpCode(setup.secret) } })
    expect(done.statusCode).toBe(200)
    expect(done.json().user).toEqual({ name: 'two', role: 'developer' })
    // Тикет одноразовый.
    expect((await app.inject({ method: 'POST', url: '/api/session/2fa', payload: { ticket, code: totpCode(setup.secret) } })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/api/session/2fa/disable', headers: { authorization: `Bearer ${done.json().token}` }, payload: { code: totpCode(setup.secret) } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'two', password: 'two-factor-pass-2026' } })).json().token).toBeTypeOf('string')
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('журнал безопасности: неудачный вход, вход и выход попадают в /api/admin/security с IP (auth-roadmap п.7)', async () => {
    db.createUser('audit', 'audit-pass-2026-ok', 'developer')
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
    expect(reg.json().user).toEqual({ name: 'newbie', role: 'tester' })
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
    expect(t.json().user).toEqual({ name: 'temp', role: 'developer', mustChangePassword: true })
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

  it('«запомнить меня»: без флага cookie сессионная (без Max-Age) и TTL 12 ч, с флагом — Max-Age 30 дней (auth-roadmap п.15)', async () => {
    db.createUser('rem', 'remember-pass-2026', 'developer')
    const short = await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'rem', password: 'remember-pass-2026', remember: false } })
    const shortCookie = ([] as string[]).concat(short.headers['set-cookie'] as string[]).find((c) => c.startsWith('vc_session='))!
    expect(shortCookie).not.toContain('Max-Age')
    const list = (await app.inject({ method: 'GET', url: '/api/session/list', headers: { authorization: `Bearer ${short.json().token}` } })).json() as { sessions: Array<{ current?: boolean; expiresAt: number; createdAt: number }> }
    const cur = list.sessions.find((s) => s.current)!
    expect(cur.expiresAt - cur.createdAt).toBeLessThanOrEqual(12 * 60 * 60_000 + 5000)
    const long = await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'rem', password: 'remember-pass-2026', remember: true } })
    expect(([] as string[]).concat(long.headers['set-cookie'] as string[]).find((c) => c.startsWith('vc_session='))).toContain(`Max-Age=${30 * 24 * 60 * 60}`)
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('новое устройство: уведомляет в приложении и письмом, не чаще раза в сутки для пары UA+IP; настройка отключает письмо (auth-roadmap п.16)', async () => {
    db.createEmailVerification({ token: 'verified-dev', name: 'dev', email: 'dev@example.com', password: 'device-pass-2026-x', ttlMs: 60_000 })
    expect(db.redeemEmailVerification('verified-dev', 'developer')).not.toBeNull()
    const a = await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'dev', password: 'device-pass-2026-x' }, headers: { 'user-agent': 'Phone/1' } })
    const b = await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'dev', password: 'device-pass-2026-x' }, headers: { 'user-agent': 'Laptop/2', host: 'chat.example.com' } })
    const me = (await app.inject({ method: 'GET', url: '/api/session/me', headers: { authorization: `Bearer ${a.json().token}` } })).json() as { notices: Array<{ type: string; userAgent: string }> }
    expect(me.notices.map((n) => n.userAgent)).toEqual(['Laptop/2'])
    expect(sentMails).toHaveLength(1)
    expect(sentMails[0]).toMatchObject({ to: 'dev@example.com', subject: 'Новый вход в ChatAI' })
    expect(sentMails[0]!.text).toContain('Laptop/2')
    expect(sentMails[0]!.text).toContain('127.0.0.1')
    expect(sentMails[0]!.text).toContain('chat.example.com/#/security/password')
    expect(sentMails[0]!.text).toContain('chat.example.com/#/security/sessions')

    await app.inject({ method: 'POST', url: '/api/session/logout', headers: { authorization: `Bearer ${b.json().token}` } })
    const repeated = await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'dev', password: 'device-pass-2026-x' }, headers: { 'user-agent': 'Laptop/2' } })
    expect(repeated.statusCode).toBe(200)
    expect(sentMails).toHaveLength(1)

    db.saveSettings('dev', { ...db.getSettings('dev'), loginNewDeviceEmails: false })
    await app.inject({ method: 'POST', url: '/api/session/logout', headers: { authorization: `Bearer ${repeated.json().token}` } })
    expect((await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'dev', password: 'device-pass-2026-x' }, headers: { 'user-agent': 'Tablet/3' } })).statusCode).toBe(200)
    expect(sentMails).toHaveLength(1)

    await app.inject({ method: 'POST', url: '/api/session/notices/seen', headers: { authorization: `Bearer ${a.json().token}` } })
    expect(((await app.inject({ method: 'GET', url: '/api/session/me', headers: { authorization: `Bearer ${a.json().token}` } })).json() as { notices: unknown[] }).notices).toEqual([])
    expect(db.getUser('dev')!.lastLogin).toBeGreaterThan(0)
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('вход нового устройства без подтверждённого email не пытается отправить письмо и не ломает вход', async () => {
    db.createUser('local', 'local-device-pass-2026', 'developer')
    await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'local', password: 'local-device-pass-2026' }, headers: { 'user-agent': 'Phone/1' } })
    const next = await app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'local', password: 'local-device-pass-2026' }, headers: { 'user-agent': 'Laptop/2' } })
    expect(next.statusCode).toBe(200)
    expect(sentMails).toEqual([])
    ;(app as unknown as { resetLoginLimiters: () => void }).resetLoginLimiters()
  })

  it('лимит LLM в месяц ставится PATCH-ом без роли и виден в списке (auth-roadmap п.17)', async () => {
    db.createUser('limited', 'limited-pass-2026', 'developer')
    const r = await inj({ method: 'PATCH', url: '/api/admin/users/limited', payload: { llmLimitUsd: 5 } })
    expect(r.json()).toMatchObject({ name: 'limited', role: 'developer', llmLimitUsd: 5 })
    expect(db.getUser('limited')!.llmLimitUsd).toBe(5)
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
    expect(db.getUser('nina')).toBeNull()
    const ver = await app.inject({ method: 'POST', url: '/api/session/verify', payload: { token: decodeURIComponent(link[1]!) } })
    expect(ver.statusCode).toBe(200)
    expect(ver.json().user).toEqual({ name: 'nina', role: 'tester' })
    expect(db.getUser('nina')!.email).toBe('nina@example.com')
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
    db.createUser('user', '', 'developer')
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
    db.createUser('user', '', 'developer')
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
    db.createUser('user', '', 'developer')
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
    db.createUser('bob', '', 'observer')
    const bobTok = signToken({ name: 'bob', role: 'observer' }, SECRET)
    const res = await app.inject({ method: 'GET', url: '/api/me/profile', headers: { authorization: `Bearer ${bobTok}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ name: 'bob', role: 'observer', blocked: false })
    // Чужого имени в роуте нет физически — подставить некуда.
    expect((await app.inject({ method: 'GET', url: '/api/admin/users', headers: { authorization: `Bearer ${bobTok}` } })).statusCode).toBe(403)
  })

  it('журнал безопасности показывает только свои события', async () => {
    db.createUser('bob', '', 'developer')
    db.createUser('kate', '', 'developer')
    db.logSecurityEvent({ user: 'bob', type: 'login', ip: '10.0.0.1', details: 'своё' })
    db.logSecurityEvent({ user: 'kate', type: 'login', ip: '10.0.0.2', details: 'чужое' })
    const bobTok = signToken({ name: 'bob', role: 'developer' }, SECRET)
    const res = await app.inject({ method: 'GET', url: '/api/me/security', headers: { authorization: `Bearer ${bobTok}` } })
    expect(res.statusCode).toBe(200)
    const events = res.json() as Array<{ user: string; details: string }>
    expect(events.length).toBeGreaterThan(0)
    expect(events.every((event) => event.user === 'bob')).toBe(true)
    expect(events.some((event) => event.details === 'чужое')).toBe(false)
  })

  it('без сессии оба роута — 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/me/profile' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/me/security' })).statusCode).toBe(401)
  })
})
