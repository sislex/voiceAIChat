import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { AgentRegistry } from '../agents/registry.js'
import { signToken } from '../users/accounts.js'
import { isPublicAddress, previewInspectorScript, rewritePreviewBody, upstreamRequestHeaders } from './previewProxy.js'

let app: FastifyInstance
let db: VoiceChatDb
let token: string
let dataDir: string
let agentRegistry: AgentRegistry

const SECRET = 'test-secret'
const U = 'admin'
const triggerDeploy = vi.fn<() => Promise<{ status: 'accepted' | 'running'; message: string }>>()

interface InjOpts {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string
  payload?: object | string
  headers?: Record<string, string>
}

/** app.inject с токеном сессии (admin) в Authorization. */
function inj(opts: InjOpts) {
  return app.inject({
    ...opts,
    headers: { authorization: `Bearer ${token}`, ...(opts.headers ?? {}) }
  })
}

beforeEach(async () => {
  let id = 0
  let clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  dataDir = join(tmpdir(), `vc-rest-test-${Date.now()}-${id}`)
  // Явно изолируем каталоги моделей/голосов во временную папку — тесты удаления
  // не должны касаться реальных файлов репозитория.
  triggerDeploy.mockReset()
  agentRegistry = new AgentRegistry()
  triggerDeploy.mockResolvedValue({ status: 'accepted', message: 'deployment started' })
  app = await buildServer({
    config: loadConfig({
      PORT: '0',
      VC_DATA_DIR: dataDir,
      VC_MODELS_DIR: join(dataDir, 'models'),
      VC_PIPER_VOICES_DIR: join(dataDir, 'voices')
    }),
    db,
    agentRegistry,
    sessionSecret: SECRET,
    deployTrigger: { trigger: triggerDeploy }
  })
  token = signToken({ name: U, role: 'admin' }, SECRET)
})

afterEach(async () => {
  await app.close()
  db.close()
})

describe('REST: хранилище машины', () => {
  function connectFs(machineId: string, failMkdir = false, failWrite = false) {
    const directories = new Set<string>()
    let writeBlocked = failWrite
    const files = new Map<string, string>()
    const socket = {
      close: vi.fn(),
      send(data: string) {
        const message = JSON.parse(data) as { t: string; opId?: string; path?: string; dataBase64?: string }
        if (!message.opId || !message.path) return
        if (message.t === 'fs.mkdir') {
          if (failMkdir) return agentRegistry.handleMessage(machineId, { t: 'fs.error', opId: message.opId, message: 'EACCES permission denied' })
          directories.add(message.path)
          return agentRegistry.handleMessage(machineId, { t: 'fs.result', opId: message.opId, result: { root: '/', cwd: message.path } })
        }
        if (message.t === 'fs.write') {
          if (writeBlocked) return agentRegistry.handleMessage(machineId, { t: 'fs.error', opId: message.opId, message: 'EROFS read-only file system' })
          files.set(message.path, message.dataBase64 ?? '')
          return agentRegistry.handleMessage(machineId, { t: 'fs.result', opId: message.opId, result: { root: '/', cwd: message.path } })
        }
        if (message.t === 'fs.delete') {
          files.delete(message.path)
          return agentRegistry.handleMessage(machineId, { t: 'fs.result', opId: message.opId, result: { root: '/', cwd: message.path } })
        }
        if (message.t === 'fs.read') {
          const dataBase64 = files.get(message.path)
          return dataBase64 === undefined
            ? agentRegistry.handleMessage(machineId, { t: 'fs.error', opId: message.opId, message: 'ENOENT not found' })
            : agentRegistry.handleMessage(machineId, { t: 'fs.result', opId: message.opId, result: { root: '/', cwd: message.path, dataBase64 } })
        }
        if (message.t === 'fs.list') {
          return directories.has(message.path)
            ? agentRegistry.handleMessage(machineId, { t: 'fs.result', opId: message.opId, result: { root: '/', cwd: message.path, entries: [] } })
            : agentRegistry.handleMessage(machineId, { t: 'fs.error', opId: message.opId, message: 'ENOENT missing disk' })
        }
      }
    }
    agentRegistry.register(machineId, 'Мак', socket, db.listAgents(U).find((item) => item.id === machineId)!.policy, '0.11.0')
    return { directories, files, setFailWrite: (value: boolean) => { writeBlocked = value } }
  }

  it('готовит marker до записи в БД, сохраняет id и проверяет фактический status', async () => {
    const machine = db.createAgent(U, 'Мак')
    const fs = connectFs(machine.id)
    const first = await inj({ method: 'POST', url: `/api/agents/${machine.id}/storages`, payload: { rootPath: '/Users/me/ChatAI' } })
    expect(first.statusCode).toBe(200)
    expect(db.listMachineStorages(U, machine.id)).toHaveLength(1)
    expect(fs.directories).toContain('/Users/me/ChatAI/.voicechat/temporary')
    const second = await inj({ method: 'POST', url: `/api/agents/${machine.id}/storages`, payload: { rootPath: '/Users/me/ChatAI/' } })
    expect(second.json().id).toBe(first.json().id)
    const listed = await inj({ method: 'GET', url: `/api/agents/${machine.id}/storages` })
    expect(listed.json()[0]).toMatchObject({ id: first.json().id, status: 'ready', primary: true })
  })

  it('материализует каталоги и project marker до сохранения машины проекта', async () => {
    const machine = db.createAgent(U, 'Project machine')
    const fs = connectFs(machine.id)
    const storageResponse = await inj({ method: 'POST', url: `/api/agents/${machine.id}/storages`, payload: { rootPath: '/Users/me/ChatAI' } })
    const projectResponse = await inj({ method: 'POST', url: '/api/projects', payload: { name: 'Managed project' } })
    const projectId = projectResponse.json().id as string
    const linked = await inj({ method: 'POST', url: `/api/projects/${projectId}/machines`, payload: { agentId: machine.id, storageId: storageResponse.json().id } })
    expect(linked.statusCode).toBe(200)
    const configured = linked.json().machines.find((item: { agentId: string }) => item.agentId === machine.id)
    expect(configured.path).toContain(`/projects/${projectId}/worktree`)
    expect(configured.reposRoot).toContain(`/projects/${projectId}/repositories`)
    expect(fs.directories).toContain(`/Users/me/ChatAI/projects/${projectId}/environments/production`)
    const marker = Buffer.from(fs.files.get(`/Users/me/ChatAI/projects/${projectId}/project.json`) ?? '', 'base64').toString('utf8')
    expect(JSON.parse(marker)).toMatchObject({ formatVersion: 1, projectId })
  })

  it('показывает зарегистрированное хранилище только для чтения', async () => {
    const machine = db.createAgent(U, 'Read only')
    const fs = connectFs(machine.id)
    const created = await inj({ method: 'POST', url: `/api/agents/${machine.id}/storages`, payload: { rootPath: '/Volumes/ReadOnly/ChatAI' } })
    expect(created.statusCode).toBe(200)
    fs.setFailWrite(true)
    const listed = await inj({ method: 'GET', url: `/api/agents/${machine.id}/storages` })
    expect(listed.json()[0]).toMatchObject({ status: 'read-only', error: expect.stringContaining('только для чтения') })
    expect(fs.files.size).toBeGreaterThan(0)
  })

  it('не оставляет ready-запись при ошибке прав', async () => {
    const machine = db.createAgent(U, 'Закрытый диск')
    connectFs(machine.id, true)
    const response = await inj({ method: 'POST', url: `/api/agents/${machine.id}/storages`, payload: { rootPath: '/Volumes/Locked/ChatAI' } })
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toMatch(/Нет прав/)
    expect(db.listMachineStorages(U, machine.id)).toEqual([])
  })

  it('bootstrap проектного чата создаёт каталоги окружений, но не пишет environment.json (иначе poisoned manifest → деплой 400)', async () => {
    const machine = db.createAgent(U, 'Мак')
    const fs = connectFs(machine.id)
    const storage = (await inj({ method: 'POST', url: `/api/agents/${machine.id}/storages`, payload: { rootPath: '/Users/me/ChatAI' } })).json()
    const project = db.createProject(U, { name: 'ChatAI', gitUrl: 'https://example.com/repo.git' })
    const conv = db.createConversation(U, 'C')
    db.setConversationProject(U, conv.id, project.id)
    const res = await inj({ method: 'PUT', url: `/api/conversations/${conv.id}/storage`, payload: { machineId: machine.id, storageId: storage.id } })
    expect(res.statusCode).toBe(200)
    const written = [...fs.files.keys()]
    // Каталоги managed-окружений создаются, а манифест — нет (его пишут релиз/preview-менеджеры).
    expect([...fs.directories].some((d) => d.includes('/environments/production/'))).toBe(true)
    expect(written.some((p) => p.endsWith('/environment.json'))).toBe(false)
    // Обычные маркеры хранилища при этом на месте.
    expect(written.some((p) => p.endsWith('/project.json'))).toBe(true)
  })
})

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
    expect(ok.headers['set-cookie']).toContain('vc_preview_session=')
    expect(ok.headers['set-cookie']).toContain('Path=/api/preview')
    expect(ok.headers['set-cookie']).toContain('HttpOnly')
    expect(ok.headers['set-cookie']).toContain('SameSite=Strict')
    const bad = await app.inject({
      method: 'POST',
      url: '/api/session/login',
      payload: { name: 'user', password: 'x' }
    })
    expect(bad.statusCode).toBe(401)
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
    expect(logout.headers['set-cookie']).toContain('vc_preview_session=;')
    expect(logout.headers['set-cookie']).toContain('Max-Age=0')
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
      payload: { name: 'bob', password: 'pw', role: 'developer' }
    })
    expect(created.statusCode).toBe(200)
    expect(created.json()).toMatchObject({ name: 'bob', role: 'developer', blocked: false })

    await inj({ method: 'POST', url: '/api/admin/users/bob/block', payload: { blocked: true } })
    const blocked = (await inj({ method: 'GET', url: '/api/admin/users' })).json()
    expect(blocked.find((u: { name: string }) => u.name === 'bob').blocked).toBe(true)

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

