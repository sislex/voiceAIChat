// Админские маршруты и реестр LLM-исполнителей.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { signToken } from "@sislexa/identity/server/users/accounts"
import type { FastifyInstance } from 'fastify'
import { VoiceChatDb } from '../db/database.js'
import { setupRestHarness } from './restHarness.js'

// Обвязка одна на все rest.*.test.ts — см. restHarness.ts.
// Хук harness зарегистрирован первым, поэтому к моменту этого beforeEach
// поля уже пересозданы под текущий тест.
const harness = setupRestHarness()
const { inj, triggerDeploy, SECRET } = harness
let app: FastifyInstance
let db: VoiceChatDb
beforeEach(() => { ({ app, db } = harness) })


describe('REST: админ-роуты (только admin)', () => {
  it('rejects removing the final administrator and allows demotion when another exists', async () => {
    const denied = await inj({ method: 'PATCH', url: '/api/admin/users/admin', payload: { role: 'observer' } })
    expect(denied.statusCode).toBe(409)
    expect(denied.json().error).toBe('В системе должен остаться хотя бы один администратор')
    expect((await db.identity.getUser('admin'))?.role).toBe('admin')
    await db.identity.createUser('second-admin', '', 'admin')
    expect((await inj({ method: 'PATCH', url: '/api/admin/users/second-admin', payload: { role: 'observer' } })).statusCode).toBe(200)
  })

  it('serializes concurrent administrator demotions', async () => {
    await db.identity.createUser('second-admin', '', 'admin')
    const results = await Promise.allSettled([
      db.identity.setUserRole('admin', 'observer'),
      db.identity.setUserRole('second-admin', 'observer')
    ])
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect((await db.identity.listUsers()).filter((user) => user.role === 'admin')).toHaveLength(1)
  })

  it('paginates after filtering and keeps the legacy full response', async () => {
    for (const name of ['alice', 'bob', 'carol']) await db.identity.createUser(name, '', 'tester')
    const all = (await inj({ method: 'GET', url: '/api/admin/users' })).json()
    expect(all).toHaveLength(4)
    const first = (await inj({ method: 'GET', url: '/api/admin/users?limit=2&offset=0&q=tester&sort=name' })).json()
    const second = (await inj({ method: 'GET', url: '/api/admin/users?limit=2&offset=2&q=tester&sort=name' })).json()
    expect([...first, ...second].map((user: { name: string }) => user.name)).toEqual(['alice', 'bob', 'carol'])
    for (const query of ['limit=0', 'limit=201', 'offset=-1', 'limit=nope']) expect((await inj({ method: 'GET', url: `/api/admin/users?${query}` })).statusCode).toBe(400)
  })

  it('records price changes and validates decimal precision', async () => {
    const price = { provider: 'codex', model: 'test-model', inputPerMillion: 1.25, cachedInputPerMillion: 0, cacheWritePerMillion: 0, outputPerMillion: 2.5, sourceUrl: 'https://example.com/pricing', effectiveAt: Date.now() }
    expect((await inj({ method: 'PUT', url: '/api/admin/model-prices', payload: { ...price, inputPerMillion: 0.123 } })).statusCode).toBe(400)
    expect((await inj({ method: 'PUT', url: '/api/admin/model-prices', payload: price })).statusCode).toBe(200)
    const events = (await inj({ method: 'GET', url: '/api/admin/security?group=prices' })).json().events
    expect(events[0]).toMatchObject({ type: 'model_price_changed', user: 'admin' })
    expect(events[0].details).toContain('input=1.25')
    expect(events[0].at).toBeGreaterThan(0)
  })

  it('marks the current administrator session and revokes another device', async () => {
    await db.identity.createSession('current-admin', 'admin', { ip: '10.0.0.1', userAgent: 'test', ttlMs: 60_000 })
    await db.identity.createSession('other-admin', 'admin', { ip: '10.0.0.2', userAgent: 'test', ttlMs: 60_000 })
    const token = signToken({ name: 'admin', role: 'admin' }, SECRET, 'current-admin')
    const headers = { authorization: `Bearer ${token}` }
    const result = await app.inject({ method: 'GET', url: '/api/admin/users/admin/sessions', headers })
    expect(result.statusCode).toBe(200)
    expect(result.json().sessions.find((session: { sid: string }) => session.sid === 'current-admin').current).toBe(true)
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/users/admin/sessions', payload: { exceptCurrent: true }, headers })).statusCode).toBe(200)
    expect(await db.identity.getSession('current-admin')).not.toBeNull()
    expect(await db.identity.getSession('other-admin')).toBeNull()
  })

  it('lists reset-code expiry without exposing the secret and revokes it', async () => {
    await db.identity.createUser('bob', '', 'tester')
    const issued = (await inj({ method: 'POST', url: '/api/admin/users/bob/reset-code' })).json()
    expect(issued.code).toHaveLength(8)
    const status = (await inj({ method: 'GET', url: '/api/admin/users/bob/reset-code' })).json()
    expect(status.code).toBe('')
    expect(status.expiresAt).toBeGreaterThan(Date.now())
    expect((await inj({ method: 'DELETE', url: '/api/admin/users/bob/reset-code' })).statusCode).toBe(200)
    expect(await db.identity.redeemResetCode('bob', issued.code, 'changed-password')).toBe(false)
  })

  it('selects the last fifty logins before limiting the audit journal', async () => {
    for (let i = 0; i < 55; i++) await db.identity.logSecurityEvent({ user: 'admin', type: 'login', ip: `10.0.0.${i}`, userAgent: 'test-device' })
    for (let i = 0; i < 60; i++) await db.identity.logSecurityEvent({ user: 'admin', type: 'password_changed' })
    const events = (await inj({ method: 'GET', url: '/api/admin/security?user=admin&group=login&limit=2' })).json().events
    expect(events).toHaveLength(50)
    expect(events[0]).toMatchObject({ type: 'login', ip: '10.0.0.54', userAgent: 'test-device' })
  })
  it('запуск деплоя доступен только admin и не принимает shell-параметры', async () => {
    await db.identity.createUser('user', '', 'developer')
    const userTok = signToken({ name: 'user', role: 'developer' }, SECRET)
    const denied = await app.inject({
      method: 'POST',
      url: '/api/admin/deploy',
      payload: { command: 'rm -rf /' },
      headers: { authorization: `Bearer ${userTok}` }
    })
    expect(denied.statusCode).toBe(403)
    expect(triggerDeploy).not.toHaveBeenCalled()

    const accepted = await inj({ method: 'POST', url: '/api/admin/deploy', payload: { command: 'ignored' } })
    expect(accepted.statusCode).toBe(202)
    expect(accepted.json()).toEqual({ status: 'accepted', message: 'deployment started' })
    expect(triggerDeploy).toHaveBeenCalledOnce()
  })

  it('возвращает running и структурированную ошибку host API', async () => {
    triggerDeploy.mockResolvedValueOnce({ status: 'running', message: 'deployment already running' })
    const running = await inj({ method: 'POST', url: '/api/admin/deploy' })
    expect(running.statusCode).toBe(409)
    expect(running.json()).toMatchObject({ status: 'running' })

    triggerDeploy.mockRejectedValueOnce(new Error('socket unavailable'))
    const unavailable = await inj({ method: 'POST', url: '/api/admin/deploy' })
    expect(unavailable.statusCode).toBe(503)
    expect(unavailable.json()).toEqual({ error: 'deploy API unavailable', detail: 'socket unavailable' })
  })

  it('user → 403 на /api/admin/users', async () => {
    await db.identity.createUser('user', '', 'developer')
    const userTok = signToken({ name: 'user', role: 'developer' }, SECRET)
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${userTok}` }
    })
    expect(res.statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/api/admin/users/usage-summary', headers: { authorization: `Bearer ${userTok}` } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/api/admin/model-prices', headers: { authorization: `Bearer ${userTok}` } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/api/me/usage', headers: { authorization: `Bearer ${userTok}` } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/me/llm-access', headers: { authorization: `Bearer ${userTok}` } })).statusCode).toBe(200)
  })

  it('admin: список → создание → блок → удаление', async () => {
    // admin засеян buildServer'ом.
    const list0 = (await inj({ method: 'GET', url: '/api/admin/users' })).json()
    expect(list0.map((u: { name: string }) => u.name)).toContain('admin')

    const created = await inj({
      method: 'POST',
      url: '/api/admin/users',
      payload: { name: 'bob', password: 'strong-pass-2026-xyz', role: 'developer' }
    })
    expect(created.statusCode).toBe(200)
    // Политика пароля (auth-roadmap п.2): короткий/пустой → 400 с текстом причины.
    expect((await inj({ method: 'POST', url: '/api/admin/users', payload: { name: 'weak', password: 'pw', role: 'developer' } })).json()).toEqual({ error: 'Пароль короче 10 символов' })
    expect((await inj({ method: 'POST', url: '/api/admin/users', payload: { name: 'weak', password: '', role: 'developer' } })).statusCode).toBe(400)
    expect(created.json()).toMatchObject({ name: 'bob', role: 'developer', blocked: false })

    await inj({ method: 'POST', url: '/api/admin/users/bob/block', payload: { blocked: true, reason: 'запрос службы безопасности' } })
    const blocked = (await inj({ method: 'GET', url: '/api/admin/users' })).json()
    expect(blocked.find((u: { name: string }) => u.name === 'bob').blocked).toBe(true)
    // Причина видна в журнале, а не в lock_reason: та колонка хранит машинный повод авто-замка.
    const events = (await inj({ method: 'GET', url: '/api/admin/security?user=bob' })).json().events as Array<{ type: string; details: string }>
    expect(events.find((event) => event.type === 'user_blocked')?.details).toContain('запрос службы безопасности')
    expect(blocked.find((u: { name: string }) => u.name === 'bob').lockReason).not.toBe('запрос службы безопасности')

    // usage-отчёт отдаётся (пустой).
    const usage = (await inj({ method: 'GET', url: '/api/admin/users/bob/usage?unit=day' })).json()
    expect(usage.totals.messages).toBe(0)
    const summary = (await inj({ method: 'GET', url: '/api/admin/users/usage-summary' })).json()
    expect(summary.find((item: { name: string }) => item.name === 'bob')).toMatchObject({ totals: { messages: 0 }, byModel: [] })

    const del = await inj({ method: 'DELETE', url: '/api/admin/users/bob' })
    expect(del.statusCode).toBe(200)
    const after = (await inj({ method: 'GET', url: '/api/admin/users' })).json()
    expect(after.map((u: { name: string }) => u.name)).not.toContain('bob')
  })

  it('admin нельзя удалить', async () => {
    const res = await inj({ method: 'DELETE', url: '/api/admin/users/admin' })
    expect(res.statusCode).toBe(400)
  })
})

describe('REST: реестр LLM-исполнителей (только admin)', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('user → 403 на /api/admin/llm-engines', async () => {
    await db.identity.createUser('user', '', 'developer')
    const userTok = signToken({ name: 'user', role: 'developer' }, SECRET)
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/llm-engines',
      headers: { authorization: `Bearer ${userTok}` }
    })
    expect(res.statusCode).toBe(403)
  })

  it('admin: create → update → health → delete', async () => {
    const created = await inj({
      method: 'POST',
      url: '/api/admin/llm-engines',
      payload: {
        name: 'Runner Claude',
        kind: 'claude',
        baseUrl: 'http://runner.test:8080',
        token: 'secret',
        enabled: true,
        allowedRoles: ['admin', 'developer'],
        isDefault: true
      }
    })
    expect(created.statusCode).toBe(200)
    const engine = created.json()
    expect(engine).toMatchObject({ name: 'Runner Claude', kind: 'claude', token: 'secret', isDefault: true })

    const list = await inj({ method: 'GET', url: '/api/admin/llm-engines' })
    expect(list.json()).toHaveLength(1)

    const updated = await inj({
      method: 'PATCH',
      url: `/api/admin/llm-engines/${engine.id}`,
      payload: {
        name: 'Runner Claude 2',
        kind: 'claude',
        baseUrl: 'http://runner.test:8081',
        token: 'secret-2',
        enabled: false,
        allowedRoles: ['admin'],
        isDefault: false
      }
    })
    expect(updated.json()).toMatchObject({ name: 'Runner Claude 2', enabled: false, allowedRoles: ['admin'] })

    globalThis.fetch = (async () => new Response(JSON.stringify({
      ok: true,
      bins: {
        claude: { present: true, version: '1.0.0' },
        codex: { present: false, version: null }
      },
      login: {
        claude: { provider: 'claude', loggedIn: true, detail: 'team' },
        codex: { provider: 'codex', loggedIn: false, detail: 'login required' }
      },
      runs: 0
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
    const health = await inj({ method: 'GET', url: `/api/admin/llm-engines/${engine.id}/health` })
    expect(health.json()).toMatchObject({ available: true, kind: 'claude' })

    globalThis.fetch = (async () => { throw new Error('connect ECONNREFUSED') }) as typeof fetch
    const offline = await inj({ method: 'GET', url: `/api/admin/llm-engines/${engine.id}/health` })
    expect(offline.statusCode).toBe(200)
    expect(offline.json()).toMatchObject({ available: false })

    const del = await inj({ method: 'DELETE', url: `/api/admin/llm-engines/${engine.id}` })
    expect(del.statusCode).toBe(200)
    expect((await inj({ method: 'GET', url: '/api/admin/llm-engines' })).json()).toEqual([])
  })

  it('валидация create/update полей работает', async () => {
    const bad = await inj({
      method: 'POST',
      url: '/api/admin/llm-engines',
      payload: { name: '', kind: 'bad', baseUrl: 'oops', token: '', enabled: true, allowedRoles: [], isDefault: false }
    })
    expect(bad.statusCode).toBe(400)
  })
})
