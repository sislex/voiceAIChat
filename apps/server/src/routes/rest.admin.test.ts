// Админские маршруты и реестр LLM-исполнителей.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { signToken } from '../users/accounts.js'
import { buildServer } from '../server.js'
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
let token: string
beforeEach(() => { ({ app, db, token } = harness) })


describe('REST: админ-роуты (только admin)', () => {
  it('запуск деплоя доступен только admin и не принимает shell-параметры', async () => {
    db.createUser('user', '', 'developer')
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
    db.createUser('user', '', 'developer')
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
    db.createUser('user', '', 'developer')
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