describe('REST: conversations/messages/settings', () => {
  it('импорт desktop требует токен и идемпотентен', async () => {
    const payload = { conversations: [{ conversation: { id: 'legacy-c', title: 'Legacy', createdAt: 10, updatedAt: 20, claudeSessionId: null, execTarget: null }, messages: [{ id: 'legacy-m', conversationId: 'legacy-c', role: 'u1', text: 'hello', time: '10:00', createdAt: 15 }] }] }
    expect((await app.inject({ method: 'POST', url: '/api/migrations/desktop', payload })).statusCode).toBe(401)
    expect((await inj({ method: 'POST', url: '/api/migrations/desktop', payload })).json()).toEqual({ conversationsImported: 1, messagesImported: 1 })
    expect((await inj({ method: 'POST', url: '/api/migrations/desktop', payload })).json()).toEqual({ conversationsImported: 0, messagesImported: 0 })
  })

  it('draft endpoint атомарно создаёт проектный чат с первой репликой и повторяет ответ', async () => {
    const project = db.createProject(U, { name: 'Draft project', skills: ['ts'] })
    const payload = {
      idempotencyKey: 'draft-request-1',
      title: 'Файл README.md',
      projectId: project.id,
      message: { role: 'u1', text: '📎 README.md', time: '10:00', attachments: [{ path: '/tmp/README.md', name: 'README.md', mimeType: 'text/markdown', size: 10 }] }
    }
    const first = await inj({ method: 'POST', url: '/api/conversations/draft', payload })
    const replay = await inj({ method: 'POST', url: '/api/conversations/draft', payload })

    expect(first.statusCode).toBe(200)
    expect(replay.json().conversation.id).toBe(first.json().conversation.id)
    expect(first.json().conversation).toMatchObject({ title: 'Файл README.md', projectId: project.id, skillNames: ['ts'], messageCount: 1 })
    expect(first.json().messages).toHaveLength(1)
    expect((await inj({ method: 'GET', url: '/api/conversations' })).json()).toHaveLength(1)
  })

  it('create → list → get', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Тест' } })).json()
    expect(created.title).toBe('Тест')

    const list = (await inj({ method: 'GET', url: '/api/conversations' })).json()
    expect(list.map((c: { id: string }) => c.id)).toContain(created.id)

    const got = (await inj({ method: 'GET', url: `/api/conversations/${created.id}` })).json()
    expect(got.conversation.title).toBe('Тест')
    expect(got.messages).toEqual([])
  })

  it('404 на несуществующий разговор', async () => {
    const res = await inj({ method: 'GET', url: '/api/conversations/нет' })
    expect(res.statusCode).toBe(404)
  })

  it('возвращает авторизованный серверный снимок эффективного контекста', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Контекст' } })).json()
    const res = await inj({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot` })
    expect(res.statusCode).toBe(200)
    const snapshot = res.json()
    expect(snapshot).toMatchObject({ schemaVersion: 1, conversationId: created.id })
    expect(new Date(snapshot.generatedAt).toISOString()).toBe(snapshot.generatedAt)
    expect(snapshot.freshnessWarning).toContain('момент формирования')
    const items = snapshot.groups.flatMap((group: { items: unknown[] }) => group.items)
    expect(items.length).toBeGreaterThan(10)
    for (const entry of items) expect(entry).toEqual(expect.objectContaining({ id: expect.any(String), type: expect.any(String), source: expect.any(String), scope: expect.any(String), priority: expect.any(String), configured: expect.any(Boolean), available: expect.any(Boolean), includedInNextTurn: expect.any(Boolean) }))
    expect(items.find((entry: { id: string }) => entry.id === 'current-message')).toMatchObject({ configured: false, available: false, includedInNextTurn: false })
    expect(items.find((entry: { id: string }) => entry.id === 'knowledge-mode').details.autoContextDocuments).toEqual([])
    // Тумблеры: безопасность не выключается, персонализация/kb — можно; по умолчанию всё включено.
    const byId = (id: string): { toggleable: boolean; enabled: boolean } => items.find((entry: { id: string }) => entry.id === id)
    expect(byId('platform-instructions')).toMatchObject({ toggleable: false, enabled: true })
    expect(byId('application-instructions')).toMatchObject({ toggleable: false, enabled: true })
    expect(byId('personalization').toggleable).toBe(true)
    expect(byId('knowledge-mode')).toMatchObject({ toggleable: true, enabled: true })
    // Drill-in: у пунктов есть полная детализация.
    const detailed = (id: string): { details?: Record<string, unknown> } => items.find((entry: { id: string }) => entry.id === id)
    expect(Object.keys(detailed('personalization').details ?? {})).toEqual(expect.arrayContaining(['Обращение', 'Язык ответа', 'Стиль', 'Тон', 'Текст в промпте']))
    expect(detailed('mcp-remote-bash').details).toMatchObject({ 'Инструмент': 'mcp__remote__bash', 'Изменяет данные': true })
    expect(detailed('mcp-kb-search').details).toMatchObject({ 'Инструмент': 'mcp__kb__search' })
  })

  it('Make: REST проекта, превью через cookie-путь, публикация /p/<token>/ без авторизации, чужой проект — 404', async () => {
    const conv = db.createConversation(U, 'Проект', 'make')
    const state = (await inj({ method: 'GET', url: `/api/make/${conv.id}` })).json() as { files: Array<{ path: string }>; published: unknown }
    expect(state.files.map((f) => f.path)).toContain('index.html')
    expect(state.published).toBeNull()
    // Превью без Bearer и без cookie — 401; с Bearer — отдаёт HTML с инспектором.
    const noAuth = await app.inject({ method: 'GET', url: `/api/preview/make/${conv.id}/index.html` })
    expect(noAuth.statusCode).toBe(401)
    const withAuth = await inj({ method: 'GET', url: `/api/preview/make/${conv.id}/index.html` })
    expect(withAuth.statusCode).toBe(200)
    expect(withAuth.headers['content-type']).toMatch(/text\/html/)
    expect(withAuth.body).toContain('data-vc-make-inspector')
    // Инжектируемый скрипт должен парситься: ломаный перехват консоли ломал и инспектор.
    const script = withAuth.body.match(/<script data-vc-make-inspector>([\s\S]*?)<\/script>/)![1]!
    expect(() => new Function(script)).not.toThrow()
    expect(script).toContain('vc-make.console')
    // Публикация: ссылка открывается без авторизации и без инспектора; после снятия — 404.
    const published = (await inj({ method: 'POST', url: `/api/make/${conv.id}/publish` })).json() as { published: { url: string } }
    expect(published.published.url).toMatch(/^\/p\//)
    const pub = await app.inject({ method: 'GET', url: `${published.published.url}index.html` })
    expect(pub.statusCode).toBe(200)
    expect(pub.body).not.toContain('data-vc-make-inspector')
    expect(pub.headers['x-robots-tag']).toBe('noindex')
    await inj({ method: 'DELETE', url: `/api/make/${conv.id}/publish` })
    expect((await app.inject({ method: 'GET', url: `${published.published.url}index.html` })).statusCode).toBe(404)
    // Обычный (не make) разговор для маршрутов Make — 404.
    const plain = db.createConversation(U, 'Чат')
    expect((await inj({ method: 'GET', url: `/api/make/${plain.id}` })).statusCode).toBe(404)
    // Проверка и шаблон.
    const check = (await inj({ method: 'GET', url: `/api/make/${conv.id}/check` })).json() as { issues: unknown[] }
    expect(check.issues).toEqual([])
    const templated = (await inj({ method: 'POST', url: `/api/make/${conv.id}/template`, payload: { templateId: 'landing' } })).json() as { snapshots: Array<{ label: string }> }
    expect(templated.snapshots[0]?.label).toContain('Лендинг')
    // Загрузка бинарника: base64 → байты, отдаётся превью с image/png.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3])
    const uploaded = (await inj({ method: 'POST', url: `/api/make/${conv.id}/upload`, payload: { path: 'img/logo.png', dataBase64: png.toString('base64') } })).json() as { files: Array<{ path: string }> }
    expect(uploaded.files.map((f) => f.path)).toContain('img/logo.png')
    const img = await inj({ method: 'GET', url: `/api/preview/make/${conv.id}/img/logo.png` })
    expect(img.headers['content-type']).toMatch(/image\/png/)
    expect(img.rawPayload.equals(png)).toBe(true)
    // React: JSX транспилируется при отдаче, импорт без расширения дополняется; страница сториз собирается.
    await inj({ method: 'POST', url: `/api/make/${conv.id}/template`, payload: { templateId: 'react' } })
    await inj({ method: 'PUT', url: `/api/make/${conv.id}/file`, payload: { path: 'src/Extra.jsx', content: "import { Button } from './components/Button'\nexport const X = () => <Button>x</Button>" } })
    const jsx = await inj({ method: 'GET', url: `/api/preview/make/${conv.id}/src/Extra.jsx` })
    expect(jsx.headers['content-type']).toMatch(/javascript/)
    expect(jsx.body).toContain('./components/Button.jsx')
    expect(jsx.body).toContain('jsx(')
    expect(jsx.body).not.toContain('<Button>')
    const stories = (await inj({ method: 'GET', url: `/api/make/${conv.id}/stories` })).json() as { files: Array<{ path: string; title: string; stories: string[] }> }
    expect(stories.files.find((f) => f.path === 'src/components/Button.stories.jsx')).toMatchObject({ title: 'Button', stories: ['Primary', 'Secondary', 'Small'] })
    const runner = await inj({ method: 'GET', url: `/api/preview/make/${conv.id}/__stories__?file=src/components/Button.stories.jsx&story=Small` })
    expect(runner.statusCode).toBe(200)
    expect(runner.body).toContain('importmap')
    expect(runner.body).toContain('"Small"')
    // Галерея и сториз: в превью (cookie/Bearer) и на публикации без входа.
    const gallery = await inj({ method: 'GET', url: `/api/preview/make/${conv.id}/__gallery__` })
    expect(gallery.statusCode).toBe(200)
    expect(gallery.body).toContain('Button.stories.jsx')
    const pub2 = (await inj({ method: 'POST', url: `/api/make/${conv.id}/publish` })).json() as { published: { url: string } }
    const pubGallery = await app.inject({ method: 'GET', url: `${pub2.published.url}__gallery__` })
    expect(pubGallery.statusCode).toBe(200)
    expect(pubGallery.body).toContain(`${pub2.published.url}__stories__?file=`)
    const pubStory = await app.inject({ method: 'GET', url: `${pub2.published.url}__stories__?file=src/components/Button.stories.jsx&story=Primary` })
    expect(pubStory.statusCode).toBe(200)
    expect(pubStory.body).toContain('"Primary"')
    await inj({ method: 'DELETE', url: `/api/make/${conv.id}/publish` })
    const search = (await inj({ method: 'GET', url: `/api/make/${conv.id}/search?q=btn--secondary` })).json() as { matches: Array<{ path: string; line: number }> }
    expect(search.matches.map((m) => m.path)).toContain('styles.css')
  })

  it('POST /messages для ответа без engine/execTarget подставляет эффективные движок и машину разговора', async () => {
    const conv = db.createConversation(U, 'Диагностика')
    db.saveSettings(U, { ...db.getSettings(U), llmProvider: 'codex' })
    const res = await inj({ method: 'POST', url: `/api/conversations/${conv.id}/messages`, payload: { role: 'ai', text: '✓ проверка', time: '10:00' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ role: 'ai', engine: 'codex', execTarget: null })
  })

  it('снимок содержит группу «Инструкции чата»; тумблер выключает инструкцию только в разговоре', async () => {
    const conv = db.createConversation(U, 'Чат')
    const groupOf = (json: { groups: Array<{ id: string; items: Array<{ id: string; enabled: boolean; includedInNextTurn: boolean; toggleable: boolean; details?: Record<string, unknown> }> }> }) => json.groups.find((g) => g.id === 'chat-instructions')!
    const first = groupOf((await inj({ method: 'GET', url: `/api/conversations/${conv.id}/context-snapshot` })).json())
    expect(first.items.map((item) => item.id)).toEqual(['instruction-console', 'instruction-explorer', 'instruction-questions', 'instruction-image', 'instruction-taskLaunch'])
    const consoleItem = first.items.find((item) => item.id === 'instruction-console')!
    expect(consoleItem).toMatchObject({ toggleable: true, enabled: true, includedInNextTurn: true })
    expect(String(consoleItem.details?.['Текст'])).toContain('```tool')

    await inj({ method: 'POST', url: `/api/conversations/${conv.id}/context/instruction-console`, payload: { enabled: false } })
    const second = groupOf((await inj({ method: 'GET', url: `/api/conversations/${conv.id}/context-snapshot` })).json())
    expect(second.items.find((item) => item.id === 'instruction-console')).toMatchObject({ enabled: false, includedInNextTurn: false })
    expect(second.items.find((item) => item.id === 'instruction-explorer')).toMatchObject({ enabled: true, includedInNextTurn: true })
  })

  it('снимок проектного чата: пункт проекта несёт точный текст, уходящий в промпт', async () => {
    const project = db.createProject(U, { name: 'Инспектор', gitUrl: 'https://example.com/repo.git', technologies: ['ts'] })
    const conv = db.createConversation(U, 'Проектный')
    db.setConversationProject(U, conv.id, project.id)
    const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${conv.id}/context-snapshot` })).json()
    const item = snapshot.groups.flatMap((g: { items: { id: string; details?: Record<string, unknown> }[] }) => g.items).find((e: { id: string }) => e.id === 'project-binding')
    expect(item.details).toMatchObject({ 'ID проекта': project.id, 'Git': 'https://example.com/repo.git', 'Технологии': 'ts' })
    expect(String(item.details['Текст в промпте'])).toContain('## Контекст проекта «Инспектор»')
    expect(String(item.details['Текст в промпте'])).toContain(`ID проекта: ${project.id}`)
  })

  it('тумблер контекста: выключает пункт, отражает в снимке и отказывает выключить безопасность', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Toggle' } })).json()
    // Выключаем knowledge-mode.
    const off = await inj({ method: 'POST', url: `/api/conversations/${created.id}/context/knowledge-mode`, payload: { enabled: false } })
    expect(off.statusCode).toBe(200)
    const kbItem = off.json().groups.flatMap((g: { items: { id: string; enabled: boolean; includedInNextTurn: boolean }[] }) => g.items).find((e: { id: string }) => e.id === 'knowledge-mode')
    expect(kbItem).toMatchObject({ enabled: false, includedInNextTurn: false })
    expect(db.getConversation(U, created.id)?.disabledContext).toContain('knowledge-mode')
    // Включаем обратно.
    const on = await inj({ method: 'POST', url: `/api/conversations/${created.id}/context/knowledge-mode`, payload: { enabled: true } })
    expect(on.json().groups.flatMap((g: { items: { id: string; enabled: boolean }[] }) => g.items).find((e: { id: string }) => e.id === 'knowledge-mode').enabled).toBe(true)
    // Безопасность выключить нельзя.
    expect((await inj({ method: 'POST', url: `/api/conversations/${created.id}/context/platform-instructions`, payload: { enabled: false } })).statusCode).toBe(400)
    expect(db.getConversation(U, created.id)?.disabledContext).not.toContain('platform-instructions')
  })

  it('снимок проектного чата наследует LLM проекта', async () => {
    const settings = db.getSettings(U)
    await inj({ method: 'PUT', url: '/api/settings', payload: { ...settings, llmProvider: 'claude', model: 'default' } })
    const project = db.createProject(U, { name: 'Codex project' })
    db.setCiLlmConfig('project', project.id, {
      provider: 'codex',
      model: 'gpt-5.6-sol',
      mode: 'development',
      clarifyLevel: 'few',
      clarifyMax: 3
    })
    const conversation = db.createConversation(U, 'Project context')
    db.setConversationProject(U, conversation.id, project.id)

    const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${conversation.id}/context-snapshot` })).json()
    const llm = snapshot.groups.flatMap((group: { items: Array<{ id: string }> }) => group.items).find((item: { id: string }) => item.id === 'llm')

    expect(snapshot.summary).toMatchObject({ provider: 'codex', model: 'gpt-5.6-sol' })
    expect(llm).toMatchObject({
      source: 'Проект',
      description: 'codex · gpt-5.6-sol',
      explanation: 'Унаследовано из настроек проекта.'
    })
  })

  it('LLM override разговора имеет приоритет над проектом', async () => {
    const project = db.createProject(U, { name: 'Project defaults' })
    db.setCiLlmConfig('project', project.id, {
      provider: 'codex',
      model: 'gpt-5.6-sol',
      mode: 'development',
      clarifyLevel: 'few',
      clarifyMax: 3
    })
    const conversation = db.createConversation(U, 'Conversation override')
    db.setConversationProject(U, conversation.id, project.id)
    db.setConversationExecTarget(U, conversation.id, null, undefined, undefined, 'claude', 'haiku')

    const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${conversation.id}/context-snapshot` })).json()
    const llm = snapshot.groups.flatMap((group: { items: Array<{ id: string }> }) => group.items).find((item: { id: string }) => item.id === 'llm')

    expect(snapshot.summary).toMatchObject({ provider: 'claude', model: 'haiku' })
    expect(llm).toMatchObject({
      source: 'Разговор',
      description: 'claude · haiku',
      explanation: 'Явное переопределение.'
    })
  })

  it('снимок непривязанного чата наследует пользовательскую LLM-пару', async () => {
    const settings = db.getSettings(U)
    await inj({ method: 'PUT', url: '/api/settings', payload: { ...settings, llmProvider: 'codex', codexModel: 'gpt-5.6-luna' } })
    const conversation = db.createConversation(U, 'Personal context')

    const snapshot = (await inj({ method: 'GET', url: `/api/conversations/${conversation.id}/context-snapshot` })).json()
    const llm = snapshot.groups.flatMap((group: { items: Array<{ id: string }> }) => group.items).find((item: { id: string }) => item.id === 'llm')

    expect(snapshot.summary).toMatchObject({ provider: 'codex', model: 'gpt-5.6-luna' })
    expect(llm).toMatchObject({
      source: 'Настройки пользователя',
      description: 'codex · gpt-5.6-luna',
      explanation: 'Унаследовано из настроек пользователя.'
    })
  })

  it('не раскрывает снимок чужого или отсутствующего разговора', async () => {
    const created = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Чужой' } })).json()
    db.createUser('other', 'password', 'developer')
    const other = signToken({ name: 'other', role: 'developer' }, SECRET)
    const hidden = await app.inject({ method: 'GET', url: `/api/conversations/${created.id}/context-snapshot`, headers: { authorization: `Bearer ${other}` } })
    expect(hidden.statusCode).toBe(404)
    expect((await inj({ method: 'GET', url: '/api/conversations/missing/context-snapshot' })).statusCode).toBe(404)
  })

  it('поиск /conversations/search находит по названию (статик-роут не конфликтует с :id)', async () => {
    await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Лиссабон' } })
    await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Погода' } })
    const res = await inj({ method: 'GET', url: '/api/conversations/search?q=лисс' })
    expect(res.statusCode).toBe(200)
    const found = res.json()
    expect(found.map((c: { title: string }) => c.title)).toEqual(['Лиссабон'])
  })

  it('чат задачи в «Готово» уходит из списка, но открывается по ссылке и из карточки', async () => {
    const project = db.createProject(U, { name: 'P' })
    const board = db.getBoard(U, project.id)!
    const done = board.columns.find((c) => c.semanticType === 'done')!
    const task = db.createTask(U, project.id, { columnId: board.columns[0]!.id, title: 'Скролл' })!
    const chat = db.openOrCreateTaskChat(U, project.id, task.id)!
    const ids = async (url: string): Promise<string[]> =>
      (await inj({ method: 'GET', url })).json().map((c: { id: string }) => c.id)

    expect(await ids('/api/conversations')).toContain(chat.id)
    db.moveTask(U, project.id, task.id, { columnId: done.id })
    expect(await ids('/api/conversations')).not.toContain(chat.id)
    expect(await ids('/api/conversations?includeCompleted=1')).toContain(chat.id)
    expect(await ids(`/api/conversations/search?q=${encodeURIComponent('Скролл')}`)).not.toContain(chat.id)
    expect(await ids(`/api/conversations/search?q=${encodeURIComponent('Скролл')}&includeCompleted=1`)).toContain(chat.id)

    const cancelled = board.columns.find((c) => c.semanticType === 'cancelled')!
    db.moveTask(U, project.id, task.id, { columnId: cancelled.id })
    expect(await ids('/api/conversations')).not.toContain(chat.id)
    expect(await ids('/api/conversations?includeCompleted=1')).not.toContain(chat.id)
    expect(await ids(`/api/conversations/search?q=${encodeURIComponent('Скролл')}&includeCompleted=1`)).not.toContain(chat.id)

    // Прямая ссылка и кнопка «Открыть чат» на карточке работают как раньше.
    expect((await inj({ method: 'GET', url: `/api/conversations/${chat.id}` })).json().conversation.id).toBe(chat.id)
    const fromCard = await inj({ method: 'POST', url: `/api/projects/${project.id}/tasks/${task.id}/chat` })
    expect(fromCard.json().id).toBe(chat.id)
  })

  it('cc: projects/sessions/transcript из ~/.claude/projects (VC_CC_DIR)', async () => {
    const ccDir = mkdtempSync(join(tmpdir(), 'cc-rest-'))
    const proj = join(ccDir, '-Users-x-demo')
    mkdirSync(proj, { recursive: true })
    writeFileSync(
      join(proj, 'sess.jsonl'),
      [
        JSON.stringify({ type: 'user', cwd: '/Users/x/demo', message: { content: 'Помоги с фичей' } }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Готово' }] } })
      ].join('\n')
    )
    const prev = process.env.VC_CC_DIR
    process.env.VC_CC_DIR = ccDir
    try {
      const projects = (await inj({ method: 'GET', url: '/api/cc/projects' })).json()
      const demo = projects.find((p: { name: string }) => p.name === 'demo')
      expect(demo?.path).toBe('/Users/x/demo')

      const sessions = (
        await inj({ method: 'GET', url: `/api/cc/projects/${demo.slug}/sessions` })
      ).json()
      expect(sessions[0].title).toBe('Помоги с фичей')

      const body = (
        await inj({ method: 'GET', url: `/api/cc/projects/${demo.slug}/sessions/sess` })
      ).json()
      expect(body.items.map((i: { kind: string }) => i.kind)).toEqual(['user', 'assistant'])
      expect(body.usage).toBeDefined()
    } finally {
      if (prev === undefined) delete process.env.VC_CC_DIR
      else process.env.VC_CC_DIR = prev
      rmSync(ccDir, { recursive: true, force: true })
    }
  })

  it('cc:resume создаёт разговор с импортом истории и привязкой session-id', async () => {
    const ccDir = mkdtempSync(join(tmpdir(), 'cc-resume-'))
    const proj = join(ccDir, '-Users-x-demo')
    mkdirSync(proj, { recursive: true })
    writeFileSync(
      join(proj, 'sess-42.jsonl'),
      [
        JSON.stringify({ type: 'user', cwd: '/Users/x/demo', message: { content: 'Почини баг' } }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Готово' }] } })
      ].join('\n')
    )
    const prev = process.env.VC_CC_DIR
    process.env.VC_CC_DIR = ccDir
    try {
      const res = await inj({
        method: 'POST',
        url: '/api/cc/resume',
        payload: { slug: '-Users-x-demo', id: 'sess-42' }
      })
      expect(res.statusCode).toBe(200)
      const { conversation, messages } = res.json()
      // История импортирована в ленту.
      expect(messages.map((m: { role: string; text: string }) => [m.role, m.text])).toEqual([
        ['u1', 'Почини баг'],
        ['ai', 'Готово']
      ])
      // Разговор привязан к session-id → следующий ход пойдёт через --resume.
      expect(db.getConversation(U, conversation.id)?.claudeSessionId).toBe('sess-42')
    } finally {
      if (prev === undefined) delete process.env.VC_CC_DIR
      else process.env.VC_CC_DIR = prev
      rmSync(ccDir, { recursive: true, force: true })
    }
  })

  it('cc:resume без slug/id → 400', async () => {
    const res = await inj({ method: 'POST', url: '/api/cc/resume', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('добавление сообщения видно в get', async () => {
    const c = (await inj({ method: 'POST', url: '/api/conversations', payload: {} })).json()
    const m = (
      await inj({
        method: 'POST',
        url: `/api/conversations/${c.id}/messages`,
        payload: { role: 'u1', text: 'Привет', time: '10:00' }
      })
    ).json()
    expect(m.text).toBe('Привет')
    const got = (await inj({ method: 'GET', url: `/api/conversations/${c.id}` })).json()
    expect(got.messages).toHaveLength(1)
  })

  it('обновляет и сохраняет состояние списка task-launch в meta сообщения', async () => {
    const c = (await inj({ method: 'POST', url: '/api/conversations', payload: {} })).json()
    const m = (await inj({
      method: 'POST',
      url: `/api/conversations/${c.id}/messages`,
      payload: {
        role: 'ai',
        text: 'Выберите.',
        time: '10:00',
        meta: { taskLaunches: [
          { id: 'task-launch-1', title: 'Первая', description: 'Описание', acceptanceCriteria: 'Критерий' },
          { id: 'task-launch-2', title: 'Вторая', description: 'Описание', acceptanceCriteria: 'Критерий' }
        ] }
      }
    })).json()
    const meta = { ...m.meta, taskLaunches: m.meta.taskLaunches.map((item: { id: string }) => item.id === 'task-launch-2' ? { ...item, status: 'created' } : item) }
    const patched = await inj({ method: 'PATCH', url: `/api/conversations/${c.id}/messages/${m.id}`, payload: { meta } })
    expect(patched.statusCode).toBe(200)
    const got = (await inj({ method: 'GET', url: `/api/conversations/${c.id}` })).json()
    expect(got.messages[0].meta.taskLaunches[1].status).toBe('created')
    expect(got.messages[0].meta.taskLaunches[0].status).toBeUndefined()
  })

  it('удаление сообщения убирает его из истории', async () => {
    const c = (await inj({ method: 'POST', url: '/api/conversations', payload: {} })).json()
    const m = (
      await inj({
        method: 'POST',
        url: `/api/conversations/${c.id}/messages`,
        payload: { role: 'u1', text: 'удалить меня', time: '10:00' }
      })
    ).json()
    const del = await inj({
      method: 'DELETE',
      url: `/api/conversations/${c.id}/messages/${m.id}`
    })
    expect(del.statusCode).toBe(200)
    const got = (await inj({ method: 'GET', url: `/api/conversations/${c.id}` })).json()
    expect(got.messages).toHaveLength(0)
  })

  it('удаление сообщения сбрасывает сессию Claude (модель забывает удалённое)', async () => {
    const c = (await inj({ method: 'POST', url: '/api/conversations', payload: {} })).json()
    const m = (
      await inj({
        method: 'POST',
        url: `/api/conversations/${c.id}/messages`,
        payload: { role: 'u1', text: 'секрет', time: '10:00' }
      })
    ).json()
    db.setClaudeSession(U, c.id, 'sess-abc')
    expect(db.getConversation(U, c.id)?.claudeSessionId).toBe('sess-abc')

    await inj({ method: 'DELETE', url: `/api/conversations/${c.id}/messages/${m.id}` })
    expect(db.getConversation(U, c.id)?.claudeSessionId).toBeNull()
  })

  it('список моделей содержит все поддерживаемые', async () => {
    const res = await inj({ method: 'GET', url: '/api/stt/models' })
    const models = res.json() as Array<{ model: string; present: boolean; sizeBytes: number }>
    expect(models.map((m) => m.model).sort()).toEqual(['large-v3-turbo', 'medium', 'small'])
    for (const m of models) expect(typeof m.sizeBytes).toBe('number')
  })

  it('удаление модели/голоса отвечает ok (без файла — идемпотентно)', async () => {
    const m = await inj({ method: 'DELETE', url: '/api/stt/models/small' })
    expect(m.statusCode).toBe(200)
    const v = await inj({ method: 'DELETE', url: '/api/tts/voices/ru_RU-irina-medium' })
    expect(v.statusCode).toBe(200)
  })

  it('загрузка вложения возвращает id и имя', async () => {
    const res = await inj({
      method: 'POST',
      url: '/api/uploads',
      payload: { name: 'заметка.txt', dataBase64: Buffer.from('привет').toString('base64') }
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(typeof body.id).toBe('string')
    expect(body.id.length).toBeGreaterThan(0)
    expect(body.name).toBe('заметка.txt')
  })

  it('rename и delete', async () => {
    const c = (await inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Старое' } })).json()
    await inj({ method: 'PATCH', url: `/api/conversations/${c.id}`, payload: { title: 'Новое' } })
    let got = await inj({ method: 'GET', url: `/api/conversations/${c.id}` })
    expect(got.json().conversation.title).toBe('Новое')
    await inj({ method: 'DELETE', url: `/api/conversations/${c.id}` })
    got = await inj({ method: 'GET', url: `/api/conversations/${c.id}` })
    expect(got.statusCode).toBe(404)
  })

  it('settings get/save', async () => {
    const def = (await inj({ method: 'GET', url: '/api/settings' })).json()
    expect(def.model).toBeDefined()
    const next = { ...def, diarization: false, voice: 'ru_RU-dmitri-medium' }
    await inj({ method: 'PUT', url: '/api/settings', payload: next })
    const saved = (await inj({ method: 'GET', url: '/api/settings' })).json()
    expect(saved.diarization).toBe(false)
    expect(saved.voice).toBe('ru_RU-dmitri-medium')
  })

  it('нормализует персонализацию и отвергает невозможную дату', async () => {
    const def = (await inj({ method: 'GET', url: '/api/settings' })).json()
    const invalid = await inj({ method: 'PUT', url: '/api/settings', payload: { ...def, personalization: { ...def.personalization, birthDay: 31, birthMonth: 2 } } })
    expect(invalid.statusCode).toBe(400)
    const saved = await inj({ method: 'PUT', url: '/api/settings', payload: { ...def, personalization: { ...def.personalization, preferredName: '  Алексей   Р. ', birthYear: 1990, responseLanguage: 'ru', responseStyle: 'brief', tone: 'friendly' } } })
    expect(saved.statusCode).toBe(200)
    expect(saved.json().personalization).toMatchObject({ preferredName: 'Алексей Р.', birthYear: 1990, responseLanguage: 'ru', responseStyle: 'brief', tone: 'friendly' })
  })

  it('агенты: create → list (offline) → delete', async () => {
    const created = (
      await inj({ method: 'POST', url: '/api/agents', payload: { name: 'MacBook' } })
    ).json()
    expect(created.name).toBe('MacBook')
    expect(typeof created.token).toBe('string')

    const list = (await inj({ method: 'GET', url: '/api/agents' })).json()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: created.id, name: 'MacBook', online: false })

    const del = await inj({ method: 'DELETE', url: `/api/agents/${created.id}` })
    expect(del.statusCode).toBe(200)
    expect((await inj({ method: 'GET', url: '/api/agents' })).json()).toHaveLength(0)
  })

  it('агенты: удаление снимает машину и с цели выполнения, и с дефолта', async () => {
    const created = (
      await inj({ method: 'POST', url: '/api/agents', payload: { name: 'MacBook' } })
    ).json()
    const before = (await inj({ method: 'GET', url: '/api/settings' })).json()
    await inj({
      method: 'PUT',
      url: '/api/settings',
      payload: { ...before, execTarget: created.id, defaultAgentId: created.id }
    })

    await inj({ method: 'DELETE', url: `/api/agents/${created.id}` })

    const after = (await inj({ method: 'GET', url: '/api/settings' })).json()
    expect(after.execTarget).toBeNull()
    // Дефолт подставляется в новые разговоры: висячий id уводил бы ход на машину,
    // которой больше нет.
    expect(after.defaultAgentId).toBeNull()
  })

  it('агенты: POST без имени → 400', async () => {
    const res = await inj({ method: 'POST', url: '/api/agents', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('агенты: список содержит политику; setPolicy сохраняет', async () => {
    const created = (
      await inj({ method: 'POST', url: '/api/agents', payload: { name: 'M' } })
    ).json()
    const list = (await inj({ method: 'GET', url: '/api/agents' })).json()
    expect(list[0].policy.allowNetwork).toBe(true)

    const policy = {
      allowedDirs: ['/tmp'],
      allowNetwork: false,
      allowWrite: false,
      denyPatterns: ['sudo'],
      allowPatterns: [],
      skills: []
    }
    const res = await inj({
      method: 'POST',
      url: `/api/agents/${created.id}/policy`,
      payload: { policy }
    })
    expect(res.statusCode).toBe(200)
    const after = (await inj({ method: 'GET', url: '/api/agents' })).json()
    expect(after[0].policy.allowNetwork).toBe(false)
    expect(after[0].policy.allowedDirs).toEqual(['/tmp'])
  })

  it('агенты: перевыпуск токена возвращает новый токен', async () => {
    const created = (
      await inj({ method: 'POST', url: '/api/agents', payload: { name: 'M' } })
    ).json()
    const res = await inj({ method: 'POST', url: `/api/agents/${created.id}/token` })
    expect(res.statusCode).toBe(200)
    expect(typeof res.json().token).toBe('string')
    expect(res.json().token).not.toBe(created.token)
  })

  it('скачивание: GET /api/agents/app и /api/app/desktop без .dmg → 404', async () => {
    // В тестах autodiscover артефактов отключён (VITEST), VC_*_APP не заданы.
    const agent = await inj({ method: 'GET', url: '/api/agents/app' })
    expect(agent.statusCode).toBe(404)
    expect(agent.json().error).toContain('не собрано')
    const desktop = await inj({ method: 'GET', url: '/api/app/desktop' })
    expect(desktop.statusCode).toBe(404)
  })

  it('скачивание: GET /api/agents/script отдаёт JS-бандл (attachment)', async () => {
    const res = await inj({ method: 'GET', url: '/api/agents/script' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('javascript')
    expect(res.headers['content-disposition']).toContain('voicechat-agent.cjs')
    expect(res.body.startsWith('#!')).toBe(true)
  }, 30_000)

  it('установщик Termux: GET /api/agents/install-android.sh публичен и отдаёт bash', async () => {
    // Без токена — должен быть доступен (curl с телефона до логина).
    const res = await app.inject({ method: 'GET', url: '/api/agents/install-android.sh' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('shellscript')
    expect(res.body.startsWith('#!')).toBe(true)
    expect(res.body).toContain('/api/agents/script')
  })

  it('установщик Windows: GET /api/agents/install-windows.ps1 публичен и отдаёт PowerShell', async () => {
    // Без токена — команду запускают на машине до какого-либо логина.
    const res = await app.inject({ method: 'GET', url: '/api/agents/install-windows.ps1' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('powershell')
    expect(res.body).toContain('/api/agents/script')
    expect(res.body).toContain('nodejs.org')
  })

  it('установщики Linux и macOS публичны, отдают bash и разные скрипты', async () => {
    const lin = await app.inject({ method: 'GET', url: '/api/agents/install-linux.sh' })
    const mac = await app.inject({ method: 'GET', url: '/api/agents/install-macos.sh' })
    for (const res of [lin, mac]) {
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('shellscript')
      expect(res.body).toContain('/api/agents/script')
      expect(res.body).toContain('-ge 22') // проверка Node 22+
    }
    expect(lin.body).toContain('systemctl --user')
    expect(mac.body).toContain('LaunchAgents')
    expect(lin.body).not.toBe(mac.body)
  })

  it('обновление офлайн-машины отклоняется с понятной причиной', async () => {
    const created = (
      await inj({ method: 'POST', url: '/api/agents', payload: { name: 'Офлайн' } })
    ).json()
    const res = await inj({ method: 'POST', url: `/api/agents/${created.id}/update` })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toContain('не в сети')
  })

  it('обновление отклоняется, если сервер виден как localhost (команда ушла бы в саму машину)', async () => {
    // app.inject ходит с Host: localhost — ровно тот случай, когда база непригодна.
    const created = (
      await inj({ method: 'POST', url: '/api/agents', payload: { name: 'Локальная' } })
    ).json()
    const res = await inj({ method: 'POST', url: `/api/agents/${created.id}/update` })
    // Машина офлайн → 409 про сеть; проверяем, что до сборки команды дело не дошло
    // молча: в обоих случаях это 409 с объяснением, а не «ok».
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBeTruthy()
  })

  it('обновление чужой машины — 404', async () => {
    const res = await inj({ method: 'POST', url: '/api/agents/нет-такой/update' })
    expect(res.statusCode).toBe(404)
  })

  it('обновление без токена — 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/agents/x/update' })
    expect(res.statusCode).toBe(401)
  })

  it('удаление агента сбрасывает execTarget на сервер', async () => {
    const created = (
      await inj({ method: 'POST', url: '/api/agents', payload: { name: 'M' } })
    ).json()
    const def = (await inj({ method: 'GET', url: '/api/settings' })).json()
    await inj({ method: 'PUT', url: '/api/settings', payload: { ...def, execTarget: created.id } })
    await inj({ method: 'DELETE', url: `/api/agents/${created.id}` })
    const saved = (await inj({ method: 'GET', url: '/api/settings' })).json()
    expect(saved.execTarget).toBeNull()
  })
})

describe('REST: утилиты машины (exec/fs)', () => {
  it('exec: 404 на чужую машину; 400 на офлайн-машину владельца', async () => {
    // Своя офлайн-машина: exec → 400 (не в сети).
    const created = (await inj({ method: 'POST', url: '/api/agents', payload: { name: 'M' } })).json()
    const own = await inj({
      method: 'POST',
      url: `/api/agents/${created.id}/exec`,
      payload: { command: 'ls' }
    })
    expect(own.statusCode).toBe(400)
    expect(own.json().error).toContain('не в сети')

    // Чужая машина (создана под user) → 404 для admin.
    db.createUser('user', '', 'developer')
    const other = db.createAgent('user', 'UserBox')
    const foreign = await inj({
      method: 'POST',
      url: `/api/agents/${other.id}/exec`,
      payload: { command: 'ls' }
    })
    expect(foreign.statusCode).toBe(404)
  })

  it('fs.list: 400 на офлайн-машину владельца', async () => {
    const created = (await inj({ method: 'POST', url: '/api/agents', payload: { name: 'M' } })).json()
    const res = await inj({ method: 'GET', url: `/api/agents/${created.id}/fs?path=` })
    expect(res.statusCode).toBe(400)
  })

  it('GET /api/agents/version публичен и отдаёт версию', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agents/version' }) // без токена
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ version: '0.14.0' })
  })
})

describe('REST: чтение файла с диска сервера (/api/files/read)', () => {
  // Профиль CLI создаётся при первом обращении к нему; дёргаем любой роут,
  // который его трогает, а затем кладём туда «сгенерированную» картинку.
  async function seedImage(): Promise<string> {
    await inj({ method: 'GET', url: '/api/auth/status' })
    const dir = join(dataDir, 'cli-users', Buffer.from(U).toString('base64url'), '.codex', 'generated_images', 'sess')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'pic.png')
    writeFileSync(file, 'PNGDATA')
    return file
  }

  it('отдаёт картинку из профиля пользователя', async () => {
    const file = await seedImage()
    const res = await inj({ method: 'GET', url: `/api/files/read?path=${encodeURIComponent(file)}` })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { name: string; dataBase64: string }
    expect(body.name).toBe('pic.png')
    expect(Buffer.from(body.dataBase64, 'base64').toString()).toBe('PNGDATA')
  })

  it('файл вне своей области — 404', async () => {
    await seedImage()
    const outside = join(tmpdir(), `vc-outside-${Date.now()}.png`)
    writeFileSync(outside, 'NOPE')
    const res = await inj({ method: 'GET', url: `/api/files/read?path=${encodeURIComponent(outside)}` })
    expect(res.statusCode).toBe(404)
    rmSync(outside, { force: true })
  })

  it('без токена — 401 (роут под общей защитой /api)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/files/read?path=/etc/passwd' })
    expect(res.statusCode).toBe(401)
  })

  it('системный файл не отдаётся', async () => {
    const res = await inj({ method: 'GET', url: '/api/files/read?path=/etc/passwd' })
    expect(res.statusCode).toBe(404)
  })
})

describe('REST: GET /api/search — полнотекстовый поиск по сообщениям', () => {
  /** Беседа с сообщениями пользователя (по умолчанию — admin из токена). */
  const seed = (user: string, title: string, texts: string[]): string => {
    const conv = db.createConversation(user, title)
    for (const t of texts) db.addMessage(user, conv.id, 'u1', t, '12:00')
    return conv.id
  }

  it('без токена → 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/search?q=миграция' })).statusCode).toBe(401)
  })

  it('отдаёт ранжированные результаты со сниппетом и курсором', async () => {
    const id = seed(U, 'Канбан', [
      'Обсудили миграцию канбана и схему БД',
      'Ещё раз про миграцию',
      'Совсем про другое'
    ])

    const first = await inj({ method: 'GET', url: '/api/search?q=миграцию%20&limit=1' })
    expect(first.statusCode).toBe(200)
    const page1 = first.json()
    expect(page1.hits).toHaveLength(1)
    expect(page1.hits[0].conversationId).toBe(id)
    expect(page1.hits[0].conversationTitle).toBe('Канбан')
    expect(page1.hits[0].snippet).toContain('<mark>')
    expect(typeof page1.nextCursor).toBe('string')

    const second = await inj({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent('миграцию ')}&limit=1&cursor=${encodeURIComponent(page1.nextCursor)}`
    })
    const page2 = second.json()
    expect(page2.hits).toHaveLength(1)
    expect(page2.hits[0].messageId).not.toBe(page1.hits[0].messageId)
  })

  it('не выдаёт сообщения другого пользователя', async () => {
    db.createUser('mallory', '', 'developer')
    const theirs = seed('mallory', 'Чужая беседа', ['чужой секрет про миграцию'])
    seed(U, 'Своя беседа', ['свой текст про миграцию'])

    const all = await inj({ method: 'GET', url: '/api/search?q=миграцию%20' })
    expect(all.json().hits.map((h: { conversationTitle: string }) => h.conversationTitle)).toEqual(['Своя беседа'])

    // Явная чужая беседа — тоже пусто, а не 403/500: чужого просто «не существует».
    const direct = await inj({ method: 'GET', url: `/api/search?q=миграцию%20&conversationId=${theirs}` })
    expect(direct.statusCode).toBe(200)
    expect(direct.json().hits).toEqual([])
  })

  it('сужает по проекту, projectId=none — только беседы без проекта', async () => {
    const project = db.createProject(U, { name: 'Проект' })
    const inProject = seed(U, 'С проектом', ['миграция схемы'])
    db.setConversationProject(U, inProject, project.id)
    seed(U, 'Без проекта', ['миграция схемы'])

    const byProject = await inj({ method: 'GET', url: `/api/search?q=миграция%20&projectId=${project.id}` })
    expect(byProject.json().hits.map((h: { conversationTitle: string }) => h.conversationTitle)).toEqual(['С проектом'])

    const none = await inj({ method: 'GET', url: '/api/search?q=миграция%20&projectId=none' })
    expect(none.json().hits.map((h: { conversationTitle: string }) => h.conversationTitle)).toEqual(['Без проекта'])
  })

  it('пробел в конце запроса приезжает и как «+» (URLSearchParams)', async () => {
    seed(U, 'Канбан', ['миграция канбана'])

    // «мигра» — префикс, находит; «мигра+» — слово закончено, не находит.
    expect((await inj({ method: 'GET', url: '/api/search?q=мигра' })).json().hits).toHaveLength(1)
    expect((await inj({ method: 'GET', url: '/api/search?q=мигра+' })).json().hits).toHaveLength(0)
  })

  it('спецсимволы и мусорные параметры не дают 500', async () => {
    seed(U, 'Канбан', ['миграция канбана'])

    const bad = ['', '*', '"', '-', 'NEAR(', '^)(', '%%%', 'a".."b', '\\\\', '(((']
    for (const q of bad) {
      const res = await inj({ method: 'GET', url: `/api/search?q=${encodeURIComponent(q)}` })
      expect(res.statusCode, `q=${JSON.stringify(q)}`).toBe(200)
      expect(Array.isArray(res.json().hits)).toBe(true)
    }
    // Мусор в limit/cursor тоже не ошибка.
    const res = await inj({ method: 'GET', url: '/api/search?q=миграция%20&limit=abc&cursor=%00%01' })
    expect(res.statusCode).toBe(200)
    expect(res.json().hits).toHaveLength(1)
  })
})

describe('REST: задачи из предложений улучшений', () => {
  it('создаёт атомарно, возвращает идемпотентный результат и отклоняет повторный переход', async () => {
    const project = db.createProject(U, { name: 'P' })
    const column = db.getBoard(U, project.id)!.columns[0]!
    const source = db.createTask(U, project.id, { columnId: column.id, title: 'Source' })!
    const improvement = db.upsertTaskImprovement({
      projectId: project.id, taskId: source.id, runId: null, stepId: null, source: 'development',
      title: 'Улучшить ретраи', description: 'Подробности', fingerprint: 'rest-retry',
      evidence: ['Ошибка видима'], suggestedAction: 'create_chatai_task'
    })
    const payload = { columnId: column.id, title: 'Retry task', description: 'D', acceptanceCriteria: 'AC' }
    const first = await inj({ method: 'POST', url: `/api/improvements/${improvement.id}/create-task`, payload })
    const second = await inj({ method: 'POST', url: `/api/improvements/${improvement.id}/create-task`, payload })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({ created: true, improvement: { status: 'implemented' } })
    expect(second.json()).toMatchObject({ created: false, task: { id: first.json().task.id } })
    const invalid = await inj({ method: 'PATCH', url: `/api/improvements/${improvement.id}`, payload: { status: 'accepted' } })
    expect(invalid.statusCode).toBe(409)
  })
})

describe('REST: машины настроек разговора', () => {
  it('обычный чат видит только личные машины, проектный — личные и проектные без дублей', async () => {
    db.createUser('owner', '', 'developer')
    db.createUser('outsider', '', 'developer')
    const own = db.createAgent(U, 'Личная')
    const shared = db.createAgent('owner', 'Проектная')
    const hidden = db.createAgent('outsider', 'Чужая')
    const project = db.createProject('owner', { name: 'Shared' })
    db.linkMachine('owner', project.id, shared.id)
    db.addMember('owner', project.id, U)
    const plain = db.createConversation(U, 'Обычный')

    const plainMachines = (await inj({ method: 'GET', url: `/api/conversations/${plain.id}/machines` })).json()
    expect(plainMachines.map((a: { id: string }) => a.id)).toEqual([own.id])

    const projectMachines = (await inj({ method: 'GET', url: `/api/conversations/${plain.id}/machines?projectId=${project.id}` })).json()
    expect(projectMachines.map((a: { id: string }) => a.id).sort()).toEqual([own.id, shared.id].sort())
    expect(projectMachines.filter((a: { id: string }) => a.id === own.id)).toHaveLength(1)
    expect(projectMachines.some((a: { id: string }) => a.id === hidden.id)).toBe(false)
  })

  it('не даёт неучастнику увидеть проектную машину или сохранить недоступную', async () => {
    db.createUser('owner', '', 'developer')
    const foreign = db.createAgent('owner', 'Серверная')
    const project = db.createProject('owner', { name: 'Private' })
    db.linkMachine('owner', project.id, foreign.id)
    const conversation = db.createConversation(U, 'Чат')

    const list = (await inj({ method: 'GET', url: `/api/conversations/${conversation.id}/machines?projectId=${project.id}` })).json()
    expect(list.some((a: { id: string }) => a.id === foreign.id)).toBe(false)

    const denied = await inj({
      method: 'PATCH',
      url: `/api/conversations/${conversation.id}`,
      payload: { execTarget: foreign.id }
    })
    expect(denied.statusCode).toBe(403)
    expect(db.getConversation(U, conversation.id)?.execTarget).toBeNull()
  })
})

describe('REST: preview proxy', () => {
  it('блокирует loopback и приватные сети до запроса', async () => {
    for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '::1', 'fe80::1', 'fc00::1']) expect(isPublicAddress(address)).toBe(false)
    expect(isPublicAddress('8.8.8.8')).toBe(true)
    expect((await inj({ method: 'GET', url: '/api/preview?url=http%3A%2F%2F127.0.0.1%2F' })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/api/preview?url=https%3A%2F%2Fexample.com' })).statusCode).toBe(401)
  })

  it('переписывает HTML-ссылки и убирает frame-ancestors CSP', () => {
    const html = '<meta http-equiv="Content-Security-Policy" content="frame-ancestors none"><a href="/next">next</a><img src="image.png"><script src="/app.js"></script>'
    const result = rewritePreviewBody(Buffer.from(html), 'text/html', new URL('https://site.example/base/')).toString()
    expect(result).not.toContain('Content-Security-Policy')
    expect(result).toContain('/api/preview?url=https%3A%2F%2Fsite.example%2Fnext')
    expect(result).toContain('/api/preview?url=https%3A%2F%2Fsite.example%2Fbase%2Fimage.png')
    expect(result).toContain('id="voicechat-preview-inspector"')
    expect(result.indexOf('voicechat-preview-inspector')).toBeLessThan(result.indexOf('</body>') === -1 ? result.length : result.indexOf('</body>'))
  })

  it('переписывает url() в <style>-блоках и inline style-атрибутах', () => {
    const html = '<style>.a{background:url("/bg.png")}</style><div style="background-image:url(img/x.png)">x</div>'
    const result = rewritePreviewBody(Buffer.from(html), 'text/html', new URL('https://site.example/base/')).toString()
    expect(result).toContain('url("/api/preview?url=https%3A%2F%2Fsite.example%2Fbg.png")')
    expect(result).toContain('url(/api/preview?url=https%3A%2F%2Fsite.example%2Fbase%2Fimg%2Fx.png)')
  })

  it('не пропускает наружу cookie и Authorization ChatAI, а Authorization страницы возвращает апстриму', () => {
    const headers = upstreamRequestHeaders({
      host: 'chat.example',
      cookie: 'vc_preview_session=secret',
      authorization: 'Bearer chatai-token',
      'x-preview-authorization': 'Bearer site-token',
      'content-type': 'application/json',
      'x-api-key': 'k',
      'sec-fetch-mode': 'cors',
      'accept-encoding': 'gzip',
      'x-forwarded-for': '1.2.3.4'
    })
    expect(headers).toEqual({ authorization: 'Bearer site-token', 'content-type': 'application/json', 'x-api-key': 'k' })
  })

  it('тело любого content-type принимается сырым, SSRF-граница действует и для POST', async () => {
    // Невалидный JSON не должен падать на парсере — тело уходит апстриму как есть,
    // а до апстрима запрос к приватному адресу не доходит (403, не 400/415).
    const json = await inj({ method: 'POST', url: '/api/preview?url=http%3A%2F%2F127.0.0.1%2F', payload: '{"broken', headers: { 'content-type': 'application/json' } })
    expect(json.statusCode).toBe(403)
    const beacon = await inj({ method: 'POST', url: '/api/preview?url=http%3A%2F%2F192.168.1.1%2F', payload: 'beacon-body', headers: { 'content-type': 'text/plain' } })
    expect(beacon.statusCode).toBe(403)
  })

  it('инспектор строит уникальный selector, сериализует стили и ограничивает payload', () => {
    const script = previewInspectorScript()
    expect(script).toContain('document.querySelectorAll(candidate).length===1')
    expect(script).toContain(':nth-of-type(')
    expect(script).toContain('outerHTML:el.outerHTML.slice(0,HTML_LIMIT)')
    expect(script).toContain("text:(el.innerText||el.textContent||'').trim().slice(0,TEXT_LIMIT)")
    expect(script).toContain('gridTemplateColumns:s.gridTemplateColumns')
    expect(script).toContain("document.addEventListener('click',click,true)")
    expect(script).toContain('e.stopImmediatePropagation()')
    expect(script).toContain('e.source!==parent||e.origin!==location.origin')
  })
})
